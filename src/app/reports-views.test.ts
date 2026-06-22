import { describe, expect, it, beforeEach } from "vitest";
import {
  type ReportsSavedView,
  type ReportsViewState,
  REPORTS_VIEWS_KEY,
  MAX_REPORTS_VIEWS,
  loadReportsViews,
  addReportsView,
  removeReportsView,
  saveReportsViews,
} from "./reports-views";

const state = (filter = ""): ReportsViewState => ({
  assignee: { filter, sort: { key: "total", dir: "desc" } },
  group: { filter: "", sort: { key: "total", dir: "off" } },
  label: { filter: "", sort: { key: "name", dir: "asc" } },
});

beforeEach(() => localStorage.clear());

describe("reports-views store", () => {
  it("loads [] when empty or malformed", () => {
    expect(loadReportsViews()).toEqual([]);
    localStorage.setItem(REPORTS_VIEWS_KEY, "not json");
    expect(loadReportsViews()).toEqual([]);
    localStorage.setItem(REPORTS_VIEWS_KEY, JSON.stringify([{ id: "x", name: 1 }]));
    expect(loadReportsViews()).toEqual([]);
  });

  it("addReportsView assigns max+1 id", () => {
    let list: ReportsSavedView[] = [];
    list = addReportsView(list, "A", state());
    list = addReportsView(list, "B", state());
    expect(list.map((v) => v.id)).toEqual([1, 2]);
  });

  it("caps at MAX_REPORTS_VIEWS, dropping the oldest", () => {
    let list: ReportsSavedView[] = [];
    for (let i = 0; i < MAX_REPORTS_VIEWS + 2; i++) list = addReportsView(list, `V${i}`, state());
    expect(list).toHaveLength(MAX_REPORTS_VIEWS);
    expect(list[0].name).toBe("V2");
  });

  it("removeReportsView removes by id", () => {
    let list: ReportsSavedView[] = [];
    list = addReportsView(list, "A", state());
    list = removeReportsView(list, 1);
    expect(list).toEqual([]);
  });

  it("round-trips through save/load", () => {
    let list: ReportsSavedView[] = [];
    list = addReportsView(list, "M", state("x"));
    saveReportsViews(list);
    expect(loadReportsViews()).toEqual(list);
  });

  it("persists a sort dir of 'off' (tables cycle asc->desc->off)", () => {
    let list: ReportsSavedView[] = [];
    list = addReportsView(list, "Off", state());
    saveReportsViews(list);
    expect(loadReportsViews()).toEqual(list);
  });

  it("drops an entry whose sort dir is invalid", () => {
    const bad = [{ id: 1, name: "x", state: { assignee: { filter: "", sort: { key: "total", dir: "sideways" } }, group: { filter: "", sort: null }, label: { filter: "", sort: null } } }];
    localStorage.setItem(REPORTS_VIEWS_KEY, JSON.stringify(bad));
    expect(loadReportsViews()).toEqual([]);
  });
});
