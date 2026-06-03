import { describe, expect, it } from "vitest";
import { bucketKey } from "./snapshot";

describe("bucketKey", () => {
  it("formats a daily bucket as YYYY-MM-DD", () => {
    expect(bucketKey(new Date("2026-06-03T10:00:00Z"), "daily")).toBe("2026-06-03");
  });
  it("formats a monthly bucket as YYYY-MM", () => {
    expect(bucketKey(new Date("2026-06-03T10:00:00Z"), "monthly")).toBe("2026-06");
  });
  it("formats a weekly bucket as ISO year-week", () => {
    // 2026-06-03 is a Wednesday in ISO week 23.
    expect(bucketKey(new Date("2026-06-03T10:00:00Z"), "weekly")).toBe("2026-W23");
  });
  it("uses the ISO week-year at a year boundary (2027-01-01 is in week 53 of 2026)", () => {
    expect(bucketKey(new Date("2027-01-01T10:00:00Z"), "weekly")).toBe("2026-W53");
  });
});
