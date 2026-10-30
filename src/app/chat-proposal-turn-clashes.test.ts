// src/app/chat-proposal-turn-clashes.test.ts — §773: a staged turn's clashes see the rows the turn itself
// creates. A change to a task created earlier in the same turn is judged as the task will land.
import { describe, expect, it } from "vitest";
import { describeProposal } from "./chat-proposal-describe";
import { buildPlanRows, type ProposedCall } from "./chat-proposal";
import type { AbsenceCtx } from "./absence-clash";
import type { Workspace } from "./workspace";
import type { Absence, Milestone, Resource, Task } from "./types";

const maya = { id: 1, firstName: "Maya", lastName: "Patel", email: "maya@example.com" } as Resource;
// 2026-11-02 is a Monday.
const MAYA_WEEK = { id: 1, assignee: "Maya Patel", resourceId: 1, type: "vacation", startDate: "2026-11-03", endDate: "2026-11-07" } as Absence;
const mayaTask = {
  id: 42, taskName: "Ship the release", assignee: "Maya Patel", assigneeEmail: "maya@example.com", resourceId: 1,
  dueDate: "2026-11-12", status: "To Do", priority: "Medium",
} as Task;
const milestone = { id: 7, name: "Go-live", date: "2026-11-12", linkedTaskIds: [] } as unknown as Milestone;
const ws = {
  tasks: [mayaTask], raid: [], milestones: [milestone], changes: [], stakeholders: [],
  resources: [maya], absences: [MAYA_WEEK],
} as unknown as Workspace;
const absence: AbsenceCtx = { absences: [MAYA_WEEK], resources: [maya], holidaySet: new Set() };
const NEW_TASK = 100;
const NEW_MILESTONE = 200;

const call = (name: string, input: Record<string, unknown>): ProposedCall => ({ name, input });

function describeTurn(calls: ProposedCall[], ctx: AbsenceCtx | undefined = absence) {
  const minted = calls.filter((c) => c.name.startsWith("create_")).map((c) => (c.name === "create_task" ? NEW_TASK : NEW_MILESTONE));
  return describeProposal(calls, ws, buildPlanRows(calls, minted), undefined, ctx);
}

describe("describeProposal — a change to a row created earlier in the same turn (§773)", () => {
  it("create_task with no date, then update_task on its provisional id onto the owner's absence, warns on that row", () => {
    const rows = describeTurn([
      call("create_task", { taskName: "Draft", assignee: "Maya Patel" }),
      call("update_task", { id: NEW_TASK, dueDate: "2026-11-05" }),
    ]);
    expect(rows[1].pendingOn).toBe(0);
    expect(rows[1].plan.clashes).toHaveLength(1);
    expect(rows[1].plan.clashes[0]).toMatchObject({ entity: "task", title: "Draft", clash: { person: "Maya Patel", reason: "date-on-absence", date: "2026-11-05" } });
    expect(rows[0].plan.clashes).toEqual([]);
  });

  it("the same change onto a free day warns nowhere", () => {
    const rows = describeTurn([
      call("create_task", { taskName: "Draft", assignee: "Maya Patel", dueDate: "2026-11-12" }),
      call("update_task", { id: NEW_TASK, dueDate: "2026-11-13" }),
    ]);
    expect(rows.map((r) => r.plan.clashes)).toEqual([[], []]);
  });

  it("an owner change on a task created this turn judges the whole task, the create's due date included", () => {
    const rows = describeTurn([
      call("create_task", { taskName: "Draft", assignee: "Liam Foster", dueDate: "2026-11-05" }),
      call("update_task", { id: NEW_TASK, assignee: "Maya Patel" }),
    ]);
    expect(rows[1].plan.clashes[0]).toMatchObject({ clash: { person: "Maya Patel", date: "2026-11-05" } });
  });

  it("a second change sees the first: create, move the date, then reassign onto the absence", () => {
    const rows = describeTurn([
      call("create_task", { taskName: "Draft", assignee: "Liam Foster", dueDate: "2026-11-13" }),
      call("update_task", { id: NEW_TASK, dueDate: "2026-11-05" }),
      call("update_task", { id: NEW_TASK, assignee: "Maya Patel" }),
    ]);
    expect(rows[1].plan.clashes).toEqual([]);
    expect(rows[2].plan.clashes[0]).toMatchObject({ clash: { person: "Maya Patel", date: "2026-11-05" } });
  });

  it("a milestone created, then moved onto a linked owner's absence, warns on the move", () => {
    const rows = describeTurn([
      call("create_milestone", { name: "Beta", date: "2026-11-12", linkedTaskIds: [42] }),
      call("update_milestone", { id: NEW_MILESTONE, date: "2026-11-05" }),
    ]);
    expect(rows[0].plan.clashes).toEqual([]);
    expect(rows[1].plan.clashes[0]).toMatchObject({ entity: "milestone", title: "Beta", clash: { person: "Maya Patel", date: "2026-11-05" } });
  });

  it("a milestone linking a task created this turn judges that task's owner", () => {
    const rows = describeTurn([
      call("create_task", { taskName: "Draft", assignee: "Maya Patel", dueDate: "2026-11-12" }),
      call("update_milestone", { id: 7, date: "2026-11-05", linkedTaskIds: [NEW_TASK] }),
    ]);
    expect(rows[1].plan.clashes[0]).toMatchObject({ entity: "milestone", clash: { person: "Maya Patel", date: "2026-11-05" } });
  });

  it("changes nothing on the card but the clashes", () => {
    const calls = [
      call("create_task", { taskName: "Draft", assignee: "Maya Patel" }),
      call("update_task", { id: NEW_TASK, dueDate: "2026-11-05" }),
      call("update_milestone", { id: 7, date: "2026-11-05", linkedTaskIds: [NEW_TASK] }),
    ];
    const strip = (rows: ReturnType<typeof describeTurn>) => rows.map((r) => ({ ...r, plan: { ...r.plan, clashes: [] } }));
    expect(strip(describeTurn(calls))).toEqual(strip(describeTurn(calls, undefined)));
  });
});
