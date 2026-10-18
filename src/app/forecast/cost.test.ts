import { describe, expect, it } from "vitest";
import type { DatedValue } from "../budget-forecast";
import { simulateCostAtFinish, spendSamples } from "./cost";

const D = (date: string, value: number, bookedFrom = date): DatedValue => ({ date, bookedFrom, value, spread: false });
const WINDOW = Array.from({ length: 12 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);

describe("spendSamples", () => {
  it("sums spend per window day, zero days included", () => {
    expect(spendSamples([D("2026-10-01", 100), D("2026-10-01", 50), D("2026-10-03", 30)], WINDOW).slice(0, 3)).toEqual([150, 0, 30]);
  });
  it("days before the first booking are not samples", () => {
    expect(spendSamples([D("2026-10-07", 10)], WINDOW)).toHaveLength(6); // 07..12
  });
  it("a booking before the window makes every window day a sample", () => {
    expect(spendSamples([D("2026-09-01", 10)], WINDOW)).toHaveLength(12);
  });
  it("no non-zero booking means no samples", () => {
    expect(spendSamples([D("2026-10-02", 0)], WINDOW)).toEqual([]);
    expect(spendSamples([], WINDOW)).toEqual([]);
  });
  it("a zero-valued entry does not count as the first booking", () => {
    expect(spendSamples([D("2026-10-02", 0), D("2026-10-09", 5)], WINDOW)).toHaveLength(4); // 09..12
  });
});

describe("simulateCostAtFinish", () => {
  it("is deterministic and carries each trial's own finish day", () => {
    const a = simulateCostAtFinish({ trialDays: Int32Array.from([0, 10, 20]), samples: Array(12).fill(100), ac: 1000, bac: 2500, seedTag: "eur", horizon: 1300 });
    expect(a).toEqual({ kind: "sim", p50: 2000, p80: 3000, p95: 3000, chanceOverBudget: 1 / 3, spendDays: 12 });
  });
  it("beyond-horizon trials read beyond and count as over budget", () => {
    const r = simulateCostAtFinish({ trialDays: Int32Array.from([1, 1301, 1301]), samples: Array(12).fill(1), ac: 0, bac: 1e9, seedTag: "eur", horizon: 1300 });
    expect(r).toMatchObject({ kind: "sim", p95: "beyond", p80: "beyond", chanceOverBudget: 2 / 3 });
  });
  it("nothing open: the cost is exactly today's actual cost", () => {
    const r = simulateCostAtFinish({ trialDays: new Int32Array(5), samples: Array(12).fill(7), ac: 420, bac: 400, seedTag: "eur", horizon: 1300 });
    expect(r).toMatchObject({ p50: 420, p80: 420, p95: 420, chanceOverBudget: 1 });
  });
  it("nothing open short-circuits to AC even below the spend floor (§502 fix 3)", () => {
    const none = simulateCostAtFinish({ trialDays: new Int32Array(4), samples: [], ac: 300, bac: 500, seedTag: "eur", horizon: 1300 });
    expect(none).toEqual({ kind: "sim", p50: 300, p80: 300, p95: 300, chanceOverBudget: 0, spendDays: 0 });
    const zeros = simulateCostAtFinish({ trialDays: new Int32Array(4), samples: Array(12).fill(0), ac: 300, bac: 0, seedTag: "eur", horizon: 1300 });
    expect(zeros).toMatchObject({ kind: "sim", p80: 300, chanceOverBudget: null });
  });
  it("spendScale multiplies each trial's added spend exactly; AC is not scaled (§502 fix 1)", () => {
    const at = (spendScale?: number) => simulateCostAtFinish({ trialDays: Int32Array.from([0, 10, 20]), samples: Array(12).fill(100), ac: 1000, bac: 1e9, seedTag: "eur", horizon: 1300, spendScale });
    expect(at(2)).toMatchObject({ p50: 1000 + 2 * 1000, p80: 1000 + 2 * 2000, p95: 1000 + 2 * 2000 });
    expect(at(1)).toEqual(at());
    const samples = [10, 0, 30, 5, 50, 0, 20, 10, 40, 15, 25, 35];
    const varied = (spendScale?: number) => simulateCostAtFinish({ trialDays: Int32Array.from(Array(200).fill(30)), samples, ac: 100, bac: 1e9, seedTag: "eur", horizon: 1300, spendScale });
    expect(varied(2)).toMatchObject({ p50: 100 + 2 * 590, p80: 100 + 2 * 660, p95: 100 + 2 * 730 }); // same draws as the pinned unscaled run
  });
  it("no budget: chance over budget is null", () => {
    expect(simulateCostAtFinish({ trialDays: Int32Array.from([3]), samples: Array(12).fill(5), ac: 0, bac: 0, seedTag: "eur", horizon: 1300 })).toMatchObject({ chanceOverBudget: null });
  });
  it("too little spend history is unavailable with the counts", () => {
    expect(simulateCostAtFinish({ trialDays: Int32Array.from([3]), samples: Array(9).fill(5), ac: 0, bac: 10, seedTag: "eur", horizon: 1300 }))
      .toEqual({ kind: "unavailable", reason: "spend-history", spendDays: 9, neededSpendDays: 10 });
  });
  it("all-zero spend (bookings only before the window) is its own reason, no-spend", () => {
    expect(simulateCostAtFinish({ trialDays: Int32Array.from([3]), samples: Array(12).fill(0), ac: 0, bac: 10, seedTag: "eur", horizon: 1300 }))
      .toEqual({ kind: "unavailable", reason: "no-spend", spendDays: 12, neededSpendDays: 10 });
  });
  it("varied spend is seeded: repeatable, pinned, and the seed tag changes the draws", () => {
    const samples = [10, 0, 30, 5, 50, 0, 20, 10, 40, 15, 25, 35];
    const run = (seedTag: string) => simulateCostAtFinish({ trialDays: Int32Array.from(Array(200).fill(30)), samples, ac: 100, bac: 1e9, seedTag, horizon: 1300 });
    expect(run("eur")).toEqual(run("eur"));
    expect(run("eur")).toEqual({ kind: "sim", p50: 690, p80: 760, p95: 830, chanceOverBudget: 0, spendDays: 12 });
    expect(run("usd")).not.toEqual(run("eur"));
  });

  it("a slow trial costs more than a fast one on varied spend (same runs drive both)", () => {
    const samples = [10, 0, 30, 5, 50, 0, 20, 10, 40, 15, 25, 35];
    const fastSlow = simulateCostAtFinish({ trialDays: Int32Array.from(Array(1000).fill(5).concat(Array(1000).fill(50))), samples, ac: 0, bac: 1e9, seedTag: "eur", horizon: 1300 });
    expect(fastSlow.kind).toBe("sim");
    if (fastSlow.kind !== "sim") return;
    expect(fastSlow.p50).not.toBe("beyond");
    expect(fastSlow.p95).not.toBe("beyond");
    expect(fastSlow.p50 as number).toBeLessThan(300); // fast cluster: 5 days, about 100
    expect(fastSlow.p95 as number).toBeGreaterThan(800); // slow cluster: 50 days, about 1000
  });

  it("a trial's own finish day leaves every other trial's draws alone (per-trial sub-stream)", () => {
    const samples = [10, 0, 30, 5, 50, 0, 20, 10, 40, 15, 25, 35];
    const run = (first: number) => simulateCostAtFinish({ trialDays: Int32Array.from([first, ...Array(19).fill(20)]), samples, ac: 0, bac: 1e9, seedTag: "eur", horizon: 1300 });
    expect(run(61)).toMatchObject({ p50: (run(60) as { p50: number }).p50, p80: (run(60) as { p80: number }).p80 });
  });
  it("a per-day spend scale applies to its own day only", () => {
    const scale = Float64Array.from([0, 1, 1, 0.5, 0.5]);
    expect(simulateCostAtFinish({ trialDays: Int32Array.from([4]), samples: Array(12).fill(100), ac: 7, bac: 0, seedTag: "eur", horizon: 4, spendScale: scale }))
      .toMatchObject({ p50: 7 + 100 + 100 + 50 + 50 });
  });
  it("added cost is booked every day up to the trial's finish, on top of the drawn spend", () => {
    const addedCost = Float64Array.from([0, 10, 10, 10, 10]);
    expect(simulateCostAtFinish({ trialDays: Int32Array.from([3]), samples: Array(12).fill(100), ac: 7, bac: 0, seedTag: "eur", horizon: 4, addedCost }))
      .toMatchObject({ p50: 7 + 300 + 30 });
  });
  it("added cost reads its own day: a later day's figure is not booked before that day", () => {
    const addedCost = Float64Array.from([0, 1, 2, 4, 1000]);
    expect(simulateCostAtFinish({ trialDays: Int32Array.from([3]), samples: Array(12).fill(100), ac: 0, bac: 0, seedTag: "eur", horizon: 4, addedCost }))
      .toMatchObject({ p50: 300 + 1 + 2 + 4 });
  });
  it("a beyond trial stays beyond with added cost", () => {
    const addedCost = new Float64Array(1301).fill(10);
    expect(simulateCostAtFinish({ trialDays: Int32Array.from([1301]), samples: Array(12).fill(100), ac: 0, bac: 1e9, seedTag: "eur", horizon: 1300, addedCost }))
      .toMatchObject({ kind: "sim", p50: "beyond", chanceOverBudget: 1 });
  });
  it("a per-day array shorter than the horizon is refused rather than read as NaN", () => {
    const short = new Float64Array(4);
    expect(() => simulateCostAtFinish({ trialDays: Int32Array.from([3]), samples: Array(12).fill(100), ac: 0, bac: 0, seedTag: "eur", horizon: 4, addedCost: short })).toThrow(RangeError);
    expect(() => simulateCostAtFinish({ trialDays: Int32Array.from([3]), samples: Array(12).fill(100), ac: 0, bac: 0, seedTag: "eur", horizon: 4, spendScale: short })).toThrow(RangeError);
  });
});
