// src/app/chat-absence-clashes.test.ts — §773: the one judgment the chat's staging gate and the four date
// tools' results share. It reads the SAME plan the review card shows (`describeProposal`), so the card, the
// gate and the tool result cannot disagree.
import { describe, expect, it } from "vitest";
import { callAbsenceClashes, DATE_WRITE_TOOLS } from "./chat-absence-clashes";
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
const milestone = { id: 7, name: "Go-live", date: "2026-11-12", linkedTaskIds: [42] } as Milestone;
const ws = {
  tasks: [mayaTask], raid: [], milestones: [milestone], changes: [], stakeholders: [],
  resources: [maya], absences: [MAYA_WEEK],
} as unknown as Workspace;
const absence: AbsenceCtx = { absences: [MAYA_WEEK], resources: [maya], holidaySet: new Set() };
const ON_ABSENCE = { person: "Maya Patel", reason: "date-on-absence", date: "2026-11-05", ranges: [{ start: "2026-11-03", end: "2026-11-07" }] };

describe("callAbsenceClashes (§773)", () => {
  it("names exactly the four date-writing tools", () => {
    expect([...DATE_WRITE_TOOLS].sort()).toEqual(["create_milestone", "create_task", "update_milestone", "update_task"]);
  });

  it("update_task moving the due date onto the owner's absence clashes", () => {
    const out = callAbsenceClashes({ name: "update_task", input: { id: 42, dueDate: "2026-11-05" } }, ws, absence);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject(ON_ABSENCE);
  });

  it("update_task moving the due date off any absence does not", () => {
    expect(callAbsenceClashes({ name: "update_task", input: { id: 42, dueDate: "2026-11-13" } }, ws, absence)).toEqual([]);
  });

  it("update_task changing no date and no owner does not, even on a row that already clashes", () => {
    const already = { ...ws, tasks: [{ ...mayaTask, dueDate: "2026-11-05" }] } as Workspace;
    expect(callAbsenceClashes({ name: "update_task", input: { id: 42, priority: "High" } }, already, absence)).toEqual([]);
  });

  it("create_task due on the owner's absence clashes; due off it does not", () => {
    const input = { taskName: "Draft", assignee: "Maya Patel", dueDate: "2026-11-05" };
    expect(callAbsenceClashes({ name: "create_task", input }, ws, absence)[0]).toMatchObject(ON_ABSENCE);
    expect(callAbsenceClashes({ name: "create_task", input: { ...input, dueDate: "2026-11-13" } }, ws, absence)).toEqual([]);
  });

  it("create_milestone linked to a task whose owner is away on its date clashes; off it does not", () => {
    const input = { name: "Beta", date: "2026-11-05", linkedTaskIds: [42] };
    expect(callAbsenceClashes({ name: "create_milestone", input }, ws, absence)[0]).toMatchObject({ ...ON_ABSENCE });
    expect(callAbsenceClashes({ name: "create_milestone", input: { ...input, date: "2026-11-13" } }, ws, absence)).toEqual([]);
  });

  it("update_milestone moving the date onto a linked owner's absence clashes; off it does not", () => {
    expect(callAbsenceClashes({ name: "update_milestone", input: { id: 7, date: "2026-11-05" } }, ws, absence)[0]).toMatchObject(ON_ABSENCE);
    expect(callAbsenceClashes({ name: "update_milestone", input: { id: 7, date: "2026-11-13" } }, ws, absence)).toEqual([]);
  });

  it("any other tool is never judged", () => {
    expect(callAbsenceClashes({ name: "update_raid_item", input: { id: 1, dueDate: "2026-11-05" } }, ws, absence)).toEqual([]);
    expect(callAbsenceClashes({ name: "create_absence", input: { assignee: "Maya Patel", startDate: "2026-11-05", endDate: "2026-11-05" } }, ws, absence)).toEqual([]);
  });
});
