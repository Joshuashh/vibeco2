import { useEffect, useRef, type RefObject } from "react";
import { useOthers, useUpdateMyPresence } from "../lib/liveblocks";
import { colorForUser } from "../lib/presenceColor";

/**
 * Renders teammates' live cursor positions as an overlay, and reports the
 * local pointer position into Presence so others see this one. Coordinates
 * are relative to `containerRef` (the whole app) — a fine simplification for
 * a small team on similarly-sized windows, not pixel-perfect across very
 * different window sizes.
 */
export function LiveCursors({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  const others = useOthers();
  const updateMyPresence = useUpdateMyPresence();
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function onPointerMove(e: PointerEvent) {
      if (frameRef.current != null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const rect = container!.getBoundingClientRect();
        updateMyPresence({ cursor: { x: e.clientX - rect.left, y: e.clientY - rect.top } });
      });
    }
    function onPointerLeave() {
      updateMyPresence({ cursor: null });
    }

    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerleave", onPointerLeave);
    return () => {
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [containerRef, updateMyPresence]);

  return (
    <div className="live-cursors-layer">
      {others.map((other) =>
        other.presence.cursor ? (
          <div
            key={other.connectionId}
            className="live-cursor"
            style={{ transform: `translate(${other.presence.cursor.x}px, ${other.presence.cursor.y}px)` }}
          >
            <svg viewBox="0 0 24 24" fill={colorForUser(other.presence.email)} stroke="var(--bg-primary)" strokeWidth="1">
              <path d="M4 2l16 8-6.5 2L11 20 4 2z" />
            </svg>
            <span className="live-cursor-label" style={{ background: colorForUser(other.presence.email) }}>
              {other.presence.email}
            </span>
          </div>
        ) : null
      )}
    </div>
  );
}
