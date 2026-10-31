// src/app/inline-ai-edit/plan-clashes.ts — §773: the absence clashes one judged block would cause, for the
// shared preview (`describeEntityCalls`). Pure and i18n-free.
//
// ★ Read off the block's FINAL plan, never its raw input: a field the plan rejected is not written, so it
//  cannot move a date onto an absence. The item is rebuilt as the writer will store it, then judged by the
//  one clash rule (`absence-clash.ts`).
// ★ Only a trigger asks the question (owner-approved): a new or moved date, a new task owner, a task newly
//  linked to a milestone. An update changing none of those yields nothing, even on an already-clashing row.
// ★★ A trigger judges only what it makes newly the owner's (ruling R2): a date-only move asks about the
//  moved date and the span it changes, never an unchanged stored start date; a new owner or a new link
//  hands over the whole item, so every date is judged.
// ★★ A later block of the same change is judged against the item as the earlier blocks leave it
//  (`carryClashes`, M-1/M-2): an owner change, then a due-date move, judges the move with the NEW owner.
//  Once an earlier block changed the owner the item is newly theirs, so a later move judges it whole.
import { milestoneClashes, taskClashes, type AbsenceClash, type AbsenceCtx } from "../absence-clash";
import { linkPersonForWrite } from "../resource-foundation";
import { sanitizeAssignee, sanitizeIsoDate, sanitizeLoadedEmail } from "../sanitize";
import { isTaskStatus } from "../task-status";
import type { Task, TaskStatus } from "../types";
import type { Workspace } from "../workspace";
import type { EntityDescriptor } from "./entity-descriptor";
import type { ClashNote, EditPlan, ToolUseLike } from "./plan";
import { str } from "./str";

type Row = Readonly<Record<string, unknown>> & { id: number };

const TASK_PERSON_FIELDS = ["assignee", "assigneeEmail"] as const;

function tasksOf(ws: Workspace): readonly Task[] {
  return Array.isArray(ws.tasks) ? ws.tasks : [];
}

function idList(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
}

function notes(entity: ClashNote["entity"], id: number | null, title: string, clashes: AbsenceClash[]): ClashNote[] {
  return clashes.map((clash) => ({ entity, id, title, clash }));
}

/** The task's person fields AFTER the write; a changed person re-resolves its link exactly as
 *  `updateTask` does (`linkPersonForWrite`), an untouched one keeps it. The status is the one after the write
 *  too, so a change that closes the task is not warned and one that reopens it is judged (§773 P-1). */
function taskAfter(item: Row, changed: ReadonlyMap<string, string>, absence: AbsenceCtx): Parameters<typeof taskClashes>[0] {
  const assignee = changed.get("assignee") ?? str(item.assignee);
  const assigneeEmail = changed.get("assigneeEmail") ?? str(item.assigneeEmail);
  const personChanged = TASK_PERSON_FIELDS.some((f) => changed.has(f));
  const storedId = typeof item.resourceId === "number" ? item.resourceId : undefined;
  return {
    assignee,
    resourceId: personChanged ? (linkPersonForWrite({ assignee, assigneeEmail }, absence.resources) ?? undefined) : storedId,
    startDate: typeof item.startDate === "string" ? item.startDate : undefined,
    dueDate: changed.get("dueDate") ?? str(item.dueDate),
    status: statusOf(changed.get("status") ?? item.status),
  };
}

function statusOf(v: unknown): TaskStatus | undefined {
  return isTaskStatus(v) ? v : undefined;
}

/** The task fields one block's plan writes, as the writer stores them. */
function taskChanges(one: EditPlan): Map<string, string> {
  return new Map(one.updates.filter((u) => u.entity === "task").map((u) => [u.field, u.raw ?? u.after]));
}

function updateTaskNotes(one: EditPlan, item: Row, absence: AbsenceCtx, ownerChanged: boolean): ClashNote[] {
  const changed = taskChanges(one);
  const personChanged = TASK_PERSON_FIELDS.some((f) => changed.has(f));
  if (!changed.has("dueDate") && !personChanged) return [];
  const clashes = taskClashes(taskAfter(item, changed, absence), absence, { ignoreStart: !personChanged && !ownerChanged });
  return notes("task", item.id, str(item.taskName), clashes);
}

