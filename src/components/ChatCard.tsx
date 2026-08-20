import { useState } from "react";
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { colorForUser } from "../lib/presenceColor";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";
import { ChatCardMenu } from "./ChatCardMenu";
import type { ChatRow } from "../types/chat";
import type { ChatState } from "../lib/chatStore";

export interface ChatCardData {
  chat: ChatRow;
  state: ChatState;
  claimant: string | null;
  isSelf: boolean;
  mergeStatus: "merged" | "held" | "conflict" | null;
  onSend: (chatId: string, prompt: string) => void;
  onStop: (chatId: string) => void;
  onLeave: (chatId: string) => void;
  onDelete: (chatId: string) => void;
  onArchive: (chatId: string) => void;
  onExpand: (chatId: string) => void;
  onRename: (chatId: string, title: string) => void;
  [key: string]: unknown;
}

export type ChatCardNode = Node<ChatCardData, "chatCard">;

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

function LeaveIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

export function ChatCard({ data }: NodeProps<ChatCardNode>) {
  const { chat, state, claimant, isSelf, mergeStatus, onSend, onStop, onLeave, onDelete, onArchive, onExpand, onRename } = data;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const claimedByOther = claimant !== null && !isSelf;
  const flagged = mergeStatus === "held" || mergeStatus === "conflict";

  function handleDeleteClick() {
    if (claimant) return;
    if (confirmingDelete) {
      onDelete(chat.id);
    } else {
      setConfirmingDelete(true);
    }
  }

  return (
    <div className={flagged ? `chat-card chat-card-${mergeStatus}` : "chat-card"}>
      <NodeResizer minWidth={420} minHeight={320} lineClassName="chat-card-resize-line" handleClassName="chat-card-resize-handle" />
      <div className="chat-card-header">
        <span className="chat-card-title">{chat.title ?? "Untitled chat"}</span>
        <div className="chat-card-actions">
          {flagged && <span className="chat-card-badge">⚠ {mergeStatus}</span>}
          <button className="icon-button" title="Expand" onClick={() => onExpand(chat.id)}>
            <ExpandIcon />
          </button>
          {isSelf && (
            <button className="icon-button" title="Leave" onClick={() => onLeave(chat.id)}>
              <LeaveIcon />
            </button>
          )}
          {!claimant && (
            <button
              className={confirmingDelete ? "icon-button icon-button-danger" : "icon-button"}
              title={confirmingDelete ? "Confirm delete?" : "Delete"}
              onClick={handleDeleteClick}
            >
              <TrashIcon />
            </button>
          )}
          <ChatCardMenu
            title={chat.title ?? "Untitled chat"}
            onRename={(title) => onRename(chat.id, title)}
            onArchive={() => onArchive(chat.id)}
          />
        </div>
      </div>
      {claimant && (
        <div className="chat-card-claim" style={{ borderLeftColor: colorForUser(claimant) }}>
          <span className="claim-dot" style={{ background: colorForUser(claimant) }} />
          {claimant} is working here
        </div>
      )}
      {/* nowheel deliberately omitted: two-finger pan/pinch-zoom on the
          canvas should work even with the pointer over a card's message
          list — trades away scrolling a long history via mouse wheel while
          hovering it on the canvas; open the chat for that instead. */}
      <div className="nodrag chat-card-scroll-region">
        <MessageList messages={state.messages} streaming={state.streaming} />
      </div>
      <div className="nodrag nowheel">
        <InputBar
          onSend={(prompt) => onSend(chat.id, prompt)}
          onStop={() => onStop(chat.id)}
          streaming={state.streaming}
          disabled={claimedByOther || state.streaming}
        />
      </div>
    </div>
  );
}
