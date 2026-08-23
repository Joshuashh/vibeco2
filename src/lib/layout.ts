// Even 50/50 split, computed from the container's live width so a freshly
// opened resizable pane starts balanced instead of snapping to whatever the
// last drag left behind. clientWidth includes the container's own padding,
// which has to come out too — otherwise the fixed-width pane claims its
// share of that padding as real space while the flexible pane silently
// shrinks to absorb the overflow, so the "50/50" split reads lopsided.
export function defaultSplitPaneWidth(container: HTMLDivElement | null, gap = 12): number {
  if (!container) return (800 - gap) / 2;
  const style = getComputedStyle(container);
  const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  return (container.clientWidth - horizontalPadding - gap) / 2;
}
