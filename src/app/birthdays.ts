import type { Resource, Absence } from "./types";
import { shiftToWorkingDay, absenceDayMap, isoAddDays } from "./due-dates";
import { resourceDisplayName } from "./resource-foundation";

/** Extract the "MM-DD" slice from "MM-DD" or "YYYY-MM-DD"; null if missing/invalid. */
export function birthdayMonthDay(b?: string): string | null {
  if (!b) return null;
  const m = b.match(/^(?:\d{4}-)?(\d{2})-(\d{2})$/);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${m[1]}-${m[2]}`;
}

/** True when the birthday carries a year ("YYYY-MM-DD"). */
export function birthdayHasYear(b?: string): boolean {
  return !!b && /^\d{4}-\d{2}-\d{2}$/.test(b);
}

export interface UpcomingBirthday {
  resource: Resource;
  /** Whole days from `today` to the next occurrence of the birthday (0 = today). */
  daysUntil: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Resources whose `MM-DD` birthday's working-day-shifted reminder trigger has
 * been reached. Trigger = shiftToWorkingDay(eventDate − leadDays). Handles
 * year-wrap (e.g. today 12-30, birthday 01-02). Invalid or missing birthdays
 * are skipped. Sorted by `daysUntil` ascending.
 * `today` is "YYYY-MM-DD"; comparisons are in UTC.
 */
export function getUpcomingBirthdays(
  resources: readonly Resource[],
  today: string,
  leadDays: number,
  holidays: ReadonlySet<string>,
  absences: readonly Absence[],
): UpcomingBirthday[] {
  const base = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(base.valueOf()) || leadDays < 0) return [];
  const baseMs = base.valueOf();
  const year = base.getUTCFullYear();
  const absMap = absenceDayMap(absences);
  const EMPTY: ReadonlySet<string> = new Set();
  const out: UpcomingBirthday[] = [];
  for (const r of resources) {
    const md = birthdayMonthDay(r.birthday);
    if (!md) continue;
    const mm = Number(md.slice(0, 2));
    const dd = Number(md.slice(3, 5));
    let occMs = Date.UTC(year, mm - 1, dd);
    if (occMs < baseMs) occMs = Date.UTC(year + 1, mm - 1, dd);
    const eventIso = new Date(occMs).toISOString().slice(0, 10);
    const absenceDays = absMap.get(resourceDisplayName(r).trim().toLowerCase()) ?? EMPTY;
    const trigger = shiftToWorkingDay(isoAddDays(eventIso, -leadDays), holidays, absenceDays);
    if (today >= trigger && today <= eventIso) {
      out.push({ resource: r, daysUntil: Math.round((occMs - baseMs) / MS_PER_DAY) });
    }
  }
  out.sort((a, b) => a.daysUntil - b.daysUntil);
  return out;
}
