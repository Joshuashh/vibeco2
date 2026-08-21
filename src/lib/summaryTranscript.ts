import type { Message } from "../types/message";
import { describeTool } from "../components/MessageBlock";

const MAX_RESULT_CHARS = 400;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Serializes a chat's transcript for feeding into a "summarize this into a
 * handoff brief" prompt. Richer than `buildTranscriptPreamble` (which names
 * tools but drops their arguments/results to stay cheap for its own
 * cross-account-resume purpose) — a good "what shipped" brief needs the
 * file paths touched, the commands run, and whether they succeeded.
 */
export function buildSummaryTranscript(messages: Message[]): string {
  const lines = messages.map((message) => {
    const label = message.role === "user" ? "User" : "Assistant";
    const parts = message.blocks.map((block) => {
      if (block.kind === "text") return block.text;
      if (block.kind === "attachment") return `[attached: ${block.name}]`;
      if (block.kind === "tool_use") {
        const { summary, fullPath } = describeTool(block.name, block.input);
        const target = fullPath ? ` (${fullPath})` : "";
        const result = block.result
          ? ` -> ${block.result.isError ? "error: " : "ok: "}${truncate(block.result.content, MAX_RESULT_CHARS)}`
          : "";
        return `[tool: ${summary}${target}${result}]`;
      }
      if (block.kind === "handoff_brief") return block.text;
      return "";
    });
    return `${label}: ${parts.join(" ")}`;
  });

  return lines.join("\n");
}
