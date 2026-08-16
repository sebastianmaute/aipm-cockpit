import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { reconcile, type DashboardLayout } from "./dashboard-layout";
import { DASHBOARD_TILES, type DashboardTileId, type TileSpan } from "./dashboard-tiles";

const anyId = fc.constantFrom(...DASHBOARD_TILES.map((t) => t.id));
const anySpan = fc.constantFrom<TileSpan>(1, 2, 3, 4);

const anyLayout = fc.record({
  v: fc.constant(1 as const),
  board: fc.array(fc.record({ id: anyId, w: anySpan, h: anySpan }), { maxLength: 15 }),
  hidden: fc.array(anyId, { maxLength: 6 }),
}) as fc.Arbitrary<DashboardLayout>;

describe("reconcile properties", () => {
  it("is idempotent — reconciling twice equals reconciling once", () => {
    fc.assert(fc.property(anyLayout, (l) => {
      const once = reconcile(l);
      expect(reconcile(once)).toEqual(once);
    }));
  });

  it("never loses a catalogue tile — every id is on the board or hidden, exactly once", () => {
    fc.assert(fc.property(anyLayout, (l) => {
      const out = reconcile(l);
      const seen = [...out.board.map((t) => t.id), ...out.hidden];
      for (const spec of DASHBOARD_TILES) {
        expect(seen.filter((id) => id === spec.id).length).toBe(1);
      }
    }));
  });

  it("always emits sizes inside each tile's limits", () => {
    fc.assert(fc.property(anyLayout, (l) => {
      for (const p of reconcile(l).board) {
        const spec = DASHBOARD_TILES.find((t) => t.id === p.id)!;
        expect(p.w).toBeGreaterThanOrEqual(spec.minW);
        expect(p.w).toBeLessThanOrEqual(spec.maxW);
        expect(p.h).toBeGreaterThanOrEqual(spec.minH);
        expect(p.h).toBeLessThanOrEqual(spec.maxH);
      }
    }));
  });

  it("never puts an id on the board and in hidden at once", () => {
    fc.assert(fc.property(anyLayout, (l) => {
      const out = reconcile(l);
      const board = new Set<DashboardTileId>(out.board.map((t) => t.id));
      for (const id of out.hidden) expect(board.has(id)).toBe(false);
    }));
  });
});
