import { describe, expect, test } from "vitest";
import {
  acceptMonth,
  closeNextMonth,
  lastDayOfMonth,
  monthToClose,
  nextMonth,
  previousMonth,
  reopenLastMonth,
  type MonthCloseCache,
} from "./timelog-month-close";
import type { TimelogDailyRoll, TimelogMonthClose } from "./timelog-types";

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object") {
    Object.values(v as object).forEach(deepFreeze);
    Object.freeze(v);
  }
  return v;
}

const cell = (hours: number) => ({ hours, maxEntryHours: hours, entryCount: 1 });
const ROLL: TimelogDailyRoll = {
  "7|2026-08-03": cell(8),
  "7|2026-08-04": cell(4.5),
  "7|2026-09-01": cell(6),
  "9|2026-09-02": cell(3),
  "11|2026-08-03": cell(5),
};
/** §699 revision — shaped like a project fetch: the close reads the PROJECT
 *  scope, never `dailyUsers` (which a project fetch leaves empty). */
const CACHE: MonthCloseCache = {
  daily: ROLL,
  dailyWindow: { from: "2026-07-01", to: "2026-09-30" },
  partial: false,
  dailyProjects: [9, 12],
};
const PROJECTS = [9, 12];
const TODAY = "2026-10-14";

function close(over: Partial<Parameters<typeof closeNextMonth>[0]> = {}) {
  return closeNextMonth(
    deepFreeze({
      close: undefined,
      firstMonth: "2026-08",
      cache: CACHE,
      today: TODAY,
      ...over,
    }),
  );
}

describe("month arithmetic", () => {
  test("nextMonth and previousMonth cross a year boundary", () => {
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(previousMonth("2027-01")).toBe("2026-12");
    expect(nextMonth("2026-08")).toBe("2026-09");
    expect(previousMonth("2026-09")).toBe("2026-08");
  });
  test("lastDayOfMonth honours leap years", () => {
    expect(lastDayOfMonth("2028-02")).toBe("2028-02-29");
    expect(lastDayOfMonth("2027-02")).toBe("2027-02-28");
    expect(lastDayOfMonth("2026-12")).toBe("2026-12-31");
    expect(lastDayOfMonth("2026-09")).toBe("2026-09-30");
  });
  test("monthToClose is firstMonth without a close, else the month after through", () => {
    expect(monthToClose(undefined, "2026-08")).toBe("2026-08");
    expect(monthToClose({ through: "2026-08", projectIds: PROJECTS, saved: {} }, "2026-01")).toBe("2026-09");
  });
});

