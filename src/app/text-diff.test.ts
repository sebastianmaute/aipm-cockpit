import { describe, it, expect } from "vitest";
import { diffLines } from "./text-diff";

describe("diffLines", () => {
  it("marks identical lines as same", () => {
    expect(diffLines(["a", "b"], ["a", "b"])).toEqual([
      { type: "same", text: "a" },
      { type: "same", text: "b" },
    ]);
  });
  it("marks an inserted line as added", () => {
    expect(diffLines(["a", "b"], ["a", "x", "b"])).toEqual([
      { type: "same", text: "a" },
      { type: "added", text: "x" },
      { type: "same", text: "b" },
    ]);
  });
  it("marks a deleted line as removed", () => {
    expect(diffLines(["a", "b", "c"], ["a", "c"])).toEqual([
      { type: "same", text: "a" },
      { type: "removed", text: "b" },
      { type: "same", text: "c" },
    ]);
  });
  it("treats a changed line as removed + added", () => {
    expect(diffLines(["a", "b"], ["a", "B"])).toEqual([
      { type: "same", text: "a" },
      { type: "removed", text: "b" },
      { type: "added", text: "B" },
    ]);
  });
  it("handles empty inputs", () => {
    expect(diffLines([], [])).toEqual([]);
    expect(diffLines(["a"], [])).toEqual([{ type: "removed", text: "a" }]);
    expect(diffLines([], ["a"])).toEqual([{ type: "added", text: "a" }]);
  });
});
