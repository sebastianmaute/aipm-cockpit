// Pure, i18n-free. Moves every date in a workspace by n plan periods — used to
// keep the demo project "live" relative to today. The walk is GENERIC (any
// date-shaped string value or key), so a field added later is shifted without
// touching this module; the discovery test in the .test file enforces that.
import { periodKeyForDate } from "./resource-capacity";
import type { PlanGranularity } from "./types";
import type { Workspace } from "./workspace";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})(T.*)$/;
const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const WEEK_KEY = /^(\d{4})-W(\d{2})$/;
const DAY_MS = 86_400_000;

function toUtc(iso: string): Date { return new Date(`${iso}T00:00:00Z`); }
function fromUtc(d: Date): string { return d.toISOString().slice(0, 10); }
function pad2(x: number): string { return String(x).padStart(2, "0"); }

/** Target {year, 0-based month} for `iso` moved by `n` calendar months. */
function targetYearMonth(iso: string, n: number): [number, number] {
  const [y, m] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  return [ny, total - ny * 12];
}
function lastDayOfMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}
function addMonths(iso: string, n: number): string {
  const d = Number(iso.slice(8, 10));
  const [ny, nm] = targetYearMonth(iso, n);
  return fromUtc(new Date(Date.UTC(ny, nm, Math.min(d, lastDayOfMonth(ny, nm)))));
}
function addDays(iso: string, days: number): string { return fromUtc(new Date(toUtc(iso).getTime() + days * DAY_MS)); }
function isFirstOfMonth(iso: string): boolean { return iso.slice(8, 10) === "01"; }
function isLastOfMonth(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  return d === lastDayOfMonth(y, m - 1);
}
/** 1st or last day of the target month that `iso` (itself a 1st/last-of-month
 *  date) moves to under an `n`-month shift — computed directly, never via
 *  `addMonths`' day-clamp, which can land short of the target's OWN last day
 *  (e.g. Feb 28 clamped into a 31-day March gives 31-03-28, not 31-03-31). */
function monthBoundary(iso: string, n: number, wantLast: boolean): string {
  const [ny, nm] = targetYearMonth(iso, n);
  return `${ny}-${pad2(nm + 1)}-${pad2(wantLast ? lastDayOfMonth(ny, nm) : 1)}`;
}
function rollToWeekday(iso: string): string {
  const dow = toUtc(iso).getUTCDay(); // 0 Sun … 6 Sat
  return dow === 6 ? addDays(iso, 2) : dow === 0 ? addDays(iso, 1) : iso;
}
function mondayOf(iso: string): string {
  const dow = toUtc(iso).getUTCDay();
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}
/** Monday of ISO week `week` of ISO year `year` (week 1 holds Jan 4th). */
function isoWeekMonday(year: number, week: number): string {
  return addDays(mondayOf(`${year}-01-04`), (week - 1) * 7);
}

function shiftDate(iso: string, n: number, unit: PlanGranularity, roll: boolean): string {
  if (unit === "week") return addDays(iso, 7 * n);
  // Month-boundary date-only values (the 1st or the last day of their month)
  // stay on the SAME boundary of the target month and are never weekend-rolled
  // — rolling a bucket's 1st-of-month startDate off the 1st desyncs it from
  // `bucketActivePeriods`, which compares against a period's `start`, always
  // the 1st (controller ruling, budget-report.ts §bucketActivePeriods).
  if (roll && isFirstOfMonth(iso)) return monthBoundary(iso, n, false);
  if (roll && isLastOfMonth(iso)) return monthBoundary(iso, n, true);
  const moved = addMonths(iso, n);
  return roll ? rollToWeekday(moved) : moved;
}

function shiftKey(key: string, n: number, unit: PlanGranularity): string {
  if (DATE_ONLY.test(key)) return shiftDate(key, n, unit, true);
  const m = MONTH_KEY.exec(key);
  if (m) return addMonths(`${m[1]}-${m[2]}-01`, n).slice(0, 7);
  const w = WEEK_KEY.exec(key);
  if (w) return periodKeyForDate(addDays(isoWeekMonday(Number(w[1]), Number(w[2])), 7 * n), "week");
  return key;
}

function walk(v: unknown, n: number, unit: PlanGranularity): unknown {
  if (typeof v === "string") {
    if (DATE_ONLY.test(v)) return shiftDate(v, n, unit, true);
    const ts = TIMESTAMP.exec(v);
    return ts ? shiftDate(ts[1], n, unit, false) + ts[2] : v;
  }
  if (Array.isArray(v)) return v.map((x) => walk(x, n, unit));
  if (!v || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    const nk = shiftKey(k, n, unit);
    const nv = walk(x, n, unit);
    if (nk in out) {
      const prev = out[nk];
      if (typeof prev !== "number" || typeof nv !== "number") {
        throw new Error(`shiftWorkspaceDates: non-numeric collision on key ${nk}`);
      }
      out[nk] = prev + nv;
    } else {
      out[nk] = nv;
    }
  }
  return out;
}

export function shiftWorkspaceDates(ws: Workspace, n: number): Workspace {
  if (n === 0) return structuredClone(ws);
  return walk(ws, n, ws.plan.granularity) as Workspace;
}

export function demoShiftFor(asOf: string, today: string, granularity: PlanGranularity): number {
  if (granularity === "week") {
    return Math.round((toUtc(mondayOf(today)).getTime() - toUtc(mondayOf(asOf)).getTime()) / (7 * DAY_MS));
  }
  const [ay, am] = asOf.split("-").map(Number);
  const [ty, tm] = today.split("-").map(Number);
  return (ty * 12 + tm) - (ay * 12 + am);
}
