import { describe, it, expect } from "vitest";
import { countByStatus, latestStatusByChat, type MergeEvent } from "./mergeEvents";

function event(overrides: Partial<MergeEvent>): MergeEvent {
  return {
    id: "e1",
    chat_id: "c1",
    status: "merged",
    detail: null,
    created_at: "2026-08-05T00:00:00Z",
    ...overrides,
  };
}

describe("countByStatus", () => {
  it("tallies events by status", () => {
    const events = [event({ status: "merged" }), event({ status: "held" }), event({ status: "merged" })];
    expect(countByStatus(events)).toEqual({ merged: 2, held: 1, conflict: 0 });
  });

  it("returns zeroes for an empty list", () => {
    expect(countByStatus([])).toEqual({ merged: 0, held: 0, conflict: 0 });
  });
});

describe("latestStatusByChat", () => {
  it("picks the most recent event per chat", () => {
    const events = [
      event({ chat_id: "c1", status: "held", created_at: "2026-08-05T00:00:00Z" }),
      event({ chat_id: "c1", status: "merged", created_at: "2026-08-05T01:00:00Z" }),
      event({ chat_id: "c2", status: "conflict", created_at: "2026-08-05T00:30:00Z" }),
    ];
    expect(latestStatusByChat(events)).toEqual({ c1: "merged", c2: "conflict" });
  });

  it("ignores events with no chat_id", () => {
    const events = [event({ chat_id: null })];
    expect(latestStatusByChat(events)).toEqual({});
  });
});
