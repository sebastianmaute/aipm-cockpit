// src/app/inline-ai-edit/plan.clashes.test.ts — §773: the shared preview warns when a proposed change lands
// work on a day its owner is away. One ClashNote per clash, on the item AFTER the change, only when a
// trigger fired (a new or moved date, a new task owner, a task newly linked to a milestone).
import { describe, expect, it } from "vitest";
import { describeEntityCalls, type ToolUseLike } from "./plan";
import { INLINE_DESCRIPTORS } from "./entity-descriptor";
import type { AbsenceCtx } from "../absence-clash";
import type { Workspace } from "../workspace";
import type { Absence, Milestone, Resource, Task } from "../types";

const maya = { id: 1, firstName: "Maya", lastName: "Patel", email: "maya@example.com" } as Resource;
const liam = { id: 2, firstName: "Liam", lastName: "Foster", email: "liam@example.com" } as Resource;
// 2026-11-02 is a Monday.
const MAYA_WEEK = { id: 1, assignee: "Maya Patel", resourceId: 1, type: "vacation", startDate: "2026-11-03", endDate: "2026-11-07" } as Absence;

const task = {
  id: 42, taskName: "Ship the release", assignee: "Liam Foster", assigneeEmail: "liam@example.com", resourceId: 2,
  dueDate: "2026-11-12", status: "To Do", priority: "Medium",
} as Task;
const mayaTask = {
  id: 43, taskName: "Write the notes", assignee: "Maya Patel", assigneeEmail: "maya@example.com", resourceId: 1,
  dueDate: "2026-11-20", status: "To Do", priority: "Medium",
} as Task;
const milestone = { id: 7, name: "Go-live", date: "2026-11-05", linkedTaskIds: [42] } as Milestone;

const ws = {
  tasks: [task, mayaTask], raid: [], milestones: [milestone], changes: [], stakeholders: [],
  resources: [maya, liam], absences: [MAYA_WEEK],
} as unknown as Workspace;
const absence: AbsenceCtx = { absences: [MAYA_WEEK], resources: [maya, liam], holidaySet: new Set() };

function block(name: string, input: Record<string, unknown>): ToolUseLike {
  return { type: "tool_use", id: "b1", name, input };
}
type Item = Parameters<typeof describeEntityCalls>[1]["item"];
const taskCtx = { descriptor: INLINE_DESCRIPTORS.task, item: task as unknown as Item, ws, absence };
const milestoneCtx = { descriptor: INLINE_DESCRIPTORS.milestone, item: milestone as unknown as Item, ws, absence };

