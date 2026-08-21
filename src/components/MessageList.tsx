import { useEffect, useRef } from "react";
import type { ContentBlock, Message } from "../types/message";
import { MessageBlock } from "./MessageBlock";
import { ToolGroup } from "./ToolGroup";
import { ThinkingIndicator } from "./ThinkingIndicator";

type ToolUseBlock = Extract<ContentBlock, { kind: "tool_use" }>;

// Consecutive tool_use blocks in one turn render as a single ToolGroup
// summary instead of one row per call; text blocks pass through unchanged.
// `liveTextIndex` marks the one block (if any) that's still actively
// streaming, so only it gets the smoothed-reveal treatment.
function renderBlocks(blocks: ContentBlock[], markdown: boolean, liveTextIndex: number | null) {
  const out: React.ReactNode[] = [];
  let buffer: ToolUseBlock[] = [];
  const flush = () => {
    if (buffer.length > 0) {
      out.push(<ToolGroup key={`tools-${out.length}`} blocks={buffer} />);
      buffer = [];
    }
  };
  blocks.forEach((block, j) => {
    if (block.kind === "tool_use") {
      buffer.push(block);
    } else {
      flush();
      out.push(<MessageBlock key={j} block={block} markdown={markdown} live={j === liveTextIndex} />);
    }
  });
  flush();
  return out;
}

export function MessageList({ messages, streaming }: { messages: Message[]; streaming: boolean }) {
  // ponytail: resets to "now" on every streaming-start rather than tracking the
  // real turn-start timestamp from the backend — good enough for an elapsed
  // counter, would need a real timestamp if this ever needs to survive a reload.
  const streamStartRef = useRef<number | null>(null);
  useEffect(() => {
    streamStartRef.current = streaming ? Date.now() : null;
  }, [streaming]);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streaming]);

  return (
    <div className="message-list">
      {messages.map((message, i) => {
        const isLastMessage = i === messages.length - 1;
        const trailingBlock = message.blocks[message.blocks.length - 1];
        const liveTextIndex =
          isLastMessage && streaming && !message.complete && trailingBlock?.kind === "text"
            ? message.blocks.length - 1
            : null;
        return message.role === "user" ? (
          <div key={i} className="flex justify-end">
            <div className="bg-user-bubble rounded-2xl px-[14px] py-[9px] max-w-[82%]">
              {renderBlocks(message.blocks, false, liveTextIndex)}
            </div>
          </div>
        ) : (
          <div key={i} className="text-text-primary">
            {renderBlocks(message.blocks, true, liveTextIndex)}
          </div>
        );
      })}
      {streaming && <ThinkingIndicator startedAt={streamStartRef.current ?? Date.now()} />}
      <div ref={bottomRef} />
    </div>
  );
}
