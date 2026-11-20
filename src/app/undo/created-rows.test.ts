import { describe, expect, it } from "vitest";
import { redoCreatedRows, rowChangedSince, undoCreatedRows } from "./created-rows";

interface Row {
  id: number;
  title: string;
  deps?: number[];
  localModifiedAt?: string;
  noteLog?: { text: string }[];
}

const row = (id: number, extra: Partial<Row> = {}): Row => ({ id, title: `t${id}`, ...extra });
const dropRefs = (r: Row, removed: ReadonlySet<number>): Row =>
  r.deps && r.deps.some((d) => removed.has(d)) ? { ...r, deps: r.deps.filter((d) => !removed.has(d)) } : r;
const remapRefs = (r: Row, remap: ReadonlyMap<number, number>): Row =>
  r.deps && r.deps.some((d) => remap.has(d)) ? { ...r, deps: r.deps.map((d) => remap.get(d) ?? d) } : r;
const never = () => false;

describe("rowChangedSince", () => {
  it("ignores only localModifiedAt", () => {
    expect(rowChangedSince(row(1, { localModifiedAt: "b" }), row(1, { localModifiedAt: "a" }))).toBe(false);
    expect(rowChangedSince(row(1, { title: "x" }), row(1))).toBe(true);
  });
});

describe("undoCreatedRows", () => {
  const base = [row(1), row(11), row(12)];

  it("removes created rows that are unchanged and unreferenced", () => {
    const r = undoCreatedRows(base, [row(11), row(12)], never, dropRefs);
    expect(r.removed.map((x) => x.id)).toEqual([11, 12]);
    expect(r.keptIds).toEqual([]);
    expect(r.result.map((x) => x.id)).toEqual([1]);
  });

  it("with an allow-set, removes only allowed rows and reports the rest as kept", () => {
    const r = undoCreatedRows(base, [row(11), row(12)], never, dropRefs, new Set([12]));
    expect(r.removed.map((x) => x.id)).toEqual([12]);
    expect(r.keptIds).toEqual([11]);
    expect(r.result.map((x) => x.id)).toEqual([1, 11]);
  });

  it("keeps a created row whose title changed", () => {
    const live = [row(1), row(11), row(12, { title: "edited" })];
    const r = undoCreatedRows(live, [row(11), row(12)], never, dropRefs);
    expect(r.keptIds).toEqual([12]);
    expect(r.removed.map((x) => x.id)).toEqual([11]);
  });

  it("keeps a created row whose only change is a note (write-through keys count)", () => {
    const live = [row(1), row(11, { noteLog: [{ text: "n" }] })];
    const r = undoCreatedRows(live, [row(11)], never, dropRefs);
    expect(r.keptIds).toEqual([11]);
    expect(r.removed).toEqual([]);
  });

  it("ignores a localModifiedAt-only change", () => {
    const live = [row(1), row(11, { localModifiedAt: "later" })];
    const r = undoCreatedRows(live, [row(11, { localModifiedAt: "earlier" })], never, dropRefs);
    expect(r.removed.map((x) => x.id)).toEqual([11]);
  });

  it("keeps a referenced row", () => {
    const r = undoCreatedRows(base, [row(11), row(12)], (_p, id) => id === 11, dropRefs);
    expect(r.keptIds).toEqual([11]);
    expect(r.removed.map((x) => x.id)).toEqual([12]);
  });

  it("drops a kept row's link to a removed row, and reports its before", () => {
    const live = [row(1), row(11), row(12, { deps: [11], title: "edited" })];
    const r = undoCreatedRows(live, [row(11), row(12, { deps: [11] })], never, dropRefs);
    expect(r.keptIds).toEqual([12]);
    expect(r.result.find((x) => x.id === 12)?.deps).toEqual([]);
    expect(r.keptBefore).toEqual([row(12, { deps: [11], title: "edited" })]);
    // The kept rows as the undo left them, in keptBefore's order, and the very rows in the result.
    expect(r.keptAfter).toEqual([row(12, { deps: [], title: "edited" })]);
    expect(r.keptAfter[0]).toBe(r.result.find((x) => x.id === 12));
  });

  it("skips a created row already deleted", () => {
    const r = undoCreatedRows([row(1), row(12)], [row(11), row(12)], never, dropRefs);
    expect(r.removed.map((x) => x.id)).toEqual([12]);
    expect(r.keptIds).toEqual([]);
  });
});

describe("redoCreatedRows", () => {
  it("re-inserts under the same id when free", () => {
    const r = redoCreatedRows([row(1)], [row(11), row(12)], [], [], remapRefs);
    expect(r.result.map((x) => x.id)).toEqual([1, 11, 12]);
    expect(r.remap.size).toBe(0);
    expect(r.reinserted).toBe(2);
  });

  it("re-mints a taken id and follows it", () => {
    const prev = [row(1), row(11, { title: "other" })];
    const r = redoCreatedRows(prev, [row(11), row(12, { deps: [11] })], [], [], remapRefs);
    expect(r.remap).toEqual(new Map([[11, 13]]));
    expect(r.result.map((x) => x.id)).toEqual([1, 11, 13, 12]);
    expect(r.result.find((x) => x.id === 12)?.deps).toEqual([13]);
    expect(r.result.find((x) => x.id === 11)?.title).toBe("other");
  });

  it("restores a kept row's dropped link only if unchanged since undo", () => {
    const before = row(12, { deps: [11] });
    const after = row(12, { deps: [] });
    const restored = redoCreatedRows([row(12, { deps: [] })], [row(11)], [before], [after], remapRefs);
    expect(restored.result.find((x) => x.id === 12)?.deps).toEqual([11]);
    const edited = [row(12, { deps: [], title: "changed" })];
    const left = redoCreatedRows(edited, [row(11)], [before], [after], remapRefs);
    expect(left.result.find((x) => x.id === 12)?.deps).toEqual([]);
  });

  it("follows a re-minted id when restoring a kept row", () => {
    const r = redoCreatedRows(
      [row(11, { title: "other" }), row(12, { deps: [] })],
      [row(11)],
      [row(12, { deps: [11] })],
      [row(12, { deps: [] })],
      remapRefs,
    );
    expect(r.result.find((x) => x.id === 12)?.deps).toEqual([13]);
  });
});

describe("undo then redo", () => {
  it("round-trips to the original rows", () => {
    const live = [row(1), row(11), row(12, { deps: [11], title: "edited" }), row(13)];
    const created = [row(11), row(12, { deps: [11] }), row(13)];
    const u = undoCreatedRows(live, created, never, dropRefs);
    const kept = u.result.filter((x) => u.keptIds.includes(x.id));
    const r = redoCreatedRows(u.result, u.removed, u.keptBefore, kept, remapRefs);
    expect([...r.result].sort((a, b) => a.id - b.id)).toEqual(live);
  });
});
