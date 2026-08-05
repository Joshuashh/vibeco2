import { describe, it, expect } from "vitest";
import { clusterByProximity, snapToGrid, reconcileGroupIds } from "./grouping";

describe("clusterByProximity", () => {
  it("returns no clusters when nodes are far apart", () => {
    const nodes = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 1000, y: 1000 },
    ];
    expect(clusterByProximity(nodes)).toEqual([]);
  });

  it("groups two nodes within the distance threshold", () => {
    const nodes = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 100, y: 0 },
    ];
    const clusters = clusterByProximity(nodes);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIds.sort()).toEqual(["a", "b"]);
    expect(clusters[0].centroid).toEqual({ x: 50, y: 0 });
  });

  it("transitively merges a chain of close nodes even if the ends are far apart", () => {
    const nodes = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 100, y: 0 },
      { id: "c", x: 200, y: 0 },
    ];
    const clusters = clusterByProximity(nodes);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("excludes singleton nodes with no neighbor from any cluster", () => {
    const nodes = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 100, y: 0 },
      { id: "solo", x: 5000, y: 5000 },
    ];
    const clusters = clusterByProximity(nodes);
    expect(clusters).toHaveLength(1);
    expect(clusters.flatMap((c) => c.memberIds)).not.toContain("solo");
  });
});

describe("snapToGrid", () => {
  it("rounds to the nearest grid unit", () => {
    expect(snapToGrid(107, 20)).toBe(100);
    expect(snapToGrid(113, 20)).toBe(120);
    expect(snapToGrid(0, 20)).toBe(0);
  });
});

describe("reconcileGroupIds", () => {
  it("mints a new id for a cluster with no existing group membership", () => {
    const clusters = [{ memberIds: ["a", "b"], centroid: { x: 0, y: 0 } }];
    let calls = 0;
    const makeId = () => `new-${++calls}`;
    expect(reconcileGroupIds(clusters, {}, makeId)).toEqual({ a: "new-1", b: "new-1" });
  });

  it("keeps the majority existing group id for a cluster", () => {
    const clusters = [{ memberIds: ["a", "b", "c"], centroid: { x: 0, y: 0 } }];
    const existing = { a: "group-1", b: "group-1", c: "group-2" };
    expect(reconcileGroupIds(clusters, existing, () => "unused")).toEqual({
      a: "group-1",
      b: "group-1",
      c: "group-1",
    });
  });

  it("does not assign an id to chats outside any cluster", () => {
    const clusters = [{ memberIds: ["a", "b"], centroid: { x: 0, y: 0 } }];
    const result = reconcileGroupIds(clusters, {}, () => "g1");
    expect(result).not.toHaveProperty("solo");
  });
});
