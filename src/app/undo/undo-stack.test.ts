import { describe, it, expect } from "vitest";
import { applyUndoRestore, pushUndo, popUndo, dropEntry, type UndoEntry } from "./undo-stack";

type Row = { id: number; name: string };

describe("applyUndoRestore", () => {
  it("re-inserts deleted rows at their original index", () => {
    const current: Row[] = [{ id: 1, name: "a" }, { id: 3, name: "c" }];
    const before = [{ index: 1, item: { id: 2, name: "b" } }];
    expect(applyUndoRestore(current, before)).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" },
    ]);
  });

  it("reverts an edited row to its before-image (present → replace)", () => {
    const current: Row[] = [{ id: 1, name: "EDITED" }, { id: 2, name: "b" }];
    const before = [{ index: 0, item: { id: 1, name: "a" } }];
    expect(applyUndoRestore(current, before)).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" },
    ]);
  });

  it("restores a fully-cleared array (clear-all)", () => {
    const before = [
      { index: 0, item: { id: 1, name: "a" } },
      { index: 1, item: { id: 2, name: "b" } },
    ];
    expect(applyUndoRestore<Row>([], before)).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" },
    ]);
  });

  it("leaves rows the op never touched intact (interleaving)", () => {
    const current: Row[] = [{ id: 1, name: "EDITED-LATER" }, { id: 3, name: "c" }];
    const before = [{ index: 1, item: { id: 2, name: "b" } }];
    expect(applyUndoRestore(current, before)).toEqual([
      { id: 1, name: "EDITED-LATER" }, { id: 2, name: "b" }, { id: 3, name: "c" },
    ]);
  });

  it("clamps a stale index to the array end", () => {
    const current: Row[] = [{ id: 1, name: "a" }];
    const before = [{ index: 99, item: { id: 2, name: "b" } }];
    expect(applyUndoRestore(current, before)).toEqual([
      { id: 1, name: "a" }, { id: 2, name: "b" },
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
