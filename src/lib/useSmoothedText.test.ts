import { describe, it, expect } from "vitest";
import { nextRevealedLength, catchUpBacklog } from "./useSmoothedText";

describe("nextRevealedLength", () => {
  it("advances at the reveal rate for the elapsed frame time", () => {
    // 260 chars/sec * 100ms = 26 chars
    expect(nextRevealedLength(0, 100, 100)).toBe(26);
  });

  it("clamps to the target length even if the frame advance overshoots it", () => {
    expect(nextRevealedLength(5, 10, 1000)).toBe(10);
  });

  it("does not advance past the current length on a zero-length frame", () => {
    expect(nextRevealedLength(5, 10, 0)).toBe(5);
  });
});

describe("catchUpBacklog", () => {
  it("leaves currentLen untouched when the backlog is within the cap", () => {
    expect(catchUpBacklog(50, 100)).toBe(50);
  });

  it("jumps forward to only trickle the last MAX_BACKLOG_CHARS when far behind", () => {
    // target 500, cap 120 -> should jump to 380
    expect(catchUpBacklog(10, 500)).toBe(380);
  });

  it("is a no-op once fully caught up", () => {
    expect(catchUpBacklog(200, 200)).toBe(200);
  });
});
