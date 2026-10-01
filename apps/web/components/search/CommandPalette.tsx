"use client";
// ⌘K palette (wireframes 2b / 2k): canvas search, OpenAlex search → Add, actions.
// Previews — nothing lands on the board until you add it (PRD §18).
import { useEffect, useRef, useState } from "react";
import type { PaperPreview } from "@atlas/types";
import { api } from "../../lib/api";
import type { NodeData } from "../../lib/store";
import type { Node } from "reactflow";

export type PaletteAction = { id: string; label: string; run: () => void };

export function CommandPalette({ nodes, actions, onFocusNode, onAdd, onClose, initialQuery = "" }: {
  nodes: Node<NodeData>[];
  actions: PaletteAction[];
  onFocusNode: (id: string) => void;
  onAdd: (p: PaperPreview) => Promise<void>;
  onClose: () => void;
  initialQuery?: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<PaperPreview[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [oaOnly, setOaOnly] = useState(false);
  const [recent, setRecent] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [limit, setLimit] = useState(10);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  // Debounced OpenAlex search.
  //
  // Two things kept half-relevant papers flashing in front of the user: the
  // debounce fired while they were still typing, and a slow early request could
  // land after a fast later one and overwrite good results with stale ones.
  // The sequence guard drops any response that is not the newest request, and
  // previous results stay on screen while the next query runs rather than
  // clearing to an empty list.
  const seq = useRef(0);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); setState("idle"); seq.current++; return; }
    setState("loading");
    const mine = ++seq.current;
    const t = setTimeout(() => {
      api.search(term, limit)
        .then((r) => {
          if (mine !== seq.current) return; // a newer query has already been issued
          setResults(r.results);
          setState("idle");
        })
        .catch(() => { if (mine === seq.current) setState("error"); });
    }, 420);
    return () => clearTimeout(t);
  }, [q, limit]);

  const term = q.trim().toLowerCase();
  const local = term ? nodes.filter((n) => n.type !== "suggestion" && (n.data.object.title ?? "").toLowerCase().includes(term)).slice(0, 5) : [];
  const cutoff = new Date().getFullYear() - 5;
  const remote = results.filter((p) => (!oaOnly || p.hasPdf) && (!recent || (p.year ?? 0) >= cutoff));
  const onCanvas = new Set(nodes.map((n) => n.data.paper?.openalexId).filter(Boolean));
  const acts = actions.filter((a) => !term || a.label.toLowerCase().includes(term));

  async function add(p: PaperPreview) {
    setAdding(p.openalexId);
    try { await onAdd(p); } finally { setAdding(null); }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette popover" role="dialog" aria-label="Search">
        <div className="palette-input">
          <span className="muted">⌕</span>
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this canvas, OpenAlex, or type an action…" aria-label="Search" />
          {state === "loading" && <span className="spinner" />}
        </div>
        <div className="palette-filters">
          <div className="grow" />
          <button className={`chip click${oaOnly ? " solid" : ""}`} aria-pressed={oaOnly} onClick={() => setOaOnly(!oaOnly)}>OA only</button>
          <button className={`chip click${recent ? " solid" : ""}`} aria-pressed={recent} onClick={() => setRecent(!recent)}>{cutoff}+</button>
        </div>
        <div className="palette-body">
          {local.length > 0 && (
            <>
              <div className="eyebrow">On this canvas</div>
              {local.map((n) => (
                <button key={n.id} className="result" style={{ width: "100%", textAlign: "left" }} onClick={() => { onFocusNode(n.id); onClose(); }}>
                  <span className="muted" style={{ fontSize: 11 }}>{glyph(n.type)}</span>
                  <div className="body"><div className="title">{n.data.object.title}</div></div>
                </button>
              ))}
            </>
          )}
          {(remote.length > 0 || state === "error" || (term.length >= 2 && state === "idle")) && <div className="eyebrow">OpenAlex</div>}
          {state === "error" && <div className="empty">Search failed — is the API running?</div>}
          {term.length >= 2 && state === "idle" && remote.length === 0 && <div className="empty">No papers match.</div>}
          {remote.map((p) => (
            <div key={p.openalexId} className="result">
              <span className="muted" style={{ fontSize: 11 }}>◇</span>
              <div className="body">
                <div className="title">{p.title}</div>
                <div className="sub">{p.authors.slice(0, 3).join(", ")}{p.authors.length > 3 ? " et al." : ""}{p.venue ? ` · ${p.venue}` : ""}</div>
                <div className="node-chips" style={{ marginTop: 6 }}>
                  {p.year && <span className="chip">{p.year}</span>}
                  <span className="chip">{p.citedByCount.toLocaleString()}</span>
                  {p.hasPdf && <span className="chip accent">OA</span>}
                </div>
              </div>
              {onCanvas.has(p.openalexId) ? (
                <span className="hint">On canvas</span>
              ) : (
                <button className="btn primary sm" disabled={adding !== null} onClick={() => add(p)}>{adding === p.openalexId ? "Adding…" : "Add"}</button>
              )}
            </div>
          ))}
          {acts.length > 0 && (
            <>
              <div className="eyebrow">Actions</div>
              {acts.map((a) => (
                <button key={a.id} className="menu-item" onClick={() => { a.run(); onClose(); }}>{a.label}</button>
              ))}
            </>
          )}
        </div>
        {remote.length >= limit && state !== "loading" && (
          <div className="palette-foot">
            <button className="chip click" onClick={() => setLimit((n) => n + 10)}>Show more</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function glyph(type?: string) {
  return { paper: "▭", pdf: "▤", note: "✎", excerpt: "❝", ai: "✦", thread: "◌", group: "▣", suggestion: "◌" }[type ?? ""] ?? "•";
}
