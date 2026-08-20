import type { ChatRow } from "../types/chat";

export interface ChatSection {
  title: string;
  chats: ChatRow[];
}

export function activeChats(chats: ChatRow[]): ChatRow[] {
  return chats.filter((c) => !c.archived_at);
}

export function filterChatsByTitle(chats: ChatRow[], query: string): ChatRow[] {
  if (!query.trim()) return chats;
  const q = query.toLowerCase();
  return chats.filter((c) => (c.title ?? "").toLowerCase().includes(q));
}

// Recents (ungrouped) first, then named groups alphabetically — each
// internally ordered by sort_order, the field drag-and-drop rewrites.
export function groupActiveChats(chats: ChatRow[]): ChatSection[] {
  const byGroup = new Map<string | null, ChatRow[]>();
  for (const chat of chats) {
    const key = chat.group_name;
    const list = byGroup.get(key) ?? [];
    list.push(chat);
    byGroup.set(key, list);
  }
  const groupNames = [...byGroup.keys()].filter((k): k is string => k != null).sort((a, b) => a.localeCompare(b));
  const sortBySort = (a: ChatRow, b: ChatRow) => a.sort_order - b.sort_order;
  const result: ChatSection[] = [
    { title: "RECENTS", chats: (byGroup.get(null) ?? []).sort(sortBySort) },
  ];
  for (const name of groupNames) {
    result.push({ title: name.toUpperCase(), chats: (byGroup.get(name) ?? []).sort(sortBySort) });
  }
  return result;
}
