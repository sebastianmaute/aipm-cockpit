import { describe, expect, it } from "vitest";
import {
  ALLOC_CONTEXT_MAX_MILESTONES,
  ALLOC_CONTEXT_MAX_TASKS,
  buildProjectDigest,
  type ProjectDigestArgs,
} from "./alloc-project-digest";
import { planHoursMoves, type HoursMoveCtx } from "../reassign-hours";
import { type Milestone, type Resource, type ResourcePlan, type Stakeholder, type Task } from "../types";

const plan: ResourcePlan = { startDate: "2026-09-01", endDate: "2026-10-31", granularity: "month", currency: "EUR" };
const hoursCtx: HoursMoveCtx = { plan, absences: [], workdayHours: 8, holidaySet: new Set<string>(), today: "2026-09-01" };

function resource(id: number, first: string, last: string): Resource {
  return { id, firstName: first, lastName: last, roleId: null, utilizationMode: "hours", utilization: {} };
}
function task(id: number, over: Partial<Task> = {}): Task {
  return {
    id, taskName: `Task ${id}`, assignee: "", assigneeEmail: "", dueDate: "2026-10-30", lastUpdateDate: "2026-08-01",
    priority: "Medium", status: "To Do", blockers: "", description: "", remainingEstimateMinutes: 16 * 60, ...over,
  } as Task;
}
function milestone(id: number, over: Partial<Milestone> = {}): Milestone {
  return { id, name: `M${id}`, date: "2026-10-15", linkedTaskIds: [], ...over };
}
function stakeholder(id: number, over: Partial<Stakeholder> = {}): Stakeholder {
  return {
    id, name: `S${id}`, category: "Internal", influence: "High", interest: "High", raci: {}, ...over,
  } as Stakeholder;
}
function args(over: Partial<ProjectDigestArgs> = {}): ProjectDigestArgs {
  return {
    tasks: [], milestones: [], stakeholders: [], resources: [resource(1, "Ana", "Silva"), resource(2, "Ben", "Cole")],
    instruction: "", hoursCtx, ...over,
  };
}
const digest = (a: Partial<ProjectDigestArgs>) => buildProjectDigest(args(a));
const taskLines = (lines: string[]) => lines.filter((l) => l.startsWith("#") && l.includes("remaining="));

