// Typed fetch client. All backend calls go through here.
// Imports the shared contract so FE and BE cannot drift apart.
import type {
  CanvasObject,
  SearchResponse,
  AddObjectRequest, AddObjectResponse,
  AddEdgeRequest, AddEdgeResponse,
  RecommendRequest, RecommendResponse,
  ExplainRequest, ExplainResponse,
  CitationDirection, ChatRequest, ChatResponse, StanceRequest,
  SuppressRequest, RecommendResponse as RecResponse, UploadResponse,
  TranscribeResponse,
} from "../../../packages/types/api";

const BASE = "/api"; // rewritten to the FastAPI server in next.config.mjs

/** The server explains its refusals in `detail`. Showing only the status code
 *  turned "OpenAlex is out of request budget" into "failed: 503", which reads
 *  as a bug in this app rather than something the user can act on. */
async function fail(path: string, res: Response): Promise<never> {
  let detail = "";
  try {
    detail = ((await res.json()) as { detail?: string }).detail ?? "";
  } catch {
    /* not JSON */
  }
  throw new Error(detail || `${path} failed: ${res.status}`);
}

async function post<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return fail(path, res);
  return res.json();
}

export const api = {
  search: async (q: string, limit = 10): Promise<SearchResponse> => {
    const res = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}&limit=${limit}`);
    if (!res.ok) return fail("/search", res);
    return res.json();
  },
  addObject: (req: AddObjectRequest): Promise<AddObjectResponse> =>
    post("/objects", req),
  addEdge: (req: AddEdgeRequest): Promise<AddEdgeResponse> =>
    post("/edges", req),
  recommend: (req: RecommendRequest): Promise<RecommendResponse> =>
    post("/recommend", req),
  explain: (req: ExplainRequest): Promise<ExplainResponse> =>
    post("/explain", req),
  citations: (objectId: string, direction: CitationDirection, limit = 25): Promise<SearchResponse> =>
    fetch(`${BASE}/citations?objectId=${encodeURIComponent(objectId)}&direction=${direction}&limit=${limit}`).then((r) => r.json()),
  embed: (req: { canvasId: string; url: string; title?: string; x?: number; y?: number }): Promise<{ object: CanvasObject }> => post("/embed", req),
  topics: (o: { level?: string; parent?: string; q?: string } = {}): Promise<{ level: string; items: { id: string; name: string; worksCount: number; parent?: string | null }[] }> => {
    const p = new URLSearchParams();
    if (o.level) p.set("level", o.level);
    if (o.parent) p.set("parent", o.parent);
    if (o.q) p.set("q", o.q);
    return fetch(`${BASE}/topics?${p}`).then((r) => (r.ok ? r.json() : fail("/topics", r)));
  },
  random: (topic?: string): Promise<SearchResponse> =>
    fetch(`${BASE}/random${topic ? `?topic=${encodeURIComponent(topic)}` : ""}`).then((r) => r.json()),
  concepts: (objectId: string): Promise<{ spans: { term: string; start: number; end: number; title: string; url: string }[] }> =>
    fetch(`${BASE}/concepts?objectId=${encodeURIComponent(objectId)}`).then((r) => r.json()),
  conceptSummary: (title: string): Promise<{ title: string; extract: string; url: string; thumbnail?: string }> =>
    fetch(`${BASE}/concepts/summary?title=${encodeURIComponent(title)}`).then((r) => r.json()),
  chat: (req: ChatRequest): Promise<ChatResponse> => post("/chat", req),
  stance: (req: StanceRequest): Promise<RecResponse> => post("/stance", req),
  suppress: (req: SuppressRequest): Promise<unknown> => post("/suppressions", req),
  discover: (q: string, kind: "foundational" | "recent"): Promise<RecResponse> =>
    fetch(`${BASE}/discover?q=${encodeURIComponent(q)}&kind=${kind}`).then((r) => r.json()),
  deleteCanvas: (id: string): Promise<unknown> =>
    fetch(`${BASE}/canvas/${id}`, { method: "DELETE" }).then((r) => r.json()),
  upload: (file: File, canvasId: string, x = 0, y = 0): Promise<UploadResponse> => {
    const fd = new FormData();
    fd.append("file", file); fd.append("canvasId", canvasId);
    fd.append("x", String(x)); fd.append("y", String(y));
    return fetch(`${BASE}/files`, { method: "POST", body: fd }).then((r) => {
      if (!r.ok) throw new Error(`/files failed: ${r.status}`);
      return r.json();
    });
  },
  transcribe: (audio: Blob): Promise<TranscribeResponse> => {
    const fd = new FormData();
    fd.append("audio", audio);
    return fetch(`${BASE}/speech/transcribe`, { method: "POST", body: fd }).then((r) => r.json());
  },
  synthesize: (text: string): Promise<Blob> =>
    fetch(`${BASE}/speech/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).then((r) => r.blob()),
};
