export interface PreviewPin {
  id: string;
  x_pct: number;
  y_pct: number;
  text: string;
  resolved: boolean;
  created_by: string;
  created_at: string;
}

export interface PreviewPinReply {
  id: string;
  pin_id: string;
  text: string;
  created_by: string;
  created_at: string;
}

export interface PreviewStroke {
  id: string;
  path: { x_pct: number; y_pct: number }[];
  created_by: string;
  created_at: string;
}

/** Resolved-hide-by-default filtering for the comment panel (spec §5). */
export function visiblePins(pins: PreviewPin[], showResolved: boolean): PreviewPin[] {
  return showResolved ? pins : pins.filter((p) => !p.resolved);
}

/** Undo only ever removes the current user's own most recent stroke (spec §4). */
export function lastOwnStroke(strokes: PreviewStroke[], userId: string): PreviewStroke | null {
  const own = strokes.filter((s) => s.created_by === userId);
  if (own.length === 0) return null;
  return own.reduce((latest, s) => (s.created_at > latest.created_at ? s : latest));
}

export function repliesByPin(replies: PreviewPinReply[]): Record<string, PreviewPinReply[]> {
  const map: Record<string, PreviewPinReply[]> = {};
  for (const reply of replies) {
    (map[reply.pin_id] ??= []).push(reply);
  }
  return map;
}
