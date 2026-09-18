import { describe, expect, it } from "vitest";
import { upgradeDashboardLayout } from "./dashboard-layout-upgrade";
import { DASHBOARD_BURN_UPGRADE, DEFAULT_LAYOUT, reconcile, type DashboardLayout } from "./dashboard-layout";
import type { TileHeight } from "./dashboard-tiles";

/** A pre-spec-C stored layout: no upgrades list, burn mid-board at its old
 *  1×3, Completion trend at its old h:1, one tile hidden. */
const legacy = (): DashboardLayout => ({
  v: 1,
  board: [
    { id: "kpi", w: 4, h: 2 },
    { id: "raid", w: 1, h: 3 },
    { id: "burn", w: 1, h: 3 },
    { id: "completionTrend", w: 3, h: 1 },
    { id: "upcoming", w: 2, h: 4 },
  ],
  hidden: ["changes"],
});

describe("upgradeDashboardLayout (spec C decision 11)", () => {
  it("records the upgrade id", () => {
    expect(upgradeDashboardLayout(legacy()).upgrades).toEqual([DASHBOARD_BURN_UPGRADE]);
  });

  it("moves Budget burn to the front at 2×8", () => {
    const out = upgradeDashboardLayout(legacy());
    expect(out.board[0]).toEqual({ id: "burn", w: 2, h: 8 });
    expect(out.board.filter((p) => p.id === "burn")).toHaveLength(1);
  });

  it("keeps a hidden Budget burn hidden, and off the board", () => {
    const stored: DashboardLayout = { ...legacy(), board: legacy().board.filter((p) => p.id !== "burn"), hidden: ["changes", "burn"] };
    const out = upgradeDashboardLayout(stored);
    expect(out.hidden).toEqual(["changes", "burn"]);
    expect(out.board.some((p) => p.id === "burn")).toBe(false);
    expect(out.upgrades).toEqual([DASHBOARD_BURN_UPGRADE]);
  });

  it("clamps Completion trend's height into 2–4, from 1 and from any out-of-range stored value", () => {
    const cases: [number, number][] = [[1, 2], [0, 2], [-3, 2], [3, 3], [5, 4], [8, 4], [99, 4], [2.6, 3]];
    for (const [stored, expected] of cases) {
      const layout: DashboardLayout = { v: 1, board: [{ id: "completionTrend", w: 2, h: stored as TileHeight }], hidden: [] };
      const trend = upgradeDashboardLayout(layout).board.find((p) => p.id === "completionTrend")!;
      expect(trend.h, `stored h ${stored}`).toBe(expected);
      expect(trend.w).toBe(2);
    }
  });

  it("preserves every other tile's order, size and hidden state", () => {
    const out = upgradeDashboardLayout(legacy());
    expect(out.board.slice(1)).toEqual([
      { id: "kpi", w: 4, h: 2 },
      { id: "raid", w: 1, h: 3 },
      { id: "completionTrend", w: 3, h: 2 },
      { id: "upcoming", w: 2, h: 4 },
    ]);
    expect(out.hidden).toEqual(["changes"]);
  });

  it("is a no-op on a second run — the same reference comes back", () => {
    const once = upgradeDashboardLayout(legacy());
    expect(upgradeDashboardLayout(once)).toBe(once);
  });

  it("leaves a layout already carrying the id untouched, burn wherever the user put it", () => {
    const moved: DashboardLayout = { ...legacy(), upgrades: [DASHBOARD_BURN_UPGRADE] };
    expect(upgradeDashboardLayout(moved)).toBe(moved);
  });

  it("keeps any other applied upgrade id beside its own", () => {
    expect(upgradeDashboardLayout({ ...legacy(), upgrades: ["other"] }).upgrades).toEqual(["other", DASHBOARD_BURN_UPGRADE]);
  });

  it("falls back to the default layout for junk input", () => {
    for (const junk of [null, undefined, "x", 7, {}, { v: 2, board: [], hidden: [] }, { v: 1, board: null, hidden: [] }]) {
      expect(upgradeDashboardLayout(junk), JSON.stringify(junk)).toBe(DEFAULT_LAYOUT);
    }
  });

  it("survives reconcile: burn stays first at 2×8 and the id stays recorded", () => {
    const out = reconcile(upgradeDashboardLayout(legacy()));
    expect(out.board[0]).toEqual({ id: "burn", w: 2, h: 8 });
    expect(out.upgrades).toEqual([DASHBOARD_BURN_UPGRADE]);
  });
});

describe("DEFAULT_LAYOUT (spec C)", () => {
  it("puts Budget burn first at 2×8", () => {
    expect(DEFAULT_LAYOUT.board[0]).toEqual({ id: "burn", w: 2, h: 8 });
  });

  it("already carries the upgrade id, so a fresh or reset board is never upgraded", () => {
    expect(DEFAULT_LAYOUT.upgrades).toEqual([DASHBOARD_BURN_UPGRADE]);
    expect(upgradeDashboardLayout(DEFAULT_LAYOUT)).toBe(DEFAULT_LAYOUT);
  });
});
