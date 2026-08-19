import type { Message } from "../types/message";
import type { ChatRow } from "../types/chat";
import { MessageList } from "./MessageList";
import { ChatCardMenu } from "./ChatCardMenu";
import { colorForUser } from "../lib/presenceColor";

export function ChatView({
  chat,
  messages,
  streaming = false,
  claimant = null,
  isSelf = false,
  onRename,
  onDelete,
}: {
  chat: ChatRow;
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
        <span className="text-[13px] font-medium text-text-secondary">{chat.title ?? "Untitled chat"}</span>
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