describe("describeEntityCalls — absence clashes (§773)", () => {
  it("an update_task moving the due date into the owner's absence yields one note", () => {
    const onMaya = { ...task, assignee: "Maya Patel", assigneeEmail: "maya@example.com", resourceId: 1 };
    const plan = describeEntityCalls([block("update_task", { id: 42, dueDate: "2026-11-05" })], {
      ...taskCtx, item: onMaya as unknown as Item,
    });
    expect(plan.clashes).toEqual([
      {
        entity: "task", id: 42, title: "Ship the release",
        clash: {
          person: "Maya Patel", resourceId: 1, reason: "date-on-absence", which: "due", date: "2026-11-05",
          ranges: [{ start: "2026-11-03", end: "2026-11-07" }],
        },
      },
    ]);
  });

  it("an update_task changing only the owner to someone away on the due date yields one note", () => {
    const dueInMayaWeek = { ...task, dueDate: "2026-11-04" };
    const plan = describeEntityCalls([block("update_task", { id: 42, assignee: "Maya Patel" })], {
      ...taskCtx, item: dueInMayaWeek as unknown as Item,
    });
    expect(plan.clashes).toHaveLength(1);
    expect(plan.clashes[0]).toMatchObject({ entity: "task", id: 42, clash: { person: "Maya Patel", which: "due", date: "2026-11-04" } });
  });

  it("an update_milestone adding a linked task whose owner is away on the milestone date yields one note", () => {
    const plan = describeEntityCalls([block("update_milestone", { id: 7, linkedTaskIds: [42, 43] })], milestoneCtx);
    expect(plan.clashes).toEqual([
      {
        entity: "milestone", id: 7, title: "Go-live",
        clash: {
          person: "Maya Patel", resourceId: 1, reason: "date-on-absence", which: "milestone", date: "2026-11-05",
          ranges: [{ start: "2026-11-03", end: "2026-11-07" }],
        },
      },
    ]);
  });

  it("an update_milestone moving its date onto a linked owner's absence yields one note", () => {
    const linkedToMaya = { ...milestone, date: "2026-11-20", linkedTaskIds: [43] };
    const plan = describeEntityCalls([block("update_milestone", { id: 7, date: "2026-11-06" })], {
      ...milestoneCtx, item: linkedToMaya as unknown as Item,
    });
    expect(plan.clashes).toHaveLength(1);
    expect(plan.clashes[0]).toMatchObject({ entity: "milestone", id: 7, clash: { date: "2026-11-06" } });
  });

  it("a create_task with a clashing due date yields one note with id null", () => {
    const plan = describeEntityCalls(
      [block("create_task", { taskName: "Prepare demo", assignee: "Maya Patel", dueDate: "2026-11-06" })],
      taskCtx,
    );
    expect(plan.clashes).toEqual([
      {
        entity: "task", id: null, title: "Prepare demo",
        clash: {
          person: "Maya Patel", resourceId: 1, reason: "date-on-absence", which: "due", date: "2026-11-06",
          ranges: [{ start: "2026-11-03", end: "2026-11-07" }],
        },
      },
    ]);
  });

  it("a create_milestone dated on a linked owner's absence yields one note with id null", () => {
    const plan = describeEntityCalls(
      [block("create_milestone", { name: "Beta", date: "2026-11-04", linkedTaskIds: [43] })],
      milestoneCtx,
    );
    expect(plan.clashes).toHaveLength(1);
    expect(plan.clashes[0]).toMatchObject({ entity: "milestone", id: null, title: "Beta", clash: { which: "milestone" } });
  });

  it("an update that changes neither date nor owner yields none, even on a clashing row", () => {
    const alreadyClashing = { ...task, assignee: "Maya Patel", assigneeEmail: "maya@example.com", resourceId: 1, dueDate: "2026-11-05" };
    const plan = describeEntityCalls([block("update_task", { id: 42, status: "In Progress" })], {
      ...taskCtx, item: alreadyClashing as unknown as Item,
    });
    expect(plan.updates).toHaveLength(1);
    expect(plan.clashes).toEqual([]);
  });

  it("a milestone update re-sending the same links on its old date yields none", () => {
    const linkedToMaya = { ...milestone, linkedTaskIds: [43] };
    const plan = describeEntityCalls([block("update_milestone", { id: 7, linkedTaskIds: [43], name: "Launch" })], {
      ...milestoneCtx, item: linkedToMaya as unknown as Item,
    });
    expect(plan.updates).toHaveLength(1);
    expect(plan.clashes).toEqual([]);
  });

  it("a moved date outside every absence yields none", () => {
    const onMaya = { ...task, assignee: "Maya Patel", assigneeEmail: "maya@example.com", resourceId: 1 };
    const plan = describeEntityCalls([block("update_task", { id: 42, dueDate: "2026-11-10" })], {
      ...taskCtx, item: onMaya as unknown as Item,
    });
    expect(plan.updates).toHaveLength(1);
    expect(plan.clashes).toEqual([]);
  });

  it("computes no clashes when the ctx carries no absence", () => {
    const onMaya = { ...task, assignee: "Maya Patel", assigneeEmail: "maya@example.com", resourceId: 1 };
    const plan = describeEntityCalls([block("update_task", { id: 42, dueDate: "2026-11-05" })], {
      descriptor: INLINE_DESCRIPTORS.task, item: onMaya as unknown as Item, ws,
    });
    expect(plan.updates).toHaveLength(1);
    expect(plan.clashes).toEqual([]);
  });

  it("a rejected due date yields none", () => {
    const onMaya = { ...task, assignee: "Maya Patel", assigneeEmail: "maya@example.com", resourceId: 1 };
    const plan = describeEntityCalls([block("update_task", { id: 42, dueDate: "05.11.2026" })], {
      ...taskCtx, item: onMaya as unknown as Item,
    });
    expect(plan.clashes).toEqual([]);
  });
});

describe("describeEntityCalls — what a trigger judges (§773 R2)", () => {
  it("a relink on the old date judges only the newly linked owners", () => {
    // Maya (task 43) is away on the date but already linked; Liam (task 42) is newly linked and free.
    const linkedToMaya = { ...milestone, linkedTaskIds: [43] };
    const plan = describeEntityCalls([block("update_milestone", { id: 7, linkedTaskIds: [43, 42] })], {
      ...milestoneCtx, item: linkedToMaya as unknown as Item,
    });
    expect(plan.links).toHaveLength(1);
    expect(plan.clashes).toEqual([]);
  });

  // Maya's task starts inside her absence (stored) and is due later.
  const startsAway = {
    ...task, assignee: "Maya Patel", assigneeEmail: "maya@example.com", resourceId: 1,
    startDate: "2026-11-04", dueDate: "2026-11-30",
  };

  it("a due-only move does not warn about an unchanged start date on an absence", () => {
    const plan = describeEntityCalls([block("update_task", { id: 42, dueDate: "2026-11-27" })], {
      ...taskCtx, item: startsAway as unknown as Item,
    });
    expect(plan.updates).toHaveLength(1);
    expect(plan.clashes).toEqual([]);
  });

  it("a due-only move still judges the span the move changes", () => {
    // Start Tue 11-03, due moved to Mon 11-09: five working days, four of them away.
    const plan = describeEntityCalls([block("update_task", { id: 42, dueDate: "2026-11-09" })], {
      ...taskCtx, item: { ...startsAway, startDate: "2026-11-03" } as unknown as Item,
    });
    expect(plan.clashes).toEqual([expect.objectContaining({ clash: expect.objectContaining({ reason: "absent-most-of-span" }) })]);
  });

  it("an owner change judges the whole task, its stored start date included", () => {
    const onLiam = { ...startsAway, assignee: "Liam Foster", assigneeEmail: "liam@example.com", resourceId: 2 };
    const plan = describeEntityCalls([block("update_task", { id: 42, assignee: "Maya Patel" })], {
      ...taskCtx, item: onLiam as unknown as Item,
    });
    expect(plan.clashes).toEqual([
      expect.objectContaining({ entity: "task", id: 42, clash: expect.objectContaining({ which: "start", date: "2026-11-04" }) }),
    ]);
  });
});

