// src/app/inline-ai-edit/plan.ts
//
// Pure, i18n-free. Translate model tool-use blocks into a previewable EditPlan
// for the inline "Ask Claude" editor, for any entity. No React, no i18n, no
// side effects.
import { type Task } from "../types";
import { type Workspace } from "../workspace";
import { sanitizeIsoDate } from "../sanitize";
import { descriptionText } from "../rich-text-projection";
import { INLINE_DESCRIPTORS, validSetFor, defaultEnumFor, type EntityDescriptor } from "./entity-descriptor";

export type ToolUseLike = { type: string; id?: string; name?: string; input?: unknown };

export interface FieldDiff { field: string; before: string; after: string }
export interface NewItem { entity: string; title: string; toolName: string; input: Record<string, unknown> }
export interface Deletion { entity: string; label: string; toolName: string; id: number }
export interface Rejected { toolName: string; reason: "unknown-id" | "bad-input" | "unsupported"; detail: string }
export interface EditPlan { updates: FieldDiff[]; creates: NewItem[]; deletes: Deletion[]; rejected: Rejected[] }

// Any create_*/delete_* tool → its entity + workspace list key. Shared across
// entities (an inline edit on any row may create/delete related items).
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

// Fields stored as rich HTML. Only the PREVIEW strings are projected — the
// values applied to the entity stay verbatim, because `applied[f]` feeds the
// incremental enum validation below and the confirm step replays the original
// tool calls. "notes" is the task descriptor's (stale) name for `description`.
const RICH_FIELDS: ReadonlySet<string> = new Set([
  "description", "mitigation", "impactDescription", "resolutionNotes", "notes",
]);

function forPreview(field: string, value: string): string {
  return RICH_FIELDS.has(field) ? descriptionText(value) : value;
}

function str(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
function titleOf(entity: string, input: Record<string, unknown>): string {
  return str(input.title ?? input.taskName ?? input.name ?? input.description ?? entity);
}

interface EntityItem { id: number; [k: string]: unknown }

/** Build the plan for one entity. `ctx.item` is the row the popover opened on;
 *  `ctx.ws` the live workspace (id grounding + delete labels); `ctx.descriptor`
 *  drives which fields are diffable + how a value is validated so a previewed
 *  diff never diverges from what the sanitizer would persist. */
export function describeEntityCalls(
  blocks: readonly ToolUseLike[],
  ctx: { descriptor: EntityDescriptor; item: EntityItem; ws: Workspace },
): EditPlan {
  const { descriptor: d, item, ws } = ctx;
  const plan: EditPlan = { updates: [], creates: [], deletes: [], rejected: [] };
  const ownIds = new Set((ws[d.wsKey] as ReadonlyArray<{ id: number }>).map((r) => r.id));

  for (const b of blocks) {
    if (b.type !== "tool_use" || typeof b.name !== "string") continue;
    const name = b.name;
    const input = (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown>;

    if (name === d.updateTool) {
      const id = Number(input.id);
      if (id !== item.id) {
        plan.rejected.push({ toolName: name, reason: ownIds.has(id) ? "unsupported" : "unknown-id", detail: str(input.id) });
        continue;
      }
      // Accepted diffs so far — used both to validate a category-scoped enum
      // (RAID status) against a CO-CHANGED category and to compute the effective
      // item for the induced-reset pass below. Only VALID values land here.
      const applied: Record<string, string> = {};
      for (const f of d.diffFields) {
        if (!(f in input)) continue;
        const before = str(item[f]);
        const after = str(input[f]);
        if (before === after) continue;
        const bad = (detail: string) => plan.rejected.push({ toolName: name, reason: "bad-input", detail });
        if (d.requiredNonEmpty.has(f) && after === "") { bad(`${f}=empty`); continue; }
        // Match the sanitizer EXACTLY — sanitizeIsoDate is format + year-range
        // (1900-2100), returning the input verbatim when valid and "" otherwise,
        // so a previewed date can never diverge from what apply persists.
        if (d.dateFields.has(f) && after !== "" && sanitizeIsoDate(after) !== after) { bad(`${f}=${after}`); continue; }
        const range = d.intRangeFields[f];
        if (range) {
          const n = Number(after);
          if (!Number.isInteger(n) || n < range[0] || n > range[1]) { bad(`${f}=${after}`); continue; }
        }
        if (f in d.enumFields && !validSetFor(d.entity, f, { ...item, ...applied }).has(after)) { bad(`${f}=${after}`); continue; }
        plan.updates.push({ field: f, before: forPreview(f, before), after: forPreview(f, after) });
        applied[f] = after;
      }
      // Sanitizer-INDUCED enum resets: an enum field NOT explicitly (and validly)
      // changed, whose current value is no longer valid for the item as patched,
      // is silently reset by the sanitizer to the field's default (RAID status
      // follows a co-changed category). Surface it so the preview matches the
      // write instead of under-reporting a second field change.
      const effective = { ...item, ...applied };
      for (const f of Object.keys(d.enumFields)) {
        if (f in applied) continue;
        const cur = str(item[f]);
        if (!cur) continue;
        const valid = validSetFor(d.entity, f, effective);
        if (valid.size === 0 || valid.has(cur)) continue;
        const def = defaultEnumFor(d.entity, f, effective);
        if (def === undefined || def === cur) continue;
        plan.updates.push({ field: f, before: cur, after: def });
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
      // The row's OWN entity may only delete the row it was opened on; other
      // entities' deletes are allowed (cross-entity cleanup).
      if (name === d.deleteTool && id !== item.id) {
        plan.rejected.push({ toolName: name, reason: "unsupported", detail: str(input.id) });
        continue;
      }
      const rows = ws[wsKey] as ReadonlyArray<{ id: number; title?: string; taskName?: string; name?: string }>;
      const found = Array.isArray(rows) ? rows.find((r) => r.id === id) : undefined;
      if (!found) { plan.rejected.push({ toolName: name, reason: "unknown-id", detail: str(input.id) }); continue; }
      plan.deletes.push({ entity, label: str(found.title ?? found.taskName ?? found.name ?? id), toolName: name, id });
      continue;
    }
  }
  return plan;
}

/** Task-bound wrapper preserving SP1's signature (its tests import this). */
export function describeToolCalls(blocks: readonly ToolUseLike[], ctx: { task: Task; ws: Workspace }): EditPlan {
  return describeEntityCalls(blocks, { descriptor: INLINE_DESCRIPTORS.task, item: ctx.task as unknown as EntityItem, ws: ctx.ws });
}

/** True when the plan would write nothing (used to disable Apply / show a note). */
export function isEmptyPlan(p: EditPlan): boolean {
  return p.updates.length === 0 && p.creates.length === 0 && p.deletes.length === 0;
}
