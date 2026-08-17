import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

const EDGE_INSET = 8;
const MARGIN = 4;

/**
 * Chrome-free floating menu anchored to a trigger element, with the same
 * collision behavior as the sibling Claude Code GUI's DropdownMenu.swift:
 * prefer opening below the anchor, flip above if there isn't room, and
 * clamp both axes so it never renders outside the window.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  width,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  width: number;
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;

    function measure() {
      const anchorRect = anchor!.getBoundingClientRect();
      const menuHeight = menu!.offsetHeight;
      const boundsWidth = window.innerWidth;
      const boundsHeight = window.innerHeight;

      let top: number;
      if (anchorRect.bottom + MARGIN + menuHeight <= boundsHeight - EDGE_INSET) {
        top = anchorRect.bottom + MARGIN;
      } else if (anchorRect.top - MARGIN - menuHeight >= EDGE_INSET) {
        top = anchorRect.top - MARGIN - menuHeight;
      } else {
        top = Math.max(EDGE_INSET, boundsHeight - EDGE_INSET - menuHeight);
      }

      const left = Math.min(Math.max(anchorRect.left, EDGE_INSET), boundsWidth - EDGE_INSET - width);

      setPosition((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
    }

    measure();
    // Re-measure when the menu's own content changes size (e.g. "More models"
    // expanding) — a real resize signal, not a render-count hack, so this
    // can't loop the way re-running on every render would.
    const observer = new ResizeObserver(measure);
    observer.observe(menu);
    return () => observer.disconnect();
  }, [open, anchorRef, width]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="popover-menu"
      style={{
        position: "fixed",
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        width,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body
  );
}

export function PopoverHeader({ title }: { title: string }) {
  return <div className="popover-header">{title}</div>;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export function PopoverRow({
  title,
  shortcut = "",
  checked = false,
  badge,
  chevron = false,
  indent = false,
  tint,
  onClick,
}: {
  title: string;
  shortcut?: string;
  checked?: boolean;
  badge?: string;
  chevron?: boolean;
  indent?: boolean;
  tint?: "purple";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={indent ? "popover-row popover-row-indent" : "popover-row"}
      onClick={onClick}
    >
      <span className={tint ? `popover-row-title popover-row-tint-${tint}` : "popover-row-title"}>{title}</span>
      {badge && <span className="popover-row-badge">{badge}</span>}
      <span className="popover-row-spacer" />
      {checked ? (
        <span className="popover-row-check">
          <CheckIcon />
        </span>
      ) : chevron ? (
        <span className="popover-row-chevron">
          <ChevronIcon />
        </span>
      ) : shortcut ? (
        <span className="popover-row-shortcut">{shortcut}</span>
      ) : null}
    </button>
  );
}

export function PopoverDivider() {
  return <div className="popover-divider" />;
}
