// Pure, i18n-free. The four TimeLog guardrail rules.
//
// ★★★ REVIEW-TIME, NOT CREATE-TIME. OpenProject's equivalents are validations on
// entries its own users write. Cockpit never writes a time entry, so these flag
// bookings already made elsewhere. Nothing is blocked.
//
// ★★★ THE EVALUATED SET IS THE LOAD-BEARING RETURN VALUE, not the violations.
// `reconcileInsights` resolves a stored insight whose key stops being detected;
// for a rule that can go DARK, "produced nothing" means "not evaluated", not
// "not violated". A rule therefore reports itself evaluated only when it could
// have produced a true answer — see the per-rule conditions below.
//
// ★ NOT named timelog-guardrails.ts: `timelog-guards.ts` is a different concept
// (per-action handler/button guard parity, open-followups §74).
import {
  TIMELOG_RULE_IDS,
  parseDailyKey,
  type TimelogDailyRoll,
  type TimelogPolicy,
  type TimelogRuleId,
  type TimelogUserLink,
} from "./timelog-types";
import { DEFAULT_WEEK_HOURS, type Shift } from "./types";

export interface TimelogViolation {
  readonly rule: TimelogRuleId;
  readonly timelogUserId: number;
  /** null when no user link resolves — the person is identified by TimeLog id. */
  readonly resourceId: number | null;
  /** Offending days (or, for capPerEntry, offending days carrying an offending
   *  entry). Lower-is-better, which is what metricAtAction/delta require. */
  readonly count: number;
  readonly worstHours: number;
  /** The number compared against. 0 for the two rules that have no cap. */
  readonly threshold: number;
}

export interface TimelogPolicyInput {
  /** null when no fetch has produced a roll on this device. */
  readonly daily: TimelogDailyRoll | null;
  readonly policy: TimelogPolicy | undefined;
  readonly holidaySet: ReadonlySet<string>;
  readonly userLinks: readonly TimelogUserLink[];
  readonly shifts: readonly Shift[];
}

export interface TimelogPolicyResult {
  readonly violations: readonly TimelogViolation[];
  /** In TIMELOG_RULE_IDS order. Empty when nothing could be evaluated. */
  readonly evaluated: readonly TimelogRuleId[];
}

const EMPTY: TimelogPolicyResult = { violations: [], evaluated: [] };

function isCap(v: number | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** Weekday index matching WeekHours: 0 = Sunday. Parsed from the ISO date
 *  directly rather than via `new Date(s)`, which is timezone-dependent. */
function weekdayIndex(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

type Accum = { count: number; worstHours: number; threshold: number; resourceId: number | null };

function bump(m: Map<number, Accum>, userId: number, resourceId: number | null, hours: number, threshold: number): void {
  const cur = m.get(userId);
  if (cur === undefined) {
    m.set(userId, { count: 1, worstHours: hours, threshold, resourceId });
    return;
  }
  cur.count += 1;
  if (hours > cur.worstHours) {
    cur.worstHours = hours;
    cur.threshold = threshold;
  }
}

function drain(rule: TimelogRuleId, m: Map<number, Accum>): TimelogViolation[] {
  return [...m.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timelogUserId, a]) => ({
      rule,
      timelogUserId,
      resourceId: a.resourceId,
      count: a.count,
      worstHours: a.worstHours,
      threshold: a.threshold,
    }));
}

export function evaluateTimelogPolicy(input: TimelogPolicyInput): TimelogPolicyResult {
  const { daily, policy, holidaySet, userLinks, shifts } = input;
  if (daily === null || policy === undefined) return EMPTY;

  const userToResource = new Map(userLinks.map((l) => [l.timelogUserId, l.resourceId]));
  const resourceToShift = new Map<number, Shift>();
  for (const s of shifts) {
    if (typeof s.resourceId === "number") resourceToShift.set(s.resourceId, s);
  }

  const entryCap = policy.timelogCapPerEntry;
  const dayCap = policy.timelogCapPerDay;
  const nonWorking = policy.timelogNonWorkingDay;
  const working = policy.timelogWorkingHours;

  const doEntry = entryCap?.enabled === true && isCap(entryCap.threshold);
  const doDay = dayCap?.enabled === true && isCap(dayCap.threshold);
  const doNonWorking = nonWorking?.enabled === true;
  // ★★ The link floor is what stops a false clean: with no links this rule can
  // produce nothing, and producing nothing is what clear() reads as "resolved".
  const doWorking = working?.enabled === true && userLinks.length > 0;

  const perEntry = new Map<number, Accum>();
  const perDay = new Map<number, Accum>();
  const perNonWorking = new Map<number, Accum>();
  const perWorking = new Map<number, Accum>();

  for (const [key, cell] of Object.entries(daily)) {
    const parsed = parseDailyKey(key);
    if (parsed === null) continue;
    const { userId, date } = parsed;
    const resourceId = userToResource.get(userId) ?? null;
    const shift = resourceId === null ? undefined : resourceToShift.get(resourceId);
    const weekday = weekdayIndex(date);
    const definedHours =
      resourceId === null || weekday === null
        ? null
        : (shift?.hoursPerWeekday ?? DEFAULT_WEEK_HOURS)[weekday];

    if (doEntry && cell.maxEntryHours > (entryCap.threshold as number)) {
      bump(perEntry, userId, resourceId, cell.maxEntryHours, entryCap.threshold as number);
    }
    if (doDay && cell.hours > (dayCap.threshold as number)) {
      bump(perDay, userId, resourceId, cell.hours, dayCap.threshold as number);
    }
    if (doNonWorking && (holidaySet.has(date) || definedHours === 0)) {
      bump(perNonWorking, userId, resourceId, cell.hours, 0);
    }
    // A user with no link contributes nothing here, which is correct: the rule
    // is evaluated (some link exists) but this person is simply unchecked.
    if (doWorking && definedHours !== null && definedHours > 0 && cell.hours > definedHours) {
      bump(perWorking, userId, resourceId, cell.hours, definedHours);
    }
  }

  const evaluated: TimelogRuleId[] = [];
  const violations: TimelogViolation[] = [];
  const byRule: Record<TimelogRuleId, { on: boolean; acc: Map<number, Accum> }> = {
    timelogCapPerEntry: { on: doEntry, acc: perEntry },
    timelogCapPerDay: { on: doDay, acc: perDay },
    timelogNonWorkingDay: { on: doNonWorking, acc: perNonWorking },
    timelogWorkingHours: { on: doWorking, acc: perWorking },
  };
  for (const rule of TIMELOG_RULE_IDS) {
    const { on, acc } = byRule[rule];
    if (!on) continue;
    evaluated.push(rule);
    violations.push(...drain(rule, acc));
  }
  return { violations, evaluated };
}
