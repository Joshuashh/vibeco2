import { PillToggle, pillButtonBase, pillButtonInactive } from "./PillToggle";

export type PreviewTool = "cursor" | "pin" | "draw";

const cursorIcon = (
  <svg className="w-[1em] h-[1em]" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
  </svg>
);

const pinIcon = (
  <svg className="w-[1em] h-[1em]" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

const drawIcon = (
  <svg className="w-[1em] h-[1em]" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21l3.5-1 11-11a2.12 2.12 0 0 0-3-3l-11 11z" />
  </svg>
);

export function PreviewToolbar({
  tool,
  onToolChange,
  onUndo,
  canUndo,
  onClear,
  canClear,
}: {
  tool: PreviewTool;
  onToolChange: (tool: PreviewTool) => void;
  onUndo: () => void;
  canUndo: boolean;
  onClear: () => void;
  canClear: boolean;
}) {
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-auto">
      <PillToggle
        items={[
          { key: "cursor", label: cursorIcon, title: "Cursor" },
          { key: "pin", label: pinIcon, title: "Comment" },
          { key: "draw", label: drawIcon, title: "Draw" },
        ]}
        active={tool}
        onChange={onToolChange}
        trailing={
          tool === "draw" && (
            <>
              <button type="button" className={`${pillButtonBase} ${pillButtonInactive}`} title="Undo last stroke" onClick={onUndo} disabled={!canUndo}>
                <svg className="w-[1em] h-[1em]" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2" />
                </svg>
              </button>
              <button type="button" className={`${pillButtonBase} ${pillButtonInactive}`} title="Clear all drawings" onClick={onClear} disabled={!canClear}>
                <svg className="w-[1em] h-[1em]" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 21H8a2 2 0 0 1-1.42-.59l-3.99-4A2 2 0 0 1 4 13l10-10a2 2 0 0 1 2.83 0l5.17 5.17a2 2 0 0 1 0 2.83L13 19" />
                  <path d="M12.34 15.34 8.66 11.66" />
                </svg>
              </button>
            </>
          )
        }
      />
    </div>
  );
}
