import { describe, it, expect } from "vitest";
import type { Insight, InsightSeverity, InsightStatus, InsightType } from "./insight";
import { buildInsightsPromptBlock, MAX_PROMPT_INSIGHTS } from "./insight-prompt";

function make(
  id: number,
  type: InsightType,
  severity: InsightSeverity,
  status: InsightStatus,
  data: Insight["data"],
): Insight {
  return {
    id,
    key: `k${id}`,
    type,
    severity,
    data,
    status,
    firstSeenAt: "2026-07-01",
    lastSeenAt: "2026-07-01",
    occurrences: 1,
  };
}

describe("buildInsightsPromptBlock", () => {
  it("returns empty string when there are no insights", () => {
    expect(buildInsightsPromptBlock([])).toBe("");
  });

  it("returns empty string when no insight is active/acknowledged", () => {
    const insights = [
      make(1, "stalledWork", "high", "dismissed", { count: 4 }),
      make(2, "stalledWork", "high", "resolved", { count: 4 }),
      make(3, "stalledWork", "high", "acted", { count: 4 }),
    ];
    expect(buildInsightsPromptBlock(insights)).toBe("");
  });

  it("lists active and acknowledged insights with a header", () => {
    const insights = [
      make(1, "milestoneSlip", "high", "active", { name: "M12", daysOverdue: 5, date: "2026-07-10" }),
      make(2, "stalledWork", "medium", "acknowledged", { count: 4 }),
    ];
    const block = buildInsightsPromptBlock(insights);
    expect(block).toContain("Current project insights");
    expect(block).toContain('- [high] Milestone "M12" slipped, 5d overdue');
    expect(block).toContain("- [medium] 4 tasks stalled or blocked");
  });

  it("excludes dismissed and resolved insights from the listing", () => {
    const insights = [
      make(1, "milestoneSlip", "high", "active", { name: "Keep", daysOverdue: 5, date: "2026-07-10" }),
      make(2, "milestoneSlip", "high", "dismissed", { name: "Drop", daysOverdue: 9, date: "2026-07-10" }),
    ];
    const block = buildInsightsPromptBlock(insights);
    expect(block).toContain("Keep");
    expect(block).not.toContain("Drop");
  });

  it("sorts by severity (high before medium before low)", () => {
    const insights = [
      make(1, "stalledWork", "low", "active", { count: 1 }),
      make(2, "stalledWork", "high", "active", { count: 2 }),
      make(3, "stalledWork", "medium", "active", { count: 3 }),
    ];
    const block = buildInsightsPromptBlock(insights);
    const hi = block.indexOf("[high]");
    const med = block.indexOf("[medium]");
    const lo = block.indexOf("[low]");
    expect(hi).toBeGreaterThan(-1);
    expect(hi).toBeLessThan(med);
    expect(med).toBeLessThan(lo);
  });

  it("caps to the top-N by severity", () => {
    const insights: Insight[] = [];
    for (let i = 0; i < MAX_PROMPT_INSIGHTS + 5; i++) {
      insights.push(make(i, "stalledWork", "medium", "active", { count: i }));
    }
    const block = buildInsightsPromptBlock(insights);
    const lines = block.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(MAX_PROMPT_INSIGHTS);
  });

  it("is deterministic (same input → same output)", () => {
    const insights = [
      make(1, "budgetVariance", "high", "active", { name: "Dev", variancePct: 22, buckets: 3 }),
      make(2, "raidAging", "medium", "active", { name: "R7", daysSinceUpdate: 30, targetDate: "2026-06-01" }),
      make(3, "overdueTrend", "low", "active", { current: 8, prior: 5, delta: 3 }),
    ];
    expect(buildInsightsPromptBlock(insights)).toBe(buildInsightsPromptBlock(insights));
  });
});
