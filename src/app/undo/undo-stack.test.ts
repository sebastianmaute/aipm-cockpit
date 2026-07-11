import { describe, it, expect } from "vitest";
import {
  applyUndoRestore,
  applyUndoRestoreWithRemap,
  applyUndoForward,
  buildBeforeImages,
  buildForwardImages,
  remapImageField,
  pushUndo,
  popUndo,
  dropEntry,
  type UndoEntry,
} from "./undo-stack";

type Row = { id: number; name: string };
type Ref = { id: number; roleId: number | null };

const del = (index: number, item: Row) => ({ index, item, op: "delete" as const });
const edit = (index: number, item: Row) => ({ index, item, op: "edit" as const });

describe("applyUndoRestore", () => {
  it("re-inserts deleted rows at their original index", () => {
    const current: Row[] = [{ id: 1, name: "a" }, { id: 3, name: "c" }];
    expect(applyUndoRestore(current, [del(1, { id: 2, name: "b" })])).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" },
    ]);
  });

  it("reverts an edited row to its before-image (present → replace)", () => {
    const current: Row[] = [{ id: 1, name: "EDITED" }, { id: 2, name: "b" }];
    expect(applyUndoRestore(current, [edit(0, { id: 1, name: "a" })])).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" },
    ]);
  });

  it("restores a fully-cleared array (clear-all)", () => {
    const before = [del(0, { id: 1, name: "a" }), del(1, { id: 2, name: "b" })];
    expect(applyUndoRestore<Row>([], before)).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" },
    ]);
  });

  it("leaves rows the op never touched intact (interleaving)", () => {
    const current: Row[] = [{ id: 1, name: "EDITED-LATER" }, { id: 3, name: "c" }];
    expect(applyUndoRestore(current, [del(1, { id: 2, name: "b" })])).toEqual([
      { id: 1, name: "EDITED-LATER" }, { id: 2, name: "b" }, { id: 3, name: "c" },
    ]);
  });

  it("clamps a stale index to the array end", () => {
    const current: Row[] = [{ id: 1, name: "a" }];
    expect(applyUndoRestore(current, [del(99, { id: 2, name: "b" })])).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" },
    ]);
  });

  it("re-mints a delete-image whose id was reused by a live row (NO clobber)", () => {
    // Deleted id 3, then a DIFFERENT row was created reusing id 3. Undo must
    // recover the deleted row WITHOUT overwriting the live id-3 row.
    const current: Row[] = [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "NEW-REUSED" }];
    const out = applyUndoRestore(current, [del(2, { id: 3, name: "OLD-DELETED" })]);
    // live row survives unchanged
    expect(out.find((r) => r.name === "NEW-REUSED")).toEqual({ id: 3, name: "NEW-REUSED" });
    // deleted row recovered under a fresh id (max+1 = 4)
    expect(out.find((r) => r.name === "OLD-DELETED")).toEqual({ id: 4, name: "OLD-DELETED" });
    expect(out).toHaveLength(4);
  });

  it("skips an edit-image whose row was deleted since (does not resurrect it)", () => {
    const current: Row[] = [{ id: 1, name: "a" }];
    // edit-image for id 2, but id 2 is gone (deleted after the edit) → skip
    expect(applyUndoRestore(current, [edit(1, { id: 2, name: "stale" })])).toEqual([
      { id: 1, name: "a" },
    ]);
  });

  it("delete-image owns an id present in BOTH lists — the edit-image never clobbers", () => {
    // id 3 is a live reused row; captured (defensively) as both delete and edit.
    const current: Row[] = [{ id: 1, name: "a" }, { id: 3, name: "NEW-REUSED" }];
    const out = applyUndoRestore(current, [
      del(1, { id: 3, name: "OLD-DELETED" }),
      edit(1, { id: 3, name: "OLD-DELETED" }),
    ]);
    expect(out.find((r) => r.name === "NEW-REUSED")).toEqual({ id: 3, name: "NEW-REUSED" });
    expect(out.find((r) => r.name === "OLD-DELETED")).toEqual({ id: 4, name: "OLD-DELETED" });
    expect(out).toHaveLength(3);
  });

  it("restores a delete + its edited dependents together (task-delete shape)", () => {
    // id 2 was deleted; id 3 had a dependency on 2 stripped (edited in place).
    const current: Row[] = [{ id: 1, name: "a" }, { id: 3, name: "3-stripped" }];
    const out = applyUndoRestore(current, [
      del(1, { id: 2, name: "b" }),
      edit(2, { id: 3, name: "3-with-dep" }),
    ]);
    expect(out).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "3-with-dep" },
    ]);
  });
});

