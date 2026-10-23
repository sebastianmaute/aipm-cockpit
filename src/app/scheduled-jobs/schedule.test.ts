import { describe, it, expect } from "vitest";
import { nextRunAt, appendRun, slotFor, isRunnable } from "./schedule";
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

describe("nextRunAt", () => {
  const dailyUtc = (timeOfDay: string) =>
    mk({ cadence: { kind: "daily", timeOfDay }, timeZone: "UTC" });
  const weeklyUtc = (dayOfWeek: number, timeOfDay: string) =>
    mk({ cadence: { kind: "weekly", dayOfWeek, timeOfDay }, timeZone: "UTC" });
  it("daily: same day later today when before the slot", () => {
    expect(nextRunAt(dailyUtc("09:00"), new Date("2026-06-19T08:00:00Z"))?.toISOString()).toBe("2026-06-19T09:00:00.000Z");
  });
  it("daily: rolls to next day when already past the slot", () => {
    expect(nextRunAt(dailyUtc("09:00"), new Date("2026-06-19T10:00:00Z"))?.toISOString()).toBe("2026-06-20T09:00:00.000Z");
  });
  it("weekly: advances to the target weekday", () => {
    expect(nextRunAt(weeklyUtc(1, "09:00"), new Date("2026-06-19T10:00:00Z"))?.toISOString()).toBe("2026-06-22T09:00:00.000Z");
  });
  it("weekly: rolls a full week when same weekday but past the slot", () => {
    expect(nextRunAt(weeklyUtc(1, "09:00"), new Date("2026-06-22T10:00:00Z"))?.toISOString()).toBe("2026-06-29T09:00:00.000Z");
  });
  it("reads the slot in the job's zone", () => {
    const job = mk({ cadence: { kind: "daily", timeOfDay: "08:00" }, timeZone: "Europe/Berlin" });
    expect(nextRunAt(job, new Date("2026-10-23T07:00:00Z"))?.toISOString()).toBe("2026-10-24T06:00:00.000Z");
  });
  it("is null without a time zone", () => {
    expect(nextRunAt(mk({ timeZone: null }), new Date("2026-06-19T08:00:00Z"))).toBeNull();
  });
});

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

describe("isRunnable", () => {
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
