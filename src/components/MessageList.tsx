import { useEffect, useRef } from "react";
import type { Message } from "../types/message";
import { MessageBlock } from "./MessageBlock";
import { ThinkingIndicator } from "./ThinkingIndicator";

export function MessageList({ messages, streaming }: { messages: Message[]; streaming: boolean }) {
  // ponytail: resets to "now" on every streaming-start rather than tracking the
  // real turn-start timestamp from the backend — good enough for an elapsed
  // counter, would need a real timestamp if this ever needs to survive a reload.
  const streamStartRef = useRef<number | null>(null);
  useEffect(() => {
    streamStartRef.current = streaming ? Date.now() : null;
  }, [streaming]);

  return (
    <div className="message-list">
      {messages.map((message, i) =>
        message.role === "user" ? (
          <div key={i} className="message-user">
            <div className="message-bubble">
              {message.blocks.map((block, j) => (
                <MessageBlock key={j} block={block} />
              ))}
            </div>
          </div>
        ) : (
          <div key={i} className="message-assistant">
            {message.blocks.map((block, j) => (
              <MessageBlock key={j} block={block} />
            ))}
          </div>
        )
      )}
      {streaming && <ThinkingIndicator startedAt={streamStartRef.current ?? Date.now()} />}
    </div>
  );
}
