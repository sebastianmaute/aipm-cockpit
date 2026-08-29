import { describe, it, expect } from "vitest";
import {
  applyUndoRestore,
  applyUndoRestoreWithRemap,
  applyUndoForward,
  applyPreserved,
  buildBeforeImages,
  buildForwardImages,
  remapImageField,
  pushUndo,
  popUndo,
  dropEntry,
  takeThrough,
  pushUndoMany,
  type BeforeImage,
  type UndoEntry,
} from "./undo-stack";

type Row = { id: number; name: string };
type Ref = { id: number; roleId: number | null };

const del = (index: number, item: Row) => ({ index, item, op: "delete" as const });
const edit = (index: number, item: Row) => ({ index, item, op: "edit" as const });

describe("applyUndoRestore", () => {
  it("re-inserts deleted rows at their original index", () => {
    const current: Row[] = [{ id: 1, name: "a" }, { id: 3, name: "c" }];
    expect(applyUndoRestore(current, [del(1, { id: 2, name: "b" })], [])).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" },
    ]);
  });

  it("reverts an edited row to its before-image (present → replace)", () => {
    const current: Row[] = [{ id: 1, name: "EDITED" }, { id: 2, name: "b" }];
    expect(applyUndoRestore(current, [edit(0, { id: 1, name: "a" })], [])).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" },
    ]);
  });

  it("restores a fully-cleared array (clear-all)", () => {
    const before = [del(0, { id: 1, name: "a" }), del(1, { id: 2, name: "b" })];
    expect(applyUndoRestore<Row>([], before, [])).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" },
    ]);
  });

  it("leaves rows the op never touched intact (interleaving)", () => {
    const current: Row[] = [{ id: 1, name: "EDITED-LATER" }, { id: 3, name: "c" }];
    expect(applyUndoRestore(current, [del(1, { id: 2, name: "b" })], [])).toEqual([
      { id: 1, name: "EDITED-LATER" }, { id: 2, name: "b" }, { id: 3, name: "c" },
    ]);
  });

  it("clamps a stale index to the array end", () => {
    const current: Row[] = [{ id: 1, name: "a" }];
    expect(applyUndoRestore(current, [del(99, { id: 2, name: "b" })], [])).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" },
    ]);
  });

  it("re-mints a delete-image whose id was reused by a live row (NO clobber)", () => {
    // Deleted id 3, then a DIFFERENT row was created reusing id 3. Undo must
    // recover the deleted row WITHOUT overwriting the live id-3 row.
    const current: Row[] = [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "NEW-REUSED" }];
    const out = applyUndoRestore(current, [del(2, { id: 3, name: "OLD-DELETED" })], []);
    // live row survives unchanged
    expect(out.find((r) => r.name === "NEW-REUSED")).toEqual({ id: 3, name: "NEW-REUSED" });
    // deleted row recovered under a fresh id (max+1 = 4)
    expect(out.find((r) => r.name === "OLD-DELETED")).toEqual({ id: 4, name: "OLD-DELETED" });
    expect(out).toHaveLength(4);
  });

  it("skips an edit-image whose row was deleted since (does not resurrect it)", () => {
    const current: Row[] = [{ id: 1, name: "a" }];
    // edit-image for id 2, but id 2 is gone (deleted after the edit) → skip
    expect(applyUndoRestore(current, [edit(1, { id: 2, name: "stale" })], [])).toEqual([
      { id: 1, name: "a" },
    ]);
  });

  it("delete-image owns an id present in BOTH lists — the edit-image never clobbers", () => {
    // id 3 is a live reused row; captured (defensively) as both delete and edit.
    const current: Row[] = [{ id: 1, name: "a" }, { id: 3, name: "NEW-REUSED" }];
    const out = applyUndoRestore(current, [
      del(1, { id: 3, name: "OLD-DELETED" }),
      edit(1, { id: 3, name: "OLD-DELETED" }),
    ], []);
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
    ], []);
    expect(out).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "3-with-dep" },
    ]);
  });
});

