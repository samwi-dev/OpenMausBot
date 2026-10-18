import { useRef, useState, type PointerEvent, type ReactNode } from "react";

const KEY = "omb.callChatDock";

function loadPos(): { left: number; top: number } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return typeof raw?.left === "number" && typeof raw?.top === "number" ? raw : null;
  } catch {
    return null;
  }
}

function savePos(pos: { left: number; top: number }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(pos));
  } catch {
    // Position just won't be remembered.
  }
}

// During a Take turns call the voice UI covers the chat; the dock floats the chat above it as a draggable, resizable panel.
export function CallChatDock({ active, children }: { active: boolean; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(loadPos);

  const place = (event: PointerEvent) => {
    const el = panel.current;
    const parent = el?.parentElement;
    if (!el || !parent || !drag.current) return null;
    const left = Math.max(0, Math.min(event.clientX - drag.current.dx, parent.clientWidth - el.offsetWidth));
    const top = Math.max(0, Math.min(event.clientY - drag.current.dy, parent.clientHeight - el.offsetHeight));
    return { left, top };
  };

  return (
    // Same element tree either way, so starting or ending a call never remounts the chat (scroll, draft, focus).
    <div
      ref={panel}
      data-call-chat-dock={active ? "" : undefined}
      style={active ? (pos ?? undefined) : undefined}
      className={!active ? "contents" : `absolute z-40 flex min-h-[240px] min-w-[300px] resize flex-col overflow-hidden rounded-xl border border-hairline bg-app shadow-2xl ${pos ? "" : "bottom-4 right-4"} h-[520px] w-[380px] max-h-full max-w-full`}
    >
      {active && <div
        data-call-chat-handle
        className="flex shrink-0 cursor-move touch-none select-none items-center border-b border-hairline px-3 py-1.5 text-[12px] font-medium text-ink-secondary"
        onPointerDown={(event) => {
          // Offsets, not the viewport rect: left/top are relative to the parent, which sits right of the sidebar.
          const el = panel.current;
          drag.current = { dx: event.clientX - (el?.offsetLeft ?? 0), dy: event.clientY - (el?.offsetTop ?? 0) };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const next = place(event);
          if (next) setPos(next);
        }}
        onPointerUp={(event) => {
          const next = place(event);
          drag.current = null;
          if (next) {
            setPos(next);
            savePos(next);
          }
        }}
      >
        Chat
      </div>}
      <div className={active ? "relative flex min-h-0 flex-1 flex-col" : "contents"}>{children}</div>
    </div>
  );
}
