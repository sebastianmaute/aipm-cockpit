// Pure, i18n-free, clock-free. The sixth TimeLog guardrail, `timelogClosedMonth`
// (§699): a booking in a closed month that differs from the hours saved when the
// month was closed. `timelog-policy.ts` calls `evaluateClosedMonth` and
// re-exports the rest, so a consumer imports all of it from there.
//
// ★★★ AS IN THE OTHER FIVE RULES, THE EVALUATED ANSWER IS THE LOAD-BEARING PART.
// `reconcileInsights` reads "produced nothing" as "resolved", so this rule says
// it was evaluated only when it could have produced a true answer, and the
// per-person half of that question is `closedMonthCertifies`.
//
// ★ NOT named `timelog-month-close.ts`: that module CLOSES and REOPENS months
// (the settings action). This one CHECKS them.
import type { TimelogRollWindow } from "./timelog-actuals-store";
import { lastDayOfMonth, nextMonth } from "./timelog-month-close";
import type { TimelogViolation } from "./timelog-policy";
import {
  isDailyCell,
  parseDailyKey,
  type TimelogDailyRoll,
  type TimelogMonthClose,
  type TimelogUserLink,
} from "./timelog-types";

/** A day whose hours moved by at least this much since the close is a changed
 *  day; anything smaller is rounding. */
export const CLOSED_MONTH_TOLERANCE_HOURS = 0.01;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface ClosedMonthInput {
  readonly daily: TimelogDailyRoll | null;
  readonly close: TimelogMonthClose | null;
  readonly dailyWindow: TimelogRollWindow | undefined;
  readonly dailyUsers: readonly number[] | undefined;
  readonly userLinks: readonly TimelogUserLink[];
  /** ★★★ REQUIRED. A partial or cancelled fetch keeps every requested person
   *  in `dailyUsers`, including one whose fetch failed or never ran. That
   *  person has no cells, so every saved day would read as deleted. While this
   *  is true the rule emits nothing and is not evaluated. Pass the normalised
   *  flag: any non-false stored value is true. */
  readonly partial: boolean;
}

