import { describe, test, expect } from "vitest";
import { generatePeriods, workdaysInRange, absencesForResource, absenceWorkdays, periodCapacityHours, displayCapacityHours } from "./resource-capacity";
import type { Absence, Resource } from "./types";
import type { Period } from "./resource-capacity";

describe("generatePeriods - month", () => {
  test("inclusive month range with correct keys and bounds", () => {
    const p = generatePeriods("2026-01-15", "2026-03-02", "month");
    expect(p.map((x) => x.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(p[0]).toEqual({ key: "2026-01", start: "2026-01-01", end: "2026-01-31" });
    expect(p[1].end).toBe("2026-02-28");
  });
});

describe("generatePeriods - week", () => {
  test("ISO weeks covering the range, Monday..Sunday", () => {
    // 2026-01-01 is a Thursday; ISO week 2026-W01 is Mon 2025-12-29 .. Sun 2026-01-04
    const p = generatePeriods("2026-01-01", "2026-01-10", "week");
    expect(p[0].key).toBe("2026-W01");
    expect(p[0].start).toBe("2025-12-29");
    expect(p[0].end).toBe("2026-01-04");
    expect(p[1].key).toBe("2026-W02");
    expect(p[1].start).toBe("2026-01-05");
  });
});

describe("workdaysInRange", () => {
  test("counts Mon–Fri inclusive, excluding weekends and holidays", () => {
    // Feb 2026: Feb 1 is a Sunday; Mon–Fri across the month = 20 workdays.
    expect(workdaysInRange("2026-02-01", "2026-02-28", new Set())).toBe(20);
    // remove one workday via a holiday:
    expect(workdaysInRange("2026-02-01", "2026-02-28", new Set(["2026-02-03"]))).toBe(19);
    // single weekend day:
    expect(workdaysInRange("2026-02-07", "2026-02-08", new Set())).toBe(0);
  });
});

describe("absencesForResource", () => {
  test("matches by resourceId, falls back to case-folded name", () => {
    const r: Resource = { id: 7, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent", utilization: {} };
    const abs: Absence[] = [
      { id: 1, assignee: "Alex Example", startDate: "2026-02-02", endDate: "2026-02-02", type: "vacation", resourceId: 7 },
      { id: 2, assignee: "Alex Example", startDate: "2026-02-03", endDate: "2026-02-03", type: "sick" },
      { id: 3, assignee: "Bob", startDate: "2026-02-04", endDate: "2026-02-04", type: "vacation", resourceId: 9 },
    ];
    expect(absencesForResource(abs, r).map((a) => a.id).sort()).toEqual([1, 2]);
  });
});

describe("absenceWorkdays", () => {
  test("counts workdays inside absence ranges intersected with the period", () => {
    const abs: Absence[] = [{ id: 1, assignee: "x", startDate: "2026-02-02", endDate: "2026-02-06", type: "vacation" }];
    // Mon–Fri Feb 2–6 = 5 workdays, all within the period:
    expect(absenceWorkdays(abs, "2026-02-01", "2026-02-28", new Set())).toBe(5);
    // a holiday inside the absence range is not counted as a workday:
    expect(absenceWorkdays(abs, "2026-02-01", "2026-02-28", new Set(["2026-02-04"]))).toBe(4);
  });
});

const FEB: Period = { key: "2026-02", start: "2026-02-01", end: "2026-02-28" };

describe("periodCapacityHours - percent mode (Excel golden: Andre month 1)", () => {
  test("0.95 × (20 workdays − 5.5 absence) days = 13.775 days = 110.2h", () => {
    const r: Resource = {
      id: 1, firstName: "Andre", lastName: "", roleId: null, utilizationMode: "percent",
      utilization: { "2026-02": 95 }, absenceOverride: { "2026-02": 44 }, // 5.5 days × 8h
    };
    const cap = periodCapacityHours(r, FEB, [], 8, new Set());
    expect(cap).toBeCloseTo(110.2, 6);   // hours
    expect(cap / 8).toBeCloseTo(13.775, 6); // days
  });
});

describe("periodCapacityHours - auto absence + holidays", () => {
  test("percent 100, one 2-day absence, no override → (20−2)×8 = 144h", () => {
    const r: Resource = { id: 1, firstName: "x", lastName: "", roleId: null, utilizationMode: "percent", utilization: { "2026-02": 100 } };
    const abs: Absence[] = [{ id: 1, assignee: "x", startDate: "2026-02-02", endDate: "2026-02-03", type: "vacation" }];
    expect(periodCapacityHours(r, FEB, abs, 8, new Set())).toBeCloseTo(144, 6);
  });
});

describe("periodCapacityHours - hours mode", () => {
  test("flat 40h minus 8h auto absence (1 day) = 32h", () => {
    const r: Resource = { id: 1, firstName: "x", lastName: "", roleId: null, utilizationMode: "hours", utilization: { "2026-02": 40 } };
    const abs: Absence[] = [{ id: 1, assignee: "x", startDate: "2026-02-02", endDate: "2026-02-02", type: "vacation" }];
    expect(periodCapacityHours(r, FEB, abs, 8, new Set())).toBe(32);
  });
  test("flat hours never goes negative", () => {
    const r: Resource = { id: 1, firstName: "x", lastName: "", roleId: null, utilizationMode: "hours", utilization: { "2026-02": 4 }, absenceOverride: { "2026-02": 40 } };
    expect(periodCapacityHours(r, FEB, [], 8, new Set())).toBe(0);
  });
  test("missing utilization value → 0 capacity", () => {
    const r: Resource = { id: 1, firstName: "x", lastName: "", roleId: null, utilizationMode: "percent", utilization: {} };
    expect(periodCapacityHours(r, FEB, [], 8, new Set())).toBe(0);
  });
});

describe("displayCapacityHours rollup", () => {
  const wh = 8;
  const r: Resource = { id: 1, firstName: "x", lastName: "", roleId: null, utilizationMode: "percent", utilization: { "2026-02": 100 } };

  test("display === canonical: uses the period's own stored utilization", () => {
    const feb: Period = { key: "2026-02", start: "2026-02-01", end: "2026-02-28" };
    expect(displayCapacityHours(feb, [feb], r, [], wh, new Set(), "month", "month")).toBeCloseTo(160, 6);
  });

  test("coarse→fine (month canonical, week display): week borrows its month's util", () => {
    const feb: Period = { key: "2026-02", start: "2026-02-01", end: "2026-02-28" };
    const week: Period = { key: "2026-W07", start: "2026-02-09", end: "2026-02-15" }; // Mon–Sun, 5 workdays
    // 100% × 5 workdays × 8h = 40h
    expect(displayCapacityHours(week, [feb], r, [], wh, new Set(), "month", "week")).toBeCloseTo(40, 6);
  });

  test("fine→coarse (week canonical, month display): sum of weeks starting in the month", () => {
    const rw: Resource = { id: 1, firstName: "x", lastName: "", roleId: null, utilizationMode: "hours", utilization: { "2026-W07": 10, "2026-W08": 10 } };
    const w7: Period = { key: "2026-W07", start: "2026-02-09", end: "2026-02-15" };
    const w8: Period = { key: "2026-W08", start: "2026-02-16", end: "2026-02-22" };
    const feb: Period = { key: "2026-02", start: "2026-02-01", end: "2026-02-28" };
    // hours mode, no absence: 10 + 10 = 20
    expect(displayCapacityHours(feb, [w7, w8], rw, [], wh, new Set(), "week", "month")).toBe(20);
  });
});
