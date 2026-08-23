import { useCallback, useRef, useState } from "react";

// Meant as a child of the pane to its left (which must be `relative`), sat
// over the flex `gap` rather than occupying its own flex slot — the gap
// stays untouched and no line is visible until you hover its centre, where
// a short indicator appears. `right: -12px` + `width: 12px` lines it up
// exactly with a 12px gap regardless of the container's own padding. The
// hit target itself is only 32px tall, vertically centred, so the resize
// cursor doesn't take over the whole pane height.
export function PaneResizeHandle({
  width,
  onChange,
  onReset,
  min,
  max,
}: {
  width: number;
  onChange: (width: number) => void;
  onReset?: () => void;
  min: number;
  max: number;
}) {
  const [active, setActive] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragRef.current) return;
      const delta = e.clientX - dragRef.current.startX;
      onChange(Math.min(max, Math.max(min, dragRef.current.startWidth + delta)));
    },
    [onChange, min, max]
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    setActive(false);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);

  function onPointerDown(e: React.PointerEvent) {
    dragRef.current = { startX: e.clientX, startWidth: width };
    setActive(true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 right-[-12px] w-[12px] h-[32px] cursor-col-resize z-10 flex items-center justify-center"
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => !dragRef.current && setActive(false)}
    >
      <span
        className={`w-[2px] h-[32px] rounded-full transition-opacity ${active ? "opacity-100 bg-accent" : "opacity-0"}`}
      />
    </div>
  );
}
