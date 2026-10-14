import { describe, expect, test } from "vitest";
import {
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
const CACHE: MonthCloseCache = {
  daily: ROLL,
  dailyWindow: { from: "2026-07-01", to: "2026-09-30" },
  partial: false,
  dailyUsers: [7, 9, 11],
};
const TODAY = "2026-10-14";

function close(over: Partial<Parameters<typeof closeNextMonth>[0]> = {}) {
  return closeNextMonth(
    deepFreeze({
      close: undefined,
      firstMonth: "2026-08",
      cache: CACHE,
      linkedUserIds: [7, 9],
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
    expect(monthToClose({ through: "2026-08", saved: {} }, "2026-01")).toBe("2026-09");
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
  test("person-missing when a linked id is not in dailyUsers", () => {
    expect(close({ linkedUserIds: [7, 12] })).toEqual({ ok: false, reason: "person-missing", month: "2026-08" });
  });
  test("person-missing when dailyUsers is undefined", () => {
    expect(close({ cache: { ...CACHE, dailyUsers: undefined } })).toEqual({ ok: false, reason: "person-missing", month: "2026-08" });
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
  test("refusal order: window-end beats partial and partial beats person-missing", () => {
    const w = { from: "2026-07-01", to: "2026-08-30" };
    expect(close({ cache: { ...CACHE, dailyWindow: w, partial: true } })).toMatchObject({ reason: "window-end" });
    expect(close({ cache: { ...CACHE, partial: true }, linkedUserIds: [12] })).toMatchObject({ reason: "partial" });
  });
  test("the refusal month follows through when a close exists", () => {
    const c: TimelogMonthClose = { through: "2026-08", saved: { "2026-08": {} } };
    expect(close({ close: c, today: "2026-09-30" })).toEqual({ ok: false, reason: "not-ended", month: "2026-09" });
  });
});

describe("closeNextMonth", () => {
  test("closes the first month", () => {
    expect(close()).toEqual({
      ok: true,
      close: {
        through: "2026-08",
        saved: { "2026-08": { "7": { "2026-08-03": 8, "2026-08-04": 4.5 }, "9": {} } },
      },
    });
  });
  test("saves an empty map for a linked person with no bookings", () => {
    const r = close();
    expect(r.ok && r.close.saved["2026-08"]["9"]).toEqual({});
  });
  test("saves only linked people", () => {
    const r = close();
    expect(r.ok && Object.keys(r.close.saved["2026-08"])).toEqual(["7", "9"]);
  });
  test("closes the month after through and keeps earlier months", () => {
    const prior: TimelogMonthClose = { through: "2026-08", saved: { "2026-08": { "7": { "2026-08-03": 8 }, "9": {} } } };
    const r = close({ close: prior, firstMonth: "2020-01" });
    expect(r).toEqual({
      ok: true,
      close: {
        through: "2026-09",
        saved: {
          "2026-08": { "7": { "2026-08-03": 8 }, "9": {} },
          "2026-09": { "7": { "2026-09-01": 6 }, "9": { "2026-09-02": 3 } },
        },
      },
    });
  });
  test("refuses the current month and accepts the day after", () => {
    const c: TimelogMonthClose = { through: "2026-08", saved: { "2026-08": {} } };
    expect(close({ close: c, today: "2026-09-30" })).toMatchObject({ ok: false, reason: "not-ended" });
    expect(close({ close: c, today: "2026-10-01" }).ok).toBe(true);
  });
});

describe("reopenLastMonth", () => {
  test("drops saved[through] and moves through back", () => {
    const c = deepFreeze<TimelogMonthClose>({
      through: "2026-09",
      saved: { "2026-08": { "7": {} }, "2026-09": { "7": { "2026-09-01": 6 } } },
    });
    expect(reopenLastMonth(c)).toEqual({ through: "2026-08", saved: { "2026-08": { "7": {} } } });
  });
  test("returns undefined for a single-month close", () => {
    expect(reopenLastMonth(deepFreeze({ through: "2026-08", saved: { "2026-08": {} } }))).toBeUndefined();
  });
});
