import { useEffect, useRef, useState } from "react";
import type { ContentBlock, Message } from "../types/message";
import { MessageBlock } from "./MessageBlock";
import { ToolGroup } from "./ToolGroup";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { formatRelativeTimeLong } from "../lib/time";

type ToolUseBlock = Extract<ContentBlock, { kind: "tool_use" }>;

// Consecutive tool_use blocks in one turn render as a single ToolGroup
// summary instead of one row per call; text blocks pass through unchanged.
// `liveTextIndex` marks the one block (if any) that's still actively
// streaming, so only it gets the smoothed-reveal treatment.
function renderBlocks(
  blocks: ContentBlock[],
  markdown: boolean,
  liveTextIndex: number | null,
  createdAt: string | undefined
) {
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
      out.push(<MessageBlock key={j} block={block} markdown={markdown} live={j === liveTextIndex} createdAt={createdAt} />);
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

  // Driven by document-level mousemove instead of onMouseEnter/onMouseLeave
  // (or CSS :hover) on each row — this webview was intermittently dropping
  // the "leave" event (same underlying flakiness as the tooltip-stuck-open
  // bug fixed in TooltipHost), so the timestamp could get stuck showing.
  // Recomputing from scratch on every mousemove means there's no "leave"
  // signal to miss: no match under the cursor just means no highlighted row.
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const row = (e.target as Element | null)?.closest<HTMLElement>("[data-msg-index]");
      setHoveredIndex(row && listRef.current?.contains(row) ? Number(row.dataset.msgIndex) : null);
    }
    function onLeaveWindow() {
      setHoveredIndex(null);
    }
    // mouseleave doesn't bubble to document reliably — mouseout with a null
    // relatedTarget (nothing to move onto) is the correct "left the window"
    // signal, same pattern TooltipHost uses.
    function onOut(e: MouseEvent) {
      if (e.relatedTarget === null) onLeaveWindow();
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseout", onOut);
    window.addEventListener("blur", onLeaveWindow);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseout", onOut);
      window.removeEventListener("blur", onLeaveWindow);
    };
  }, []);

  return (
    <div className="message-list" ref={listRef}>
      {messages.map((message, i) => {
        const isLastMessage = i === messages.length - 1;
        const trailingBlock = message.blocks[message.blocks.length - 1];
        const liveTextIndex =
          isLastMessage && streaming && !message.complete && trailingBlock?.kind === "text"
            ? message.blocks.length - 1
            : null;
        // handoff_brief messages already carry an always-visible stamp in
        // their own card header — skip the per-message one for those.
        const isHandoffBrief = message.blocks.some((b) => b.kind === "handoff_brief");
        const timestamp = message.createdAt && !isHandoffBrief && (
          <div
            className={`text-[11px] text-text-tertiary mt-[4px] text-right transition-opacity ${
              hoveredIndex === i ? "opacity-100" : "opacity-0"
            }`}
          >
            {formatRelativeTimeLong(message.createdAt)}
          </div>
        );
        return message.role === "user" ? (
          <div key={i} data-msg-index={i} className="flex flex-col items-end">
            <div className="bg-user-bubble rounded-2xl px-[14px] py-[9px] max-w-[82%]">
              {renderBlocks(message.blocks, false, liveTextIndex, message.createdAt)}
            </div>
            {timestamp}
          </div>
        ) : (
          <div key={i} data-msg-index={i} className="text-text-primary">
            {renderBlocks(message.blocks, true, liveTextIndex, message.createdAt)}
            {timestamp}
          </div>
        );
      })}
      {streaming && <ThinkingIndicator startedAt={streamStartRef.current ?? Date.now()} />}
      <div ref={bottomRef} />
    </div>
  );
}