describe("stack ops", () => {
  const mk = (id: number): UndoEntry => ({
    meta: { id, kind: "task.deleted", count: 1, timestamp: "t", label: "l" },
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
    expect(applyUndoForward(current, [edit(0, { id: 1, name: "AFTER" })], [])).toEqual([
      { id: 1, name: "AFTER" }, { id: 2, name: "b" },
    ]);
  });

  it("re-applies a delete (removes the row with that id)", () => {
    const current: Row[] = [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }];
    expect(applyUndoForward(current, [del(1, { id: 2, name: "b" })], [])).toEqual([
      { id: 1, name: "a" }, { id: 3, name: "c" },
    ]);
  });

  it("re-applies a clear-all (removes every captured row)", () => {
    const current: Row[] = [{ id: 1, name: "a" }, { id: 2, name: "b" }];
    expect(applyUndoForward(current, [del(0, { id: 1, name: "a" }), del(1, { id: 2, name: "b" })], [])).toEqual([]);
  });

  it("skips an absent edit/delete row (no crash, no change)", () => {
    const current: Row[] = [{ id: 1, name: "a" }];
    expect(applyUndoForward(current, [edit(9, { id: 9, name: "gone" }), del(9, { id: 8, name: "gone" })], [])).toEqual([
      { id: 1, name: "a" },
    ]);
  });

  it("applies edits before removals (edit + delete in one forward set)", () => {
    // id 2 deleted; id 3 had a dependency stripped (edited to the after-value).
    const current: Row[] = [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "3-with-dep" }];
    const out = applyUndoForward(current, [
      del(1, { id: 2, name: "b" }),
      edit(2, { id: 3, name: "3-stripped" }),
    ], []);
    expect(out).toEqual([{ id: 1, name: "a" }, { id: 3, name: "3-stripped" }]);
  });

  it("removes the recovered row on redo when it still MATCHES", () => {
    // delete → undo → redo: the recovered row is unchanged, so redo removes it.
    expect(applyUndoForward([{ id: 1, name: "Alice" }], [del(0, { id: 1, name: "Alice" })], [])).toEqual([]);
  });

  it("does NOT remove a reused-id row that no longer matches the recovered row (capture-bypass guard)", () => {
    // The recovered Alice(id 1) was deleted outside the undo system and id 1 reused
    // by Bob (a capture-bypassing path that didn't clear the redo stack). Redo's
    // forward delete-image is Alice's — it must NOT destroy the live Bob.
    expect(applyUndoForward([{ id: 1, name: "Bob" }], [del(0, { id: 1, name: "Alice" })], [])).toEqual([
      { id: 1, name: "Bob" },
    ]);
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
    const postOp = applyUndoForward(preOp, buildForwardImages(before, preOp), []);
    expect(postOp).toEqual([{ id: 1, name: "a" }]); // delete applied
    const restored = applyUndoRestore(postOp, before, []);
    expect(restored).toEqual(preOp); // undo restored
    const forward = buildForwardImages(before, restored);
    expect(applyUndoForward(restored, forward, [])).toEqual([{ id: 1, name: "a" }]); // redo re-deletes
  });
});

