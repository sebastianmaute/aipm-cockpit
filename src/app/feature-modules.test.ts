import { describe, expect, it } from "vitest";
import type { AppView } from "./nav-config";
import {
  ALL_MODULE_IDS,
  CORE_VIEWS,
  FEATURE_MODULES,
  deriveMode,
  enabledNavViews,
  isModuleEnabled,
  isViewEnabled,
  moduleForView,
  reportForModule,
  sanitizeFeatures,
  visibleReports,
} from "./feature-modules";

describe("feature-modules registry", () => {
  it("has 9 modules and uses each id once", () => {
    expect(ALL_MODULE_IDS).toHaveLength(9);
    expect(new Set(ALL_MODULE_IDS).size).toBe(9);
  });

  it("every module's parent view appears in its views list", () => {
    for (const m of FEATURE_MODULES) expect(m.views).toContain(m.id as AppView);
  });
});

describe("sanitizeFeatures", () => {
  it("treats undefined (legacy) as all modules enabled", () => {
    expect(sanitizeFeatures(undefined)).toEqual([...ALL_MODULE_IDS]);
  });
  it("treats an empty array as Simple (nothing enabled)", () => {
    expect(sanitizeFeatures([])).toEqual([]);
  });
  it("drops junk and orders by registry order", () => {
    expect(sanitizeFeatures(["raid", "nope", "budget", "raid"])).toEqual(["budget", "raid"]);
  });
});

describe("deriveMode", () => {
  it("all nine -> advanced", () => {
    expect(deriveMode([...ALL_MODULE_IDS])).toBe("advanced");
  });
  it("none -> simple", () => {
    expect(deriveMode([])).toBe("simple");
  });
  it("some -> modular", () => {
    expect(deriveMode(["raid"])).toBe("modular");
  });
});

describe("isViewEnabled", () => {
  it("core views are always enabled, even in Simple", () => {
    for (const v of CORE_VIEWS) expect(isViewEnabled(v, [])).toBe(true);
  });
  it("a child view follows its parent module", () => {
    expect(isViewEnabled("raci", [])).toBe(false);
    expect(isViewEnabled("raci", ["stakeholders"])).toBe(true);
  });
  it("budget-report follows the budget module", () => {
    expect(isViewEnabled("budget-report", [])).toBe(false);
    expect(isViewEnabled("budget-report", ["budget"])).toBe(true);
  });
});

describe("isModuleEnabled / moduleForView / enabledNavViews", () => {
  it("isModuleEnabled reflects membership", () => {
    expect(isModuleEnabled("raid", ["raid"])).toBe(true);
    expect(isModuleEnabled("raid", [])).toBe(false);
  });
  it("moduleForView maps child to parent module, core to null", () => {
    expect(moduleForView("stakeholder-map")).toBe("stakeholders");
    expect(moduleForView("chat")).toBeNull();
  });
  it("enabledNavViews includes core plus enabled modules' views", () => {
    const views = enabledNavViews(["budget"]);
    expect(views).toContain("open-points");
    expect(views).toContain("budget");
    expect(views).toContain("budget-report");
    expect(views).not.toContain("raid");
    expect(views).not.toContain("edit");
    expect(views).not.toContain("settings");
  });
});

describe("reportForModule", () => {
  it("returns the module's report id or null", () => {
    expect(reportForModule("budget")).toBe("budget-report");
    expect(reportForModule("gantt")).toBeNull();
  });
});

describe("visibleReports", () => {
  it("keeps only reports whose module is enabled, preserving stored order semantics", () => {
    expect(visibleReports(["raid-report", "budget-report"], ["budget"])).toEqual(["budget-report"]);
  });
  it("returns nothing when all owning modules are off", () => {
    expect(visibleReports(["raid-report", "stakeholder-report"], [])).toEqual([]);
  });
});
