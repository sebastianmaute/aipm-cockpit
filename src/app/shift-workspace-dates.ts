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

function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12; // 0-based
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return fromUtc(new Date(Date.UTC(ny, nm, Math.min(d, last))));
}
function addDays(iso: string, days: number): string { return fromUtc(new Date(toUtc(iso).getTime() + days * DAY_MS)); }
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
