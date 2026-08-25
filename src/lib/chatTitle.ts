const MAX_WORDS = 5;

// Caps any title-like string to `max` words, appending an ellipsis if
// anything was cut. Shared by deriveChatTitle below and App.tsx's
// post-processing of the AI-generated title (claude_summary.rs's prompt
// asks for "4-5 words," but nothing enforces that on the model's output —
// this is the actual backstop).
export function capWords(text: string, max: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= max) return text;
  return `${words.slice(0, max).join(" ")}…`;
}

// First line of the prompt, collapsed and capped to a handful of words —
// good enough as the instant default title while generate_chat_title's AI
// call is still in flight; the user can rename manually at any point.
export function deriveChatTitle(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  return capWords(collapsed, MAX_WORDS);
}
