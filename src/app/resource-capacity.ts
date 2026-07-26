import type { Absence, PlanGranularity, Resource } from "./types";
import { resourceDisplayName } from "./resource-foundation";

/** A planning period. Dates are inclusive "YYYY-MM-DD". */
export type Period = { key: string; start: string; end: string };

const pad = (n: number) => String(n).padStart(2, "0");

function monthPeriods(startDate: string, endDate: string): Period[] {
  const out: Period[] = [];
  let y = Number(startDate.slice(0, 4));
  let m = Number(startDate.slice(5, 7)); // 1-based
  const endY = Number(endDate.slice(0, 4));
  const endM = Number(endDate.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const start = `${y}-${pad(m)}-01`;
    out.push({ key: periodKeyForDate(start, "month"), start, end: `${y}-${pad(m)}-${pad(lastDay)}` });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** ISO-8601 week-numbering year + week for a UTC date. Exported for the
 *  calendar's week band — do NOT write a second implementation, the
 *  periodKeyForDate contract below depends on this being the only one. */
export function isoWeekParts(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  t.setUTCDate(t.getUTCDate() - day + 3); // nearest Thursday
  const isoYear = t.getUTCFullYear();
  const firstThu = new Date(Date.UTC(isoYear, 0, 4));
  const firstThuDay = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstThuDay + 3);
  const week = 1 + Math.round((t.getTime() - firstThu.getTime()) / (7 * 86400000));
  return { year: isoYear, week };
}

/**
 * The period key that `generatePeriods` would assign to the period containing
 * `dateISO`. This is the canonical mapping function — `generatePeriods` uses
 * it internally so the two code paths CANNOT drift.
 *   month → "YYYY-MM"
 *   week  → "YYYY-Www" (ISO-8601 week)
 */
export function periodKeyForDate(dateISO: string, granularity: PlanGranularity): string {
  if (granularity === "month") {
    return dateISO.slice(0, 7); // "YYYY-MM"
  }
  const { year, week } = isoWeekParts(new Date(`${dateISO}T00:00:00Z`));
  return `${year}-W${pad(week)}`;
}

function mondayOf(d: Date): Date {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day);
  return t;
}

