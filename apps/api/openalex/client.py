"""OpenAlex API client — the scholarly source of truth (PRD §12).

Rules honoured here:
- direct ID/DOI fetch whenever possible; batch ids with the `openalex_id` filter
- `select=` on every call to keep payloads small
- cache only works the user touches; short TTL for searches
- never mirror the full corpus

`OPENALEX_API_KEY` is free and gives this app its own request budget. Without
one, requests count against a daily budget shared by every machine on the same
IP address, which a demo exhausts quickly; `OPENALEX_MAILTO` no longer exempts
them from it. Both are configuration, not user data.
"""
from __future__ import annotations

import os
import time
from typing import Any

import httpx

from openalex import mapping

BASE = "https://api.openalex.org"
MAILTO = os.getenv("OPENALEX_MAILTO") or None
API_KEY = os.getenv("OPENALEX_API_KEY") or None


class OpenAlexUnavailable(RuntimeError):
    """OpenAlex refused the request — out of budget, or down.

    Deliberately NOT an httpx.HTTPError. Every call below turns HTTPError into
    an empty list, which made a spent daily budget look exactly like "no results
    for that paper" and sent us hunting for bugs in the recommender instead.
    """

# TTLs per PRD §12. Work metadata is near-immutable; searches are volatile.
WORK_TTL = 7 * 24 * 3600
SEARCH_TTL = 10 * 60

# ponytail: process-local cache. The openalex_works_cache table is there for
# cross-process persistence when a second worker makes it worth the write.
_cache: dict[str, tuple[float, Any]] = {}


def _get_cached(key: str) -> Any | None:
    hit = _cache.get(key)
    if not hit:
        return None
    expires, value = hit
    if expires < time.time():
        _cache.pop(key, None)
        return None
    return value


def _put_cached(key: str, value: Any, ttl: int) -> None:
    _cache[key] = (time.time() + ttl, value)


def _params(extra: dict[str, Any]) -> dict[str, Any]:
    p = {k: v for k, v in extra.items() if v is not None}
    if MAILTO:
        p["mailto"] = MAILTO
    return p


def _request(path: str, params: dict[str, Any], *, timeout: float = 12.0) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {API_KEY}"} if API_KEY else {}
    with httpx.Client(timeout=timeout, follow_redirects=True, headers=headers) as client:
        r = client.get(f"{BASE}{path}", params=_params(params))
        if r.status_code == 429:
            raise OpenAlexUnavailable(
                "OpenAlex is out of request budget for this network. Free keys have "
                "their own budget: set OPENALEX_API_KEY in apps/api/.env "
                "(https://help.openalex.org/api/authentication)."
            )
        r.raise_for_status()
        return r.json()


