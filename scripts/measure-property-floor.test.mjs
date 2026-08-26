// Tests for the anti-vacuity floor measurement harness.
//
// ★★★ THE ONE SEMANTIC THAT MUST NOT DRIFT is `below` counting `v <= floor`.
// The harness's own header warns that this MATCHES a `toBeGreaterThan(floor)`
// assertion and OVERSTATES a `toBeGreaterThanOrEqual(floor)` one, and tells the
// caller to pass `floor - 1` in the second case. That instruction is only worth
// anything while the semantic it describes is true, and nothing else in the repo
// pins it — every consumer so far has been a throwaway script, so a silent
// change to `<` would quietly invalidate the convention note beside every floor
// that cites this tool. These cases exist to make that change loud.
//
// ★★ Every case is DETERMINISTIC — the `run` callbacks replay a fixed list, so
// there is no sampling here at all. A test for a measurement tool that itself
// samples cannot distinguish a broken tool from an unlucky run.
import { describe, expect, it } from "vitest";

import { formatMeasurement, measureFloor } from "./measure-property-floor.mjs";

/** A `run` that yields the given counter values in order, one per trial. */
const replay = (values) => {
  let i = 0;
  return () => ({ c: values[i++] });
};

describe("measureFloor", () => {
  it("counts a sample landing exactly ON the floor as below it", () => {
    // The documented `<=` semantic, stated as a behaviour rather than a comment.
    const [row] = measureFloor({ trials: 3, run: replay([8, 8, 8]), floors: { c: 8 } });
    expect(row.below).toBe(3);
    expect(row.p).toBe(1);
  });

  it("counts nothing below when every sample clears the floor strictly", () => {
    const [row] = measureFloor({ trials: 3, run: replay([9, 10, 11]), floors: { c: 8 } });
    expect(row.below).toBe(0);
    expect(row.p).toBe(0);
  });

  it("reproduces a >= assertion's true failure rate when passed floor - 1", () => {
    // This is the whole reason the header tells a `>=` caller to pass floor - 1.
    // Values 7 and 8 against `toBeGreaterThanOrEqual(8)`: only the 7 fails.
    const values = [7, 8, 9, 10];
    const naive = measureFloor({ trials: 4, run: replay(values), floors: { c: 8 } })[0];
    const correct = measureFloor({ trials: 4, run: replay(values), floors: { c: 7 } })[0];
    expect(naive.below).toBe(2); // 7 and 8 — the 8 would have PASSED
    expect(correct.below).toBe(1); // 7 alone — the real failure
  });

  it("reports mean, min and zero independently of any floor", () => {
    const [row] = measureFloor({ trials: 4, run: replay([0, 2, 4, 6]) });
    expect(row.mean).toBe(3);
    expect(row.min).toBe(0);
    expect(row.zero).toBe(1);
    expect(row.below).toBe(0); // no floor given
  });

  it("returns no rows for zero trials rather than dividing by zero", () => {
    // A NaN mean reads as a broken counter rather than an empty measurement.
    expect(measureFloor({ trials: 0, run: () => ({ c: 1 }), floors: { c: 8 } })).toEqual([]);
  });

  it("tracks several counters at once and sorts them by name", () => {
    let i = 0;
    const run = () => {
      i++;
      return { zeta: i, alpha: 10 - i };
    };
    const rows = measureFloor({ trials: 2, run, floors: { zeta: 1 } });
    expect(rows.map((r) => r.counter)).toEqual(["alpha", "zeta"]);
    expect(rows.find((r) => r.counter === "zeta").below).toBe(1); // the i=1 trial
  });
});

describe("formatMeasurement", () => {
  it("labels the column 'at or below', matching what below actually counts", () => {
    // A header reading "P(below floor)" over a `<=` tally is the misread this
    // whole file exists to prevent.
    const out = formatMeasurement(measureFloor({ trials: 2, run: replay([8, 9]) }), 2);
    expect(out).toContain("at or below floor");
    expect(out).toContain("over 2 trials");
  });

  it("prints an exact zero rather than 0.0000%", () => {
    const rows = measureFloor({ trials: 4, run: replay([9, 9, 9, 9]), floors: { c: 8 } });
    expect(formatMeasurement(rows, 4)).toContain("0 (0/4)");
  });

  it("prints the count alongside the percentage, so a rate is falsifiable", () => {
    const rows = measureFloor({ trials: 4, run: replay([8, 9, 9, 9]), floors: { c: 8 } });
    expect(formatMeasurement(rows, 4)).toContain("(1/4)");
  });
});
