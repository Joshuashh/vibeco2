import { describe, it, expect } from "vitest";
import { clientPointToPercent } from "./overlayGeometry";

function rect(overrides: Partial<DOMRect> = {}): DOMRect {
  return { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}), ...overrides } as DOMRect;
}

describe("clientPointToPercent", () => {
  it("converts a point at the container's top-left to 0,0", () => {
    expect(clientPointToPercent(0, 0, rect())).toEqual({ x_pct: 0, y_pct: 0 });
  });

  it("converts a point at the container's center to 50,50", () => {
    expect(clientPointToPercent(100, 50, rect())).toEqual({ x_pct: 50, y_pct: 50 });
  });

  it("accounts for a container offset from the viewport origin", () => {
    expect(clientPointToPercent(120, 60, rect({ left: 20, top: 10 }))).toEqual({ x_pct: 50, y_pct: 50 });
  });

  it("clamps points outside the container to 0-100", () => {
    expect(clientPointToPercent(-50, 500, rect())).toEqual({ x_pct: 0, y_pct: 100 });
  });
});
