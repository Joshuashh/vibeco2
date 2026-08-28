import { useEffect, useMemo, useRef, useState } from "react";
import type { ContentBlock, Message } from "../types/message";
import { MessageBlock } from "./MessageBlock";
import { ToolGroup } from "./ToolGroup";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { formatRelativeTimeLong } from "../lib/time";
import { colorForUser, displayNameForUser } from "../lib/presenceColor";
import { useHoverKey } from "../lib/useHoverKey";
import type { AssignableTeammate } from "./AssignChatMenu";

type ToolUseBlock = Extract<ContentBlock, { kind: "tool_use" }>;

// Consecutive tool_use blocks in one turn render as a single ToolGroup
// summary instead of one row per call; text blocks pass through unchanged.
// `liveTextIndex` marks the one block (if any) that's still actively
// streaming, so only it gets the smoothed-reveal treatment.
function renderBlocks(
  blocks: ContentBlock[],
  markdown: boolean,
  liveTextIndex: number | null,
  createdAt: string | undefined,
  teammates: AssignableTeammate[]
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
      out.push(
        <MessageBlock
          key={j}
          block={block}
          markdown={markdown}
          live={j === liveTextIndex}
          createdAt={createdAt}
          teammates={teammates}
        />
      );
    }
  });
  flush();
  return out;
}

// Cap on how many trailing messages mount by default. A long chat's history
// mounting all at once means every message's markdown gets parsed by
// react-markdown synchronously on that first render — the real cost behind
// the multi-second delay switching into a long chat (see decisions.md
// "Message list re-renders re-parsing markdown, memoized"). Older messages
// are one click away via the reveal button, not lost.
const INITIAL_MESSAGE_WINDOW = 40;
const REVEAL_STEP = 60;

export function MessageList({
  chatId,
  messages,
  streaming,
  teammates = [],
}: {
  chatId: string;
  messages: Message[];
  streaming: boolean;
  teammates?: AssignableTeammate[];
}) {
  // ponytail: resets to "now" on every streaming-start rather than tracking the
  // real turn-start timestamp from the backend — good enough for an elapsed
  // counter, would need a real timestamp if this ever needs to survive a reload.
  const streamStartRef = useRef<number | null>(null);
  useEffect(() => {
    streamStartRef.current = streaming ? Date.now() : null;
  }, [streaming]);

  // Resets per chat (not per message-count change) so switching chats within
  // an already-mounted ChatView/AgentWindow re-caps the window instead of
  // carrying over whatever was revealed in the previous chat.
  const [visibleCount, setVisibleCount] = useState(INITIAL_MESSAGE_WINDOW);
  useEffect(() => {
    setVisibleCount(INITIAL_MESSAGE_WINDOW);
  }, [chatId]);

  const hiddenCount = Math.max(0, messages.length - visibleCount);
  const visibleMessages = hiddenCount > 0 ? messages.slice(hiddenCount) : messages;
  const indexOffset = hiddenCount;

  // A solo chat with Claude has one author for every user message — only
  // worth labeling bubbles once a second human's messages show up in it.
  const distinctAuthors = useMemo(
    () => new Set(messages.filter((m) => m.authorEmail).map((m) => m.authorEmail)),
    [messages]
  );
  const showAuthors = distinctAuthors.size > 1;

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streaming]);

  // Timestamp fades in on row hover. Tracked via useHoverKey rather than
  // enter/leave events or CSS :hover: streaming messages shift rows under a
  // stationary cursor, and WKWebView won't re-evaluate hover for that on its
  // own. recheck() on every render covers the row-shifted-under-cursor case.
  const { hoverKey, recheck } = useHoverKey("[data-hover-key]");
  useEffect(recheck);
  const hoveredIndex = hoverKey == null ? null : Number(hoverKey);

  return (
    <div className="message-list">
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setVisibleCount((v) => v + REVEAL_STEP)}
          className="self-center text-[12px] text-text-tertiary bg-bg-tertiary border border-border rounded-md px-[0.9em] py-[0.4em] mb-[0.6em] cursor-pointer hover:text-text-primary"
        >
          Show {Math.min(hiddenCount, REVEAL_STEP)} earlier message{Math.min(hiddenCount, REVEAL_STEP) === 1 ? "" : "s"}
        </button>
      )}
      {visibleMessages.map((message, vi) => {
        const i = vi + indexOffset;
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
          <div key={i} data-hover-key={i} className="flex flex-col items-end">
            {showAuthors && message.authorEmail && (
              <span
                className="text-[13px] font-bold mb-[6px] mr-[2px]"
                style={{ color: colorForUser(message.authorEmail) }}
              >
                {displayNameForUser(message.authorEmail)}
              </span>
            )}
            <div
              className={`rounded-2xl px-[14px] py-[9px] max-w-[82%] ${message.authorEmail ? "" : "bg-user-bubble"}`}
              style={message.authorEmail ? { background: `${colorForUser(message.authorEmail)}26` } : undefined}
            >
              {renderBlocks(message.blocks, false, liveTextIndex, message.createdAt, teammates)}
            </div>
            {timestamp}
          </div>
        ) : (
          <div key={i} data-hover-key={i} className="text-text-primary">
            {renderBlocks(message.blocks, true, liveTextIndex, message.createdAt, teammates)}
            {timestamp}
          </div>
        );
      })}
      {streaming && <ThinkingIndicator startedAt={streamStartRef.current ?? Date.now()} />}
      <div ref={bottomRef} />
    </div>
  );
}
