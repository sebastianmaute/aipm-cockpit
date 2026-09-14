import { describe, expect, it } from "vitest";
import {
  actualHoursAt, actualHoursIn, granularityOfPeriodKey, hasDayKeysIn, isDayKey, withoutPeriod,
} from "./actual-hours";

describe("isDayKey", () => {
  it("accepts a calendar-shaped day and rejects period keys and junk", () => {
    expect(isDayKey("2026-06-10")).toBe(true);
    expect(isDayKey("2026-06")).toBe(false);
    expect(isDayKey("2026-W24")).toBe(false);
    expect(isDayKey("2026-13-01")).toBe(false);
    expect(isDayKey("2026-06-32")).toBe(false);
    expect(isDayKey("05/01/2026")).toBe(false);
    expect(isDayKey("")).toBe(false);
  });
});

describe("granularityOfPeriodKey", () => {
  it("reads month and week keys and refuses anything else", () => {
    expect(granularityOfPeriodKey("2026-06")).toBe("month");
    expect(granularityOfPeriodKey("2026-W24")).toBe("week");
    expect(granularityOfPeriodKey("2026-06-10")).toBeNull();
    expect(granularityOfPeriodKey("NaN-WNaN")).toBeNull();
  });
});

describe("actualHoursIn / actualHoursAt", () => {
  const map = { "2026-06": 2, "2026-06-10": 3, "2026-06-30": 1.5, "2026-07-01": 7 };

  it("sums the period key and every day key inside a month", () => {
    expect(actualHoursIn(map, "2026-06")).toBe(6.5);
    expect(actualHoursIn(map, "2026-07")).toBe(7);
  });

  it("assigns day keys to ISO weeks", () => {
    // 2026-06-10 is Wednesday of 2026-W24; 2026-06-30 is Tuesday of 2026-W27.
    expect(actualHoursIn(map, "2026-W24")).toBe(3);
    expect(actualHoursIn(map, "2026-W27")).toBe(8.5);
  });

  it("returns 0 from actualHoursIn and undefined from actualHoursAt for an empty period", () => {
    expect(actualHoursIn(map, "2026-08")).toBe(0);
    expect(actualHoursAt(map, "2026-08")).toBeUndefined();
    expect(actualHoursAt({ "2026-08": 0 }, "2026-08")).toBe(0);
    expect(actualHoursAt(map, "2026-06")).toBe(6.5);
  });

  it("reduces to the plain lookup for a period-only map", () => {
    const periodOnly = { "2026-01": 40, "2026-02": 12 };
    expect(actualHoursIn(periodOnly, "2026-01")).toBe(40);
    expect(actualHoursAt(periodOnly, "2026-03")).toBeUndefined();
  });

  it("ignores a key that is neither a period nor a day", () => {
    expect(actualHoursIn({ "": 5, "NaN-WNaN": 5, "2026-06": 1 }, "2026-06")).toBe(1);
  });
});

describe("hasDayKeysIn", () => {
  it("is true only when a day key falls inside the period", () => {
    const map = { "2026-06": 2, "2026-07-01": 7 };
    expect(hasDayKeysIn(map, "2026-06")).toBe(false);
    expect(hasDayKeysIn(map, "2026-07")).toBe(true);
  });
});

describe("withoutPeriod", () => {
  it("removes the period key and its day keys, keeps everything else, and does not mutate", () => {
    const map = { "2026-06": 2, "2026-06-10": 3, "2026-07-01": 7, "2026-W24": 9 };
    const out = withoutPeriod(map, "2026-06");
    expect(out).toEqual({ "2026-07-01": 7, "2026-W24": 9 });
    expect(map).toEqual({ "2026-06": 2, "2026-06-10": 3, "2026-07-01": 7, "2026-W24": 9 });
  });
});
