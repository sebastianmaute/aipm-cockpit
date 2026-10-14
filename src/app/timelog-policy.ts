// Pure, i18n-free. The six TimeLog guardrail rules: five policy rules here, and
// `timelogClosedMonth` (§699) in `timelog-closed-month.ts`, merged in below.
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
  type TimelogMonthClose,
  type TimelogPolicy,
  type TimelogRuleId,
  type TimelogUserLink,
} from "./timelog-types";
import type { TimelogRollWindow } from "./timelog-actuals-store";
import { evaluateClosedMonth } from "./timelog-closed-month";
import { absencesForResource } from "./resource-capacity";
import { DEFAULT_WEEK_HOURS, MAX_HOURS_PER_DAY, type Absence, type AbsenceType, type Resource, type Shift } from "./types";

export { CLOSED_MONTH_TOLERANCE_HOURS, closedMonthCertifies } from "./timelog-closed-month";

/** §700 — the absence types a booking may not fall on. `other` is left out:
 *  it covers anything from a half day to an off-site, so a booking on it says
 *  nothing (owner ruling 2026-10-11: vacation, sick and training count). */
const ABSENCE_DAY_TYPES: ReadonlySet<AbsenceType> = new Set<AbsenceType>(["vacation", "sick", "training"]);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** An absence whose range the rule can read: two ISO days, start <= end. The
 *  dates are compared as strings, so anything else matches nothing, silently —
 *  and silence is what `reconcileInsights` reads as a clean. */
function isReadableAbsence(a: Absence): boolean {
  return ISO_DAY.test(a.startDate) && ISO_DAY.test(a.endDate) && a.startDate <= a.endDate;
}

export interface TimelogViolation {
  readonly rule: TimelogRuleId;
  readonly timelogUserId: number;
  /** null when no user link resolves — the person is identified by TimeLog id. */
  readonly resourceId: number | null;
  /** Offending days (or, for capPerEntry, offending days carrying an offending
   *  entry). Lower-is-better, which is what metricAtAction/delta require. */
  readonly count: number;
  readonly worstHours: number;
  /** The number compared against. 0 for the rules that have no cap. */
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
  /** §699 — the signed sum of the changes, rounded to 2 decimals, for the text
   *  only. Set only for `timelogClosedMonth`. */
  readonly netHours?: number;
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
  /** §700. REQUIRED, like `holidaysReady`: a caller that forgot them would
   *  make `timelogAbsenceDay` certify "no booking on an absence day" for
   *  everyone, which `reconcileInsights` reads as a resolved breach. */
  readonly absences: readonly Absence[];
  /** Only for matching an absence that has no `resourceId` to a linked person
   *  by name, the way `absencesForResource` does everywhere else. */
  readonly resources: readonly Resource[];
  /** §699 — the closed months, or null when nothing is closed. REQUIRED, like
   *  `holidaysReady`: a caller that forgot it would certify every closed
   *  month clean. The rule runs whether or not `policy` is set. */
  readonly close: TimelogMonthClose | null;
  /** §699 — the window and the people the roll covers. A closed month is
   *  checked only when the window holds all of it, and a person only when
   *  they are in `dailyUsers`. */
  readonly dailyWindow: TimelogRollWindow | undefined;
  readonly dailyUsers: readonly number[] | undefined;
}

