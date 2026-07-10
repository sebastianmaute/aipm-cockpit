import { describe, it, expect } from "vitest";
import { applyUndoRestore, pushUndo, popUndo, dropEntry, type UndoEntry } from "./undo-stack";

type Row = { id: number; name: string };

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
