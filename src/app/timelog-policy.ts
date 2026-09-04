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
  isDailyCell,
  parseDailyKey,
  type TimelogDailyRoll,
  type TimelogPolicy,
  type TimelogRuleId,
  type TimelogUserLink,
} from "./timelog-types";
import { DEFAULT_WEEK_HOURS, MAX_HOURS_PER_DAY, type Shift } from "./types";

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
  /** ★★★ The earliest and latest day that actually VIOLATED — never the earliest
   *  and latest day SCANNED. `reconcileInsights` needs to ask "does the current
   *  roll still cover the days this insight was about", and the insight is about
   *  the breaches, not the fetch. A range widened to the scanned window would
   *  answer that question `true` for a roll holding none of the breaching days.
   *  ★ ISO `YYYY-MM-DD`, so `<`/`>` are true date comparisons — no Date objects,
   *  which is what keeps this module clock-free and timezone-independent.
   *  ★★ REQUIRED, not optional, and both are always present: a violation exists
   *  only because at least one day violated, so there is always a min and a max
   *  (equal when it is the same single day). An optional field would invite an
   *  `?? ""` at the consumer, and `"" <= anything` silently defeats the very
   *  window check these exist for. */
  readonly firstViolationDate: string;
  readonly lastViolationDate: string;
}

export interface TimelogPolicyInput {
  /** null when no fetch has produced a roll on this device. */
  readonly daily: TimelogDailyRoll | null;
  readonly policy: TimelogPolicy | undefined;
  readonly holidaySet: ReadonlySet<string>;
  /** ★★★ Whether `holidaySet` is an ANSWER or merely a value. It is empty on
   *  every mount until the async holiday load resolves, and stays empty
   *  forever if that load REJECTED — and an empty set is indistinguishable
   *  from "this user's countries have no holidays". REQUIRED, not optional:
   *  an `?? true` default would silently restore the defect for the next
   *  caller, which is exactly how it arrived. `useHolidaySet` returns it. */
  readonly holidaysReady: boolean;
  readonly userLinks: readonly TimelogUserLink[];
  readonly shifts: readonly Shift[];
}

export interface TimelogPolicyResult {
  readonly violations: readonly TimelogViolation[];
  /** In TIMELOG_RULE_IDS order. Empty when nothing could be evaluated. */
  readonly evaluated: readonly TimelogRuleId[];
}

const EMPTY: TimelogPolicyResult = { violations: [], evaluated: [] };

/** The threshold window this engine accepts, deliberately IDENTICAL to the one
 *  `sanitizeTimelogPolicy` enforces on LOAD (`> 0 && <= MAX_HOURS_PER_DAY`).
 *  ★★★ They used to differ — this had no upper bound at all — and a threshold
 *  the loader would reject therefore meant two different things either side of
 *  a reload: `999` evaluated in memory as a cap that can never fire, and was
 *  then dropped by the sanitizer on the next load, leaving the rule enabled
 *  with no threshold. One stored value, two behaviours, no signal for either.
 *  ★ CONSEQUENCE of the bound, and it is the safe direction: an out-of-range
 *  threshold now leaves the rule NOT EVALUATED, so its stored insights FREEZE
 *  rather than being certified clean. "Produced nothing" is what
 *  `reconcileInsights` reads as "resolved" (see the header note), so a 999-hour
 *  cap silently resolving every real breach is the unrecoverable direction; a
 *  freeze that ends the moment the threshold is repaired is not. */
function isCap(v: number | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= MAX_HOURS_PER_DAY;
}

/** Weekday index matching WeekHours: 0 = Sunday. Parsed from the ISO date
 *  directly rather than via `new Date(s)`, which is timezone-dependent. */
