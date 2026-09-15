// src/app/actual-hours.ts — pure, i18n-free reads of an allocation's `actualHours`.
//
// A BucketAllocation / DisciplineAllocation `actualHours` map holds TWO key
// shapes side by side: a plan PERIOD key ("YYYY-MM" month, "YYYY-Www" ISO week)
// written by a hand edit, and a DAY key ("YYYY-MM-DD") written by TimeLog Apply.
// Every reader asks "how many actual hours fall in this period", and this module
// is the one place that answers it. The period's granularity is read off the
// period key's own shape, so no caller has to thread the plan granularity.
//
// ★★ Maps are replaced, never mutated (functional setters), so a per-map cache
// keyed by object identity is safe and makes repeated period lookups O(1) after
// the first.

import { periodKeyForDate } from "./resource-capacity";
import type { PlanGranularity } from "./types";

export const DAY_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const WEEK_KEY_RE = /^\d{4}-(W[0-4]\d|W5[0-3])$/;

type HoursMap = Readonly<Record<string, number>>;
type PeriodTotals = { totals: Record<string, number>; withDays: Set<string> };

const cache = new WeakMap<HoursMap, Map<PlanGranularity, PeriodTotals>>();

export function isDayKey(key: string): boolean {
  return DAY_KEY_RE.test(key);
}

export function granularityOfPeriodKey(key: string): PlanGranularity | null {
  if (MONTH_KEY_RE.test(key)) return "month";
  if (WEEK_KEY_RE.test(key)) return "week";
  return null;
}

function totalsFor(map: HoursMap, granularity: PlanGranularity): PeriodTotals {
  let byGranularity = cache.get(map);
  if (!byGranularity) {
    byGranularity = new Map();
    cache.set(map, byGranularity);
  }
  const hit = byGranularity.get(granularity);
  if (hit) return hit;
  const totals: Record<string, number> = {};
  const withDays = new Set<string>();
  for (const [key, hours] of Object.entries(map)) {
    if (!Number.isFinite(hours)) continue;
    if (isDayKey(key)) {
      const pk = periodKeyForDate(key, granularity);
      totals[pk] = (totals[pk] ?? 0) + hours;
      withDays.add(pk);
    } else if (granularityOfPeriodKey(key) === granularity) {
      totals[key] = (totals[key] ?? 0) + hours;
    }
  }
  const computed = { totals, withDays };
  byGranularity.set(granularity, computed);
  return computed;
}

/** Hours in the period: its own period key plus every day key inside it; 0 when none. */
export function actualHoursIn(map: HoursMap, periodKey: string): number {
  return actualHoursAt(map, periodKey) ?? 0;
}

/** Like `actualHoursIn`, but `undefined` when the period holds no key at all —
 *  so an editable cell can keep rendering blank rather than "0". */
export function actualHoursAt(map: HoursMap, periodKey: string): number | undefined {
  const granularity = granularityOfPeriodKey(periodKey);
  if (granularity === null) return undefined;
  return totalsFor(map, granularity).totals[periodKey];
}

/** True when at least one DAY key falls inside the period. */
export function hasDayKeysIn(map: HoursMap, periodKey: string): boolean {
  const granularity = granularityOfPeriodKey(periodKey);
  if (granularity === null) return false;
  return totalsFor(map, granularity).withDays.has(periodKey);
}

/** A copy without the period key and without every day key inside the period. */
export function withoutPeriod(map: HoursMap, periodKey: string): Record<string, number> {
  const granularity = granularityOfPeriodKey(periodKey);
  const out: Record<string, number> = {};
  for (const [key, hours] of Object.entries(map)) {
    if (key === periodKey) continue;
    if (granularity !== null && isDayKey(key) && periodKeyForDate(key, granularity) === periodKey) continue;
    out[key] = hours;
  }
  return out;
}
