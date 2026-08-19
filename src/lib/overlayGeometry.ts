export interface PercentPoint {
  x_pct: number;
  y_pct: number;
}

/** Converts a pointer event's client coordinates into a percentage position
 * (0-100) within `rect`, clamped to the container bounds — used so pins and
 * stroke points hold their on-screen spot as the preview container resizes,
 * per docs/superpowers/specs/2026-08-19-preview-review-page-design.md §2. */
export function clientPointToPercent(clientX: number, clientY: number, rect: DOMRect): PercentPoint {
  const x_pct = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
  const y_pct = clamp(((clientY - rect.top) / rect.height) * 100, 0, 100);
  return { x_pct, y_pct };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
