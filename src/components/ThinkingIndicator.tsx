import { useEffect, useRef, useState } from "react";

function elapsedText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Hand-ported "Glyph Cluster" loader from https://dotmatrix.zzzzshawn.cloud
// (registry id dotm-circular-15) — a 5x5 grid with its 4 corners masked
// off, stepping through 6 named dot patterns on a loop; each new pattern's
// dots snap bright, the previous pattern's dots fade to mid, everything
// else sits at a low base (with a faint "plus" glow at the center when
// nothing else lights it). Only that per-cell opacity math is kept — not
// the site's shared ~1900-line color-preset/bloom/hover "core" + "hooks"
// library built to back its 90+ loader variants, which this app has no use
// for since it only ever renders this one fixed variant in currentColor.
const GRID = 5;
const DOT_PX = 3;
const GAP_PX = 1;
const CYCLE_MS = 1018; // matches the source's default: 1680ms cycle / 1.65 speed

const BASE_OPACITY = 0.07;
const MID_OPACITY = 0.34;
const HIGH_OPACITY = 0.95;

const CORNERS = new Set(["0,0", "0,4", "4,0", "4,4"]);

const PHASES: ReadonlySet<string>[] = [
  new Set(["1,1", "2,1", "3,1", "1,3", "2,3", "3,3"]), // rails
  new Set(["1,1", "2,1", "3,1", "2,2", "1,3", "2,3", "3,3"]), // center bridge
  new Set(["1,1", "1,2", "1,3", "2,1", "2,3", "3,1", "3,2", "3,3"]), // top+bottom bars
  new Set(["1,1", "3,1", "2,2", "1,3", "3,3"]), // X-cross
  new Set(["2,1", "1,2", "3,2", "2,3"]), // plus motif
  new Set(["1,1", "2,1", "2,2", "2,3", "3,3"]), // diagonal sweep
];

function opacityForCell(row: number, col: number, phaseIndex: number): number {
  const key = `${row},${col}`;
  const inPattern = PHASES[phaseIndex].has(key);
  if (inPattern) return HIGH_OPACITY;

  const prevIndex = (phaseIndex + PHASES.length - 1) % PHASES.length;
  if (PHASES[prevIndex].has(key)) return MID_OPACITY;

  const ring = Math.hypot(col - 2, row - 2);
  if (ring < 1.1) return 0.2;

  return BASE_OPACITY;
}

export function GlyphCluster() {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    startRef.current = performance.now();
    let rafId = 0;
    const tick = (now: number) => {
      const t = ((now - startRef.current) % CYCLE_MS) / CYCLE_MS;
      setPhaseIndex(Math.floor(t * PHASES.length) % PHASES.length);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const matrixPx = DOT_PX * GRID + GAP_PX * (GRID - 1);

  return (
    <div
      role="status"
      aria-label="Thinking"
      className="inline-grid text-accent shrink-0"
      style={{ width: matrixPx, height: matrixPx, gap: GAP_PX, gridTemplateColumns: `repeat(${GRID}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: GRID * GRID }).map((_, index) => {
        const row = Math.floor(index / GRID);
        const col = index % GRID;
        const active = !CORNERS.has(`${row},${col}`);
        const opacity = active ? opacityForCell(row, col, phaseIndex) : 0;
        return (
          <span
            key={index}
            aria-hidden="true"
            className="rounded-full bg-current"
            style={{ width: DOT_PX, height: DOT_PX, opacity }}
          />
        );
      })}
    </div>
  );
}

export function ThinkingIndicator({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-[0.5em] text-[12px] text-text-tertiary">
      <GlyphCluster />
      <span>Thinking · {elapsedText((now - startedAt) / 1000)}</span>
    </div>
  );
}
