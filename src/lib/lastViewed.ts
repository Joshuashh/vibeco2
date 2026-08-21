import type { ChatRow } from "../types/chat";

const STORAGE_KEY = "vibeco:lastViewed";

// Per-device, not per-user or synced — a "have I looked at this chat since
// it last got activity" signal only needs to survive this machine's own
// reloads, not cross-device sync (see decisions.md's claim-model precedent
// for other client-local-only state in this app).
function readAll(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function markChatViewed(chatId: string) {
  const all = readAll();
  all[chatId] = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function isChatUnread(chat: ChatRow, lastViewed: Record<string, string>): boolean {
  if (!chat.last_message_at) return false;
  const viewed = lastViewed[chat.id];
  return !viewed || chat.last_message_at > viewed;
}

export function getLastViewed(): Record<string, string> {
  return readAll();
}
