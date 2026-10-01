"use client";
// Canvas shell (wireframe 2a): left rail · top bar · board with tool palette,
// chat bar and minimap · docked right panel (Objects / Details / Chat).
// Every board mutation goes through `update` (autosave + undo/redo); anything
// that creates a persistent object or edge also hits the API so ids are stable.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background, BackgroundVariant, ConnectionMode, MarkerType, MiniMap, SelectionMode, applyEdgeChanges, applyNodeChanges, useReactFlow,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type Viewport,
} from "reactflow";
import "reactflow/dist/style.css";
import type { CanvasObject, CitationDirection, PaperPreview, Recommendation, RecommendMode } from "@atlas/types";
import { api } from "../../lib/api";
import { bbox, fanOut, NODE_H, NODE_W } from "../../lib/layout";
import { isSuppressed, uid, useCanvasDoc, type ChatMessage, type EdgeData, type NodeData, type NodeKind } from "../../lib/store";
import { Sidebar } from "../Sidebar";
import { BoardActionsContext, type BoardActions } from "./actions";
import { MicIcon, ArrowIcon, BiArrowIcon, CursorIcon, EmbedIcon, FileIcon, GroupIcon, HandIcon, HelpIcon, LineIcon, PaperIcon, PlusIcon, SparkIcon, StickyIcon, TextIcon, ThreadIcon, WikiIcon } from "./Icons";
import { Help } from "./Help";
import { Dock } from "./Dock";
import { Lightbox } from "../panel/Lightbox";
import { EmptyState } from "./EmptyState";
import { PaperNode } from "../nodes/PaperNode";
import { SuggestionNode } from "../nodes/SuggestionNode";
import { AiNoteNode } from "../nodes/AiNoteNode";
import { ExcerptNode, GroupNode, NoteNode, PdfNode, ThreadNode } from "../nodes/TextNodes";
import { AudioNode, DocNode, EmbedNode, ImageNode, VideoNode } from "../nodes/MediaNodes";
import { ContextMenu, type MenuAction } from "../menu/ContextMenu";
import { CommandPalette, type PaletteAction } from "../search/CommandPalette";
import { SidePanel, type PanelTab } from "../panel/SidePanel";
import { Viewer, type Selection, type SelectionAction } from "../panel/Viewer";
import { ChatPanel } from "../panel/ChatPanel";

const nodeTypes = { paper: PaperNode, suggestion: SuggestionNode, ai: AiNoteNode, note: NoteNode, excerpt: ExcerptNode, thread: ThreadNode, pdf: PdfNode, group: GroupNode, image: ImageNode, video: VideoNode, audio: AudioNode, doc: DocNode, embed: EmbedNode };

// ponytail: uploaded PDF bytes live in memory for the session only — there is
// no upload endpoint yet. Cards persist; re-upload to read after a reload.
const pdfBlobs = new Map<string, string>();

// Object type -> the node component that knows how to show it.
function kindFor(t: CanvasObject["objectType"]): NodeKind {
  switch (t) {
    case "EMBED": return "embed";
    case "IMAGE": return "image";
    case "VIDEO": return "video";
    case "AUDIO": return "audio";
    case "PDF": return "pdf";
    case "PAPER": return "paper";
    case "AI_SUMMARY": return "ai";
    case "EXCERPT": return "excerpt";
    case "NOTE": return "note";
    default: return "doc";
  }
}

function mkObject(canvasId: string, objectType: CanvasObject["objectType"], title: string | null, content: Record<string, unknown>, x: number, y: number, createdBy: "USER" | "AI" = "USER"): CanvasObject {
  return { id: uid(), canvasId, objectType, sourceEntityId: null, title, content, x, y, createdBy };
}
function toNode(kind: NodeKind, object: CanvasObject, extra: Partial<NodeData> = {}, style?: Node["style"]): Node<NodeData> {
  return { id: object.id, type: kind, position: { x: object.x, y: object.y }, data: { object, ...extra }, style };
}
function toEdge(id: string, source: string, target: string, edgeType: EdgeData["edgeType"], provenance: EdgeData["provenance"], ghost = false): Edge<EdgeData> {
  return { id, source, target, data: { edgeType, provenance }, className: ghost ? "ghost" : undefined, markerEnd: { type: MarkerType.Arrow, width: 16, height: 16, color: ghost ? "#9ec8f5" : "#c7c7cc" } };
}
type Connector = "line" | "arrow" | "biarrow";
// How a drawn link looks for each line tool.
function connectorStyle(c: Connector): Partial<Edge> {
  const head = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#c7c7cc" };
  return { type: c === "line" ? "straight" : "default", markerEnd: c === "line" ? undefined : head, markerStart: c === "biarrow" ? head : undefined };
}
// The board never gets narrower than this; side panels give way first.
const MIN_BOARD = 480;
const kindOf = (o: CanvasObject): NodeKind => (o.objectType === "AI_SUMMARY" ? "ai" : o.content.filename ? "pdf" : (o.objectType.toLowerCase() as NodeKind));

