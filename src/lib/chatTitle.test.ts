import { describe, it, expect } from "vitest";
import { deriveChatTitle } from "./chatTitle";

describe("deriveChatTitle", () => {
  it("returns the prompt as-is when short", () => {
    expect(deriveChatTitle("build the login form")).toBe("build the login form");
  });

  it("collapses newlines and repeated whitespace", () => {
    expect(deriveChatTitle("build   the\nlogin\n\nform")).toBe("build the login form");
  });

  it("truncates long prompts at a word boundary with an ellipsis", () => {
    const prompt = "build a fully featured login form with email, password, and social auth buttons";
    const title = deriveChatTitle(prompt);
    expect(title.length).toBeLessThanOrEqual(49);
    expect(title.endsWith("…")).toBe(true);
    expect(title.endsWith(" …")).toBe(false);
  });

  it("trims surrounding whitespace", () => {
    expect(deriveChatTitle("   hi there   ")).toBe("hi there");
  });
});
