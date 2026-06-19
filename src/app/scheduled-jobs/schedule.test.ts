import { describe, it, expect } from "vitest";
import { nextRunAt, isDue, dueJobs, appendRun } from "./schedule";
import type { ScheduledJob } from "./types";

function daily(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return { id: 1, name: "Daily", type: "portfolioAnalysis",
    cadence: { kind: "daily", timeOfDay: "09:00" },
    enabled: true, lastRunAt: null, history: [], ...over };
}

describe("isDue (daily, catch-up)", () => {
  it("not due before the slot time", () => {
    expect(isDue(daily(), new Date("2026-06-19T08:00:00"))).toBe(false);
  });
  it("due once after the slot when never run", () => {
    expect(isDue(daily(), new Date("2026-06-19T09:30:00"))).toBe(true);
  });
  it("not due again the same slot once it has run", () => {
    const job = daily({ lastRunAt: new Date("2026-06-19T09:05:00").toISOString() });
    expect(isDue(job, new Date("2026-06-19T10:00:00"))).toBe(false);
  });
  it("due next day even though it ran yesterday (catch-up)", () => {
    const job = daily({ lastRunAt: new Date("2026-06-19T09:05:00").toISOString() });
    expect(isDue(job, new Date("2026-06-20T09:30:00"))).toBe(true);
  });
  it("disabled is never due", () => {
    expect(isDue(daily({ enabled: false }), new Date("2026-06-19T10:00:00"))).toBe(false);
  });
});

describe("isDue (weekly)", () => {
  const weekly = (): ScheduledJob => daily({
    cadence: { kind: "weekly", dayOfWeek: 1, timeOfDay: "09:00" }, // Monday
  });
  it("not due on the wrong weekday", () => {
    expect(isDue(weekly(), new Date("2026-06-19T10:00:00"))).toBe(false); // Fri
  });
  it("due on the right weekday after the time", () => {
    expect(isDue(weekly(), new Date("2026-06-22T09:30:00"))).toBe(true); // Mon
  });
});

describe("nextRunAt", () => {
  it("daily: same day later today when before the slot", () => {
    const next = nextRunAt({ kind: "daily", timeOfDay: "09:00" }, new Date("2026-06-19T08:00:00"));
    expect(next).toEqual(new Date("2026-06-19T09:00:00"));
  });
  it("daily: rolls to next day when already past the slot", () => {
    const next = nextRunAt({ kind: "daily", timeOfDay: "09:00" }, new Date("2026-06-19T10:00:00"));
    expect(next).toEqual(new Date("2026-06-20T09:00:00"));
  });
  it("weekly: advances to the target weekday", () => {
    const next = nextRunAt({ kind: "weekly", dayOfWeek: 1, timeOfDay: "09:00" }, new Date("2026-06-19T10:00:00")); // Fri
    expect(next).toEqual(new Date("2026-06-22T09:00:00")); // following Mon
  });
  it("weekly: rolls a full week when same weekday but past the slot", () => {
    const next = nextRunAt({ kind: "weekly", dayOfWeek: 1, timeOfDay: "09:00" }, new Date("2026-06-22T10:00:00")); // Mon past slot
    expect(next).toEqual(new Date("2026-06-29T09:00:00")); // next Mon
  });
});

describe("dueJobs", () => {
  it("returns only enabled, due jobs", () => {
    const a = daily({ id: 1 });
    const b = daily({ id: 2, enabled: false });
    expect(dueJobs([a, b], new Date("2026-06-19T09:30:00")).map((j) => j.id)).toEqual([1]);
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
