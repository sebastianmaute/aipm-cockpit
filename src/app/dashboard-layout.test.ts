import { describe, expect, it } from "vitest";
import { hideTile, moveTile, restoreTile, type DashboardLayout } from "./dashboard-layout";

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
