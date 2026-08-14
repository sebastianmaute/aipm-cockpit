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
