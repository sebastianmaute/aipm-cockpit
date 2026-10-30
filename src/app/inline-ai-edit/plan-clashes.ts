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
import { milestoneClashes, taskClashes, type AbsenceClash, type AbsenceCtx } from "../absence-clash";
import { linkPersonForWrite } from "../resource-foundation";
import { sanitizeAssignee, sanitizeIsoDate, sanitizeLoadedEmail } from "../sanitize";
import type { Task } from "../types";
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
 *  `updateTask` does (`linkPersonForWrite`), an untouched one keeps it. */
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
  };
}

function updateTaskNotes(one: EditPlan, item: Row, absence: AbsenceCtx): ClashNote[] {
  const changed = new Map(one.updates.filter((u) => u.entity === "task").map((u) => [u.field, u.raw ?? u.after]));
  const personChanged = TASK_PERSON_FIELDS.some((f) => changed.has(f));
  if (!changed.has("dueDate") && !personChanged) return [];
  const clashes = taskClashes(taskAfter(item, changed, absence), absence, { ignoreStart: !personChanged });
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
      return notes("task", null, c.title, taskClashes({ assignee, resourceId, startDate: undefined, dueDate }, absence));
    }
    if (c.entity === "milestone") {
      const links = one.links.find((l) => l.entity === "milestone" && l.target === "create" && l.field === "linkedTaskIds");
      const date = sanitizeIsoDate(c.input.date);
      return notes("milestone", null, c.title, milestoneClashes({ date, linkedTaskIds: links?.rawIds ?? [] }, tasksOf(ws), absence));
    }
    return [];
  });
}

/** The clashes ONE block's final plan (`one`) would cause. `item` is the row the plan is bound to. */
export function clashNotesFor(
  b: ToolUseLike,
  one: EditPlan,
  d: EntityDescriptor,
  item: Row,
  ws: Workspace,
  absence: AbsenceCtx,
): ClashNote[] {
  const out = createNotes(one, ws, absence);
  if (b.name !== d.updateTool) return out;
  if (d.entity === "task") return [...out, ...updateTaskNotes(one, item, absence)];
  if (d.entity === "milestone") return [...out, ...updateMilestoneNotes(one, item, ws, absence)];
  return out;
}
