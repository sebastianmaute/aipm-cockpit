import { beforeEach, describe, expect, it } from "vitest";
import { DASHBOARD_LAYOUT_KEY, loadLayout, saveLayout } from "./dashboard-layout-store";
import type { DashboardLayout } from "./dashboard-layout";

const sample: DashboardLayout = { v: 1, board: [{ id: "kpi", w: 4, h: 2 }], hidden: ["raid"] };

describe("dashboard-layout-store", () => {
  beforeEach(() => { localStorage.clear(); });

  it("round-trips a layout for a project", () => {
    saveLayout("p1", sample);
    expect(loadLayout("p1")).toEqual(sample);
  });

  it("keeps projects independent", () => {
    saveLayout("p1", sample);
    expect(loadLayout("p2")).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(loadLayout("p1")).toBeNull();
  });

  it("returns null on corrupt JSON instead of throwing", () => {
    localStorage.setItem(DASHBOARD_LAYOUT_KEY, "{not json");
    expect(loadLayout("p1")).toBeNull();
  });

  it("returns null for a stored value of the wrong shape", () => {
    localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify({ p1: { v: 1, board: "nope" } }));
    expect(loadLayout("p1")).toBeNull();
  });

  it("caps the map at 50 projects, evicting the least recently saved", () => {
    for (let i = 0; i < 55; i++) saveLayout(`p${i}`, sample);
    const map: unknown = JSON.parse(localStorage.getItem(DASHBOARD_LAYOUT_KEY)!);
    expect(Object.keys(map as Record<string, unknown>).length).toBe(50);
    expect(loadLayout("p0")).toBeNull();       // evicted
    expect(loadLayout("p54")).toEqual(sample); // newest kept
  });
});
