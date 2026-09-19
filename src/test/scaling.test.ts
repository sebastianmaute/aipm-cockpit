import { describe, expect, it } from "vitest";
import { expectLinearScaling, measureScaling, TIMER_FLOOR_MS } from "./scaling";

/**
 * A fake clock the fake workload advances. `cost(n, call)` is the ms one run
 * costs at size n; `call` counts every `run` from 1.
 */
function fakeWorkload(cost: (n: number, call: number) => number) {
  const clock = { t: 0, calls: 0 };
  return {
    now: () => clock.t,
    build: (n: number) => n,
    run: (n: number) => {
      clock.calls += 1;
      clock.t += cost(n, clock.calls);
      return n;
    },
  };
}

// Call order at the default repeats (3), for a run of 100 ms or more at n, so
// calibration needs exactly one probe:
//   call 1 = untimed warm-up (small), call 2 = calibration probe (small),
//   then repeat r times small at call 3 + 2r and large at call 4 + 2r.
const FIRST_SMALL_CALL = 3;
const FIRST_LARGE_CALL = 4;
const LAST_LARGE_CALL = 2 * 3 + 2; // 8
const slow = (n: number) => (n / 1000) * 50;

describe("measureScaling", () => {
  it("passes a linear curve, in 1 warm-up + 1 probe + 3 small/large pairs", () => {
    let lastCall = 0;
    const w = fakeWorkload((n, call) => {
      lastCall = call;
      return n / 1000;
    });
    const r = expectLinearScaling({ label: "linear", ...w, check: () => {}, n: 100_000 });
    expect(r.ratio).toBeCloseTo(4, 5);
    expect(r.nLarge).toBe(400_000);
    expect(lastCall).toBe(LAST_LARGE_CALL);
  });

  it("fails a quadratic curve, naming both minima, the ratio and every pair ratio", () => {
    const w = fakeWorkload((n) => (n / 1000) ** 2 / 100);
    expect(() =>
      expectLinearScaling({ label: "quad", ...w, check: () => {}, n: 100_000 }),
    ).toThrow(
      /quad: small n=100000 .*ms, large n=400000 .*ms, ratio 16\.00 \(max 8\), pair ratios \[16\.00, 16\.00, 16\.00\]/,
    );
  });

  it("fails a quadratic curve even when a spike spoils one pair", () => {
    // A spike on the first small run drags pair 0 down to 0.32; the other two
    // pairs are still 16, so the median stays 16. The MINIMUM of the per-pair
    // ratios would pass this quadratic.
    const w = fakeWorkload((n, call) => (call === FIRST_SMALL_CALL ? slow(n) : (n / 1000) ** 2 / 100));
    expect(() =>
      expectLinearScaling({ label: "quad-spike", ...w, check: () => {}, n: 100_000 }),
    ).toThrow(/ratio 16\.00 \(max 8\), pair ratios \[0\.32, 16\.00, 16\.00\]/);
  });

  it("ignores one spike on the first small run", () => {
    const w = fakeWorkload((n, call) => (call === FIRST_SMALL_CALL ? slow(n) : n / 1000));
    const r = expectLinearScaling({ label: "spike", ...w, check: () => {}, n: 100_000 });
    expect(r.ratio).toBeCloseTo(4, 5);
  });

  it("ignores one spike on the first large run", () => {
    const w = fakeWorkload((n, call) => (call === FIRST_LARGE_CALL ? slow(n) : n / 1000));
    const r = expectLinearScaling({ label: "spike", ...w, check: () => {}, n: 100_000 });
    expect(r.ratio).toBeCloseTo(4, 5);
    // The reported large figure is the fastest large run, not the spiked first one.
    expect(r.largeMs).toBeCloseTo(400, 5);
  });

  it("ignores one spike on the LAST large run", () => {
    // A helper that judged the last pair alone would see 20,000 ms against
    // 100 ms here: ratio 200. The median outvotes that one pair.
    const w = fakeWorkload((n, call) => (call === LAST_LARGE_CALL ? slow(n) : n / 1000));
    const r = expectLinearScaling({ label: "spike", ...w, check: () => {}, n: 100_000 });
    expect(r.ratio).toBeCloseTo(4, 5);
  });

  it("keeps sizes interleaved, so load that arrives mid-run and stays does not fail", () => {
    // From call 5 (repeat 1's small run) on, every run is 50x slower. Interleaved,
    // repeat 0's pair (calls 3 and 4) is clean and pairs 1 and 2 are loaded on
    // both sides, so every pair is 4. A helper that ran every small repeat
    // before any large one would pair clean small runs with loaded large ones.
    const w = fakeWorkload((n, call) => (call >= FIRST_SMALL_CALL + 2 ? slow(n) : n / 1000));
    const r = expectLinearScaling({ label: "sustained", ...w, check: () => {}, n: 100_000 });
    expect(r.ratio).toBeCloseTo(4, 5);
  });

  it("passes when load steps up on the FIRST large run and stays", () => {
    // From call 4 on, every run is 50x slower. Only pair 0 straddles the step
    // (clean small, loaded large: ratio 200); pairs 1 and 2 are loaded on both
    // sides (ratio 4), so the median is 4. min(large) / min(small) would pair
    // the one clean small run with a loaded large run and report 200.
    const w = fakeWorkload((n, call) => (call >= FIRST_LARGE_CALL ? slow(n) : n / 1000));
    const r = expectLinearScaling({ label: "step", ...w, check: () => {}, n: 100_000 });
    expect(r.ratio).toBeCloseTo(4, 5);
    expect(r.pairRatios.map((p) => Math.round(p))).toEqual([200, 4, 4]);
    // The per-size minima are reporting only: here they come from different load.
    expect(r.smallMs).toBeCloseTo(100, 5);
    expect(r.largeMs).toBeCloseTo(20_000, 5);
  });

  it("passes when load steps up on a later large run and stays", () => {
    // From call 6 (repeat 1's large run) on, every run is 50x slower: pair 1
    // straddles the step, pair 0 is clean and pair 2 is loaded on both sides.
    const w = fakeWorkload((n, call) => (call >= FIRST_LARGE_CALL + 2 ? slow(n) : n / 1000));
    const r = expectLinearScaling({ label: "late-step", ...w, check: () => {}, n: 100_000 });
    expect(r.ratio).toBeCloseTo(4, 5);
    expect(r.pairRatios.map((p) => Math.round(p))).toEqual([4, 200, 4]);
  });

  it("takes the median of an even number of pairs as the mean of the two middle ratios", () => {
    // Four repeats, spikes on the first two large runs (calls 4 and 6): the
    // pairs are [200, 200, 4, 4], and the mean of the middle two is 102 —
    // neither middle value alone, so this pins the even-count rule.
    const w = fakeWorkload((n, call) =>
      call === FIRST_LARGE_CALL || call === FIRST_LARGE_CALL + 2 ? slow(n) : n / 1000,
    );
    const r = measureScaling({ label: "even", ...w, check: () => {}, n: 100_000, repeats: 4 });
    expect(r.ratio).toBeCloseTo(102, 5);
  });

  it("loops a sub-floor small side up to the floor, with the same count on the large side", () => {
    const w = fakeWorkload((n) => n / 1_000_000); // 0.1 ms at n=100_000
    const r = measureScaling({ label: "tiny", ...w, check: () => {}, n: 100_000 });
    expect(r.loops).toBeGreaterThan(1);
    expect(r.smallMs).toBeGreaterThanOrEqual(TIMER_FLOOR_MS);
    expect(r.ratio).toBeCloseTo(4, 5);
  });

  it("does not time build", () => {
    const clock = { t: 0 };
    const r = measureScaling({
      label: "build",
      now: () => clock.t,
      build: (n: number) => {
        clock.t += 10_000; // an expensive build must never enter the ratio
        return n;
      },
      run: (n: number) => {
        clock.t += n / 1000;
        return n;
      },
      check: () => {},
      n: 100_000,
    });
    expect(r.ratio).toBeCloseTo(4, 5);
  });

  it("runs check at both sizes", () => {
    const w = fakeWorkload((n) => n / 1000);
    const seen: number[] = [];
    // The fake run returns its input, so `out` IS the size it was checked at.
    measureScaling({ label: "check", ...w, check: (out) => seen.push(out), n: 100_000 });
    expect(seen).toContain(100_000);
    expect(seen).toContain(400_000);
  });

  it("fails when check throws at the large size only", () => {
    const w = fakeWorkload((n) => n / 1000);
    expect(() =>
      expectLinearScaling({
        label: "bail",
        ...w,
        check: (out, n) => {
          if (n === 400_000) throw new Error(`early bail at ${out}`);
        },
        n: 100_000,
      }),
    ).toThrow(/early bail at 400000/);
  });

  it("honours a maxRatio override", () => {
    // No converted site passes maxRatio today; this pins the option for a
    // future guard whose expected curve is flatter than linear.
    const w = fakeWorkload(() => 25); // a flat curve
    const r = expectLinearScaling({ label: "flat", ...w, check: () => {}, n: 1000, maxRatio: 2 });
    expect(r.ratio).toBeCloseTo(1, 5);
    const g = fakeWorkload((n) => n / 40); // linear against a flat expectation
    expect(() =>
      expectLinearScaling({ label: "grows", ...g, check: () => {}, n: 1000, maxRatio: 2 }),
    ).toThrow(/ratio 4\.00 \(max 2\)/);
  });

  it("rejects options that cannot measure scaling", () => {
    const w = fakeWorkload((n) => n / 1000);
    expect(() => measureScaling({ label: "x", ...w, check: () => {}, n: 0 })).toThrow(/n must be/);
    expect(() => measureScaling({ label: "x", ...w, check: () => {}, n: 10, factor: 1 })).toThrow(/factor must be/);
    expect(() => measureScaling({ label: "x", ...w, check: () => {}, n: 10, repeats: 0 })).toThrow(/repeats must be/);
  });

  it("refuses a run too cheap to reach the floor within the loop cap", () => {
    const w = fakeWorkload(() => 0);
    expect(() => measureScaling({ label: "free", ...w, check: () => {}, n: 10 })).toThrow(/free: .*below the 20 ms floor/);
  });
});
