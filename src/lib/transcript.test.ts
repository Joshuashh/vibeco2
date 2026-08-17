import { describe, it, expect } from "vitest";
import { buildTranscriptPreamble } from "./transcript";
import type { Message } from "../types/message";

describe("buildTranscriptPreamble", () => {
  it("returns an empty string for no prior messages", () => {
    expect(buildTranscriptPreamble([])).toBe("");
  });

  it("renders user and assistant text turns with role labels", () => {
    const messages: Message[] = [
      { role: "user", complete: true, blocks: [{ kind: "text", text: "hi" }] },
      { role: "assistant", complete: true, blocks: [{ kind: "text", text: "hello there" }] },
    ];
    const result = buildTranscriptPreamble(messages);
    expect(result).toContain("User: hi");
    expect(result).toContain("Assistant: hello there");
  });

  it("summarizes tool-use blocks without dumping full output", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        complete: true,
        blocks: [{ kind: "tool_use", id: "1", name: "Read", input: {}, result: { isError: false, content: "x".repeat(5000) } }],
      },
    ];
    const result = buildTranscriptPreamble(messages);
    expect(result).toContain("[used tool: Read]");
    expect(result.length).toBeLessThan(500);
  });

  it("wraps the transcript with a framing preamble/marker", () => {
    const messages: Message[] = [{ role: "user", complete: true, blocks: [{ kind: "text", text: "hi" }] }];
    const result = buildTranscriptPreamble(messages);
    expect(result.startsWith("[")).toBe(true);
    expect(result.trimEnd().endsWith("Continue from here.]")).toBe(true);
  });
});
