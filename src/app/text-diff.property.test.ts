import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { diffLines } from "./text-diff";

// Short line alphabet so common subsequences actually occur across random arrays.
const lineArb = fc.constantFrom("a", "b", "c", "d", "e", "f");
const linesArb = fc.array(lineArb, { maxLength: 12 });

describe("text-diff — properties", () => {
  test("removed+same reconstructs `before`; added+same reconstructs `after`", () => {
    fc.assert(
      fc.property(linesArb, linesArb, (before, after) => {
        const diff = diffLines(before, after);
        const recoveredBefore = diff.filter((d) => d.type !== "added").map((d) => d.text);
        const recoveredAfter = diff.filter((d) => d.type !== "removed").map((d) => d.text);
        expect(recoveredBefore).toEqual([...before]);
        expect(recoveredAfter).toEqual([...after]);
      }),
    );
  });

  test("`same` lines are a common subsequence of both inputs (count never exceeds either)", () => {
    fc.assert(
      fc.property(linesArb, linesArb, (before, after) => {
        const same = diffLines(before, after).filter((d) => d.type === "same");
        const countIn = (arr: readonly string[], v: string) => arr.filter((x) => x === v).length;
        for (const v of new Set(same.map((d) => d.text))) {
          const c = countIn(same.map((d) => d.text), v);
          expect(c).toBeLessThanOrEqual(Math.min(countIn(before, v), countIn(after, v)));
        }
      }),
    );
  });

  test("output length equals before+after minus the matched (same) lines", () => {
    fc.assert(
      fc.property(linesArb, linesArb, (before, after) => {
        const diff = diffLines(before, after);
        const same = diff.filter((d) => d.type === "same").length;
        expect(diff.length).toBe(before.length + after.length - same);
        expect(diff.length).toBeGreaterThanOrEqual(Math.max(before.length, after.length));
      }),
    );
  });

  test("identical inputs produce all-`same` and no add/remove", () => {
    fc.assert(
      fc.property(linesArb, (lines) => {
        const diff = diffLines(lines, lines);
        expect(diff.every((d) => d.type === "same")).toBe(true);
        expect(diff.map((d) => d.text)).toEqual([...lines]);
      }),
    );
  });
});
