// src/app/chat-absence-clashes.test.ts — §773: the one judgment the chat's staging gate and the four date
// tools' results share. It reads the SAME plan the review card shows (`describeProposal`), so the card, the
// gate and the tool result cannot disagree.
import { describe, expect, it } from "vitest";
import { backstopWorkspace, callAbsenceClashes, DATE_WRITE_TOOLS } from "./chat-absence-clashes";
import type { AbsenceCtx } from "./absence-clash";
import { emptyWorkspace, type Workspace } from "./workspace";
import type {
  Absence, BudgetBucket, ChangeItem, Milestone, ProjectStatus, RaidItem, Resource, Role, Shift, Stakeholder, Task,
} from "./types";
import type { CalendarEvent } from "./calendar-event";
import type { ProjectDocument } from "./document-model";

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

// §773 P-2 — the dispatcher's backstop judges a workspace holding only tasks, milestones, resources and absences
// (`backstopWorkspace`). Pinned: on a workspace with every other slice populated, the four date tools give the
// same answer against the full workspace and the stripped one, clashing and not.
describe("callAbsenceClashes — the backstop's stripped workspace (§773 P-2)", () => {
  const liam = { id: 2, firstName: "Liam", lastName: "Foster", email: "liam@example.com" } as Resource;
  const liamTask = { id: 43, taskName: "Write the notes", assignee: "Liam Foster", resourceId: 2, dueDate: "2026-11-20", status: "To Do", priority: "Medium" } as Task;
  // Typed per slice (Q-2), so a mis-shaped slice is a tsc error rather than something that merely looks
  // populated; only single rows are cast, to keep the fixture short.
  const full: Workspace = {
    ...emptyWorkspace(),
    tasks: [mayaTask, liamTask],
    milestones: [milestone],
    absences: [MAYA_WEEK],
    resources: [maya, liam],
    raid: [{ id: 5, category: "R", title: "Vendor slips", status: "Open", linkedTaskIds: [42, 43], raisedDate: "2026-10-01", causedByRaidIds: [], stakeholderIds: [9] } as unknown as RaidItem],
    changes: [{ id: 6, title: "Scope add", status: "Proposed", type: "Scope", raisedDate: "2026-10-01", linkedTaskIds: [42], linkedRaidIds: [5], stakeholderIds: [9] } as unknown as ChangeItem],
    stakeholders: [{ id: 9, name: "Sofia Ramirez", category: "Sponsor", influence: "High", interest: "High" } as unknown as Stakeholder],
    shifts: [{ id: 1, resourceId: 1, date: "2026-11-05", start: "08:00", end: "16:00" } as unknown as Shift],
    roles: [{ id: 1, name: "Engineer" } as unknown as Role],
    disciplines: [{ id: 1, name: "Engineering" }],
    grades: [{ id: 1, name: "Senior" }],
    // Distinctive on every field, so a judgment that read the plan would see it differ from the stripped side's
    // `defaultResourcePlan(today)`.
    plan: { startDate: "2025-01-06", endDate: "2027-12-31", granularity: "week", currency: "GBP", budgetFollowsPlan: true },
    budgets: [{ id: 1, name: "Build" } as unknown as BudgetBucket],
    fxRates: { base: "EUR", date: "2026-10-30", fetchedAt: "2026-10-30T16:00:00Z", rates: { GBP: 0.86 } },
    status: { overall: "green" } as unknown as ProjectStatus,
    calendarEvents: [{ id: 1, title: "Standup", date: "2026-11-05", attendeeResourceIds: [1] } as unknown as CalendarEvent],
    documents: [{ id: "d1", title: "Plan", blocks: [] } as unknown as ProjectDocument],
  };
  const stripped = backstopWorkspace(full);
  const fullAbsence: AbsenceCtx = { absences: [MAYA_WEEK], resources: [maya, liam], holidaySet: new Set() };
  const calls = [
    { name: "update_task", input: { id: 42, dueDate: "2026-11-05" } },
    { name: "update_task", input: { id: 42, dueDate: "2026-11-13" } },
    { name: "update_task", input: { id: 43, assignee: "Maya Patel", dueDate: "2026-11-04" } },
    { name: "update_task", input: { id: 43, assignee: "Maya Patel" } },
    { name: "create_task", input: { taskName: "New", assignee: "Maya Patel", dueDate: "2026-11-06" } },
    { name: "create_task", input: { taskName: "New", assignee: "Maya Patel", dueDate: "2026-11-16" } },
    { name: "update_milestone", input: { id: 7, date: "2026-11-05" } },
    { name: "update_milestone", input: { id: 7, date: "2026-11-19" } },
    { name: "update_milestone", input: { id: 7, linkedTaskIds: [42, 43] } },
    { name: "create_milestone", input: { name: "Beta", date: "2026-11-04", linkedTaskIds: [42, 43] } },
    { name: "create_milestone", input: { name: "Beta", date: "2026-11-18", linkedTaskIds: [42, 43] } },
  ];

  it("keeps only the four slices it is said to read", () => {
    expect(stripped.tasks).toBe(full.tasks);
    expect(stripped.milestones).toBe(full.milestones);
    expect(stripped.resources).toBe(full.resources);
    expect(stripped.absences).toBe(full.absences);
    expect(stripped.raid).toEqual([]);
    expect(stripped.stakeholders).toEqual([]);
  });

  it("the full side really is populated where the stripped side is not (anti-vacuity)", () => {
    for (const key of ["raid", "changes", "stakeholders", "shifts", "roles", "disciplines", "grades", "budgets", "calendarEvents", "documents"] as const) {
      expect(full[key]?.length, key).toBeGreaterThan(0);
      expect(stripped[key] ?? [], key).toEqual([]);
    }
    expect(stripped.plan).not.toEqual(full.plan);
    expect(stripped.fxRates).toBeNull();
    expect(full.fxRates).not.toBeNull();
  });

  it.each(calls.map((c) => [`${c.name} ${JSON.stringify(c.input)}`, c] as const))("%s: same answer", (_label, c) => {
    expect(callAbsenceClashes(c, stripped, fullAbsence)).toEqual(callAbsenceClashes(c, full, fullAbsence));
  });

  it("the fixture exercises both answers (anti-vacuity)", () => {
    const answers = calls.map((c) => callAbsenceClashes(c, full, fullAbsence).length);
    expect(answers.filter((n) => n > 0).length).toBeGreaterThanOrEqual(5);
    expect(answers.filter((n) => n === 0).length).toBeGreaterThanOrEqual(5);
  });
});
