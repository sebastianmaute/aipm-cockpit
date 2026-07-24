import { describe, it, expect } from "vitest";
import {
  ratioHealth, marginHealth, costPerformanceHealth, costPerformanceIndexHealth, winLossHealth,
  marginAmountHealth, planVsBudgetHealth, cellHealth,
} from "./budget-health";

describe("ratioHealth (over-budget bands: G <90%, A 90-100%, R >100%)", () => {
  it("is null when budget is zero or negative", () => {
    expect(ratioHealth(10, 0)).toBeNull();
    expect(ratioHealth(10, -5)).toBeNull();
  });
  it("is Green below 90%", () => {
    expect(ratioHealth(89, 100)).toBe("G");
  });
  it("is Amber from 90% up to and including 100%", () => {
    expect(ratioHealth(90, 100)).toBe("A");
    expect(ratioHealth(100, 100)).toBe("A");
  });
  it("is Red above 100%", () => {
    expect(ratioHealth(101, 100)).toBe("R");
  });
  // budgetHours and plannedHours are the SAME sum accumulated in different
  // association orders (budget-report.ts: a per-row subtotal vs a flat running
  // sum), so two mathematically equal totals can differ by a few ULP. A strict
  // `>` then reports a 6e-14 h overrun as Red on a bucket that is exactly on
  // budget — these are the real values computeBudgetReport produced.
  it("treats a float-noise overrun as on-budget, not Red", () => {
    expect(ratioHealth(225.91520000000002710, 225.91519999999999868)).not.toBe("R");
  });
  it("still reports a genuine hair-over-budget as Red", () => {
    expect(ratioHealth(225.93, 225.915)).toBe("R");
  });
});

describe("planVsBudgetHealth (planning at or under budget is on target)", () => {
  it("is null when there is no budget to compare against", () => {
    expect(planVsBudgetHealth(10, 0)).toBeNull();
  });
  it("is Green when the plan exactly hits the budget", () => {
    expect(planVsBudgetHealth(275, 275)).toBe("G");
  });
  it("is Green when the plan is under budget", () => {
    expect(planVsBudgetHealth(200, 275)).toBe("G");
  });
  it("is Red when the plan exceeds the budget", () => {
    expect(planVsBudgetHealth(276, 275)).toBe("R");
  });
  it("ignores float noise", () => {
    expect(planVsBudgetHealth(225.91520000000002710, 225.91519999999999868)).toBe("G");
  });
});

describe("marginHealth (R <0, A 0-15%, G >=15%)", () => {
  it("passes null through", () => { expect(marginHealth(null)).toBeNull(); });
  it("is Red for negative margin", () => { expect(marginHealth(-0.1)).toBe("R"); });
  it("is Amber from 0 up to (not including) 15%", () => {
    expect(marginHealth(0)).toBe("A");
    expect(marginHealth(14.9)).toBe("A");
  });
  it("is Green at 15% and above", () => { expect(marginHealth(15)).toBe("G"); });
});

describe("costPerformanceHealth (percent = budgetCost/cost*100; R <80, A <90, G >=90)", () => {
  it("passes null through", () => { expect(costPerformanceHealth(null)).toBeNull(); });
  it("is Red below 80", () => { expect(costPerformanceHealth(79.9)).toBe("R"); });
  it("is Amber from 80 to <90", () => {
    expect(costPerformanceHealth(80)).toBe("A");
    expect(costPerformanceHealth(89.9)).toBe("A");
  });
  it("is Green at 90 and above", () => { expect(costPerformanceHealth(90)).toBe("G"); });
});

describe("costPerformanceIndexHealth (EV/AC ratio; R <0.8, A <0.9, G >=0.9)", () => {
  it("passes null through", () => { expect(costPerformanceIndexHealth(null)).toBeNull(); });
  it("is Red below 0.8", () => { expect(costPerformanceIndexHealth(0.799)).toBe("R"); });
  it("is Amber from 0.8 to <0.9", () => {
    expect(costPerformanceIndexHealth(0.8)).toBe("A");
    expect(costPerformanceIndexHealth(0.899)).toBe("A");
  });
  it("is Green at 0.9 and above", () => { expect(costPerformanceIndexHealth(0.9)).toBe("G"); });
  it("is Green above 1.0 (earning value faster than spending)", () => {
    expect(costPerformanceIndexHealth(1.2)).toBe("G");
  });
});

describe("winLossHealth (mirrors consumption ratio)", () => {
  it("is Red when consumed exceeds budget", () => { expect(winLossHealth(110, 100)).toBe("R"); });
  it("is Amber in the 90-100% consumption band", () => { expect(winLossHealth(95, 100)).toBe("A"); });
  it("is Green when comfortably under", () => { expect(winLossHealth(50, 100)).toBe("G"); });
  it("is null when no budget", () => { expect(winLossHealth(50, 0)).toBeNull(); });
});

describe("marginAmountHealth", () => {
  it("returns null when external revenue is zero or negative", () => {
    expect(marginAmountHealth(50, 0)).toBeNull();
    expect(marginAmountHealth(50, -10)).toBeNull();
  });
  it("is Green at >=15% margin", () => {
    expect(marginAmountHealth(15, 100)).toBe("G"); // 15%
    expect(marginAmountHealth(30, 100)).toBe("G");
  });
  it("is Amber between 0 and 15%", () => {
    expect(marginAmountHealth(14.9, 100)).toBe("A");
    expect(marginAmountHealth(0, 100)).toBe("A");
  });
  it("is Red below 0", () => {
    expect(marginAmountHealth(-0.1, 100)).toBe("R");
  });
  it("returns null when margin is NaN", () => {
    expect(marginAmountHealth(NaN, 100)).toBeNull();
  });
});

describe("cellHealth (period-aware)", () => {
  it("is null when there is nothing planned", () => {
    expect(cellHealth(0, 0, "2026-07-31", "2026-08-15")).toBeNull();
  });
  it("is Green for an untouched FUTURE period", () => {
    expect(cellHealth(0, 30, "2026-09-30", "2026-08-15")).toBe("G");
  });
  it("is Amber when a CLOSED period booked nothing against a real budget", () => {
    expect(cellHealth(0, 30, "2026-07-31", "2026-08-15")).toBe("A");
  });
  // A period whose last day is today has not closed yet — there is still time
  // left to book against it, so an empty CURRENT period is not yet a signal.
  it("is Green for the CURRENT period (ends today) with nothing booked", () => {
    expect(cellHealth(0, 30, "2026-08-15", "2026-08-15")).toBe("G");
  });
  it("otherwise defers to the consumption bands", () => {
    expect(cellHealth(31, 30, "2026-07-31", "2026-08-15")).toBe("R");
    expect(cellHealth(10, 30, "2026-07-31", "2026-08-15")).toBe("G");
  });
});
