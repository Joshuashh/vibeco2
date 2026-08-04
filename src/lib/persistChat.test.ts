import { describe, it, expect } from "vitest";
import { messagesToRows, rowsToMessages } from "./persistChat";
import type { Message } from "../types/message";

describe("persistChat mapping", () => {
  it("round-trips messages through the row shape unchanged", () => {
    const messages: Message[] = [
      { role: "assistant", complete: true, blocks: [{ kind: "text", text: "hello" }] },
    ];
    const chatId = "chat-1";
    const rows = messagesToRows(chatId, messages);
    expect(rows).toEqual([{ chat_id: "chat-1", role: "assistant", blocks: messages[0].blocks }]);

    const restored = rowsToMessages(rows.map((r) => ({ ...r, id: "row-1", created_at: "2026-08-04" })));
    expect(restored).toEqual(messages);
  });
});
