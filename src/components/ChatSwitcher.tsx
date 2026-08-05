import type { ChatRow } from "../types/chat";

export function ChatSwitcher({
  chats,
  activeChatId,
  onSelect,
}: {
  chats: ChatRow[];
  activeChatId: string | null;
  onSelect: (chatId: string) => void;
}) {
  return (
    <select className="chat-switcher" value={activeChatId ?? ""} onChange={(e) => onSelect(e.target.value)}>
      {chats.length === 0 && <option value="">No chats yet</option>}
      {chats.map((chat) => (
        <option key={chat.id} value={chat.id}>
          {chat.title ?? chat.id.slice(0, 8)}
        </option>
      ))}
    </select>
  );
}
