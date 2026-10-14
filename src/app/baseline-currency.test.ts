import { describe, expect, test } from "vitest";
import {
  crossRate, laterSwitchRates, rebaseBudgetHistory, rebaseFactor, rebaseSnapshots, sanitizeBaselineHistory,
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
  // §476 pre-merge — a perPrevious outside [1e-4, 1e4] is no FX rate; one such entry would push
  // `rebaseFactor` to Infinity or 0 for every record before it.
  test("drops a perPrevious outside [1e-4, 1e4] and keeps a real one (INR, 105)", () => {
    expect(sanitizeBaselineHistory([{ ...good, perPrevious: 1e200 }, { ...good, perPrevious: 1e-9 }])).toEqual([]);
    expect(sanitizeBaselineHistory([{ ...good, currency: "INR", perPrevious: 105 }])).toEqual([{ ...good, currency: "INR", perPrevious: 105 }]);
    expect(sanitizeBaselineHistory([{ ...good, perPrevious: 1e-4 }, { ...good, at: T2, perPrevious: 1e4 }])).toHaveLength(2); // the bounds are inclusive
  });
  // B1 — `at` must be exactly `toISOString()` output: ms precision and a Z suffix.
  test("drops an at without milliseconds and one with an offset", () => {
    expect(sanitizeBaselineHistory([
      { ...good, at: "2026-10-14T09:00:00Z" },
      { ...good, at: "2026-10-14T09:00:00.000+02:00" },
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
  // B1 — a three-switch chain, EUR→GBP→USD→EUR: every switch strictly later than the record.
  const T3 = "2026-11-20T09:00:00.000Z";
  const three: BaselineEntry[] = [...history, { from: "2026-11-20", at: T3, currency: "EUR", perPrevious: 0.9 }];
  test("a three-switch chain multiplies every later switch, and drops each as the record passes it", () => {
    expect(rebaseFactor(three, ms(T1, -1))).toBeCloseTo(0.85 * 1.3 * 0.9, 12);
    expect(rebaseFactor(three, ms(T2, -1))).toBeCloseTo(1.3 * 0.9, 12);
    expect(rebaseFactor(three, ms(T3, -1))).toBeCloseTo(0.9, 12);
    expect(rebaseFactor(three, T3)).toBe(1);
    expect(laterSwitchRates(three, ms(T1, -1))).toEqual([0.85, 1.3, 0.9]);
  });
  test("a record stamped AT a switch is not converted by it (strict >)", () => {
    expect(rebaseFactor(history, T1)).toBeCloseTo(1.3, 12);
    expect(rebaseFactor(history, T2)).toBe(1);
    expect(laterSwitchRates(history, T1)).toEqual([1.3]);
  });
  test("laterSwitchRates orders by at, whatever the input order, and skips a creation entry", () => {
    expect(laterSwitchRates([history[1], { from: "2026-10-01", at: ms(T1, -5), currency: "EUR" }, history[0]], ms(T1, -10))).toEqual([0.85, 1.3]);
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