export interface TimelogPolicyResult {
  readonly violations: readonly TimelogViolation[];
  /** In TIMELOG_RULE_IDS order. Empty when nothing could be evaluated. */
  readonly evaluated: readonly TimelogRuleId[];
  /** ★★★ THE PEOPLE WITH A RESOLVABLE LINK — the
   *  per-PERSON companion to `evaluated`, which is per-RULE and was not enough.
   *  `timelogWorkingHours` needs a resolvable link to know a person's expected
   *  hours, `timelogNonWorkingDay`'s weekday half needs it to know their
   *  weekend, and `timelogAbsenceDay` needs it to know their absences. The old
   *  floor asked only whether ANY link existed, so removing ONE person's link
   *  left the rule reporting itself evaluated while that person could no longer
   *  produce a violation — and the insight key is per person, so their row
   *  cleared as a fabricated "improved".
   *  ★★ Membership means "this userId has a link", NOT "this person violated
   *  something" and NOT "this person appears in the roll". The first cut built
   *  this from the roll's CELLS, which made the sentence below false for exactly
   *  the population it names: somebody linked and clean but with no bookings in
   *  the window had no cell, so they were reported unanswerable and froze
   *  permanently. Somebody linked and clean must stay clearable, and now is. */
  readonly linkedUsers: readonly number[];
  /** §700 — the people `timelogAbsenceDay` can answer for: a link whose
   *  resource still EXISTS. Stricter than `linkedUsers` on purpose. A dangling
   *  link keeps an answer for the shift rules, because `definedHours` falls back
   *  to `DEFAULT_WEEK_HOURS`; absences have no such fallback. Without the
   *  resource there is no name to match an absence stored without a
   *  `resourceId` against, so "no absence booking" is not an answer and the
   *  person's row must freeze rather than resolve. Violations it CAN see (an
   *  absence carrying the `resourceId`) are still reported.
   *  ★★ A person with a counted absence whose dates are unreadable is left out
   *  too: that absence can match no booking, so "no absence booking" is not an
   *  answer for them — the same rule as an unreadable roll cell, scoped to the
   *  one person it belongs to. */
  readonly absenceUsers: readonly number[];
  /** §699 — closed months fully inside `dailyWindow`, ascending. Read by
   *  `closedMonthCertifies`. */
  readonly closedMonthsCovered: readonly string[];
}

type PolicyRulesResult = Omit<TimelogPolicyResult, "closedMonthsCovered">;

const EMPTY: PolicyRulesResult = { violations: [], evaluated: [], linkedUsers: [], absenceUsers: [] };

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

/** The days each linked resource is absent on a counted type, as inclusive
 *  ISO ranges. Keyed by resource id, so a booking is checked against its own
 *  person only. A link whose resource was deleted still matches absences that
 *  carry its `resourceId`; it cannot match by name, having no name left. */
