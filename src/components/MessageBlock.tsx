import { useState } from "react";
import type { ContentBlock } from "../types/message";

function describeTool(name: string, input: unknown): { summary: string; file: string | null } {
  const record = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "Read":
      return { summary: "Read", file: String(record.file_path ?? "") };
    case "Write":
      return { summary: "Write", file: String(record.file_path ?? "") };
    case "Edit":
      return { summary: "Edit", file: String(record.file_path ?? "") };
    case "Bash":
      return { summary: `Ran: ${String(record.command ?? "")}`, file: null };
    default:
      return { summary: name, file: null };
  }
}

export function MessageBlock({ block }: { block: ContentBlock }) {
  const [expanded, setExpanded] = useState(false);

  if (block.kind === "text") {
    return <p className="message-text">{block.text}</p>;
  }

  const { summary, file } = describeTool(block.name, block.input);
  const hasDetail = Boolean(block.result?.content);

  return (
    <div className="tool-block">
      <div
        className={`tool-row ${hasDetail ? "tool-row-expandable" : ""}`}
        onClick={() => hasDetail && setExpanded((e) => !e)}
      >
        {block.result == null ? (
          <span className="tool-icon tool-icon-pending">
            <span className="flower-spinner-small">✻</span>
          </span>
        ) : (
          <span className={`tool-icon ${block.result.isError ? "tool-icon-error" : "tool-icon-ok"}`}>
            {block.result.isError ? (
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
        <span className="tool-summary">{summary}</span>
        {file && <span className="tool-file">{file}</span>}
        {hasDetail && <span className={`tool-chevron ${expanded ? "tool-chevron-open" : ""}`}>›</span>}
      </div>
      {expanded && block.result && <pre className="tool-detail">{block.result.content}</pre>}
    </div>
  );
}
