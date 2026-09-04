import { describe, expect, it } from "vitest";
import { evaluateTimelogPolicy } from "./timelog-policy";
import { dailyKey, TIMELOG_RULE_IDS, type TimelogDailyRoll, type TimelogPolicy, type TimelogRuleId } from "./timelog-types";
import { INSIGHT_TYPES, type InsightType } from "./insights/insight";
import type { Shift, WeekHours } from "./types";
import type { TimelogUserLink } from "./timelog-types";

const NO_HOLIDAYS: ReadonlySet<string> = new Set();

function roll(cells: Record<string, [hours: number, max: number, count: number]>): TimelogDailyRoll {
  const out: TimelogDailyRoll = {};
  for (const [k, [hours, maxEntryHours, entryCount]] of Object.entries(cells)) {
    out[k] = { hours, maxEntryHours, entryCount };
  }
  return out;
}

function link(timelogUserId: number, resourceId: number): TimelogUserLink {
  return { timelogUserId, resourceId, manual: true };
}

function shift(resourceId: number, hoursPerWeekday: WeekHours): Shift {
  return { id: resourceId, assignee: `r${resourceId}`, hoursPerWeekday, resourceId };
}

// 2026-09-01 is a Tuesday; 2026-09-05 is a Saturday.
const TUE = "2026-09-01";
const WED = "2026-09-02";
const SAT = "2026-09-05";

