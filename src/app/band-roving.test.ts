import { describe, expect, it } from "vitest";
import { type BandChipRef, moveBandFocus } from "./band-roving";

/** Two lanes, deliberately sparse and NOT aligned on the same dates — a lane
 *  is a packing artefact, not a calendar row, so vertical movement can never
 *  assume a chip exists directly above or below. */
const chips: readonly BandChipRef[] = [
  { lane: 0, iso: "2026-08-03" },
  { lane: 0, iso: "2026-08-05" },
  { lane: 0, iso: "2026-08-11" },
  { lane: 1, iso: "2026-08-05" },
  { lane: 1, iso: "2026-08-12" },
];

describe("moveBandFocus", () => {
  it("walks chips in reading order with Left/Right", () => {
    expect(moveBandFocus(chips, 0, "ArrowRight")).toBe(1);
    expect(moveBandFocus(chips, 1, "ArrowLeft")).toBe(0);
  });

  it("crosses the lane boundary rather than stopping at the end of a lane", () => {
    // Reading order is lane-major, so Right from the last chip of lane 0
    // continues into lane 1 — the band is one sequence, not two.
    expect(moveBandFocus(chips, 2, "ArrowRight")).toBe(3);
    expect(moveBandFocus(chips, 3, "ArrowLeft")).toBe(2);
  });

  it("clamps at both ends instead of wrapping", () => {
    // Handled (so the caller still preventDefaults and the page does not
    // scroll) but unmoved: wrapping from the last chip to the first would
    // silently teleport focus across the whole band.
    expect(moveBandFocus(chips, 0, "ArrowLeft")).toBe(0);
    expect(moveBandFocus(chips, 4, "ArrowRight")).toBe(4);
  });

  it("jumps to the ends with Home and End", () => {
    expect(moveBandFocus(chips, 3, "Home")).toBe(0);
    expect(moveBandFocus(chips, 1, "End")).toBe(4);
  });

  it("moves between lanes to the nearest chip at-or-after the current date", () => {
    // From lane 0 / Aug 3, the lane-1 chip at-or-after Aug 3 is Aug 5.
    expect(moveBandFocus(chips, 0, "ArrowDown")).toBe(3);
    // From lane 1 / Aug 12 upward: lane 0 has nothing at-or-after Aug 12, so
    // it falls back to that lane's LAST chip rather than refusing to move.
    expect(moveBandFocus(chips, 4, "ArrowUp")).toBe(2);
  });

  it("skips a lane that has no chips at all rather than dead-ending on it", () => {
    const sparse: readonly BandChipRef[] = [
      { lane: 0, iso: "2026-08-03" },
      // lane 1 is empty in this window
      { lane: 2, iso: "2026-08-04" },
    ];
    expect(moveBandFocus(sparse, 0, "ArrowDown")).toBe(1);
    expect(moveBandFocus(sparse, 1, "ArrowUp")).toBe(0);
  });

  it("stays put when there is no lane to move to", () => {
    expect(moveBandFocus(chips, 0, "ArrowUp")).toBe(0);
    expect(moveBandFocus(chips, 4, "ArrowDown")).toBe(4);
  });

  it("reports an unhandled key as null so the caller leaves the event alone", () => {
    // Tab must keep escaping the band, and Enter/Space must reach the chip's
    // own click handler — swallowing either would trap the user.
    expect(moveBandFocus(chips, 0, "Tab")).toBeNull();
    expect(moveBandFocus(chips, 0, "Enter")).toBeNull();
    expect(moveBandFocus(chips, 0, " ")).toBeNull();
    expect(moveBandFocus(chips, 0, "Escape")).toBeNull();
  });

  it("leaves modifier chords to the browser", () => {
    // Alt+Left is Back. A roving group inside a page must not eat it.
    expect(moveBandFocus(chips, 1, "ArrowLeft", { altKey: true })).toBeNull();
    expect(moveBandFocus(chips, 1, "Home", { ctrlKey: true })).toBeNull();
    expect(moveBandFocus(chips, 1, "ArrowRight", { metaKey: true })).toBeNull();
    // Shift alone competes with nothing here, so it still navigates.
    expect(moveBandFocus(chips, 1, "ArrowRight", { altKey: false })).toBe(2);
  });

  it("handles an empty band and an out-of-range index without throwing", () => {
    // The index is clamped on read by the caller, but a band whose chips just
    // vanished (window navigation) must not be able to crash a keypress.
    expect(moveBandFocus([], 0, "ArrowRight")).toBeNull();
    expect(moveBandFocus(chips, 99, "ArrowLeft")).toBe(3);
    expect(moveBandFocus(chips, -1, "ArrowRight")).toBe(1);
  });
});
