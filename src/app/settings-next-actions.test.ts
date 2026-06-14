import { describe, it, expect } from "vitest";
import { resolveNextActionsConfig, defaultNextActionsConfig } from "./settings-types";

describe("resolveNextActionsConfig", () => {
  it("returns a fresh copy of the defaults when given undefined/garbage", () => {
    expect(resolveNextActionsConfig(undefined)).toEqual(defaultNextActionsConfig);
    expect(resolveNextActionsConfig(null)).toEqual(defaultNextActionsConfig);
    expect(resolveNextActionsConfig(42)).toEqual(defaultNextActionsConfig);
    // not the same object reference
    expect(resolveNextActionsConfig(undefined)).not.toBe(defaultNextActionsConfig);
  });

  it("keeps valid overrides and rounds count/percent fields", () => {
    const out = resolveNextActionsConfig({
      scopePendingRed: 8.6,
      scheduleSpiWarn: 0.95,
      scheduleSpiCritical: 0.85,
      workloadAllocatedPct: 90,
      workloadAllocatedCritical: 150,
      workloadOverdueThreshold: 2,
      workloadOverdueUrgent: 6,
    });
    expect(out).toEqual({
      scopePendingRed: 9,
      scheduleSpiWarn: 0.95,
      scheduleSpiCritical: 0.85,
      workloadAllocatedPct: 90,
      workloadAllocatedCritical: 150,
      workloadOverdueThreshold: 2,
      workloadOverdueUrgent: 6,
      clarityBonus: 15,
      semiClarityBonus: 7,
      staticPenalty: 25,
    });
  });

  it("falls back per-field for invalid values (out of range / non-numeric)", () => {
    const out = resolveNextActionsConfig({
      scopePendingRed: 0, // < 1 → default
      scheduleSpiWarn: 3, // > 2 → default
      scheduleSpiCritical: "x", // NaN → default
      workloadAllocatedPct: -5, // < 1 → default
    });
    expect(out.scopePendingRed).toBe(defaultNextActionsConfig.scopePendingRed);
    expect(out.scheduleSpiWarn).toBe(defaultNextActionsConfig.scheduleSpiWarn);
    expect(out.scheduleSpiCritical).toBe(defaultNextActionsConfig.scheduleSpiCritical);
    expect(out.workloadAllocatedPct).toBe(defaultNextActionsConfig.workloadAllocatedPct);
  });
});

describe("ranking weights", () => {
  it("defaults to 15 / 7 / 25", () => {
    expect(defaultNextActionsConfig.clarityBonus).toBe(15);
    expect(defaultNextActionsConfig.semiClarityBonus).toBe(7);
    expect(defaultNextActionsConfig.staticPenalty).toBe(25);
  });
  it("coerces overrides and allows zero", () => {
    const c = resolveNextActionsConfig({ clarityBonus: 0, semiClarityBonus: 3, staticPenalty: 40 });
    expect(c.clarityBonus).toBe(0);
    expect(c.semiClarityBonus).toBe(3);
    expect(c.staticPenalty).toBe(40);
  });
  it("falls back to defaults on invalid input", () => {
    const c = resolveNextActionsConfig({ clarityBonus: -5, staticPenalty: "x" });
    expect(c.clarityBonus).toBe(15);
    expect(c.staticPenalty).toBe(25);
  });
  it("falls back to default for an invalid semiClarityBonus", () => {
    expect(resolveNextActionsConfig({ semiClarityBonus: -3 }).semiClarityBonus).toBe(7);
  });
});
