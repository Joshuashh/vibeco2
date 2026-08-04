import { describe, it, expect } from "vitest";
import { extractBearerToken } from "./verify.ts";

describe("extractBearerToken", () => {
  it("returns the token from a well-formed header", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("throws when the header is missing", () => {
    expect(() => extractBearerToken(null)).toThrow(
      "missing or malformed Authorization header"
    );
  });

  it("throws when the header doesn't start with Bearer", () => {
    expect(() => extractBearerToken("Basic abc123")).toThrow(
      "missing or malformed Authorization header"
    );
  });

  it("throws when the token is empty after Bearer", () => {
    expect(() => extractBearerToken("Bearer ")).toThrow(
      "missing or malformed Authorization header"
    );
  });
});
