// src/app/portfolio-rollup.test.ts
import { describe, it, expect } from "vitest";
import {
  aggregatePortfolio,
  deriveMilestoneHealthBucket,
  type PortfolioRow,
} from "./portfolio-rollup";

const baseRow = (overrides: Partial<PortfolioRow> = {}): PortfolioRow => ({
  id: "p1",
  name: "Project 1",
  overall: "G",
  schedule: "G",
  budget: null,
  completionPercent: 50,
  openRaidCount: 0,
  milestoneHealth: "on_track",
  ...overrides,
});

describe("deriveMilestoneHealthBucket", () => {
  it("returns no_milestones when total is 0", () => {
    expect(deriveMilestoneHealthBucket(0, 0, 0, 0)).toBe("no_milestones");
  });

  it("returns overdue when any overdue milestones exist", () => {
    expect(deriveMilestoneHealthBucket(2, 1, 0, 5)).toBe("overdue");
  });

  it("returns at_risk when atRisk > 0 but no overdue", () => {
    expect(deriveMilestoneHealthBucket(0, 3, 0, 5)).toBe("at_risk");
  });

  it("returns due_soon when dueSoon > 0 but no overdue or at-risk", () => {
    expect(deriveMilestoneHealthBucket(0, 0, 1, 4)).toBe("due_soon");
  });

  it("returns on_track when milestones exist but none at risk", () => {
    expect(deriveMilestoneHealthBucket(0, 0, 0, 3)).toBe("on_track");
  });

  it("overdue takes priority over at_risk and due_soon", () => {
    expect(deriveMilestoneHealthBucket(1, 2, 3, 10)).toBe("overdue");
  });
});

describe("aggregatePortfolio", () => {
  it("returns zeros for an empty list", () => {
    const result = aggregatePortfolio([]);
    expect(result).toEqual({
      projectCount: 0,
      overallR: 0,
      overallA: 0,
      overallG: 0,
      totalOpenRaid: 0,
      avgCompletionPercent: 0,
    });
  });

  it("counts all-green projects correctly", () => {
    const rows = [
      baseRow({ id: "p1", overall: "G", openRaidCount: 2, completionPercent: 80 }),
      baseRow({ id: "p2", overall: "G", openRaidCount: 1, completionPercent: 60 }),
    ];
    const result = aggregatePortfolio(rows);
    expect(result.projectCount).toBe(2);
    expect(result.overallG).toBe(2);
    expect(result.overallR).toBe(0);
    expect(result.overallA).toBe(0);
    expect(result.totalOpenRaid).toBe(3);
    expect(result.avgCompletionPercent).toBe(70);
  });

  it("handles mixed RAG statuses", () => {
    const rows = [
      baseRow({ id: "p1", overall: "R", completionPercent: 20 }),
      baseRow({ id: "p2", overall: "A", completionPercent: 50 }),
      baseRow({ id: "p3", overall: "G", completionPercent: 80 }),
    ];
    const result = aggregatePortfolio(rows);
    expect(result.overallR).toBe(1);
    expect(result.overallA).toBe(1);
    expect(result.overallG).toBe(1);
    expect(result.avgCompletionPercent).toBe(50);
  });

  it("rounds avgCompletionPercent", () => {
    const rows = [
      baseRow({ id: "p1", completionPercent: 33 }),
      baseRow({ id: "p2", completionPercent: 34 }),
    ];
    const result = aggregatePortfolio(rows);
    // (33 + 34) / 2 = 33.5 → rounded to 34
    expect(result.avgCompletionPercent).toBe(34);
  });

  it("sums openRaidCount across all projects", () => {
    const rows = [
      baseRow({ id: "p1", openRaidCount: 5 }),
      baseRow({ id: "p2", openRaidCount: 3 }),
      baseRow({ id: "p3", openRaidCount: 0 }),
    ];
    expect(aggregatePortfolio(rows).totalOpenRaid).toBe(8);
  });

  it("single project returns its own values", () => {
    const row = baseRow({ overall: "A", openRaidCount: 7, completionPercent: 45 });
    const result = aggregatePortfolio([row]);
    expect(result.projectCount).toBe(1);
    expect(result.overallA).toBe(1);
    expect(result.totalOpenRaid).toBe(7);
    expect(result.avgCompletionPercent).toBe(45);
  });
});
