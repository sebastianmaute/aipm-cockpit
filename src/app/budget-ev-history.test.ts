import { describe, it, expect } from "vitest";
import { bucketProgressSeries, computeEvHistory, type BucketProgressRecord, type EvHistoryInput, type EvHistoryTask } from "./budget-ev-history";
import { computeBudgetReport, type BudgetReport } from "./budget-report";
import { computeBudgetForecastsByUnit, type BudgetForecastInput } from "./budget-forecast";
import { actualPointDates, computeBurndownSeries } from "./budget-burndown";
import type { BudgetBucket, ResourcePlan, Role } from "./types";

const TODAY = "2026-09-14";
const NO_PROGRESS: ReadonlyMap<number, readonly BucketProgressRecord[]> = new Map();

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
    const h = computeEvHistory({ report: report(b), buckets: b, tasks, dates, today: "2026-09-14", progress: NO_PROGRESS });
    if (!h.available) throw new Error("unavailable");
    expect(h.points).toEqual([
      { date: "2026-01-31", eur: 0, hours: 0, partial: [], joins: [] },
      { date: "2026-03-31", eur: 2_500, hours: 25, partial: [], joins: [] },
      { date: "2026-06-30", eur: 5_000, hours: 50, partial: [], joins: [] },
      { date: "2026-09-14", eur: 7_500, hours: 75, partial: [], joins: [] }, // Cancelled (no date) counts only here
    ]);
  });

  it("ends exactly at the forecast's EV in both units", () => {
    const b = [bucket(1, { taskIds: [1, 2, 3, 4] })];
    const today = "2026-09-14";
    const burndown = computeBurndownSeries(b, plan, roles, [], 8, none, [], today, null);
    const inp: BudgetForecastInput = { report: report(b), buckets: b, roles, fxRates: null, tasks, plan, burndown, holidaySet: none, today };
    const { eur, hours } = computeBudgetForecastsByUnit(inp);
    const h = computeEvHistory({ report: inp.report, buckets: b, tasks, dates, today, progress: NO_PROGRESS });
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
    const h = computeEvHistory({ report: rep, buckets: b, tasks: withLate, dates: pointDates, today, progress: NO_PROGRESS });
    if (!h.available) throw new Error("unavailable");
    const last = h.points[h.points.length - 1];
    // 3 of 4 linked tasks finished (Done, Cancelled, late Done) → 75% of 10,000 € / 100 h.
    expect(last.eur).toBeCloseTo(7_500, 9);
    expect(last.hours).toBeCloseTo(75, 9);
    expect(last.eur).toBeCloseTo(eur.facts.ev!, 9);
    expect(last.hours).toBeCloseTo(hours.facts.ev!, 9);
  });

  it("draws a hand-entered bucket with no record as partial, not as unavailable (rule 1A′)", () => {
    const b = [bucket(1, { taskIds: [1] }), bucket(2, { percentComplete: 50, name: "Design" })];
    const h = computeEvHistory({ report: report(b), buckets: b, tasks, dates, today: "2026-09-14", progress: NO_PROGRESS });
    if (!h.available) throw new Error("unavailable");
    const design = [{ id: 2, name: "Design", createdDate: null, startDate: "2026-01-01" }];
    expect(h.points).toEqual([
      { date: "2026-01-31", eur: 0, hours: 0, partial: design, joins: [] },
      { date: "2026-03-31", eur: 10_000, hours: 100, partial: design, joins: [] },
      { date: "2026-06-30", eur: 10_000, hours: 100, partial: design, joins: [] },
      { date: "2026-09-14", eur: 15_000, hours: 150, partial: [], joins: [] },
    ]);
  });

  it("is unavailable when the only budgeted bucket has no resolvable linked task", () => {
    const b = [bucket(1, { taskIds: [99], name: "Rollout" })];
    expect(computeEvHistory({ report: report(b), buckets: b, tasks, dates, today: "2026-09-14", progress: NO_PROGRESS }))
      .toEqual({ available: false, reason: "no-earned-value", buckets: [{ id: 1, name: "Rollout" }] });
  });

  it("is unavailable when the only budgeted bucket has no taskIds at all", () => {
    const b = [bucket(1, { taskIds: undefined, name: "Discovery" })];
    expect(computeEvHistory({ report: report(b), buckets: b, tasks, dates, today: "2026-09-14", progress: NO_PROGRESS }))
      .toEqual({ available: false, reason: "no-earned-value", buckets: [{ id: 1, name: "Discovery" }] });
  });

  it("ignores buckets without budget", () => {
    const empty = bucket(2, { allocations: [] } as Partial<BudgetBucket>);
    const b = [bucket(1, { taskIds: [1] }), empty];
    expect(computeEvHistory({ report: report(b), buckets: b, tasks, dates: [], today: "2026-09-14", progress: NO_PROGRESS }))
      .toEqual({ available: true, points: [] });
  });
});

