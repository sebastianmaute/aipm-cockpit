import { describe, expect, it } from "vitest";
import { reorderIds } from "./list-reorder";

describe("reorderIds", () => {
  it("moves a dragged id into the target's pre-removal slot when dragging down", () => {
    // A dragged onto C: A takes C's slot, i.e. lands AFTER C.
    expect(reorderIds(["A", "B", "C", "D"], "A", "C")).toEqual(["B", "C", "A", "D"]);
  });

  it("moves a dragged id before the target when dragging up", () => {
    expect(reorderIds(["A", "B", "C", "D"], "D", "B")).toEqual(["A", "D", "B", "C"]);
  });

  it("returns the original array reference when drag and target are the same", () => {
    const ids = ["A", "B", "C"];
    expect(reorderIds(ids, "B", "B")).toBe(ids);
  });

  it("returns the original array reference when either id is absent", () => {
    const ids = ["A", "B", "C"];
    expect(reorderIds(ids, "Z", "B")).toBe(ids);
    expect(reorderIds(ids, "A", "Z")).toBe(ids);
  });

  it("does not mutate its input", () => {
    const ids = ["A", "B", "C", "D"];
    reorderIds(ids, "A", "C");
    expect(ids).toEqual(["A", "B", "C", "D"]);
  });

  it("works with numeric ids", () => {
    expect(reorderIds([1, 2, 3, 4], 1, 3)).toEqual([2, 3, 1, 4]);
  });
});

import { dropEdgeFor } from "./list-reorder";

describe("dropEdgeFor", () => {
  const ids = ["A", "B", "C", "D"];

  it("reports 'after' when the target sits later than the dragged id", () => {
    // Matches reorderIds: dragging A onto C lands A after C.
    expect(dropEdgeFor(ids, "A", "C")).toBe("after");
  });

  it("reports 'before' when the target sits earlier than the dragged id", () => {
    expect(dropEdgeFor(ids, "D", "B")).toBe("before");
  });

  it("reports null for the dragged id itself", () => {
    expect(dropEdgeFor(ids, "B", "B")).toBeNull();
  });

  it("reports null when either id is absent", () => {
    expect(dropEdgeFor(ids, "Z", "B")).toBeNull();
    expect(dropEdgeFor(ids, "A", "Z")).toBeNull();
  });

  it("agrees with reorderIds in both directions", () => {
    // The edge is a CLAIM about where reorderIds will put the item. Pin the two
    // together so they cannot drift apart.
    for (const [drag, target] of [["A", "C"], ["D", "B"], ["B", "D"], ["C", "A"]] as const) {
      const edge = dropEdgeFor(ids, drag, target);
      const next = reorderIds(ids, drag, target);
      const landedAt = next.indexOf(drag);
      const targetAt = next.indexOf(target);
      expect(edge).toBe(landedAt > targetAt ? "after" : "before");
    }
  });
});
