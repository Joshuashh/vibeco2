import type { Message } from "../types/message";
import { MessageList } from "./MessageList";

export function ChatView({ messages, streaming = false }: { messages: Message[]; streaming?: boolean }) {
  return (
    <div className="chat-view">
      <MessageList messages={messages} streaming={streaming} />
    </div>
  );
}
