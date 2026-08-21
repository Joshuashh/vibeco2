import type { ChatRow } from "../types/chat";
import type { SentAttachment } from "../types/message";
import type { ChatState } from "../lib/chatStore";
import type { Occupant } from "../lib/claim";
import type { AssignableTeammate } from "./AssignChatMenu";
import { colorForUser } from "../lib/presenceColor";
import { ChatView } from "./ChatView";
import { InputBar } from "./InputBar";
import { ChatPicker } from "./ChatPicker";

export function ChatPane({
  chat,
  chats,
  onSelectChat,
  self,
  others,
  excludeChatId,
  state,
  claimant,
  isSelf,
  disabled,
  streaming,
  onSend,
  onStop,
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
  state: ChatState | undefined;
  claimant: string | null;
  isSelf: boolean;
  disabled: boolean;
  streaming: boolean;
  onSend: (prompt: string, attachments?: SentAttachment[]) => void;
  onStop: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  assignableTeammates?: AssignableTeammate[];
  onHandoff?: (teammateEmail: string) => Promise<void>;
}) {
  return (
    <div className="chat-pane flex-1 min-w-0 min-h-0 flex flex-col bg-chat-pane-bg border border-border rounded-xl overflow-hidden">
      <ChatView
        chat={chat}
        chats={chats}
        onSelectChat={onSelectChat}
        self={self}
        others={others}
        excludeChatId={excludeChatId}
        messages={state?.messages ?? []}
        streaming={state?.streaming ?? false}
        claimant={claimant}
        isSelf={isSelf}
        onRename={onRename}
        onDelete={onDelete}
        assignableTeammates={assignableTeammates}
        onHandoff={onHandoff}
      />
      <InputBar
        chatId={chat.id}
        onSend={onSend}
        onStop={onStop}
        disabled={disabled}
        streaming={streaming}
        accentColor={self?.email ? colorForUser(self.email) : undefined}
      />
    </div>
  );
}

export function ChatPaneEmpty({
  text,
  chats,
  onSelectChat,
  onCreateChat,
  self,
  others,
  excludeChatId,
}: {
  text: string;
  chats?: ChatRow[];
  onSelectChat?: (chatId: string) => void;
  onCreateChat?: () => void;
  self?: Occupant | null;
  others?: Occupant[];
  excludeChatId?: string | null;
}) {
  return (
    <div className="chat-pane flex-1 min-w-0 min-h-0 flex flex-col gap-[0.8em] bg-chat-pane-bg border border-border rounded-xl overflow-hidden items-center justify-center text-text-tertiary text-[0.9em]">
      <span>{text}</span>
      {chats && chats.length > 0 && onSelectChat && (
        <ChatPicker
          chats={chats}
          currentChatId={null}
          excludeChatId={excludeChatId}
          self={self ?? null}
          others={others ?? []}
          onSelect={onSelectChat}
          trigger={({ onClick, ref }) => (
            <button
              ref={ref}
              type="button"
              onClick={onClick}
              className="text-[13px] font-medium text-text-secondary bg-bg-tertiary border border-border rounded-md px-[0.8em] py-[0.4em] cursor-pointer"
            >
              Choose a chat…
            </button>
          )}
        />
      )}
      {onCreateChat && (
        <button
          type="button"
          onClick={onCreateChat}
          className="text-[13px] font-medium text-bg-primary bg-accent border-0 rounded-md px-[0.8em] py-[0.4em] cursor-pointer"
        >
          Start chat
        </button>
      )}
    </div>
  );
}
