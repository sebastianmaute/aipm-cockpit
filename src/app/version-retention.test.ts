import { describe, it, expect } from "vitest";
import { sanitizeVersionRetention, DEFAULT_VERSION_RETENTION } from "./version-history";

describe("sanitizeVersionRetention", () => {
  it("defaults to 50 for undefined/garbage", () => {
    expect(sanitizeVersionRetention(undefined)).toBe(50);
    expect(sanitizeVersionRetention("x")).toBe(50);
    expect(sanitizeVersionRetention(null)).toBe(50);
    expect(DEFAULT_VERSION_RETENTION).toBe(50);
  });
  it("clamps below the minimum up to 50", () => {
    expect(sanitizeVersionRetention(0)).toBe(50);
    expect(sanitizeVersionRetention(49)).toBe(50);
    expect(sanitizeVersionRetention(-100)).toBe(50);
  });
  it("snaps to the nearest 10", () => {
    expect(sanitizeVersionRetention(63)).toBe(60);
    expect(sanitizeVersionRetention(66)).toBe(70);
    expect(sanitizeVersionRetention(55)).toBe(60);
  });
  it("caps at 1000", () => {
    expect(sanitizeVersionRetention(9999)).toBe(1000);
    expect(sanitizeVersionRetention(1000)).toBe(1000);
  });
});
