import { useEffect, useRef, useState } from "react";

// The CLI's real text deltas (see decisions.md's streaming fix) arrive in
// bursts of ~10-15 chars, not one char at a time — rendering each burst the
// instant it lands still reads as jarring "popping." This trickles already-
// arrived text onto screen at a steady rate instead, purely a display-layer
// smoothing — it never waits for text that hasn't arrived yet, and snaps to
// full immediately once `active` goes false so it can never be the reason a
// finished response looks incomplete.
const REVEAL_CHARS_PER_SEC = 260;
// If a burst pushes target far ahead of what's shown (e.g. a fast run of
// deltas), skip most of the backlog instantly and only trickle the tail —
// keeps the reveal from visibly lagging behind on long/fast responses.
const MAX_BACKLOG_CHARS = 120;

// Pure tick math, split out so it's testable without mocking rAF: given how
// much is currently shown vs. the full target and how much time passed,
// how much should now be shown? Clamped to target length either way.
export function nextRevealedLength(currentLen: number, targetLen: number, dtMs: number): number {
  return Math.min(targetLen, currentLen + (REVEAL_CHARS_PER_SEC * dtMs) / 1000);
}

// If the backlog (unshown text) has grown past the cap, jump forward so
// only the most recent MAX_BACKLOG_CHARS keep trickling in.
export function catchUpBacklog(currentLen: number, targetLen: number): number {
  return targetLen - currentLen > MAX_BACKLOG_CHARS ? targetLen - MAX_BACKLOG_CHARS : currentLen;
}

export function useSmoothedText(target: string, active: boolean): string {
  const [revealed, setRevealed] = useState(() => (active ? "" : target));
  const revealedLenRef = useRef(active ? 0 : target.length);
  const lastTsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      revealedLenRef.current = target.length;
      setRevealed(target);
      return;
    }

    revealedLenRef.current = catchUpBacklog(revealedLenRef.current, target.length);

    lastTsRef.current = null;
    let rafId = requestAnimationFrame(function tick(ts) {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = ts - lastTsRef.current;
      lastTsRef.current = ts;
      revealedLenRef.current = nextRevealedLength(revealedLenRef.current, target.length, dt);
      setRevealed(target.slice(0, Math.floor(revealedLenRef.current)));
      if (revealedLenRef.current < target.length) {
        rafId = requestAnimationFrame(tick);
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [target, active]);

  return active ? revealed : target;
}
