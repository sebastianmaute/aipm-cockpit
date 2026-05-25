import type { Resource, Absence } from "./types";
import { shiftToWorkingDay, absenceDayMap, isoAddDays } from "./due-dates";
import { resourceDisplayName } from "./resource-foundation";

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
    const m = (r.birthday ?? "").match(/^(\d{2})-(\d{2})$/);
    if (!m) continue;
    const mm = Number(m[1]); const dd = Number(m[2]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue;
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
