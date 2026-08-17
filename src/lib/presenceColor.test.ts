import { describe, it, expect } from "vitest";
import { colorForUser, PRESENCE_PALETTE } from "./presenceColor";

describe("colorForUser", () => {
  it("is deterministic for the same email", () => {
    expect(colorForUser("josh@example.com")).toBe(colorForUser("josh@example.com"));
  });

  it("returns a color from the palette", () => {
    expect(PRESENCE_PALETTE).toContain(colorForUser("someone@example.com"));
  });

  it("assigns different emails different colors, at least most of the time", () => {
    const emails = ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"];
    const colors = new Set(emails.map(colorForUser));
    expect(colors.size).toBeGreaterThan(1);
  });
});
