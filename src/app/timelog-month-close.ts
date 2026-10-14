import type { TimelogRollWindow } from "./timelog-actuals-store";
import { parseDailyKey, type TimelogDailyRoll, type TimelogMonthClose } from "./timelog-types";

/** Closing and reopening TimeLog months (§699). Pure, clock-free and i18n-free:
 *  `today` is passed in and refusals are reason codes the settings panel translates.
 *  ★★ Refuse a correct close rather than save a wrong copy: a month is saved only
 *  when the cached roll provably covers all of it for every linked person. */
export type MonthCloseCache = {
  daily: TimelogDailyRoll | undefined;
  dailyWindow: TimelogRollWindow | undefined;
  partial: boolean | undefined;
  dailyUsers: readonly number[] | undefined;
};

export type MonthCloseRefusal = "no-roll" | "window-start" | "window-end" | "partial" | "person-missing" | "not-ended";

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

function refusalFor(
  month: string,
  cache: MonthCloseCache,
  linkedUserIds: readonly number[],
  today: string,
): MonthCloseRefusal | null {
  if (!cache.daily || !cache.dailyWindow) return "no-roll";
  if (today <= lastDayOfMonth(month)) return "not-ended";
  if (cache.dailyWindow.from > `${month}-01`) return "window-start";
  if (cache.dailyWindow.to < lastDayOfMonth(month)) return "window-end";
  if (cache.partial !== undefined && cache.partial !== false) return "partial";
  const users = cache.dailyUsers;
  if (!users || linkedUserIds.some((id) => !users.includes(id))) return "person-missing";
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
  const reason = refusalFor(month, args.cache, args.linkedUserIds, args.today);
  if (reason || !args.cache.daily) return { ok: false, reason: reason ?? "no-roll", month };
  return {
    ok: true,
    close: {
      through: month,
      saved: { ...(args.close?.saved ?? {}), [month]: savedForMonth(args.cache.daily, month, args.linkedUserIds) },
    },
  };
}

/** Drops `saved[through]`; reopening the only closed month removes the close. */
export function reopenLastMonth(close: TimelogMonthClose): TimelogMonthClose | undefined {
  const rest = Object.fromEntries(Object.entries(close.saved).filter(([month]) => month !== close.through));
  if (Object.keys(rest).length === 0) return undefined;
  return { through: previousMonth(close.through), saved: rest };
}
