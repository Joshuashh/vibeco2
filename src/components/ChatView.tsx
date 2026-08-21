import { useState } from "react";
import type { Message } from "../types/message";
import type { ChatRow } from "../types/chat";
import type { Occupant } from "../lib/claim";
import { MessageList } from "./MessageList";
import { ChatCardMenu } from "./ChatCardMenu";
import { AssignChatMenu, type AssignableTeammate } from "./AssignChatMenu";
import { ChatPicker } from "./ChatPicker";
import { ChatPreviewPanel } from "./ChatPreviewPanel";
import { colorForUser } from "../lib/presenceColor";

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function ChatView({
  chat,
  chats,
  onSelectChat,
  self,
  others,
  excludeChatId,
  messages,
  streaming = false,
  claimant = null,
  isSelf = false,
  onRename,
  onDelete,
  assignableTeammates,
  onHandoff,
}: {
  chat: ChatRow;
  chats?: ChatRow[];
  onSelectChat?: (chatId: string) => void;
  self?: Occupant | null;
  others?: Occupant[];
  excludeChatId?: string | null;
  messages: Message[];
  streaming?: boolean;
  claimant?: string | null;
  isSelf?: boolean;
  onRename: (title: string) => void;
  onDelete: () => void;
  assignableTeammates?: AssignableTeammate[];
  onHandoff?: (teammateEmail: string) => Promise<void>;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-center relative py-[0.9em] px-[1em] shrink-0">
        {onHandoff && assignableTeammates && (
          <div className="absolute left-[1em]">
            <AssignChatMenu assignedTo={chat.handed_off_to} teammates={assignableTeammates} onAssign={onHandoff} />
          </div>
        )}
        {chats && onSelectChat ? (
          <ChatPicker
            chats={chats}
            currentChatId={chat.id}
            excludeChatId={excludeChatId}
            self={self ?? null}
            others={others ?? []}
            onSelect={onSelectChat}
            trigger={({ onClick, ref }) => (
              <button
                ref={ref}
                type="button"
                onClick={onClick}
                title="Switch chat"
                className="appearance-none border-0 outline-none bg-transparent flex items-center gap-1 max-w-[60%] text-[13px] font-medium text-text-secondary cursor-pointer [&_svg]:w-3 [&_svg]:h-3 [&_svg]:shrink-0"
              >
                <span className="truncate">{chat.title ?? "Untitled chat"}</span>
                <ChevronDownIcon />
              </button>
            )}
          />
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
          <button
            type="button"
            onClick={() => setPreviewOpen((open) => !open)}
            title={previewOpen ? "Back to chat" : "Preview this chat's changes"}
            className="icon-button"
            style={previewOpen ? { color: "var(--accent)" } : undefined}
          >
            <EyeIcon />
          </button>
          <ChatCardMenu title={chat.title ?? "Untitled chat"} onRename={onRename} onDelete={onDelete} />
        </div>
      </div>
      {previewOpen ? (
        <ChatPreviewPanel chatId={chat.id} />
      ) : (
        <div className="chat-view">
          <MessageList messages={messages} streaming={streaming} />
        </div>
      )}
    </div>
  );
}
