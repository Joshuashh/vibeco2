import { describe, it, expect } from "vitest";
import { computeSortOrder } from "./reorder";

describe("computeSortOrder", () => {
  it("averages between two neighbors", () => {
    expect(computeSortOrder(1, 3)).toBe(2);
  });

  it("goes below the only neighbor when dropped first", () => {
    expect(computeSortOrder(null, 5)).toBe(4);
  });

  it("goes above the only neighbor when dropped last", () => {
    expect(computeSortOrder(5, null)).toBe(6);
  });

  it("returns something reasonable for an empty list", () => {
    expect(computeSortOrder(null, null)).toBeGreaterThan(0);
  });
});
