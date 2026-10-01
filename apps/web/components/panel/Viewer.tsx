"use client";
// Expanded object viewer in the docked panel (wireframe 2f) with the text
// selection menu (2g). Selecting text anywhere in the body shows
// Capture / AI / Research actions; the selection's source object + offsets
// travel with the action so excerpts keep provenance.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import type { PaperPreview } from "@atlas/types";
import type { Node } from "reactflow";
import type { NodeData } from "../../lib/store";

export type Selection = { text: string; objectId: string; start: number; end: number };
export type SelectionAction = "highlight" | "note" | "explain" | "summarize" | "ask" | "related" | "supporting" | "contradicting" | "wiki";

const TABS = ["Abstract", "References", "Cited by", "Topics"] as const;

export function Viewer({ node, edges, pdfUrl, onSelectionAction, onAction }: {
  node: Node<NodeData>;
  edges: { label: string; title: string; id: string }[];
  pdfUrl?: string;
  onSelectionAction: (a: SelectionAction, s: Selection) => void;
  onAction: (a: "broader" | "deeper" | "explain" | "chat" | "supporting" | "contradicting") => void;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Abstract");
  const [cites, setCites] = useState<{ loading: boolean; items: PaperPreview[] }>({ loading: false, items: [] });
  type Span = { term: string; start: number; end: number; title: string; url: string };
  const [spans, setSpans] = useState<Span[]>([]);
  const [preview, setPreview] = useState<{ title: string; extract: string; url: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; sel: Selection } | null>(null);
  const o = node.data.object;
  const p = node.data.paper;
  const body = String(o.content.abstract ?? o.content.text ?? "");

  // References and Cited by come from OpenAlex on demand — only when the tab is
  // opened, so switching objects costs nothing (PRD §12: fetch what is touched).
  useEffect(() => {
    const dir = tab === "References" ? "out" : tab === "Cited by" ? "in" : null;
    if (!dir || !p) { setCites({ loading: false, items: [] }); return; }
    let cancelled = false;
    setCites({ loading: true, items: [] });
    api.citations(o.id, dir, 25)
      .then((r) => { if (!cancelled) setCites({ loading: false, items: r.results }); })
      .catch(() => { if (!cancelled) setCites({ loading: false, items: [] }); });
    return () => { cancelled = true; };
  }, [tab, o.id, p]);

  // Concept links (PRD §11): resolved server-side from the work's own keywords,
  // so only meaningful technical phrases become links — not every noun.
  useEffect(() => {
    if (!body) { setSpans([]); return; }
    let cancelled = false;
    api.concepts(o.id)
      .then((r) => { if (!cancelled) setSpans(r.spans ?? []); })
      .catch(() => { if (!cancelled) setSpans([]); });
    return () => { cancelled = true; };
  }, [o.id, body]);

  const openConcept = useCallback((title: string) => {
    setPreview({ title, extract: "Loading…", url: "" });
    api.conceptSummary(title).then(setPreview).catch(() => setPreview(null));
  }, []);

  // Split the text around the resolved spans, leaving the prose intact.
  const withConcepts = useCallback((para: string, offset: number) => {
    const hits = spans.filter((sp) => sp.start >= offset && sp.end <= offset + para.length);
    if (!hits.length) return para;
    const out: ReactNode[] = [];
    let cursor = 0;
    for (const sp of hits) {
      const s0 = sp.start - offset, e0 = sp.end - offset;
      if (s0 < cursor) continue;
      out.push(para.slice(cursor, s0));
      out.push(
        <button key={`${sp.start}-${sp.title}`} className="concept" onClick={() => openConcept(sp.title)} title={`Wikipedia: ${sp.title}`}>
          {para.slice(s0, e0)}
        </button>,
      );
      cursor = e0;
    }
    out.push(para.slice(cursor));
    return out;
  }, [spans, openConcept]);

  const onMouseUp = useCallback(() => {
    const s = window.getSelection();
    const text = s?.toString().trim() ?? "";
    if (!s || !text || s.rangeCount === 0) return setMenu(null);
    const r = s.getRangeAt(0).getBoundingClientRect();
    const start = body.indexOf(text);
    setMenu({ x: Math.min(r.left, window.innerWidth - 200), y: r.bottom + 6, sel: { text, objectId: o.id, start, end: start + text.length } });
  }, [body, o.id]);

  useEffect(() => {
    const off = () => setMenu(null); // any new mousedown starts a new selection (the menu itself swallows its mousedown)
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, []);

  const act = (a: SelectionAction) => { if (menu) onSelectionAction(a, menu.sel); setMenu(null); window.getSelection()?.removeAllRanges(); };

  return (
    <div className="stack" style={{ height: "100%" }}>
      <div className="viewer-head">
        <div className="eyebrow">{p ? "OpenAlex work" : node.type}</div>
        <div className="viewer-title">{o.title}</div>
        {p && (
          <div className="viewer-meta">{p.authors.join(", ")}{p.venue ? ` · ${p.venue}` : ""}{p.year ? ` · ${p.year}` : ""}</div>
        )}
        <div className="node-chips" style={{ marginBottom: 10 }}>
          {p?.year && <span className="chip">{p.year}</span>}
          {p && <span className="chip">{p.citedByCount.toLocaleString()} citations</span>}
          {p?.hasPdf && <span className="chip accent">OA · PDF</span>}
          {o.createdBy === "AI" && <span className="chip accent">AI-generated</span>}
        </div>
      </div>
      {p && (
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t} role="tab" className="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
      )}
      <div className="panel-body" onMouseUp={onMouseUp}>
        {node.type === "pdf" ? (
          pdfUrl ? <iframe className="reader-frame" src={pdfUrl} title={o.title ?? "PDF"} /> : (
            <div className="reader-placeholder">This PDF’s bytes aren’t stored yet.<br />Re-upload it to read in this session.</div>
          )
        ) : tab === "Topics" && p ? (
          <div className="node-chips" style={{ padding: "12px 14px" }}>
            {[...(o.content.topics as string[] ?? []), ...(o.content.keywords as string[] ?? [])].length === 0
              ? <div className="empty">No topics on this work.</div>
              : [...new Set([...(o.content.topics as string[] ?? []), ...(o.content.keywords as string[] ?? [])])]
                  .map((t) => <span key={t} className="chip">{t}</span>)}
          </div>
        ) : (tab === "References" || tab === "Cited by") && p ? (
          cites.loading ? <div className="empty">Loading {tab.toLowerCase()}…</div>
            : cites.items.length === 0 ? <div className="empty">None</div>
            : (
              <ul className="citelist">
                {cites.items.map((c) => (
                  <li key={c.openalexId}>
                    <div className="citetitle">{c.title}</div>
                    <div className="citemeta">
                      {c.authors.slice(0, 3).join(", ")}
                      {c.year ? ` · ${c.year}` : ""}
                      {` · ${c.citedByCount.toLocaleString()} citations`}
                    </div>
                  </li>
                ))}
              </ul>
            )
        ) : body ? (
          <div className="viewer-body">
            {(() => {
              let off = 0;
              return body.split(/\n{2,}/).map((para, i) => {
                const start = off;
                off += para.length + 2;
                return <p key={i}>{withConcepts(para, start)}</p>;
              });
            })()}
          </div>
        ) : (
          <div className="empty">{p ? "No abstract" : "Nothing to read"}</div>
        )}
        {edges.length > 0 && (
          <dl className="kv">
            <dt>Links</dt>
            <dd>{edges.map((e) => <div key={e.id}><span className="muted">{e.label}</span> {e.title}</div>)}</dd>
          </dl>
        )}
      </div>
      <div className="viewer-actions">
        {p && <button className="btn" onClick={() => onAction("broader")}>Broader</button>}
        {p && <button className="btn" onClick={() => onAction("deeper")}>Deeper</button>}
        {p && <button className="btn" onClick={() => onAction("supporting")}>Supporting</button>}
        {p && <button className="btn" onClick={() => onAction("contradicting")}>Contradicting</button>}
        <button className="btn" onClick={() => onAction("explain")}>Explain</button>
        <button className="btn primary" onClick={() => onAction("chat")}>Chat about this</button>
      </div>
      {preview && (
        <div className="concept-card popover" onMouseDown={(e) => e.stopPropagation()}>
          <div className="concept-head">
            <b>{preview.title}</b>
            <button className="btn" onClick={() => setPreview(null)} aria-label="Close">✕</button>
          </div>
          <p>{preview.extract}</p>
          <div className="group">
            {preview.url && <a className="chip click" href={preview.url} target="_blank" rel="noreferrer">Read on Wikipedia</a>}
            <button className="chip click solid" onClick={() => { onSelectionAction("wiki", { text: preview.title, objectId: o.id, start: 0, end: 0 }); setPreview(null); }}>Add to canvas</button>
          </div>
        </div>
      )}
      {menu && (
        <div className="selmenu popover" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.preventDefault()}>
          <div className="eyebrow">Capture</div>
          <div className="group">
            <button className="chip click" onClick={() => act("highlight")}>Highlight</button>
            <button className="chip click" onClick={() => act("note")}>Add note</button>
          </div>
          <div className="eyebrow">AI</div>
          <div className="group">
            <button className="chip click" onClick={() => act("explain")}>Explain</button>
            <button className="chip click" onClick={() => act("summarize")}>Summarize</button>
            <button className="chip click" onClick={() => act("ask")}>Ask</button>
          </div>
          <div className="eyebrow">Research</div>
          <div className="group">
            <button className="chip click solid" onClick={() => act("related")}>Related</button>
            <button className="chip click" onClick={() => act("supporting")}>Supporting</button>
            <button className="chip click" onClick={() => act("contradicting")}>Contradicting</button>
          </div>
        </div>
      )}
    </div>
  );
}