describe("evaluateTimelogPolicy", () => {
  it("reports no violations and an empty evaluated set when the roll is null", () => {
    const policy: TimelogPolicy = { timelogCapPerDay: { enabled: true, threshold: 8 } };
    const res = evaluateTimelogPolicy({
      daily: null, policy, holidaySet: NO_HOLIDAYS, holidaysReady: true, userLinks: [], shifts: [],
    });
    expect(res.violations).toEqual([]);
    expect(res.evaluated).toEqual([]);
  });

  it("does not evaluate a rule that is enabled without a threshold", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [12, 12, 1] }),
      policy: { timelogCapPerDay: { enabled: true } },
      holidaySet: NO_HOLIDAYS, holidaysReady: true, userLinks: [], shifts: [],
    });
    expect(res.evaluated).toEqual([]);
    expect(res.violations).toEqual([]);
  });

  it("does not evaluate a disabled rule even when the roll is present", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [12, 12, 1] }),
      policy: { timelogCapPerDay: { enabled: false, threshold: 8 } },
      holidaySet: NO_HOLIDAYS, holidaysReady: true, userLinks: [], shifts: [],
    });
    expect(res.evaluated).toEqual([]);
    expect(res.violations).toEqual([]);
  });

  // ★★★ THE FIXTURE THAT MAKES THIS TEST NON-VACUOUS. The daily SUM (7h) is
  // UNDER the 8h cap while one ENTRY (6.5h) is over a 6h per-entry cap. A
  // fixture whose sum also exceeded the cap would pass with `maxEntryHours`
  // replaced by `hours`, unpinning the entire reason the field exists.
  it("flags an entry over the cap on a day whose total is under the daily cap", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [7, 6.5, 2] }),
      policy: {
        timelogCapPerEntry: { enabled: true, threshold: 6 },
        timelogCapPerDay: { enabled: true, threshold: 8 },
      },
      holidaySet: NO_HOLIDAYS, holidaysReady: true, userLinks: [], shifts: [],
    });
    expect(res.evaluated).toEqual(["timelogCapPerEntry", "timelogCapPerDay"]);
    expect(res.violations).toEqual([
      { rule: "timelogCapPerEntry", timelogUserId: 7, resourceId: null, count: 1, worstHours: 6.5, threshold: 6, firstViolationDate: TUE, lastViolationDate: TUE },
    ]);
  });

  it("does not flag a value exactly at the cap", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [8, 8, 1] }),
      policy: { timelogCapPerDay: { enabled: true, threshold: 8 } },
      holidaySet: NO_HOLIDAYS, holidaysReady: true, userLinks: [], shifts: [],
    });
    expect(res.violations).toEqual([]);
  });

  it("aggregates per user and reports the worst value and the day count", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({
        [dailyKey(7, TUE)]: [10, 10, 1],
        [dailyKey(7, WED)]: [12, 12, 1],
        [dailyKey(9, TUE)]: [9, 9, 1],
      }),
      policy: { timelogCapPerDay: { enabled: true, threshold: 8 } },
      holidaySet: NO_HOLIDAYS, holidaysReady: true, userLinks: [], shifts: [],
    });
    expect(res.violations).toEqual([
      { rule: "timelogCapPerDay", timelogUserId: 7, resourceId: null, count: 2, worstHours: 12, threshold: 8, firstViolationDate: TUE, lastViolationDate: WED },
      { rule: "timelogCapPerDay", timelogUserId: 9, resourceId: null, count: 1, worstHours: 9, threshold: 8, firstViolationDate: TUE, lastViolationDate: TUE },
    ]);
  });

  // ★★★ THE DAYS RECORDED ARE THE DAYS THAT VIOLATED, NOT THE DAYS SCANNED.
  // The fixture is built so those two answers DIFFER at both ends: user 7's
  // clean days (MON at 4h, FRI at 5h) sit OUTSIDE the breaching pair, so a
  // range taken from the scanned cells would read 2026-08-31..2026-09-04 while
  // the true violating range is 2026-09-01..2026-09-03. A fixture whose clean
  // days sat between the breaches would pass either way.
  // ★★ The two breaching days are NON-ADJACENT and are deliberately inserted
  // LAST-first (WED before TUE): `Object.entries` yields insertion order, so a
  // min/max that degenerated to first-seen/last-seen would report the range
  // BACKWARDS rather than merely narrow.
  it("records the first and last VIOLATING day, not the first and last scanned", () => {
    const MON = "2026-08-31";
    const THU = "2026-09-03";
    const FRI = "2026-09-04";
    const res = evaluateTimelogPolicy({
      daily: roll({
        [dailyKey(7, FRI)]: [5, 5, 1],   // scanned, clean, AFTER the last breach
        [dailyKey(7, THU)]: [11, 11, 1], // breach — the LATE end
        [dailyKey(7, TUE)]: [10, 10, 1], // breach — the EARLY end, inserted second
        [dailyKey(7, MON)]: [4, 4, 1],   // scanned, clean, BEFORE the first breach
      }),
      policy: { timelogCapPerDay: { enabled: true, threshold: 8 } },
      holidaySet: NO_HOLIDAYS, holidaysReady: true, userLinks: [], shifts: [],
    });
    expect(res.violations).toEqual([
      {
        rule: "timelogCapPerDay", timelogUserId: 7, resourceId: null,
        count: 2, worstHours: 11, threshold: 8,
        firstViolationDate: TUE, lastViolationDate: THU,
      },
    ]);
  });

  // A single breaching day is a real violation, and both ends are that day —
  // the pair is never absent, which is why the fields are REQUIRED.
  it("reports the same day at both ends when only one day violated", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, WED)]: [12, 12, 1] }),
      policy: { timelogCapPerDay: { enabled: true, threshold: 8 } },
      holidaySet: NO_HOLIDAYS, holidaysReady: true, userLinks: [], shifts: [],
    });
    expect(res.violations[0].firstViolationDate).toBe(WED);
    expect(res.violations[0].lastViolationDate).toBe(WED);
  });

  // Each user accumulates its OWN range: user 9 breaches only on the day user 7
  // is clean, so a range shared across users would give both the same answer.
  it("tracks a separate violating range per user", () => {
    const THU = "2026-09-03";
    const res = evaluateTimelogPolicy({
      daily: roll({
        [dailyKey(7, TUE)]: [10, 10, 1],
        [dailyKey(7, WED)]: [11, 11, 1],
        [dailyKey(9, THU)]: [9, 9, 1],
      }),
      policy: { timelogCapPerDay: { enabled: true, threshold: 8 } },
      holidaySet: NO_HOLIDAYS, holidaysReady: true, userLinks: [], shifts: [],
    });
    expect(res.violations.map((v) => [v.timelogUserId, v.firstViolationDate, v.lastViolationDate])).toEqual([
      [7, TUE, WED],
      [9, THU, THU],
    ]);
  });

  // Each RULE accumulates its own range too — the per-entry breach and the
  // per-day breach fall on different days for the same person, so a range
  // shared across rules would report one of them wrongly.
  it("tracks a separate violating range per rule for the same user", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({
        [dailyKey(7, TUE)]: [7, 6.5, 2],  // per-ENTRY breach only (sum under the daily cap)
        [dailyKey(7, WED)]: [12, 4, 3],   // per-DAY breach only (no entry over 6)
      }),
      policy: {
        timelogCapPerEntry: { enabled: true, threshold: 6 },
        timelogCapPerDay: { enabled: true, threshold: 8 },
      },
      holidaySet: NO_HOLIDAYS, holidaysReady: true, userLinks: [], shifts: [],
    });
    expect(res.violations.map((v) => [v.rule, v.firstViolationDate, v.lastViolationDate])).toEqual([
      ["timelogCapPerEntry", TUE, TUE],
      ["timelogCapPerDay", WED, WED],
    ]);
  });

  it("flags a booking on a holiday with no link required", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [4, 4, 1] }),
      policy: { timelogNonWorkingDay: { enabled: true } },
      holidaySet: new Set([TUE]), holidaysReady: true,
      userLinks: [], shifts: [],
    });
    expect(res.evaluated).toEqual(["timelogNonWorkingDay"]);
    expect(res.violations).toEqual([
      { rule: "timelogNonWorkingDay", timelogUserId: 7, resourceId: null, count: 1, worstHours: 4, threshold: 0, firstViolationDate: TUE, lastViolationDate: TUE },
    ]);
  });

  // ★★ THE NEXT TWO MUST DIFFER, and the difference is the whole point. A shift
  // array byte-identical to DEFAULT_WEEK_HOURS cannot tell a RESOLVED shift from
  // the `?? DEFAULT_WEEK_HOURS` FALLBACK — the first of these once carried
  // [0,8,8,8,8,8,0] on a Saturday and passed unchanged with `shifts: []`, so it
  // pinned only the LINK. Same vacuity class as the dark/defaulted split below.
  // (1) zeroes a weekday the default week says is 8 → reachable ONLY via the
  // shift. (2) keeps the weekend but drops the shift → reachable ONLY via the
  // default. Neither can stand in for the other.
  it("flags a booking on a weekday the shift zeroes, which the default week would allow", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, WED)]: [3, 3, 1] }),
      policy: { timelogNonWorkingDay: { enabled: true } },
      holidaySet: NO_HOLIDAYS, holidaysReady: true,
      userLinks: [link(7, 40)],
      shifts: [shift(40, [0, 8, 8, 0, 8, 8, 0])],
    });
    expect(res.violations).toEqual([
      { rule: "timelogNonWorkingDay", timelogUserId: 7, resourceId: 40, count: 1, worstHours: 3, threshold: 0, firstViolationDate: WED, lastViolationDate: WED },
    ]);
  });

  it("flags a weekend booking against the default week when the link has no shift", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, SAT)]: [3, 3, 1] }),
      policy: { timelogNonWorkingDay: { enabled: true } },
      holidaySet: NO_HOLIDAYS, holidaysReady: true,
      userLinks: [link(7, 40)],
      shifts: [],
    });
    expect(res.violations).toEqual([
      { rule: "timelogNonWorkingDay", timelogUserId: 7, resourceId: 40, count: 1, worstHours: 3, threshold: 0, firstViolationDate: SAT, lastViolationDate: SAT },
    ]);
  });

  // ★★ FIXTURE (c-i) — DARK. No link at all: the rule must not be evaluated,
  // so nothing downstream can read its silence as "no violations".
  it("does not evaluate working hours when no user link exists", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [12, 12, 1] }),
      policy: { timelogWorkingHours: { enabled: true } },
      holidaySet: NO_HOLIDAYS, holidaysReady: true,
      userLinks: [], shifts: [],
    });
    expect(res.evaluated).toEqual([]);
    expect(res.violations).toEqual([]);
  });

  // ★★ FIXTURE (c-ii) — DEFAULTED. A link but no shift: the rule IS evaluated,
  // against DEFAULT_WEEK_HOURS. Distinct from (c-i); one does not imply the other.
  it("evaluates working hours against the default week when a link has no shift", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [12, 12, 1] }),
      policy: { timelogWorkingHours: { enabled: true } },
      holidaySet: NO_HOLIDAYS, holidaysReady: true,
      userLinks: [link(7, 40)],
      shifts: [],
    });
    expect(res.evaluated).toEqual(["timelogWorkingHours"]);
    expect(res.violations).toEqual([
      { rule: "timelogWorkingHours", timelogUserId: 7, resourceId: 40, count: 1, worstHours: 12, threshold: 8, firstViolationDate: TUE, lastViolationDate: TUE },
    ]);
  });

  // ★★ The shift's TUESDAY slot (index 2 — WeekHours is 0 = Sunday) carries the
  // 6, deliberately differing from DEFAULT_WEEK_HOURS' 8. A 6 parked on any
  // other weekday leaves Tuesday at the default and the assertion below could
  // not tell shift resolution from the default week.
  it("leaves an unlinked user unchecked while the rule is evaluated for a linked one", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({
        [dailyKey(7, TUE)]: [12, 12, 1],
        [dailyKey(8, TUE)]: [12, 12, 1],
      }),
      policy: { timelogWorkingHours: { enabled: true } },
      holidaySet: NO_HOLIDAYS, holidaysReady: true,
      userLinks: [link(7, 40)],
      shifts: [shift(40, [0, 8, 6, 8, 8, 8, 0])],
    });
    expect(res.evaluated).toEqual(["timelogWorkingHours"]);
    expect(res.violations).toEqual([
      { rule: "timelogWorkingHours", timelogUserId: 7, resourceId: 40, count: 1, worstHours: 12, threshold: 6, firstViolationDate: TUE, lastViolationDate: TUE },
    ]);
  });

  // ★★★ THE HOLIDAY-READINESS FLOOR. `useHolidaySet` starts EMPTY and fills
  // asynchronously, and a rejected fetch leaves it empty forever — so an empty
  // set is not evidence of anything. These three are the (dark / ready-empty /
  // ready-populated) triple; the middle one is the anti-vacuity control and
  // none of the three implies another.
  //
  // (r-i) DARK. Not ready: the rule must not report itself evaluated, and it
  // must not flag the weekend half either — a partial answer published as a
  // whole one is the same defect one degree quieter.
  it("does not evaluate the non-working-day rule while holidays are not ready", () => {
    const res = evaluateTimelogPolicy({
      // A Saturday, i.e. reachable through `definedHours === 0` with NO holiday
      // set at all. If the floor gated the holiday LOOKUP instead of the whole
      // rule, this booking would still be flagged and `evaluated` would still
      // carry the id — which is what makes this fixture the discriminating one.
      daily: roll({ [dailyKey(7, SAT)]: [3, 3, 1] }),
      policy: { timelogNonWorkingDay: { enabled: true } },
      holidaySet: NO_HOLIDAYS, holidaysReady: false,
      userLinks: [link(7, 40)], shifts: [],
    });
    expect(res.evaluated).toEqual([]);
    expect(res.violations).toEqual([]);
  });

  // (r-ii) READY, EMPTY — THE ANTI-VACUITY CONTROL. A user who configured no
  // holiday countries has a legitimately empty set, and that is a real answer.
  // ★★★ This is what kills the `holidaySet.size > 0` mutant, which (r-i) and
  // (r-iii) both survive: gating on emptiness would make the rule permanently
  // dark for such a user, silently resolving their insights forever.
  it("evaluates the non-working-day rule when ready with an empty holiday set", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, SAT)]: [3, 3, 1] }),
      policy: { timelogNonWorkingDay: { enabled: true } },
      holidaySet: NO_HOLIDAYS, holidaysReady: true,
      userLinks: [link(7, 40)], shifts: [],
    });
    expect(res.evaluated).toEqual(["timelogNonWorkingDay"]);
    expect(res.violations).toEqual([
      { rule: "timelogNonWorkingDay", timelogUserId: 7, resourceId: 40, count: 1, worstHours: 3, threshold: 0, firstViolationDate: SAT, lastViolationDate: SAT },
    ]);
  });

  // (r-iii) READY, POPULATED — the holiday half specifically, on a WEEKDAY, so
  // it cannot be reached through `definedHours === 0`.
  it("evaluates the holiday half only once holidays are ready", () => {
    const args = {
      daily: roll({ [dailyKey(7, TUE)]: [4, 4, 1] }),
      policy: { timelogNonWorkingDay: { enabled: true } },
      holidaySet: new Set([TUE]),
      userLinks: [], shifts: [],
    };
    expect(evaluateTimelogPolicy({ ...args, holidaysReady: false }).evaluated).toEqual([]);
    const ready = evaluateTimelogPolicy({ ...args, holidaysReady: true });
    expect(ready.evaluated).toEqual(["timelogNonWorkingDay"]);
    expect(ready.violations).toHaveLength(1);
  });

  // ★★ Readiness floors THIS rule and nothing else. Without this, moving the
  // term into the shared `if (daily === null …)` early return would pass every
  // assertion above while darkening all four rules.
  it("leaves the other three rules evaluated while holidays are not ready", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, SAT)]: [12, 12, 1] }),
      policy: {
        timelogCapPerDay: { enabled: true, threshold: 8 },
        timelogCapPerEntry: { enabled: true, threshold: 8 },
        timelogNonWorkingDay: { enabled: true },
        timelogWorkingHours: { enabled: true },
      },
      holidaySet: NO_HOLIDAYS, holidaysReady: false,
      userLinks: [link(7, 40)], shifts: [],
    });
    expect(res.evaluated).toEqual(["timelogCapPerEntry", "timelogCapPerDay", "timelogWorkingHours"]);
  });

  // ★★★ THE ENGINE'S OWN SHAPE GUARD. `daily` is typed, but a type is a promise
  // the CALLER makes; the cache keeps it and a future caller need not. The cast
  // is how a test can express what the type forbids — that is the whole point.
  // ★★ The VALID cell beside the malformed one is load-bearing: without it a
  // guard that skipped the whole ROLL (or returned EMPTY) would pass too.
  it("skips a malformed cell and still evaluates the valid one beside it", () => {
    const daily = {
      [dailyKey(7, TUE)]: null,
      [dailyKey(9, TUE)]: [12, 12, 1],
      [dailyKey(8, TUE)]: { hours: 12, maxEntryHours: 12, entryCount: 1 },
    } as unknown as TimelogDailyRoll;
    const res = evaluateTimelogPolicy({
      daily,
      policy: { timelogCapPerDay: { enabled: true, threshold: 8 } },
      holidaySet: NO_HOLIDAYS, holidaysReady: true,
      userLinks: [], shifts: [],
    });
    expect(res.evaluated).toEqual(["timelogCapPerDay"]);
    // User 8 only: 7 is `null` and 9 is an ARRAY — `Array.isArray` rejects the
    // latter even though its indices would not have thrown, which is the
    // difference between a shape check and a null check.
    expect(res.violations).toEqual([
      { rule: "timelogCapPerDay", timelogUserId: 8, resourceId: null, count: 1, worstHours: 12, threshold: 8, firstViolationDate: TUE, lastViolationDate: TUE },
    ]);
  });

  it("does not throw when every cell in the roll is malformed", () => {
    const daily = { [dailyKey(7, TUE)]: undefined } as unknown as TimelogDailyRoll;
    const res = evaluateTimelogPolicy({
      daily,
      policy: { timelogCapPerDay: { enabled: true, threshold: 8 } },
      holidaySet: NO_HOLIDAYS, holidaysReady: true,
      userLinks: [], shifts: [],
    });
    // Still EVALUATED: the rule could have produced a true answer, and did —
    // "no violations". Only an unreadable INPUT darkens a rule, not unreadable
    // data within one.
    expect(res.evaluated).toEqual(["timelogCapPerDay"]);
    expect(res.violations).toEqual([]);
  });
});

describe("rule ids are insight types", () => {
  // ★★★ THE ONLY THING STOPPING THE TWO SETS FROM DRIFTING. There is no
  // rule-to-type lookup table by design; this assignment is the contract.
  // Renaming either side turns tsc red.
  it("every rule id is assignable to InsightType", () => {
    const ids: readonly InsightType[] = TIMELOG_RULE_IDS;
    expect(ids).toHaveLength(4);
  });

  it("every rule id survives insight sanitisation", () => {
    for (const id of TIMELOG_RULE_IDS) {
      const rule: TimelogRuleId = id;
      expect(INSIGHT_TYPES).toContain(rule);
    }
  });
});
