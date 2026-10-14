import { describe, expect, test } from "vitest";
import {
  crossRate, rebaseBudgetHistory, rebaseFactor, rebaseSnapshots, restoreSwitchEntry, sanitizeBaselineHistory,
  type BaselineEntry,
} from "./baseline-currency";
import type { FxRates } from "./types";
import type { SnapshotRecord } from "./snapshot";
import type { BudgetHistoryEntry } from "./budget-history";

const T1 = "2026-10-14T09:00:00.000Z";
const T2 = "2026-11-01T09:00:00.000Z";
const fx = (rates: Record<string, number>): FxRates => ({ base: "EUR", date: "2026-10-14", fetchedAt: T1, rates });
const good: BaselineEntry = { from: "2026-10-14", at: T1, currency: "GBP", perPrevious: 0.852 };
const history: BaselineEntry[] = [
  { from: "2026-10-14", at: T1, currency: "GBP", perPrevious: 0.85 },
  { from: "2026-11-01", at: T2, currency: "USD", perPrevious: 1.3 },
];
const ms = (iso: string, d: number) => new Date(Date.parse(iso) + d).toISOString();

describe("sanitizeBaselineHistory", () => {
  test("keeps a valid entry", () => {
    expect(sanitizeBaselineHistory([good])).toEqual([good]);
  });
  test("drops bad currency, perPrevious, date and at", () => {
    expect(sanitizeBaselineHistory([
      { ...good, currency: "CHF" }, { ...good, perPrevious: 0 }, { ...good, perPrevious: NaN },
      { ...good, from: "14.10.2026" }, { ...good, at: "yesterday" },
    ])).toEqual([]);
  });
  test("keeps a creation entry without perPrevious", () => {
    const c = { from: "2026-10-14", at: T1, currency: "EUR" };
    expect(sanitizeBaselineHistory([c])).toEqual([c]);
  });
  test("sorts by at", () => {
    expect(sanitizeBaselineHistory([history[1], history[0]])).toEqual(history);
  });
  test("non-array input gives empty", () => {
    expect(sanitizeBaselineHistory(undefined)).toEqual([]);
    expect(sanitizeBaselineHistory({})).toEqual([]);
  });
});

describe("crossRate", () => {
  const f = fx({ EUR: 1, GBP: 0.85, USD: 1.1 });
  test("cross rates via EUR", () => {
    expect(crossRate(f, "EUR", "GBP")).toBe(0.85);
    expect(crossRate(f, "GBP", "USD")).toBeCloseTo(1.1 / 0.85, 10);
    expect(crossRate(f, "USD", "EUR")).toBeCloseTo(1 / 1.1, 10);
    expect(crossRate(f, "GBP", "GBP")).toBe(1);
  });
  test("null when a side is missing or non-positive", () => {
    expect(crossRate(f, "EUR", "INR")).toBeNull();
    expect(crossRate(fx({ EUR: 1, GBP: 0 }), "EUR", "GBP")).toBeNull();
  });
});

describe("rebaseFactor", () => {
  test("product of later entries", () => {
    expect(rebaseFactor(history, ms(T1, -1))).toBeCloseTo(0.85 * 1.3);
    expect(rebaseFactor(history, ms(T1, 1))).toBeCloseTo(1.3);
    expect(rebaseFactor(history, ms(T2, 1))).toBe(1);
    expect(rebaseFactor([], T1)).toBe(1);
  });
  test("creation entry contributes nothing", () => {
    expect(rebaseFactor([{ from: "2026-10-14", at: T1, currency: "EUR" }], ms(T1, -1))).toBe(1);
  });
});

