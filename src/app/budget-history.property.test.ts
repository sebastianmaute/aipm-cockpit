import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { BAC_EPSILON, recordBudgetChange, splitVariance, summarizeBudgetHistory, type BudgetChange, type BudgetHistoryEntry, type ProjectBac } from "./budget-history";

const scalarArb = fc.double({ min: 0, max: 1e7, noNaN: true });

let n = 0;
function makeChange(before: ProjectBac, after: ProjectBac): BudgetChange {
  return {
    kind: "updated", bucketId: 1, bucketName: "B",
    before, after, at: "2026-09-16T10:00:00.000Z", date: "2026-09-16", newId: () => `id-${++n}`,
  };
}

/** Chains an arbitrary sequence of scalar BAC values into a history, where
 *  each step's `before` equals the previous step's `after` (or `start` for
 *  the first step) — mirroring the real write path's sequential commits. */
function buildHistory(start: number, steps: readonly number[]): readonly BudgetHistoryEntry[] {
  let prev: ProjectBac = { hours: start, value: start };
  let history: readonly BudgetHistoryEntry[] = [];
  for (const s of steps) {
    const after: ProjectBac = { hours: s, value: s };
    history = recordBudgetChange(history, makeChange(prev, after));
    prev = after;
  }
  return history;
}

/** Absolute 1e-6 tolerance (values run up to 1e7). */
const closeTo = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) <= 1e-6;

describe("splitVariance identity (property)", () => {
  it("performance + attributed + unattributed === vac for any recorded chain and any bac/eac", () => {
    fc.assert(
      fc.property(scalarArb, fc.array(scalarArb, { maxLength: 20 }), scalarArb, scalarArb, (start, steps, bac, eac) => {
        const history = buildHistory(start, steps);
        const summary = summarizeBudgetHistory(history);
        if (!summary) return true; // no baseline seeded yet — nothing to check
        const split = splitVariance(summary.baseline.value, summary.attributed.value, bac, eac);
        const vac = bac - eac;
        return closeTo(split.performance + split.attributed + split.unattributed, vac);
      }),
    );
  });

  // ★★★ §583 — the flat `1e-6` bound this used to assert was WRONG, not merely
  // tight. `recordBudgetChange` drops a step as a no-op when its move is below
  // `BAC_EPSILON` (`Math.abs(dh) < BAC_EPSILON && Math.abs(dv) < BAC_EPSILON`),
  // but `prev` in `buildHistory` still advances past the dropped step — so the
  // NEXT recorded entry's `before` is the dropped step's true (tiny) value, not
  // the previous RECORDED entry's `after`. The recorded delta chain then omits
  // exactly the dropped transition's own delta, which is bounded by
  // `BAC_EPSILON` by construction (that bound is *why* it was droppable) but is
  // not exactly zero. With up to `steps.length - 1` such drops possible in one
  // chain (at least one step must be recorded for `summary` to be non-null),
  // the true `unattributed` for this property can be up to
  // `(steps.length - 1) * BAC_EPSILON` away from 0 — a property of the design
  // (BAC_EPSILON intentionally treats sub-epsilon churn as noise), not a bug.
  // A flat `1e-6` bound has ZERO headroom against even a single drop, so an
  // extra few ULPs of floating summation error on top (see `attributed`'s
  // `reduce` in `summarizeBudgetHistory`) tips it over — reproduced locally at
  // seed -1591760474 (39378 property runs) with the counterexample pinned as
  // an explicit regression below. `steps.length` (not `- 1`) keeps a full
  // `BAC_EPSILON` of slack for that floating noise on top of the design bound.
  it("unattributed is close to 0 (within the drop bound) when bac equals the last recorded after", () => {
    fc.assert(
      fc.property(scalarArb, fc.array(scalarArb, { minLength: 1, maxLength: 20 }), scalarArb, (start, steps, eac) => {
        const history = buildHistory(start, steps);
        const summary = summarizeBudgetHistory(history);
        if (!summary) return true; // every step was a no-op — no baseline seeded
        const bac = history[history.length - 1].projectBacValue;
        const split = splitVariance(summary.baseline.value, summary.attributed.value, bac, eac);
        return Math.abs(split.unattributed) <= steps.length * BAC_EPSILON;
      }),
    );
  });

  // ★ Regression for §583: pinned from the fast-check counterexample above
  // (seed -1591760474, shrunk to this 4-step chain). `steps[1]` is a genuine
  // no-op drop relative to `steps[0]` (both ~1e-6, moving by less than
  // `BAC_EPSILON`), which the flat-`1e-6` assertion this replaces could not
  // tolerate once floating summation noise was added on top.
  it("unattributed regression: a dropped near-zero step between two recorded ones (§583)", () => {
    const start = 0;
    const steps = [0.000001, 1.0587911840678754e-22, 0.0000018680146407231636, 0];
    const eac = 0;
    const history = buildHistory(start, steps);
    const summary = summarizeBudgetHistory(history);
    if (!summary) throw new Error("expected a baseline to be seeded");
    const bac = history[history.length - 1].projectBacValue;
    const split = splitVariance(summary.baseline.value, summary.attributed.value, bac, eac);
    expect(Math.abs(split.unattributed)).toBeLessThanOrEqual(steps.length * BAC_EPSILON);
  });
});
