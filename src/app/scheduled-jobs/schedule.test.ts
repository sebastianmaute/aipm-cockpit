import { describe, it, expect } from "vitest";
import { appendRun, slotFor, isRunnable, periodStartFor } from "./schedule";
import type { ScheduledJob } from "./types";

function daily(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return { id: 1, name: "Daily", type: "portfolioAnalysis",
    cadence: { kind: "daily", timeOfDay: "09:00" },
    enabled: true, projectId: null, timeZone: null, key: null, lastRunAt: null, history: [], ...over };
}

/** An enabled, runnable job (project, key and zone set) unless overridden. */
function mk(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return daily({ projectId: "p1", key: "k1", timeZone: "UTC", ...over });
}

describe("slotFor", () => {
  it("computes a daily slot in the job's zone as a UTC instant", () => {
    const job = mk({ cadence: { kind: "daily", timeOfDay: "08:00" }, timeZone: "Europe/Berlin" });
    expect(slotFor(job, new Date("2026-10-23T07:00:00Z"))?.toISOString()).toBe("2026-10-23T06:00:00.000Z");
    expect(slotFor(job, new Date("2026-10-23T05:59:00Z"))).toBeNull();
  });
  it("finds a weekly slot on the zone's weekday, not UTC's", () => {
    const job = mk({ cadence: { kind: "weekly", dayOfWeek: 1, timeOfDay: "00:30" }, timeZone: "Europe/Berlin" });
    // Monday 2026-10-26 00:30 Berlin (CET, UTC+1) = Sunday 23:30 UTC
    expect(slotFor(job, new Date("2026-10-25T23:40:00Z"))?.toISOString()).toBe("2026-10-25T23:30:00.000Z");
  });
  it("is null on a weekly job's other weekdays", () => {
    const job = mk({ cadence: { kind: "weekly", dayOfWeek: 1, timeOfDay: "08:00" }, timeZone: "UTC" });
    expect(slotFor(job, new Date("2026-10-23T12:00:00Z"))).toBeNull(); // Friday
  });
  it("runs once across the spring-forward gap", () => {
    const job = mk({ cadence: { kind: "daily", timeOfDay: "02:30" }, timeZone: "Europe/Berlin" });
    expect(slotFor(job, new Date("2027-03-28T02:00:00Z"))?.toISOString()).toBe("2027-03-28T01:00:00.000Z"); // 03:00 CEST, first valid instant
  });
  it("runs once on the fall-back day (earlier of the two 02:30s)", () => {
    const job = mk({ cadence: { kind: "daily", timeOfDay: "02:30" }, timeZone: "Europe/Berlin" });
    expect(slotFor(job, new Date("2026-10-25T03:00:00Z"))?.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
  it("keeps the fall-back slot after the second 02:30 has passed", () => {
    const job = mk({ cadence: { kind: "daily", timeOfDay: "02:30" }, timeZone: "Europe/Berlin" });
    expect(slotFor(job, new Date("2026-10-25T01:45:00Z"))?.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
  it("reads a half-hour-offset zone (Asia/Kolkata)", () => {
    const job = mk({ cadence: { kind: "daily", timeOfDay: "09:00" }, timeZone: "Asia/Kolkata" });
    expect(slotFor(job, new Date("2026-10-23T05:00:00Z"))?.toISOString()).toBe("2026-10-23T03:30:00.000Z");
  });
  it("uses the zone's date when it is ahead of UTC (Pacific/Kiritimati, +14)", () => {
    const job = mk({ cadence: { kind: "daily", timeOfDay: "08:00" }, timeZone: "Pacific/Kiritimati" });
    // 12:00Z is 02:00 on the 24th there: that day's 08:00 slot (2026-10-23T18:00Z) is not reached yet.
    expect(slotFor(job, new Date("2026-10-23T12:00:00Z"))).toBeNull();
    expect(slotFor(job, new Date("2026-10-23T18:30:00Z"))?.toISOString()).toBe("2026-10-23T18:00:00.000Z");
  });
  it("is null without a time zone", () => {
    expect(slotFor(mk({ timeZone: null }), new Date("2026-10-23T12:00:00Z"))).toBeNull();
  });
});

describe("slotFor across a western-hemisphere DST change (America/New_York)", () => {
  it("runs once across the spring-forward gap (02:30 does not exist on 2026-03-08)", () => {
    const job = mk({ cadence: { kind: "daily", timeOfDay: "02:30" }, timeZone: "America/New_York" });
    expect(slotFor(job, new Date("2026-03-08T06:00:00Z"))).toBeNull(); // 01:00 EST: not reached
    expect(slotFor(job, new Date("2026-03-08T12:00:00Z"))?.toISOString()).toBe("2026-03-08T07:00:00.000Z"); // 03:00 EDT, first valid instant
  });
  it("runs once on the fall-back day, at the earlier of the two 01:30s", () => {
    const job = mk({ cadence: { kind: "daily", timeOfDay: "01:30" }, timeZone: "America/New_York" });
    expect(slotFor(job, new Date("2026-11-01T12:00:00Z"))?.toISOString()).toBe("2026-11-01T05:30:00.000Z"); // 01:30 EDT
    expect(slotFor(job, new Date("2026-11-01T06:45:00Z"))?.toISOString()).toBe("2026-11-01T05:30:00.000Z"); // still the first one after the second 01:30 EST began
  });
  it("a weekly job on the DST-change Sunday keeps its local time", () => {
    const job = mk({ cadence: { kind: "weekly", dayOfWeek: 0, timeOfDay: "09:00" }, timeZone: "America/New_York" });
    expect(slotFor(job, new Date("2026-03-08T14:00:00Z"))?.toISOString()).toBe("2026-03-08T13:00:00.000Z"); // 09:00 EDT
    expect(slotFor(job, new Date("2026-03-09T14:00:00Z"))).toBeNull(); // Monday
  });
});

describe("isRunnable", () => {
  it("is never runnable for a foreign job", () => {
    expect(isRunnable(mk({ foreign: { raw: { id: 1, type: "future" } } }))).toBe(false);
  });
  it("is never runnable without a project, key or time zone", () => {
    expect(isRunnable(mk({ projectId: null }))).toBe(false);
    expect(isRunnable(mk({ key: null }))).toBe(false);
    expect(isRunnable(mk({ timeZone: null }))).toBe(false);
    expect(isRunnable(mk({ enabled: false }))).toBe(false);
    expect(isRunnable(mk({}))).toBe(true);
  });
});

describe("appendRun", () => {
  it("prepends newest, caps history, sets lastRunAt immutably", () => {
    let job = daily();
    for (let i = 0; i < 12; i++) {
      job = appendRun(job, { ranAt: `2026-06-${10 + i}T09:00:00.000Z`, summary: `r${i}`, actionCount: i, ok: true });
    }
    expect(job.history).toHaveLength(10);
    expect(job.history[0].summary).toBe("r11");
    expect(job.lastRunAt).toBe("2026-06-21T09:00:00.000Z");
  });
});

describe("periodStartFor: where the cadence period begins, in the job's current zone (owner decision: one run per period)", () => {
  const daily = (tz: string) => mk({ cadence: { kind: "daily", timeOfDay: "09:00" }, timeZone: tz });
  const weekly = (tz: string, dayOfWeek: number) => mk({ cadence: { kind: "weekly", dayOfWeek, timeOfDay: "09:00" }, timeZone: tz });
  const iso = (d: Date | null) => d?.toISOString();

  // KILLED BY: starting the period at the slot instead of local midnight.
  it("daily: local midnight of the slot's day", () => {
    expect(iso(periodStartFor(daily("Europe/Berlin"), new Date("2026-10-23T07:00:00Z")))).toBe("2026-10-22T22:00:00.000Z");
    expect(iso(periodStartFor(daily("UTC"), new Date("2026-10-23T09:00:00Z")))).toBe("2026-10-23T00:00:00.000Z");
  });
  it("daily: follows the zone it is given (a zone moved west starts the day later in UTC)", () => {
    expect(iso(periodStartFor(daily("America/New_York"), new Date("2026-10-23T13:00:00Z")))).toBe("2026-10-23T04:00:00.000Z");
  });
  // KILLED BY: a fixed 24-hour day.
  it.each([
    ["Berlin spring-forward day (23 h)", "Europe/Berlin", "2027-03-28T07:00:00Z", "2027-03-27T23:00:00.000Z"],
    ["Berlin fall-back day (25 h)", "Europe/Berlin", "2026-10-25T08:00:00Z", "2026-10-24T22:00:00.000Z"],
    ["the day after Berlin's fall-back", "Europe/Berlin", "2026-10-26T08:00:00Z", "2026-10-25T23:00:00.000Z"],
    ["New York spring-forward day (23 h)", "America/New_York", "2026-03-08T13:00:00Z", "2026-03-08T05:00:00.000Z"],
    ["New York fall-back day (25 h)", "America/New_York", "2026-11-01T14:00:00Z", "2026-11-01T04:00:00.000Z"],
    // The clocks jump at midnight, so local midnight does not exist: the day starts at the first valid instant (01:00).
    ["Santiago, the day its midnight does not exist", "America/Santiago", "2026-09-06T12:00:00Z", "2026-09-06T04:00:00.000Z"],
    ["Havana, the day its midnight does not exist", "America/Havana", "2026-03-08T13:00:00Z", "2026-03-08T05:00:00.000Z"],
  ])("daily on %s", (_n, tz, at, start) => {
    expect(iso(periodStartFor(daily(tz), new Date(at)))).toBe(start);
  });
  // KILLED BY: starting the week on Sunday, or at the job's weekday.
  it("weekly: local midnight of the Monday of the ISO week, whatever weekday the job runs on", () => {
    expect(iso(periodStartFor(weekly("Europe/Berlin", 4), new Date("2026-10-22T07:00:00Z")))).toBe("2026-10-18T22:00:00.000Z"); // Thu -> Mon 19th
    expect(iso(periodStartFor(weekly("Europe/Berlin", 1), new Date("2026-10-19T07:00:00Z")))).toBe("2026-10-18T22:00:00.000Z"); // Mon itself
    expect(iso(periodStartFor(weekly("Europe/Berlin", 0), new Date("2026-10-25T08:00:00Z")))).toBe("2026-10-18T22:00:00.000Z"); // Sun belongs to the week that started Mon 19th
  });
  it("weekly: a week that contains a DST change still starts at local midnight (New York, 2026-03-08)", () => {
    expect(iso(periodStartFor(weekly("America/New_York", 3), new Date("2026-03-11T13:00:00Z")))).toBe("2026-03-09T04:00:00.000Z"); // Mon 9th, EDT
    expect(iso(periodStartFor(weekly("America/New_York", 0), new Date("2026-03-08T13:00:00Z")))).toBe("2026-03-02T05:00:00.000Z"); // Mon 2nd, EST
  });
  it("is null without a zone", () => {
    expect(periodStartFor(mk({ timeZone: null }), new Date("2026-10-23T07:00:00Z"))).toBeNull();
  });
});
