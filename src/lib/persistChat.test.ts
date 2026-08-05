import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  messagesToRows,
  rowsToMessages,
  fetchAllChats,
  updateChatPosition,
  updateChatSessionId,
  deleteChat,
} from "./persistChat";
import type { Message } from "../types/message";
import { supabase } from "./supabase";

vi.mock("./supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

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

describe("fetchAllChats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all chat rows ordered by created_at", async () => {
    const order = vi.fn().mockResolvedValue({ data: [{ id: "c1" }], error: null });
    const select = vi.fn().mockReturnValue({ order });
    vi.mocked(supabase.from).mockReturnValue({ select } as never);

    const result = await fetchAllChats();

    expect(supabase.from).toHaveBeenCalledWith("chats");
    expect(select).toHaveBeenCalledWith("*");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(result).toEqual([{ id: "c1" }]);
  });
});

describe("updateChatPosition", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates position_x/position_y for the given chat id", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    vi.mocked(supabase.from).mockReturnValue({ update } as never);

    await updateChatPosition("c1", 10, 20);

    expect(supabase.from).toHaveBeenCalledWith("chats");
    expect(update).toHaveBeenCalledWith({ position_x: 10, position_y: 20 });
    expect(eq).toHaveBeenCalledWith("id", "c1");
  });
});

describe("updateChatSessionId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates claude_session_id for the given chat id", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    vi.mocked(supabase.from).mockReturnValue({ update } as never);

    await updateChatSessionId("c1", "sess-1");

    expect(update).toHaveBeenCalledWith({ claude_session_id: "sess-1" });
    expect(eq).toHaveBeenCalledWith("id", "c1");
  });
});

describe("deleteChat", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes the chat row by id", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn().mockReturnValue({ eq });
    vi.mocked(supabase.from).mockReturnValue({ delete: del } as never);

    await deleteChat("c1");

    expect(del).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith("id", "c1");
  });
});
