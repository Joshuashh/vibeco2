import { useRef, useState, type PointerEvent, type RefObject } from "react";
import { clientPointToPercent, type PercentPoint } from "../lib/overlayGeometry";
import type { PreviewPin, PreviewPinReply, PreviewStroke } from "../lib/previewComments";
import type { Profile } from "../lib/profiles";
import { CommentThread, DeleteButton, ResolveButton, CloseButton } from "./previewCommentUi";
import type { PreviewTool } from "./PreviewToolbar";

// Below this many pixels of movement, a pin pointerdown->up is a click (open
// the pin), not a drag (move the pin) — matches the small amount of
// incidental movement a real click/tap always has.
const DRAG_THRESHOLD_PX = 4;

// Shared floating-card look for the draft-pin form and the open-pin popover.
const cardClass =
  "absolute -translate-x-1/2 -translate-y-full bg-bg-tertiary border border-border rounded-xl p-3 shadow-[0_10px_30px_rgba(0,0,0,0.45)] pointer-events-auto";

export function PreviewAnnotationLayer({
  containerRef,
  tool,
  pins,
  strokes,
  activeStroke,
  draftPin,
  openPinId,
  repliesByPin,
  currentUserId,
  profiles,
  onPlacePin,
  onSaveDraftPin,
  onCancelDraftPin,
  onStrokeStart,
  onStrokePoint,
  onStrokeEnd,
  onPinClick,
  onMovePin,
  onClosePopover,
  onResolvePin,
  onDeletePin,
  onReplyPin,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  tool: PreviewTool;
  pins: PreviewPin[];
  strokes: PreviewStroke[];
  activeStroke: PercentPoint[] | null;
  draftPin: PercentPoint | null;
  openPinId: string | null;
  repliesByPin: Record<string, PreviewPinReply[]>;
  currentUserId: string;
  profiles: Profile[];
  onPlacePin: (point: PercentPoint) => void;
  onSaveDraftPin: (text: string) => void;
  onCancelDraftPin: () => void;
  onStrokeStart: (point: PercentPoint) => void;
  onStrokePoint: (point: PercentPoint) => void;
  onStrokeEnd: () => void;
  onPinClick: (pinId: string) => void;
  onMovePin: (pinId: string, point: PercentPoint) => void;
  onClosePopover: () => void;
  onResolvePin: (pinId: string, resolved: boolean) => void;
  onDeletePin: (pinId: string) => void;
  onReplyPin: (pinId: string, text: string) => void;
}) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [draggingPin, setDraggingPin] = useState<{ id: string; point: PercentPoint } | null>(null);
  const dragStart = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  function toPercent(e: PointerEvent): PercentPoint {
    const rect = containerRef.current!.getBoundingClientRect();
    return clientPointToPercent(e.clientX, e.clientY, rect);
  }

  function handlePointerDown(e: PointerEvent) {
    if (tool === "pin") {
      onPlacePin(toPercent(e));
    } else if (tool === "draw") {
      setIsDrawing(true);
      onStrokeStart(toPercent(e));
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (tool === "draw" && isDrawing) {
      onStrokePoint(toPercent(e));
    }
  }

  function handlePointerUp() {
    if (tool === "draw" && isDrawing) {
      setIsDrawing(false);
      onStrokeEnd();
    }
  }

  function toPoints(points: PercentPoint[]): string {
    return points.map((p) => `${p.x_pct},${p.y_pct}`).join(" ");
  }

  const strokeClass =
    "fill-none stroke-accent stroke-[2px] [stroke-linecap:round] [stroke-linejoin:round] [vector-effect:non-scaling-stroke]";
  const pinMarkerBase =
    "appearance-none border-0 outline-none box-border bg-transparent p-0 absolute -translate-x-1/2 -translate-y-full pointer-events-auto cursor-default w-[26px] h-[26px] [filter:drop-shadow(0_2px_5px_rgba(0,0,0,0.5))]";
  const draftBtnGhost =
    "appearance-none border-0 outline-none box-border bg-transparent cursor-default text-[12px] px-2.5 py-1 rounded-md text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-colors";
  const draftBtnPrimary =
    "appearance-none border-0 outline-none box-border cursor-default text-[12px] font-medium px-3 py-1 rounded-md bg-accent text-white hover:opacity-90 transition-opacity";

  return (
    <div
      className={
        tool === "cursor"
          ? "absolute inset-0 cursor-crosshair pointer-events-none"
          : "absolute inset-0 cursor-crosshair"
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
        {strokes.map((stroke) => (
          <polyline key={stroke.id} points={toPoints(stroke.path)} className={strokeClass} />
        ))}
        {activeStroke && (
          <polyline points={toPoints(activeStroke)} className={`${strokeClass} opacity-70`} />
        )}
      </svg>
      {pins.map((pin) => {
        const pos = draggingPin?.id === pin.id ? draggingPin.point : { x_pct: pin.x_pct, y_pct: pin.y_pct };
        return (
          <button
            key={pin.id}
            type="button"
            className={
              (pin.resolved ? `${pinMarkerBase} text-text-tertiary opacity-60` : `${pinMarkerBase} text-accent`) +
              (draggingPin?.id === pin.id ? " cursor-grabbing" : " cursor-grab")
            }
            style={{ left: `${pos.x_pct}%`, top: `${pos.y_pct}%` }}
            title={pin.text}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              dragStart.current = { x: e.clientX, y: e.clientY, moved: false };
            }}
            onPointerMove={(e) => {
              if (!dragStart.current) return;
              const dx = e.clientX - dragStart.current.x;
              const dy = e.clientY - dragStart.current.y;
              if (!dragStart.current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
              dragStart.current.moved = true;
              setDraggingPin({ id: pin.id, point: toPercent(e) });
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              const moved = dragStart.current?.moved ?? false;
              dragStart.current = null;
              if (moved) {
                onMovePin(pin.id, toPercent(e));
                setDraggingPin(null);
              } else {
                onPinClick(pin.id);
              }
            }}
          >
            <svg viewBox="0 0 24 24" className="w-full h-full" fill="currentColor" stroke="var(--bg-primary)" strokeWidth="1.5" strokeLinejoin="round">
              <path d="M12 21s-7-7.58-7-12a7 7 0 0 1 14 0c0 4.42-7 12-7 12z" />
              <circle cx="12" cy="9" r="2.5" fill="var(--bg-primary)" stroke="none" />
            </svg>
          </button>
        );
      })}
      {pins
        .filter((pin) => pin.id === openPinId)
        .map((pin) => (
          <PinPopover
            key={pin.id}
            pin={pin}
            replies={repliesByPin[pin.id] ?? []}
            currentUserId={currentUserId}
            profiles={profiles}
            onClose={onClosePopover}
            onResolve={onResolvePin}
            onDelete={onDeletePin}
            onReply={onReplyPin}
          />
        ))}
      {draftPin && (
        <div
          className={`${cardClass} w-[240px] flex flex-col gap-2`}
          style={{ left: `${draftPin.x_pct}%`, top: `${draftPin.y_pct}%`, marginTop: -10 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <textarea
            className="resize-none min-h-[64px] bg-bg-primary border border-border rounded-md text-text-primary [font:inherit] text-[13px] leading-[1.5] px-2.5 py-2 outline-none focus:border-text-tertiary"
            autoFocus
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="Leave a note…"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              className={draftBtnGhost}
              onClick={() => {
                onCancelDraftPin();
                setDraftText("");
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className={draftBtnPrimary}
              onClick={() => {
                onSaveDraftPin(draftText);
                setDraftText("");
              }}
            >
              Comment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Figma-style in-place comment card, anchored at the pin's own position
// instead of only showing up in the sidebar list. Same card contents as the
// side panel (shared CommentThread) so the two never drift apart again.
function PinPopover({
  pin,
  replies,
  currentUserId,
  profiles,
  onClose,
  onResolve,
  onDelete,
  onReply,
}: {
  pin: PreviewPin;
  replies: PreviewPinReply[];
  currentUserId: string;
  profiles: Profile[];
  onClose: () => void;
  onResolve: (pinId: string, resolved: boolean) => void;
  onDelete: (pinId: string) => void;
  onReply: (pinId: string, text: string) => void;
}) {
  return (
    <div
      className={`${cardClass} w-[260px]`}
      style={{ left: `${pin.x_pct}%`, top: `${pin.y_pct}%`, marginTop: -10 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <CommentThread
        pin={pin}
        replies={replies}
        profiles={profiles}
        currentUserId={currentUserId}
        onReply={onReply}
        actions={
          <>
            <ResolveButton resolved={pin.resolved} onClick={() => onResolve(pin.id, !pin.resolved)} />
            <DeleteButton onClick={() => onDelete(pin.id)} />
            <CloseButton onClick={onClose} />
          </>
        }
      />
    </div>
  );
}
