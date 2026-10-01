"use client";
// Interest picker (PRD §12 topic hierarchy). Tags come from OpenAlex's own
// classification rather than a hand-written list, so they match the corpus the
// recommendations are drawn from. It expands a level at a time — showing every
// tag at once would be unusable — and searching jumps straight to a topic.
// Children are spliced inline right after their parent chip, so the whole tree
// is one wrapping row of chips: field → subfield → topic.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { ChevronDownIcon } from "./canvas/Icons";

// OpenAlex's hierarchy below a field; a topic is a leaf.
const CHILD_LEVEL = ["subfield", "topic"];
// A subfield can hold ~100 topics; the rest sit behind a "+N more" chip.
const FIRST = 15;

export type Topic = { id: string; name: string; worksCount: number; parent?: string | null };

const KEY = "atlas.interests";

export function readInterests(): Topic[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
export function saveInterests(t: Topic[]) {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* private mode */ }
}
export function hasOnboarded() {
  try { return localStorage.getItem(KEY) !== null; } catch { return true; }
}

// Search + the expandable tree. Shared by first-run onboarding and Settings.
export function TopicPicker({ picked, onChange }: { picked: Topic[]; onChange: (p: Topic[]) => void }) {
  const [fields, setFields] = useState<Topic[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [more, setMore] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Record<string, Topic[]>>({});
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Topic[]>([]);
  // A failed load used to leave an empty dialog that looked like a broken feature.
  const [error, setError] = useState<string | null>(null);

  const loadFields = useCallback(() => {
    setError(null);
    api.topics().then((r) => setFields(r.items))
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(loadFields, [loadFields]);

  // Search runs against topics directly, for people who know the term already.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) { setHits([]); return; }
    let dead = false;
    const t = setTimeout(() => {
      api.topics({ q: term }).then((r) => { if (!dead) setHits(r.items); }).catch(() => {});
    }, 300);
    return () => { dead = true; clearTimeout(t); };
  }, [q]);

  const flip = (s: Set<string>, id: string, on: boolean) => {
    const n = new Set(s);
    if (on) n.add(id); else n.delete(id);
    return n;
  };

  const expand = async (t: Topic, depth: number) => {
    const isOpen = open.has(t.id);
    setOpen((s) => flip(s, t.id, !isOpen));
    if (isOpen || children[t.id]) return;
    setLoading((s) => flip(s, t.id, true));
    try {
      const r = await api.topics({ level: CHILD_LEVEL[depth], parent: t.id });
      setChildren((c) => ({ ...c, [t.id]: r.items }));
    } catch {
      setOpen((s) => flip(s, t.id, false)); // let the next click retry
    } finally {
      setLoading((s) => flip(s, t.id, false));
    }
  };

  const isPicked = (t: Topic) => picked.some((x) => x.id === t.id);
  const toggle = (t: Topic) => onChange(isPicked(t) ? picked.filter((x) => x.id !== t.id) : [...picked, t]);

  // One chip, followed by its children when open (recursively).
  const chip = (t: Topic, depth: number): ReactNode[] => {
    const isOpen = open.has(t.id);
    const kids = isOpen ? children[t.id] ?? [] : [];
    const shown = more.has(t.id) ? kids : kids.slice(0, FIRST);
    return [
      <span key={t.id} className={`tag split d${depth}${isPicked(t) ? " on" : ""}${isOpen ? " open" : ""}`}>
        <button className="tag-body" aria-pressed={isPicked(t)} onClick={() => toggle(t)}>{t.name}</button>
        {depth < CHILD_LEVEL.length && (
          <button className="tag-caret" aria-expanded={isOpen} aria-label={`Show topics in ${t.name}`}
            onClick={() => expand(t, depth)}>
            <ChevronDownIcon />
          </button>
        )}
      </span>,
      ...(loading.has(t.id) ? [<span key={`${t.id}:…`} className="hint tag-loading">Loading…</span>] : []),
      ...shown.flatMap((c) => chip(c, depth + 1)),
      ...(kids.length > shown.length ? [
        <button key={`${t.id}:more`} className={`tag more d${depth + 1}`} onClick={() => setMore((s) => flip(s, t.id, true))}>
          +{kids.length - shown.length} more
        </button>,
      ] : []),
    ];
  };

  return (
    <>
      <input className="field onboard-search" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Search topics" aria-label="Search topics" />

      <div className="onboard-body">
        {error && (
          <p className="hint" role="alert">
            Couldn't load topics: {error}{" "}
            <button className="btn" onClick={loadFields}>Retry</button>
          </p>
        )}
        {hits.length > 0 ? (
          <div className="tagwrap">
            {hits.map((t) => (
              <button key={t.id} className={`tag${isPicked(t) ? " on" : ""}`} onClick={() => toggle(t)}>
                {t.name}{t.parent ? <span className="tag-sub">{t.parent}</span> : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="tagwrap">{fields.flatMap((f) => chip(f, 0))}</div>
        )}
      </div>
    </>
  );
}

export function Onboarding({ onDone }: { onDone: (picked: Topic[]) => void }) {
  const [picked, setPicked] = useState<Topic[]>([]);
  const finish = (p: Topic[]) => { saveInterests(p); onDone(p); };

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Choose your interests">
      <div className="onboard" onMouseDown={(e) => e.stopPropagation()}>
        <div className="onboard-head">
          <h2>What are you interested in?</h2>
          <p>Selected topics help curate recommendations.</p>
        </div>
        <TopicPicker picked={picked} onChange={setPicked} />
        <div className="onboard-foot">
          <span className="hint">{picked.length} selected</span>
          <div className="grow" />
          <button className="btn" onClick={() => finish([])}>Skip</button>
          <button className="btn primary" disabled={picked.length === 0} onClick={() => finish(picked)}>Continue</button>
        </div>
      </div>
    </div>
  );
}