export function CanvasShell({ id }: { id: string }) {
  const { doc, saved, update, undo, redo } = useCanvasDoc(id);
  const flow = useReactFlow();
  const [zoom, setZoom] = useState(1);
  const [tab, setTab] = useState<PanelTab>("Objects");
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelW, setPanelW] = useState(300);
  const [railOpen, setRailOpen] = useState(true);
  const [railW, setRailW] = useState(216);
  // Connector style for new links: straight line, one-sided curved arrow, or
  // two-sided. Applied to edges the user draws.
  const [connector, setConnector] = useState<Connector>("arrow");
  const boardRef = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);
  // Interim speech, shown grey above the field until it is committed.
  const [partial, setPartial] = useState("");
  // "group" is select with intent: the next selection is offered as a group.
  // "connect" draws links in the current connector style from anywhere on a node.
  const [tool, setTool] = useState<"select" | "pan" | "group" | "connect">("select");
  const [winW, setWinW] = useState(1440);
  // Marquee direction: left→right selects only what is fully enclosed,
  // right→left anything the box touches (the CAD convention).
  const [crossing, setCrossing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [palette, setPalette] = useState<{ open: boolean; query?: string }>({ open: false });
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const offsets = useRef<Record<string, number>>({}); // "anchor:mode" -> next offset for Show more

  const say = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(null), 2400); }, []);
  const fail = useCallback((what: string) => (e: unknown) => { console.error(e); say(`${what} failed — is the API running?`); }, [say]);

  const nodes = useMemo(() => doc?.nodes ?? [], [doc]);
  const edges = useMemo(() => doc?.edges ?? [], [doc]);
  const selected = useMemo(() => nodes.filter((n) => n.selected && n.type !== "suggestion"), [nodes]);
  const selectedIds = useMemo(() => new Set(selected.map((n) => n.id)), [selected]);
  const byId = useCallback((nid: string) => nodes.find((n) => n.id === nid), [nodes]);
  const detail = detailId ? byId(detailId) : selected.length === 1 ? selected[0] : undefined;

  // ---- viewport / zoom ----
  useEffect(() => {
    if (!doc) return;
    if (doc.viewport) { flow.setViewport(doc.viewport); setZoom(doc.viewport.zoom); }
    else if (doc.nodes.length) setTimeout(() => flow.fitView({ padding: 0.3 }), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Never hijack "?" while the user is writing a note or a question.
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "?") { e.preventDefault(); setHelpOpen(true); }
      if (e.key === "Escape") setTool("select");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const onMoveEnd = useCallback((_: unknown, vp: Viewport) => { setZoom(vp.zoom); update((d) => ({ ...d, viewport: vp }), false); }, [update]);
  const focusNode = useCallback((nid: string) => {
    flow.fitView({ nodes: [{ id: nid }], duration: 400, maxZoom: 1.2, padding: 0.5 });
    update((d) => ({ ...d, nodes: d.nodes.map((n) => ({ ...n, selected: n.id === nid })) }), false);
  }, [flow, update]);
  const centre = useCallback(() => {
    const el = document.querySelector(".board") as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return flow.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? 800) / 2 - NODE_W / 2, y: (r?.top ?? 0) + (r?.height ?? 600) / 2 - NODE_H / 2 });
  }, [flow]);

  // A canvas started from a suggestion carries the paper in the url, so it
  // opens with that paper already on the board.
  useEffect(() => {
    if (seeded.current || !doc) return;
    const wanted = new URLSearchParams(window.location.search).get("add");
    if (!wanted) return;
    seeded.current = true;
    (async () => {
      try {
        const pos = centre();
        const { object } = await api.addObject({
          canvasId: doc.id, objectType: "PAPER", openalexId: wanted,
          content: { openalexId: wanted }, x: pos.x, y: pos.y,
        });
        update((d) => ({ ...d, nodes: [...d.nodes, toNode("paper", object)] }));
        window.history.replaceState({}, "", window.location.pathname);
      } catch { /* the board still opens, just empty */ }
    })();
  }, [doc, centre, update]);

  const onSelectionStart = useCallback((e: React.MouseEvent) => {
    const startX = e.clientX;
    const move = (m: MouseEvent) => setCrossing(m.clientX < startX);
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); setCrossing(false); };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }, []);

  useEffect(() => {
    // clientWidth, not innerWidth: the latter can grow with the shell's own
    // min-width. The observer catches sizes a resize event reports too early.
    const html = document.documentElement;
    const measure = () => setWinW(html.clientWidth);
    const ro = new ResizeObserver(measure);
    measure();
    ro.observe(html);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  // The board gets its minimum width first. As the window narrows the rail
  // hides, then the right panel; both come back once there is room again —
  // unless the user closed them.
  const railAutoHidden = useRef(false);
  const panelAutoHidden = useRef(false);
  useEffect(() => {
    const fits = winW >= MIN_BOARD + panelW;
    if (!fits && panelOpen) { panelAutoHidden.current = true; setPanelOpen(false); }
    else if (fits && panelAutoHidden.current) { panelAutoHidden.current = false; setPanelOpen(true); }
    // Only on resize: a panel the user opens in a narrow window floats instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winW]);
  useEffect(() => {
    const fits = winW >= MIN_BOARD + railW + (panelOpen || panelAutoHidden.current ? panelW : 0);
    if (!fits && railOpen) { railAutoHidden.current = true; setRailOpen(false); }
    else if (fits && railAutoHidden.current) { railAutoHidden.current = false; setRailOpen(true); }
    // Opening the right panel also makes room by tucking the rail away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winW, panelOpen]);

  // ---- React Flow change plumbing ----
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const undoable = changes.some((c) => c.type === "remove");
    update((d) => {
      const removed = new Set(changes.filter((c) => c.type === "remove").map((c) => (c as { id: string }).id));
      return { ...d, nodes: applyNodeChanges(changes, d.nodes) as Node<NodeData>[], edges: d.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)) };
    }, undoable);
  }, [update]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    update((d) => ({ ...d, edges: applyEdgeChanges(changes, d.edges) as Edge<EdgeData>[] }), changes.some((c) => c.type === "remove"));
  }, [update]);
  const onNodeDragStart = useCallback(() => update((d) => d), [update]); // snapshot for undo
  const onConnect = useCallback((c: Connection) => {
    if (!doc || !c.source || !c.target) return;
    const { source, target } = c;
    api.addEdge({ canvasId: doc.id, sourceObjectId: source, targetObjectId: target, edgeType: "RELATED_TO" })
      .then(({ edge }) => update((d) => ({ ...d, edges: [...d.edges, { ...toEdge(edge.id, source, target, "RELATED_TO", "USER"), ...connectorStyle(connector) }] })))
      .catch(fail("Linking"));
  }, [doc, update, fail, connector]);

  // ---- creating things ----
  const addPaper = useCallback(async (p: PaperPreview, at?: { x: number; y: number }) => {
    if (!doc) return;
    const pos = at ?? centre();
    const { object } = await api.addObject({ canvasId: doc.id, objectType: "PAPER", openalexId: p.openalexId, title: p.title, content: { openalexId: p.openalexId }, x: pos.x, y: pos.y });
    update((d) => ({ ...d, nodes: [...d.nodes, toNode("paper", object, { paper: p })] }));
    return object;
  }, [doc, centre, update]);

  const addLocal = useCallback((kind: NodeKind, object: CanvasObject, extra: Partial<NodeData> = {}, style?: Node["style"]) => {
    update((d) => ({ ...d, nodes: [...d.nodes, toNode(kind, object, extra, style)] }));
  }, [update]);

  const addNote = useCallback(async (text = "", at?: { x: number; y: number }, linkFrom?: string, variant: "sticky" | "text" = "sticky") => {
    if (!doc) return;
    const pos = at ?? centre();
    // Sticky notes get a pastel from a fixed rotation so a board of them still
    // reads as one palette rather than confetti.
    const palette = ["butter", "mint", "sky", "blush", "lilac"] as const;
    const color = palette[(doc.nodes.length + palette.length) % palette.length];
    const { object } = await api.addObject({ canvasId: doc.id, objectType: "NOTE", content: { text, variant, color }, x: pos.x, y: pos.y });
    let edge: Edge<EdgeData> | null = null;
    if (linkFrom) {
      const { edge: e } = await api.addEdge({ canvasId: doc.id, sourceObjectId: linkFrom, targetObjectId: object.id, edgeType: "DERIVED_FROM" });
      edge = toEdge(e.id, linkFrom, object.id, "NOTE_ON", "USER");
    }
    update((d) => ({ ...d, nodes: [...d.nodes, toNode("note", object)], edges: edge ? [...d.edges, edge] : d.edges }));
    return object;
  }, [doc, centre, update]);

  const addExcerpt = useCallback(async (sel: Selection) => {
    if (!doc) return;
    const src = byId(sel.objectId);
    const [pos] = src ? fanOut(src, 1, "down", nodes) : [centre()];
    const content = { text: sel.text, sourceObjectId: sel.objectId, textStart: sel.start, textEnd: sel.end, normalizedQuote: sel.text.replace(/\s+/g, " ").trim(), createdFromSelection: true };
    const { object } = await api.addObject({ canvasId: doc.id, objectType: "EXCERPT", content, x: pos.x, y: pos.y });
    const { edge } = await api.addEdge({ canvasId: doc.id, sourceObjectId: sel.objectId, targetObjectId: object.id, edgeType: "DERIVED_FROM" });
    update((d) => ({ ...d, nodes: [...d.nodes, toNode("excerpt", object)], edges: [...d.edges, toEdge(edge.id, sel.objectId, object.id, "EXCERPT_OF", "USER")] }));
    return object;
  }, [doc, byId, nodes, centre, update]);

  const explain = useCallback(async (sourceId: string, text?: string, title = "Explanation") => {
    if (!doc) return;
    const src = byId(sourceId);
    const [pos] = src ? fanOut(src, 1, "down", nodes) : [centre()];
    const { object, edge } = await api.explain({ canvasId: doc.id, objectId: sourceId, text: text ?? String(src?.data.object.content.text ?? src?.data.object.title ?? "") });
    const placed = { ...object, title: object.title ?? title, x: pos.x, y: pos.y, content: { ...object.content, prompt: title, sourceObjectIds: [sourceId], createdAt: Date.now() } };
    update((d) => ({ ...d, nodes: [...d.nodes, toNode("ai", placed)], edges: [...d.edges, toEdge(edge.id, sourceId, placed.id, "EXPLAINS", "AI")] }));
    return placed;
  }, [doc, byId, nodes, centre, update]);

  // ---- recommendations & citations (PRD §13/§25) ----
  // One placement path for every kind of candidate: Broader/Deeper, references,
  // cited-by and related all appear as the same translucent preview nodes with
  // accept/reject, so accepting works identically whatever produced them.
  const placeGhosts = useCallback((anchorId: string, anchor: Node<NodeData>, mode: RecommendMode, fresh: Recommendation[]) => {
    const ghostIds: string[] = [];
    update((d) => {
      const keep = (n: Node<NodeData>) => !(n.type === "suggestion" && n.data.suggestion?.anchorId === anchorId && n.data.suggestion.mode === mode);
      const base = d.nodes.filter(keep);
      const spots = fanOut(anchor, fresh.length, mode === "broader" ? "left" : "right", base, 190, 130);
      const ghosts = fresh.map((r, i) => toNode("suggestion", mkObject(d.id, "PAPER", r.paper.title, { index: i, openalexId: r.paper.openalexId }, spots[i].x, spots[i].y, "AI"), { suggestion: { ...r, anchorId } }));
      ghostIds.push(...ghosts.map((g) => g.id));
      const ghostEdges = ghosts.map((g) => (mode === "broader" ? toEdge(`g-${g.id}`, g.id, anchorId, "RELATED_TO", "AI", true) : toEdge(`g-${g.id}`, anchorId, g.id, "RELATED_TO", "AI", true)));
      const dropped = new Set(d.nodes.filter((n) => !keep(n)).map((n) => n.id));
      return { ...d, nodes: [...base, ...ghosts], edges: [...d.edges.filter((e) => !dropped.has(e.source) && !dropped.has(e.target)), ...ghostEdges] };
    });
    if (!ghostIds.length) return false;
    // Candidates fan out beyond the current viewport, so bring the anchor and
    // its new candidates into view — otherwise the board looks unchanged.
    // Two frames: React Flow measures freshly added nodes on the next render,
    // and fitView computes bounds from those measurements, so fitting any
    // sooner uses zero-sized nodes and cuts the candidates off.
    requestAnimationFrame(() => requestAnimationFrame(() => flow.fitView({
      nodes: [{ id: anchorId }, ...ghostIds.map((gid) => ({ id: gid }))],
      padding: 0.28, duration: 400, maxZoom: 1,
    })));
    return true;
  }, [update, flow]);

  const recommend = useCallback(async (anchorId: string, mode: RecommendMode, more = false) => {
    if (!doc) return;
    const anchor = byId(anchorId);
    if (!anchor) return;
    const key = `${anchorId}:${mode}`;
    const offset = more ? offsets.current[key] ?? 0 : 0;
    try {
      const { recommendations } = await api.recommend({ objectId: anchorId, mode, offset });
      offsets.current[key] = offset + recommendations.length;
      const fresh = recommendations.filter((r) => !isSuppressed(doc, mode, r.paper.openalexId)).slice(0, 3);
      if (!placeGhosts(anchorId, anchor, mode, fresh)) {
        say("No new suggestions — everything is already on the canvas or was rejected.");
      }
    } catch (e) {
      fail("Recommend")(e);
    }
  }, [doc, byId, say, fail, placeGhosts]);

  const showStance = useCallback(async (anchorId: string, stance: "supporting" | "contradicting") => {
    if (!doc) return;
    const anchor = byId(anchorId);
    if (!anchor) return;
    try {
      const { recommendations } = await api.stance({ objectId: anchorId, stance });
      const fresh = recommendations.filter((r) => !isSuppressed(doc, "deeper", r.paper.openalexId)).slice(0, 3);
      if (!placeGhosts(anchorId, anchor, "deeper", fresh)) {
        say(`No ${stance} work found for this paper.`);
      }
    } catch (e) {
      fail("Stance")(e);
    }
  }, [doc, byId, say, fail, placeGhosts]);

  const showCitations = useCallback(async (anchorId: string, direction: CitationDirection) => {
    if (!doc) return;
    const anchor = byId(anchorId);
    if (!anchor) return;
    // References sit upstream (what this builds on); citing and related work
    // sits downstream — same spatial grammar as Broader/Deeper.
    const mode: RecommendMode = direction === "out" ? "broader" : "deeper";
    const label = direction === "out" ? "reference" : direction === "in" ? "cited by" : "related work";
    try {
      const { results } = await api.citations(anchorId, direction);
      const fresh: Recommendation[] = results
        .filter((paper) => !isSuppressed(doc, mode, paper.openalexId))
        .slice(0, 3)
        .map((paper) => ({
          paper, mode, relationshipLabel: label,
          reason: direction === "out"
            ? `cited by this paper${paper.year ? ` · ${paper.year}` : ""}`
            : direction === "in"
              ? `cites this paper · ${paper.citedByCount.toLocaleString()} citations`
              : "OpenAlex related work",
          score: 0,
        }));
      if (!placeGhosts(anchorId, anchor, mode, fresh)) {
        say(`No ${label} results — OpenAlex has none, or they are already on the canvas.`);
      }
    } catch (e) {
      fail("Citations")(e);
    }
  }, [doc, byId, say, fail, placeGhosts]);

  // Accepting is a network round trip, so a second click before it lands would
  // add the paper twice; and a candidate that is already on the board should
  // never be added again.
  const accepting = useRef<Set<string>>(new Set());

  const acceptSuggestion = useCallback(async (nid: string) => {
    const g = byId(nid);
    const s = g?.data.suggestion;
    if (!doc || !g || !s) return;
    if (accepting.current.has(nid)) return;

    const norm = (t?: string | null) => (t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const already = doc.nodes.some((n) =>
      n.type !== "suggestion" &&
      (n.data.paper?.openalexId === s.paper.openalexId ||
       (n.data.object.content.openalexId as string | undefined) === s.paper.openalexId ||
       (!!norm(n.data.object.title) && norm(n.data.object.title) === norm(s.paper.title))));
    if (already) {
      update((d) => ({
        ...d,
        nodes: d.nodes.filter((n) => n.id !== nid),
        edges: d.edges.filter((e) => e.source !== nid && e.target !== nid),
      }));
      return say("Already on this canvas.");
    }

    accepting.current.add(nid);
    try {
      const { object } = await api.addObject({ canvasId: doc.id, objectType: "PAPER", openalexId: s.paper.openalexId, title: s.paper.title, content: { openalexId: s.paper.openalexId, recommendedBy: s.anchorId, mode: s.mode, reason: s.reason }, x: g.position.x, y: g.position.y });
      const [src, tgt] = s.mode === "broader" ? [object.id, s.anchorId] : [s.anchorId, object.id];
      const { edge } = await api.addEdge({ canvasId: doc.id, sourceObjectId: src, targetObjectId: tgt, edgeType: "RELATED_TO" });
      update((d) => ({
        ...d,
        nodes: [...d.nodes.filter((n) => n.id !== nid), toNode("paper", object, { paper: s.paper })],
        edges: [...d.edges.filter((e) => e.source !== nid && e.target !== nid), { ...toEdge(edge.id, src, tgt, "RELATED_TO", "AI"), label: s.relationshipLabel, labelStyle: { fontSize: 10, fill: "var(--ink-4)" }, labelBgStyle: { fill: "var(--board)" } }],
      }));
    } catch (e) {
      fail("Accept")(e);
    } finally {
      accepting.current.delete(nid);
    }
  }, [doc, byId, update, fail, say]);

  const rejectSuggestion = useCallback((nid: string) => {
    const s = byId(nid)?.data.suggestion;
    if (!s || !doc) return;
    // Record the rejection server-side too, so it survives a different browser
    // and the recommender can exclude it before scoring (PRD §13.5).
    if (s.paper.openalexId) {
      void api.suppress({ canvasId: doc.id, mode: s.mode, openalexId: s.paper.openalexId }).catch(() => {});
    }
    update((d) => ({ ...d, rejected: [...d.rejected, `${s.mode}:${s.paper.openalexId}`], nodes: d.nodes.filter((n) => n.id !== nid), edges: d.edges.filter((e) => e.source !== nid && e.target !== nid) }));
  }, [byId, update, doc]);

  // ---- organize ----
  const groupSelection = useCallback(() => {
    if (!doc) return;
    if (selected.length < 2) {
      say("Select two or more objects to group them.");
      return;
    }
    const box = bbox(selected);
    const g = mkObject(doc.id, "NOTE", "Group", { kind: "group" }, box.x, box.y);
    update((d) => ({
      ...d,
      nodes: [
        toNode("group", g, {}, { width: box.w, height: box.h }),
        ...d.nodes.map((n) => (selectedIds.has(n.id) ? { ...n, parentNode: g.id, extent: "parent" as const, position: { x: n.position.x - box.x, y: n.position.y - box.y }, selected: false } : n)),
      ],
    }));
    setTool("select");
  }, [doc, selected, selectedIds, update, say]);

  // Compress: stack the selection into a pile of papers. Each card sits a few
  // pixels down-right of the one above so the ones underneath peek out and it
  // still reads as a group rather than one card. Ungrouped selections are
  // grouped first, so compress always produces something you can move as a unit.
  const compressSelection = useCallback(() => {
    if (!doc) return;
    if (selected.length < 2) {
      say("Select two or more objects to compress them into a stack.");
      return;
    }
    const box = bbox(selected);
    const ids = selected.map((n) => n.id);
    const existingParent = selected[0].parentNode;
    const sameGroup = existingParent && selected.every((n) => n.parentNode === existingParent);

    // Animate only for this move, so ordinary dragging stays 1:1 with the cursor.
    boardRef.current?.classList.add("compressing");
    window.setTimeout(() => boardRef.current?.classList.remove("compressing"), 420);

    update((d) => {
      let nodes = d.nodes;
      let groupId = sameGroup ? existingParent : undefined;
      let originX = box.x;
      let originY = box.y;

      if (!groupId) {
        const g = mkObject(doc.id, "NOTE", "Stack", { kind: "group", collapsed: true }, box.x, box.y);
        groupId = g.id;
        originX = 0; originY = 0; // children are positioned relative to the group
        nodes = [toNode("group", g, {}, { width: NODE_W + 60, height: 210 }), ...nodes];
      }

      const order = new Map(ids.map((id, i) => [id, i]));
      return {
        ...d,
        nodes: nodes.map((n) => {
          const i = order.get(n.id);
          if (i === undefined) return n;
          return {
            ...n,
            parentNode: groupId,
            extent: "parent" as const,
            selected: false,
            zIndex: 10 + i,
            className: `${n.className ?? ""} stacked`.trim(),
            position: { x: originX + i * 7, y: originY + i * 5 },
          };
        }),
      };
    });
    say(`Compressed ${ids.length} objects into a stack`);
  }, [doc, selected, update, say]);

  const addEmbed = useCallback(async (raw?: string) => {
    if (!doc) return;
    const url = raw ?? window.prompt("Paste a link — YouTube, Wikipedia, an article, anything");
    if (!url?.trim()) return;
    const pos = centre();
    try {
      const { object } = await api.embed({ canvasId: doc.id, url: url.trim(), x: pos.x, y: pos.y });
      update((d) => ({ ...d, nodes: [...d.nodes, toNode("embed", object)] }));
    } catch (e) {
      fail("Embed")(e);
    }
  }, [doc, centre, update, fail]);

  const addRandomPaper = useCallback(async () => {
    if (!doc) return;
    try {
      const { results } = await api.random();
      const paper = results[0];
      if (!paper) return say("Could not reach OpenAlex just now.");
      const pos = centre();
      const { object } = await api.addObject({
        canvasId: doc.id, objectType: "PAPER", openalexId: paper.openalexId,
        title: paper.title, content: { openalexId: paper.openalexId }, x: pos.x, y: pos.y,
      });
      update((d) => ({ ...d, nodes: [...d.nodes, toNode("paper", object, { paper })] }));
      say(`Added “${paper.title.slice(0, 50)}”`);
    } catch (e) {
      fail("Random paper")(e);
    }
  }, [doc, centre, update, say, fail]);

  const addWikipedia = useCallback(async () => {
    const q = window.prompt("Wikipedia article or topic");
    if (!q?.trim()) return;
    const term = q.trim();
    // A bare topic becomes an article URL; a pasted link is used as given.
    const url = /^https?:\/\//.test(term)
      ? term
      : `https://en.wikipedia.org/wiki/${encodeURIComponent(term.replace(/\s+/g, "_"))}`;
    await addEmbed(url);
  }, [addEmbed]);

  // Tuck: notes, excerpts and AI artifacts derived from a paper fold into a
  // sticky pad on its edge, so annotating a paper heavily does not bury the
  // board. Their positions are remembered, so releasing puts them back exactly
  // where they were rather than re-laying them out.
  const tuckNotes = useCallback((paperId: string) => {
    if (!doc) return;
    const paper = byId(paperId);
    if (!paper) return;

    const attachedIds = new Set<string>();
    for (const e of doc.edges) {
      if (e.source === paperId) attachedIds.add(e.target);
      if (e.target === paperId) attachedIds.add(e.source);
    }
    const tuckable = doc.nodes.filter(
      (n) => attachedIds.has(n.id) && ["note", "excerpt", "ai"].includes(n.type ?? ""),
    );
    const already = (paper.data.object.content.tucked as { id: string; x: number; y: number }[] | undefined) ?? [];

    if (already.length) {
      // Release: restore each note to where it was before it was tucked.
      const home = new Map(already.map((t) => [t.id, t]));
      update((d) => ({
        ...d,
        nodes: d.nodes.map((n) => {
          if (n.id === paperId) {
            const { tucked: _drop, ...rest } = n.data.object.content as Record<string, unknown>;
            return { ...n, data: { ...n.data, object: { ...n.data.object, content: rest } } };
          }
          const h = home.get(n.id);
          return h ? { ...n, hidden: false, position: { x: h.x, y: h.y } } : n;
        }),
      }));
      return say(`Released ${already.length} note${already.length === 1 ? "" : "s"}`);
    }

    if (!tuckable.length) return say("Nothing attached to this paper yet — add a note or an explanation first.");

    const remembered = tuckable.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
    update((d) => ({
      ...d,
      nodes: d.nodes.map((n) => {
        if (n.id === paperId) {
          return { ...n, data: { ...n.data, object: { ...n.data.object, content: { ...n.data.object.content, tucked: remembered } } } };
        }
        return remembered.some((t) => t.id === n.id) ? { ...n, hidden: true } : n;
      }),
    }));
    say(`Tucked ${tuckable.length} note${tuckable.length === 1 ? "" : "s"} into the paper`);
  }, [doc, byId, update, say]);

  const removeNodes = useCallback((ids: string[]) => {
    const rm = new Set(ids);
    update((d) => ({ ...d, nodes: d.nodes.filter((n) => !rm.has(n.id) && !(n.parentNode && rm.has(n.parentNode))), edges: d.edges.filter((e) => !rm.has(e.source) && !rm.has(e.target)) }));
  }, [update]);

  const chatAbout = useCallback((nid: string) => {
    update((d) => ({ ...d, nodes: d.nodes.map((n) => ({ ...n, selected: n.id === nid })) }), false);
    setPanelOpen(true);
    setTab("Chat");
  }, [update]);

  const onMenuAction = useCallback(async (nid: string, a: MenuAction) => {
    const n = byId(nid);
    if (!n || !doc) return;
    switch (a) {
      case "broader": case "deeper": return recommend(nid, a);
      case "supporting": case "contradicting": return showStance(nid, a);
      case "references": return showCitations(nid, "out");
      case "citedBy": return showCitations(nid, "in");
      case "related": return showCitations(nid, "related");
      case "explain": return explain(nid, undefined, "Explanation").catch(fail("Explain"));
      case "summarize": return explain(nid, undefined, "Summary").catch(fail("Summarize"));
      case "chat": return chatAbout(nid);
      case "link": {
        const others = selected.filter((s) => s.id !== nid);
        if (!others.length) return say("Select another node first, then Link.");
        for (const o of others) await api.addEdge({ canvasId: doc.id, sourceObjectId: nid, targetObjectId: o.id, edgeType: "RELATED_TO" }).then(({ edge }) => update((d) => ({ ...d, edges: [...d.edges, toEdge(edge.id, nid, o.id, "RELATED_TO", "USER")] }))).catch(fail("Linking"));
        return;
      }
      case "group": return groupSelection();
      case "compress": return compressSelection();
      case "tuck": return tuckNotes(nid);
      case "duplicate": {
        const copy = { ...n.data.object, id: uid(), x: n.position.x + 40, y: n.position.y + 40 };
        return addLocal(n.type as NodeKind, copy, { paper: n.data.paper });
      }
      case "remove": return removeNodes([nid]);
    }
  }, [byId, doc, recommend, showCitations, showStance, explain, chatAbout, selected, groupSelection, compressSelection, tuckNotes, addLocal, removeNodes, update, say, fail]);

  // ---- chat ----
  const send = useCallback(async () => {
    const text = draft.trim();
    if (!doc || !text || chatBusy) return;
    const contextIds = selected.map((n) => n.id);
    const userMsg: ChatMessage = { id: uid(), role: "user", text, contextIds };
    update((d) => ({ ...d, chat: [...d.chat, userMsg] }), false);
    setDraft("");
    setChatBusy(true);
    try {
      // The server assembles context by PRD §15 priority (selection, then graph
      // neighbours, then canvas), so we send ids rather than pasted text.
      const { reply, contextObjectIds } = await api.chat({ canvasId: doc.id, message: text, selectedObjectIds: contextIds });
      // Record what the server actually retrieved, not just what was selected:
      // anything derived from this reply is then placed beside the objects it
      // came from rather than in the middle of the board.
      const used = contextObjectIds?.length ? contextObjectIds : contextIds;
      update((d) => ({ ...d, chat: [...d.chat, { id: uid(), role: "assistant", text: reply, contextIds: used }] }), false);
    } catch (e) {
      fail("Chat")(e);
    } finally {
      setChatBusy(false);
    }
  }, [draft, doc, chatBusy, selected, update, fail]);

  const saveNote = useCallback(async (m: ChatMessage) => {
    if (!doc) return;
    const anchor = m.contextIds.map(byId).find(Boolean);
    const [pos] = anchor ? fanOut(anchor, 1, "down", nodes) : [centre()];
    const object = mkObject(doc.id, "AI_SUMMARY", "From chat", { text: m.text, prompt: "chat", sourceObjectIds: m.contextIds, createdAt: Date.now() }, pos.x, pos.y, "AI");
    update((d) => ({
      ...d,
      nodes: [...d.nodes, toNode("ai", object)],
      edges: [...d.edges, ...m.contextIds.filter(byId).map((cid) => toEdge(uid(), cid, object.id, "DERIVED_FROM", "AI"))],
      chat: d.chat.map((x) => (x.id === m.id ? { ...x, artifactId: object.id } : x)),
    }));
  }, [doc, byId, nodes, centre, update]);

  const saveThread = useCallback(() => {
    if (!doc || !doc.chat.length) return;
    const ctx = [...new Set(doc.chat.flatMap((m) => m.contextIds))].filter(byId);
    const first = doc.chat.find((m) => m.role === "user");
    const anchor = ctx.map(byId).find(Boolean);
    const [pos] = anchor ? fanOut(anchor, 1, "down", nodes) : [centre()];
    const object = mkObject(doc.id, "NOTE", first?.text.slice(0, 80) ?? "Thread", { kind: "thread", messages: doc.chat, messageCount: doc.chat.length, contextCount: ctx.length, artifactCount: doc.chat.filter((m) => m.artifactId).length }, pos.x, pos.y);
    update((d) => ({ ...d, nodes: [...d.nodes, toNode("thread", object)], edges: [...d.edges, ...ctx.map((cid) => toEdge(uid(), cid, object.id, "THREAD_CONTEXT", "USER"))], chat: [] }));
    say("Thread saved as a node");
  }, [doc, byId, nodes, centre, update, say]);

  const readAloud = useCallback((text: string) => {
    api.synthesize(text).then((b) => new Audio(URL.createObjectURL(b)).play()).catch(fail("Read aloud"));
  }, [fail]);

  const toggleMic = useCallback(async () => {
    if (recorder.current) { recorder.current.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const r = new MediaRecorder(stream);
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recorder.current = null;
        setRecording(false);
        try {
          const { text } = await api.transcribe(new Blob(chunks, { type: r.mimeType }));
          setDraft((d) => (d ? `${d} ${text}` : text));
        } catch (e) { fail("Transcribe")(e); }
      };
      r.start();
      recorder.current = r;
      setRecording(true);
    } catch { say("Microphone unavailable"); }
  }, [fail, say]);

  // ---- files ----
  const addFiles = useCallback(async (files: FileList | File[], at?: { x: number; y: number }) => {
    if (!doc) return;
    const pos = at ?? centre();
    // PRD §7: papers, PDFs, images, video, audio and documents are all board
    // objects. The server decides the type from the file, so nothing is filtered
    // out here.
    const incoming = Array.from(files);
    for (const [i, f] of incoming.entries()) {
      const local = URL.createObjectURL(f);
      try {
        // Upload so the file survives a reload; the blob url still gives an
        // instant preview for this session.
        const { object } = await api.upload(f, doc.id, pos.x + i * 30, pos.y + i * 30);
        pdfBlobs.set(object.id, local);
        update((d) => ({ ...d, nodes: [...d.nodes, toNode(kindFor(object.objectType), object)] }));
      } catch (e) {
        // Keep the card even if the upload fails — the user still has the file.
        const guessed = f.type.startsWith("image/") ? "IMAGE" : f.type.startsWith("video/") ? "VIDEO" : f.type.startsWith("audio/") ? "AUDIO" : f.name.toLowerCase().endsWith(".pdf") ? "PDF" : "DOC";
        const object = mkObject(doc.id, guessed, f.name, { filename: f.name, sizeBytes: f.size, origin: "upload", url: local, mime: f.type }, pos.x + i * 30, pos.y + i * 30);
        pdfBlobs.set(object.id, local);
        addLocal(kindFor(guessed), object);
        fail("Upload")(e);
      }
    }
  }, [doc, centre, addLocal, update, fail]);

  // ---- selection menu actions (PRD §10) ----
  const onSelectionAction = useCallback(async (a: SelectionAction, sel: Selection) => {
    try {
      switch (a) {
        case "highlight": await addExcerpt(sel); return say("Excerpt captured");
        case "note": { const ex = await addExcerpt(sel); if (ex) await addNote("", { x: ex.x + NODE_W + 40, y: ex.y }, ex.id); return; }
        case "explain": case "summarize": { const ex = await addExcerpt(sel); if (ex) await explain(ex.id, sel.text, a === "explain" ? "Explanation" : "Summary"); return; }
        case "ask": setDraft(sel.text); setTab("Chat"); return;
        case "related": setPalette({ open: true, query: sel.text.slice(0, 120) }); return;
        case "supporting": case "contradicting": return showStance(sel.objectId, a);
        // A concept is only added when the user asks — never automatically (PRD §11).
        case "wiki": return addEmbed(`https://en.wikipedia.org/wiki/${encodeURIComponent(sel.text.replace(/\s+/g, "_"))}`);
      }
    } catch (e) { fail("Action")(e); }
  }, [addExcerpt, addNote, explain, say, fail]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA";
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette({ open: true }); }
      else if (mod && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && e.key.toLowerCase() === "g" && !typing) { e.preventDefault(); groupSelection(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo, redo, groupSelection]);

  const actions = useMemo<BoardActions>(() => ({
    open: (nid) => { setDetailId(nid); setTab("Details"); setPanelOpen(true); },
    tuck: (nid) => tuckNotes(nid),
    pdfUrl: (nid) => pdfBlobs.get(nid) ?? (byId(nid)?.data.object.content.pdfUrl as string | undefined),
    chatAbout,
    menu: (nid, x, y) => setMenu({ id: nid, x, y }),
    accept: acceptSuggestion,
    reject: rejectSuggestion,
    more: (anchorId, mode) => recommend(anchorId, mode, true),
    readAloud,
    editText: (nid, text) => update((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === nid ? { ...n, data: { ...n.data, object: { ...n.data.object, content: { ...n.data.object.content, text } } } } : n)) })),
  }), [chatAbout, acceptSuggestion, rejectSuggestion, recommend, readAloud, update]);

  const paletteActions = useMemo<PaletteAction[]>(() => [
    { id: "upload", label: "Upload file", run: () => fileInput.current?.click() },
    { id: "note", label: "New note", run: () => addNote().catch(fail("Note")) },
    { id: "help", label: "Help — what everything does", run: () => setHelpOpen(true) },
    { id: "fit", label: "Fit canvas", run: () => flow.fitView({ padding: 0.2, duration: 300 }) },
  ], [addNote, fail, flow]);

  // Below the width the open panels need, the rail tucks itself away; the
  // shell's min-width keeps the board usable if the user reopens it anyway.
  const panelWidth = tab === "Details" && detail ? Math.max(panelW, 420) : panelW;
  // A panel opened in a window too narrow to dock it floats over the board
  // instead of squeezing it.
  const panelOverlay = panelOpen && winW < MIN_BOARD + panelWidth;
  const panelEff = panelOpen && !panelOverlay ? panelWidth : 0;
  const railOverlay = railOpen && winW < MIN_BOARD + railW + panelEff;
  const railEff = railOpen && !railOverlay ? railW : 0;
  const rail = (
    <Dock side="left" overlay={railOverlay} open={railOpen} onOpen={(o) => { railAutoHidden.current = false; setRailOpen(o); }} width={railW} onWidth={setRailW} max={winW - MIN_BOARD - panelEff}>
      <Sidebar currentId={id} onSearch={() => setPalette({ open: true })} />
    </Dock>
  );

  if (!doc) return <div className="shell">{rail}<div className="main"><div className="empty" style={{ marginTop: 80 }}>{doc === null ? "Canvas not found." : <span className="spinner" style={{ display: "inline-block" }} />}</div></div></div>;

  const real = nodes.filter((n) => n.type !== "suggestion");
  const detailEdges = detail ? edges.filter((e) => e.source === detail.id || e.target === detail.id).map((e) => { const other = byId(e.source === detail.id ? e.target : e.source); return { id: e.id, label: e.data?.edgeType ?? "", title: other?.data.object.title ?? String(other?.data.object.content.text ?? "").slice(0, 40) }; }) : [];

  return (
    <BoardActionsContext.Provider value={actions}>
      <div className="shell" style={{ minWidth: MIN_BOARD + railEff + panelEff }}>
        {rail}
        <div className="main">
          <header className="topbar">
            <input className="topbar-title" value={doc.title} aria-label="Canvas title" onChange={(e) => update((d) => ({ ...d, title: e.target.value }), false)} />
            <span className="hint">{saved ? "Saved" : "Saving…"}</span>
            <div className="grow" />
            <div className="zoom" aria-label="Zoom">
              <button onClick={() => flow.zoomOut({ duration: 200 })} aria-label="Zoom out">−</button>
              <button onClick={() => flow.fitView({ padding: 0.2, duration: 300 })} title="Fit canvas">{Math.round(zoom * 100)}%</button>
              <button onClick={() => flow.zoomIn({ duration: 200 })} aria-label="Zoom in">+</button>
            </div>
            <button className="btn" onClick={() => { navigator.clipboard?.writeText(location.href); say("Link copied"); }}>Share</button>
            <button className="btn icon" title="Help (?)" aria-label="Help" onClick={() => setHelpOpen(true)}><HelpIcon /></button>
          </header>
          <div className="work">
            <div className={`board tool-${tool} conn-${connector}${crossing ? " crossing" : ""}${connecting ? " connecting" : ""}`} ref={boardRef} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })); }}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                panOnDrag={tool === "pan" ? true : [1, 2]}
                selectionOnDrag={tool === "select" || tool === "group"}
                nodesDraggable={tool !== "connect"}
                connectionMode={tool === "connect" ? ConnectionMode.Loose : ConnectionMode.Strict}
                selectionMode={crossing ? SelectionMode.Partial : SelectionMode.Full}
                onSelectionStart={onSelectionStart}
                onConnectStart={() => setConnecting(true)}
                onConnectEnd={() => setConnecting(false)}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDragStart={onNodeDragStart}
                onConnect={onConnect}
                onMoveEnd={onMoveEnd}
                onNodeContextMenu={(e, n) => { e.preventDefault(); setMenu({ id: n.id, x: e.clientX, y: e.clientY }); }}
                // Double-click opens the full centred viewer; groups just expand in place.
                onNodeDoubleClick={(_, n) => { if (n.type !== "group") setLightboxId(n.id); }}
                onPaneClick={() => { setMenu(null); setDetailId(null); if (panelOverlay) setPanelOpen(false); if (railOverlay) setRailOpen(false); }}
                deleteKeyCode={["Backspace", "Delete"]}
                multiSelectionKeyCode="Shift"
                panOnScroll
                zoomOnDoubleClick={false}
                minZoom={0.2}
                maxZoom={2}
                snapToGrid
                snapGrid={[12, 12]}
                proOptions={{ hideAttribution: true }}
                defaultEdgeOptions={connectorStyle(connector)}
              >
                <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--dot)" />
                {real.length > 3 && <MiniMap pannable zoomable style={{ width: 150, height: 96 }} nodeColor={(n) => (n.type === "paper" ? "#d2d2d7" : n.type === "ai" ? "#9ec8f5" : "#e8e8ea")} maskColor="rgba(251,251,252,0.7)" />}
              </ReactFlow>
              <div className="tools" role="toolbar" aria-label="Tools">
                <button className={`tool${tool === "select" ? " on" : ""}`} title="Click — select and move" aria-pressed={tool === "select"} onClick={() => setTool("select")}><CursorIcon /></button>
                <button className={`tool${tool === "pan" ? " on" : ""}`} title="Drag — pan the canvas" aria-pressed={tool === "pan"} onClick={() => setTool("pan")}><HandIcon /></button>
                <span className="tool-sep" />
                <div className="add-wrap">
                  <button className={`tool${addOpen ? " on" : ""}`} title="Add to canvas" aria-expanded={addOpen} onClick={() => setAddOpen((v) => !v)}><PlusIcon /></button>
                  {addOpen && (
                    <div className="popover add-menu" onMouseLeave={() => setAddOpen(false)}>
                      <button className="menu-item" onClick={() => { setAddOpen(false); setPalette({ open: true }); }}><PaperIcon /> Paper</button>
                      <button className="menu-item" onClick={() => { setAddOpen(false); addWikipedia(); }}><WikiIcon /> Wikipedia</button>
                      <button className="menu-item" onClick={() => { setAddOpen(false); addRandomPaper(); }}><PaperIcon /> Surprise me</button>
                      <button className="menu-item" onClick={() => { setAddOpen(false); fileInput.current?.click(); }}><FileIcon /> File</button>
                      <button className="menu-item" onClick={() => { setAddOpen(false); addEmbed(); }}><EmbedIcon /> Embed link</button>
                      <button className="menu-item" onClick={() => { setAddOpen(false); addNote("", undefined, undefined, "text").catch(fail("Text")); }}><TextIcon /> Text</button>
                      <button className="menu-item" onClick={() => { setAddOpen(false); addNote("", undefined, undefined, "sticky").catch(fail("Note")); }}><StickyIcon /> Sticky note</button>
                      <button className="menu-item" onClick={() => { setAddOpen(false); setPanelOpen(true); setTab("Chat"); }}><ThreadIcon /> Thread</button>
                    </div>
                  )}
                </div>
                <button className={`tool${tool === "group" ? " on" : ""}`} title="Group — select objects to group (⌘G groups now)" aria-pressed={tool === "group"} onClick={() => setTool(tool === "group" ? "select" : "group")}><GroupIcon /></button>
                <span className="tool-sep" />
                <button className={`tool${tool === "connect" && connector === "line" ? " on" : ""}`} title="Line — drag between objects" aria-pressed={tool === "connect" && connector === "line"} onClick={() => { setConnector("line"); setTool("connect"); }}><LineIcon /></button>
                <button className={`tool${tool === "connect" && connector === "arrow" ? " on" : ""}`} title="Arrow — drag between objects" aria-pressed={tool === "connect" && connector === "arrow"} onClick={() => { setConnector("arrow"); setTool("connect"); }}><ArrowIcon /></button>
                <button className={`tool${tool === "connect" && connector === "biarrow" ? " on" : ""}`} title="Two-way arrow — drag between objects" aria-pressed={tool === "connect" && connector === "biarrow"} onClick={() => { setConnector("biarrow"); setTool("connect"); }}><BiArrowIcon /></button>
                <span className="tool-sep" />
                <button className="tool accent" title="Ask AI" onClick={() => { setPanelOpen(true); setTab("Chat"); }}><SparkIcon /></button>
              </div>
              {tool === "group" && (
                <div className="group-prompt popover" role="status">
                  {selected.length < 2
                    ? <span>Select objects to group</span>
                    : <><span>Group {selected.length} objects?</span><button className="btn primary sm" onClick={groupSelection}>Group</button></>}
                  <button className="btn sm" onClick={() => setTool("select")}>Cancel</button>
                </div>
              )}
              {real.length === 0 && <EmptyState onSearch={() => setPalette({ open: true })} onUpload={() => fileInput.current?.click()} onDrop={addFiles} />}
              <form className="chatbar" onSubmit={(e) => { e.preventDefault(); setPanelOpen(true); setTab("Chat"); send(); }}>
                {partial && <div className="chat-partial">{partial}</div>}
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask anything" aria-label="Ask about this canvas" onFocus={() => { setPanelOpen(true); setTab("Chat"); }} />
                <button type="button" className="voice" aria-pressed={recording} onClick={toggleMic} title={recording ? "Stop recording" : "Voice input"}>
                  {recording
                    ? <span className="waves" aria-hidden><i /><i /><i /><i /><i /></span>
                    : <MicIcon />}
                </button>
              </form>
            </div>
            {helpOpen && <Help onClose={() => setHelpOpen(false)} />}
            {lightboxId && byId(lightboxId) && (
              <Lightbox node={byId(lightboxId)!} pdfUrl={actions.pdfUrl(lightboxId)} onClose={() => setLightboxId(null)} />
            )}
            <Dock side="right" overlay={panelOverlay} open={panelOpen} onOpen={(o) => { panelAutoHidden.current = false; setPanelOpen(o); }} width={panelWidth} onWidth={setPanelW} max={winW - MIN_BOARD - railEff}>
              <SidePanel
                tab={tab} onTab={setTab}
                nodes={nodes} selectedIds={selectedIds} onFocus={focusNode}
                details={detail ? (
                  <Viewer
                    key={detail.id}
                    node={detail}
                    edges={detailEdges}
                    pdfUrl={pdfBlobs.get(detail.id)}
                    onSelectionAction={onSelectionAction}
                    onAction={(a) => (a === "chat" ? chatAbout(detail.id) : onMenuAction(detail.id, a))}
                  />
                ) : null}
                chat={
                  <ChatPanel
                    messages={doc.chat} contextTitles={selected.map((n) => n.data.object.title ?? String(n.data.object.content.text ?? "").slice(0, 40))}
                    busy={chatBusy} draft={draft} onDraft={setDraft} onSend={send} onSaveNote={saveNote} onSaveThread={saveThread} onReadAloud={readAloud} onMic={toggleMic} recording={recording}
                  />
                }
              />
            </Dock>
          </div>
        </div>
      </div>

      <input ref={fileInput} type="file" accept="image/*,video/*,audio/*,.pdf,.txt,.md,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.epub"  multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
      {menu && <ContextMenu x={menu.x} y={menu.y} kind={(byId(menu.id)?.type ?? "note") as NodeKind} onAction={(a) => onMenuAction(menu.id, a)} onClose={() => setMenu(null)} />}
      {palette.open && (
        <CommandPalette
          key={palette.query ?? ""}
          nodes={nodes} actions={paletteActions} onFocusNode={focusNode}
          onAdd={(p) => addPaper(p).then(() => say(`Added “${p.title.slice(0, 40)}”`)).catch(fail("Add"))}
          onClose={() => setPalette({ open: false })}
          initialQuery={palette.query}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </BoardActionsContext.Provider>
  );
}
