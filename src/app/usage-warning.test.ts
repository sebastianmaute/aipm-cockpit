import { expect, test, describe } from "vitest";
import { crossed80 } from "./usage-warning";

describe("crossed80", () => {
  test("returns true when prev < 80% threshold and next >= threshold", () => {
    expect(crossed80(0, 160_000, 200_000)).toBe(true);
    expect(crossed80(159_999, 160_000, 200_000)).toBe(true);
  });

  test("returns false when both prev and next are below threshold", () => {
    expect(crossed80(0, 100_000, 200_000)).toBe(false);
  });

  test("returns false when prev is already at or above threshold", () => {
    expect(crossed80(160_000, 180_000, 200_000)).toBe(false);
    expect(crossed80(200_000, 250_000, 200_000)).toBe(false);
  });

  test("returns false when cap is zero", () => {
    expect(crossed80(0, 999_999, 0)).toBe(false);
  });

  test("returns false when cap is negative", () => {
    expect(crossed80(0, 999_999, -1)).toBe(false);
  });

  test("returns true exactly on the boundary (prev < t <= next)", () => {
    // threshold = 80 000
    expect(crossed80(79_999, 80_000, 100_000)).toBe(true);
  });

  test("returns false when next is just below threshold", () => {
    expect(crossed80(0, 79_999, 100_000)).toBe(false);
  });
});
