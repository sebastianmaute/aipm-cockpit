import { describe, expect, it } from "vitest";
import { hideTile, moveTile, reconcile, restoreTile, type DashboardLayout } from "./dashboard-layout";
import { DASHBOARD_TILES } from "./dashboard-tiles";

const layout = (): DashboardLayout => ({
  v: 1,
  board: [
    { id: "kpi", w: 4, h: 2 },
    { id: "raid", w: 2, h: 2 },
    { id: "upcoming", w: 2, h: 2 },
  ],
  hidden: ["burn"],
});

describe("moveTile", () => {
  it("moves a tile into the target's slot", () => {
    const next = moveTile(layout(), "kpi", "upcoming");
    expect(next.board.map((t) => t.id)).toEqual(["raid", "upcoming", "kpi"]);
  });

  it("preserves each tile's size while moving", () => {
    const next = moveTile(layout(), "kpi", "upcoming");
    expect(next.board.find((t) => t.id === "kpi")).toEqual({ id: "kpi", w: 4, h: 2 });
  });

  it("returns the same object when the move is a no-op", () => {
    const l = layout();
    expect(moveTile(l, "kpi", "kpi")).toBe(l);
    expect(moveTile(l, "burn", "kpi")).toBe(l);   // burn is hidden, not on the board
  });
});

describe("hideTile", () => {
  it("removes the tile from the board and appends it to hidden", () => {
    const next = hideTile(layout(), "raid");
    expect(next.board.map((t) => t.id)).toEqual(["kpi", "upcoming"]);
    expect(next.hidden).toEqual(["burn", "raid"]);
  });

  it("returns the same object when the tile is not on the board", () => {
    const l = layout();
    expect(hideTile(l, "burn")).toBe(l);
  });
});

describe("restoreTile", () => {
  it("appends a hidden tile to the board at its catalogue default size", () => {
    const next = restoreTile(layout(), "burn");
    expect(next.hidden).toEqual([]);
    expect(next.board.at(-1)).toEqual({ id: "burn", w: 1, h: 2 });
  });

  it("inserts at an explicit index when given one", () => {
    const next = restoreTile(layout(), "burn", 0);
    expect(next.board[0].id).toBe("burn");
  });

  it("returns the same object when the tile is not hidden", () => {
    const l = layout();
    expect(restoreTile(l, "kpi")).toBe(l);
  });
});

import { resizeTile } from "./dashboard-layout";

describe("resizeTile", () => {
  it("sets one axis without touching the other", () => {
    const next = resizeTile(layout(), "raid", "h", 4);
    expect(next.board.find((t) => t.id === "raid")).toEqual({ id: "raid", w: 2, h: 4 });
  });

  it("clamps a value above the tile's max", () => {
    // raid maxH is 4
    const next = resizeTile(layout(), "raid", "h", 4);
    expect(next.board.find((t) => t.id === "raid")!.h).toBe(4);
  });

  it("clamps a value below the tile's min", () => {
    // kpi minW is 2
    const next = resizeTile(layout(), "kpi", "w", 1);
    expect(next.board.find((t) => t.id === "kpi")!.w).toBe(2);
  });

  it("returns the same object when the value does not change", () => {
    const l = layout();
    expect(resizeTile(l, "raid", "w", 2)).toBe(l);
  });

  it("returns the same object for a tile not on the board", () => {
    const l = layout();
    expect(resizeTile(l, "burn", "w", 2)).toBe(l);
  });
});

describe("reconcile", () => {
  it("drops an id that no longer exists in the catalogue", () => {
    const stored = { v: 1 as const, board: [{ id: "ghost" as never, w: 2 as const, h: 2 as const }, { id: "kpi" as const, w: 4 as const, h: 2 as const }], hidden: [] };
    const next = reconcile(stored);
    expect(next.board.map((t) => t.id)).not.toContain("ghost");
    expect(next.board.map((t) => t.id)).toContain("kpi");
  });

  it("inserts a new catalogue tile after its nearest present predecessor", () => {
    // Catalogue order starts kpi, topActions, insights, raid, upcoming...
    // Store knows kpi and raid only; insights must land between them.
    const stored = { v: 1 as const, board: [{ id: "kpi" as const, w: 4 as const, h: 2 as const }, { id: "raid" as const, w: 2 as const, h: 2 as const }], hidden: [] };
    const next = reconcile(stored);
    const ids = next.board.map((t) => t.id);
    expect(ids.indexOf("insights")).toBeGreaterThan(ids.indexOf("kpi"));
    expect(ids.indexOf("insights")).toBeLessThan(ids.indexOf("raid"));
  });

  it("inserts at index 0 when no predecessor is present", () => {
    const stored = { v: 1 as const, board: [{ id: "changes" as const, w: 2 as const, h: 2 as const }], hidden: [] };
    const next = reconcile(stored);
    expect(next.board[0].id).toBe("kpi");
  });

  it("clamps a stored size outside the tile's limits, per axis", () => {
    const stored = { v: 1 as const, board: [{ id: "kpi" as const, w: 1 as const, h: 3 as const }], hidden: [] };
    const next = reconcile(stored);
    const kpi = next.board.find((t) => t.id === "kpi")!;
    expect(kpi.w).toBe(2);   // clamped up to minW
    expect(kpi.h).toBe(3);   // legal, and therefore PRESERVED, not reset to the default 2
  });

  it("keeps a gateable tile in the layout rather than dropping it", () => {
    // ★ Turning Budget off and on again must return the burn tile to where the
    // user put it. Dropping it here would lose that position permanently.
    const stored = { v: 1 as const, board: [{ id: "burn" as const, w: 1 as const, h: 2 as const }, { id: "kpi" as const, w: 4 as const, h: 2 as const }], hidden: [] };
    const next = reconcile(stored);
    expect(next.board.map((t) => t.id)).toContain("burn");
  });

  it("takes no gate at all, so no gate state can drop a stored tile", () => {
    // ★ The plan passed a `_gate` the body ignored; eslint rejects an unused
    // parameter here (no argsIgnorePattern, CI runs --max-warnings=0), so the
    // ABSENCE of the parameter carries the invariant instead. Pinning the arity
    // goes red if anyone re-adds it — which is the moment gating could start
    // deciding what is STORED rather than what RENDERS.
    expect(reconcile.length).toBe(1);
    // and every gated tile in the catalogue survives an empty stored board
    const gated = DASHBOARD_TILES.filter((t) => !t.gate({
      showRaid: false, showBudget: false, showChanges: false, showMilestones: false,
      tursoActive: false, hasTopActions: false, hasInsights: false, hasCompletionTrend: false,
    }));
    expect(gated.length).toBeGreaterThan(0);
    const ids = reconcile({ v: 1, board: [], hidden: [] }).board.map((t) => t.id);
    for (const spec of gated) expect(ids).toContain(spec.id);
  });

  it("preserves hidden tiles and never lists one on the board too", () => {
    const stored = { v: 1 as const, board: [{ id: "kpi" as const, w: 4 as const, h: 2 as const }], hidden: ["raid" as const] };
    const next = reconcile(stored);
    expect(next.hidden).toContain("raid");
    expect(next.board.map((t) => t.id)).not.toContain("raid");
  });

  it("returns the default layout for null", () => {
    expect(reconcile(null).board.length).toBe(DASHBOARD_TILES.length);
  });
});
