"use client";
// Settings. One section per setting; topics is the only one so far.
import Link from "next/link";
import { useEffect, useState } from "react";
import { TopicPicker, readInterests, saveInterests, type Topic } from "./Onboarding";

export function Settings() {
  // null until localStorage is read, so the first render matches the server's.
  const [picked, setPicked] = useState<Topic[] | null>(null);
  useEffect(() => setPicked(readInterests()), []);

  // Saves as you go: there is no form to forget to submit.
  const update = (p: Topic[]) => { setPicked(p); saveInterests(p); };

  return (
    <div className="home">
      <aside className="home-rail">
        <Link className="rail-item" href="/">← Canvases</Link>
        <span className="rail-item" aria-current="page">Settings</span>
      </aside>
      <main className="home-main">
        <div className="home-head"><h1>Settings</h1></div>

        <section className="onboard static" aria-labelledby="settings-topics">
          <div className="onboard-head">
            <h2 id="settings-topics">Topics</h2>
            <p>Selected topics help curate recommendations. Changes save automatically.</p>
          </div>
          {picked && (
            <>
              {/* Saved picks can sit deep in the tree, so list them where they can be removed. */}
              <div className="tagwrap onboard-picked">
                {picked.length === 0 && <span className="hint">No topics selected.</span>}
                {picked.map((t) => (
                  <button key={t.id} className="tag on" aria-label={`Remove ${t.name}`}
                    onClick={() => update(picked.filter((x) => x.id !== t.id))}>
                    {t.name} <span aria-hidden>×</span>
                  </button>
                ))}
              </div>
              <TopicPicker picked={picked} onChange={update} />
            </>
          )}
        </section>
      </main>
    </div>
  );
}
