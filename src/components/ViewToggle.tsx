import { useEffect, useRef, useState } from "react";

export function ViewToggle({
  mode,
  onChange,
  onChatClick,
}: {
  mode: "chat" | "canvas" | "preview";
  onChange: (mode: "chat" | "canvas" | "preview") => void;
  onChatClick?: () => void;
}) {
  // ponytail: base carries only non-color/background utilities. Tailwind
  // compiles utility classes in an internal order, not JSX order, so a
  // button that carried both `bg-transparent` (base) and `bg-bg-primary`
  // (active) at once had `bg-transparent` win the cascade regardless of
  // class order — the active tab's highlight never rendered. Keeping
  // color/background mutually exclusive per state avoids that.
  const base = "relative border-none text-[0.85em] font-medium px-[1.1em] py-[0.2em] rounded-md transition-colors";
  const inactive = "bg-transparent text-text-secondary hover:text-text-primary";
  const active = "view-toggle-active text-text-primary";
  const disabled = "bg-transparent text-text-tertiary opacity-60";

  // Sliding hover pill: tracks whichever tab the pointer is over so the
  // highlight visibly glides between tabs, while the actually-selected tab
  // keeps its own solid `active` background on top and unaffected. Whenever
  // the pointer leaves, the (now invisible) pill snaps back to sit under the
  // selected tab, so the *next* hover always animates out from there rather
  // than from wherever it was last hovering.
  const chatRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLButtonElement>(null);
  const activeRef = mode === "chat" ? chatRef : mode === "canvas" ? canvasRef : previewRef;

  const [hoverRect, setHoverRect] = useState<{ left: number; width: number } | null>(null);
  const [hovering, setHovering] = useState(false);

  function rectOf(el: HTMLButtonElement | null) {
    return el ? { left: el.offsetLeft, width: el.offsetWidth } : null;
  }

  useEffect(() => {
    setHoverRect((prev) => prev ?? rectOf(activeRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function trackHover(e: React.MouseEvent<HTMLButtonElement>) {
    setHoverRect({ left: e.currentTarget.offsetLeft, width: e.currentTarget.offsetWidth });
    setHovering(true);
  }

  function handleLeave() {
    setHovering(false);
    setHoverRect(rectOf(activeRef.current));
  }

  return (
    <div className="relative flex gap-[0.2em] bg-bg-tertiary/40 rounded-lg" onMouseLeave={handleLeave}>
      <div
        className="absolute top-0 bottom-0 rounded-md view-toggle-hover pointer-events-none"
        style={{
          left: hoverRect?.left ?? 0,
          width: hoverRect?.width ?? 0,
          opacity: hovering ? 1 : 0,
          transition: "left 180ms cubic-bezier(0.4,0,0.2,1), width 180ms cubic-bezier(0.4,0,0.2,1), opacity 120ms ease",
        }}
      />
      {/* ponytail: no planning-mode backend yet — visual slot only, matching
          Sidebar's Projects/Skills rows. */}
      <button className={`${base} ${disabled}`} disabled title="Not yet available">
        Plan
      </button>
      <button
        ref={chatRef}
        className={mode === "chat" ? `${base} ${active}` : `${base} ${inactive}`}
        onMouseEnter={trackHover}
        onClick={() => (mode === "chat" ? onChatClick?.() : onChange("chat"))}
      >
        Chat
      </button>
      <button
        ref={canvasRef}
        className={mode === "canvas" ? `${base} ${active}` : `${base} ${inactive}`}
        onMouseEnter={trackHover}
        onClick={() => onChange("canvas")}
      >
        Canvas
      </button>
      <button
        ref={previewRef}
        className={mode === "preview" ? `${base} ${active}` : `${base} ${inactive}`}
        onMouseEnter={trackHover}
        onClick={() => onChange("preview")}
      >
        Preview
      </button>
    </div>
  );
}
