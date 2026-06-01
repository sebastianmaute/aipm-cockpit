import { describe, expect, it } from "vitest";
import {
  NAV_GROUPS, viewToSlug, slugToView, navLabelKey, allNavViews,
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
});
