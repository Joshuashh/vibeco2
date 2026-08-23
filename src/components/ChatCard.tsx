import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { colorForUser } from "../lib/presenceColor";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";
import { ChatCardMenu } from "./ChatCardMenu";
import { AssignChatMenu, type AssignableTeammate } from "./AssignChatMenu";
import type { ChatRow } from "../types/chat";
import type { SentAttachment } from "../types/message";
import type { ChatState } from "../lib/chatStore";

export interface ChatCardData {
  chat: ChatRow;
  state: ChatState;
  claimant: string | null;
  isSelf: boolean;
  mergeStatus: "merged" | "held" | "conflict" | null;
  onSend: (chatId: string, prompt: string, attachments?: SentAttachment[]) => void;
  onStop: (chatId: string) => void;
  onLeave: (chatId: string) => void;
  onDelete: (chatId: string) => void;
  onArchive: (chatId: string) => void;
  onExpand: (chatId: string) => void;
  onRename: (chatId: string, title: string) => void;
  assignableTeammates: AssignableTeammate[];
  onHandoff: (teammateEmail: string) => Promise<void>;
  onToggleOpen: () => void;
  mentioned: boolean;
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

function LeaveIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
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

export function ChatCard({ data }: NodeProps<ChatCardNode>) {
  const {
    chat,
    state,
    claimant,
    isSelf,
    mergeStatus,
    onSend,
    onStop,
    onLeave,
    onDelete,
    onArchive,
    onExpand,
    onRename,
    assignableTeammates,
    onHandoff,
    onToggleOpen,
    mentioned,
  } = data;
  const claimedByOther = claimant !== null && !isSelf;
  const flagged = mergeStatus === "held" || mergeStatus === "conflict";

  return (
    <div className={flagged ? `chat-card chat-card-${mergeStatus}` : "chat-card"}>
      <NodeResizer minWidth={420} minHeight={320} lineClassName="chat-card-resize-line" handleClassName="chat-card-resize-handle" />
      <div className="chat-card-header">
        <span className="chat-card-title">{chat.title ?? "Untitled chat"}</span>
        {mentioned && <span className="w-[6px] h-[6px] rounded-full shrink-0 bg-accent" title="You were mentioned" />}
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
          <button
            className="icon-button"
            title={chat.open ? "Open — any teammate can respond. Click to restrict to the claimant." : "Restricted to the claimant. Click to open to teammates."}
            style={chat.open ? { color: "var(--accent)" } : undefined}
            onClick={onToggleOpen}
          >
            {chat.open ? <UnlockIcon /> : <LockIcon />}
          </button>
          <AssignChatMenu assignedTo={chat.handed_off_to} teammates={assignableTeammates} onAssign={onHandoff} />
          <ChatCardMenu
            title={chat.title ?? "Untitled chat"}
            onRename={(title) => onRename(chat.id, title)}
            onArchive={() => onArchive(chat.id)}
            onDelete={claimant ? undefined : () => onDelete(chat.id)}
          />
        </div>
      </div>
      {claimant && (
        <div className="chat-card-claim" style={{ borderLeftColor: colorForUser(claimant) }}>
          <span className="claim-dot" style={{ background: colorForUser(claimant) }} />
          {claimant} is working here
        </div>
      )}
      {!claimant && chat.handed_off_to && (
        <div className="chat-card-claim" style={{ borderLeftColor: colorForUser(chat.handed_off_to) }}>
          <span className="claim-dot" style={{ background: colorForUser(chat.handed_off_to) }} />
          Assigned to {chat.handed_off_to}
        </div>
      )}
      {/* nowheel deliberately omitted: two-finger pan/pinch-zoom on the
          canvas should work even with the pointer over a card's message
          list — trades away scrolling a long history via mouse wheel while
          hovering it on the canvas; open the chat for that instead. */}
      <div className="nodrag chat-card-scroll-region">
        <MessageList messages={state.messages} streaming={state.streaming} teammates={assignableTeammates} />
      </div>
      <div className="nodrag nowheel">
        <InputBar
          chatId={chat.id}
          sessionId={chat.claude_session_id}
          onSend={(prompt, attachments) => onSend(chat.id, prompt, attachments)}
          onStop={() => onStop(chat.id)}
          streaming={state.streaming}
          disabled={(claimedByOther && !chat.open) || state.streaming}
          teammates={assignableTeammates}
        />
      </div>
    </div>
  );
}
