import { describe, expect, it } from "vitest";
import {
  addCalendarDays, calendarDaysBetween, countWorkingDays, isWorkingDay, nthWorkingDayAfter,
  periodBounds, workingDaysBefore, workingDaysInRange,
} from "./working-days";
import { periodKeyForDate } from "./resource-capacity";

const none = new Set<string>();

describe("working-days", () => {
  it("steps calendar days across a month and a year end", () => {
    expect(addCalendarDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(calendarDaysBetween("2026-11-27", "2026-12-18")).toBe(21);
    expect(calendarDaysBetween("2026-12-18", "2026-11-27")).toBe(-21);
  });

  it("treats weekends and holidays as non-working", () => {
    expect(isWorkingDay("2026-09-14", none)).toBe(true);   // Monday
    expect(isWorkingDay("2026-09-19", none)).toBe(false);  // Saturday
    expect(isWorkingDay("2026-09-20", none)).toBe(false);  // Sunday
    expect(isWorkingDay("2026-09-07", new Set(["2026-09-07"]))).toBe(false);
  });

  it("returns the 20 working days before today (spec §5.6 window)", () => {
    const w = workingDaysBefore("2026-09-14", 20, none);
    expect(w).toHaveLength(20);
    expect(w[0]).toBe("2026-08-17");
    expect(w[19]).toBe("2026-09-11");
  });

  it("skips a holiday inside the window", () => {
    const w = workingDaysBefore("2026-09-14", 20, new Set(["2026-09-07"]));
    expect(w[0]).toBe("2026-08-14");
    expect(w).not.toContain("2026-09-07");
  });

  it("finds the n-th working day after a date", () => {
    expect(nthWorkingDayAfter("2026-09-14", 1, none)).toBe("2026-09-15");
    expect(nthWorkingDayAfter("2026-09-14", 54, none)).toBe("2026-11-27");
    expect(nthWorkingDayAfter("2026-09-18", 1, none)).toBe("2026-09-21");
    expect(nthWorkingDayAfter("2026-09-18", 1, new Set(["2026-09-21"]))).toBe("2026-09-22");
  });

  it("counts working days in a half-open range", () => {
    expect(countWorkingDays("2026-09-15", "2026-12-19", none)).toBe(69);
    expect(countWorkingDays("2026-09-15", "2026-10-02", none)).toBe(13);
    expect(countWorkingDays("2026-09-15", "2026-09-15", none)).toBe(0);
    expect(countWorkingDays("2026-09-16", "2026-09-15", none)).toBe(0);
  });

  it("lists working days in an inclusive range", () => {
    expect(workingDaysInRange("2026-06-01", "2026-06-30", none)).toHaveLength(22);
    expect(workingDaysInRange("2026-09-19", "2026-09-20", none)).toEqual([]);
  });

  it("returns period bounds for month and ISO week keys", () => {
    expect(periodBounds("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(periodBounds("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(periodBounds("2026-W24")).toEqual({ start: "2026-06-08", end: "2026-06-14" });
    expect(periodBounds("2026-W01")).toEqual({ start: "2025-12-29", end: "2026-01-04" });
    expect(periodBounds("2026-06-10")).toBeNull();
    expect(periodBounds("nonsense")).toBeNull();
  });

  // periodBounds never returns null for a key WEEK_RE matches (W01-W53), even for a year
  // whose real ISO-week count is lower — so a `!b` guard here would be unreachable dead code.
  it("agrees with periodKeyForDate on week membership", () => {
    for (const key of ["2026-W01", "2026-W24", "2026-W53", "2027-W01"]) {
      const b = periodBounds(key);
      expect(periodKeyForDate(b!.start, "week")).toBe(key);
      expect(periodKeyForDate(b!.end, "week")).toBe(key);
    }
  });
});
