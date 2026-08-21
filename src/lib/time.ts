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
