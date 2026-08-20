import { useEffect, useLayoutEffect, useRef, useState } from "react";

const SHOW_DELAY_MS = 250;
const VIEWPORT_MARGIN = 8;

// Native `title` tooltips have a long, OS-controlled delay we can't style
// away. Rather than touching every `title="..."` across the app, this hijacks
// them globally: on hover it swaps the attribute out (so the native tooltip
// never fires) and shows a fast custom one instead. Mount once near the app
// root; every existing `title` attribute keeps working unchanged.
export function TooltipHost() {
  const [tooltip, setTooltip] = useState<{ text: string; anchor: DOMRect } | null>(null);
  const timerRef = useRef<number | null>(null);
  const currentElRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function clearTimer() {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function restoreCurrent() {
      const el = currentElRef.current;
      if (el?.dataset.tooltipText) {
        el.setAttribute("title", el.dataset.tooltipText);
        delete el.dataset.tooltipText;
      }
      currentElRef.current = null;
    }

    function onOver(e: MouseEvent) {
      const el = (e.target as Element | null)?.closest<HTMLElement>("[title]");
      if (!el || el === currentElRef.current) return;
      clearTimer();
      restoreCurrent();
      setTooltip(null);

      const text = el.getAttribute("title");
      if (!text) return;
      el.dataset.tooltipText = text;
      el.removeAttribute("title");
      currentElRef.current = el;

      timerRef.current = window.setTimeout(() => {
        setTooltip({ text, anchor: el.getBoundingClientRect() });
      }, SHOW_DELAY_MS);
    }

    function onOut(e: MouseEvent) {
      const el = currentElRef.current;
      if (!el) return;
      const related = e.relatedTarget as Node | null;
      if (related && el.contains(related)) return;
      clearTimer();
      restoreCurrent();
      setTooltip(null);
    }

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      clearTimer();
      restoreCurrent();
    };
  }, []);

  // Runs before paint, so an out-of-bounds guess never flashes on screen:
  // clamps horizontally within the viewport and flips above the anchor when
  // there isn't room below it.
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el || !tooltip) return;
    const { anchor } = tooltip;
    const tw = el.offsetWidth;
    const th = el.offsetHeight;

    let left = anchor.left + anchor.width / 2 - tw / 2;
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), window.innerWidth - tw - VIEWPORT_MARGIN);

    let top = anchor.bottom + 6;
    if (top + th > window.innerHeight - VIEWPORT_MARGIN) {
      top = anchor.top - th - 6;
    }
    top = Math.max(top, VIEWPORT_MARGIN);

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [tooltip]);

  if (!tooltip) return null;

  return (
    <div
      ref={tooltipRef}
      className="fixed z-[200] text-[11px] text-text-primary bg-bg-tertiary border border-border rounded-md px-2 py-1 shadow-[0_3px_10px_rgba(0,0,0,0.2)] pointer-events-none whitespace-nowrap"
    >
      {tooltip.text}
    </div>
  );
}
