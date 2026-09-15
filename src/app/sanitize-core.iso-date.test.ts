import { describe, expect, it } from "vitest";
import { sanitizeIsoDate } from "./sanitize";

describe("sanitizeIsoDate rejects non-calendar dates (open-followups §539)", () => {
  it.each(["2026-00-10", "2026-13-01"])("rejects month %s", (value) => {
    expect(sanitizeIsoDate(value)).toBe("");
  });

  it.each(["2026-01-00", "2026-01-32"])("rejects day %s", (value) => {
    expect(sanitizeIsoDate(value)).toBe("");
  });

  it("accepts Feb 29 only in a leap year", () => {
    expect(sanitizeIsoDate("2024-02-29")).toBe("2024-02-29");
    expect(sanitizeIsoDate("2000-02-29")).toBe("2000-02-29"); // divisible by 400
    expect(sanitizeIsoDate("2025-02-29")).toBe("");
    expect(sanitizeIsoDate("2100-02-29")).toBe(""); // divisible by 100, not 400
  });

  it.each(["2026-02-30", "2026-04-31", "2026-06-31", "2026-09-31", "2026-11-31"])("rejects %s, which date math silently rolls over", (value) => {
    expect(sanitizeIsoDate(value)).toBe("");
  });

  it("accepts the last real day of every month", () => {
    for (const value of ["2026-01-31", "2026-03-31", "2026-04-30", "2026-12-31"]) expect(sanitizeIsoDate(value)).toBe(value);
  });

  it("still enforces the year bounds and the shape", () => {
    expect(sanitizeIsoDate("1899-12-31")).toBe("");
    expect(sanitizeIsoDate("1900-01-01")).toBe("1900-01-01");
    expect(sanitizeIsoDate("2100-12-31")).toBe("2100-12-31");
    expect(sanitizeIsoDate("2101-01-01")).toBe("");
    expect(sanitizeIsoDate("2026-1-01")).toBe("");
    expect(sanitizeIsoDate(20260101)).toBe("");
  });
});
