import { describe, it, expect } from "vitest";
import { buildSummaryTranscript } from "./summaryTranscript";
import type { Message } from "../types/message";

describe("buildSummaryTranscript", () => {
  it("renders user and assistant text turns with role labels", () => {
    const messages: Message[] = [
      { role: "user", complete: true, blocks: [{ kind: "text", text: "fix the bug" }] },
      { role: "assistant", complete: true, blocks: [{ kind: "text", text: "done" }] },
    ];
    const result = buildSummaryTranscript(messages);
    expect(result).toContain("User: fix the bug");
    expect(result).toContain("Assistant: done");
  });

  it("includes the file path and result for tool calls, unlike the lossy preamble format", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        complete: true,
        blocks: [
          {
            kind: "tool_use",
            id: "1",
            name: "Edit",
            input: { file_path: "src/App.tsx", old_string: "a", new_string: "b" },
            result: { isError: false, content: "ok" },
          },
        ],
      },
    ];
    const result = buildSummaryTranscript(messages);
    expect(result).toContain("src/App.tsx");
    expect(result).toContain("ok: ok");
  });

  it("truncates long tool results instead of dumping them in full", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        complete: true,
        blocks: [
          { kind: "tool_use", id: "1", name: "Bash", input: { command: "cat big.txt" }, result: { isError: false, content: "x".repeat(5000) } },
        ],
      },
    ];
    const result = buildSummaryTranscript(messages);
    expect(result.length).toBeLessThan(600);
  });

  it("passes handoff_brief text through unchanged", () => {
    const messages: Message[] = [
      { role: "assistant", complete: true, blocks: [{ kind: "handoff_brief", text: "prior brief", briefKind: "checkpoint" }] },
    ];
    expect(buildSummaryTranscript(messages)).toContain("prior brief");
  });
});
