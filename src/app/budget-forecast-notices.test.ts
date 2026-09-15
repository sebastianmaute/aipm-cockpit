import { describe, expect, it } from "vitest";
import { forecastNotices } from "./budget-forecast-notices";
import type { BudgetForecast, PaceForecast } from "./budget-forecast";

const facts = { bac: 1, ac: 1, remaining: 0, ev: 1, percentComplete: 100 };
const pace = { burnRatePerDay: 1, windowDays: 20, windowStart: "2026-08-17", windowEnd: "2026-09-11", spreadPeriodHoursUsed: false,
  workingDaysLeft: 0, etc: 0, eac: 1, vac: 0, runOutDate: null, daysBeforePlannedEnd: null } as PaceForecast;
const eff = { pv: 1, cpi: 1, spi: 1, etc: 0, eac: 1, vac: 0 };
const make = (over: Partial<BudgetForecast>): BudgetForecast => ({ facts, pace, efficiency: eff, gap: null, hasFixedPrice: false, ...over });

describe("forecastNotices", () => {
  it("none when both forecasts ran on booked days", () => {
    expect(forecastNotices(make({}))).toEqual([]);
  });
  it("starts-on when bookings exist", () => {
    expect(forecastNotices(make({ pace: { unavailable: "not-enough-bookings", firstBookingDate: "2026-09-15", bookedWorkingDays: 13, availableFrom: "2026-10-13" } })))
      .toEqual([{ kind: "starts-on", severity: "info", availableFrom: "2026-10-13", bookedWorkingDays: 13, firstBookingDate: "2026-09-15" }]);
  });
  it("starts-once-booked when nothing is booked", () => {
    expect(forecastNotices(make({ pace: { unavailable: "not-enough-bookings", firstBookingDate: null, bookedWorkingDays: 0, availableFrom: null } })))
      .toEqual([{ kind: "starts-once-booked", severity: "info" }]);
  });
  it("no-burn is a warning", () => {
    expect(forecastNotices(make({ pace: { unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null } })))
      .toEqual([{ kind: "no-burn", severity: "warn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null }]);
  });
  it("stacks spread and needs-percent in table order", () => {
    const n = forecastNotices(make({
      pace: { ...pace, spreadPeriodHoursUsed: true },
      efficiency: { unavailable: "needs-percent-complete", bucketsMissingPercent: [{ id: 2, name: "Design" }, { id: 3, name: "Rollout" }] },
    }));
    expect(n.map((x) => x.kind)).toEqual(["spread", "needs-percent"]);
    expect(n[1]).toEqual({ kind: "needs-percent", severity: "info", bucketNames: ["Design", "Rollout"] });
  });
  it("no-actual-cost and no-earned-value give no notice", () => {
    expect(forecastNotices(make({ efficiency: { unavailable: "no-actual-cost" } }))).toEqual([]);
    expect(forecastNotices(make({ efficiency: { unavailable: "no-earned-value" } }))).toEqual([]);
  });
});