describe("refusals", () => {
  test("no-roll when daily is missing", () => {
    expect(close({ cache: { ...CACHE, daily: undefined } })).toEqual({ ok: false, reason: "no-roll", month: "2026-08" });
  });
  test("no-roll when the window is missing", () => {
    expect(close({ cache: { ...CACHE, dailyWindow: undefined } })).toEqual({ ok: false, reason: "no-roll", month: "2026-08" });
  });
  test("not-ended when today is within the month", () => {
    expect(close({ today: "2026-08-31" })).toEqual({ ok: false, reason: "not-ended", month: "2026-08" });
  });
  test("window-start when the window begins after the 1st", () => {
    const cache = { ...CACHE, dailyWindow: { from: "2026-08-02", to: "2026-09-30" } };
    expect(close({ cache })).toEqual({ ok: false, reason: "window-start", month: "2026-08" });
  });
  test("window-end when the window ends before the last day", () => {
    const cache = { ...CACHE, dailyWindow: { from: "2026-07-01", to: "2026-08-30" } };
    expect(close({ cache })).toEqual({ ok: false, reason: "window-end", month: "2026-08" });
  });
  test("partial for true and for any non-false value", () => {
    expect(close({ cache: { ...CACHE, partial: true } })).toEqual({ ok: false, reason: "partial", month: "2026-08" });
    expect(close({ cache: { ...CACHE, partial: 1 as unknown as boolean } })).toEqual({ ok: false, reason: "partial", month: "2026-08" });
  });
  test("partial undefined is accepted", () => {
    expect(close({ cache: { ...CACHE, partial: undefined } }).ok).toBe(true);
  });
  test("refuses without a project scope", () => {
    expect(close({ cache: { ...CACHE, dailyProjects: undefined } })).toEqual({ ok: false, reason: "no-projects", month: "2026-08" });
    expect(close({ cache: { ...CACHE, dailyProjects: [] } })).toEqual({ ok: false, reason: "no-projects", month: "2026-08" });
  });
  test("refuses when the project set changed", () => {
    const c: TimelogMonthClose = { through: "2026-08", projectIds: [9], saved: { "2026-08": {} } };
    expect(close({ close: c })).toEqual({ ok: false, reason: "projects-changed", month: "2026-09" });
    // Not vacuous: the same close over the same set closes.
    expect(close({ close: { ...c, projectIds: PROJECTS } }).ok).toBe(true);
  });
  test("compares the project set as a set, not by order", () => {
    const c: TimelogMonthClose = { through: "2026-08", projectIds: PROJECTS, saved: { "2026-08": {} } };
    expect(close({ close: c, cache: { ...CACHE, dailyProjects: [12, 9] } }).ok).toBe(true);
  });
  test("refusal order: no-roll beats not-ended", () => {
    expect(close({ cache: { ...CACHE, daily: undefined }, today: "2026-08-10" })).toMatchObject({ reason: "no-roll" });
  });
  test("refusal order: not-ended beats window-start", () => {
    const cache = { ...CACHE, dailyWindow: { from: "2026-08-02", to: "2026-09-30" } };
    expect(close({ cache, today: "2026-08-10" })).toMatchObject({ reason: "not-ended" });
  });
  test("refusal order: window-start beats window-end", () => {
    const cache = { ...CACHE, dailyWindow: { from: "2026-08-02", to: "2026-08-30" } };
    expect(close({ cache })).toMatchObject({ reason: "window-start" });
  });
  test("refusal order: window-end beats partial and partial beats no-projects", () => {
    const w = { from: "2026-07-01", to: "2026-08-30" };
    expect(close({ cache: { ...CACHE, dailyWindow: w, partial: true } })).toMatchObject({ reason: "window-end" });
    expect(close({ cache: { ...CACHE, partial: true, dailyProjects: undefined } })).toMatchObject({ reason: "partial" });
  });
  test("refusal order: partial beats projects-changed, no-projects beats projects-changed", () => {
    const c: TimelogMonthClose = { through: "2026-08", projectIds: [9], saved: { "2026-08": {} } };
    expect(close({ close: c, cache: { ...CACHE, partial: true } })).toMatchObject({ reason: "partial" });
    expect(close({ close: c, cache: { ...CACHE, dailyProjects: [] } })).toMatchObject({ reason: "no-projects" });
  });
  test("the refusal month follows through when a close exists", () => {
    const c: TimelogMonthClose = { through: "2026-08", projectIds: PROJECTS, saved: { "2026-08": {} } };
    expect(close({ close: c, today: "2026-09-30" })).toEqual({ ok: false, reason: "not-ended", month: "2026-09" });
  });
});

describe("closeNextMonth", () => {
  test("closes the first month", () => {
    expect(close()).toEqual({
      ok: true,
      close: {
        through: "2026-08",
        projectIds: [9, 12],
        saved: { "2026-08": { "7": { "2026-08-03": 8, "2026-08-04": 4.5 }, "11": { "2026-08-03": 5 } } },
      },
    });
  });
  test("the first close records the cache's project set, unique and ascending", () => {
    const r = close({ cache: { ...CACHE, dailyProjects: [12, 9, 12] } });
    expect(r.ok && r.close.projectIds).toEqual([9, 12]);
  });
  test("a later close keeps the recorded project set", () => {
    const prior: TimelogMonthClose = { through: "2026-08", projectIds: PROJECTS, saved: { "2026-08": {} } };
    const r = close({ close: prior, cache: { ...CACHE, dailyProjects: [12, 9] } });
    expect(r.ok && r.close.projectIds).toEqual([9, 12]);
  });
  // §699 section 10 — every booker, not only linked people: links are not an
  // input. User 9 booked only in September, so August saves nobody for them;
  // the rule compares a person with no saved entry against {}.
  test("saves every person with a booking in the month, and nobody else", () => {
    const r = close();
    expect(r.ok && Object.keys(r.close.saved["2026-08"]).sort()).toEqual(["11", "7"]);
  });
  test("saves a negative day total as fetched", () => {
    const r = close({ cache: { ...CACHE, daily: { ...ROLL, "7|2026-08-05": cell(-2.5) } } });
    expect(r.ok && r.close.saved["2026-08"]["7"]["2026-08-05"]).toBe(-2.5);
  });
  // §699 M8 — a cell the roll cannot read, and the non-positive sentinel ids
  // the sanitizer would reject (which would drop the whole close on load).
  test("skips an unreadable cell and a non-positive user id", () => {
    const daily = {
      ...ROLL,
      "7|2026-08-05": { hours: "4" },
      "13|2026-08-06": null,
      "0|2026-08-03": cell(2),
      "-3|2026-08-03": cell(2),
    } as unknown as TimelogDailyRoll;
    const r = close({ cache: { ...CACHE, daily } });
    expect(r.ok && r.close.saved["2026-08"]).toEqual({ "7": { "2026-08-03": 8, "2026-08-04": 4.5 }, "11": { "2026-08-03": 5 } });
  });
  test("closes the month after through and keeps earlier months", () => {
    const prior: TimelogMonthClose = { through: "2026-08", projectIds: PROJECTS, saved: { "2026-08": { "7": { "2026-08-03": 8 }, "9": {} } } };
    const r = close({ close: prior, firstMonth: "2020-01" });
    expect(r).toEqual({
      ok: true,
      close: {
        through: "2026-09",
        projectIds: [9, 12],
        saved: {
          "2026-08": { "7": { "2026-08-03": 8 }, "9": {} },
          "2026-09": { "7": { "2026-09-01": 6 }, "9": { "2026-09-02": 3 } },
        },
      },
    });
  });
  test("refuses the current month and accepts the day after", () => {
    const c: TimelogMonthClose = { through: "2026-08", projectIds: PROJECTS, saved: { "2026-08": {} } };
    expect(close({ close: c, today: "2026-09-30" })).toMatchObject({ ok: false, reason: "not-ended" });
    expect(close({ close: c, today: "2026-10-01" }).ok).toBe(true);
  });
});

