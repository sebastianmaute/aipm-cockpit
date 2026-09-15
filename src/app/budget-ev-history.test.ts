import { describe, it, expect } from "vitest";
import { computeEvHistory, type EvHistoryTask } from "./budget-ev-history";
import { computeBudgetReport } from "./budget-report";
import { computeBudgetForecastsByUnit, type BudgetForecastInput } from "./budget-forecast";
import { actualPointDates, computeBurndownSeries } from "./budget-burndown";
import type { BudgetBucket, ResourcePlan, Role } from "./types";

const none = new Set<string>();
const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const roles = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 60, externalRate: 100 } as Role];
function bucket(id: number, over: Partial<BudgetBucket> = {}): BudgetBucket {
  return {
    id, name: `B${id}`, type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: {} }],
    ...over,
  } as BudgetBucket;
}
const report = (b: BudgetBucket[]) => computeBudgetReport(b, plan, roles, [], 8, none, [], [], null);
const tasks: EvHistoryTask[] = [
  { id: 1, status: "Done", completedDate: "2026-03-10" },
  { id: 2, status: "Done", completedDate: "2026-06-30T18:00:00Z" },
  { id: 3, status: "Cancelled", completedDate: undefined },
  { id: 4, status: "In Progress", completedDate: undefined },
];
const dates = ["2026-01-31", "2026-03-31", "2026-06-30", "2026-09-14"];

describe("computeEvHistory", () => {
  it("counts each finished task from its own completion date; today uses the live percent complete", () => {
    const b = [bucket(1, { taskIds: [1, 2, 3, 4] })];
    const h = computeEvHistory({ report: report(b), buckets: b, tasks, dates, today: "2026-09-14" });
    if (!h.available) throw new Error("unavailable");
    expect(h.points).toEqual([
      { date: "2026-01-31", eur: 0, hours: 0 },
      { date: "2026-03-31", eur: 2_500, hours: 25 },
      { date: "2026-06-30", eur: 5_000, hours: 50 },
      { date: "2026-09-14", eur: 7_500, hours: 75 }, // Cancelled (no date) counts only here
    ]);
  });

  it("ends exactly at the forecast's EV in both units", () => {
    const b = [bucket(1, { taskIds: [1, 2, 3, 4] })];
    const today = "2026-09-14";
    const burndown = computeBurndownSeries(b, plan, roles, [], 8, none, [], today, null);
    const inp: BudgetForecastInput = { report: report(b), buckets: b, roles, fxRates: null, tasks, plan, burndown, holidaySet: none, today };
    const { eur, hours } = computeBudgetForecastsByUnit(inp);
    const h = computeEvHistory({ report: inp.report, buckets: b, tasks, dates, today });
    if (!h.available) throw new Error("unavailable");
    const last = h.points[h.points.length - 1];
    expect(last.eur).toBeCloseTo(eur.facts.ev!, 9);
    expect(last.hours).toBeCloseTo(hours.facts.ev!, 9);
  });

  it("ends at the forecast's EV when today is past the last plan period (overdue project)", () => {
    // The plan ended on 2026-06-30 and today is 2026-09-14, so `actualPointDates`
    // ends at the last period END, which is before today: no date reaches the
    // `date >= today` branch. The last point must still use the live percent
    // complete, or it drops the Cancelled task (no completion date) and the
    // task finished after the plan end, and the line ends below the EV diamond.
    const overduePlan: ResourcePlan = { ...plan, endDate: "2026-06-30" };
    const b = [bucket(1, { endDate: "2026-06-30", taskIds: [1, 3, 4, 5] })];
    const withLate: EvHistoryTask[] = [...tasks, { id: 5, status: "Done", completedDate: "2026-08-01" }];
    const today = "2026-09-14";
    const rep = computeBudgetReport(b, overduePlan, roles, [], 8, none, [], [], null);
    const burndown = computeBurndownSeries(b, overduePlan, roles, [], 8, none, [], today, null);
    const pointDates = actualPointDates(burndown, today);
    expect(pointDates[pointDates.length - 1] < today).toBe(true);
    const inp: BudgetForecastInput = { report: rep, buckets: b, roles, fxRates: null, tasks: withLate, plan: overduePlan, burndown, holidaySet: none, today };
    const { eur, hours } = computeBudgetForecastsByUnit(inp);
    const h = computeEvHistory({ report: rep, buckets: b, tasks: withLate, dates: pointDates, today });
    if (!h.available) throw new Error("unavailable");
    const last = h.points[h.points.length - 1];
    // 3 of 4 linked tasks finished (Done, Cancelled, late Done) → 75% of 10,000 € / 100 h.
    expect(last.eur).toBeCloseTo(7_500, 9);
    expect(last.hours).toBeCloseTo(75, 9);
    expect(last.eur).toBeCloseTo(eur.facts.ev!, 9);
    expect(last.hours).toBeCloseTo(hours.facts.ev!, 9);
  });

  it("is unavailable, naming the buckets, when a budgeted bucket has a hand-entered percent", () => {
    const b = [bucket(1, { taskIds: [1] }), bucket(2, { percentComplete: 50, name: "Design" })];
    expect(computeEvHistory({ report: report(b), buckets: b, tasks, dates, today: "2026-09-14" }))
      .toEqual({ available: false, reason: "manual-percent", buckets: [{ id: 2, name: "Design" }] });
  });

  it("is unavailable when a budgeted bucket has no resolvable linked task", () => {
    const b = [bucket(1, { taskIds: [99], name: "Rollout" })];
    expect(computeEvHistory({ report: report(b), buckets: b, tasks, dates, today: "2026-09-14" }))
      .toEqual({ available: false, reason: "no-linked-tasks", buckets: [{ id: 1, name: "Rollout" }] });
  });

  it("is unavailable when a budgeted bucket has no taskIds at all", () => {
    const b = [bucket(1, { taskIds: undefined, name: "Discovery" })];
    expect(computeEvHistory({ report: report(b), buckets: b, tasks, dates, today: "2026-09-14" }))
      .toEqual({ available: false, reason: "no-linked-tasks", buckets: [{ id: 1, name: "Discovery" }] });
  });

  it("ignores buckets without budget", () => {
    const empty = bucket(2, { allocations: [] } as Partial<BudgetBucket>);
    const b = [bucket(1, { taskIds: [1] }), empty];
    expect(computeEvHistory({ report: report(b), buckets: b, tasks, dates: [], today: "2026-09-14" }))
      .toEqual({ available: true, points: [] });
  });
});