// §550 re-based `budget-forecast.ts` onto `br.ownBudget.*`; `computeEvHistory`
// still read the reported, spillover-inclusive `br.budgetValue`/`br.budgetHours`.
// Fixture shape reused from the §550 spillover test in `budget-report.test.ts`
// ("does NOT report budgetMirrorsPlan when spillover makes the two figures
// differ") and from the two-bucket 100h/100h, 60/100-rate fixture in
// `budget-forecast.test.ts`'s "EV on the own-budget basis (§550...)" describe —
// here with both buckets linked to a single Done task instead of a manual
// percentComplete, so `computeEvHistory`'s task-linked path is exercised.
function spilloverFixture() {
  const donor = bucket(1, {
    status: "closed", closedDate: "2026-06-30", successorId: 2, taskIds: [1],
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: { "2026-06": 40 } }],
  });
  const succ = bucket(2, {
    taskIds: [2],
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-06": 100 }, actualHours: { "2026-06": 30 } }],
  });
  const buckets = [donor, succ];
  const spilloverTasks: EvHistoryTask[] = [
    { id: 1, status: "Done", completedDate: "2026-06-15" },
    { id: 2, status: "Done", completedDate: "2026-06-20" },
  ];
  const bucketReport = report(buckets);
  const burndown = computeBurndownSeries(buckets, plan, roles, [], 8, none, [], TODAY, null);
  const forecastInput: BudgetForecastInput = {
    report: bucketReport, buckets, roles, fxRates: null, tasks: spilloverTasks, plan, burndown, holidaySet: none, today: TODAY,
  };
  return { report: bucketReport, buckets, tasks: spilloverTasks, forecastInput };
}

describe("computeEvHistory — own-basis re-basing (§550)", () => {
  it("the fixture really spills, or the assertion below proves nothing", () => {
    const { report: bucketReport } = spilloverFixture();
    const s = bucketReport.buckets.find((b) => b.bucketId === 2)!;
    expect(s.spilloverInHours).toBe(60);
    expect(s.spilloverInValue).toBe(6_000);
  });

  it("ends on the same own-basis earned value the forecast reports (§550 re-basing)", () => {
    const { report: bucketReport, buckets, tasks, forecastInput } = spilloverFixture();
    const h = computeEvHistory({ report: bucketReport, buckets, tasks, dates: [TODAY], today: TODAY, progress: NO_PROGRESS });
    if (!h.available) throw new Error("expected available");
    const f = computeBudgetForecastsByUnit(forecastInput);
    expect(h.points.at(-1)!.eur).toBeCloseTo(f.eur.facts.ev!, 6);
    expect(h.points.at(-1)!.hours).toBeCloseTo(f.hours.facts.ev!, 6);
  });
});
// Rule 1A′ (spec §5.1) — an unresolved task-linked bucket is treated the same
// as an unrecorded manual one (stays partial while active, never unavailable
// on its own). A plan of twelve months with a point at
// each month end; the last point is today. The report is faked to the one field
// the engine reads, so every bucket is worth 1,000 € / 10 h on its own basis.
const MONTH_ENDS = [
  "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30",
  "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31",
];
const MONTH_12 = "2026-12-31";
function ruleBucket(id: number, over: Partial<BudgetBucket>): BudgetBucket {
  return { id, name: `R${id}`, type: "tm", currency: "EUR", startDate: "", endDate: MONTH_12, status: "open", allocations: [], ...over } as BudgetBucket;
}
function ownReport(buckets: readonly BudgetBucket[]): BudgetReport {
  return { buckets: buckets.map((b) => ({ bucketId: b.id, ownBudget: { budgetValue: 1_000, budgetHours: 10 } })) } as unknown as BudgetReport;
}
function run(buckets: BudgetBucket[], extra: Partial<EvHistoryInput> = {}) {
  const h = computeEvHistory({ report: ownReport(buckets), buckets, tasks: [], dates: MONTH_ENDS, today: MONTH_12, progress: NO_PROGRESS, ...extra });
  if (!h.available) throw new Error("unavailable");
  return h.points;
}
const RECORDS: readonly BucketProgressRecord[] = [{ date: "2026-07-31", pct: 20 }, { date: "2026-09-30", pct: 50 }];
const recorded = (id: number) => new Map([[id, RECORDS]]);

