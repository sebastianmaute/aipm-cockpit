import { describe, expect, it } from "vitest";
import { appendPatch } from "./append-patch";
import { mergeFieldValue } from "./merge-field-value";

// Undo is merge(before, after, live); redo is merge(after, before, live).
const undo = <T>(p: { before: T[]; after: T[] }, live: T[]) => mergeFieldValue(p.before, p.after, live);
const redo = <T>(p: { before: T[]; after: T[] }, live: T[]) => mergeFieldValue(p.after, p.before, live);

const a = { id: 1, text: "a" };
const b = { id: 2, text: "b" };
const x = { id: 3, text: "appended" };
const h = { id: 4, text: "human" };

describe("appendPatch", () => {
  it("is [] → [appended] for an empty prior", () => {
    expect(appendPatch([], x)).toEqual({ before: [], after: [x] });
  });

  it("windows to the last prior member plus the appended one", () => {
    expect(appendPatch([a, b], x)).toEqual({ before: [b], after: [b, x] });
  });

  it("drops the anchor when the appended member equals it, so no end holds a duplicate", () => {
    expect(appendPatch([a, x], { ...x })).toEqual({ before: [], after: [x] });
  });

  it("round-trips exactly with no concurrent write", () => {
    const p = appendPatch([a, b], x);
    expect(undo(p, [a, b, x])).toEqual([a, b]);
    expect(redo(p, [a, b])).toEqual([a, b, x]);
  });

  it("keeps a concurrent append on undo, and redo puts the member back after its anchor", () => {
    const p = appendPatch([a, b], x);
    expect(undo(p, [a, b, x, h])).toEqual([a, b, h]);
    expect(redo(p, [a, b, h])).toEqual([a, b, x, h]);
  });

  it("keeps duplicate prior members and a concurrent append — the whole-log ends did not", () => {
    const p = appendPatch([a, a], x);
    expect(undo(p, [a, a, x, h])).toEqual([a, a, h]);
    // Control: ends holding the full log revert wholesale and lose `h`.
    expect(mergeFieldValue([a, a], [a, a, x], [a, a, x, h])).toEqual([a, a]);
  });
});
