import { describe, it, expect } from "vitest";
import { computeClaimant, isClaimedByOther } from "./claim";

describe("computeClaimant", () => {
  it("returns null when nobody has claimed the chat", () => {
    expect(computeClaimant("c1", { email: "me@x.com", claimedChatId: null }, [])).toBeNull();
  });

  it("returns self's email when self is the claimant", () => {
    const self = { email: "me@x.com", claimedChatId: "c1" };
    expect(computeClaimant("c1", self, [])).toBe("me@x.com");
  });

  it("returns another occupant's email when they hold the claim", () => {
    const others = [{ email: "them@x.com", claimedChatId: "c1" }];
    expect(computeClaimant("c1", { email: "me@x.com", claimedChatId: null }, others)).toBe("them@x.com");
  });
});

describe("isClaimedByOther", () => {
  it("is false when unclaimed", () => {
    expect(isClaimedByOther("c1", { email: "me@x.com", claimedChatId: null }, [])).toBe(false);
  });

  it("is false when self holds the claim", () => {
    const self = { email: "me@x.com", claimedChatId: "c1" };
    expect(isClaimedByOther("c1", self, [])).toBe(false);
  });

  it("is true when another occupant holds the claim", () => {
    const others = [{ email: "them@x.com", claimedChatId: "c1" }];
    expect(isClaimedByOther("c1", { email: "me@x.com", claimedChatId: null }, others)).toBe(true);
  });
});
