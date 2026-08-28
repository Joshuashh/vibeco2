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

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-2" />
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
  onUnassign,
  onToggleOpen,
  canShelve,
  shelving,
  onShelve,
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
  onUnassign?: () => Promise<void>;
  onToggleOpen?: () => void;
  canShelve?: boolean;
  shelving?: boolean;
  onShelve?: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const myColor = self?.email ? colorForUser(self.email) : "var(--accent)";
  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div className="flex items-center justify-center relative py-[0.9em] px-[1em] shrink-0">
        {(onHandoff && assignableTeammates) || onToggleOpen ? (
          <div className="absolute left-[1em] flex items-center gap-[0.3em]">
            {onHandoff && assignableTeammates && (
              <AssignChatMenu assignedTo={chat.handed_off_to} teammates={assignableTeammates} onAssign={onHandoff} onUnassign={onUnassign} />
            )}
            {onToggleOpen && (
              <button
                type="button"
                className="icon-button"
                title={chat.open ? "Open — any teammate can respond. Click to restrict to the claimant." : "Restricted to the claimant. Click to open to teammates."}
                style={chat.open ? { color: "var(--accent)" } : undefined}
                onClick={onToggleOpen}
              >
                {chat.open ? <UnlockIcon /> : <LockIcon />}
              </button>
            )}
          </div>
        ) : null}
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
          {canShelve && (
            <button
              type="button"
              onClick={onShelve}
              disabled={shelving}
              title="Queue this chat's changes to merge into team"
              className="text-[12px] rounded-md px-[0.7em] py-[0.3em] cursor-pointer max-w-[160px] truncate transition-colors disabled:cursor-default disabled:opacity-60"
              style={{
                color: "var(--text-primary)",
                background: `color-mix(in srgb, ${myColor} 14%, transparent)`,
                border: `1px solid color-mix(in srgb, ${myColor} 32%, transparent)`,
              }}
            >
              {shelving ? "Rendering…" : "Add to Queue"}
            </button>
          )}
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
          <MessageList chatId={chat.id} messages={messages} streaming={streaming} teammates={assignableTeammates ?? []} />
        </div>
      )}
    </div>
  );
}