describe("describeEntityCalls — later blocks see earlier ones (§773 M-2)", () => {
  it("an owner change, then a due-date move onto the new owner's absence, warns on the move", () => {
    const plan = describeEntityCalls([
      block("update_task", { id: 42, assignee: "Maya Patel" }),
      block("update_task", { id: 42, dueDate: "2026-11-05" }),
    ], taskCtx);
    expect(plan.clashes).toEqual([
      expect.objectContaining({ entity: "task", id: 42, clash: expect.objectContaining({ person: "Maya Patel", date: "2026-11-05" }) }),
    ]);
  });

  it("an owner change away from the absent person, then a move into her absence, does not warn about her", () => {
    const onMaya = { ...task, assignee: "Maya Patel", assigneeEmail: "maya@example.com", resourceId: 1 };
    const plan = describeEntityCalls([
      block("update_task", { id: 42, assignee: "Liam Foster", assigneeEmail: "liam@example.com" }),
      block("update_task", { id: 42, dueDate: "2026-11-05" }),
    ], { ...taskCtx, item: onMaya as unknown as Item });
    expect(plan.clashes).toEqual([]);
  });

  it("once an earlier block changed the owner, a later move judges the whole task, its start date included", () => {
    const startInMayaWeek = { ...task, startDate: "2026-11-04" };
    const plan = describeEntityCalls([
      block("update_task", { id: 42, assignee: "Maya Patel" }),
      block("update_task", { id: 42, dueDate: "2026-11-13" }),
    ], { ...taskCtx, item: startInMayaWeek as unknown as Item });
    expect(plan.clashes).toHaveLength(2);
    expect(plan.clashes[1]).toEqual(
      expect.objectContaining({ entity: "task", id: 42, clash: expect.objectContaining({ which: "start", date: "2026-11-04" }) }),
    );
  });
});

describe("describeEntityCalls — closed tasks (§773 P-1)", () => {
  const onMaya = { ...task, assignee: "Maya Patel", assigneeEmail: "maya@example.com", resourceId: 1 };

  it("moving a Done task's due date onto its owner's absence does not warn", () => {
    const plan = describeEntityCalls([block("update_task", { id: 42, dueDate: "2026-11-05" })], {
      ...taskCtx, item: { ...onMaya, status: "Done", completedDate: "2026-10-30" } as unknown as Item,
    });
    expect(plan.clashes).toEqual([]);
  });

  it("a change that closes the task as it moves the date does not warn", () => {
    const plan = describeEntityCalls([block("update_task", { id: 42, dueDate: "2026-11-05", status: "Cancelled" })], {
      ...taskCtx, item: onMaya as unknown as Item,
    });
    expect(plan.clashes).toEqual([]);
  });

  it("a change that reopens the task as it moves the date is judged", () => {
    const plan = describeEntityCalls([block("update_task", { id: 42, dueDate: "2026-11-05", status: "In Progress" })], {
      ...taskCtx, item: { ...onMaya, status: "Done", completedDate: "2026-10-30" } as unknown as Item,
    });
    expect(plan.clashes).toEqual([expect.objectContaining({ entity: "task", id: 42, clash: expect.objectContaining({ date: "2026-11-05" }) })]);
  });

  it("an earlier block that closes the task silences a later move", () => {
    const plan = describeEntityCalls([
      block("update_task", { id: 42, status: "Done" }),
      block("update_task", { id: 42, dueDate: "2026-11-05" }),
    ], { ...taskCtx, item: onMaya as unknown as Item });
    expect(plan.clashes).toEqual([]);
  });

  it("a milestone moved onto the absence of a Done linked task's owner does not warn", () => {
    const doneWs = { ...ws, tasks: [{ ...task, assignee: "Maya Patel", resourceId: 1, status: "Done", completedDate: "2026-10-30" }, mayaTask] } as unknown as Workspace;
    const plan = describeEntityCalls([block("update_milestone", { id: 7, date: "2026-11-04" })], { ...milestoneCtx, ws: doneWs });
    expect(plan.clashes).toEqual([]);
  });
});
