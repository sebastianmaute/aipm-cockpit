import { describe, expect, test } from "vitest";
import { ADDABLE_REPORTS, sanitizeExtraReports } from "./addable-reports";

describe("addable-reports", () => {
  test("registry has the three reports in canonical order", () => {
    expect(ADDABLE_REPORTS.map((r) => r.id)).toEqual(["raid-report", "budget-report", "resource-report"]);
  });
  test("sanitizeExtraReports keeps valid ids in canonical order, drops junk + dups", () => {
    expect(sanitizeExtraReports(["budget-report", "raid-report", "budget-report", "nope"]))
      .toEqual(["raid-report", "budget-report"]);
  });
  test("sanitizeExtraReports returns [] for non-arrays", () => {
    expect(sanitizeExtraReports(undefined)).toEqual([]);
    expect(sanitizeExtraReports("budget-report")).toEqual([]);
    expect(sanitizeExtraReports(null)).toEqual([]);
  });
  test("sanitizeExtraReports tolerates mixed-type array elements", () => {
    expect(sanitizeExtraReports([null, 42, "budget-report", {}, "raid-report"]))
      .toEqual(["raid-report", "budget-report"]);
  });

  test("every registry entry has an id and a titleKey", () => {
    for (const r of ADDABLE_REPORTS) {
      expect(r.id).toBeTruthy();
      expect(r.titleKey).toBeTruthy();
    }
  });
});
