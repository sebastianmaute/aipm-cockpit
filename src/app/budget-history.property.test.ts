import { describe, it } from "vitest";
import fc from "fast-check";
import { recordBudgetChange, splitVariance, summarizeBudgetHistory, type BudgetChange, type BudgetHistoryEntry, type ProjectBac } from "./budget-history";

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

  it("unattributed is 0 when bac equals the last recorded after", () => {
    fc.assert(
      fc.property(scalarArb, fc.array(scalarArb, { minLength: 1, maxLength: 20 }), scalarArb, (start, steps, eac) => {
        const history = buildHistory(start, steps);
        const summary = summarizeBudgetHistory(history);
        if (!summary) return true; // every step was a no-op — no baseline seeded
        const bac = history[history.length - 1].projectBacValue;
        const split = splitVariance(summary.baseline.value, summary.attributed.value, bac, eac);
        return Math.abs(split.unattributed) <= 1e-6;
      }),
    );
  });
});