describe("redo after id re-mint (data-loss regression)", () => {
  // delete id1 → create a new row that reuses id1 → undo re-mints the recovered
  // row to id2 → redo must remove id2 (the recovered row), NEVER id1 (the live
  // new row). Guards the CRITICAL bug where redo destroyed the unrelated row.
  it("removes the re-minted recovered row on redo, not the live reused-id row", () => {
    const before = buildBeforeImages<Row>([{ id: 1, name: "Solo" }], [], [{ id: 1, name: "Solo" }]);
    const afterArray: Row[] = [{ id: 1, name: "NewRow" }]; // id1 reused by a new row

    const { result: restored, remap } = applyUndoRestoreWithRemap(afterArray, before, []);
    // Solo recovered under a fresh id (2); NewRow (id1) untouched.
    expect(restored).toEqual([{ id: 2, name: "Solo" }, { id: 1, name: "NewRow" }]);
    expect(remap.get(1)).toBe(2);

    const forward = buildForwardImages(before, afterArray, remap);
    const redone = applyUndoForward(restored, forward, []);
    // NewRow SURVIVES; only the recovered Solo is removed again.
    expect(redone).toEqual([{ id: 1, name: "NewRow" }]);
  });

  it("without a remap, a plain delete round-trips normally", () => {
    const before = buildBeforeImages<Row>([{ id: 5, name: "X" }], [], [{ id: 5, name: "X" }]);
    const after: Row[] = [];
    const { result: restored, remap } = applyUndoRestoreWithRemap(after, before, []);
    expect(restored).toEqual([{ id: 5, name: "X" }]);
    expect(remap.size).toBe(0);
    expect(applyUndoForward(restored, buildForwardImages(before, after, remap), [])).toEqual([]);
  });

  it("MULTIPLE simultaneous re-mints (clear-all): redo removes all recovered rows, keeps all live ones", () => {
    const orig: Row[] = [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }];
    const before = buildBeforeImages<Row>(orig, [], orig);
    // all three ids reused by new rows before undo
    const afterArray: Row[] = [{ id: 1, name: "X" }, { id: 2, name: "Y" }, { id: 3, name: "Z" }];
    const { result: restored, remap } = applyUndoRestoreWithRemap(afterArray, before, []);
    expect([...remap.entries()].sort()).toEqual([[1, 4], [2, 5], [3, 6]]);
    const redone = applyUndoForward(restored, buildForwardImages(before, afterArray, remap), []);
    expect(redone).toEqual(afterArray); // the 3 live reused-id rows survive; recovered ones removed
  });

  it("edit-image whose id was reused: redo re-applies the LIVE after-value (no redo clobber)", () => {
    // Pre-existing undo-side limitation: reverting an edit by id can overwrite a
    // reused-id row. But REDO builds its forward image from the live pre-undo
    // state, so redo restores the reused row's CURRENT value rather than clobbering.
    const before = buildBeforeImages<Row>([], [{ id: 10, name: "OLD" }], [{ id: 10, name: "OLD" }]);
    const afterArray: Row[] = [{ id: 10, name: "NEW-REUSED" }];
    const { result: restored, remap } = applyUndoRestoreWithRemap(afterArray, before, []);
    const redone = applyUndoForward(restored, buildForwardImages(before, afterArray, remap), []);
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

describe("takeThrough", () => {
  const e = (id: number) => ({ meta: { id, kind: "task.updated" as const, count: 1, timestamp: "", label: `e${id}` } });

  it("returns the taken entries NEWEST-FIRST and the untouched remainder", () => {
    const stack = [e(1), e(2), e(3), e(4)];        // 4 is newest
    const got = takeThrough(stack, 2);
    expect(got?.entries.map((x) => x.meta.id)).toEqual([4, 3, 2]);
    expect(got?.rest.map((x) => x.meta.id)).toEqual([1]);
  });

  it("takes the whole stack when the id is the oldest entry", () => {
    const stack = [e(1), e(2), e(3)];
    const got = takeThrough(stack, 1);
    expect(got?.entries.map((x) => x.meta.id)).toEqual([3, 2, 1]);
    expect(got?.rest).toEqual([]);
  });

  it("takes exactly one when the id is the newest entry", () => {
    const got = takeThrough([e(1), e(2)], 2);
    expect(got?.entries.map((x) => x.meta.id)).toEqual([2]);
    expect(got?.rest.map((x) => x.meta.id)).toEqual([1]);
  });

  it("returns null for an absent id and for an empty stack", () => {
    expect(takeThrough([e(1)], 99)).toBeNull();
    expect(takeThrough([], 1)).toBeNull();
  });

  it("does not mutate the input stack", () => {
    const stack = [e(1), e(2), e(3)];
    takeThrough(stack, 1);
    expect(stack.map((x) => x.meta.id)).toEqual([1, 2, 3]);
  });
});

describe("pushUndoMany", () => {
  const e = (id: number) => ({ meta: { id, kind: "task.updated" as const, count: 1, timestamp: "", label: `e${id}` } });

  it("appends in array order so the LAST element ends on top", () => {
    // takeThrough hands entries newest-first; redo must replay oldest-undone
    // FIRST, and redo pops from the END — so the oldest-undone must land last.
    const got = pushUndoMany([], [e(4), e(3), e(2)], 25);
    expect(got.map((x) => x.meta.id)).toEqual([4, 3, 2]);
  });

  it("evicts from the front when the combined length exceeds the cap", () => {
    const got = pushUndoMany([e(1), e(2)], [e(3), e(4)], 3);
    expect(got.map((x) => x.meta.id)).toEqual([2, 3, 4]);
  });

  it("is a no-op copy for an empty entry list", () => {
    const got = pushUndoMany([e(1)], [], 25);
    expect(got.map((x) => x.meta.id)).toEqual([1]);
  });
});

describe("applyPreserved", () => {
  type Row = { id: number; name: string; noteLog?: string[]; outlookEventId?: string };

  it("returns the image unchanged when there is nothing to preserve", () => {
    const image: Row = { id: 1, name: "before" };
    const live: Row = { id: 1, name: "after" };
    expect(applyPreserved(image, live, [])).toBe(image); // same reference
  });

  it("takes the LIVE value when the live row has the key", () => {
    const image: Row = { id: 1, name: "before", noteLog: ["old"] };
    const live: Row = { id: 1, name: "after", noteLog: ["old", "added since"] };
    expect(applyPreserved(image, live, ["noteLog"])).toEqual({
      id: 1, name: "before", noteLog: ["old", "added since"],
    });
  });

  it("lets an EMPTIER live value win — a cleared field stays cleared", () => {
    const image: Row = { id: 1, name: "before", outlookEventId: "evt-1" };
    const live: Row = { id: 1, name: "after", outlookEventId: undefined };
    const out = applyPreserved(image, live, ["outlookEventId"]);
    expect(out.outlookEventId).toBeUndefined();
    expect(out.name).toBe("before"); // the non-preserved field still reverts
  });

  it("DELETES the key when only the image has it, rather than leaving the stale value", () => {
    const image: Row = { id: 1, name: "before", noteLog: ["stale"] };
    const live: Row = { id: 1, name: "after" };
    const out = applyPreserved(image, live, ["noteLog"]);
    expect("noteLog" in out).toBe(false); // NOT toBeUndefined — that passes against a spread
  });

  it("never INVENTS a key that neither row carries", () => {
    const image: Row = { id: 1, name: "before" };
    const live: Row = { id: 1, name: "after" };
    const out = applyPreserved(image, live, ["noteLog", "outlookEventId"]);
    expect(Object.keys(out).sort()).toEqual(["id", "name"]);
  });

  it("preserves several keys independently in one pass", () => {
    const image: Row = { id: 1, name: "before", noteLog: ["a"], outlookEventId: "evt-1" };
    const live: Row = { id: 1, name: "after", noteLog: ["a", "b"] };
    const out = applyPreserved(image, live, ["noteLog", "outlookEventId"]);
    expect(out.noteLog).toEqual(["a", "b"]);
    expect("outlookEventId" in out).toBe(false);
  });

  it("does not mutate either input", () => {
    const image: Row = { id: 1, name: "before", noteLog: ["a"] };
    const live: Row = { id: 1, name: "after", noteLog: ["a", "b"] };
    applyPreserved(image, live, ["noteLog"]);
    expect(image.noteLog).toEqual(["a"]);
    expect(live.noteLog).toEqual(["a", "b"]);
  });
});

describe("preserve on restore and redo", () => {
  type Row = { id: number; sev: string; noteLog?: string[] };
  const PRESERVE = ["noteLog"];

  it("undo reverts the edited field but keeps a note added since the capture", () => {
    const before: BeforeImage<Row>[] = [
      { index: 0, item: { id: 1, sev: "Low" }, op: "edit" },
    ];
    const live: Row[] = [{ id: 1, sev: "High", noteLog: ["added after the bulk edit"] }];
    const out = applyUndoRestore(live, before, PRESERVE);
    expect(out[0].sev).toBe("Low");
    expect(out[0].noteLog).toEqual(["added after the bulk edit"]);
  });

  it("redo re-applies the edit but keeps a note added since the UNDO", () => {
    const forward: BeforeImage<Row>[] = [
      { index: 0, item: { id: 1, sev: "High", noteLog: ["note A"] }, op: "edit" },
    ];
    const live: Row[] = [{ id: 1, sev: "Low", noteLog: ["note A", "note B"] }];
    const out = applyUndoForward(live, forward, PRESERVE);
    expect(out[0].sev).toBe("High");
    expect(out[0].noteLog).toEqual(["note A", "note B"]);
  });

  it("an empty preserve list is byte-identical to the old whole-row replace", () => {
    const before: BeforeImage<Row>[] = [
      { index: 0, item: { id: 1, sev: "Low" }, op: "edit" },
    ];
    const live: Row[] = [{ id: 1, sev: "High", noteLog: ["lost"] }];
    expect(applyUndoRestore(live, before, [])).toEqual([{ id: 1, sev: "Low" }]);
  });

  it("still skips an edit-image whose id a delete-image owns", () => {
    const before: BeforeImage<Row>[] = [
      { index: 0, item: { id: 1, sev: "Low" }, op: "edit" },
      { index: 0, item: { id: 1, sev: "Gone" }, op: "delete" },
    ];
    const live: Row[] = [{ id: 1, sev: "Live", noteLog: ["n"] }];
    const out = applyUndoRestore(live, before, PRESERVE);
    // The delete branch owns id 1: it re-mints rather than letting the edit revert.
    expect(out.find((r) => r.sev === "Live")).toBeDefined();
  });

  it("redo's rowsEqual identity guard still fires with preserve on (non-regression)", () => {
    // A recovered delete-image whose id a NEW unrelated row now holds must not be
    // removed by redo. Preservation touches only edit-images, so this must not change.
    const forward: BeforeImage<Row>[] = [
      { index: 0, item: { id: 7, sev: "recovered" }, op: "delete" },
    ];
    const live: Row[] = [{ id: 7, sev: "an unrelated new row", noteLog: ["keep me"] }];
    const out = applyUndoForward(live, forward, PRESERVE);
    expect(out).toHaveLength(1);
    expect(out[0].sev).toBe("an unrelated new row");
  });
});

describe("delete-branch identity under a write-through write (open-followups §179)", () => {
  type Row = { id: number; title: string; noteLog?: { id: string; text: string }[] };
  const PRESERVE = ["noteLog", "outlookEventId"];

  it("removes the row on redo even though a note was added after the restore", () => {
    // The sequence from the register: delete a row, undo it, add a note through
    // the notes window (write-through — no undo entry, so the redo stack
    // survives), then redo. The redo must still remove the row it restored.
    const recovered: Row = { id: 7, title: "Risk A" };
    const live: Row[] = [{ id: 7, title: "Risk A", noteLog: [{ id: "n1", text: "added later" }] }];
    const out = applyUndoForward(live, [{ index: 0, item: recovered, op: "delete" }], PRESERVE);
    expect(out).toEqual([]);
  });

  it("still refuses to remove an unrelated row that merely reused the freed id", () => {
    // This is the guard the relaxation must not break. A capture-bypassing delete
    // freed id 7 and a new row took it; redo must leave that row alone. Note this
    // row carries NO write-through field, so it is a STRICTER guard than the
    // neighbouring "rowsEqual identity guard" test above, whose live row differs
    // on `noteLog` as well as on content.
    const recovered: Row = { id: 7, title: "Risk A" };
    const live: Row[] = [{ id: 7, title: "Something else entirely" }];
    const out = applyUndoForward(live, [{ index: 0, item: recovered, op: "delete" }], PRESERVE);
    expect(out).toEqual(live);
  });
});
