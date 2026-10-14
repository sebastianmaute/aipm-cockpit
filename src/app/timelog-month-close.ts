import type { TimelogRollWindow } from "./timelog-actuals-store";
import { parseDailyKey, type TimelogDailyRoll, type TimelogMonthClose } from "./timelog-types";

/** Closing and reopening TimeLog months (§699). Pure, clock-free and i18n-free:
 *  `today` is passed in and refusals are reason codes the settings panel translates.
 *  ★★ Refuse a correct close rather than save a wrong copy: a month is saved only
 *  when the cached roll provably covers all of it on the close's TimeLog
 *  projects. ★★★ The close is PER PROJECT SET (§699 revision): the panel's
 *  only fetch is by project and records nobody in `dailyUsers` (§366), so a
 *  per-person condition here refused every close. A complete project fetch
 *  returns every booking on its projects, whoever made it, which is what lets
 *  a linked person with no bookings be saved as `{}`. */
export type MonthCloseCache = {
  daily: TimelogDailyRoll | undefined;
  dailyWindow: TimelogRollWindow | undefined;
  partial: boolean | undefined;
  /** The TimeLog projects the roll was fetched over (`ActualsCacheEntry.dailyProjects`). */
  dailyProjects: readonly number[] | undefined;
};

export type MonthCloseRefusal =
  | "no-roll"
  | "not-ended"
  | "window-start"
  | "window-end"
  | "partial"
  | "no-projects"
  | "projects-changed";

export type MonthCloseResult =
  | { ok: true; close: TimelogMonthClose }
  | { ok: false; reason: MonthCloseRefusal; month: string };

function shiftMonth(month: string, delta: number): string {
  const total = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + delta;
  const year = Math.floor(total / 12);
  return `${String(year).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function nextMonth(month: string): string {
  return shiftMonth(month, 1);
}

export function previousMonth(month: string): string {
  return shiftMonth(month, -1);
}

export function lastDayOfMonth(month: string): string {
  const day = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** A project id list as a set: unique and ascending. */
export function projectSet(ids: readonly number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

/** §699 — do two project id lists name the same set? Order and duplicates do
 *  not matter. `undefined` (project scope unknown) never matches. */
export function sameProjectSet(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  const x = projectSet(a);
  const y = projectSet(b);
  return x.length === y.length && x.every((id, i) => id === y[i]);
}

/** The month the next close would cover. An existing close wins over `firstMonth`. */
export function monthToClose(close: TimelogMonthClose | undefined, firstMonth: string): string {
  return close ? nextMonth(close.through) : firstMonth;
}

function savedForMonth(
  daily: TimelogDailyRoll,
  month: string,
  linkedUserIds: readonly number[],
): Record<string, Record<string, number>> {
  const prefix = `${month}-`;
  const byUser: Record<string, Record<string, number>> = {};
  for (const id of linkedUserIds) byUser[String(id)] = {};
  for (const [key, cell] of Object.entries(daily)) {
    const parsed = parseDailyKey(key);
    if (!parsed || !parsed.date.startsWith(prefix)) continue;
    const days = byUser[String(parsed.userId)];
    if (days) days[parsed.date] = cell.hours;
  }
  return byUser;
}

/** First failing check wins, in the order the spec fixes (section 9). */
function refusalFor(
  month: string,
  cache: MonthCloseCache,
  close: TimelogMonthClose | undefined,
  today: string,
): MonthCloseRefusal | null {
  if (!cache.daily || !cache.dailyWindow) return "no-roll";
  if (today <= lastDayOfMonth(month)) return "not-ended";
  if (cache.dailyWindow.from > `${month}-01`) return "window-start";
  if (cache.dailyWindow.to < lastDayOfMonth(month)) return "window-end";
  if (cache.partial !== undefined && cache.partial !== false) return "partial";
  if (!cache.dailyProjects || cache.dailyProjects.length === 0) return "no-projects";
  if (close && !sameProjectSet(cache.dailyProjects, close.projectIds)) return "projects-changed";
  return null;
}

export function closeNextMonth(args: {
  close: TimelogMonthClose | undefined;
  firstMonth: string;
  cache: MonthCloseCache;
  linkedUserIds: readonly number[];
  today: string;
}): MonthCloseResult {
  const month = monthToClose(args.close, args.firstMonth);
  const reason = refusalFor(month, args.cache, args.close, args.today);
  if (reason || !args.cache.daily || !args.cache.dailyProjects) return { ok: false, reason: reason ?? "no-roll", month };
  return {
    ok: true,
    close: {
      through: month,
      // The first close records the fetched set; a later close keeps it (the
      // refusal above has proved the two are the same set).
      projectIds: args.close ? [...args.close.projectIds] : projectSet(args.cache.dailyProjects),
      saved: { ...(args.close?.saved ?? {}), [month]: savedForMonth(args.cache.daily, month, args.linkedUserIds) },
    },
  };
}

/** Drops `saved[through]`; reopening the only closed month removes the close. */
export function reopenLastMonth(close: TimelogMonthClose): TimelogMonthClose | undefined {
  const rest = Object.fromEntries(Object.entries(close.saved).filter(([month]) => month !== close.through));
  if (Object.keys(rest).length === 0) return undefined;
  return { through: previousMonth(close.through), projectIds: [...close.projectIds], saved: rest };
}
