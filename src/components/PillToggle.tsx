import { useEffect, useRef, useState, type ReactNode } from "react";

// Shared with PreviewToolbar.tsx for its non-selectable action buttons
// (Undo/Clear) — same shape/height as the tab buttons here, just without
// the hover-pill (they're momentary actions, not a persistent selection).
export const pillButtonBase =
  "relative h-7 flex items-center justify-center border-none text-[0.85em] font-medium px-[1.1em] rounded-md transition-colors disabled:opacity-40 disabled:pointer-events-none";
export const pillButtonInactive = "bg-transparent text-text-secondary hover:text-text-primary";

// Generalized version of ViewToggle's sliding-hover-pill for the Preview
// page's other two-way toggles (Team/Local, Desktop/Mobile) — same glide-
// between-tabs hover feedback, same fixed `h-7` so every pill group on this
// page (including the draw toolbar) lines up at an identical height.
export function PillToggle<K extends string>({
  items,
  active,
  onChange,
  trailing,
}: {
  items: { key: K; label: ReactNode; title?: string }[];
  active: K;
  onChange: (key: K) => void;
  trailing?: ReactNode;
}) {
  const activeCls = "view-toggle-active text-text-primary";

  const refs = useRef(new Map<K, HTMLButtonElement | null>());
  const [hoverRect, setHoverRect] = useState<{ left: number; width: number } | null>(null);
  const [hovering, setHovering] = useState(false);

  function rectOf(el: HTMLButtonElement | null | undefined) {
    return el ? { left: el.offsetLeft, width: el.offsetWidth } : null;
  }

  useEffect(() => {
    setHoverRect((prev) => prev ?? rectOf(refs.current.get(active)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function trackHover(e: React.MouseEvent<HTMLButtonElement>) {
    setHoverRect({ left: e.currentTarget.offsetLeft, width: e.currentTarget.offsetWidth });
    setHovering(true);
  }

  function handleLeave() {
    setHovering(false);
    setHoverRect(rectOf(refs.current.get(active)));
  }

  return (
    <div className="relative flex items-center gap-[0.2em] bg-bg-tertiary rounded-lg p-[0.2em]" onMouseLeave={handleLeave}>
      <div
        className="absolute top-[0.2em] bottom-[0.2em] rounded-md view-toggle-hover pointer-events-none"
        style={{
          left: hoverRect?.left ?? 0,
          width: hoverRect?.width ?? 0,
          opacity: hovering ? 1 : 0,
          transition: "left 180ms cubic-bezier(0.4,0,0.2,1), width 180ms cubic-bezier(0.4,0,0.2,1), opacity 120ms ease",
        }}
      />
      {items.map((item) => (
        <button
          key={item.key}
          ref={(el) => {
            refs.current.set(item.key, el);
          }}
          type="button"
          title={item.title}
          className={item.key === active ? `${pillButtonBase} ${activeCls}` : `${pillButtonBase} ${pillButtonInactive}`}
          onMouseEnter={trackHover}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
      {trailing}
    </div>
  );
}