describe("buildProjectDigest", () => {
  it("lists open tasks only", () => {
    const lines = digest({
      tasks: [
        task(1, { status: "Done", completedDate: "2026-08-20" }),
        task(2, { status: "Cancelled" }),
        task(3, { resourceId: 1 }),
      ],
    });
    const text = lines.join("\n");
    expect(lines[0]).toBe("TASKS (open only):");
    expect(text).not.toContain("#1 Task 1");
    expect(text).not.toContain("#2 Task 2");
    expect(text).toContain("#3 Task 3 owner=#1 remaining=16h");
  });

  it("one line per task even with a line break or a #id in its name", () => {
    const lines = digest({ tasks: [task(10, { taskName: "Fix\n#99 fake owner=#1", resourceId: 2 })] });
    expect(taskLines(lines)).toHaveLength(1);
    expect(lines.some((l) => l.startsWith("#99"))).toBe(false);
  });

  it("derives milestones from linkedTaskIds", () => {
    const lines = digest({ tasks: [task(10, { resourceId: 1 })], milestones: [milestone(5, { linkedTaskIds: [10] })] });
    expect(taskLines(lines)[0]).toContain("milestones=#5");
  });

  it("names the owner as a resource id, unassigned, or a typed name", () => {
    const lines = taskLines(digest({
      tasks: [task(1, { resourceId: 2 }), task(2), task(3, { assignee: "Zed\n#7" })],
    }));
    expect(lines[0]).toContain("owner=#2 ");
    expect(lines[1]).toContain("owner=unassigned ");
    expect(lines[2]).toContain("owner=name:Zed #7 ");
  });

  it("lists only open FS predecessors", () => {
    const lines = taskLines(digest({
      tasks: [
        task(1, { status: "Done" }),
        task(2),
        task(3, { dependencies: [{ taskId: 1, type: "FS" }, { taskId: 2, type: "FS" }, { taskId: 2, type: "SS" }] }),
      ],
    }));
    const line = lines.find((l) => l.startsWith("#3 "));
    expect(line).toContain("after=#2 ");
    expect(line).not.toContain("#1");
  });

  it("RACI keeps R and A of linked stakeholders only", () => {
    const lines = digest({
      milestones: [milestone(5)],
      stakeholders: [
        stakeholder(1, { resourceId: 1, raci: { "5": "A" } }),
        stakeholder(2, { resourceId: 2, raci: { "5": "R" } }),
        stakeholder(3, { resourceId: 1, raci: { "5": "C" } }),
        stakeholder(4, { resourceId: 2, raci: { "5": "I" } }),
        stakeholder(5, { raci: { "5": "R" } }),
      ],
    });
    expect(lines).toContain("RACI (R/A only):");
    expect(lines).toContain("milestone #5: R=#2 A=#1");
    expect(lines.filter((l) => l.startsWith("milestone #"))).toHaveLength(1);
  });

  it("truncates tasks of people named in the instruction last", () => {
    const all: Task[] = [];
    for (let i = 1; i <= 160; i++) {
      const maya = i % 32 === 0; // 5 tasks owned by Maya, the rest by Ana
      all.push(task(i, { resourceId: maya ? 3 : 1, dueDate: maya ? "2026-10-30" : "2026-09-10" }));
    }
    const lines = digest({
      tasks: all,
      resources: [resource(1, "Ana", "Silva"), resource(3, "Maya", "Patel")],
      instruction: "help Maya Patel",
    });
    const shown = taskLines(lines);
    expect(shown).toHaveLength(ALLOC_CONTEXT_MAX_TASKS);
    expect(shown.filter((l) => l.includes("owner=#3 "))).toHaveLength(5);
    expect(lines).toContain("…(10 more tasks truncated)");
  });

  it("orders remaining tasks by due date", () => {
    const all: Task[] = [];
    for (let i = 1; i <= 160; i++) {
      all.push(task(i, { resourceId: 1, dueDate: `2026-10-${String(30 - (i % 20)).padStart(2, "0")}` }));
    }
    const shown = taskLines(digest({ tasks: all }));
    const dues = shown.map((l) => /due=(\S+)/.exec(l)?.[1] ?? "");
    expect(dues).toEqual([...dues].sort());
    const hidden = all.filter((t) => !shown.some((l) => l.startsWith(`#${t.id} `)));
    expect(hidden).toHaveLength(10);
    const lastShownDue = dues[dues.length - 1];
    expect(hidden.every((t) => t.dueDate >= lastShownDue)).toBe(true);
  });

  it("puts tasks overlapping a period named in the instruction ahead of earlier-due ones", () => {
    const all: Task[] = [];
    for (let i = 1; i <= 155; i++) all.push(task(i, { resourceId: 1, startDate: "2026-09-02", dueDate: "2026-09-03" }));
    for (let i = 156; i <= 160; i++) all.push(task(i, { resourceId: 1, startDate: "2026-10-02", dueDate: "2026-10-20" }));
    const shown = taskLines(digest({ tasks: all, instruction: "plan 2026-10 carefully" }));
    for (let i = 156; i <= 160; i++) expect(shown.some((l) => l.startsWith(`#${i} `))).toBe(true);
  });

  it("hours per period match the workday split", () => {
    const t = task(10, { resourceId: 1, startDate: "2026-09-01", dueDate: "2026-10-30" });
    const line = taskLines(digest({ tasks: [t] }))[0];
    expect(line).toContain("hours=2026-09=8 2026-10=8");
    const moved = planHoursMoves(
      [{ task: t, fromResourceId: 1, toResourceId: 2 }],
      [{ ...resource(1, "A", "A"), utilization: { "2026-09": 100, "2026-10": 100 } }, resource(2, "B", "B")],
      hoursCtx,
    ).moves[0].perPeriod;
    expect(moved.map((m) => `${m.periodKey}=${m.hours}`).join(" ")).toBe("2026-09=8 2026-10=8");
  });

  it("lists milestones with date and state, and truncates", () => {
    const ms: Milestone[] = [milestone(1, { achievedDate: "2026-08-01" }), milestone(2)];
    for (let i = 3; i < 3 + ALLOC_CONTEXT_MAX_MILESTONES; i++) ms.push(milestone(i));
    const lines = digest({ milestones: ms });
    expect(lines).toContain("MILESTONES:");
    expect(lines.filter((l) => /^#\d+ M\d+ date=/.test(l))).toHaveLength(ALLOC_CONTEXT_MAX_MILESTONES);
    expect(lines).toContain("…(2 more milestones truncated)");
    expect(lines.find((l) => l.startsWith("#2 M2"))).toBe("#2 M2 date=2026-10-15 open");
  });

  it("is empty when there is nothing to describe", () => {
    expect(digest({})).toEqual([]);
  });
});
