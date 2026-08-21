const UNITS: [string, number][] = [
  ["y", 60 * 60 * 24 * 365],
  ["mo", 60 * 60 * 24 * 30],
  ["w", 60 * 60 * 24 * 7],
  ["d", 60 * 60 * 24],
  ["h", 60 * 60],
  ["m", 60],
];

// "3h", "2d" — short form, no seconds granularity (a running chat updates
// last_message_at often enough that second-level precision would flicker).
export function formatRelativeTime(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  for (const [suffix, secondsInUnit] of UNITS) {
    if (seconds >= secondsInUnit) return `${Math.floor(seconds / secondsInUnit)}${suffix}`;
  }
  return "now";
}

// "4 minutes ago", "17 minutes ago", "3hrs ago" — the wordier form used for
// message timestamps (hover tooltip, handoff-brief stamp), matching the
// sibling Claude Code GUI's phrasing rather than the sidebar's terse "3h".
export function formatRelativeTimeLong(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const [suffix, secondsInUnit] = UNITS.find(([, s]) => seconds >= s) ?? UNITS[UNITS.length - 1];
  return `${Math.floor(seconds / secondsInUnit)}${suffix} ago`;
}
