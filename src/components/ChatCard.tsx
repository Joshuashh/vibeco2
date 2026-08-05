import { useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { MessageBlock } from "./MessageBlock";
import { InputBar } from "./InputBar";
import type { ChatRow } from "../types/chat";
import type { ChatState } from "../lib/chatStore";

export interface ChatCardData {
  chat: ChatRow;
  state: ChatState;
  claimant: string | null;
  isSelf: boolean;
  mergeStatus: "merged" | "held" | "conflict" | null;
  onSend: (chatId: string, prompt: string) => void;
  onLeave: (chatId: string) => void;
  onDelete: (chatId: string) => void;
  onExpand: (chatId: string) => void;
  [key: string]: unknown;
}

export type ChatCardNode = Node<ChatCardData, "chatCard">;

export function ChatCard({ data }: NodeProps<ChatCardNode>) {
  const { chat, state, claimant, isSelf, mergeStatus, onSend, onLeave, onDelete, onExpand } = data;
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
      <div className="chat-card-header">
        <span className="chat-card-title">{chat.title ?? "Untitled chat"}</span>
        {flagged && <span className="chat-card-badge">⚠ {mergeStatus}</span>}
        <div className="chat-card-actions">
          <button onClick={() => onExpand(chat.id)}>Expand</button>
          {isSelf && <button onClick={() => onLeave(chat.id)}>Leave</button>}
          {!claimant && (
            <button onClick={handleDeleteClick}>{confirmingDelete ? "Confirm delete?" : "Delete"}</button>
          )}
        </div>
      </div>
      {claimant && <div className="chat-card-claim">{claimant} is working here</div>}
      <div className="chat-card-messages">
        {state.messages.slice(-6).map((message, i) => (
          <div key={i} className="message">
            {message.blocks.map((block, j) => (
              <MessageBlock key={j} block={block} />
            ))}
            {!message.complete && <span className="thinking-indicator">●</span>}
          </div>
        ))}
      </div>
      <InputBar onSend={(prompt) => onSend(chat.id, prompt)} disabled={claimedByOther || state.streaming} />
    </div>
  );
}
