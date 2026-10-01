"use client";
// A collapsible, resizable side dock with a pull tab on its inner edge.
// Click the tab to open/close; drag it to resize (dragging a closed dock
// outward opens it). Width animates, except while the user is dragging.
import { useRef, useState, type ReactNode } from "react";

const MIN = 180;

export function Dock({ side, open, onOpen, width, onWidth, max = 640, overlay = false, children }: {
  side: "left" | "right"; open: boolean; onOpen: (open: boolean) => void;
  width: number; onWidth: (w: number) => void; max?: number; overlay?: boolean; children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; w: number; moved: boolean } | null>(null);
  const dir = side === "left" ? 1 : -1; // dragging toward the board grows the dock

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: open ? width : 0, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) * dir;
    if (!d.moved && Math.abs(dx) < 4) return;
    if (!d.moved) { d.moved = true; setDragging(true); }
    const w = d.w + dx;
    if (w < MIN / 2) { if (open) onOpen(false); return; }
    if (!open) onOpen(true);
    onWidth(Math.max(MIN, Math.min(640, Math.max(MIN, max), w)));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d && !d.moved) onOpen(!open);
  };

  return (
    <div className={`dock dock-${side}${open ? "" : " closed"}${dragging ? " resizing" : ""}${overlay ? " floating" : ""}`} style={{ width: open ? width : 0 }}>
      <div className="dock-clip">
        <div className="dock-inner" style={{ width }} inert={!open}>{children}</div>
      </div>
      <button
        className="pull-tab"
        aria-label={open ? `Close ${side} panel` : `Open ${side} panel`}
        aria-expanded={open}
        title={open ? "Click to close · drag to resize" : "Click or drag to open"}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(!open); } }}
      />
    </div>
  );
}
