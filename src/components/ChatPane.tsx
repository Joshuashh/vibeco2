import type { ChatRow } from "../types/chat";
import type { ChatState } from "../lib/chatStore";
import { ChatView } from "./ChatView";
import { InputBar } from "./InputBar";

export function ChatPane({
  chat,
  state,
  claimant,
  isSelf,
  disabled,
  onSend,
  onRename,
  onDelete,
}: {
  chat: ChatRow;
  state: ChatState | undefined;
  claimant: string | null;
  isSelf: boolean;
  disabled: boolean;
  onSend: (prompt: string) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className="chat-pane">
      <ChatView
        chat={chat}
        messages={state?.messages ?? []}
        streaming={state?.streaming ?? false}
        claimant={claimant}
        isSelf={isSelf}
        onRename={onRename}
        onDelete={onDelete}
      />
      <InputBar chatId={chat.id} onSend={onSend} disabled={disabled} />
    </div>
  );
}

export function ChatPaneEmpty({ text }: { text: string }) {
  return (
    <div className="chat-pane chat-pane-empty">
      <span>{text}</span>
    </div>
  );
}