function updateMilestoneNotes(one: EditPlan, item: Row, ws: Workspace, absence: AbsenceCtx): ClashNote[] {
  const moved = one.updates.find((u) => u.entity === "milestone" && u.field === "date");
  const relinked = one.links.find((l) => l.entity === "milestone" && l.target === "row" && l.field === "linkedTaskIds");
  const before = idList(item.linkedTaskIds);
  const after = relinked ? relinked.rawIds : before;
  const title = str(item.name);
  // A moved date asks about every owner linked after the write; a relink alone only about the new ones.
  if (moved) {
    const date = moved.raw ?? moved.after;
    return notes("milestone", item.id, title, milestoneClashes({ date, linkedTaskIds: after }, tasksOf(ws), absence));
  }
  const gained = after.filter((id) => !before.includes(id));
  if (gained.length === 0) return [];
  return notes("milestone", item.id, title, milestoneClashes({ date: str(item.date), linkedTaskIds: gained }, tasksOf(ws), absence));
}

function createNotes(one: EditPlan, ws: Workspace, absence: AbsenceCtx): ClashNote[] {
  return one.creates.flatMap((c) => {
    if (c.entity === "task") {
      // The fields `createTask` stores, read through its own sanitizers.
      const assignee = sanitizeAssignee(c.input.assignee);
      const assigneeEmail = sanitizeLoadedEmail(c.input.assigneeEmail);
      const resourceId = linkPersonForWrite({ assignee, assigneeEmail }, absence.resources) ?? undefined;
      const dueDate = sanitizeIsoDate(c.input.dueDate);
      const status = statusOf(c.input.status);
      return notes("task", null, c.title, taskClashes({ assignee, resourceId, startDate: undefined, dueDate, status }, absence));
    }
    if (c.entity === "milestone") {
      const links = one.links.find((l) => l.entity === "milestone" && l.target === "create" && l.field === "linkedTaskIds");
      const date = sanitizeIsoDate(c.input.date);
      return notes("milestone", null, c.title, milestoneClashes({ date, linkedTaskIds: links?.rawIds ?? [] }, tasksOf(ws), absence));
    }
    return [];
  });
}

/** The clashes ONE block's final plan (`one`) would cause. `item` is the row the plan is bound to, as the
 *  earlier blocks of the same change leave it; `ownerChanged`: one of them gave it a new owner. */
export function clashNotesFor(
  b: ToolUseLike,
  one: EditPlan,
  d: EntityDescriptor,
  item: Row,
  ws: Workspace,
  absence: AbsenceCtx,
  ownerChanged = false,
): ClashNote[] {
  const out = createNotes(one, ws, absence);
  if (b.name !== d.updateTool) return out;
  if (d.entity === "task") return [...out, ...updateTaskNotes(one, item, absence, ownerChanged)];
  if (d.entity === "milestone") return [...out, ...updateMilestoneNotes(one, item, ws, absence)];
  return out;
}

/** What the next block of the same change is judged against (§773 M-1/M-2). */
export interface ClashCarry { readonly item: Row; readonly ownerChanged: boolean }

/** `carry` with ONE block's written fields folded in: a task's owner (its link re-resolved as `updateTask`
 *  does), due date and status, a milestone's date and linked tasks. Read off the final plan, so a rejected field
 *  carries nothing. A create leaves it as it was. */
export function carryClashes(
  b: ToolUseLike,
  one: EditPlan,
  d: EntityDescriptor,
  carry: ClashCarry,
  absence: AbsenceCtx,
): ClashCarry {
  if (b.name !== d.updateTool) return carry;
  if (d.entity === "task") {
    const changed = taskChanges(one);
    const personChanged = TASK_PERSON_FIELDS.some((f) => changed.has(f));
    if (!personChanged && !changed.has("dueDate") && !changed.has("status")) return carry;
    const after = taskAfter(carry.item, changed, absence);
    const person = personChanged
      ? { assignee: after.assignee, assigneeEmail: changed.get("assigneeEmail") ?? str(carry.item.assigneeEmail), resourceId: after.resourceId }
      : {};
    const item: Row = {
      ...carry.item,
      ...person,
      ...(changed.has("dueDate") ? { dueDate: after.dueDate } : {}),
      ...(changed.has("status") ? { status: after.status } : {}),
    };
    return { item, ownerChanged: carry.ownerChanged || personChanged };
  }
  if (d.entity === "milestone") {
    const moved = one.updates.find((u) => u.entity === "milestone" && u.field === "date");
    const relinked = one.links.find((l) => l.entity === "milestone" && l.target === "row" && l.field === "linkedTaskIds");
    if (!moved && !relinked) return carry;
    const item: Row = {
      ...carry.item,
      ...(moved ? { date: moved.raw ?? moved.after } : {}),
      ...(relinked ? { linkedTaskIds: relinked.rawIds } : {}),
    };
    return { ...carry, item };
  }
  return carry;
}
