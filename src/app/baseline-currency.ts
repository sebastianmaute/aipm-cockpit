/**
 * Project baseline-currency history (§476). Pure, i18n-free and DOM-free.
 * Each entry records the currency a project switched TO and `perPrevious`, the
 * units of that currency per 1 unit of the previous baseline. Stored history
 * (snapshots, budget history) stays in the currency it was captured in; the
 * read-time rebase multiplies it by every later switch's rate.
 */
import { sanitizeIsoDate } from "./sanitize-core";
import { isBudgetCurrency, type BudgetCurrency, type FxRates } from "./types";
import type { SnapshotRecord } from "./snapshot";
import type { BudgetHistoryEntry } from "./budget-history";

export type BaselineEntry = {
  from: string; // YYYY-MM-DD
  at: string; // ISO ms
  currency: BudgetCurrency;
  perPrevious?: number; // absent on a creation entry
};

const PER_PREVIOUS_MIN = 1e-4;
const PER_PREVIOUS_MAX = 1e4;
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function sanitizeEntry(input: unknown): BaselineEntry | null {
  if (!input || typeof input !== "object") return null;
  const e = input as Record<string, unknown>;
  const from = typeof e.from === "string" ? sanitizeIsoDate(e.from) : "";
  if (!from) return null;
  if (typeof e.at !== "string" || !ISO_MS.test(e.at) || Number.isNaN(Date.parse(e.at))) return null;
  if (!isBudgetCurrency(e.currency)) return null;
  if (e.perPrevious === undefined) return { from, at: e.at, currency: e.currency };
  // §476 — no real cross rate between the four currencies leaves [1e-4, 1e4]; outside it, one
  // entry would push `rebaseFactor` to Infinity or 0 for every record before it.
  if (typeof e.perPrevious !== "number" || !(e.perPrevious >= PER_PREVIOUS_MIN && e.perPrevious <= PER_PREVIOUS_MAX)) return null;
  return { from, at: e.at, currency: e.currency, perPrevious: e.perPrevious };
}

export function sanitizeBaselineHistory(input: unknown): BaselineEntry[] {
  if (!Array.isArray(input)) return [];
  return input
    .map(sanitizeEntry)
    .filter((e): e is BaselineEntry => e !== null)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

function eurPer(fx: FxRates, c: BudgetCurrency): number | null {
  if (c === "EUR") return 1;
  const r = fx.rates[c];
  return typeof r === "number" && Number.isFinite(r) && r > 0 ? r : null;
}

/** Units of `to` per 1 `from`, via the EUR-based table. */
export function crossRate(fx: FxRates, from: BudgetCurrency, to: BudgetCurrency): number | null {
  if (from === to) return 1;
  const f = eurPer(fx, from);
  const t = eurPer(fx, to);
  return f === null || t === null ? null : t / f;
}

/** Product of every later switch's `perPrevious` (entries with `at > atIso`). */
export function rebaseFactor(history: readonly BaselineEntry[], atIso: string): number {
  let factor = 1;
  for (const e of history) {
    if (e.at > atIso && e.perPrevious !== undefined) factor *= e.perPrevious;
  }
  return factor;
}

/**
 * Every later switch's `perPrevious` (entries with `at > atIso`), in the order they were
 * made. A RESTORE converts through these one at a time, rounding at each step exactly as
 * the successive switches did (§476 A4); `rebaseFactor` is their product, for the
 * unrounded read-time rebase of snapshots and budget history.
 */
export function laterSwitchRates(history: readonly BaselineEntry[], atIso: string): number[] {
  return [...history]
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .filter((e) => e.at > atIso && e.perPrevious !== undefined)
    .map((e) => e.perPrevious as number);
}

/** A cross rate rounded to 6 decimals, as the activity log records it (§476). */
export const roundRate = (rate: number): number => Math.round(rate * 1e6) / 1e6;

const scale = (v: number | null, f: number): number | null => (v === null ? null : v * f);

export function rebaseSnapshots(
  snaps: readonly SnapshotRecord[],
  history: readonly BaselineEntry[],
): SnapshotRecord[] {
  if (history.length === 0) return snaps as SnapshotRecord[];
  return snaps.map((s) => {
    const f = rebaseFactor(history, s.capturedAt);
    if (f === 1) return s;
    return {
      ...s,
      remainingCost: scale(s.remainingCost, f),
      series: s.series.map((p) => ({
        ...p,
        plannedCost: p.plannedCost * f,
        actualCost: scale(p.actualCost, f),
      })),
    };
  });
}

export function rebaseBudgetHistory(
  entries: readonly BudgetHistoryEntry[],
  history: readonly BaselineEntry[],
): readonly BudgetHistoryEntry[] {
  if (history.length === 0) return entries;
  return entries.map((e) => {
    const f = rebaseFactor(history, e.at);
    if (f === 1) return e;
    return { ...e, projectBacValue: e.projectBacValue * f, deltaValue: e.deltaValue * f };
  });
}