describe("rebaseSnapshots", () => {
  const snap = {
    capturedAt: ms(T1, -1000), remainingCost: 1000,
    series: [{ plannedCost: 200, actualCost: null }],
  } as unknown as SnapshotRecord;
  test("scales cost fields, keeps nulls", () => {
    const [r] = rebaseSnapshots([snap], history);
    expect(r.remainingCost).toBeCloseTo(1000 * 0.85 * 1.3);
    expect(r.series[0].plannedCost).toBeCloseTo(200 * 0.85 * 1.3);
    expect(r.series[0].actualCost).toBeNull();
  });
  test("single entry matches brief numbers", () => {
    const [r] = rebaseSnapshots([snap], [history[0]]);
    expect([r.remainingCost, r.series[0].plannedCost]).toEqual([850, 170]);
  });
  test("empty history returns the same array", () => {
    const arr = [snap];
    expect(rebaseSnapshots(arr, [])).toBe(arr);
  });
  test("null remainingCost stays null", () => {
    const [r] = rebaseSnapshots([{ ...snap, remainingCost: null }], history);
    expect(r.remainingCost).toBeNull();
  });
});

describe("rebaseBudgetHistory", () => {
  const e = { at: ms(T1, -1000), projectBacHours: 100, projectBacValue: 10000, deltaHours: -5, deltaValue: -500 } as BudgetHistoryEntry;
  test("scales values, not hours", () => {
    const [r] = rebaseBudgetHistory([e], [history[0]]);
    expect([r.projectBacValue, r.deltaValue]).toEqual([8500, -425]);
    expect([r.projectBacHours, r.deltaHours]).toEqual([100, -5]);
  });
  test("empty history returns the same array", () => {
    const arr = [e];
    expect(rebaseBudgetHistory(arr, [])).toBe(arr);
  });
});

// §476 — a version restore whose plan currency differs from the current one records itself as a
// switch back, so the read-time rebase stays in step with `plan.currency`.
describe("restoreSwitchEntry", () => {
  const NOW = "2026-12-01T09:00:00.000Z";
  const V0 = ms(T1, -60_000); // the version: captured in EUR, before the GBP switch
  test("restoring a pre-switch EUR version after EUR→GBP appends a switch back at 1/0.85", () => {
    const e = restoreSwitchEntry([history[0]], "EUR", "GBP", V0, NOW);
    expect(e).toEqual({ from: "2026-12-01", at: NOW, currency: "EUR", perPrevious: 1 / 0.85 });
  });
  test("…and a snapshot captured before the version rebases to its original value (factor 1)", () => {
    const e = restoreSwitchEntry([history[0]], "EUR", "GBP", V0, NOW);
    const snap = { capturedAt: ms(V0, -1000), remainingCost: 1000, series: [{ plannedCost: 200, actualCost: 50 }] } as unknown as SnapshotRecord;
    const [r] = rebaseSnapshots([snap], [history[0], e as BaselineEntry]);
    expect(r.remainingCost).toBeCloseTo(1000);
    expect(r.series[0].plannedCost).toBeCloseTo(200);
    expect(r.series[0].actualCost).toBeCloseTo(50);
  });
  test("cancels only the switches AFTER the version (two later switches → their product)", () => {
    const e = restoreSwitchEntry(history, "EUR", "USD", V0, NOW);
    expect(e?.perPrevious).toBeCloseTo(1 / (0.85 * 1.3));
  });
  test("the current currency is the latest entry's, not the caller's fallback", () => {
    expect(restoreSwitchEntry([history[0]], "GBP", "EUR", V0, NOW)).toBeNull();
  });
  test("an empty history falls back to the plan's currency", () => {
    expect(restoreSwitchEntry([], "EUR", "EUR", V0, NOW)).toBeNull();
    expect(restoreSwitchEntry([], "GBP", "EUR", V0, NOW)).toEqual({ from: "2026-12-01", at: NOW, currency: "GBP", perPrevious: 1 });
  });
  test("equal currencies append nothing", () => {
    expect(restoreSwitchEntry([history[0]], "GBP", "GBP", ms(T1, 1000), NOW)).toBeNull();
  });
});
