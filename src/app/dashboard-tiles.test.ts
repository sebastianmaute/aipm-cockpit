import { describe, expect, it } from "vitest";
import { DASHBOARD_TILES, tileById } from "./dashboard-tiles";

describe("DASHBOARD_TILES", () => {
  it("has unique ids", () => {
    const ids = DASHBOARD_TILES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every tile defaults inside its own limits", () => {
    for (const t of DASHBOARD_TILES) {
      expect(t.w, `${t.id} w`).toBeGreaterThanOrEqual(t.minW);
      expect(t.w, `${t.id} w`).toBeLessThanOrEqual(t.maxW);
      expect(t.h, `${t.id} h`).toBeGreaterThanOrEqual(t.minH);
      expect(t.h, `${t.id} h`).toBeLessThanOrEqual(t.maxH);
    }
  });

  it("keeps every limit within the 1..4 span range", () => {
    for (const t of DASHBOARD_TILES) {
      for (const v of [t.minW, t.maxW, t.minH, t.maxH]) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(4);
      }
    }
  });

  it("only allows minH 1 for single-line content", () => {
    // ★ Tile chrome costs a fixed ~26px off every tile. At the 80px row unit a
    // h:1 tile has ~54px of body — a sparkline fits, a list of rows does not.
    // Any tile claiming minH 1 must be on this list deliberately.
    const singleLine = new Set(["completionTrend"]);
    for (const t of DASHBOARD_TILES) {
      if (t.minH === 1) expect(singleLine.has(t.id), `${t.id} claims minH 1`).toBe(true);
    }
  });

  it("resolves a tile by id and returns undefined for an unknown one", () => {
    expect(tileById("kpi")?.id).toBe("kpi");
    expect(tileById("nope" as never)).toBeUndefined();
  });
});