function iso(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function weekPeriods(startDate: string, endDate: string): Period[] {
  const out: Period[] = [];
  let cur = mondayOf(new Date(`${startDate}T00:00:00Z`));
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cur <= end) {
    const sun = new Date(cur);
    sun.setUTCDate(sun.getUTCDate() + 6);
    const start = iso(cur);
    out.push({ key: periodKeyForDate(start, "week"), start, end: iso(sun) });
    cur = new Date(cur);
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return out;
}

export function generatePeriods(
  startDate: string,
  endDate: string,
  granularity: PlanGranularity,
): Period[] {
  if (startDate > endDate) return [];
  return granularity === "week" ? weekPeriods(startDate, endDate) : monthPeriods(startDate, endDate);
}

function isWorkday(d: Date, holidaySet: ReadonlySet<string>): boolean {
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !holidaySet.has(iso(d));
}

/** Count Mon–Fri dates in [start,end] inclusive that are not holidays. */
export function workdaysInRange(start: string, end: string, holidaySet: ReadonlySet<string>): number {
  if (start > end) return 0;
  let count = 0;
  const cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cur <= last) {
    if (isWorkday(cur, holidaySet)) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/** A resource's absences: by resourceId when set, else case-folded name match. */
export function absencesForResource(absences: readonly Absence[], resource: Resource): Absence[] {
  const nameKey = resourceDisplayName(resource).toLowerCase();
  return absences.filter((a) =>
    a.resourceId != null ? a.resourceId === resource.id : a.assignee.trim().toLowerCase() === nameKey,
  );
}

/** Workdays within [periodStart,periodEnd] that fall inside any absence range. */
export function absenceWorkdays(
  resourceAbsences: readonly Absence[],
  periodStart: string,
  periodEnd: string,
  holidaySet: ReadonlySet<string>,
): number {
  if (resourceAbsences.length === 0 || periodStart > periodEnd) return 0;
  let count = 0;
  const cur = new Date(`${periodStart}T00:00:00Z`);
  const last = new Date(`${periodEnd}T00:00:00Z`);
  while (cur <= last) {
    if (isWorkday(cur, holidaySet)) {
      const d = iso(cur);
      if (resourceAbsences.some((a) => a.startDate <= d && d <= a.endDate)) count++;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/**
 * Capacity (hours) for a (resource, period):
 *   workdays      = Mon–Fri in period, minus holidays
 *   possibleHours = workdays × workdayHours
 *   absenceHours  = absenceOverride[key] if set, else (absence workdays × workdayHours)
 *   percent mode: (util/100) × max(0, possibleHours − absenceHours)
 *   hours   mode: max(0, util − absenceHours)
 * `resourceAbsences` must already be filtered to this resource (use absencesForResource).
 */
export function periodCapacityHours(
  resource: Resource,
  period: Period,
  resourceAbsences: readonly Absence[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
): number {
  const workdays = workdaysInRange(period.start, period.end, holidaySet);
  const possibleHours = workdays * workdayHours;
  const override = resource.absenceOverride?.[period.key];
  const absenceHours = override != null
    ? override
    : absenceWorkdays(resourceAbsences, period.start, period.end, holidaySet) * workdayHours;
  const util = resource.utilization[period.key] ?? 0;
  if (resource.utilizationMode === "percent") {
    return (util / 100) * Math.max(0, possibleHours - absenceHours);
  }
  return Math.max(0, util - absenceHours);
}

/**
 * Convert a utilization map between percent and hours, per period.
 * `possible` = gross working hours (workdays × workdayHours, holidays excluded);
 * absence is intentionally NOT subtracted (hours-mode subtracts it in its own
 * capacity formula, so a net factor would double-count and not round-trip).
 * Keys without a matching period are left unchanged. Same-mode returns input.
 */
export function convertUtilization(
  util: Record<string, number>,
  fromMode: "percent" | "hours",
  toMode: "percent" | "hours",
  periods: readonly Period[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
): Record<string, number> {
  if (fromMode === toMode) return util;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(util)) {
    const period = periods.find((p) => p.key === key);
    if (!period) {
      out[key] = value;
      continue;
    }
    const possible = workdaysInRange(period.start, period.end, holidaySet) * workdayHours;
    out[key] =
      toMode === "hours"
        ? Math.round((value / 100) * possible)
        : possible > 0
          ? Math.round((value / possible) * 100)
          : 0;
  }
  return out;
}

/**
 * Capacity (hours) for a DISPLAY period, given the resource's CANONICAL periods.
 *   - display === canonical granularity → the period's own stored utilization.
 *   - coarse→fine (canonical month, display week): the fine period borrows the
 *     utilization VALUE of the canonical period containing its start date, and
 *     computes capacity over the fine period's own workdays/absence.
 *   - fine→coarse (canonical week, display month): sum capacity of canonical
 *     periods whose start date falls within the display period.
 */
export function displayCapacityHours(
  displayPeriod: Period,
  canonicalPeriods: readonly Period[],
  resource: Resource,
  resourceAbsences: readonly Absence[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
  canonicalGranularity: PlanGranularity,
  displayGranularity: PlanGranularity,
): number {
  if (canonicalGranularity === displayGranularity) {
    return periodCapacityHours(resource, displayPeriod, resourceAbsences, workdayHours, holidaySet);
  }
  // fine→coarse: sum canonical periods that start within the display period.
  if (canonicalGranularity === "week" && displayGranularity === "month") {
    let sum = 0;
    for (const c of canonicalPeriods) {
      if (c.start >= displayPeriod.start && c.start <= displayPeriod.end) {
        sum += periodCapacityHours(resource, c, resourceAbsences, workdayHours, holidaySet);
      }
    }
    return sum;
  }
  // coarse→fine: borrow the containing canonical period's utilization VALUE.
  const owner = canonicalPeriods.find((c) => c.start <= displayPeriod.start && displayPeriod.start <= c.end);
  const borrowedUtil = owner ? (resource.utilization[owner.key] ?? 0) : 0;
  const borrowed: Resource = { ...resource, utilization: { [displayPeriod.key]: borrowedUtil } };
  return periodCapacityHours(borrowed, displayPeriod, resourceAbsences, workdayHours, holidaySet);
}
