import { describe, expect, test } from "vitest";
import type { Absence, Resource, ResourcePlan, Task } from "../types";
import { generatePeriods } from "../resource-capacity";
import { elsewhereFor, elsewhereTotal, type OtherProjectData } from "./elsewhere-hours";
import type { PersonRelation } from "./person-match";

const NO_HOLIDAYS: ReadonlySet<string> = new Set();

function res(id: number, extra: Partial<Resource> = {}): Resource {
  return { id, firstName: "Ann", lastName: "Lee", utilization: {}, utilizationMode: "hours", ...extra } as Resource;
}

function plan(startDate: string, endDate: string, granularity: "week" | "month"): ResourcePlan {
  return { startDate, endDate, granularity, currency: "EUR" } as ResourcePlan;
}

function rel(resourceId: number, projectId = "p2"): PersonRelation {
  return { projectId, projectName: `Name ${projectId}`, resourceId, via: "email" };
}

function other(over: Partial<OtherProjectData> & Pick<OtherProjectData, "resources">): OtherProjectData {
  return { projectId: "p2", projectName: "Name p2", plan: null, absences: [], tasks: [], ...over };
}

function task(id: number, extra: Partial<Task> = {}): Task {
  return { id, taskName: `T${id}`, status: "In Progress", ...extra } as Task;
}

// Feb 2026 has 20 workdays (Mon 2 .. Fri 27).
const FEB = plan("2026-02-01", "2026-02-28", "month");
const WEEKS = generatePeriods("2026-02-02", "2026-03-08", "week");

