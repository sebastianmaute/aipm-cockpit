// src/app/insights/recommend-plan.ts
//
// Pure, i18n-free. Builds an EditPlan preview for a persisted insight
// recommendation's `proposedCalls`, grounding each call against the LIVE
// workspace at apply time (a background-generated proposal may be stale).
// Reuses the inline-ai-edit descriptor engine + EditPlan shape so the
// existing preview list renders it. Unlike the inline "Ask Claude" editor —
// which diffs against one already-open row — a recommendation is NOT bound
// to a single item: each call is grounded independently by its OWN `id`.
import type { Workspace } from "../workspace";
import { describeEntityCalls, type EditPlan, type ToolUseLike } from "../inline-ai-edit/plan";
import { INLINE_DESCRIPTORS, type InlineEntity } from "../inline-ai-edit/entity-descriptor";
import type { InsightToolCall } from "./insight";

// The `item` shape describeEntityCalls expects, without exporting a new type
// from plan.ts (which stays untouched — only read for this task).
type RowItem = Parameters<typeof describeEntityCalls>[1]["item"];

/** The exact subset of `Workspace` describeEntityCalls reads for a recommendation
 *  preview. Narrowing to this makes call sites shape-checked instead of casting
 *  `as unknown as Workspace`. */
export type RecommendPlanWorkspace = Pick<
  Workspace,
  "tasks" | "raid" | "changes" | "milestones" | "stakeholders"
>;

const UPDATE_DESCRIPTOR: Record<string, InlineEntity> = {
  update_task: "task",
  update_raid_item: "raid",
  update_milestone: "milestone",
  update_change: "change",
  update_stakeholder: "stakeholder",
};
const DELETE_DESCRIPTOR: Record<string, InlineEntity> = {
  delete_task: "task",
  delete_raid_item: "raid",
  delete_milestone: "milestone",
  delete_change: "change",
  delete_stakeholder: "stakeholder",
};

function emptyPlan(): EditPlan {
  return { updates: [], creates: [], deletes: [], rejected: [], links: [] };
}

function inputId(input: Readonly<Record<string, unknown>>): number {
  return Number((input as { id?: unknown }).id);
}

/** Preview the effect of a recommendation's proposed tool calls against the
 *  live workspace. Each call is grounded independently — an update looks up
 *  its own target row by id (falling back to a not-found sentinel so
 *  describeEntityCalls rejects it as unknown-id); a delete seeds the probe
 *  item's id to the call's OWN target id so describeEntityCalls' "self"
 *  same-row guard (meant for the inline editor's single opened row) is a
 *  trivial pass, letting the real grounding — does that id still exist in
 *  the live list — do the work instead. Creates need no id grounding. */
export function describeRecommendationPlan(
  calls: readonly InsightToolCall[],
  ws: RecommendPlanWorkspace,
): EditPlan {
  // describeEntityCalls is typed against the full Workspace but only ever reads
  // the five list fields in RecommendPlanWorkspace (verified) — cast once here so
  // the caller passes a shape-checked partial, not `as unknown as Workspace`.
  const wsFull = ws as Workspace;
  const merged = emptyPlan();

  for (const call of calls) {
    const block: ToolUseLike = { type: "tool_use", name: call.name, input: call.input };
    const updateEntity = UPDATE_DESCRIPTOR[call.name];
    const deleteEntity = DELETE_DESCRIPTOR[call.name];

    if (updateEntity) {
      const d = INLINE_DESCRIPTORS[updateEntity];
      const rows = wsFull[d.wsKey] as ReadonlyArray<{ id: number }>;
      const id = inputId(call.input);
      const item = (rows.find((r) => r.id === id) ?? { id: NaN }) as unknown as RowItem;
      const p = describeEntityCalls([block], { descriptor: d, item, ws: wsFull });
      merged.updates.push(...p.updates);
      merged.rejected.push(...p.rejected);
      merged.links.push(...p.links);
      continue;
    }

    if (deleteEntity) {
      const d = INLINE_DESCRIPTORS[deleteEntity];
      const id = inputId(call.input);
      const item = { id } as unknown as RowItem;
      const p = describeEntityCalls([block], { descriptor: d, item, ws: wsFull });
      merged.deletes.push(...p.deletes);
      merged.rejected.push(...p.rejected);
      merged.links.push(...p.links);
      continue;
    }

    // create_* (and anything unrecognized) — the create-tool routing inside
    // describeEntityCalls is descriptor-independent, so any descriptor works.
    const item = { id: NaN } as unknown as RowItem;
    const p = describeEntityCalls([block], { descriptor: INLINE_DESCRIPTORS.task, item, ws: wsFull });
    merged.creates.push(...p.creates);
    merged.rejected.push(...p.rejected);
    merged.links.push(...p.links);
  }

  return merged;
}
