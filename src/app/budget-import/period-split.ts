import { generatePeriods, workdaysInRange } from "../resource-capacity";
import type { Period } from "../resource-capacity";
import type { PlanGranularity } from "../types";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const WEEK_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const DAY_MS = 86_400_000;

export type PeriodShare = { key: string; hours: number };

function granularityOf(period: string): PlanGranularity {
  if (MONTH_RE.test(period)) return "month";
  if (WEEK_RE.test(period)) return "week";
  throw new Error("bad-period");
}

/** The dates a canonical period covers. Looked up through `generatePeriods`, so
 *  the key <-> dates mapping is the planner's own and cannot drift from it. */
function boundsOf(period: string, granularity: PlanGranularity): Period {
  const year = period.slice(0, 4);
  const found =
    granularity === "month"
      ? generatePeriods(`${period}-01`, `${period}-01`, "month")
      : generatePeriods(`${year}-01-01`, `${year}-12-31`, "week").filter((p) => p.key === period);
  const bounds = found[0];
  if (!bounds || bounds.key !== period) throw new Error("bad-period");
  return bounds;
}

/** The dates a canonical sheet period ("YYYY-MM" or "YYYY-Www") covers. */
export function sourcePeriodBounds(period: string): Period {
  return boundsOf(period, granularityOf(period));
}

function calendarDays(start: string, end: string): number {
  if (start > end) return 0;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1;
}

/** Hours to whole cents. The epsilon makes a decimal tie such as 1.005 (stored
 *  as 1.00499...) round up like the figure the user typed. */
function toCents(hours: number): number {
  return Math.round((hours + Number.EPSILON) * 100);
}

/** Cent shares for weights, rounded one by one; the remainder goes to the LAST
 *  entry. If rounding up earlier shares would push the last below zero, the
 *  deficit is taken from the largest earlier shares instead. */
function distributeCents(totalCents: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const shares = weights.map((w) => Math.round((totalCents * w) / weightSum));
  const lastIndex = shares.length - 1;
  const earlier = shares.slice(0, lastIndex);
  const remainder = totalCents - earlier.reduce((s, c) => s + c, 0);
  if (remainder >= 0) return [...earlier, remainder];

  let deficit = -remainder;
  const adjusted = [...earlier];
  while (deficit > 0) {
    const largest = adjusted.reduce((best, c, i) => (c > adjusted[best] ? i : best), 0);
    const take = Math.min(deficit, adjusted[largest]);
    if (take <= 0) break;
    adjusted[largest] -= take;
    deficit -= take;
  }
  return [...adjusted, 0];
}

/**
 * Converts a sheet period's hours into the plan's granularity, weighting by
 * working days (Mon-Fri, not in `holidaySet`) so the imported total survives
 * exactly. `period` must already be canonical ("YYYY-MM" or "YYYY-Www").
 */
export function splitToGranularity(
  period: string,
  hours: number,
  target: PlanGranularity,
  holidaySet: ReadonlySet<string>,
): PeriodShare[] {
  const source = granularityOf(period);
  const bounds = boundsOf(period, source);
  const totalCents = toCents(hours);
  if (source === target) return [{ key: period, hours: totalCents / 100 }];

  const targets = generatePeriods(bounds.start, bounds.end, target);
  const clipped = targets.map((t) => ({
    key: t.key,
    start: t.start > bounds.start ? t.start : bounds.start,
    end: t.end < bounds.end ? t.end : bounds.end,
  }));
  const workdays = clipped.map((c) => workdaysInRange(c.start, c.end, holidaySet));
  const hasWorkdays = workdays.some((n) => n > 0);
  const weights = hasWorkdays ? workdays : clipped.map((c) => calendarDays(c.start, c.end));

  const kept = clipped.map((c, i) => ({ key: c.key, weight: weights[i] })).filter((c) => c.weight > 0);
  // A deliberate zero clears every target the source actually covers, never a
  // boundary period that only holds a weekend day of it.
  if (totalCents === 0) return kept.map((c) => ({ key: c.key, hours: 0 }));
  const cents = distributeCents(
    totalCents,
    kept.map((c) => c.weight),
  );
  return kept.map((c, i) => ({ key: c.key, hours: cents[i] / 100 }));
}
