/**
 * Daily forecast history (§502). Pure, i18n-free and DOM-free.
 * One entry per day the simulation was on: the P50/P80/P95 finish dates and the
 * chance of finishing on time, so a later reader can compare today's forecast
 * with an earlier one. Storage-only meta-blob slice (`Workspace.forecastHistory`).
 */
import { isValidIsoDate } from "./forecast/throughput";

export type ForecastHistoryEntry = {
  date: string; // YYYY-MM-DD, the day it was computed
  p50: string | null; // finish date; null = beyond the horizon
  p80: string | null;
  p95: string | null;
  chanceOnTime: number | null; // 0..1; null = no valid plan end
};

function sanitizeFinish(v: unknown): string | null | undefined {
  if (v === null) return null;
  return typeof v === "string" && isValidIsoDate(v) ? v : undefined;
}

function sanitizeEntry(input: unknown): ForecastHistoryEntry | null {
  if (!input || typeof input !== "object") return null;
  const e = input as Record<string, unknown>;
  if (typeof e.date !== "string" || !isValidIsoDate(e.date)) return null;
  const p50 = sanitizeFinish(e.p50);
  const p80 = sanitizeFinish(e.p80);
  const p95 = sanitizeFinish(e.p95);
  if (p50 === undefined || p80 === undefined || p95 === undefined) return null;
  const c = e.chanceOnTime;
  if (c !== null && !(typeof c === "number" && c >= 0 && c <= 1)) return null;
  return { date: e.date, p50, p80, p95, chanceOnTime: c };
}

const byDate = (a: ForecastHistoryEntry, b: ForecastHistoryEntry): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

/** Drops malformed entries, keeps the LAST entry per date, sorts by date ascending. */
export function sanitizeForecastHistory(raw: unknown): ForecastHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const byDay = new Map<string, ForecastHistoryEntry>();
  for (const item of raw) {
    const entry = sanitizeEntry(item);
    if (entry) byDay.set(entry.date, entry);
  }
  return [...byDay.values()].sort(byDate);
}

/** Returns a new history with `entry` replacing any entry of the same date, sorted by date. */
export function upsertForecastHistory(
  history: readonly ForecastHistoryEntry[],
  entry: ForecastHistoryEntry,
): ForecastHistoryEntry[] {
  return [...history.filter((h) => h.date !== entry.date), entry].sort(byDate);
}

/** The latest entry whose date is on or before `date`, else null. */
export function entryOnOrBefore(history: readonly ForecastHistoryEntry[], date: string): ForecastHistoryEntry | null {
  let best: ForecastHistoryEntry | null = null;
  for (const h of history) {
    if (h.date <= date && (best === null || h.date > best.date)) best = h;
  }
  return best;
}
