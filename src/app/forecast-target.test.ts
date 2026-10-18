import { describe, expect, it } from "vitest";
import {
  DEFAULT_TARGET_CONFIDENCE,
  TARGET_CONFIDENCES,
  chanceSeverity,
  proposalIdOf,
  targetConfidenceOf,
  withProposal,
  withTargetConfidence,
} from "./forecast-target";
import type { ForecastScenario } from "./forecast-scenarios";

const scenario = (id: number): ForecastScenario => ({ id, name: `S${id}`, changes: [] });

describe("chanceSeverity", () => {
  it("is red below even odds", () => {
    expect(chanceSeverity(0.49, 80)).toBe("red");
  });
  it("is amber from even odds up to the goal", () => {
    expect(chanceSeverity(0.5, 80)).toBe("amber");
    expect(chanceSeverity(0.79, 80)).toBe("amber");
  });
  it("is green at the goal", () => {
    expect(chanceSeverity(0.8, 80)).toBe("green");
  });
  it("moves with the goal", () => {
    expect(chanceSeverity(0.8, 95)).toBe("amber");
    expect(chanceSeverity(0.95, 95)).toBe("green");
  });
});

describe("target confidence", () => {
  it("offers exactly 50, 80 and 95, defaulting to 80", () => {
    expect(TARGET_CONFIDENCES).toEqual([50, 80, 95]);
    expect(DEFAULT_TARGET_CONFIDENCE).toBe(80);
  });
  it("reads 80 when unset", () => {
    expect(targetConfidenceOf(undefined)).toBe(80);
    expect(targetConfidenceOf({ forecast: { showSimulation: true } })).toBe(80);
  });
  it("reads a stored value", () => {
    expect(targetConfidenceOf({ forecast: { targetConfidence: 95 } })).toBe(95);
    expect(targetConfidenceOf({ forecast: { targetConfidence: 50 } })).toBe(50);
  });
  it("stores 80 as absence", () => {
    expect(withTargetConfidence(undefined, 80)).toBeUndefined();
    expect(withTargetConfidence({ forecast: { showSimulation: true, targetConfidence: 95 } }, 80)).toEqual({
      forecast: { showSimulation: true },
    });
  });
  it("stores 50 and 95 and keeps the other fields without mutating the input", () => {
    const before = { forecast: { showSimulation: true as const, proposalScenarioId: 2 } };
    const after = withTargetConfidence(before, 95);
    expect(after).toEqual({ forecast: { showSimulation: true, proposalScenarioId: 2, targetConfidence: 95 } });
    expect(before).toEqual({ forecast: { showSimulation: true, proposalScenarioId: 2 } });
  });
  it("keeps the other override keys", () => {
    expect(withTargetConfidence({ timezone: { timezone: "UTC" } }, 50)).toEqual({
      timezone: { timezone: "UTC" },
      forecast: { targetConfidence: 50 },
    });
  });
});

describe("proposal", () => {
  it("clears a proposal back to absence, keeping the switch", () => {
    expect(withProposal({ forecast: { showSimulation: true, proposalScenarioId: 3 } }, null)).toEqual({
      forecast: { showSimulation: true },
    });
  });
  it("folds to undefined when nothing is left", () => {
    expect(withProposal({ forecast: { proposalScenarioId: 3 } }, null)).toBeUndefined();
    expect(withProposal(undefined, null)).toBeUndefined();
  });
  it("sets a proposal", () => {
    expect(withProposal(undefined, 4)).toEqual({ forecast: { proposalScenarioId: 4 } });
  });
  it("reads null when unset", () => {
    expect(proposalIdOf(undefined, [scenario(1)])).toBeNull();
  });
  it("reads null when the id names no scenario (stale id)", () => {
    expect(proposalIdOf({ forecast: { proposalScenarioId: 7 } }, [scenario(3)])).toBeNull();
  });
  it("reads the id when a scenario carries it", () => {
    expect(proposalIdOf({ forecast: { proposalScenarioId: 7 } }, [scenario(7)])).toBe(7);
  });
});
