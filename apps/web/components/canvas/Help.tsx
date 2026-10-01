"use client";
// Help overlay: what every control on the board does. Opens from the ? button
// or the ? key, closes on Escape or a click outside.
import { useEffect } from "react";

const SECTIONS: { title: string; items: [string, string][] }[] = [
  {
    title: "Toolbar",
    items: [
      ["↖", "Select. Drag left→right to select objects fully inside the box; drag right→left to select anything it touches. Hold space or middle-drag to pan."],
      ["▭", "Group mode: select objects, then confirm to frame them as a group. ⌘G groups the current selection at once."],
      ["╱", "Line tool: drag from one object to another to link them. Esc returns to select."],
      ["→", "Curved arrow, one direction."],
      ["↔", "Curved arrow, both directions."],
      ["✎", "New note."],
      ["⇪", "Upload a file — PDF, image, video, audio, slides, spreadsheet."],
      ["+", "Add anything: search OpenAlex, upload, embed a link, or write a note."],
      ["✦", "Ask AI about this canvas."],
      ["┃", "Pull tabs on each side panel's edge: click to open or close, drag to resize."],
    ],
  },
  {
    title: "On a paper",
    items: [
      ["Broader", "Papers that frame this one — surveys, foundational work, what it builds on. Appears to the left."],
      ["Deeper", "Papers that build on this one — narrower, more recent, more specific. Appears to the right."],
      ["Supporting / Contradicting", "Work that agrees or disagrees with this paper's claims."],
      ["References / Cited by", "What this paper cites, and what cites it."],
      ["Explain / Summarize", "Create an AI note linked back to this paper."],
      ["Chat about this", "Start a conversation with this paper as context."],
      ["✓ / ×", "Accept a suggestion onto the board, or reject it. Rejected papers are not suggested again."],
      ["‹ ›", "Turn pages. Hover a document to reveal the pager."],
    ],
  },
  {
    title: "Organising",
    items: [
      ["Compress into stack", "Stack the selection like a pile of papers, overlapping so you can still see it is a group."],
      ["Link to selection", "Draw an edge from this object to everything selected."],
      ["Duplicate", "Copy an object on this canvas."],
      ["Remove from canvas", "Take it off the board. The source paper itself is untouched."],
      ["Double-click", "Open an object full screen."],
    ],
  },
  {
    title: "Keyboard",
    items: [
      ["⌘K", "Search OpenAlex or jump to an object."],
      ["⌘G", "Group the selection."],
      ["⌘Z / ⇧⌘Z", "Undo / redo."],
      ["Delete", "Remove the selected objects."],
      ["?", "Open this help."],
      ["Esc", "Close whatever is open."],
    ],
  },
];

export function Help({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="lightbox" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Help">
      <div className="help-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="lightbox-head">
          <div className="lightbox-title">What everything does</div>
          <button className="btn" onClick={onClose} aria-label="Close help">✕</button>
        </div>
        <div className="help-body">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h4>{s.title}</h4>
              <dl>
                {s.items.map(([k, v]) => (
                  <div key={k} className="help-row">
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="panel-foot">Press <b>?</b> any time to reopen this.</div>
      </div>
    </div>
  );
}
