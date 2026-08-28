import { useCallback, useEffect, useState } from "react";

// Hover tracking that survives WKWebView (the webview this app runs in on
// macOS) refusing to fire mouseleave / re-evaluate `:hover` when the DOM or
// layout shifts under a stationary pointer. That single quirk is behind a
// recurring class of "stuck hover" bugs here — the message timestamp that
// won't fade back out, the Cowork toolbar button that keeps its grey hover
// box after a click. Every earlier fix still assumed *some* leave signal
// (a real mouseleave, or at least a mousemove) would eventually arrive.
//
// This one assumes nothing. It re-derives "what is the pointer actually
// over right now" from document.elementFromPoint — on every pointer move,
// on every scroll, and (via the returned recheck(), called from a bare
// useEffect) once after each render of the calling component. There is no
// leave event to miss.
//
// Put the value you want to compare against in `data-hover-key` on the
// hoverable element; the hook returns that string, or null.
export function useHoverKey(selector: string) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const recheck = useCallback(() => {
    const p = lastPointer;
    if (!p) return;
    const hit = (document.elementFromPoint(p.x, p.y) as Element | null)?.closest<HTMLElement>(
      selector
    );
    setHoverKey(hit?.dataset.hoverKey ?? null);
  }, [selector]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      lastPointer = { x: e.clientX, y: e.clientY };
      recheck();
    }
    function onGone() {
      lastPointer = null;
      setHoverKey(null);
    }
    // mouseout with a null relatedTarget (nothing to move onto) is the one
    // "pointer left the window" signal WKWebView does still deliver.
    function onOut(e: MouseEvent) {
      if (e.relatedTarget === null) onGone();
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("scroll", recheck, true);
    document.addEventListener("mouseout", onOut);
    window.addEventListener("blur", onGone);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("scroll", recheck, true);
      document.removeEventListener("mouseout", onOut);
      window.removeEventListener("blur", onGone);
    };
  }, [recheck]);

  return { hoverKey, recheck };
}

// Module-level so every hook instance shares one reading and it survives
// re-renders without being a dependency anywhere.
let lastPointer: { x: number; y: number } | null = null;
