import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_PROJECTS,
  isArrangementLayout,
  loadArrangement,
  saveArrangement,
} from "./arrangement-store";
import type { ArrangementLayout } from "./arrangement-layout";

const KEY_A = "aipm-cockpit:test-layout-a";
const KEY_B = "aipm-cockpit:test-layout-b";
const L: ArrangementLayout<string> = { v: 1, board: [{ id: "x", w: 1, h: 1 }], hidden: [] };

/** Blobs that must never reach `reconcile`. Each is a MEASURED failure of that
 *  function, recorded in its own ★★★ precondition block: the first four THROW
 *  out of it, and a non-numeric `w` clamps to NaN, serialises as `null` and is
 *  rejected on the NEXT load — silently resetting the user's arrangement.
 *  `v: 9` is not a throw but a future-version blob, which must read as absent
 *  rather than be rewritten to `v: 1` in place. */
const HOSTILE: Array<[string, unknown]> = [
  ["an empty object", {}],
  ["a null board", { v: 1, board: null, hidden: [] }],
  ["a null hidden list", { v: 1, board: [], hidden: null }],
  ["a null placement", { v: 1, board: [null], hidden: [] }],
  ["a missing span", { v: 1, board: [{ id: "x", h: 1 }], hidden: [] }],
  ["an undefined span", { v: 1, board: [{ id: "x", w: undefined, h: 1 }], hidden: [] }],
  ["a non-numeric span", { v: 1, board: [{ id: "x", w: "x", h: 1 }], hidden: [] }],
  ["a future version", { v: 9, board: [{ id: "x", w: 1, h: 1 }], hidden: [] }],
  ["a non-string hidden entry", { v: 1, board: [], hidden: [1] }],
  ["a bare array", []],
  ["a string", "nope"],
  ["null", null],
];

describe("isArrangementLayout", () => {
  it("rejects every blob that would break reconcile", () => {
    for (const [label, blob] of HOSTILE) {
      expect(isArrangementLayout(blob), label).toBe(false);
    }
  });

  it("accepts a well-formed layout, empty board included", () => {
    expect(isArrangementLayout(L)).toBe(true);
    expect(isArrangementLayout({ v: 1, board: [], hidden: ["x"] })).toBe(true);
  });
});

describe("arrangement-store", () => {
  beforeEach(() => { localStorage.clear(); });

  it("keeps two surfaces' layouts in separate keys", () => {
    saveArrangement(KEY_A, "p1", L);
    expect(loadArrangement(KEY_B, "p1")).toBeNull();
    expect(loadArrangement(KEY_A, "p1")).toEqual(L);
  });

  it("evicts the least recently saved project past the cap", () => {
    for (let i = 0; i <= MAX_PROJECTS; i += 1) saveArrangement(KEY_A, `p${i}`, L);
    expect(loadArrangement(KEY_A, "p0")).toBeNull();
    expect(loadArrangement(KEY_A, `p${MAX_PROJECTS}`)).toEqual(L);
  });

  it("re-saving an existing project moves it to newest", () => {
    saveArrangement(KEY_A, "keep", L);
    for (let i = 0; i < MAX_PROJECTS - 1; i += 1) saveArrangement(KEY_A, `p${i}`, L);
    saveArrangement(KEY_A, "keep", L);
    saveArrangement(KEY_A, "overflow", L);
    expect(loadArrangement(KEY_A, "keep")).toEqual(L);
  });

  it("gives each key its own cap rather than one shared budget", () => {
    for (let i = 0; i <= MAX_PROJECTS; i += 1) saveArrangement(KEY_A, `p${i}`, L);
    saveArrangement(KEY_B, "p0", L);
    // KEY_A evicted its own oldest; KEY_B is nowhere near the cap.
    expect(loadArrangement(KEY_A, "p0")).toBeNull();
    expect(loadArrangement(KEY_B, "p0")).toEqual(L);
    expect(Object.keys(JSON.parse(localStorage.getItem(KEY_A)!)).length).toBe(MAX_PROJECTS);
    expect(Object.keys(JSON.parse(localStorage.getItem(KEY_B)!)).length).toBe(1);
  });

  it("reads a corrupt blob as absent rather than throwing", () => {
    localStorage.setItem(KEY_A, "{not json");
    expect(loadArrangement(KEY_A, "p1")).toBeNull();
  });

  it("reads a hostile stored entry as absent rather than handing it on", () => {
    for (const [label, blob] of HOSTILE) {
      localStorage.setItem(KEY_A, JSON.stringify({ p1: blob }));
      expect(loadArrangement(KEY_A, "p1"), label).toBeNull();
    }
  });
});
