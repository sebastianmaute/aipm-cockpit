// Plan with AI: what the request leaves out when a cap applies. The counts the modal shows must be the ones the
// request itself reports to the model ("…(N more … truncated)"), so they are checked against the built context.
import { describe, expect, it } from "vitest";
import {
  ALLOC_CONTEXT_MAX_PERIODS, ALLOC_CONTEXT_MAX_RESOURCES, allocContextOmissions, buildAllocContext, hasAllocOmissions,
} from "./alloc-plan";
import { ALLOC_CONTEXT_MAX_MILESTONES, ALLOC_CONTEXT_MAX_TASKS } from "./alloc-project-digest";
import type { Milestone, Resource, ResourcePlan, Task } from "../types";

const today = "2026-09-07";
const shortPlan: ResourcePlan = { startDate: "2026-09-07", endDate: "2026-10-04", granularity: "week", currency: "EUR" };
const longPlan: ResourcePlan = { startDate: "2026-09-07", endDate: "2027-08-29", granularity: "week", currency: "EUR" };

const resources = (n: number): Resource[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, firstName: `F${i}`, lastName: `L${i}`, utilizationMode: "hours", utilization: {} }) as Resource);
const task = (id: number, status: string): Task => ({
  id, taskName: `Task ${id}`, assignee: "", assigneeEmail: "", startDate: today, dueDate: "2026-09-30",
  lastUpdateDate: today, priority: "Medium", status, blockers: "", description: "", dependencies: [],
  ...(status === "Done" ? { completedDate: today } : {}),
}) as Task;
const tasks = (open: number, done = 0): Task[] => [
  ...Array.from({ length: open }, (_, i) => task(1000 + i, "In Progress")),
  ...Array.from({ length: done }, (_, i) => task(5000 + i, "Done")),
];
const milestones = (n: number): Milestone[] =>
  Array.from({ length: n }, (_, i) => ({ id: 9000 + i, name: `M${i}`, date: "2026-12-01", linkedTaskIds: [] }) as Milestone);

function context(args: { resources: Resource[]; plan: ResourcePlan; tasks: Task[]; milestones: Milestone[] }): string {
  return buildAllocContext({
    ...args, roles: [], disciplines: [], grades: [], absences: [], workdayHours: 8, holidaySet: new Set(),
    stakeholders: [], instruction: "Balance the team", today,
  });
}
/** The model-facing count for one kind, 0 when the context reports none. */
const reported = (ctx: string, kind: string): number => Number(new RegExp(`…\\((\\d+) more ${kind} truncated\\)`).exec(ctx)?.[1] ?? 0);

describe("allocContextOmissions", () => {
  it("reports nothing when no cap applies", () => {
    const args = { resources: resources(3), plan: shortPlan, tasks: tasks(5, 2), milestones: milestones(2) };
    const omitted = allocContextOmissions(args);
    expect(omitted).toEqual({ resources: 0, periods: 0, tasks: 0, milestones: 0 });
    expect(hasAllocOmissions(omitted)).toBe(false);
    expect(context(args)).not.toContain("truncated)");
  });

  it("counts what each cap left out, the same numbers the request tells the model", () => {
    const args = {
      resources: resources(ALLOC_CONTEXT_MAX_RESOURCES + 7),
      plan: longPlan,
      // Closed tasks are never in the digest, so they are not "left out".
      tasks: tasks(ALLOC_CONTEXT_MAX_TASKS + 12, 30),
      milestones: milestones(ALLOC_CONTEXT_MAX_MILESTONES + 3),
    };
    const omitted = allocContextOmissions(args);
    expect(omitted.resources).toBe(7);
    expect(omitted.tasks).toBe(12);
    expect(omitted.milestones).toBe(3);
    expect(omitted.periods).toBeGreaterThan(0);
    expect(hasAllocOmissions(omitted)).toBe(true);
    const ctx = context(args);
    expect(omitted).toEqual({
      resources: reported(ctx, "resources"),
      periods: reported(ctx, "periods"),
      tasks: reported(ctx, "tasks"),
      milestones: reported(ctx, "milestones"),
    });
    expect(ALLOC_CONTEXT_MAX_PERIODS + omitted.periods).toBeGreaterThan(ALLOC_CONTEXT_MAX_PERIODS); // anti-vacuity
  });

  it("one cap alone is reported alone", () => {
    const omitted = allocContextOmissions({ resources: resources(2), plan: shortPlan, tasks: tasks(1), milestones: milestones(ALLOC_CONTEXT_MAX_MILESTONES + 1) });
    expect(omitted).toEqual({ resources: 0, periods: 0, tasks: 0, milestones: 1 });
    expect(hasAllocOmissions(omitted)).toBe(true);
  });
});