function weekdayIndex(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

type Accum = {
  count: number;
  worstHours: number;
  threshold: number;
  resourceId: number | null;
  firstViolationDate: string;
  lastViolationDate: string;
};

/** ★★ `date` is the day that JUST violated, and the two bounds are tracked as a
 *  running MIN/MAX rather than first-seen/last-seen. `Object.entries(daily)`
 *  yields the roll's keys in insertion order, which is neither sorted by date
 *  nor grouped by user, so "the first date this user bumped" is not the earliest
 *  one — and a non-adjacent second breach would otherwise never widen the
 *  range. */
function bump(
  m: Map<number, Accum>,
  userId: number,
  resourceId: number | null,
  hours: number,
  threshold: number,
  date: string,
): void {
  const cur = m.get(userId);
  if (cur === undefined) {
    m.set(userId, {
      count: 1,
      worstHours: hours,
      threshold,
      resourceId,
      firstViolationDate: date,
      lastViolationDate: date,
    });
    return;
  }
  cur.count += 1;
  if (hours > cur.worstHours) {
    cur.worstHours = hours;
    cur.threshold = threshold;
  }
  if (date < cur.firstViolationDate) cur.firstViolationDate = date;
  if (date > cur.lastViolationDate) cur.lastViolationDate = date;
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
      firstViolationDate: a.firstViolationDate,
      lastViolationDate: a.lastViolationDate,
    }));
}

export function evaluateTimelogPolicy(input: TimelogPolicyInput): TimelogPolicyResult {
  const { daily, policy, holidaySet, holidaysReady, userLinks, shifts } = input;
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
  // ★★★ THE READINESS FLOOR IS THE SAME RULE AS THE LINK FLOOR BELOW, not a
  // second accident: a rule reports itself evaluated only when it COULD have
  // produced a true answer. Without holidays this rule sees only the
  // `definedHours === 0` weekend half, finds a plausible-looking nothing on
  // the holiday half, and `reconcileInsights` clears ANOTHER device's holiday
  // -booking insight as an "improvement" — into an exported artifact.
  // ★★ NOT `holidaySet.size > 0`: a user who configured no holiday countries
  // has a legitimately empty set, and gating on size would make the rule
  // permanently dark for them. Readiness, never emptiness.
  // ★ CONSEQUENCE, and it is the safe direction: while holidays load the rule
  // is not evaluated and its stored insights FREEZE rather than resolve. That
  // is temporary — the insights effect is debounced and re-runs once the set
  // arrives. Certifying a clean from data that had not loaded is the
  // unrecoverable direction; a brief freeze is not.
  const doNonWorking = nonWorking?.enabled === true && holidaysReady;
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
    // ★★ Defense in depth, and the reason it is not redundant with the cache's
    // own per-cell strip: `daily` is typed `TimelogDailyRoll | null`, and a TYPE
    // is a promise the CALLER makes. `loadActualsCache` keeps that promise; any
    // future caller handing over an unvalidated roll — a structured clone, an
    // in-memory hand-off, a freshly computed roll — does not, and this loop runs
    // inside a debounced effect with no try/catch, so a `null` cell here is an
    // uncaught throw that kills the whole insights reconcile. Skip the cell, not
    // the roll: one bad day must not cost the other days their evaluation.
    if (!isDailyCell(cell)) continue;
    const { userId, date } = parsed;
    const resourceId = userToResource.get(userId) ?? null;
    const shift = resourceId === null ? undefined : resourceToShift.get(resourceId);
    const weekday = weekdayIndex(date);
    const definedHours =
      resourceId === null || weekday === null
        ? null
        : (shift?.hoursPerWeekday ?? DEFAULT_WEEK_HOURS)[weekday];

    if (doEntry && cell.maxEntryHours > (entryCap.threshold as number)) {
      bump(perEntry, userId, resourceId, cell.maxEntryHours, entryCap.threshold as number, date);
    }
    if (doDay && cell.hours > (dayCap.threshold as number)) {
      bump(perDay, userId, resourceId, cell.hours, dayCap.threshold as number, date);
    }
    if (doNonWorking && (holidaySet.has(date) || definedHours === 0)) {
      bump(perNonWorking, userId, resourceId, cell.hours, 0, date);
    }
    // A user with no link contributes nothing here, which is correct: the rule
    // is evaluated (some link exists) but this person is simply unchecked.
    if (doWorking && definedHours !== null && definedHours > 0 && cell.hours > definedHours) {
      bump(perWorking, userId, resourceId, cell.hours, definedHours, date);
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
