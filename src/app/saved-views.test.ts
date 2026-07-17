import { describe, it, expect, beforeEach } from "vitest";
import {
  loadSavedViews,
  addSavedView,
  removeSavedView,
  renameSavedView,
  saveSavedViews,
  SAVED_VIEWS_KEY,
  MAX_SAVED_VIEWS,
  type SavedView,
  type SavedViewPayload,
} from "./saved-views";

function mkPayload(over: Partial<SavedViewPayload> = {}): SavedViewPayload {
  return {
    search: "",
    priorityFilter: "All",
    assigneeFilter: "All",
    groupFilter: "All",
    labelFilter: "All",
    healthFilter: "all",
    sortKey: "id",
    sortDir: "asc",
    hiddenCols: [],
    ...over,
  };
}

describe("saved-views store", () => {
  beforeEach(() => localStorage.clear());

  it("assigns sequential ids starting at 1", () => {
    const p = mkPayload();
    const after1 = addSavedView([], "A", p);
    expect(after1).toHaveLength(1);
    expect(after1[0].id).toBe(1);

    const after2 = addSavedView(after1, "B", p);
    expect(after2).toHaveLength(2);
    expect(after2[1].id).toBe(2);
  });

  it("uses id 1 for the first view on an empty list (no -Infinity/NaN)", () => {
    const result = addSavedView([], "First", mkPayload());
    expect(result[0].id).toBe(1);
    expect(Number.isFinite(result[0].id)).toBe(true);
  });

  it("caps the list to MAX_SAVED_VIEWS dropping the oldest, keeping most recent, ids strictly increasing", () => {
    let list: SavedView[] = [];
    const total = MAX_SAVED_VIEWS + 2;
    for (let i = 0; i < total; i++) {
      list = addSavedView(list, `View ${i}`, mkPayload({ search: `s${i}` }));
    }
    expect(list).toHaveLength(MAX_SAVED_VIEWS);

    // oldest (View 0, View 1) dropped; most recent kept
    expect(list.some((v) => v.name === "View 0")).toBe(false);
    expect(list.some((v) => v.name === "View 1")).toBe(false);
    expect(list[list.length - 1].name).toBe(`View ${total - 1}`);

    // ids strictly increasing
    for (let i = 1; i < list.length; i++) {
      expect(list[i].id).toBeGreaterThan(list[i - 1].id);
    }
  });

  it("removes a view by id", () => {
    let list = addSavedView([], "A", mkPayload());
    list = addSavedView(list, "B", mkPayload());
    const removed = removeSavedView(list, 1);
    expect(removed).toHaveLength(1);
    expect(removed[0].id).toBe(2);
    expect(removed[0].name).toBe("B");
  });

  it("renames a view leaving payload and other views intact", () => {
    let list = addSavedView([], "A", mkPayload({ search: "keep" }));
    list = addSavedView(list, "B", mkPayload());
    const renamed = renameSavedView(list, 1, "Renamed");
    expect(renamed[0].name).toBe("Renamed");
    expect(renamed[0].payload.search).toBe("keep");
    expect(renamed[1].name).toBe("B");
    // immutable: original list untouched
    expect(list[0].name).toBe("A");
  });

  it("loadSavedViews returns [] when absent", () => {
    expect(loadSavedViews()).toEqual([]);
  });

  it("loadSavedViews returns [] on garbage JSON without throwing", () => {
    localStorage.setItem(SAVED_VIEWS_KEY, "garbage{");
    expect(loadSavedViews()).toEqual([]);
  });

  it("loadSavedViews drops malformed entries, keeping only valid ones", () => {
    const valid: SavedView = { id: 1, name: "Valid", payload: mkPayload() };
    const malformed = { id: "x" };
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([valid, malformed]));
    const loaded = loadSavedViews();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(valid);
  });

  it("round-trips through save/load", () => {
    const v: SavedView = { id: 1, name: "RT", payload: mkPayload({ hiddenCols: ["a", "b"] }) };
    saveSavedViews([v]);
    expect(loadSavedViews()).toEqual([v]);
  });

  it("round-trips a concrete healthFilter value", () => {
    const v: SavedView = { id: 1, name: "Red", payload: mkPayload({ healthFilter: "red" }) };
    saveSavedViews([v]);
    expect(loadSavedViews()[0].payload.healthFilter).toBe("red");
  });

  it("keeps an OLD saved view that predates the healthFilter field (backward compat)", () => {
    // Simulate a payload persisted before healthFilter existed (field absent).
    const legacy = mkPayload();
    delete (legacy as Partial<SavedViewPayload>).healthFilter;
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([{ id: 1, name: "Old", payload: legacy }]));
    const loaded = loadSavedViews();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].payload.healthFilter).toBeUndefined();
  });

  it("drops a saved view whose healthFilter is an unrecognised value", () => {
    const bad = { ...mkPayload(), healthFilter: "purple" };
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([{ id: 1, name: "Bad", payload: bad }]));
    expect(loadSavedViews()).toHaveLength(0);
  });
});
