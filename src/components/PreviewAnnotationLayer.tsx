import { useState, type PointerEvent, type RefObject } from "react";
import { clientPointToPercent, type PercentPoint } from "../lib/overlayGeometry";
import type { PreviewPin, PreviewStroke } from "../lib/previewComments";
import type { PreviewTool } from "./PreviewToolbar";

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
}) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [draftText, setDraftText] = useState("");

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

  return (
    <div
      className={tool === "cursor" ? "preview-annotation-layer tool-cursor" : "preview-annotation-layer"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <svg className="preview-stroke-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        {strokes.map((stroke) => (
          <polyline key={stroke.id} points={toPoints(stroke.path)} className="preview-stroke" />
        ))}
        {activeStroke && <polyline points={toPoints(activeStroke)} className="preview-stroke preview-stroke-active" />}
      </svg>
      {pins.map((pin) => (
        <button
          key={pin.id}
          type="button"
          className={pin.resolved ? "preview-pin-marker resolved" : "preview-pin-marker"}
          style={{ left: `${pin.x_pct}%`, top: `${pin.y_pct}%` }}
          title={pin.text}
          onClick={(e) => {
            e.stopPropagation();
            onPinClick(pin.id);
          }}
        >
          <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s-7-7.58-7-12a7 7 0 0 1 14 0c0 4.42-7 12-7 12z" />
          </svg>
        </button>
      ))}
      {draftPin && (
        <div className="preview-draft-pin-form" style={{ left: `${draftPin.x_pct}%`, top: `${draftPin.y_pct}%` }}>
          <textarea
            autoFocus
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="Leave a note…"
          />
          <div className="preview-draft-pin-actions">
            <button
              type="button"
              onClick={() => {
                onSaveDraftPin(draftText);
                setDraftText("");
              }}
            >
              Save
            </button>
            <button
              type="button"
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
