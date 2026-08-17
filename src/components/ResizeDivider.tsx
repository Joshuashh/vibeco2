import { useCallback, useRef, useState } from "react";

export function ResizeDivider({
  width,
  onChange,
  min,
  max,
}: {
  width: number;
  onChange: (width: number) => void;
  min: number;
  max: number;
}) {
  const [hovered, setHovered] = useState(false);
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
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);

  function onPointerDown(e: React.PointerEvent) {
    dragRef.current = { startX: e.clientX, startWidth: width };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  return (
    <div
      className={hovered ? "resize-divider resize-divider-hover" : "resize-divider"}
      onPointerDown={onPointerDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    />
  );
}
