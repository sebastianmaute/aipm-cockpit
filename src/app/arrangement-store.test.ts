import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_PROJECTS,
  isArrangementLayout,
  loadArrangement,
  readArrangement,
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
  // ★ NaN and ±Infinity ARE `typeof "number"`, so a `typeof` test admits them and
  // `clampSpan` then yields NaN — the exact silent-reset failure above. They cannot
  // arrive through `loadArrangement` (JSON has no literal for either, and both
  // serialise as `null`, which is rejected anyway), so the NaN, +Infinity and
  // -Infinity rows immediately below are the ONLY detector: the through-the-store
  // test passes on them either way. ★★ MEMBERS, NOT A TALLY — this sentence said
  // "these two rows" while annotating three, the -Infinity row having arrived in the
  // same commit as the comment. Read the rows, and if you add another, name it here
  // rather than incrementing anything.
  ["a NaN span", { v: 1, board: [{ id: "x", w: NaN, h: 1 }], hidden: [] }],
  ["an infinite span", { v: 1, board: [{ id: "x", w: 1, h: Infinity }], hidden: [] }],
  ["a negatively infinite span", { v: 1, board: [{ id: "x", w: -Infinity, h: 1 }], hidden: [] }],
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

/**
 * ★★★ THE REASON A READ FAILED, WHICH `loadArrangement` DELIBERATELY DISCARDS.
 * Both a missing key and a rejected blob are `null` there, and callers that only
 * want a layout are right not to care. `useArrangement` is not one of them: it
 * offers a legacy-preference SEED when the read yields nothing, and offering it
 * on a REJECTED blob silently reverts a user who downgraded from a future build
 * (open-followups §427). This is the boundary that knows the difference, so this
 * is where it is reported.
 *
 * ★★ `loadArrangement` is now a THIN WRAPPER over this, deliberately: the
 * predicate exists once, so the two entry points cannot drift into disagreeing
 * about what "usable" means. The tests above still exercise the wrapper, which
 * is what keeps that equivalence honest.
 */
describe("readArrangement — missing vs rejected", () => {
  beforeEach(() => localStorage.clear());

  it("reports a stored layout as ok, with the layout attached", () => {
    saveArrangement(KEY_A, "p1", L);
    expect(readArrangement(KEY_A, "p1")).toEqual({ status: "ok", layout: L });
  });

  it("reports an absent project as missing", () => {
    saveArrangement(KEY_A, "p1", L);
    expect(readArrangement(KEY_A, "p2")).toEqual({ status: "missing" });
  });

  it("reports an absent KEY as missing, not rejected", () => {
    expect(readArrangement(KEY_B, "p1")).toEqual({ status: "missing" });
  });

  // ★ A corrupt map is not a corrupt ENTRY: nothing is stored for this project,
  // so a seed is the right thing to offer and this must read MISSING.
  it("reports an unparseable map as missing", () => {
    localStorage.setItem(KEY_A, "{not json");
    expect(readArrangement(KEY_A, "p1")).toEqual({ status: "missing" });
  });

  // ★★ THE ROW THAT CARRIES §427: every one of these is PRESENT and unusable,
  // which is exactly the case that must NOT reach a legacy seed. The
  // `v: 9` row is the realistic one — a downgrade from a future build.
  it("reports every hostile stored entry as rejected, never missing", () => {
    for (const [label, blob] of HOSTILE) {
      localStorage.setItem(KEY_A, JSON.stringify({ p1: blob }));
      expect(readArrangement(KEY_A, "p1"), label).toEqual({ status: "rejected" });
    }
  });

  // ★ A JSON null is a present entry too, and it is what a NaN span serialises
  // to — so it must be rejected rather than read as nothing stored.
  it("reports a null entry as rejected", () => {
    localStorage.setItem(KEY_A, JSON.stringify({ p1: null }));
    expect(readArrangement(KEY_A, "p1")).toEqual({ status: "rejected" });
  });
});
