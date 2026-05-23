import { describe, test, expect } from "vitest";
import { generatePeriods, workdaysInRange, absencesForResource, absenceWorkdays } from "./resource-capacity";
import type { Absence, Resource } from "./types";

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
    const r: Resource = { id: 7, name: "Alex Example", roleId: null, utilizationMode: "percent", utilization: {} };
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
