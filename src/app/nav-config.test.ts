import { describe, expect, it } from "vitest";
import {
  NAV_GROUPS, viewToSlug, slugToView, navLabelKey, allNavViews, subTabsFor,
  filterNavGroups,
  parseHash, buildHash,
  type AppView,
} from "./nav-config";

describe("nav-config", () => {
  it("every nav item has a unique slug", () => {
    const slugs = allNavViews().map(viewToSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("slugToView inverts viewToSlug", () => {
    for (const v of allNavViews()) expect(slugToView(viewToSlug(v))).toBe(v);
  });

  it("unknown slug falls back to open-points", () => {
    expect(slugToView("nope")).toBe("open-points");
    expect(slugToView("")).toBe("open-points");
  });

  it("groups expose label keys and children reference known views", () => {
    const known = new Set<AppView>(allNavViews());
    for (const g of NAV_GROUPS) {
      expect(g.labelKey).toBeTruthy();
      for (const item of g.items) {
        expect(navLabelKey(item.view)).toBeTruthy();
        for (const child of item.children ?? []) expect(known.has(child.view)).toBe(true);
      }
    }
  });

  it("excludes the edit view from nav and labels it harmlessly", () => {
    expect(allNavViews()).not.toContain("edit");
    expect(navLabelKey("edit")).toBeTruthy();
  });

  it("resources sub-menu = directory/workload/calendar/planning/manage-roles; no resource-report/address-book", () => {
    const views = allNavViews();
    expect(views).toEqual(expect.arrayContaining(["directory", "workload", "calendar", "planning", "manage-roles"]));
    expect(views).not.toContain("resource-report");
    expect(views).not.toContain("address-book");
  });

  it("removed slugs remap", () => {
    expect(slugToView("address-book")).toBe("directory");
    expect(slugToView("resource-report")).toBe("resources");
    expect(slugToView("totally-unknown")).toBe("open-points");
  });

  it("subTabsFor returns the containing section's children for a parent or child view", () => {
    const resKids = subTabsFor("resources").map((c) => c.view);
    expect(resKids).toEqual(["directory", "workload", "calendar", "planning", "manage-roles"]);
    expect(subTabsFor("planning").map((c) => c.view)).toEqual(resKids);
    expect(subTabsFor("raid").map((c) => c.view)).toEqual(["raid-report"]);
    expect(subTabsFor("raid-report").map((c) => c.view)).toEqual(["raid-report"]);
    expect(subTabsFor("chat")).toEqual([]);
    expect(subTabsFor("open-points")).toEqual([]);
  });

  it("exposes budget-report as a child of budget", () => {
    expect(subTabsFor("budget")).toEqual([{ view: "budget-report" }]);
    expect(subTabsFor("budget-report")).toEqual([{ view: "budget-report" }]);
    expect(allNavViews()).toContain("budget-report");
    expect(navLabelKey("budget-report")).toBe("budgetReportTitle");
  });

  it("includes changes + change-report in nav", () => {
    expect(allNavViews()).toContain("changes");
    expect(allNavViews()).toContain("change-report");
  });

  it("exposes change-report as a child of changes with label keys", () => {
    expect(subTabsFor("changes")).toEqual([{ view: "change-report" }]);
    expect(subTabsFor("change-report")).toEqual([{ view: "change-report" }]);
    expect(navLabelKey("changes")).toBe("navChanges");
    expect(navLabelKey("change-report")).toBe("changeReportTitle");
  });
});

describe("trends nav", () => {
  it("includes trends in the Overview group", () => {
    expect(allNavViews()).toContain("trends");
  });
  it("maps trends to its label key", () => {
    expect(navLabelKey("trends")).toBe("navTrends");
  });
});

describe("stakeholders nav", () => {
  it("includes the stakeholders register and its sub-views", () => {
    const views = allNavViews();
    expect(views).toContain("stakeholders");
    expect(views).toContain("raci");
    expect(views).toContain("stakeholder-map");
    expect(subTabsFor("stakeholders").map((c) => c.view)).toEqual(["raci", "stakeholder-map"]);
    expect(navLabelKey("stakeholders")).toBe("navStakeholders");
  });
});

describe("parseHash / buildHash", () => {
  it("parses a bare view slug", () => {
    expect(parseHash("#raid")).toEqual({ view: "raid", itemId: null });
  });
  it("parses a view slug with an item id", () => {
    expect(parseHash("#raid/123")).toEqual({ view: "raid", itemId: 123 });
  });
  it("ignores a non-numeric id", () => {
    expect(parseHash("#raid/abc")).toEqual({ view: "raid", itemId: null });
  });
  it("falls back to open-points for unknown views", () => {
    expect(parseHash("")).toEqual({ view: "open-points", itemId: null });
  });
  it("builds both forms", () => {
    expect(buildHash("raid")).toBe("#raid");
    expect(buildHash("raid", 123)).toBe("#raid/123");
    expect(buildHash("raid", null)).toBe("#raid");
  });
});

describe("filterNavGroups", () => {
  it("Simple mode keeps only core items and drops empty groups", () => {
    const groups = filterNavGroups([]);
    const views = groups.flatMap((g) => g.items.map((i) => i.view));
    expect(views).toContain("open-points");
    expect(views).toContain("chat");
    expect(views).toContain("reports");
    expect(views).toContain("activity");
    expect(views).not.toContain("gantt");
    expect(views).not.toContain("raid");
    // The "Plan" group has no core items, so it disappears entirely.
    expect(groups.some((g) => g.labelKey === "navGroupPlan")).toBe(false);
    const openPoints = groups.flatMap((g) => g.items).find((i) => i.view === "open-points");
    expect(openPoints?.children).toBeUndefined();
  });

  it("enabling a module restores its parent and children", () => {
    const groups = filterNavGroups(["stakeholders"]);
    const item = groups.flatMap((g) => g.items).find((i) => i.view === "stakeholders");
    expect(item).toBeTruthy();
    expect((item?.children ?? []).map((c) => c.view)).toEqual(["raci", "stakeholder-map"]);
  });
});

describe("subTabsFor with features", () => {
  it("filters children to enabled modules", () => {
    expect(subTabsFor("resources", []).length).toBe(0);
    expect(subTabsFor("resources", ["resources"]).length).toBeGreaterThan(0);
  });
  it("is unchanged when no features arg is supplied", () => {
    expect(subTabsFor("resources").length).toBeGreaterThan(0);
  });
});
