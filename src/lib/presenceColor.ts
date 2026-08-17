export const PRESENCE_PALETTE = [
  "#ED6B26",
  "#5FD97A",
  "#4AA8E8",
  "#E8B84A",
  "#E2584F",
  "#A855F7",
  "#2DD4BF",
  "#F472B6",
] as const;

/** Deterministic per-user color (same person, same color every session/machine) — no stored color column needed. */
export function colorForUser(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash * 31 + email.charCodeAt(i)) | 0;
  }
  return PRESENCE_PALETTE[Math.abs(hash) % PRESENCE_PALETTE.length];
}
