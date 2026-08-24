import { useRef, useState, type PointerEvent, type RefObject } from "react";
import { clientPointToPercent, type PercentPoint } from "../lib/overlayGeometry";
import type { PreviewPin, PreviewStroke } from "../lib/previewComments";
import type { PreviewTool } from "./PreviewToolbar";

// Below this many pixels of movement, a pin pointerdown->up is a click (open
// the pin), not a drag (move the pin) — matches the small amount of
// incidental movement a real click/tap always has.
const DRAG_THRESHOLD_PX = 4;

export function PreviewAnnotationLayer({
  containerRef,
  tool,
  pins,
  strokes,
  activeStroke,
  draftPin,
  onPlacePin,
  onSaveDraftPin,
  onCancelDraftPin,
  onStrokeStart,
  onStrokePoint,
  onStrokeEnd,
  onPinClick,
  onMovePin,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  tool: PreviewTool;
  pins: PreviewPin[];
  strokes: PreviewStroke[];
  activeStroke: PercentPoint[] | null;
  draftPin: PercentPoint | null;
  onPlacePin: (point: PercentPoint) => void;
  onSaveDraftPin: (text: string) => void;
  onCancelDraftPin: () => void;
  onStrokeStart: (point: PercentPoint) => void;
  onStrokePoint: (point: PercentPoint) => void;
  onStrokeEnd: () => void;
  onPinClick: (pinId: string) => void;
  onMovePin: (pinId: string, point: PercentPoint) => void;
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
    "appearance-none border-0 outline-none box-border bg-transparent p-0 absolute -translate-x-1/2 -translate-y-full pointer-events-auto cursor-default w-[22px] h-[22px] [filter:drop-shadow(0_2px_4px_rgba(0,0,0,0.5))]";
  const draftPinButtonClass =
    "appearance-none border-0 outline-none box-border bg-transparent cursor-default text-[12px] px-2.5 py-1 rounded-md text-text-secondary hover:bg-bg-secondary hover:text-text-primary";

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
            <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
              <path d="M12 21s-7-7.58-7-12a7 7 0 0 1 14 0c0 4.42-7 12-7 12z" />
            </svg>
          </button>
        );
      })}
      {draftPin && (
        <div
          className="absolute -translate-x-1/2 -translate-y-full flex flex-col gap-1.5 w-[220px] bg-bg-tertiary border border-border rounded-[10px] p-2 shadow-[0_8px_24px_rgba(0,0,0,0.4)] pointer-events-auto"
          style={{ left: `${draftPin.x_pct}%`, top: `${draftPin.y_pct}%` }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <textarea
            className="resize-none min-h-[60px] bg-bg-primary border border-border rounded-md text-text-primary [font:inherit] px-2 py-1.5"
            autoFocus
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="Leave a note…"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              className={draftPinButtonClass}
              onClick={() => {
                onSaveDraftPin(draftText);
                setDraftText("");
              }}
            >
              Save
            </button>
            <button
              type="button"
              className={draftPinButtonClass}
              onClick={() => {
                onCancelDraftPin();
                setDraftText("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
