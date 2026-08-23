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

function hashColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash * 31 + email.charCodeAt(i)) | 0;
  }
  return PRESENCE_PALETTE[Math.abs(hash) % PRESENCE_PALETTE.length];
}

// Populated from the profiles table (see profiles.ts) so a user's chosen
// name/color take effect anywhere colorForUser/displayNameForUser is called,
// without plumbing profile data through every component that shows another
// user's identity.
const colorOverrides = new Map<string, string>();
const nameOverrides = new Map<string, string>();

export function setProfileOverrides(profiles: { email: string; display_name: string | null; color: string | null }[]) {
  colorOverrides.clear();
  nameOverrides.clear();
  for (const p of profiles) {
    if (p.color) colorOverrides.set(p.email, p.color);
    if (p.display_name) nameOverrides.set(p.email, p.display_name);
  }
}

/** Deterministic per-user color (same person, same color every session/machine) unless they've picked their own. */
export function colorForUser(email: string): string {
  return colorOverrides.get(email) ?? hashColor(email);
}

/** A user's chosen display name, falling back to their email. */
export function displayNameForUser(email: string): string {
  return nameOverrides.get(email) ?? email;
}

/** First palette color not in `taken` (falls back to the first color if somehow all are taken). */
export function pickUnusedColor(taken: Set<string>): string {
  return PRESENCE_PALETTE.find((c) => !taken.has(c)) ?? PRESENCE_PALETTE[0];
}

/** Black or white, whichever reads legibly on the given hex background (WCAG relative luminance). */
export function textColorForBackground(hex: string): "#000000" | "#ffffff" {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? "#000000" : "#ffffff";
}

/** Two-letter initials for an avatar circle, from a display name or bare email. */
export function initialsForUser(nameOrEmail: string): string {
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0] : nameOrEmail;
  const parts = base.split(/[\s.\-_+]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}
