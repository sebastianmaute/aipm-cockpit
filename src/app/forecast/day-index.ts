/** Simulated working days as dates, and dates as simulated days, for dated scenario changes (§502). */

import { addCalendarDays, isWorkingDay } from "../working-days";

/** Index 0 = today, index i = the i-th working day after today (weekends + holidaySet off), length horizon + 1. */
export function simulatedDates(today: string, horizon: number, holidaySet: ReadonlySet<string>): string[] {
  const out = [today];
  let d = today;
  while (out.length <= horizon) {
    d = addCalendarDays(d, 1);
    if (isWorkingDay(d, holidaySet)) out.push(d);
  }
  return out;
}

/** The first index in [1, dates.length) whose date satisfies `isAfter`, or dates.length; dates are ascending. */
function firstFrom1(dates: readonly string[], isAfter: (date: string) => boolean): number {
  let lo = 1;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (isAfter(dates[mid])) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * 0 for a date on or before today; else the first index whose date ≥ iso; dates.length when past the last date
 * (no simulated day — a window starting there is empty; a scope arrival there is clamped to the horizon).
 */
export function dayOnOrAfter(dates: readonly string[], iso: string): number {
  if (dates.length === 0 || iso <= dates[0]) return 0;
  return firstFrom1(dates, (date) => date >= iso);
}

/** The last index whose date ≤ iso; 0 before day 1. */
export function dayOnOrBefore(dates: readonly string[], iso: string): number {
  if (dates.length === 0) return 0;
  return firstFrom1(dates, (date) => date > iso) - 1;
}
