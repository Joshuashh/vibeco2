import { useEffect, useRef, type RefObject } from "react";
import { useOthers, useUpdateMyPresence } from "../lib/liveblocks";
import { colorForUser, textColorForBackground, displayNameForUser } from "../lib/presenceColor";
import type { FlowScreenApi } from "./CanvasView";

type ViewMode = "chat" | "canvas" | "preview" | "plan";

/**
 * Renders teammates' live cursor positions as an overlay, and reports the
 * local pointer position into Presence so others see this one.
 *
 * A cursor is only meaningful relative to what the sender was looking at, so
 * we store it differently per tab and only render it when the viewer is on
 * the same tab:
 *  - canvas: flow-space coordinates (via React Flow's screen<->flow
 *    conversion), so position tracks content regardless of either side's
 *    zoom/pan.
 *  - chat/preview: fraction of the container (0-1), so it scales to the
 *    viewer's own window size instead of the sender's raw screen pixels.
 */
export function LiveCursors({
  containerRef,
  viewMode,
  flowApiRef,
}: {
  containerRef: RefObject<HTMLElement | null>;
  viewMode: ViewMode;
  flowApiRef: RefObject<FlowScreenApi | null>;
}) {
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
        if (viewMode === "canvas" && flowApiRef.current) {
          const flow = flowApiRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          updateMyPresence({ cursor: flow, cursorView: "canvas" });
          return;
        }
        const rect = container!.getBoundingClientRect();
        updateMyPresence({
          cursor: { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height },
          cursorView: viewMode,
        });
      });
    }
    function onPointerLeave() {
      updateMyPresence({ cursor: null, cursorView: null });
    }

    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerleave", onPointerLeave);
    return () => {
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [containerRef, updateMyPresence, viewMode, flowApiRef]);

  const rect = containerRef.current?.getBoundingClientRect();

  return (
    <div className="absolute inset-0 z-50 pointer-events-none overflow-hidden">
      {others.map((other) => {
        if (!other.presence.cursor || other.presence.cursorView !== viewMode || !rect) return null;

        let screen: { x: number; y: number };
        if (viewMode === "canvas") {
          if (!flowApiRef.current) return null;
          const p = flowApiRef.current.flowToScreenPosition(other.presence.cursor);
          screen = { x: p.x - rect.left, y: p.y - rect.top };
        } else {
          screen = { x: other.presence.cursor.x * rect.width, y: other.presence.cursor.y * rect.height };
        }

        return (
          <div
            key={other.connectionId}
            className="absolute top-0 left-0 pointer-events-none"
            style={{ transform: `translate(${screen.x}px, ${screen.y}px)` }}
          >
            <svg
              className="w-[18px] h-[18px] block"
              viewBox="0 0 24 24"
              fill={colorForUser(other.presence.email)}
              stroke="var(--bg-primary)"
              strokeWidth="1"
            >
              <path d="M4 2l16 8-6.5 2L11 20 4 2z" />
            </svg>
            <span
              className="inline-block ml-[14px] -mt-1 px-[7px] py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap"
              style={{
                background: colorForUser(other.presence.email),
                color: textColorForBackground(colorForUser(other.presence.email)),
              }}
            >
              {displayNameForUser(other.presence.email)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