class OpenAlexProvider:
    """Implements providers.base.ResearchDataProvider."""

    # ---- search ----

    def search_works(
        self,
        query: str,
        *,
        mode: str = "keyword",
        per_page: int = 10,
        filters: str | None = None,
        page: int = 1,
    ) -> list[dict[str, Any]]:
        """Keyword search for literal lookup; `mode='semantic'` for meaning-based
        discovery over long text (PRD §12)."""
        key = f"search:{mode}:{query}:{filters}:{per_page}:{page}"
        cached = _get_cached(key)
        if cached is not None:
            return cached

        params: dict[str, Any] = {"per-page": per_page, "select": mapping.LIST_FIELDS, "page": page}
        if mode == "semantic":
            # Semantic search takes free text and ranks by meaning.
            params["search.semantic"] = query[:2000]
        else:
            params["search"] = query
        if filters:
            params["filter"] = filters

        try:
            data = _request("/works", params)
        except httpx.HTTPError:
            if mode == "semantic":
                # Fall back to keyword rather than returning nothing.
                return self.search_works(query, mode="keyword", per_page=per_page, filters=filters)
            return []

        results = data.get("results") or []
        _put_cached(key, results, SEARCH_TTL)
        return results

    # ---- direct fetch ----

    def get_work(self, work_id: str) -> dict[str, Any]:
        wid = mapping.short_id(work_id) or work_id
        key = f"work:{wid}"
        cached = _get_cached(key)
        if cached is not None:
            return cached
        try:
            data = _request(f"/works/{wid}", {"select": mapping.WORK_FIELDS})
        except httpx.HTTPError:
            return {}
        _put_cached(key, data, WORK_TTL)
        return data

    def get_works_by_ids(self, ids: list[str], *, per_page: int = 50) -> list[dict[str, Any]]:
        """Batch fetch — one request for many ids instead of N (PRD §12)."""
        ids = [mapping.short_id(i) for i in ids if i][:per_page]
        if not ids:
            return []
        key = "batch:" + ",".join(sorted(ids))
        cached = _get_cached(key)
        if cached is not None:
            return cached
        try:
            data = _request(
                "/works",
                {
                    "filter": f"openalex_id:{'|'.join(ids)}",
                    "per-page": len(ids),
                    "select": mapping.LIST_FIELDS,
                },
            )
        except httpx.HTTPError:
            return []
        results = data.get("results") or []
        _put_cached(key, results, WORK_TTL)
        return results

    # ---- citations ----

    def get_citations(self, work_id: str, *, direction: str) -> list[dict[str, Any]]:
        """direction='out' -> works this cites (referenced_works);
        direction='in'  -> works citing this (cites: filter)."""
        wid = mapping.short_id(work_id) or work_id
        if direction == "out":
            work = self.get_work(wid)
            return self.get_works_by_ids(work.get("referenced_works") or [])
        key = f"cites:{wid}"
        cached = _get_cached(key)
        if cached is not None:
            return cached
        try:
            data = _request(
                "/works",
                {
                    "filter": f"cites:{wid}",
                    "per-page": 50,
                    "sort": "cited_by_count:desc",
                    "select": mapping.LIST_FIELDS,
                },
            )
        except httpx.HTTPError:
            return []
        results = data.get("results") or []
        _put_cached(key, results, SEARCH_TTL)
        return results

    # ---- pools used by the recommender ----

    def works_in_topic(
        self,
        topic_id: str,
        *,
        sort: str = "cited_by_count:desc",
        per_page: int = 25,
        extra_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        flt = f"topics.id:{topic_id}"
        if extra_filter:
            flt = f"{flt},{extra_filter}"
        key = f"topic:{flt}:{sort}:{per_page}"
        cached = _get_cached(key)
        if cached is not None:
            return cached
        try:
            data = _request(
                "/works",
                {"filter": flt, "sort": sort, "per-page": per_page, "select": mapping.LIST_FIELDS},
            )
        except httpx.HTTPError:
            return []
        results = data.get("results") or []
        _put_cached(key, results, SEARCH_TTL)
        return results


    # ---- topic hierarchy (domain -> field -> subfield -> topic) ----

    def taxonomy(self, level: str, parent_id: str | None = None, *, per_page: int = 200) -> list[dict[str, Any]]:
        """Browse OpenAlex's own classification: fields, then subfields, then
        topics. Used by onboarding so interests come from the real corpus
        instead of a hand-written list that would drift."""
        path = {"field": "/fields", "subfield": "/subfields", "topic": "/topics"}.get(level)
        if not path:
            return []
        params: dict[str, Any] = {"per-page": per_page, "select": "id,display_name,works_count"}
        if parent_id and level == "subfield":
            params["filter"] = f"field.id:{parent_id}"
        elif parent_id and level == "topic":
            params["filter"] = f"subfield.id:{parent_id}"
        params["sort"] = "works_count:desc"
        key = f"tax:{level}:{parent_id}:{per_page}"
        cached = _get_cached(key)
        if cached is not None:
            return cached
        try:
            data = _request(path, params)
        except httpx.HTTPError:
            return []
        results = data.get("results") or []
        _put_cached(key, results, WORK_TTL)
        return results

    def search_topics(self, query: str, *, per_page: int = 25) -> list[dict[str, Any]]:
        key = f"toposearch:{query}:{per_page}"
        cached = _get_cached(key)
        if cached is not None:
            return cached
        try:
            data = _request("/topics", {
                "search": query, "per-page": per_page,
                "select": "id,display_name,works_count,subfield,field",
            })
        except httpx.HTTPError:
            return []
        results = data.get("results") or []
        _put_cached(key, results, SEARCH_TTL)
        return results
