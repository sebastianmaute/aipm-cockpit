import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  defaultLayout, moveBlock, hideBlock, restoreBlock, resizeBlock, reconcile,
  type BlockSpec, type ArrangementLayout, type BlockSpan,
} from "./arrangement-layout";

type TestId = "a" | "b" | "c";

const CAT: readonly BlockSpec<TestId>[] = [
  { id: "a", labelKey: "cancel", w: 2, h: 2, minW: 1, maxW: 4, minH: 1, maxH: 4 },
  { id: "b", labelKey: "cancel", w: 1, h: 1, minW: 1, maxW: 2, minH: 1, maxH: 2 },
  { id: "c", labelKey: "cancel", w: 4, h: 2, minW: 4, maxW: 4, minH: 2, maxH: 4 },
];
const DEF = defaultLayout(CAT);

const idArb = fc.constantFrom<TestId>("a", "b", "c");
const spanArb = fc.constantFrom<BlockSpan>(1, 2, 3, 4);
const axisArb = fc.constantFrom("w" as const, "h" as const);

const opArb = fc.oneof(
  fc.record({ kind: fc.constant("move" as const), a: idArb, b: idArb }),
  fc.record({ kind: fc.constant("hide" as const), a: idArb }),
  fc.record({ kind: fc.constant("restore" as const), a: idArb }),
  fc.record({
    kind: fc.constant("resize" as const), a: idArb,
    axis: axisArb, v: fc.integer({ min: -3, max: 9 }),
  }),
);

// ★ `satisfies`, NOT `as`. The assertion bought nothing — tsc accepts the plain
// record — and it MASKED drift: with `as` in place, changing `w: spanArb` to
// `fc.integer({min:-9,max:99})` still compiled clean, even though the arbitrary
// then produces `{w: number}`, which is not an `ArrangementLayout<TestId>`.
// Measured, not assumed. `satisfies` keeps the type import referenced, so
// `--max-warnings=0` stays happy where a bare deletion would orphan it.
const layoutArb = fc.record({
  v: fc.constant(1 as const),
  board: fc.array(fc.record({ id: idArb, w: spanArb, h: spanArb }), { maxLength: 8 }),
  hidden: fc.array(idArb, { maxLength: 6 }),
}) satisfies fc.Arbitrary<ArrangementLayout<TestId>>;

describe("arrangement-layout properties", () => {
  // ★ THIS is the property that found a real defect on the Dashboard: `reconcile`
  // de-duplicated the board but not the shelf, so a stored ["kpi","kpi"] rendered
  // the same tile twice with duplicate React keys. Review did not catch it.
  it("keeps every block exactly once across board + hidden", () => {
    fc.assert(fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
      let l = DEF;
      for (const op of ops) {
        if (op.kind === "move") l = moveBlock(l, op.a, op.b);
        else if (op.kind === "hide") l = hideBlock(l, op.a);
        else if (op.kind === "restore") l = restoreBlock(CAT, l, op.a);
        else l = resizeBlock(CAT, l, op.a, op.axis, op.v);
      }
      const seen = [...l.board.map((b) => b.id), ...l.hidden].sort();
      expect(seen).toEqual(["a", "b", "c"]);
    }));
  });

  it("never lets a span escape that block's own bounds", () => {
    fc.assert(fc.property(idArb, axisArb, fc.integer({ min: -9, max: 99 }),
      (id, axis, v) => {
        const out = resizeBlock(CAT, DEF, id, axis, v);
        const p = out.board.find((b) => b.id === id)!;
        const spec = CAT.find((s) => s.id === id)!;
        const [lo, hi] = axis === "w" ? [spec.minW, spec.maxW] : [spec.minH, spec.maxH];
        expect(p[axis]).toBeGreaterThanOrEqual(lo);
        expect(p[axis]).toBeLessThanOrEqual(hi);
      }));
  });

  it("is idempotent — reconciling twice equals reconciling once", () => {
    fc.assert(fc.property(layoutArb, (l) => {
      const once = reconcile(CAT, l, DEF);
      expect(reconcile(CAT, once, DEF)).toEqual(once);
    }));
  });

  // ★★ NOTHING HERE ASSERTS THE ARBITRARY REACHES THE INTERESTING SHAPES — in
  // particular that `hidden` ever holds a DUPLICATE, which is the only input
  // that exercises the `hiddenSet` de-duplication. That is answered
  // EMPIRICALLY rather than by a guard: reverting the de-duplication turns the
  // property below red (measured, 2 failed / 10 passed with the unit test), so
  // the generator demonstrably reaches the shape. ★ Do NOT "strengthen" this
  // into a fraction-based anti-vacuity guard at a raised `numRuns` — raising
  // runs at the same failure fraction makes such a guard WEAKER, not stronger.
  it("reconcile emits every catalogue block exactly once, inside its own limits", () => {
    fc.assert(fc.property(layoutArb, (l) => {
      const out = reconcile(CAT, l, DEF);
      const seen = [...out.board.map((b) => b.id), ...out.hidden];
      for (const spec of CAT) {
        expect(seen.filter((id) => id === spec.id).length).toBe(1);
      }
      for (const p of out.board) {
        const spec = CAT.find((s) => s.id === p.id)!;
        expect(p.w).toBeGreaterThanOrEqual(spec.minW);
        expect(p.w).toBeLessThanOrEqual(spec.maxW);
        expect(p.h).toBeGreaterThanOrEqual(spec.minH);
        expect(p.h).toBeLessThanOrEqual(spec.maxH);
      }
    }));
  });
});
