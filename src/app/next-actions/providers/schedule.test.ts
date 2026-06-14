import { describe, expect, it } from "vitest";
import { scheduleProvider } from "./schedule";
import { ACTION_WEIGHTS } from "../score";
import type { ActionInput } from "../types";
import type { DashboardModel } from "../../dashboard";

function input(spi: number | null): ActionInput {
  return {
    tasks: [], raid: [], changes: [], milestones: [], stakeholders: [], commsReminders: [],
    dashboard: { evm: { spi }, schedule: { effective: "A" }, burndown: null } as unknown as DashboardModel,
    features: [], today: "2026-06-15", projectName: "Demo", now: new Date("2026-06-15T00:00:00Z"),
    reminderLeadDays: 0, dueSoonWorkdays: 3, raidReviewIntervalDays: 30, dismissed: new Set(),
  } as ActionInput;
}

describe("scheduleProvider", () => {
  it("emits a now-tier action when SPI < 0.8", () => {
    const a = scheduleProvider.provide(input(0.7));
    expect(a).toHaveLength(1);
    expect(a[0].id).toBe("schedule:project:spi");
    expect(a[0].source).toBe("schedule");
    expect(a[0].cta).toEqual({ kind: "open", view: "dashboard", id: 0 });
    // urgencyOverdue + riskCritical - staticPenalty
    expect(a[0].score).toBe(ACTION_WEIGHTS.urgencyOverdue + ACTION_WEIGHTS.riskCritical - ACTION_WEIGHTS.staticPenalty);
  });
  it("emits a soon-tier action when SPI is 0.8-0.9", () => {
    const a = scheduleProvider.provide(input(0.85));
    expect(a).toHaveLength(1);
    // urgencySoon + riskHigh - staticPenalty
    expect(a[0].score).toBe(ACTION_WEIGHTS.urgencySoon + ACTION_WEIGHTS.riskHigh - ACTION_WEIGHTS.staticPenalty);
  });
  it("emits nothing when SPI >= 0.9", () => {
    expect(scheduleProvider.provide(input(0.95))).toEqual([]);
  });
  it("emits nothing when SPI is null", () => {
    expect(scheduleProvider.provide(input(null))).toEqual([]);
  });
  it("honors overridden SPI warn/critical thresholds", () => {
    // SPI 0.92 is below an overridden warn of 0.95 → fires; below crit 0.93 → now-tier.
    const a = scheduleProvider.provide({ ...input(0.92), scheduleSpiWarn: 0.95, scheduleSpiCritical: 0.93 });
    expect(a).toHaveLength(1);
    expect(a[0].score).toBe(ACTION_WEIGHTS.urgencyOverdue + ACTION_WEIGHTS.riskCritical - ACTION_WEIGHTS.staticPenalty);
    // With a stricter warn of 0.9 (default), 0.92 would NOT fire.
    expect(scheduleProvider.provide({ ...input(0.92), scheduleSpiWarn: 0.9 })).toEqual([]);
  });
});

describe("schedule confidence", () => {
  function inputConf(over: Record<string, unknown> = {}): ActionInput {
    return {
      tasks: [], raid: [], changes: [], milestones: [], stakeholders: [],
      commsReminders: [], features: [], projectName: "P",
      today: "2026-01-01", now: new Date("2026-01-01T00:00:00Z"),
      reminderLeadDays: 7, dueSoonWorkdays: 5, raidReviewIntervalDays: 14,
      dismissed: new Set<string>(),
      dashboard: { budget: { effective: "G" }, evm: { spi: 0.7 } } as unknown as DashboardModel,
      ...over,
    } as ActionInput;
  }
  it("applies a static penalty to the aggregate SPI signal", () => {
    const [a] = scheduleProvider.provide(inputConf());
    // spi 0.7 < critical 0.8: urgencyOverdue + riskCritical - staticPenalty
    expect(a.score).toBe(ACTION_WEIGHTS.urgencyOverdue + ACTION_WEIGHTS.riskCritical - ACTION_WEIGHTS.staticPenalty);
  });
  it("uses the plain behind why when no trend", () => {
    const [a] = scheduleProvider.provide(inputConf());
    expect(a.why.key).toBe("actionScheduleWhyBehind");
  });
  it("halves the penalty when worsening", () => {
    const [a] = scheduleProvider.provide(inputConf({ trends: { schedule: "worsening" } }));
    const halved = Math.round(ACTION_WEIGHTS.staticPenalty / 2);
    expect(a.score).toBe(ACTION_WEIGHTS.urgencyOverdue + ACTION_WEIGHTS.riskCritical - halved);
  });
  it("uses the slipping why when worsening", () => {
    const [a] = scheduleProvider.provide(inputConf({ trends: { schedule: "worsening" } }));
    expect(a.why.key).toBe("actionScheduleWhySlipping");
  });
});
