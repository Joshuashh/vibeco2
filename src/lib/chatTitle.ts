const MAX_LENGTH = 48;

// First line of the prompt, collapsed and truncated at a word boundary —
// good enough as a default title; the user can still rename manually.
export function deriveChatTitle(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_LENGTH) return collapsed;
  const truncated = collapsed.slice(0, MAX_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  const cut = lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
  return `${cut.trim()}…`;
}
