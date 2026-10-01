"use client";
// Canvas list / home (wireframe 2d): rail of views, grid of canvas cards with a
// rename/delete menu, "+ New canvas" card.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createCanvas, deleteCanvas, listCanvases, loadCanvas, renameCanvas, type CanvasMeta } from "../lib/store";
import { Onboarding, hasOnboarded, readInterests, type Topic } from "./Onboarding";
import { api } from "../lib/api";

const VIEWS = ["All canvases", "Recent"] as const;

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / 604800)}w ago`;
}

// A card shows where the objects actually are, so two canvases do not look
// identical. Positions are normalised into the thumbnail box.
function Thumb({ id }: { id: string }) {
  const doc = loadCanvas(id);
  const nodes = (doc?.nodes ?? []).filter((n) => n.type !== "suggestion").slice(0, 40);
  if (!nodes.length) return <div className="thumb" aria-hidden />;

  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);

  return (
    <div className="thumb" aria-hidden>
      {nodes.map((n) => (
        <i
          key={n.id}
          className={n.type === "ai" ? "accent" : n.type === "note" ? "warm" : undefined}
          style={{
            left: `${8 + ((n.position.x - minX) / w) * 78}%`,
            top: `${10 + ((n.position.y - minY) / h) * 70}%`,
            width: n.type === "paper" || n.type === "pdf" ? 18 : 11,
            height: n.type === "paper" || n.type === "pdf" ? 13 : 8,
          }}
        />
      ))}
    </div>
  );
}

export function Home() {
  const router = useRouter();
  const [list, setList] = useState<CanvasMeta[] | null>(null);
  const [view, setView] = useState<(typeof VIEWS)[number]>("All canvases");
  const [menu, setMenu] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [suggested, setSuggested] = useState<{ title: string; openalexId: string }[]>([]);
  const refresh = () => setList(listCanvases());
  useEffect(() => {
    refresh();
    // Ask once. Skipping counts as answering, so it is not asked again.
    if (!hasOnboarded()) setOnboarding(true);
    else loadSuggestions(readInterests());
  }, []);

  // Interests drive what the home screen offers, so the picker has a visible
  // consequence rather than being a form that vanishes.
  const loadSuggestions = (topics: Topic[]) => {
    if (!topics.length) return setSuggested([]);
    const pick = topics[Math.floor(Math.random() * topics.length)];
    api.search(pick.name, 4)
      .then((r) => setSuggested(r.results.map((p) => ({ title: p.title, openalexId: p.openalexId }))))
      .catch(() => setSuggested([]));
  };
  useEffect(() => {
    // Close on an outside click only. Relying on stopPropagation alone let the
    // same click that opened the menu immediately close it again, so the menu
    // never appeared.
    const off = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(".card-menu") || t?.closest(".more")) return;
      setMenu(null);
    };
    document.addEventListener("click", off);
    return () => document.removeEventListener("click", off);
  }, []);

  const create = () => router.push(`/c/${createCanvas().id}`);
  const rename = (c: CanvasMeta) => {
    const t = prompt("Rename canvas", c.title);
    if (t?.trim()) { renameCanvas(c.id, t.trim()); refresh(); }
  };
  const remove = (c: CanvasMeta) => {
    if (confirm(`Delete “${c.title}”? This cannot be undone.`)) { deleteCanvas(c.id); refresh(); }
  };
  const shown = view === "Recent" ? (list ?? []).slice(0, 6) : list ?? [];

  const startFrom = (openalexId: string, title: string) => {
    const c = createCanvas(title.slice(0, 60));
    router.push(`/c/${c.id}?add=${encodeURIComponent(openalexId)}`);
  };

  return (
    <div className="home">
      {onboarding && (
        <Onboarding onDone={(picked) => { setOnboarding(false); loadSuggestions(picked); }} />
      )}
      <aside className="home-rail">
        <button className="rail-new" onClick={create}>+ New canvas</button>
        {VIEWS.map((v) => (
          <button key={v} className="rail-item" aria-current={view === v ? "page" : undefined} onClick={() => setView(v)}>{v}</button>
        ))}
        <div className="grow" />
        <Link className="rail-item" href="/settings">Settings</Link>
      </aside>
      <main className="home-main">
        <div className="home-head">
          <h1>Your canvases</h1>
          <span className="hint">{list?.length ?? ""}</span>
          <div className="grow" />
          <span className="hint">Recent ▾</span>
        </div>
        {suggested.length > 0 && (
          <div className="suggested">
            <div className="eyebrow">Based on your interests</div>
            <div className="suggested-row">
              {suggested.map((p) => (
                <button key={p.openalexId} className="suggest-card" onClick={() => startFrom(p.openalexId, p.title)}>
                  {p.title}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="cards">
          {shown.map((c) => (
            <div key={c.id} className="card" role="link" tabIndex={0} onClick={() => router.push(`/c/${c.id}`)} onKeyDown={(e) => e.key === "Enter" && router.push(`/c/${c.id}`)}>
              <Thumb id={c.id} />
              <div className="body">
                <div className="name">{c.title}</div>
                <div className="sub">{c.objectCount} object{c.objectCount === 1 ? "" : "s"} · {ago(c.updatedAt)}</div>
              </div>
              <button className="more" aria-label="Canvas menu" aria-expanded={menu === c.id} onClick={(e) => { e.stopPropagation(); setMenu(menu === c.id ? null : c.id); }}>⋯</button>
              {menu === c.id && (
                <div className="popover card-menu" style={{ position: "absolute", right: 6, top: 34, width: 150, padding: 4, zIndex: 20 }} onClick={(e) => e.stopPropagation()}>
                  <button className="menu-item" onClick={() => { setMenu(null); rename(c); }}>Rename</button>
                  <button className="menu-item danger" onClick={() => { setMenu(null); remove(c); }}>Delete</button>
                </div>
              )}
            </div>
          ))}
          <button className="card new" onClick={create}>+ New canvas</button>
        </div>
      </main>
    </div>
  );
}
