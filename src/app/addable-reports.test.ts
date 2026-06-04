import { describe, expect, test } from "vitest";
import {
  ADDABLE_REPORTS,
  DEFAULT_EXTRA_REPORTS,
  resolveExtraReports,
  sanitizeExtraReports,
} from "./addable-reports";

describe("addable-reports", () => {
  test("registry has the four reports in canonical order", () => {
    expect(ADDABLE_REPORTS.map((r) => r.id)).toEqual(["raid-report", "budget-report", "resource-report", "stakeholder-report"]);
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

  describe("resolveExtraReports (load path)", () => {
    test("DEFAULT_EXTRA_REPORTS is RAID + Budget", () => {
      expect(DEFAULT_EXTRA_REPORTS).toEqual(["raid-report", "budget-report"]);
    });
    test("undefined (never set / legacy) resolves to the defaults", () => {
      expect(resolveExtraReports(undefined)).toEqual(["raid-report", "budget-report"]);
    });
    test("returns a fresh copy of the defaults (not the shared array)", () => {
      expect(resolveExtraReports(undefined)).not.toBe(DEFAULT_EXTRA_REPORTS);
    });
    test("explicit empty array stays empty (removal is preserved)", () => {
      expect(resolveExtraReports([])).toEqual([]);
    });
    test("a stored subset is preserved and not re-padded with defaults", () => {
      expect(resolveExtraReports(["raid-report"])).toEqual(["raid-report"]);
    });
    test("non-array, non-undefined values sanitize to []", () => {
      expect(resolveExtraReports(null)).toEqual([]);
      expect(resolveExtraReports("raid-report")).toEqual([]);
    });
  });
});
