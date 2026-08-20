// Fractional ordering: a dropped item's new sort_order sits between its new
// neighbors' values rather than renumbering the whole list on every drag.
export function computeSortOrder(before: number | null, after: number | null): number {
  if (before == null && after == null) return Date.now() / 1000;
  if (before == null) return after! - 1;
  if (after == null) return before + 1;
  return (before + after) / 2;
}
