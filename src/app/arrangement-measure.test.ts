import { describe, it, expect } from "vitest";
import { rowsForHeight } from "./arrangement-measure";

// A tile spanning n rows is n*row + (n-1)*gap tall; nonBody of it is not body.
// With row 80, gap 16, nonBody 39: body(n) = 96n - 55  →  n=2: 137, n=3: 233, n=4: 329.
const R = 80, G = 16, NB = 39;

describe("rowsForHeight", () => {
  it("returns the smallest n whose body fits the content exactly at a boundary", () => {
    expect(rowsForHeight(137, R, G, NB, 1, 8)).toBe(2);
    expect(rowsForHeight(138, R, G, NB, 1, 8)).toBe(3);
  });
  it("clamps up to minH", () => {
    expect(rowsForHeight(10, R, G, NB, 2, 8)).toBe(2);
  });
  it("clamps down to maxH", () => {
    expect(rowsForHeight(100_000, R, G, NB, 1, 4)).toBe(4);
  });
  it("can SHRINK: content shorter than a tall tile needs few rows", () => {
    expect(rowsForHeight(120, R, G, NB, 1, 8)).toBe(2);
  });
  it("treats zero or non-finite content as minH", () => {
    expect(rowsForHeight(0, R, G, NB, 2, 8)).toBe(2);
    expect(rowsForHeight(Number.NaN, R, G, NB, 2, 8)).toBe(2);
  });
  it("treats a non-positive row unit as unmeasurable and returns minH", () => {
    expect(rowsForHeight(500, 0, G, NB, 2, 8)).toBe(2);
  });
});
