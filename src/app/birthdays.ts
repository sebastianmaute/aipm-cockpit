import type { Resource } from "./types";

export interface UpcomingBirthday {
  resource: Resource;
  /** Whole days from `today` to the next occurrence of the birthday (0 = today). */
  daysUntil: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Resources whose `MM-DD` birthday falls within `[today, today + leadDays]`
 * (inclusive), handling year-wrap (e.g. today 12-30, birthday 01-02). Invalid
 * or missing birthdays are skipped. Sorted by `daysUntil` ascending.
 * `today` is "YYYY-MM-DD"; comparisons are in UTC.
 */
export function getUpcomingBirthdays(
  resources: readonly Resource[],
  today: string,
  leadDays: number,
): UpcomingBirthday[] {
  const base = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(base.valueOf()) || leadDays < 0) return [];
  const baseMs = base.valueOf();
  const year = base.getUTCFullYear();

  const out: UpcomingBirthday[] = [];
  for (const r of resources) {
    const m = (r.birthday ?? "").match(/^(\d{2})-(\d{2})$/);
    if (!m) continue;
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue;
    let occ = Date.UTC(year, mm - 1, dd);
    if (occ < baseMs) occ = Date.UTC(year + 1, mm - 1, dd);
    const daysUntil = Math.round((occ - baseMs) / MS_PER_DAY);
    if (daysUntil >= 0 && daysUntil <= leadDays) out.push({ resource: r, daysUntil });
  }
  out.sort((a, b) => a.daysUntil - b.daysUntil);
  return out;
}
