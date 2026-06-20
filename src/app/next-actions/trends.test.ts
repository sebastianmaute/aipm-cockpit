import { describe, it, expect } from "vitest";
import { computeActionTrends, summarizeTrendsForPrompt } from "./trends";
import type { SnapshotRecord } from "../snapshot";

function snap(over: Partial<SnapshotRecord>): SnapshotRecord {
  return {
    id: "x", capturedAt: "2026-01-01T00:00:00.000Z", bucket: "2026-W01",
    cadence: "weekly", trigger: "auto", isBaseline: false,
    remainingHours: null, remainingCost: null, pctComplete: 0,
    forecastEndDate: "2026-12-31", planEndDate: "2026-12-31",
    spi: null, cpi: null, overallRag: "", scheduleRag: "", budgetRag: "",
    scopeRag: "", currency: "EUR", milestones: [], series: [],
    ...over,
  };
}

describe("computeActionTrends", () => {
  it("returns undefined with fewer than two snapshots", () => {
    expect(computeActionTrends([])).toBeUndefined();
    expect(computeActionTrends([snap({})])).toBeUndefined();
  });
  it("flags rising remaining cost as worsening budget", () => {
    const t = computeActionTrends([
      snap({ capturedAt: "2026-01-01T00:00:00.000Z", remainingCost: 100 }),
      snap({ capturedAt: "2026-01-08T00:00:00.000Z", remainingCost: 200 }),
    ]);
    expect(t?.budget).toBe("worsening");
  });
  it("flags falling remaining cost as improving budget", () => {
    const t = computeActionTrends([
      snap({ capturedAt: "2026-01-01T00:00:00.000Z", remainingCost: 200 }),
      snap({ capturedAt: "2026-01-08T00:00:00.000Z", remainingCost: 100 }),
    ]);
    expect(t?.budget).toBe("improving");
  });
  it("treats equal cost (within epsilon) as flat", () => {
    const t = computeActionTrends([
      snap({ capturedAt: "2026-01-01T00:00:00.000Z", remainingCost: 100 }),
      snap({ capturedAt: "2026-01-08T00:00:00.000Z", remainingCost: 100 }),
    ]);
    expect(t?.budget).toBe("flat");
  });
  it("falls back to budgetRag movement when cost is null", () => {
    const t = computeActionTrends([
      snap({ capturedAt: "2026-01-01T00:00:00.000Z", budgetRag: "A" }),
      snap({ capturedAt: "2026-01-08T00:00:00.000Z", budgetRag: "R" }),
    ]);
    expect(t?.budget).toBe("worsening");
  });
  it("flags dropping SPI as worsening schedule, omits when null", () => {
    const t = computeActionTrends([
      snap({ capturedAt: "2026-01-01T00:00:00.000Z", spi: 1.0 }),
      snap({ capturedAt: "2026-01-08T00:00:00.000Z", spi: 0.8 }),
    ]);
    expect(t?.schedule).toBe("worsening");
    const none = computeActionTrends([
      snap({ capturedAt: "2026-01-01T00:00:00.000Z", spi: null }),
      snap({ capturedAt: "2026-01-08T00:00:00.000Z", spi: 0.8 }),
    ]);
    expect(none?.schedule).toBeUndefined();
  });
});

describe("summarizeTrendsForPrompt", () => {
  it("returns a clear sentinel for undefined trends", () => {
    expect(summarizeTrendsForPrompt(undefined)).toBe("(no trend data)");
  });
  it("returns a clear sentinel for an empty trends object", () => {
    expect(summarizeTrendsForPrompt({})).toBe("(no trend data)");
  });
  it("summarizes schedule before budget", () => {
    expect(summarizeTrendsForPrompt({ schedule: "worsening", budget: "improving" })).toBe(
      "schedule: worsening, budget: improving",
    );
  });
  it("includes only the metrics that are present", () => {
    expect(summarizeTrendsForPrompt({ budget: "flat" })).toBe("budget: flat");
    expect(summarizeTrendsForPrompt({ schedule: "improving" })).toBe("schedule: improving");
  });
});
