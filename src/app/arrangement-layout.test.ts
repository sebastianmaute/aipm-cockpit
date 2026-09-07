import { describe, expect, it } from "vitest";
import {
  defaultLayout, moveBlock, hideBlock, restoreBlock, resizeBlock, reconcile,
  type BlockSpec, type ArrangementLayout,
} from "./arrangement-layout";

type TestId = "a" | "b" | "c";

/** A synthetic catalogue — the whole point of the extraction is that the engine
 *  never sees `DASHBOARD_TILES`. `labelKey` is a real `TranslationKey` because
 *  the spec type keeps that tightening; the engine itself never reads it. */
const CAT: readonly BlockSpec<TestId>[] = [
  { id: "a", labelKey: "cancel", w: 2, h: 2, minW: 1, maxW: 4, minH: 1, maxH: 4 },
  { id: "b", labelKey: "cancel", w: 1, h: 1, minW: 1, maxW: 2, minH: 1, maxH: 2 },
  { id: "c", labelKey: "cancel", w: 4, h: 2, minW: 4, maxW: 4, minH: 2, maxH: 4 },
];
const DEF = defaultLayout(CAT);

describe("arrangement-layout", () => {
  it("places every catalogue block at its default size", () => {
    expect(DEF.board.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(DEF.board.map((p) => [p.w, p.h])).toEqual([[2, 2], [1, 1], [4, 2]]);
    expect(DEF.hidden).toEqual([]);
  });

  it("returns the same object on a no-op move", () => {
    expect(moveBlock(DEF, "a", "a")).toBe(DEF);
  });

  it("clamps a stored span to the block's own bounds, per axis", () => {
    const stored: ArrangementLayout<TestId> = {
      v: 1, board: [{ id: "c", w: 1, h: 3 }], hidden: [],
    };
    const out = reconcile(CAT, stored, DEF);
    // ★ NOT `out.board[0]` — reconcile re-inserts the absent "a" and "b" AHEAD
    // of "c" (each lands after its nearest present catalogue predecessor), so
    // index 0 is "a". Address the block by id or this asserts about the wrong one.
    const c = out.board.find((p) => p.id === "c")!;
    expect(c.w).toBe(4);   // clamped up to minW
    expect(c.h).toBe(3);   // already legal, survives
  });

  it("de-duplicates the hidden list as well as the board", () => {
    const stored = {
      v: 1 as const, board: [], hidden: ["a", "a", "zz"] as TestId[],
    };
    expect(reconcile(CAT, stored, DEF).hidden).toEqual(["a"]);
  });

  it("inserts a new catalogue block after its nearest present predecessor", () => {
    const stored: ArrangementLayout<TestId> = {
      v: 1, board: [{ id: "a", w: 2, h: 2 }, { id: "c", w: 4, h: 2 }], hidden: [],
    };
    expect(reconcile(CAT, stored, DEF).board.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("returns the supplied default by reference for a null blob", () => {
    expect(reconcile(CAT, null, DEF)).toBe(DEF);
  });

  it("hides and restores through the catalogue it is handed", () => {
    const hiddenA = hideBlock(DEF, "a");
    expect(hiddenA.board.map((p) => p.id)).toEqual(["b", "c"]);
    expect(hiddenA.hidden).toEqual(["a"]);
    const back = restoreBlock(CAT, hiddenA, "a", 1);
    expect(back.board.map((p) => p.id)).toEqual(["b", "a", "c"]);
    expect(back.hidden).toEqual([]);
  });

  it("returns the same object when a resize changes nothing", () => {
    expect(resizeBlock(CAT, DEF, "c", "w", 4)).toBe(DEF);
  });

  // ★★ ALL FOUR MUTATORS NEED THEIR OWN NO-OP PIN, and the two below were the
  // gap. The engine's header states the same-reference contract for all four;
  // the two here were held ONLY by `dashboard-layout.test.ts`, i.e. through the
  // Dashboard's binding. The engine is meant to outlive that binding, so a
  // `return { ...layout }` in either function survived this file entirely.
  it("returns the same object when hiding a block that is not on the board", () => {
    const hiddenA = hideBlock(DEF, "a");
    expect(hideBlock(hiddenA, "a")).toBe(hiddenA);
  });

  it("returns the same object when restoring a block that is not hidden", () => {
    expect(restoreBlock(CAT, DEF, "a")).toBe(DEF);
  });

  // ★★ ANSWERS A DESIGN QUESTION, not just a behaviour: can a surface start a
  // block hidden? YES — but only by seeding its OWN fallback, never by anything
  // in the catalogue, because `defaultLayout` places every member. reconcile
  // then honours the seeded `hidden` on every later load. The limit this does
  // NOT reach is a NEWLY ADDED catalogue block for a user who already has a
  // stored layout: step 2 puts that on the board by design.
  it("lets a surface seed a block hidden by default, and keeps it hidden", () => {
    const seeded: ArrangementLayout<TestId> = {
      v: 1,
      board: DEF.board.filter((p) => p.id !== "b"),
      hidden: ["b"],
    };
    expect(reconcile(CAT, null, seeded)).toBe(seeded);
    const out = reconcile(CAT, seeded, seeded);
    expect(out.board.map((p) => p.id)).toEqual(["a", "c"]);
    expect(out.hidden).toEqual(["b"]);
  });
});
