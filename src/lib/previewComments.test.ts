import { describe, it, expect } from "vitest";
import {
  visiblePins,
  pinsOnPage,
  lastOwnStroke,
  repliesByPin,
  type PreviewPin,
  type PreviewPinReply,
  type PreviewStroke,
} from "./previewComments";

function pin(overrides: Partial<PreviewPin> = {}): PreviewPin {
  return {
    id: "p1",
    x_pct: 10,
    y_pct: 10,
    text: "note",
    resolved: false,
    created_by: "u1",
    created_at: "2026-08-19T00:00:00Z",
    page_path: null,
    ...overrides,
  };
}

function stroke(overrides: Partial<PreviewStroke> = {}): PreviewStroke {
  return {
    id: "s1",
    path: [{ x_pct: 0, y_pct: 0 }],
    created_by: "u1",
    created_at: "2026-08-19T00:00:00Z",
    ...overrides,
  };
}

describe("visiblePins", () => {
  it("hides resolved pins by default", () => {
    const pins = [pin({ id: "p1", resolved: false }), pin({ id: "p2", resolved: true })];
    expect(visiblePins(pins, false)).toEqual([pins[0]]);
  });

  it("shows resolved pins when showResolved is true", () => {
    const pins = [pin({ id: "p1", resolved: false }), pin({ id: "p2", resolved: true })];
    expect(visiblePins(pins, true)).toEqual(pins);
  });
});

describe("pinsOnPage", () => {
  it("shows every pin when the current page isn't known yet", () => {
    const pins = [pin({ id: "p1", page_path: "/about" }), pin({ id: "p2", page_path: "/contact" })];
    expect(pinsOnPage(pins, null)).toEqual(pins);
  });

  it("shows only pins matching the current page, plus unscoped pins", () => {
    const pins = [
      pin({ id: "p1", page_path: "/about" }),
      pin({ id: "p2", page_path: "/contact" }),
      pin({ id: "p3", page_path: null }),
    ];
    expect(pinsOnPage(pins, "/about")).toEqual([pins[0], pins[2]]);
  });
});

describe("lastOwnStroke", () => {
  it("returns null when the user has no strokes", () => {
    const strokes = [stroke({ created_by: "other" })];
    expect(lastOwnStroke(strokes, "u1")).toBeNull();
  });

  it("returns the user's most recent stroke, ignoring other users' strokes", () => {
    const strokes = [
      stroke({ id: "s1", created_by: "u1", created_at: "2026-08-19T00:00:00Z" }),
      stroke({ id: "s2", created_by: "other", created_at: "2026-08-19T00:02:00Z" }),
      stroke({ id: "s3", created_by: "u1", created_at: "2026-08-19T00:01:00Z" }),
    ];
    expect(lastOwnStroke(strokes, "u1")?.id).toBe("s3");
  });
});

describe("repliesByPin", () => {
  it("groups replies under their pin id", () => {
    const replies: PreviewPinReply[] = [
      { id: "r1", pin_id: "p1", text: "a", created_by: "u1", created_at: "2026-08-19T00:00:00Z" },
      { id: "r2", pin_id: "p2", text: "b", created_by: "u1", created_at: "2026-08-19T00:00:00Z" },
      { id: "r3", pin_id: "p1", text: "c", created_by: "u1", created_at: "2026-08-19T00:01:00Z" },
    ];
    expect(repliesByPin(replies)).toEqual({
      p1: [replies[0], replies[2]],
      p2: [replies[1]],
    });
  });

  it("returns an empty object for no replies", () => {
    expect(repliesByPin([])).toEqual({});
  });
});
