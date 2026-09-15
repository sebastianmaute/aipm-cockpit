/**
 * UTC working-day stepping for the budget forecast (spec §5.2). A working day is
 * Monday–Friday and not in `holidaySet` — the same rule `workdaysInRange`
 * (`resource-capacity.ts`) counts with. Every date is an ISO `YYYY-MM-DD` string
 * read and written in UTC, so no local timezone can shift a day.
 */

const DAY_MS = 86_400_000;

function toUtcMs(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addCalendarDays(iso: string, n: number): string {
  return fromUtcMs(toUtcMs(iso) + n * DAY_MS);
}

export function calendarDaysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

export function isWorkingDay(iso: string, holidaySet: ReadonlySet<string>): boolean {
  const dow = new Date(toUtcMs(iso)).getUTCDay();
  return dow !== 0 && dow !== 6 && !holidaySet.has(iso);
}

/** The `count` working days strictly before `today`, ascending. */
export function workingDaysBefore(today: string, count: number, holidaySet: ReadonlySet<string>): string[] {
  const out: string[] = [];
  let d = today;
  while (out.length < count) {
    d = addCalendarDays(d, -1);
    if (isWorkingDay(d, holidaySet)) out.push(d);
  }
  return out.reverse();
}

/** The n-th working day strictly after `from` (n ≥ 1). */
export function nthWorkingDayAfter(from: string, n: number, holidaySet: ReadonlySet<string>): string {
  let d = from;
  let seen = 0;
  while (seen < n) {
    d = addCalendarDays(d, 1);
    if (isWorkingDay(d, holidaySet)) seen += 1;
  }
  return d;
}

/** Working days in [startInclusive, endExclusive); 0 when end ≤ start. */
export function countWorkingDays(startInclusive: string, endExclusive: string, holidaySet: ReadonlySet<string>): number {
  let n = 0;
  for (let d = startInclusive; d < endExclusive; d = addCalendarDays(d, 1)) {
    if (isWorkingDay(d, holidaySet)) n += 1;
  }
  return n;
}

/** Working days in [start, end] inclusive, ascending. */
export function workingDaysInRange(start: string, end: string, holidaySet: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addCalendarDays(d, 1)) {
    if (isWorkingDay(d, holidaySet)) out.push(d);
  }
  return out;
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const WEEK_RE = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;

/** Inclusive calendar bounds of a month (`YYYY-MM`) or ISO week (`YYYY-Www`) key; null for anything else. */
export function periodBounds(periodKey: string): { start: string; end: string } | null {
  const m = MONTH_RE.exec(periodKey);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return { start: fromUtcMs(Date.UTC(y, mo - 1, 1)), end: fromUtcMs(Date.UTC(y, mo, 0)) };
  }
  const w = WEEK_RE.exec(periodKey);
  if (w) {
    // ISO week 1 is the week holding 4 January; weeks start on Monday.
    const jan4 = Date.UTC(Number(w[1]), 0, 4);
    const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7; // Monday = 0
    const start = jan4 - jan4Dow * DAY_MS + (Number(w[2]) - 1) * 7 * DAY_MS;
    return { start: fromUtcMs(start), end: fromUtcMs(start + 6 * DAY_MS) };
  }
  return null;
}
