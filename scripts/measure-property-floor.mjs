#!/usr/bin/env node
// scripts/measure-property-floor.mjs — measure how often an anti-vacuity floor
// would fail.
//
// An anti-vacuity floor asserts a property's generator reached an interesting
// branch at least N times in `numRuns` draws. fast-check is UNSEEDED, so that
// count is a random variable and the floor is a bet. This measures the bet.
//
// USAGE: import it from a throwaway script that reproduces the property's
// generator and counting, then call:
//
//   measureFloor({ trials: 20000, run: () => ({ contended, uncontended }) })
//
// where `run` performs ONE full numRuns-sized sample and returns the counters.
//
// ★★★ REPLACE ANY vi.fn() MINTER WITH A PLAIN CLOSURE BEFORE MEASURING. The
// counters derive from the returned result, never from the mock, and 20,000
// x 50 accumulated mock call records terminate the vitest worker with
// ERR_WORKER_OUT_OF_MEMORY — which reads like a broken harness rather than a
// measurement error, and costs an afternoon.
//
// ★★ REPORT A PROBABILITY, NEVER A SAMPLE MINIMUM. Raising numRuns at an
// unchanged absolute floor makes the guard WEAKER, not the run safer: more
// samples against the same threshold is a lower bar. The number that belongs
// beside a floor is P(counter < floor), which is comparable across files.

/**
 * @param {object} opts
 * @param {number} opts.trials how many independent samples to draw
 * @param {() => Record<string, number>} opts.run one full sample; returns counters
 * @param {Record<string, number>} [opts.floors] floor per counter, for P(below)
 * @returns {Array<{counter: string, mean: number, min: number, zero: number, below: number, p: number}>}
 */
export function measureFloor({ trials, run, floors = {} }) {
  const sums = {};
  const mins = {};
  const zeros = {};
  const belows = {};

  for (let i = 0; i < trials; i++) {
    const counters = run();
    for (const [k, v] of Object.entries(counters)) {
      sums[k] = (sums[k] ?? 0) + v;
      mins[k] = Math.min(mins[k] ?? Infinity, v);
      if (v === 0) zeros[k] = (zeros[k] ?? 0) + 1;
      const floor = floors[k];
      if (floor !== undefined && v <= floor) belows[k] = (belows[k] ?? 0) + 1;
    }
  }

  return Object.keys(sums)
    .sort()
    .map((counter) => {
      const below = belows[counter] ?? 0;
      return {
        counter,
        mean: sums[counter] / trials,
        min: mins[counter],
        zero: zeros[counter] ?? 0,
        below,
        p: below / trials,
      };
    });
}

/** Format a measurement table for pasting into a comment or the register. */
export function formatMeasurement(rows, trials) {
  const lines = [`| counter | mean | min | P(at or below floor) over ${trials} trials |`, `|---|---|---|---|`];
  for (const r of rows) {
    const pct = r.p === 0 ? `0 (0/${trials})` : `${(r.p * 100).toFixed(4)}% (${r.below}/${trials})`;
    lines.push(`| \`${r.counter}\` | ${r.mean.toFixed(2)} | ${r.min} | ${pct} |`);
  }
  return lines.join("\n");
}
