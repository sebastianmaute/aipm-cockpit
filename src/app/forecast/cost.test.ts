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
  it("no budget: chance over budget is null", () => {
    expect(simulateCostAtFinish({ trialDays: Int32Array.from([3]), samples: Array(12).fill(5), ac: 0, bac: 0, seedTag: "eur", horizon: 1300 })).toMatchObject({ chanceOverBudget: null });
  });
  it("too little spend history is unavailable with the counts", () => {
    expect(simulateCostAtFinish({ trialDays: Int32Array.from([3]), samples: Array(9).fill(5), ac: 0, bac: 10, seedTag: "eur", horizon: 1300 }))
      .toEqual({ kind: "unavailable", reason: "spend-history", spendDays: 9, neededSpendDays: 10 });
  });
  it("all-zero spend is unavailable", () => {
    expect(simulateCostAtFinish({ trialDays: Int32Array.from([3]), samples: Array(12).fill(0), ac: 0, bac: 10, seedTag: "eur", horizon: 1300 }))
      .toMatchObject({ kind: "unavailable", reason: "spend-history", spendDays: 12 });
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
});
