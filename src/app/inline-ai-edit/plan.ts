// src/app/inline-ai-edit/plan.ts
//
// Pure, i18n-free. Translate model tool-use blocks into a previewable EditPlan
// for the inline "Ask Claude" task editor. No React, no i18n, no side effects.
import { type Task, type Priority, type TaskStatus, PRIORITIES, TASK_STATUSES } from "../types";
import { type Workspace } from "../workspace";

export type ToolUseLike = { type: string; id?: string; name?: string; input?: unknown };

export interface FieldDiff { field: string; before: string; after: string }
export interface NewItem { entity: string; title: string; toolName: string; input: Record<string, unknown> }
export interface Deletion { entity: string; label: string; toolName: string; id: number }
export interface Rejected { toolName: string; reason: "unknown-id" | "bad-input" | "unsupported"; detail: string }
export interface EditPlan { updates: FieldDiff[]; creates: NewItem[]; deletes: Deletion[]; rejected: Rejected[] }

// Exactly the fields the dispatcher's update_task can write (use-chat-dispatcher
// `cleanPatch` + status). startDate/resourceId are NOT writable there, so they
// are intentionally excluded — showing a diff we can't apply would break the
// preview→apply contract (silent drop).
const TASK_DIFF_FIELDS: Array<keyof Task> = [
  "taskName", "assignee", "assigneeEmail", "dueDate", "status",
  "priority", "notes", "blockers", "group", "labels",
];

const CREATE_TOOLS: Record<string, string> = {
  create_raid_item: "raid", create_change: "change",
  create_milestone: "milestone", create_stakeholder: "stakeholder", create_task: "task",
};
const DELETE_TOOLS: Record<string, { entity: string; wsKey: keyof Workspace }> = {
  delete_task: { entity: "task", wsKey: "tasks" },
  delete_raid_item: { entity: "raid", wsKey: "raid" },
  delete_change: { entity: "change", wsKey: "changes" },
  delete_milestone: { entity: "milestone", wsKey: "milestones" },
  delete_stakeholder: { entity: "stakeholder", wsKey: "stakeholders" },
};

function str(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
function titleOf(entity: string, input: Record<string, unknown>): string {
  return str(input.title ?? input.taskName ?? input.name ?? input.description ?? entity);
}

/** Build the plan. `ctx.task` is the row the popover was opened on; `ctx.ws` the
 *  live workspace (for id grounding + delete labels). Read-only tool calls and
 *  unknown tools are dropped; updates that don't target the current task (or a
 *  real workspace id) are rejected, never applied. */
export function describeToolCalls(
  blocks: readonly ToolUseLike[],
  ctx: { task: Task; ws: Workspace },
): EditPlan {
  const plan: EditPlan = { updates: [], creates: [], deletes: [], rejected: [] };
  const taskIds = new Set(ctx.ws.tasks.map((t) => t.id));

  for (const b of blocks) {
    if (b.type !== "tool_use" || typeof b.name !== "string") continue;
    const name = b.name;
    const input = (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown>;

    if (name === "update_task") {
      const id = Number(input.id);
      if (id !== ctx.task.id) {
        plan.rejected.push({ toolName: name, reason: taskIds.has(id) ? "unsupported" : "unknown-id", detail: str(input.id) });
        continue;
      }
      for (const f of TASK_DIFF_FIELDS) {
        if (!(f in input)) continue;
        const before = str(ctx.task[f]);
        const after = str(input[f]);
        if (before === after) continue;
        // Value-level guard: the dispatcher silently ignores an out-of-enum
        // status/priority (leaves the field unchanged), so don't preview a diff
        // that Apply won't make — reject it instead.
        if (f === "status" && !TASK_STATUSES.includes(after as TaskStatus)) {
          plan.rejected.push({ toolName: name, reason: "bad-input", detail: `status=${after}` });
          continue;
        }
        if (f === "priority" && !PRIORITIES.includes(after as Priority)) {
          plan.rejected.push({ toolName: name, reason: "bad-input", detail: `priority=${after}` });
          continue;
        }
        plan.updates.push({ field: f, before, after });
      }
      continue;
    }

    if (name in CREATE_TOOLS) {
      const entity = CREATE_TOOLS[name];
      plan.creates.push({ entity, title: titleOf(entity, input), toolName: name, input });
      continue;
    }

    if (name in DELETE_TOOLS) {
      const { entity, wsKey } = DELETE_TOOLS[name];
      const id = Number(input.id);
      // An inline edit may only DELETE the task it was opened on. Cross-entity
      // deletes (raid/change/milestone/stakeholder) are allowed; deleting a
      // DIFFERENT task is not (mirrors the update_task target-only guard).
      if (name === "delete_task" && id !== ctx.task.id) {
        plan.rejected.push({ toolName: name, reason: "unsupported", detail: str(input.id) });
        continue;
      }
      const rows = ctx.ws[wsKey] as ReadonlyArray<{ id: number; title?: string; taskName?: string; name?: string }>;
      const found = Array.isArray(rows) ? rows.find((r) => r.id === id) : undefined;
      if (!found) { plan.rejected.push({ toolName: name, reason: "unknown-id", detail: str(input.id) }); continue; }
      plan.deletes.push({ entity, label: str(found.title ?? found.taskName ?? found.name ?? id), toolName: name, id });
      continue;
    }
  }
  return plan;
}

/** True when the plan would write nothing (used to disable Apply / show a note). */
export function isEmptyPlan(p: EditPlan): boolean {
  return p.updates.length === 0 && p.creates.length === 0 && p.deletes.length === 0;
}
