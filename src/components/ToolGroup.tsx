import { useState } from "react";
import type { ContentBlock } from "../types/message";
import { ToolCallRow, describeTool, diffStats } from "./MessageBlock";

type ToolUseBlock = Extract<ContentBlock, { kind: "tool_use" }>;

function groupLabel(block: ToolUseBlock): string {
  const { file } = describeTool(block.name, block.input);
  switch (block.name) {
    case "Edit":
      return `Edited ${file ?? "a file"}`;
    case "Write":
      return `Wrote ${file ?? "a file"}`;
    case "Read":
      return `Read ${file ?? "a file"}`;
    case "Bash":
      return "ran a command";
    default:
      return block.name;
  }
}

// Groups consecutive tool_use blocks in one turn into a single collapsed
// summary line — "Edited X, ran a command +3 -1" — matching the sibling
// Claude apps' compact per-turn tool summary instead of one row per call.
export function ToolGroup({ blocks }: { blocks: ToolUseBlock[] }) {
  const [expanded, setExpanded] = useState(false);

  const labels = blocks.map(groupLabel);
  const sentence = labels.join(", ");

  let added = 0;
  let removed = 0;
  let anyError = false;
  let allDone = true;
  for (const block of blocks) {
    const { diff } = describeTool(block.name, block.input);
    const stats = diffStats(diff);
    added += stats.added;
    removed += stats.removed;
    if (block.result?.isError) anyError = true;
    if (block.result == null) allDone = false;
  }
  const hasDiffStat = added > 0 || removed > 0;

  return (
    <div className="mt-[0.6em] mb-[0.6em]">
      <div
        className="flex items-center gap-[0.5em] min-w-0 text-[13px] text-text-tertiary cursor-default"
        onClick={() => setExpanded((e) => !e)}
      >
        {!allDone ? (
          <span className="flex w-[14px] h-[14px] shrink-0 text-accent">
            <span className="text-[12px]">✻</span>
          </span>
        ) : (
          <span
            className={`flex w-[14px] h-[14px] shrink-0 [&>svg]:w-full [&>svg]:h-full ${
              anyError ? "text-conflict" : "text-text-tertiary"
            }`}
          >
            {anyError ? (
              <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
          </span>
        )}
        <span className="truncate">{sentence}</span>
        {hasDiffStat && (
          <span className="shrink-0 font-[SF_Mono,monospace] text-[12px] flex items-center gap-[0.4em]">
            {added > 0 && <span className="text-merged">+{added}</span>}
            {removed > 0 && <span className="text-conflict">-{removed}</span>}
          </span>
        )}
        <span className={`shrink-0 text-text-tertiary transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}>
          ›
        </span>
      </div>
      {expanded && (
        <div className="mt-[0.4em] flex flex-col gap-[0.5em] pl-[1.1em] border-l border-border">
          {blocks.map((block) => (
            <ToolCallRow key={block.id} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}
