import { describe, it, expect } from "vitest";
import { deriveChatTitle, capWords } from "./chatTitle";

describe("deriveChatTitle", () => {
  it("returns the prompt as-is when 5 words or fewer", () => {
    expect(deriveChatTitle("build the login form")).toBe("build the login form");
  });

  it("collapses newlines and repeated whitespace", () => {
    expect(deriveChatTitle("build   the\nlogin\n\nform")).toBe("build the login form");
  });

  it("caps long prompts at 5 words with an ellipsis", () => {
    const prompt = "build a fully featured login form with email, password, and social auth buttons";
    const title = deriveChatTitle(prompt);
    expect(title).toBe("build a fully featured login…");
    expect(title.endsWith(" …")).toBe(false);
  });

  it("trims surrounding whitespace", () => {
    expect(deriveChatTitle("   hi there   ")).toBe("hi there");
  });
});

describe("capWords", () => {
  it("leaves short text untouched", () => {
    expect(capWords("short title", 5)).toBe("short title");
  });

  it("cuts at the word count with no space before the ellipsis", () => {
    expect(capWords("one two three four five six seven", 5)).toBe("one two three four five…");
  });
});
