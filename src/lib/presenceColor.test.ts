import { describe, it, expect, afterEach } from "vitest";
import { colorForUser, displayNameForUser, setProfileOverrides, pickUnusedColor, PRESENCE_PALETTE } from "./presenceColor";

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

describe("profile overrides", () => {
  afterEach(() => setProfileOverrides([]));

  it("prefers a user's chosen color and name over the hashed defaults", () => {
    setProfileOverrides([{ email: "josh@example.com", display_name: "Josh", color: "#123456" }]);
    expect(colorForUser("josh@example.com")).toBe("#123456");
    expect(displayNameForUser("josh@example.com")).toBe("Josh");
  });

  it("falls back to email/hash for users without an override", () => {
    setProfileOverrides([{ email: "josh@example.com", display_name: "Josh", color: "#123456" }]);
    expect(displayNameForUser("ben@example.com")).toBe("ben@example.com");
    expect(PRESENCE_PALETTE).toContain(colorForUser("ben@example.com"));
  });
});

describe("pickUnusedColor", () => {
  it("skips colors already taken", () => {
    const taken = new Set([PRESENCE_PALETTE[0], PRESENCE_PALETTE[1]]);
    expect(pickUnusedColor(taken)).toBe(PRESENCE_PALETTE[2]);
  });

  it("falls back to the first color if every color is taken", () => {
    expect(pickUnusedColor(new Set(PRESENCE_PALETTE))).toBe(PRESENCE_PALETTE[0]);
  });
});
