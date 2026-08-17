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
    <div className="chat-view-shell">
      <div className="chat-view-titlebar">
        <span className="chat-view-title">{chat.title ?? "Untitled chat"}</span>
        {claimant && (
          <span className="chat-view-claim" title={`${isSelf ? "You" : claimant} claimed this chat`}>
            <span className="claim-dot" style={{ background: colorForUser(claimant) }} />
            {isSelf ? "You" : claimant}
          </span>
        )}
        <div className="chat-view-titlebar-actions">
          <ChatCardMenu title={chat.title ?? "Untitled chat"} onRename={onRename} onDelete={onDelete} />
        </div>
      </div>
      <div className="chat-view">
        <MessageList messages={messages} streaming={streaming} />
      </div>
    </div>
  );
}
