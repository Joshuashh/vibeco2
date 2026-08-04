import type { Message } from "../types/message";
import { MessageBlock } from "./MessageBlock";

export function ChatView({ messages }: { messages: Message[] }) {
  return (
    <div className="chat-view">
      {messages.map((message, i) => (
        <div key={i} className="message">
          {message.blocks.map((block, j) => (
            <MessageBlock key={j} block={block} />
          ))}
          {!message.complete && <span className="thinking-indicator">●</span>}
        </div>
      ))}
    </div>
  );
}
