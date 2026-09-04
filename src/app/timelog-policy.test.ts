import { describe, expect, it } from "vitest";
import { evaluateTimelogPolicy } from "./timelog-policy";
import { dailyKey, type TimelogDailyRoll, type TimelogPolicy } from "./timelog-types";
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
      daily: null, policy, holidaySet: NO_HOLIDAYS, userLinks: [], shifts: [],
    });
    expect(res.violations).toEqual([]);
    expect(res.evaluated).toEqual([]);
  });

  it("does not evaluate a rule that is enabled without a threshold", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [12, 12, 1] }),
      policy: { timelogCapPerDay: { enabled: true } },
      holidaySet: NO_HOLIDAYS, userLinks: [], shifts: [],
    });
    expect(res.evaluated).toEqual([]);
    expect(res.violations).toEqual([]);
  });

  it("does not evaluate a disabled rule even when the roll is present", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [12, 12, 1] }),
      policy: { timelogCapPerDay: { enabled: false, threshold: 8 } },
      holidaySet: NO_HOLIDAYS, userLinks: [], shifts: [],
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
      holidaySet: NO_HOLIDAYS, userLinks: [], shifts: [],
    });
    expect(res.evaluated).toEqual(["timelogCapPerEntry", "timelogCapPerDay"]);
    expect(res.violations).toEqual([
      { rule: "timelogCapPerEntry", timelogUserId: 7, resourceId: null, count: 1, worstHours: 6.5, threshold: 6 },
    ]);
  });

  it("does not flag a value exactly at the cap", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [8, 8, 1] }),
      policy: { timelogCapPerDay: { enabled: true, threshold: 8 } },
      holidaySet: NO_HOLIDAYS, userLinks: [], shifts: [],
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
      holidaySet: NO_HOLIDAYS, userLinks: [], shifts: [],
    });
    expect(res.violations).toEqual([
      { rule: "timelogCapPerDay", timelogUserId: 7, resourceId: null, count: 2, worstHours: 12, threshold: 8 },
      { rule: "timelogCapPerDay", timelogUserId: 9, resourceId: null, count: 1, worstHours: 9, threshold: 8 },
    ]);
  });

  it("flags a booking on a holiday with no link required", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [4, 4, 1] }),
      policy: { timelogNonWorkingDay: { enabled: true } },
      holidaySet: new Set([TUE]),
      userLinks: [], shifts: [],
    });
    expect(res.evaluated).toEqual(["timelogNonWorkingDay"]);
    expect(res.violations).toEqual([
      { rule: "timelogNonWorkingDay", timelogUserId: 7, resourceId: null, count: 1, worstHours: 4, threshold: 0 },
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
      holidaySet: NO_HOLIDAYS,
      userLinks: [link(7, 40)],
      shifts: [shift(40, [0, 8, 8, 0, 8, 8, 0])],
    });
    expect(res.violations).toEqual([
      { rule: "timelogNonWorkingDay", timelogUserId: 7, resourceId: 40, count: 1, worstHours: 3, threshold: 0 },
    ]);
  });

  it("flags a weekend booking against the default week when the link has no shift", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, SAT)]: [3, 3, 1] }),
      policy: { timelogNonWorkingDay: { enabled: true } },
      holidaySet: NO_HOLIDAYS,
      userLinks: [link(7, 40)],
      shifts: [],
    });
    expect(res.violations).toEqual([
      { rule: "timelogNonWorkingDay", timelogUserId: 7, resourceId: 40, count: 1, worstHours: 3, threshold: 0 },
    ]);
  });

  // ★★ FIXTURE (c-i) — DARK. No link at all: the rule must not be evaluated,
  // so nothing downstream can read its silence as "no violations".
  it("does not evaluate working hours when no user link exists", () => {
    const res = evaluateTimelogPolicy({
      daily: roll({ [dailyKey(7, TUE)]: [12, 12, 1] }),
      policy: { timelogWorkingHours: { enabled: true } },
      holidaySet: NO_HOLIDAYS,
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
      holidaySet: NO_HOLIDAYS,
      userLinks: [link(7, 40)],
      shifts: [],
    });
    expect(res.evaluated).toEqual(["timelogWorkingHours"]);
    expect(res.violations).toEqual([
      { rule: "timelogWorkingHours", timelogUserId: 7, resourceId: 40, count: 1, worstHours: 12, threshold: 8 },
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
      holidaySet: NO_HOLIDAYS,
      userLinks: [link(7, 40)],
      shifts: [shift(40, [0, 8, 6, 8, 8, 8, 0])],
    });
    expect(res.evaluated).toEqual(["timelogWorkingHours"]);
    expect(res.violations).toEqual([
      { rule: "timelogWorkingHours", timelogUserId: 7, resourceId: 40, count: 1, worstHours: 12, threshold: 6 },
    ]);
  });
});
