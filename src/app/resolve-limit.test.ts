import { describe, expect, it } from "vitest";
import { resolveLimit } from "./resolve-limit";

describe("resolveLimit", () => {
  it("returns the fallback for absent, non-numeric and non-finite input", () => {
    expect(resolveLimit(undefined, 50, 200)).toBe(50);
    expect(resolveLimit(Number.NaN, 50, 200)).toBe(50);
    expect(resolveLimit(Number.POSITIVE_INFINITY, 50, 200)).toBe(50);
  });

  it("floors a fractional limit", () => {
    expect(resolveLimit(2.9, 50, 200)).toBe(2);
  });

  it("returns the fallback when the floor lands on zero", () => {
    // The trap: testing `raw <= 0` BEFORE flooring lets 0.5 through as a cap of
    // zero, which yields no rows while asserting rows were withheld.
    expect(resolveLimit(0.5, 50, 200)).toBe(50);
  });

  it("returns the fallback for zero and negatives", () => {
    expect(resolveLimit(0, 50, 200)).toBe(50);
    expect(resolveLimit(-1, 50, 200)).toBe(50);
  });

  it("clamps down to the maximum", () => {
    expect(resolveLimit(5000, 50, 200)).toBe(200);
  });

  it("honours per-caller bounds", () => {
    expect(resolveLimit(undefined, 20, 50)).toBe(20);
    expect(resolveLimit(5000, 20, 50)).toBe(50);
  });
});
