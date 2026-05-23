import type { Absence, PlanGranularity, Resource } from "./types";

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
    out.push({ key: `${y}-${pad(m)}`, start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay)}` });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** ISO-8601 week-numbering year + week for a UTC date. */
function isoWeekParts(d: Date): { year: number; week: number } {
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
    const { year, week } = isoWeekParts(cur);
    out.push({ key: `${year}-W${pad(week)}`, start: iso(cur), end: iso(sun) });
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