function absenceRanges(
  userLinks: readonly TimelogUserLink[],
  absences: readonly Absence[],
  resources: readonly Resource[],
): Map<number, readonly Absence[]> {
  const counted = absences.filter((a) => ABSENCE_DAY_TYPES.has(a.type));
  const byId = new Map(resources.map((r) => [r.id, r]));
  const out = new Map<number, readonly Absence[]>();
  for (const { resourceId } of userLinks) {
    if (out.has(resourceId)) continue;
    const resource = byId.get(resourceId);
    out.set(
      resourceId,
      resource === undefined ? counted.filter((a) => a.resourceId === resourceId) : absencesForResource(counted, resource),
    );
  }
  return out;
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

/** ★★ The closed-month rule runs INDEPENDENTLY of `policy`: closing a month is
 *  its opt-in, so the policy rules' early return must not swallow it. It is
 *  appended LAST, which keeps `evaluated` in `TIMELOG_RULE_IDS` order.
 *  ★★ `linkedUsers` is filled whenever a roll exists, policy or not: the
 *  runner's closed-month certification reads it. */
export function evaluateTimelogPolicy(input: TimelogPolicyInput): TimelogPolicyResult {
  const rules = evaluatePolicyRules(input);
  const closed = evaluateClosedMonth(input);
  const linkedUsers = input.daily === null ? [] : [...new Set(input.userLinks.map((l) => l.timelogUserId))];
  return {
    violations: [...rules.violations, ...closed.violations],
    evaluated: closed.evaluated ? [...rules.evaluated, "timelogClosedMonth"] : rules.evaluated,
    linkedUsers,
    absenceUsers: rules.absenceUsers,
    closedMonthsCovered: closed.closedMonthsCovered,
  };
}

/** The five policy rules. */
function evaluatePolicyRules(input: TimelogPolicyInput): PolicyRulesResult {
  const { daily, policy, holidaySet, holidaysReady, userLinks, shifts, absences, resources } = input;
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
  const absent = policy.timelogAbsenceDay;

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
  // §700 — the same link floor, for the same reason: absences are per resource,
  // so with no links this rule can produce nothing.
  const doAbsent = absent?.enabled === true && userLinks.length > 0;
  const absentOn = absenceRanges(userLinks, absences, resources);

  const perEntry = new Map<number, Accum>();
  const perDay = new Map<number, Accum>();
  const perNonWorking = new Map<number, Accum>();
  const perWorking = new Map<number, Accum>();
  const perAbsent = new Map<number, Accum>();
  // ★★★ BUILT FROM THE LINKS, NEVER FROM THE ROLL'S CELLS — and building it
  // from cells, as the first cut did, made a linked person who booked NOTHING
  // freeze permanently. The question this set answers is "could the
  // shift-dependent rules produce an answer about this person", and a link is
  // the whole of what that needs: the shift supplies expected hours and the
  // weekend, and a person with no bookings has the answer "no violation".
  // Requiring a CELL conflated that with "did this person appear in the roll",
  // so somebody on long leave, or newly joined, or simply idle in the fetched
  // window, was reported unanswerable and their stored insight never resolved
  // again — a permanent freeze with nothing to lift it.
  // ★★ Coverage is a SEPARATE question and is already asked separately: the
  // reconcile predicate checks `dailyUsers` for whether the fetch covered this
  // person at all. Scope and answerability are two independent facts and
  // collapsing them into one set loses both.
  // ★★ PRESENCE IN `userLinks` IS A RESOLVABLE LINK, and that rests on a
  // guarantee made ELSEWHERE: `resourceId` is a non-optional `number` on the
  // type, and `sanitizeTimelogLinks` drops any link failing
  // `isNum(o.resourceId)` on every load path. If that sanitiser ever relaxes,
  // this map silently starts certifying people whose `definedHours` is null —
  // so the invariant lives there, not here, and this comment is the pointer. A DANGLING link (resource since deleted)
  // still yields an answer, because `definedHours` falls back to
  // `DEFAULT_WEEK_HOURS` when no shift resolves — so it belongs in here too.
  const linked = new Set<number>(userLinks.map((l) => l.timelogUserId));

  // ★★★ SET BY ANY CELL THE LOOP COULD NOT READ, AND IT COSTS EVERY ENABLED RULE
  // ITS EVALUATION — see the withholding loop at the bottom. This is the same
  // readiness rule as `doNonWorking`'s holiday floor and `doWorking`'s link
  // floor, applied to the roll's own contents: a rule reports itself evaluated
  // only when it COULD have produced a true answer, and a partial read cannot
  // honestly answer "no violation".
  // ★★★ IT COSTS THE RULE ITS `evaluated` MEMBERSHIP AND NOTHING ELSE — the
  // violations it did accumulate are still REPORTED. `evaluated` means precisely
  // one thing: "this rule may certify a clean", because it is what
  // `reconcileInsights` reads as licence to CLEAR a stored insight. A partial
  // read can still be RIGHT that a violation exists — it OBSERVED one — and can
  // never be right that none does. So a positive finding needs no certification
  // and goes out; only the authority to say "no violation" is withheld, and the
  // rule's stored insights FREEZE rather than resolving as a fabricated
  // "improved" in shared, exported `Workspace.insights`.
  // ★★★ THE COST OF THIS DIRECTION, STATED SO IT IS NOT REDISCOVERED AS A BUG:
  // a violation reported while the rule is NOT evaluated mints an insight that
  // `reconcileInsights` cannot clear for as long as the unreadable cell persists.
  // That is a FREEZE, which is this module's own recoverable direction, and it
  // lifts the moment the roll becomes readable.
  // ★★★ THE ALTERNATIVE WAS SUPPRESSING THE VIOLATIONS TOO, AND ITS COST IS WHAT
  // DECIDED THIS. Under that shape ONE malformed key blinds every enabled
  // guardrail for the whole fetch, so a genuine 12-hour-day breach on a
  // perfectly good day never reaches the user at all. That is exactly what the
  // "one bad day must not cost the other days" comment below existed to prevent:
  // its INSTINCT was right and only its conclusion about `evaluated` was wrong.
  // Both halves were weighed; do not re-derive one of them and flip this back.
  // ★★ PER-ROLL, NOT PER-RULE, deliberately: an unreadable cell might have
  // violated ANY of the rules, so none of them can certify.
  // ★★★ AND PER-ROLL MEANS EVERY PERSON, NOT JUST THE ONE THE CELL BELONGED TO.
  // This comment read "so none of them can certify for the person it belonged
  // to", which understates the blast radius by the width of the whole roll:
  // `skipped` is a single flag over one `evaluateTimelogPolicy` call, so one
  // unreadable cell withholds `evaluated` for every rule across EVERY user
  // in that roll. On the `!isDailyCell` branch the person is in fact
  // identifiable (`parseDailyKey` succeeded), so a narrower per-user withholding
  // is CONSTRUCTIBLE there — it is not built because the `parsed === null`
  // branch cannot identify anyone, and two withholding widths in one loop is a
  // second rule free to drift from this one. Widening is the safe direction:
  // over-withholding FREEZES rows, under-withholding fabricates `"improved"`.
  let skipped = false;
  for (const [key, cell] of Object.entries(daily)) {
    const parsed = parseDailyKey(key);
    if (parsed === null) {
      skipped = true;
      continue;
    }
    // ★★ Defense in depth, and the reason it is not redundant with the cache's
    // own per-cell strip: `daily` is typed `TimelogDailyRoll | null`, and a TYPE
    // is a promise the CALLER makes. `loadActualsCache` keeps that promise; any
    // future caller handing over an unvalidated roll — a structured clone, an
    // in-memory hand-off, a freshly computed roll — does not, and this loop runs
    // inside a debounced effect with no try/catch, so a `null` cell here is an
    // uncaught throw that kills the whole insights reconcile. The cell is still
    // SKIPPED rather than thrown on, and that throw-safety argument is unchanged.
    // ★★★ WHAT CHANGED IS THE COST, AND ONLY HALF OF IT. This used to read "one
    // bad day must not cost the other days their evaluation". The instinct was
    // right — the other days are still measured, and any violation among them is
    // still REPORTED — but the conclusion about `evaluated` was a safety
    // regression: the cell vanished silently while the rule went on certifying
    // itself evaluated, so a real over-cap booking on an unreadable day let
    // `reconcileInsights` resolve a stored guardrail insight as a fabricated
    // "improved". A skipped cell now costs the rule its authority to certify a
    // clean, and nothing more.
    // ★★ This closes a PRE-EXISTING hole as well as the one the date-shape check
    // widened: an unparseable key and a non-cell value both fell into the same
    // silent skip before either guard existed.
    if (!isDailyCell(cell)) {
      skipped = true;
      continue;
    }
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
    // ★★★ A user with no link contributes nothing here, and "the rule is
    // evaluated, this person is simply unchecked" — which is what this comment
    // used to say — is precisely the fabricated-win shape, not a justification
    // for it. The insight key is per PERSON, so an unchecked person's stored row
    // finds no violation and resolves as "improved". `linkedUsers` above is what
    // makes that person's row FREEZE instead; the whole-rule `doWorking` floor
    // cannot, because it asks whether ANY link exists.
    if (doWorking && definedHours !== null && definedHours > 0 && cell.hours > definedHours) {
      bump(perWorking, userId, resourceId, cell.hours, definedHours, date);
    }
    // ★ A 0-hour cell is not time booked, so it is not flagged.
    if (
      doAbsent &&
      resourceId !== null &&
      cell.hours > 0 &&
      (absentOn.get(resourceId) ?? []).some((a) => a.startDate <= date && date <= a.endDate)
    ) {
      bump(perAbsent, userId, resourceId, cell.hours, 0, date);
    }
  }

  const evaluated: TimelogRuleId[] = [];
  const violations: TimelogViolation[] = [];
  const byRule: Record<TimelogRuleId, { on: boolean; acc: Map<number, Accum> }> = {
    timelogCapPerEntry: { on: doEntry, acc: perEntry },
    timelogCapPerDay: { on: doDay, acc: perDay },
    timelogNonWorkingDay: { on: doNonWorking, acc: perNonWorking },
    timelogWorkingHours: { on: doWorking, acc: perWorking },
    timelogAbsenceDay: { on: doAbsent, acc: perAbsent },
    // §699 — evaluated separately, in `timelog-closed-month.ts`.
    timelogClosedMonth: { on: false, acc: new Map() },
  };
  for (const rule of TIMELOG_RULE_IDS) {
    const { on, acc } = byRule[rule];
    if (!on) continue;
    // ★★★ THE VIOLATIONS ARE REPORTED EITHER WAY; ONLY THE CERTIFICATION IS
    // WITHHELD. `skipped` is the roll-contents readiness floor — see its
    // declaration for what it costs and why. The asymmetry is the whole point: a
    // partial read can still be RIGHT that a violation exists, because it
    // OBSERVED one, and it can never be right that none does.
    if (!skipped) evaluated.push(rule);
    violations.push(...drain(rule, acc));
  }
  const known = new Set(resources.map((r) => r.id));
  const absenceUsers = userLinks
    .filter((l) => known.has(l.resourceId) && (absentOn.get(l.resourceId) ?? []).every(isReadableAbsence))
    .map((l) => l.timelogUserId);
  return { violations, evaluated, linkedUsers: [...linked], absenceUsers: [...new Set(absenceUsers)] };
}
