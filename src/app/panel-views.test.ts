import { describe, expect, it, beforeEach } from "vitest";
import {
  type PanelView,
  type PanelFiltersState,
  PANEL_VIEWS_KEY,
  MAX_PANEL_VIEWS,
  loadPanelViews,
  panelViewsFor,
  addPanelView,
  removePanelView,
  savePanelViews,
} from "./panel-views";

const state = (search = ""): PanelFiltersState => ({ search, filters: { status: "All" }, sort: null });

beforeEach(() => localStorage.clear());

describe("panel-views store", () => {
  it("loads [] when empty or malformed", () => {
    expect(loadPanelViews()).toEqual([]);
    localStorage.setItem(PANEL_VIEWS_KEY, "not json");
    expect(loadPanelViews()).toEqual([]);
    localStorage.setItem(PANEL_VIEWS_KEY, JSON.stringify([{ id: "x", name: 1 }]));
    expect(loadPanelViews()).toEqual([]);
  });

  it("addPanelView assigns max+1 id across the whole list", () => {
    let list: PanelView[] = [];
    list = addPanelView(list, "raid", "A", state());
    list = addPanelView(list, "changes", "B", state());
    expect(list.map((v) => v.id)).toEqual([1, 2]);
    expect(list[0].view).toBe("raid");
  });

  it("panelViewsFor scopes to one view", () => {
    let list: PanelView[] = [];
    list = addPanelView(list, "raid", "A", state());
    list = addPanelView(list, "changes", "B", state());
    expect(panelViewsFor(list, "raid").map((v) => v.name)).toEqual(["A"]);
  });

  it("caps per view, dropping the oldest entry of that view only", () => {
    let list: PanelView[] = [];
    for (let i = 0; i < MAX_PANEL_VIEWS + 2; i++) list = addPanelView(list, "raid", `R${i}`, state());
    list = addPanelView(list, "changes", "C", state());
    const raids = panelViewsFor(list, "raid");
    expect(raids).toHaveLength(MAX_PANEL_VIEWS);
    expect(raids[0].name).toBe("R2");
    expect(panelViewsFor(list, "changes")).toHaveLength(1);
  });

  it("removePanelView removes by id", () => {
    let list: PanelView[] = [];
    list = addPanelView(list, "raid", "A", state());
    list = removePanelView(list, 1);
    expect(list).toEqual([]);
  });

  it("round-trips through save/load and validates state shape", () => {
    let list: PanelView[] = [];
    list = addPanelView(list, "milestones", "M", { search: "x", filters: { status: "all" }, sort: { key: "date", dir: "asc" } });
    savePanelViews(list);
    expect(loadPanelViews()).toEqual(list);
  });
});
