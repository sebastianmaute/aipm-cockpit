// Load-independent complexity guard for unit tests.
//
// ★ Replaces "elapsed < CEILING_MS". A fixed ceiling fails a CORRECT build
//   when the machine is saturated (register §592, §593). This times the code
//   at n and n * factor in back-to-back PAIRS (one small run, then one large
//   run), takes each pair's own ratio large_i / small_i, and asserts on the
//   MEDIAN of those per-pair ratios. Linear code gives ≈ factor, quadratic
//   ≈ factor²; the default maxRatio factor^1.5 sits between them on a log
//   scale.
// ★ Why the median of per-pair ratios, and not min(large) / min(small): the
//   minima are taken independently, so they can pair a small run timed on an
//   idle machine with a large run timed under load. Load that STEPS up after
//   the first small run and stays gives min/min ≈ factor × the slowdown, which
//   fails a correct build. Per pair, both sides share the load in force at
//   that moment: a step that starts inside pair k spoils pair k only (every
//   later pair is loaded on BOTH sides and stays ≈ factor), and a one-off
//   spike spoils one pair. The median of 3 outvotes one spoiled pair, while a
//   real quadratic pushes EVERY pair to ≈ factor², so it stays red. With an
//   even `repeats` the median is the mean of the two middle ratios.
//   `smallMs` / `largeMs` stay in the result as the per-size minima, for the
//   failure message and for reporting only; they never decide pass or fail.
// ★ The "Measured 2026-09-19 (ratio large / small, limit 8)" figures in the
//   call sites' comments were taken while this helper still judged
//   min(large) / min(small). On an idle machine every pair agrees within
//   noise, so the two definitions give the same figure. Four sites were
//   re-proved red under the median before merge; the §592 closure in
//   docs/open-followups.md records them.
// ★ `check` is mandatory and runs at BOTH sizes: an early bail that made the
//   input trivial would otherwise pass a ratio check exactly as it passed a
//   ceiling.
// ★ One untimed warm-up run precedes calibration. A cold first call carries
//   JIT compilation and the flattening of a `repeat()` string; timed, a cold
//   probe of 20 ms or more would lock the loop count at 1 while the steady
//   state is a few ms.
// ★ HANG BACKSTOP. Give every test that calls this `{ timeout: 120_000 }` as
//   its options argument (`it(name, { timeout: 120_000 }, fn)` in vitest 4).
//   vitest cannot interrupt synchronous code: `withTimeout` in @vitest/runner
//   wraps the test in `runWithTimeout`, whose setTimeout timer cannot fire
//   while a synchronous test holds the thread, so elapsed time is checked
//   only once the test RETURNS, in that function's inner `resolve()`. A
//   passing test is then failed if it took longer than its timeout, so the
//   default 20 s testTimeout would itself be a wall-clock ceiling on a slowed
//   machine. A throwing test takes the `reject()` path, which never checks
//   elapsed time, so a red ratio is always reported as the ratio.
import { expect } from "vitest";

/** A small side cheaper than this is looped until it reaches it, so the ratio is not timer noise. */
export const TIMER_FLOOR_MS = 20;
/** New guards should pick `n` so calibration lands at ≤ 1/16 of this cap (≤4,096 loops, office-xml's
 *  proof-time exception aside at ≤8,192) — headroom for a CI machine 2–4x faster than the one that
 *  calibrated it, which would otherwise throw the "below the ... floor" error below on a correct build. */
const MAX_LOOPS = 1 << 16;

export interface ScalingOptions<I, O> {
  /** Names the site in the failure message. */
  label: string;
  /** Builds the fixture at size n. Never timed. */
  build: (n: number) => I;
  /**
   * The code under test. Timed. Called many times on the SAME input, so it
   * must be stateless across calls: no global or sticky regex whose
   * `lastIndex` carries over, no cache keyed on the input.
   */
  run: (input: I) => O;
  /** Asserts on the output. Runs once at each size. */
  check: (output: O, n: number) => void;
  /** The small size. */
  n: number;
  factor?: number;
  repeats?: number;
  maxRatio?: number;
  /** Injectable clock, for this helper's own tests. */
  now?: () => number;
}

export interface ScalingResult {
  /** Fastest small run across the repeats. Reporting only — not the ratio's numerator or denominator. */
  smallMs: number;
  /** Fastest large run across the repeats. Reporting only. */
  largeMs: number;
  /** The median of `pairRatios`: the value the guard judges. */
  ratio: number;
  /** large_i / small_i for each repeat i, in the order the pairs ran. */
  pairRatios: number[];
  loops: number;
  nLarge: number;
}

export function measureScaling<I, O>(opts: ScalingOptions<I, O>): ScalingResult {
  const factor = opts.factor ?? 4;
  const repeats = opts.repeats ?? 3;
  const now = opts.now ?? (() => performance.now());
  if (!Number.isInteger(opts.n) || opts.n < 1) throw new Error(`${opts.label}: n must be a positive integer`);
  if (!(factor > 1)) throw new Error(`${opts.label}: factor must be greater than 1`);
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error(`${opts.label}: repeats must be a positive integer`);

  const nLarge = Math.round(opts.n * factor);
  const small = opts.build(opts.n);
  const large = opts.build(nLarge);

  const time = (input: I, loops: number): { ms: number; out: O } => {
    const started = now();
    let out = opts.run(input);
    for (let i = 1; i < loops; i++) out = opts.run(input);
    return { ms: now() - started, out };
  };

  // Untimed warm-up at the small size; its output is the small-size check.
  opts.check(opts.run(small), opts.n);

  // Calibrate the loop count on the small side.
  let loops = 1;
  let probeMs = time(small, loops).ms;
  while (probeMs < TIMER_FLOOR_MS) {
    if (loops >= MAX_LOOPS) {
      throw new Error(
        `${opts.label}: ${loops} runs at n=${opts.n} took ${probeMs.toFixed(3)}ms, below the ${TIMER_FLOOR_MS} ms floor — use a larger n`,
      );
    }
    loops *= 2;
    probeMs = time(small, loops).ms;
  }

  // Interleave: each repeat times small, then large, back to back, so both
  // halves of a pair run under the same load. The guard judges the median of
  // the per-pair ratios (see the header); the per-size minima are reporting only.
  let smallMs = Infinity;
  let largeMs = Infinity;
  const pairRatios: number[] = [];
  for (let r = 0; r < repeats; r++) {
    const s = time(small, loops).ms;
    const l = time(large, loops);
    if (r === 0) opts.check(l.out, nLarge);
    smallMs = Math.min(smallMs, s);
    largeMs = Math.min(largeMs, l.ms);
    pairRatios.push(l.ms / s);
  }
  return { smallMs, largeMs, ratio: median(pairRatios), pairRatios, loops, nLarge };
}

/** The middle value; for an even count, the mean of the two middle values. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function expectLinearScaling<I, O>(opts: ScalingOptions<I, O>): ScalingResult {
  const factor = opts.factor ?? 4;
  const maxRatio = opts.maxRatio ?? factor ** 1.5;
  const r = measureScaling(opts);
  expect(
    r.ratio,
    `${opts.label}: small n=${opts.n} ${r.smallMs.toFixed(1)}ms, large n=${r.nLarge} ${r.largeMs.toFixed(1)}ms, ` +
      `ratio ${r.ratio.toFixed(2)} (max ${Number(maxRatio.toFixed(2))}), ` +
      `pair ratios [${r.pairRatios.map((p) => p.toFixed(2)).join(", ")}], loops ${r.loops}`,
  ).toBeLessThan(maxRatio);
  return r;
}
