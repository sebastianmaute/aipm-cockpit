import { describe, it, expect } from "vitest";
import {
  ratioHealth, marginHealth, costPerformanceHealth, winLossHealth, marginAmountHealth,
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
