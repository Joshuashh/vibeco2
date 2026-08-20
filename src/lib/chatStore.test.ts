import { describe, it, expect } from "vitest";
import { applyChatEvent, addUserMessage, initChatState } from "./chatStore";

describe("applyChatEvent", () => {
  it("creates state for an unseen chat id and reduces the event into it", () => {
    const result = applyChatEvent({}, { chatId: "c1", event: { type: "text_delta", text: "hi" } });
    expect(result.c1.messages).toEqual([
      { role: "assistant", complete: false, blocks: [{ kind: "text", text: "hi" }] },
    ]);
    expect(result.c1.streaming).toBe(true);
  });

  it("clears streaming on turn_complete for that chat only", () => {
    const states = {
      c1: { messages: [{ role: "assistant" as const, complete: false, blocks: [] }], streaming: true },
      c2: { messages: [], streaming: true },
    };
    const result = applyChatEvent(states, { chatId: "c1", event: { type: "turn_complete" } });
    expect(result.c1.streaming).toBe(false);
    expect(result.c2.streaming).toBe(true);
  });

  it("leaves other chats' state untouched", () => {
    const states = { c2: initChatState([{ role: "assistant" as const, complete: true, blocks: [] }]) };
    const result = applyChatEvent(states, { chatId: "c1", event: { type: "text_delta", text: "hi" } });
    expect(result.c2).toBe(states.c2);
  });
});

describe("addUserMessage", () => {
  it("appends a completed user message with a text block", () => {
    const result = addUserMessage({}, "c1", "build the login form");
    expect(result.c1.messages).toEqual([
      { role: "user", complete: true, blocks: [{ kind: "text", text: "build the login form" }] },
    ]);
  });

  it("leaves streaming state untouched", () => {
    const states = { c1: { messages: [], streaming: true } };
    const result = addUserMessage(states, "c1", "hi");
    expect(result.c1.streaming).toBe(true);
  });
});