describe("stack ops", () => {
  const mk = (id: number): UndoEntry => ({
    meta: { id, kind: "task.deleted", count: 1, timestamp: "t" },
    restore: () => {},
  });

  it("pushUndo evicts the oldest past the cap", () => {
    let s: readonly UndoEntry[] = [];
    for (let i = 1; i <= 12; i++) s = pushUndo(s, mk(i), 10);
    expect(s).toHaveLength(10);
    expect(s[0].meta.id).toBe(3);
    expect(s[9].meta.id).toBe(12);
  });

  it("popUndo returns the top entry and the rest", () => {
    const s = [mk(1), mk(2)];
    const popped = popUndo(s);
    expect(popped?.entry.meta.id).toBe(2);
    expect(popped?.rest[0].meta.id).toBe(1);
    expect(popped?.rest).toHaveLength(1);
  });

  it("popUndo returns null on empty", () => {
    expect(popUndo([])).toBeNull();
  });

  it("dropEntry removes a specific entry by id", () => {
    const s = [mk(1), mk(2), mk(3)];
    expect(dropEntry(s, 2).map((e) => e.meta.id)).toEqual([1, 3]);
  });
});

describe("applyUndoForward", () => {
  it("re-applies an edit (replaces the row with the after-value)", () => {
    const current: Row[] = [{ id: 1, name: "a" }, { id: 2, name: "b" }];
    // forward edit-image carries the AFTER value
    expect(applyUndoForward(current, [edit(0, { id: 1, name: "AFTER" })])).toEqual([
      { id: 1, name: "AFTER" }, { id: 2, name: "b" },
    ]);
  });

  it("re-applies a delete (removes the row with that id)", () => {
    const current: Row[] = [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }];
    expect(applyUndoForward(current, [del(1, { id: 2, name: "b" })])).toEqual([
      { id: 1, name: "a" }, { id: 3, name: "c" },
    ]);
  });

  it("re-applies a clear-all (removes every captured row)", () => {
    const current: Row[] = [{ id: 1, name: "a" }, { id: 2, name: "b" }];
    expect(applyUndoForward(current, [del(0, { id: 1, name: "a" }), del(1, { id: 2, name: "b" })])).toEqual([]);
  });

  it("skips an absent edit/delete row (no crash, no change)", () => {
    const current: Row[] = [{ id: 1, name: "a" }];
    expect(applyUndoForward(current, [edit(9, { id: 9, name: "gone" }), del(9, { id: 8, name: "gone" })])).toEqual([
      { id: 1, name: "a" },
    ]);
  });

  it("applies edits before removals (edit + delete in one forward set)", () => {
    // id 2 deleted; id 3 had a dependency stripped (edited to the after-value).
    const current: Row[] = [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "3-with-dep" }];
    const out = applyUndoForward(current, [
      del(1, { id: 2, name: "b" }),
      edit(2, { id: 3, name: "3-stripped" }),
    ]);
    expect(out).toEqual([{ id: 1, name: "a" }, { id: 3, name: "3-stripped" }]);
  });
});

describe("buildForwardImages", () => {
  it("builds an edit forward-image from the after-value in the post-op array", () => {
    // undo-time state: id 1 currently holds the EDITED value.
    const afterArray: Row[] = [{ id: 1, name: "EDITED" }, { id: 2, name: "b" }];
    // before-image reverts id 1 to "a"; forward must carry the after "EDITED".
    const forward = buildForwardImages([edit(0, { id: 1, name: "a" })], afterArray);
    expect(forward).toEqual([{ index: 0, item: { id: 1, name: "EDITED" }, op: "edit" }]);
  });

  it("falls back to the before-image item when the edited row is gone from the after-array", () => {
    const forward = buildForwardImages([edit(0, { id: 5, name: "old" })], [{ id: 1, name: "a" }]);
    expect(forward).toEqual([{ index: 0, item: { id: 5, name: "old" }, op: "edit" }]);
  });

  it("builds a delete forward-image carrying the deleted row's id", () => {
    // undo-time state: the deleted row was re-inserted, so it's back in the array.
    const afterArray: Row[] = [{ id: 1, name: "a" }, { id: 2, name: "b" }];
    const forward = buildForwardImages([del(1, { id: 2, name: "b" })], afterArray);
    expect(forward).toEqual([{ index: 1, item: { id: 2, name: "b" }, op: "delete" }]);
  });

  it("round-trips a delete: restore then forward returns the post-op array", () => {
    const preOp: Row[] = [{ id: 1, name: "a" }, { id: 2, name: "b" }];
    const before = buildBeforeImages([{ id: 2, name: "b" }], [], preOp);
    const postOp = applyUndoForward(preOp, buildForwardImages(before, preOp));
    expect(postOp).toEqual([{ id: 1, name: "a" }]); // delete applied
    const restored = applyUndoRestore(postOp, before);
    expect(restored).toEqual(preOp); // undo restored
    const forward = buildForwardImages(before, restored);
    expect(applyUndoForward(restored, forward)).toEqual([{ id: 1, name: "a" }]); // redo re-deletes
  });
});