describe("computeEvHistory — rule 1A′", () => {
  it("(1) a manual bucket contributes 0 and is complete before its start, partial once active without a record", () => {
    const points = run([ruleBucket(1, { startDate: "2026-07-31", percentComplete: 80 })]);
    for (const pt of points.slice(0, 6)) expect(pt).toMatchObject({ eur: 0, hours: 0, partial: [], joins: [] });
    expect(points[6].partial).toEqual([{ id: 1, name: "R1", createdDate: null, startDate: "2026-07-31" }]);
    expect(points[11]).toMatchObject({ eur: 800, hours: 8, partial: [], joins: [] });
  });

  it("(2) a linked bucket derives from its tasks and is never partial", () => {
    const tasks: EvHistoryTask[] = [{ id: 7, status: "Done", completedDate: "2026-04-15" }, { id: 8, status: "To Do", completedDate: undefined }];
    const points = run([ruleBucket(1, { startDate: "2026-01-01", taskIds: [7, 8] })], { tasks });
    expect(points.map((pt) => pt.eur)).toEqual([0, 0, 0, 500, 500, 500, 500, 500, 500, 500, 500, 500]);
    expect(points.every((pt) => pt.partial.length === 0 && pt.joins.length === 0)).toBe(true);
  });

  it("(3) a manual bucket uses its latest record on or before each point", () => {
    const points = run([ruleBucket(1, { startDate: "2026-07-31", percentComplete: 60 })], { progress: recorded(1) });
    expect(points.slice(6).map((pt) => [pt.eur, pt.hours])).toEqual([[200, 2], [200, 2], [500, 5], [500, 5], [500, 5], [600, 6]]);
    expect(points.every((pt) => pt.partial.length === 0 && pt.joins.length === 0)).toBe(true);
  });

  it.each([
    ["undated", "", undefined, null, null],
    ["active from month 1", "2026-01-01", "2026-05-01", "2026-05-01", "2026-01-01"],
  ])("(4) %s, with no record before month 7: partial, then joins with its contribution", (_label, startDate, createdDate, shown, shownStart) => {
    const points = run([ruleBucket(1, { startDate, createdDate, percentComplete: 60 })], { progress: recorded(1) });
    for (const pt of points.slice(0, 6)) {
      expect(pt).toMatchObject({ eur: 0, hours: 0, joins: [] });
      expect(pt.partial).toEqual([{ id: 1, name: "R1", createdDate: shown, startDate: shownStart }]);
    }
    expect(points[6]).toEqual({ date: "2026-07-31", eur: 200, hours: 2, partial: [], joins: [{ id: 1, name: "R1", eur: 200, hours: 2 }] });
    expect(points.slice(7).every((pt) => pt.joins.length === 0 && pt.partial.length === 0)).toBe(true);
  });

  it("(5) the today point uses the current percent: never partial, never a join", () => {
    const points = run([ruleBucket(1, { percentComplete: 30 })]);
    for (const pt of points.slice(0, 11)) expect(pt.partial).toEqual([{ id: 1, name: "R1", createdDate: null, startDate: null }]);
    expect(points[11]).toEqual({ date: MONTH_12, eur: 300, hours: 3, partial: [], joins: [] });
  });

  it("(2b) a linked bucket starting later is known-zero before its start, so it is never partial nor a join", () => {
    const tasks: EvHistoryTask[] = [{ id: 7, status: "Done", completedDate: "2026-02-10" }];
    const points = run([ruleBucket(1, { startDate: "2026-04-01", taskIds: [7] })], { tasks });
    // Month 2 has the task done, but months 2-3 precede the start: 0, known.
    expect(points.slice(1, 3).map((pt) => [pt.eur, pt.partial.length, pt.joins.length])).toEqual([[0, 0, 0], [0, 0, 0]]);
    // Month 4 (the start): the finished task counts in full, and nothing was unknown before it.
    expect(points[3]).toEqual({ date: "2026-04-30", eur: 1_000, hours: 10, partial: [], joins: [] });
    expect(points.every((pt) => pt.partial.length === 0 && pt.joins.length === 0)).toBe(true);
  });

  it("(R3) a linked bucket whose links resolve to nothing is partial at every non-today point", () => {
    const tasks: EvHistoryTask[] = [{ id: 7, status: "Done", completedDate: "2026-04-15" }];
    const points = run([ruleBucket(1, { taskIds: [7] }), ruleBucket(2, { taskIds: [99] })], { tasks });
    for (const pt of points.slice(0, 11)) expect(pt.partial).toEqual([{ id: 2, name: "R2", createdDate: null, startDate: null }]);
    expect(points[11]).toEqual({ date: MONTH_12, eur: 1_000, hours: 10, partial: [], joins: [] });
  });

  it("is unavailable only when no budgeted bucket yields any earned value", () => {
    const buckets = [ruleBucket(1, { taskIds: [99] }), ruleBucket(2, { taskIds: undefined, startDate: "2026-07-31" })];
    expect(computeEvHistory({ report: ownReport(buckets), buckets, tasks: [], dates: MONTH_ENDS, today: MONTH_12, progress: NO_PROGRESS }))
      .toEqual({ available: false, reason: "no-earned-value", buckets: [{ id: 1, name: "R1" }, { id: 2, name: "R2" }] });
  });
});

describe("bucketProgressSeries", () => {
  it("groups by bucket, sorts by date and keeps the last capture of a day", () => {
    const series = bucketProgressSeries([
      { capturedAt: "2026-07-31T18:00:00.000Z", bucketProgress: [{ bucketId: 1, pctComplete: 30 }, { bucketId: 2, pctComplete: 5 }] },
      { capturedAt: "2026-07-15T09:00:00.000Z", bucketProgress: [{ bucketId: 1, pctComplete: 10 }] },
      { capturedAt: "2026-07-31T08:00:00.000Z", bucketProgress: [{ bucketId: 1, pctComplete: 25 }] },
    ]);
    expect(Object.fromEntries(series)).toEqual({
      1: [{ date: "2026-07-15", pct: 10 }, { date: "2026-07-31", pct: 30 }],
      2: [{ date: "2026-07-31", pct: 5 }],
    });
  });
});
