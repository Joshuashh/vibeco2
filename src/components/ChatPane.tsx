import type { ChatRow } from "../types/chat";
import type { ChatState } from "../lib/chatStore";
import { ChatView } from "./ChatView";
import { InputBar } from "./InputBar";

export function ChatPane({
  chat,
  chats,
  onSelectChat,
  state,
  claimant,
  isSelf,
  disabled,
  onSend,
  onRename,
  onDelete,
}: {
  chat: ChatRow;
  chats?: ChatRow[];
  onSelectChat?: (chatId: string) => void;
  state: ChatState | undefined;
  claimant: string | null;
  isSelf: boolean;
  disabled: boolean;
  onSend: (prompt: string) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className="chat-pane flex-1 min-w-0 min-h-0 flex flex-col bg-[#14151a] border border-border rounded-2xl overflow-hidden">
      <ChatView
        chat={chat}
        chats={chats}
        onSelectChat={onSelectChat}
        messages={state?.messages ?? []}
        streaming={state?.streaming ?? false}
        claimant={claimant}
        isSelf={isSelf}
        onRename={onRename}
        onDelete={onDelete}
      />
      <InputBar onSend={onSend} disabled={disabled} />
    </div>
  );
}

export function ChatPaneEmpty({
  text,
  chats,
  onSelectChat,
}: {
  text: string;
  chats?: ChatRow[];
  onSelectChat?: (chatId: string) => void;
}) {
  return (
    <div className="chat-pane flex-1 min-w-0 min-h-0 flex flex-col gap-[0.8em] bg-[#14151a] border border-border rounded-2xl overflow-hidden items-center justify-center text-text-tertiary text-[0.9em]">
      <span>{text}</span>
      {chats && chats.length > 0 && onSelectChat && (
        <select
          className="text-[13px] font-medium text-text-secondary bg-bg-tertiary border border-border rounded-md px-[0.8em] py-[0.4em] cursor-pointer"
          defaultValue=""
          onChange={(e) => e.target.value && onSelectChat(e.target.value)}
        >
          <option value="" disabled>
            Choose a chat…
          </option>
          {chats.map((c) => (
            <option key={c.id} value={c.id} className="bg-bg-secondary text-text-primary">
              {c.title ?? "Untitled chat"}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