export interface ClosedMonthResult {
  readonly evaluated: boolean;
  readonly violations: readonly TimelogViolation[];
  /** Closed months fully inside `dailyWindow`, ascending. */
  readonly closedMonthsCovered: readonly string[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100 || 0;

/** The closed months the roll covers from their first day to their last. A
 *  month only partly inside the window is left out: its missing days would read
 *  as deleted bookings. */
function coveredClosedMonths(close: TimelogMonthClose, window: TimelogRollWindow | undefined): string[] {
  if (window === undefined) return [];
  return Object.keys(close.saved)
    .filter((m) => m <= close.through && window.from <= `${m}-01` && window.to >= lastDayOfMonth(m))
    .sort();
}

/** A change of at least `CLOSED_MONTH_TOLERANCE_HOURS`, compared in whole
 *  hundredths. A plain `>= 0.01` misses 8 → 8.01, because `8.01 - 8` is
 *  0.00999… in floating point. 0.004 still rounds to 0 and stays unflagged. */
function isChange(change: number): boolean {
  return Math.round(Math.abs(change) * 100) >= Math.round(CLOSED_MONTH_TOLERANCE_HOURS * 100);
}

/** "userId|YYYY-MM": a person's month that holds a cell this loop cannot read. */
const personMonth = (userId: number, month: string): string => `${userId}|${month}`;

/** The readable cells of the covered months, per user, per day.
 *  `unreadable` is set by ANY cell the loop cannot read, wherever it is: an
 *  unparseable key could belong to a closed month, so the rule may not certify
 *  a clean. ★★ `unreadableMonths` holds the person-months where the key parsed
 *  but the value did not. That day is unknown, not deleted, so no violation
 *  may be raised for that person and month. */
function currentHours(
  daily: TimelogDailyRoll,
  covered: ReadonlySet<string>,
): { byUser: Map<number, Map<string, number>>; unreadable: boolean; unreadableMonths: Set<string> } {
  const byUser = new Map<number, Map<string, number>>();
  const unreadableMonths = new Set<string>();
  let unreadable = false;
  for (const [key, cell] of Object.entries(daily)) {
    const parsed = parseDailyKey(key);
    if (parsed === null) {
      unreadable = true;
      continue;
    }
    const month = parsed.date.slice(0, 7);
    if (!isDailyCell(cell)) {
      unreadable = true;
      if (covered.has(month)) unreadableMonths.add(personMonth(parsed.userId, month));
      continue;
    }
    if (!covered.has(month)) continue;
    const days = byUser.get(parsed.userId) ?? new Map<string, number>();
    days.set(parsed.date, cell.hours);
    byUser.set(parsed.userId, days);
  }
  return { byUser, unreadable, unreadableMonths };
}

/** One person's changed days across every covered closed month, or null when
 *  nothing changed. A missing day counts as 0 on either side, so an added and
 *  a deleted day both count. A person with no `saved[month]` entry (linked
 *  after the close) is compared against an empty map, so all their bookings
 *  count. */
function personViolation(
  link: TimelogUserLink,
  close: TimelogMonthClose,
  covered: readonly string[],
  current: ReadonlyMap<string, number>,
  unreadableMonths: ReadonlySet<string>,
): TimelogViolation | null {
  let count = 0;
  let worst = 0;
  let net = 0;
  let first = "";
  let last = "";
  for (const month of covered) {
    if (unreadableMonths.has(personMonth(link.timelogUserId, month))) continue;
    const saved = close.saved[month]?.[String(link.timelogUserId)] ?? {};
    const days = new Set<string>(Object.keys(saved));
    for (const day of current.keys()) if (day.startsWith(`${month}-`)) days.add(day);
    for (const day of [...days].sort()) {
      const change = (current.get(day) ?? 0) - (saved[day] ?? 0);
      if (!isChange(change)) continue;
      count += 1;
      worst = Math.max(worst, Math.abs(change));
      net += change;
      if (first === "" || day < first) first = day;
      if (day > last) last = day;
    }
  }
  if (count === 0) return null;
  return {
    rule: "timelogClosedMonth",
    timelogUserId: link.timelogUserId,
    resourceId: link.resourceId,
    count,
    worstHours: round2(worst),
    threshold: 0,
    firstViolationDate: first,
    lastViolationDate: last,
    netHours: round2(net),
  };
}

/** The rule. Evaluated when nothing is closed (a certain clean: no late change
 *  can exist, which is what lets reopening the last month clear its flags) or
 *  when a roll exists and every cell of it is readable. A person is checked
 *  only if linked and in `dailyUsers`: ★★★ a person the fetch did not cover has
 *  no cells, and comparing that against their saved hours would read as "every
 *  booking deleted". Unlinked people are not checked at all.
 *  ★★★ A PARTIAL roll emits nothing and is not evaluated, for the same reason:
 *  its `dailyUsers` still lists people it never fetched (see `partial`).
 *  ★ Nothing closed stays evaluated even then: with no close no change can
 *  exist, whatever the fetch did. */
export function evaluateClosedMonth(input: ClosedMonthInput): ClosedMonthResult {
  const { daily, close, dailyWindow, dailyUsers, userLinks, partial } = input;
  if (close === null) return { evaluated: true, violations: [], closedMonthsCovered: [] };
  if (daily === null) return { evaluated: false, violations: [], closedMonthsCovered: [] };
  const covered = coveredClosedMonths(close, dailyWindow);
  if (partial) return { evaluated: false, violations: [], closedMonthsCovered: covered };
  const { byUser, unreadable, unreadableMonths } = currentHours(daily, new Set(covered));
  const fetched = new Set(dailyUsers ?? []);
  const seen = new Set<number>();
  const violations: TimelogViolation[] = [];
  for (const link of [...userLinks].sort((a, b) => a.timelogUserId - b.timelogUserId)) {
    if (seen.has(link.timelogUserId) || !fetched.has(link.timelogUserId)) continue;
    seen.add(link.timelogUserId);
    const v = personViolation(link, close, covered, byUser.get(link.timelogUserId) ?? new Map(), unreadableMonths);
    if (v !== null) violations.push(v);
  }
  return { evaluated: !unreadable, violations, closedMonthsCovered: covered };
}

/** The runner's per-insight certification for `timelogClosedMonth`: may a
 *  stored insight about `userId` over `first`..`last` be cleared? Every month
 *  in that span must pass. A month after `close.through` was reopened, so
 *  nothing about it can still be flagged and it passes; a still-closed month
 *  passes only when the roll covers all of it, is not partial, and covers and
 *  links the person. An unreadable span certifies nothing. */
export function closedMonthCertifies(args: {
  first: string;
  last: string;
  userId: number;
  close: TimelogMonthClose | null;
  closedMonthsCovered: readonly string[];
  partial: boolean;
  dailyUsers: readonly number[] | undefined;
  linkedUsers: readonly number[];
}): boolean {
  const { first, last, userId, close } = args;
  if (close === null) return true;
  if (!ISO_DAY.test(first) || !ISO_DAY.test(last) || first > last) return false;
  const answerable =
    !args.partial && (args.dailyUsers ?? []).includes(userId) && args.linkedUsers.includes(userId);
  for (let month = first.slice(0, 7); month <= last.slice(0, 7); month = nextMonth(month)) {
    if (month > close.through) continue;
    if (!answerable || !args.closedMonthsCovered.includes(month)) return false;
  }
  return true;
}
