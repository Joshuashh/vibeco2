export const MENTION_RE = /@([a-zA-Z0-9._-]+)/g;

// Lowercased email local-parts (the bit before @) mentioned in a message —
// matches how MentionMenu inserts them ("@ben"), so no teammate list needed
// to extract them, only to autocomplete them.
export function extractMentions(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) names.add(match[1].toLowerCase());
  return [...names];
}

// Broadcast over the same Liveblocks room event channel as ChatEnvelope
// (see liveblocks.ts) — `kind` distinguishes it from a chat turn event on
// the receiving end.
export interface MentionEvent {
  kind: "mention";
  chatId: string;
  chatTitle: string | null;
  fromEmail: string;
  mentioned: string[];
}
