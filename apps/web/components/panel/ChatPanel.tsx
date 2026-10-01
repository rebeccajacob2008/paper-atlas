"use client";
// Canvas chat (PRD §17, wireframe 2i). Selected nodes are the explicit
// context; each message snapshots the context ids it was sent with. A reply
// can be saved as a note, and the whole thread can become a node.
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../lib/store";

export function ChatPanel({ messages, contextTitles, busy, draft, onDraft, onSend, onSaveNote, onSaveThread, onReadAloud, onMic, recording }: {
  messages: ChatMessage[];
  contextTitles: string[];
  busy: boolean;
  draft: string;
  onDraft: (v: string) => void;
  onSend: () => void;
  onSaveNote: (m: ChatMessage) => void;
  onSaveThread: () => void;
  onReadAloud: (text: string) => void;
  onMic?: () => void;
  recording: boolean;
}) {
  const log = useRef<HTMLDivElement>(null);
  const [showCtx, setShowCtx] = useState(false);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [messages.length, busy]);

  return (
    <div className="stack" style={{ height: "100%" }}>
      <div className="row" style={{ padding: "8px 12px", borderBottom: "1px solid var(--line-2)", gap: 8 }}>
        <button className="chip click" aria-expanded={showCtx} onClick={() => setShowCtx(!showCtx)} title={contextTitles.join("\n")}>
          {contextTitles.length} pinned
        </button>
        <div className="grow" />
        <button className="btn sm" disabled={messages.length === 0} onClick={onSaveThread}>Save as node</button>
      </div>
      {showCtx && contextTitles.length > 0 && (
        <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--line-2)" }} className="hint">
          {contextTitles.map((t, i) => <div key={i}>• {t}</div>)}
        </div>
      )}
      <div className="chat-log" ref={log}>
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.text}
            {m.role === "user" && m.contextIds.length > 0 && <div className="ctx-note">{m.contextIds.length} context object{m.contextIds.length > 1 ? "s" : ""}</div>}
            {m.role === "assistant" && (
              <div className="msg-actions">
                <button className="btn primary sm" disabled={!!m.artifactId} onClick={() => onSaveNote(m)}>{m.artifactId ? "Saved" : "Save as note"}</button>
                <button className="btn sm" onClick={() => onReadAloud(m.text)} title="Read aloud">🔊</button>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg assistant"><span className="spinner" /></div>}
      </div>
      <form className="chat-reply" onSubmit={(e) => { e.preventDefault(); onSend(); }}>
        <input value={draft} onChange={(e) => onDraft(e.target.value)} placeholder="Reply…" aria-label="Reply" />
        {onMic && <button type="button" className="mic" aria-pressed={recording} onClick={onMic} title="Voice input">🎙</button>}
        <button type="submit" className="btn primary sm" disabled={!draft.trim() || busy}>Send</button>
      </form>
    </div>
  );
}
