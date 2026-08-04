import type { ContentBlock } from "../types/message";

function describeTool(name: string, input: unknown): string {
  const record = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "Read":
      return `Read ${String(record.file_path ?? "")}`;
    case "Write":
      return `Wrote ${String(record.file_path ?? "")}`;
    case "Edit":
      return `Edited ${String(record.file_path ?? "")}`;
    case "Bash":
      return `Ran: ${String(record.command ?? "")}`;
    default:
      return name;
  }
}

export function MessageBlock({ block }: { block: ContentBlock }) {
  if (block.kind === "text") {
    return <p className="message-text">{block.text}</p>;
  }

  return (
    <div className={`tool-row ${block.result?.isError ? "tool-row-error" : ""}`}>
      <span className="tool-summary">{describeTool(block.name, block.input)}</span>
      {block.result && <span className="tool-status">{block.result.isError ? "failed" : "done"}</span>}
    </div>
  );
}
