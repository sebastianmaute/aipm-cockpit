import { describe, expect, it } from "vitest";
import {
  NAV_GROUPS, viewToSlug, slugToView, navLabelKey, allNavViews, subTabsFor,
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
});

describe("trends nav", () => {
  it("includes trends in the Overview group", () => {
    expect(allNavViews()).toContain("trends");
  });
  it("maps trends to its label key", () => {
    expect(navLabelKey("trends")).toBe("navTrends");
  });
});
