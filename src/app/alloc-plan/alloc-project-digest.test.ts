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
    expect(text).toContain('#3 "Task 3" owner=#1 remaining=16h');
  });

  it("one line per task even with a line break or a #id in its name", () => {
    const lines = digest({ tasks: [task(10, { taskName: "Fix\n#99 fake owner=#1", resourceId: 2 })] });
    expect(taskLines(lines)).toHaveLength(1);
    expect(lines.some((l) => l.startsWith("#99"))).toBe(false);
    const unquoted = taskLines(lines)[0].replace(/"(?:[^"\\]|\\.)*"/g, "");
    expect(unquoted.match(/owner=/g)).toHaveLength(1);
    expect(unquoted).toContain("owner=#2 ");
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
    expect(lines[2]).toContain('owner=name:"Zed #7" ');
  });

  // Second wave, 3. Mutation: drop the token and a Jira task's line reads like any other.
  it("marks a Jira-synced task with a jira token, and only that task", () => {
    const lines = taskLines(digest({ tasks: [task(1, { jiraKey: "ABC-1" }), task(2)] }));
    expect(lines[0]).toMatch(/ status=To Do jira( |$)/);
    expect(lines[1]).not.toMatch(/ jira( |$)/);
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
        stakeholder(6, { resourceId: 99, raci: { "5": "R" } }),
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

  // Second wave, 4 — "help Maya" names her by first name alone. Mutation: match the full name only and her five
  // late-due tasks are truncated away.
  it("keeps the tasks of a person named by first or last name alone, as a whole word", () => {
    const all: Task[] = [];
    for (let i = 1; i <= 160; i++) {
      const maya = i % 32 === 0;
      all.push(task(i, { resourceId: maya ? 3 : 1, dueDate: maya ? "2026-10-30" : "2026-09-10" }));
    }
    const mayasShown = (instruction: string) => taskLines(digest({
      tasks: all,
      resources: [resource(1, "Ana", "Silva"), resource(3, "Maya", "Patel")],
      instruction,
    })).filter((l) => l.includes("owner=#3 ")).length;
    expect(mayasShown("help Maya")).toBe(5);
    expect(mayasShown("move work off PATEL in October")).toBe(5);
    // Whole words only: "Mayan" and "Patelli" name nobody.
    expect(mayasShown("the Mayan calendar")).toBe(0);
    expect(mayasShown("ask Patelli")).toBe(0);
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

  // Second wave, 5 (found by the size test): a task's hours list named every plan period, while the model may use
  // only the listed ones. Mutation: drop the filter and October appears.
  it("lists a task's hours only for the periods the digest shows", () => {
    const t = task(10, { resourceId: 1, startDate: "2026-09-01", dueDate: "2026-10-30" });
    const line = taskLines(digest({ tasks: [t], shownPeriodKeys: new Set(["2026-09"]) }))[0];
    expect(line).toMatch(/ hours=2026-09=[0-9.]+$/);
    expect(line).not.toContain("2026-10=");
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
    expect(lines.filter((l) => /^#\d+ "M\d+" date=/.test(l))).toHaveLength(ALLOC_CONTEXT_MAX_MILESTONES);
    expect(lines).toContain("…(2 more milestones truncated)");
    expect(lines.find((l) => l.startsWith("#2 "))).toBe('#2 "M2" date=2026-10-15 open');
  });

  // Second wave, 2: a linked owner the RESOURCES list does not show is not a typed name — moving the task carries
  // its hours. Mutation: render `name:` for them again and the prompt tells the model they carry none.
  it("names a linked owner who is not in the shown resources as hidden, and drops them from RACI", () => {
    const resources = Array.from({ length: 121 }, (_, i) => resource(i + 1, "First", `Last${i + 1}`));
    const lines = digest({
      resources,
      shownResourceIds: new Set(resources.slice(0, 120).map((r) => r.id)),
      tasks: [task(1, { resourceId: 121 }), task(2, { resourceId: 5 })],
      milestones: [milestone(5)],
      stakeholders: [
        stakeholder(1, { resourceId: 121, raci: { "5": "R" } }),
        stakeholder(2, { resourceId: 5, raci: { "5": "A" } }),
      ],
    });
    const tl = taskLines(lines);
    expect(tl.find((l) => l.startsWith("#1 "))).toContain('owner=hidden:"First Last121" ');
    expect(tl.find((l) => l.startsWith("#2 "))).toContain("owner=#5 ");
    expect(lines).toContain("milestone #5: A=#5");
  });

  it('does not read the verb "may" as May, but reads "May 2026"', () => {
    const mayPlan: ResourcePlan = { startDate: "2026-04-01", endDate: "2026-07-31", granularity: "month", currency: "EUR" };
    const mayCtx: HoursMoveCtx = { ...hoursCtx, plan: mayPlan, today: "2026-04-01" };
    const all: Task[] = [];
    for (let i = 1; i <= 155; i++) all.push(task(i, { startDate: "2026-04-02", dueDate: "2026-04-10" }));
    for (let i = 156; i <= 160; i++) all.push(task(i, { startDate: "2026-05-10", dueDate: "2026-05-20" }));
    const showsMay = (instruction: string) =>
      taskLines(digest({ tasks: all, hoursCtx: mayCtx, instruction })).some((l) => l.startsWith("#156 "));
    expect(showsMay("Zoe may need help")).toBe(false);
    expect(showsMay("plan in May 2026")).toBe(true);
    expect(showsMay("plan 3 May")).toBe(true);
    expect(showsMay("plan june")).toBe(false);
  });

  it("an overdue task counts for the period it is planned in (today), not its past span", () => {
    const lateCtx: HoursMoveCtx = { ...hoursCtx, today: "2026-10-10" };
    const all: Task[] = [];
    for (let i = 1; i <= 155; i++) all.push(task(i, { startDate: "2026-08-10", dueDate: "2026-08-15" }));
    for (let i = 156; i <= 160; i++) all.push(task(i, { startDate: "2026-09-10", dueDate: "2026-09-20" }));
    const showsLate = (instruction: string) =>
      taskLines(digest({ tasks: all, hoursCtx: lateCtx, instruction })).some((l) => l.startsWith("#156 "));
    expect(showsLate("plan 2026-09")).toBe(false);
  });

  // Final review, Deferred 1. Mutation: let a task that is NOT overdue start at its own start date even when that is
  // before today, and the five tasks below rank as overlapping September and survive the truncation.
  it("a task already started counts from today, not from its past start date", () => {
    const all: Task[] = [];
    for (let i = 1; i <= 155; i++) all.push(task(i, { startDate: "2026-10-11", dueDate: "2026-10-15" }));
    for (let i = 156; i <= 160; i++) all.push(task(i, { startDate: "2026-09-10", dueDate: "2026-10-20" }));
    const shows = (today: string) =>
      taskLines(digest({ tasks: all, hoursCtx: { ...hoursCtx, today }, instruction: "plan 2026-09" })).some((l) => l.startsWith("#156 "));
    expect(shows("2026-10-10")).toBe(false);
    // Control: with today before the start date, the span does overlap September and the task is lifted.
    expect(shows("2026-09-01")).toBe(true);
  });

  it("sorts a task with no due date after every dated one", () => {
    const all: Task[] = [task(1, { dueDate: "" })];
    for (let i = 2; i <= 151; i++) all.push(task(i, { dueDate: "2026-10-30" }));
    const lines = digest({ tasks: all });
    expect(taskLines(lines).some((l) => l.startsWith("#1 "))).toBe(false);
    expect(lines).toContain("…(1 more tasks truncated)");
    expect(taskLines(digest({ tasks: [all[0]] }))[0]).toContain("due=-");
  });

  it("is empty when there is nothing to describe", () => {
    expect(digest({})).toEqual([]);
  });
});
