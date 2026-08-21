import { describe, it, expect } from "vitest";
import { reduceEvent, type Message } from "./message";

describe("reduceEvent", () => {
  it("appends a text block on text_delta", () => {
    const messages: Message[] = [];
    const result = reduceEvent(messages, { type: "text_delta", text: "Hi" });
    expect(result).toHaveLength(1);
    expect(result[0].blocks).toEqual([{ kind: "text", text: "Hi" }]);
  });

  it("merges consecutive text_deltas into one running text block instead of stacking separate blocks", () => {
    let messages: Message[] = [];
    messages = reduceEvent(messages, { type: "text_delta", text: "Ban" });
    messages = reduceEvent(messages, { type: "text_delta", text: "ana." });
    expect(messages).toHaveLength(1);
    expect(messages[0].blocks).toEqual([{ kind: "text", text: "Banana." }]);
  });

  it("starts a fresh text block for text_delta after an intervening tool_use", () => {
    let messages: Message[] = [];
    messages = reduceEvent(messages, { type: "text_delta", text: "Let me check " });
    messages = reduceEvent(messages, { type: "tool_use", id: "t1", name: "Read", input: {} });
    messages = reduceEvent(messages, { type: "text_delta", text: "Done." });
    expect(messages[0].blocks).toEqual([
      { kind: "text", text: "Let me check " },
      { kind: "tool_use", id: "t1", name: "Read", input: {}, result: null },
      { kind: "text", text: "Done." },
    ]);
  });

  it("keeps text and a following tool_use as one ordered block list on the same message", () => {
    let messages: Message[] = [];
    messages = reduceEvent(messages, { type: "text_delta", text: "Let me check " });
    messages = reduceEvent(messages, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" } });
    expect(messages).toHaveLength(1);
    expect(messages[0].blocks).toEqual([
      { kind: "text", text: "Let me check " },
      { kind: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" }, result: null },
    ]);
  });

  it("attaches a tool_result to the matching tool_use block by id", () => {
    let messages: Message[] = [];
    messages = reduceEvent(messages, { type: "tool_use", id: "t1", name: "Read", input: {} });
    messages = reduceEvent(messages, { type: "tool_result", tool_use_id: "t1", is_error: false, content: "file contents" });
    const block = messages[0].blocks[0];
    expect(block.kind).toBe("tool_use");
    if (block.kind === "tool_use") {
      expect(block.result).toEqual({ isError: false, content: "file contents" });
    }
  });

  it("starts a new message after turn_complete", () => {
    let messages: Message[] = [];
    messages = reduceEvent(messages, { type: "text_delta", text: "first turn" });
    messages = reduceEvent(messages, { type: "turn_complete" });
    messages = reduceEvent(messages, { type: "text_delta", text: "second turn" });
    expect(messages).toHaveLength(2);
    expect(messages[1].blocks).toEqual([{ kind: "text", text: "second turn" }]);
  });
});
