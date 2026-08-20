export type PreviewTool = "cursor" | "pin" | "draw";

export function PreviewToolbar({
  tool,
  onToolChange,
  onUndo,
  canUndo,
}: {
  tool: PreviewTool;
  onToolChange: (tool: PreviewTool) => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-0.5 bg-bg-tertiary border border-border rounded-[10px] p-1 shadow-[0_3px_10px_rgba(0,0,0,0.2)] pointer-events-auto">
      <button
        type="button"
        className={tool === "cursor" ? "icon-button icon-button-active" : "icon-button"}
        title="Cursor"
        onClick={() => onToolChange("cursor")}
      >
        <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
        </svg>
      </button>
      <button
        type="button"
        className={tool === "pin" ? "icon-button icon-button-active" : "icon-button"}
        title="Comment"
        onClick={() => onToolChange("pin")}
      >
        <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </button>
      <button
        type="button"
        className={tool === "draw" ? "icon-button icon-button-active" : "icon-button"}
        title="Draw"
        onClick={() => onToolChange("draw")}
      >
        <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21l3.5-1 11-11a2.12 2.12 0 0 0-3-3l-11 11z" />
        </svg>
      </button>
      {tool === "draw" && (
        <button type="button" className="icon-button" title="Undo last stroke" onClick={onUndo} disabled={!canUndo}>
          <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2" />
          </svg>
        </button>
      )}
    </div>
  );
}
