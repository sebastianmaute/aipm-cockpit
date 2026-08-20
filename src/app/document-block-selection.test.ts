import { describe, it, expect } from "vitest";
import {
  selectionAfterMove,
  selectionAfterInsert,
  selectionAfterDelete,
} from "./document-block-selection";

/** The array `selectionAfterMove` is specified against — `reorderIds`' splice,
 *  spelled out here rather than imported so the expectations are readable as
 *  data. Remove at `from`, insert at the target's PRE-removal index. */
const moved = <T>(items: readonly T[], from: number, to: number): T[] => {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

describe("selectionAfterMove", () => {
  // ★★★ THE DEFECT THIS EXISTS FOR. The selection is a bare INDEX, so a move
  //  that leaves it pointing at the same NUMBER points it at a DIFFERENT
  //  block — and in a document of paragraphs the old index is still a
  //  paragraph, so the "is it still a paragraph?" fallback in
  //  document-editor.tsx never fires. The user moves the block they selected
  //  and watches a different one expand.
  it("follows the moved block itself", () => {
    expect(selectionAfterMove(0, 0, 2)).toBe(2);
    expect(selectionAfterMove(2, 2, 0)).toBe(0);
  });

  // ★★ EXHAUSTIVE over a 4-item list rather than a handful of cases: the
  //  arithmetic has two independent shifts (splice-out, splice-in) and an
  //  off-by-one in either survives any single example. Every (from, to,
  //  chosen) triple is checked against where the block actually lands.
  it("agrees with the splice for every position in a four-block list", () => {
    const ids = [0, 1, 2, 3];
    for (const from of ids) {
      for (const to of ids) {
        const after = moved(ids, from, to);
        for (const chosen of ids) {
          expect({ from, to, chosen, got: selectionAfterMove(chosen, from, to) }).toEqual({
            from,
            to,
            chosen,
            got: after.indexOf(chosen),
          });
        }
      }
    }
  });

  it("leaves an unset selection unset", () => {
    expect(selectionAfterMove(null, 0, 2)).toBeNull();
  });
});

describe("selectionAfterInsert", () => {
  it("shifts a selection at or after the insert point up by one", () => {
    expect(selectionAfterInsert(2, 0)).toBe(3);
    expect(selectionAfterInsert(2, 2)).toBe(3);
  });

  it("leaves a selection before the insert point alone", () => {
    expect(selectionAfterInsert(1, 2)).toBe(1);
  });

  it("leaves an unset selection unset", () => {
    expect(selectionAfterInsert(null, 0)).toBeNull();
  });
});

describe("selectionAfterDelete", () => {
  it("shifts a selection after the deleted block down by one", () => {
    expect(selectionAfterDelete(2, 0)).toBe(1);
  });

  it("leaves a selection before the deleted block alone", () => {
    expect(selectionAfterDelete(1, 2)).toBe(1);
  });

  // ★★ FALL BACK, never adopt the neighbour. Keeping the number would silently
  //  hand the selection to whichever block slid into that slot — the same
  //  wrong-block class the move case fixes, and here the user asked for a
  //  DELETE, which is the one op after which "something else is now selected"
  //  reads as data loss.
  it("clears a selection ON the deleted block rather than adopting its successor", () => {
    expect(selectionAfterDelete(2, 2)).toBeNull();
  });

  it("leaves an unset selection unset", () => {
    expect(selectionAfterDelete(null, 0)).toBeNull();
  });
});