describe("redo after id re-mint (data-loss regression)", () => {
  // delete id1 → create a new row that reuses id1 → undo re-mints the recovered
  // row to id2 → redo must remove id2 (the recovered row), NEVER id1 (the live
  // new row). Guards the CRITICAL bug where redo destroyed the unrelated row.
  it("removes the re-minted recovered row on redo, not the live reused-id row", () => {
    const before = buildBeforeImages<Row>([{ id: 1, name: "Solo" }], [], [{ id: 1, name: "Solo" }]);
    const afterArray: Row[] = [{ id: 1, name: "NewRow" }]; // id1 reused by a new row

    const { result: restored, remap } = applyUndoRestoreWithRemap(afterArray, before);
    // Solo recovered under a fresh id (2); NewRow (id1) untouched.
    expect(restored).toEqual([{ id: 2, name: "Solo" }, { id: 1, name: "NewRow" }]);
    expect(remap.get(1)).toBe(2);

    const forward = buildForwardImages(before, afterArray, remap);
    const redone = applyUndoForward(restored, forward);
    // NewRow SURVIVES; only the recovered Solo is removed again.
    expect(redone).toEqual([{ id: 1, name: "NewRow" }]);
  });

  it("without a remap, a plain delete round-trips normally", () => {
    const before = buildBeforeImages<Row>([{ id: 5, name: "X" }], [], [{ id: 5, name: "X" }]);
    const after: Row[] = [];
    const { result: restored, remap } = applyUndoRestoreWithRemap(after, before);
    expect(restored).toEqual([{ id: 5, name: "X" }]);
    expect(remap.size).toBe(0);
    expect(applyUndoForward(restored, buildForwardImages(before, after, remap))).toEqual([]);
  });

  it("MULTIPLE simultaneous re-mints (clear-all): redo removes all recovered rows, keeps all live ones", () => {
    const orig: Row[] = [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }];
    const before = buildBeforeImages<Row>(orig, [], orig);
    // all three ids reused by new rows before undo
    const afterArray: Row[] = [{ id: 1, name: "X" }, { id: 2, name: "Y" }, { id: 3, name: "Z" }];
    const { result: restored, remap } = applyUndoRestoreWithRemap(afterArray, before);
    expect([...remap.entries()].sort()).toEqual([[1, 4], [2, 5], [3, 6]]);
    const redone = applyUndoForward(restored, buildForwardImages(before, afterArray, remap));
    expect(redone).toEqual(afterArray); // the 3 live reused-id rows survive; recovered ones removed
  });

  it("edit-image whose id was reused: redo re-applies the LIVE after-value (no redo clobber)", () => {
    // Pre-existing undo-side limitation: reverting an edit by id can overwrite a
    // reused-id row. But REDO builds its forward image from the live pre-undo
    // state, so redo restores the reused row's CURRENT value rather than clobbering.
    const before = buildBeforeImages<Row>([], [{ id: 10, name: "OLD" }], [{ id: 10, name: "OLD" }]);
    const afterArray: Row[] = [{ id: 10, name: "NEW-REUSED" }];
    const { result: restored, remap } = applyUndoRestoreWithRemap(afterArray, before);
    const redone = applyUndoForward(restored, buildForwardImages(before, afterArray, remap));
    expect(redone).toEqual([{ id: 10, name: "NEW-REUSED" }]);
  });
});

describe("remapImageField", () => {
  const refEdit = (index: number, item: Ref) => ({ index, item, op: "edit" as const });
  const refDel = (index: number, item: Ref) => ({ index, item, op: "delete" as const });

  it("empty remap is a no-op copy (different array, equal contents)", () => {
    const before = [refEdit(0, { id: 1, roleId: 7 })];
    const out = remapImageField(before, "roleId", new Map());
    expect(out).toEqual(before);
    expect(out).not.toBe(before);
  });

  it("remaps an edit-image FK through the primary re-mint", () => {
    const before = [refEdit(0, { id: 1, roleId: 7 })];
    const out = remapImageField(before, "roleId", new Map([[7, 8]]));
    expect(out[0].item).toEqual({ id: 1, roleId: 8 });
  });

  it("remaps a delete-image FK the same way (re-inserted row follows)", () => {
    const before = [refDel(2, { id: 30, roleId: 7 })];
    const out = remapImageField(before, "roleId", new Map([[7, 8]]));
    expect(out[0]).toEqual({ index: 2, item: { id: 30, roleId: 8 }, op: "delete" });
  });

  it("leaves rows whose FK is null/unmapped untouched (no new objects)", () => {
    const b1 = refEdit(0, { id: 1, roleId: null }); // not a number → skip
    const b2 = refEdit(1, { id: 2, roleId: 9 });     // number, absent from remap → skip
    const out = remapImageField([b1, b2], "roleId", new Map([[7, 8]]));
    expect(out[0]).toBe(b1);
    expect(out[1]).toBe(b2);
  });
});

describe("buildBeforeImages", () => {
  const from: Row[] = [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }];

  it("tags removed rows as delete and edited rows as edit, resolving indices", () => {
    const images = buildBeforeImages([{ id: 2, name: "b" }], [{ id: 3, name: "c" }], from);
    expect(images).toEqual([
      { index: 1, item: { id: 2, name: "b" }, op: "delete" },
      { index: 3 - 1, item: { id: 3, name: "c" }, op: "edit" },
    ]);
  });

  it("clamps a not-found row's index to 0 and returns [] when nothing changed", () => {
    expect(buildBeforeImages([{ id: 99, name: "x" }], [], from)[0].index).toBe(0);
    expect(buildBeforeImages([], [], from)).toEqual([]);
  });
});
