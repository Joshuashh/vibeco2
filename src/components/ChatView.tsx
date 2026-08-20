import type { Message } from "../types/message";
import type { ChatRow } from "../types/chat";
import { MessageList } from "./MessageList";
import { ChatCardMenu } from "./ChatCardMenu";
import { colorForUser } from "../lib/presenceColor";

export function ChatView({
  chat,
  chats,
  onSelectChat,
  messages,
  streaming = false,
  claimant = null,
  isSelf = false,
  onRename,
  onDelete,
}: {
  chat: ChatRow;
  chats?: ChatRow[];
  onSelectChat?: (chatId: string) => void;
  messages: Message[];
  streaming?: boolean;
  claimant?: string | null;
  isSelf?: boolean;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-center relative py-[0.9em] px-[1em] shrink-0">
        {chats && onSelectChat ? (
          <select
            className="text-[13px] font-medium text-text-secondary bg-transparent border-none outline-none cursor-pointer max-w-[60%]"
            value={chat.id}
            onChange={(e) => onSelectChat(e.target.value)}
          >
            {chats.map((c) => (
              <option key={c.id} value={c.id} className="bg-bg-secondary text-text-primary">
                {c.title ?? "Untitled chat"}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[13px] font-medium text-text-secondary">{chat.title ?? "Untitled chat"}</span>
        )}
        {claimant && (
          <span
            className="flex items-center gap-[0.4em] ml-[0.8em] text-[12px] text-text-tertiary"
            title={`${isSelf ? "You" : claimant} claimed this chat`}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorForUser(claimant) }} />
            {isSelf ? "You" : claimant}
          </span>
        )}
        <div className="absolute right-[1em] flex items-center gap-[0.3em]">
          <ChatCardMenu title={chat.title ?? "Untitled chat"} onRename={onRename} onDelete={onDelete} />
        </div>
      </div>
      <div className="chat-view">
        <MessageList messages={messages} streaming={streaming} />
      </div>
    </div>
  );
}