describe("elsewhereFor", () => {
  test("a weekly here and a monthly elsewhere split by overlapping workdays", () => {
    const o = other({ plan: FEB, resources: [res(10, { utilization: { "2026-02": 40 } })] });
    const [fig] = elsewhereFor([rel(10)], [o], WEEKS, 8, NO_HOLIDAYS);
    // Week of Feb 2 is fully inside Feb: 5 of 20 workdays.
    expect(fig.hoursByPeriod["2026-W06"]).toBe(10);
    // Week of Feb 23 .. Mar 1: only Feb 23-27 overlap Feb (5 workdays), and March has no plan.
    expect(fig.hoursByPeriod["2026-W09"]).toBe(10);
    // The window total is the whole month.
    const total = WEEKS.reduce((s, p) => s + (fig.hoursByPeriod[p.key] ?? 0), 0);
    expect(total).toBe(40);
  });

  test("a week straddling two months gets the sum of both shares", () => {
    // Mar 2026: 22 workdays. Week Mar 30 - Apr 5 has Mar 30,31 (Mar) and Apr 1,2,3 (Apr).
    const o = other({
      plan: plan("2026-03-01", "2026-04-30", "month"),
      resources: [res(10, { utilization: { "2026-03": 44, "2026-04": 44 } })],
    });
    const weeks = generatePeriods("2026-03-30", "2026-04-05", "week");
    const [fig] = elsewhereFor([rel(10)], [o], weeks, 8, NO_HOLIDAYS);
    // Mar: 2/22 of 44 = 4; Apr 2026 has 22 workdays: 3/22 of 44 = 6.
    expect(fig.hoursByPeriod[weeks[0].key]).toBe(10);
  });

  test("a weekly plan elsewhere and monthly here-periods: each month sums the overlapping weeks' shares", () => {
    // Weeks Mar 23-29 (all March) and Mar 30 - Apr 5 (Mar 30,31 = 2 workdays in March, Apr 1-3 = 3 in April).
    const weeks = generatePeriods("2026-03-23", "2026-04-05", "week");
    const o = other({
      plan: plan("2026-03-23", "2026-04-05", "week"),
      resources: [res(10, { utilization: { [weeks[0].key]: 20, [weeks[1].key]: 40 } })],
    });
    const months = generatePeriods("2026-03-01", "2026-04-30", "month");
    const [fig] = elsewhereFor([rel(10)], [o], months, 8, NO_HOLIDAYS);
    // March: all 20 of the first week + 2/5 of 40 = 16; April: 3/5 of 40 = 24.
    expect(fig.hoursByPeriod[months[0].key]).toBe(36);
    expect(fig.hoursByPeriod[months[1].key]).toBe(24);
    expect(fig.hoursByPeriod[months[0].key] + fig.hoursByPeriod[months[1].key]).toBe(60);
  });

  test("percent mode elsewhere uses that project's capacity", () => {
    const o = other({
      plan: plan("2026-02-02", "2026-02-08", "week"),
      resources: [res(10, { utilizationMode: "percent", utilization: { "2026-W06": 50 } })],
    });
    const [fig] = elsewhereFor([rel(10)], [o], WEEKS, 8, NO_HOLIDAYS);
    expect(fig.hoursByPeriod["2026-W06"]).toBe(20);
  });

  test("absences in the other project reduce its planned hours", () => {
    const absence = { id: 1, resourceId: 10, assignee: "Ann Lee", startDate: "2026-02-02", endDate: "2026-02-03" } as Absence;
    const o = other({
      plan: plan("2026-02-02", "2026-02-08", "week"),
      absences: [absence],
      resources: [res(10, { utilizationMode: "percent", utilization: { "2026-W06": 100 } })],
    });
    const [fig] = elsewhereFor([rel(10)], [o], WEEKS, 8, NO_HOLIDAYS);
    expect(fig.hoursByPeriod["2026-W06"]).toBe(24);
  });

  test("a project with no plan contributes zero hours and is flagged noPlan", () => {
    const o = other({ plan: null, resources: [res(10, { utilization: { "2026-W06": 30 } })] });
    const [fig] = elsewhereFor([rel(10)], [o], WEEKS, 8, NO_HOLIDAYS);
    expect(fig.noPlan).toBe(true);
    expect(elsewhereTotal([fig], "2026-W06")).toBe(0);
  });

  test("two matched resources in one project sum", () => {
    const o = other({
      plan: plan("2026-02-02", "2026-02-08", "week"),
      resources: [res(10, { utilization: { "2026-W06": 10 } }), res(11, { utilization: { "2026-W06": 5.5 } })],
    });
    const figs = elsewhereFor([rel(10), rel(11)], [o], WEEKS, 8, NO_HOLIDAYS);
    expect(figs).toHaveLength(1);
    expect(figs[0].hoursByPeriod["2026-W06"]).toBe(15.5);
  });

  test("a project without a relation yields no figure", () => {
    const o = other({ plan: FEB, resources: [res(10)] });
    expect(elsewhereFor([], [o], WEEKS, 8, NO_HOLIDAYS)).toEqual([]);
  });

  test("hours are rounded to 2 decimals", () => {
    const o = other({ plan: FEB, resources: [res(10, { utilization: { "2026-02": 10 } })] });
    const weeks = generatePeriods("2026-02-02", "2026-02-02", "week");
    // 1 of 5 workdays of the week is not what matters; Feb 2-8 holds 5 of 20: 2.5. Use a 3-day window via holidays.
    const [fig] = elsewhereFor([rel(10)], [o], weeks, 8, new Set(["2026-02-05", "2026-02-06"]));
    // 3 workdays in the week overlap, month has 18 workdays: 10 * 3/18 = 1.6666...
    expect(fig.hoursByPeriod["2026-W06"]).toBe(1.67);
  });

  test("tasks hint counts open owned tasks and their remaining hours, never closed ones, by resourceId else display name", () => {
    const o = other({
      plan: FEB,
      resources: [res(10)],
      tasks: [
        task(1, { resourceId: 10, remainingEstimateMinutes: 90 }),
        task(2, { assignee: " ann lee ", remainingEstimateMinutes: 30 }),
        task(3, { resourceId: 10, status: "Done", remainingEstimateMinutes: 600 }),
        task(4, { status: "Cancelled", assignee: "Ann Lee", remainingEstimateMinutes: 600 }),
        task(5, { resourceId: 99, assignee: "Ann Lee", remainingEstimateMinutes: 600 }),
        task(6, { assignee: "Bob Roe", remainingEstimateMinutes: 600 }),
        task(7, { resourceId: 10 }),
      ],
    });
    const [fig] = elsewhereFor([rel(10)], [o], WEEKS, 8, NO_HOLIDAYS);
    expect(fig.openTasks).toBe(3);
    expect(fig.remainingHours).toBe(2);
  });
});

describe("elsewhereTotal", () => {
  test("sums a period across figures and treats a missing key as zero", () => {
    const f = (h: Record<string, number>) => ({
      projectId: "x", projectName: "x", hoursByPeriod: h, openTasks: 0, remainingHours: 0, noPlan: false,
    });
    expect(elsewhereTotal([f({ a: 1.5 }), f({ a: 2 }), f({})], "a")).toBe(3.5);
  });
});
