import { describe, expect, it } from "vitest";
import { generatePeriods, periodKeyForDate } from "../resource-capacity";
import { splitToGranularity } from "./period-split";

const NONE: ReadonlySet<string> = new Set();

function total(parts: { hours: number }[]): number {
  return Math.round(parts.reduce((s, p) => s + p.hours, 0) * 100);
}

describe("splitToGranularity", () => {
  it("returns the period itself when the granularity already matches", () => {
    expect(splitToGranularity("2026-01", 100, "month", NONE)).toEqual([{ key: "2026-01", hours: 100 }]);
    expect(splitToGranularity("2026-W05", 12.5, "week", NONE)).toEqual([{ key: "2026-W05", hours: 12.5 }]);
  });

  it("splits a month over its weeks by working days", () => {
    // Jan 2026: 22 workdays. W01 = Jan 1-2 (2), W02-W04 = 5 each, W05 = Jan 26-30 (5).
    expect(splitToGranularity("2026-01", 88, "week", NONE)).toEqual([
      { key: "2026-W01", hours: 8 },
      { key: "2026-W02", hours: 20 },
      { key: "2026-W03", hours: 20 },
      { key: "2026-W04", hours: 20 },
      { key: "2026-W05", hours: 20 },
    ]);
  });

  it("keeps the total exactly when a public holiday shrinks the working days", () => {
    const parts = splitToGranularity("2026-01", 88, "week", new Set(["2026-01-06"]));
    // 21 workdays: W02 has 4 of them.
    expect(parts.find((p) => p.key === "2026-W02")?.hours).toBe(16.76);
    expect(parts.find((p) => p.key === "2026-W01")?.hours).toBe(8.38);
    expect(total(parts)).toBe(8800);
  });

  it("gives a week made only of holidays no hours at all", () => {
    const week2 = new Set(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]);
    const parts = splitToGranularity("2026-01", 85, "week", week2);
    expect(parts.map((p) => p.key)).toEqual(["2026-W01", "2026-W03", "2026-W04", "2026-W05"]);
    expect(total(parts)).toBe(8500);
  });

  it("splits a week that straddles a year boundary between two months", () => {
    // ISO 2026-W01 = Mon 2025-12-29 .. Sun 2026-01-04: Dec 29-31 (3 workdays), Jan 1-2 (2).
    expect(splitToGranularity("2026-W01", 40, "month", NONE)).toEqual([
      { key: "2025-12", hours: 24 },
      { key: "2026-01", hours: 16 },
    ]);
  });

  it("handles ISO week 53", () => {
    // 2026-W53 = Mon 2026-12-28 .. Sun 2027-01-03: Dec 28-31 (4), Jan 1 (1).
    expect(splitToGranularity("2026-W53", 40, "month", NONE)).toEqual([
      { key: "2026-12", hours: 32 },
      { key: "2027-01", hours: 8 },
    ]);
  });

  it("falls back to calendar days when the source period has no workday", () => {
    const holidays = new Set(["2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"]);
    expect(splitToGranularity("2026-W01", 70, "month", holidays)).toEqual([
      { key: "2025-12", hours: 30 },
      { key: "2026-01", hours: 40 },
    ]);
  });

  it("splits a single-month source with no workday into the one month", () => {
    const week2 = new Set(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]);
    expect(splitToGranularity("2026-W02", 10, "month", week2)).toEqual([{ key: "2026-01", hours: 10 }]);
  });

  it("writes one zero entry for zero hours so a deliberate zero still overwrites", () => {
    expect(splitToGranularity("2026-01", 0, "week", NONE)).toEqual([{ key: "2026-W01", hours: 0 }]);
    expect(splitToGranularity("2026-W01", 0, "month", NONE)).toEqual([{ key: "2025-12", hours: 0 }]);
  });

  it("puts the rounding remainder on the last key", () => {
    // 100 over 2/5/5/5/5 of 22 workdays does not divide into cents.
    const parts = splitToGranularity("2026-01", 100, "week", NONE);
    expect(parts.map((p) => p.hours)).toEqual([9.09, 22.73, 22.73, 22.73, 22.72]);
    expect(total(parts)).toBe(10000);
  });

  it("never lets the remainder drive the last share negative", () => {
    // Feb 2026 = four equal weeks of 5 workdays. 2 cents is 0.5 cent a week, which rounds UP
    // for the first three (3 cents), so the last would be -1 cent without the fix.
    const parts = splitToGranularity("2026-02", 0.02, "week", NONE);
    expect(parts).toEqual([
      { key: "2026-W06", hours: 0 },
      { key: "2026-W07", hours: 0.01 },
      { key: "2026-W08", hours: 0.01 },
      { key: "2026-W09", hours: 0 },
    ]);
  });

  it("orders the output by key", () => {
    const parts = splitToGranularity("2026-W01", 10, "month", NONE);
    expect(parts.map((p) => p.key)).toEqual([...parts.map((p) => p.key)].sort());
  });

  it("rejects a period that is not canonical or does not exist", () => {
    expect(() => splitToGranularity("2026-1", 1, "week", NONE)).toThrow("bad-period");
    expect(() => splitToGranularity("2026-13", 1, "week", NONE)).toThrow("bad-period");
    expect(() => splitToGranularity("2026-w05", 1, "month", NONE)).toThrow("bad-period");
    expect(() => splitToGranularity("2025-W53", 1, "month", NONE)).toThrow("bad-period");
  });

  it("resolves every ISO week of 2024-2028 through the shared period keys", () => {
    for (const p of generatePeriods("2024-01-01", "2028-12-31", "week")) {
      expect(periodKeyForDate(p.start, "week")).toBe(p.key);
      const parts = splitToGranularity(p.key, 40, "month", NONE);
      expect(total(parts)).toBe(4000);
      for (const part of parts) {
        expect(part.key >= p.start.slice(0, 7) && part.key <= p.end.slice(0, 7)).toBe(true);
      }
    }
  });
});