describe("reopenLastMonth", () => {
  test("drops saved[through] and moves through back", () => {
    const c = deepFreeze<TimelogMonthClose>({
      through: "2026-09",
      projectIds: PROJECTS,
      saved: { "2026-08": { "7": {} }, "2026-09": { "7": { "2026-09-01": 6 } } },
    });
    expect(reopenLastMonth(c)).toEqual({ through: "2026-08", projectIds: [9, 12], saved: { "2026-08": { "7": {} } } });
  });
  test("returns undefined for a single-month close", () => {
    expect(reopenLastMonth(deepFreeze({ through: "2026-08", projectIds: PROJECTS, saved: { "2026-08": {} } }))).toBeUndefined();
  });
});

describe("acceptMonth", () => {
  /** Closed through September; Ann (7) had 8 h on 3 August when it closed. */
  const CLOSED: TimelogMonthClose = {
    through: "2026-09",
    projectIds: PROJECTS,
    saved: { "2026-08": { "7": { "2026-08-03": 8 } }, "2026-09": { "7": { "2026-09-01": 6 } } },
  };
  function accept(over: Partial<Parameters<typeof acceptMonth>[0]> = {}) {
    return acceptMonth(deepFreeze({ close: CLOSED, month: "2026-08", cache: CACHE, today: TODAY, ...over }));
  }

  test("replaces only that month with the current bookers' cells", () => {
    expect(accept()).toEqual({
      ok: true,
      close: {
        through: "2026-09",
        projectIds: [9, 12],
        saved: {
          "2026-08": { "7": { "2026-08-03": 8, "2026-08-04": 4.5 }, "11": { "2026-08-03": 5 } },
          "2026-09": { "7": { "2026-09-01": 6 } },
        },
      },
    });
  });
  test("accepts the last closed month and keeps through", () => {
    const r = accept({ month: "2026-09" });
    expect(r.ok && r.close.through).toBe("2026-09");
    expect(r.ok && r.close.saved["2026-09"]).toEqual({ "7": { "2026-09-01": 6 }, "9": { "2026-09-02": 3 } });
  });
  test("refuses a month that is not closed", () => {
    expect(accept({ month: "2026-10" })).toEqual({ ok: false, reason: "not-closed", month: "2026-10" });
    expect(accept({ month: "2026-07" })).toEqual({ ok: false, reason: "not-closed", month: "2026-07" });
    // A saved key after through (hand edit) is still not closed.
    const odd = { ...CLOSED, through: "2026-08" };
    expect(accept({ close: odd, month: "2026-09" })).toEqual({ ok: false, reason: "not-closed", month: "2026-09" });
  });
  const COVERAGE: Array<[string, MonthCloseCache, string]> = [
    ["no-roll", { ...CACHE, daily: undefined }, "no-roll"],
    ["window-start", { ...CACHE, dailyWindow: { from: "2026-08-02", to: "2026-09-30" } }, "window-start"],
    ["window-end", { ...CACHE, dailyWindow: { from: "2026-07-01", to: "2026-08-30" } }, "window-end"],
    ["partial", { ...CACHE, partial: true }, "partial"],
    ["no-projects", { ...CACHE, dailyProjects: [] }, "no-projects"],
    ["projects-changed", { ...CACHE, dailyProjects: [9] }, "projects-changed"],
  ];
  test.each(COVERAGE)("refuses %s like a close", (_name, cache, reason) => {
    expect(accept({ cache })).toEqual({ ok: false, reason, month: "2026-08" });
  });
  test("not-closed beats every coverage refusal", () => {
    expect(accept({ month: "2026-10", cache: { ...CACHE, daily: undefined } })).toMatchObject({ reason: "not-closed" });
  });
  test("leaves the input close untouched", () => {
    const before = JSON.stringify(CLOSED);
    accept();
    expect(JSON.stringify(CLOSED)).toBe(before);
  });
});
