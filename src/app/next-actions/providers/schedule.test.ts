import { describe, expect, it } from "vitest";
import { scheduleProvider } from "./schedule";
import type { ActionInput } from "../types";

function input(spi: number | null): ActionInput {
  return {
    tasks: [], raid: [], changes: [], milestones: [], stakeholders: [], commsReminders: [],
    dashboard: { evm: { spi }, schedule: { effective: "A" }, burndown: null } as ActionInput["dashboard"],
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
    expect(a[0].score).toBeGreaterThanOrEqual(60);
  });
  it("emits a soon-tier action when SPI is 0.8-0.9", () => {
    const a = scheduleProvider.provide(input(0.85));
    expect(a).toHaveLength(1);
    expect(a[0].score).toBeGreaterThanOrEqual(30);
    expect(a[0].score).toBeLessThan(60);
  });
  it("emits nothing when SPI >= 0.9", () => {
    expect(scheduleProvider.provide(input(0.95))).toEqual([]);
  });
  it("emits nothing when SPI is null", () => {
    expect(scheduleProvider.provide(input(null))).toEqual([]);
  });
});
