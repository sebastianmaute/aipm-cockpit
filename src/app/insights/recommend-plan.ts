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
import { describeEntityCalls, type ClashNote, type EditPlan, type ToolUseLike } from "../inline-ai-edit/plan";
import { carryClashes, type ClashCarry } from "../inline-ai-edit/plan-clashes";
import type { AbsenceCtx } from "../absence-clash";
import { INLINE_DESCRIPTORS, type EntityDescriptor, type InlineEntity } from "../inline-ai-edit/entity-descriptor";
import type { Task } from "../types";
import type { InsightToolCall } from "./insight";
import { REC_TOOL_INPUT_SCHEMAS, recommendationCallProblem, type RecCallProblemFormat } from "./recommend-schema";

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

/** What a generate reads beside its prompt (§350), plus the baseline-currency history length
 *  and digest in force then (§476), which the stored recommendation is stamped with. */
export type RecommendSnapshot = RecommendPlanWorkspace & {
  readonly historyLength: number;
  readonly historyDigest: string;
};

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

// ★★ A `recommendationPlanEntity(calls)` helper used to live here, answering
//  "which entity, if exactly one" so the review modal could label a plan's field
//  names. It was REMOVED once `FieldDiff`/`LinkDiff` gained their own `entity`
//  (§393): merging across entities is inherent to this function, so a
//  plan-level answer could only ever be `undefined` for a mixed recommendation
//  and both halves then rendered raw property names. Do NOT reintroduce it —
//  every row now carries the register it belongs to.

function emptyPlan(): EditPlan {
  return { updates: [], creates: [], deletes: [], rejected: [], links: [], clashes: [] };
}

function inputId(input: Readonly<Record<string, unknown>>): number {
  return Number((input as { id?: unknown }).id);
}

type ClashJudge = (block: ToolUseLike, d: EntityDescriptor, item: RowItem) => ClashNote[];

/** §773 N-1 — the absence clashes of an update or create call, judged against its row and the tasks as the
 *  plan's EARLIER calls leave them (`carryClashes`, keyed by entity and id, as `chat-proposal-turn-clashes.ts`
 *  does): an owner change, then a due-date move, judges the move with the new owner, and a milestone (updated or
 *  created) judges its linked tasks' new owners. Only an update with a real id carries forward.
 *  Confined to clashes: the card's field lines are still described against the stored row. */
function clashJudge(ws: Workspace, absence: AbsenceCtx): ClashJudge {
  const changed = new Map<string, ClashCarry>();
  const clashWs = (): Workspace => {
    const stored = Array.isArray(ws.tasks) ? ws.tasks : [];
    const live = stored.map((t) => (changed.get(`task:${t.id}`)?.item as Task | undefined) ?? t);
    return live.some((t, i) => t !== stored[i]) ? { ...ws, tasks: live } : ws;
  };
  return (block, d, item) => {
    const key = `${d.entity}:${item.id}`;
    const start: ClashCarry = changed.get(key) ?? { item, ownerChanged: false };
    const judged = describeEntityCalls([block], { descriptor: d, item: start.item, ws: clashWs(), absence, ownerChanged: start.ownerChanged });
    if (Number.isFinite(item.id)) changed.set(key, carryClashes(block, judged, d, start, absence));
    return judged.clashes;
  };
}

/** Preview the effect of a recommendation's proposed tool calls against the
 *  live workspace. Each call is grounded independently — an update looks up
 *  its own target row by id (falling back to a not-found sentinel so
 *  describeEntityCalls rejects it as unknown-id); a delete seeds the probe
 *  item's id to the call's OWN target id so describeEntityCalls' "self"
 *  same-row guard (meant for the inline editor's single opened row) is a
 *  trivial pass, letting the real grounding — does that id still exist in
 *  the live list — do the work instead. Creates need no id grounding.
 *  `formatProblem` words a whole-call refusal's `detail` (English by default);
 *  the review modal passes the UI language's wording (§782 round 3). `absence` (§773) adds the
 *  absence clashes each call would cause; without it none are computed. */
export function describeRecommendationPlan(
  calls: readonly InsightToolCall[],
  ws: RecommendPlanWorkspace,
  formatProblem?: RecCallProblemFormat,
  absence?: AbsenceCtx,
): EditPlan {
  // describeEntityCalls is typed against the full Workspace but only ever reads
  // the five list fields in RecommendPlanWorkspace (verified) — cast once here so
  // the caller passes a shape-checked partial, not `as unknown as Workspace`.
  const wsFull = ws as Workspace;
  const merged = emptyPlan();
  const judgeClashes = absence ? clashJudge(wsFull, absence) : null;

  for (const call of calls) {
    // §782 — a call missing an argument its writer requires is shown as
    // rejected, with the reason, and never as a change. The apply loop asks the
    // same question, so it does not send it either. Only the recommendation
    // tools are judged: the delete branch below previews other callers' input.
    const problem = Object.hasOwn(REC_TOOL_INPUT_SCHEMAS, call.name) ? recommendationCallProblem(call, formatProblem) : null;
    if (problem !== null) {
      merged.rejected.push({ toolName: call.name, reason: "bad-input", detail: problem });
      continue;
    }
    const block: ToolUseLike = { type: "tool_use", name: call.name, input: call.input };
    const updateEntity = UPDATE_DESCRIPTOR[call.name];
    const deleteEntity = DELETE_DESCRIPTOR[call.name];

    if (updateEntity) {
      const d = INLINE_DESCRIPTORS[updateEntity];
      const rows = wsFull[d.wsKey] as ReadonlyArray<{ id: number }>;
      const id = inputId(call.input);
      const item = (rows.find((r) => r.id === id) ?? { id: NaN }) as unknown as RowItem;
      // ★ Described TWICE on purpose: here for the card (against the stored row), and again inside
      //  `judgeClashes` for the clashes (against the row as earlier calls leave it). Do not merge them —
      //  the card must keep its stored-row diff, and the clash pass needs the carried row.
      const p = describeEntityCalls([block], { descriptor: d, item, ws: wsFull });
      merged.updates.push(...p.updates);
      merged.rejected.push(...p.rejected);
      merged.links.push(...p.links);
      merged.clashes.push(...(judgeClashes?.(block, d, item) ?? []));
      continue;
    }

    if (deleteEntity) {
      const d = INLINE_DESCRIPTORS[deleteEntity];
      const id = inputId(call.input);
      const item = { id } as unknown as RowItem;
      const p = describeEntityCalls([block], { descriptor: d, item, ws: wsFull, absence });
      merged.deletes.push(...p.deletes);
      merged.rejected.push(...p.rejected);
      merged.links.push(...p.links);
      merged.clashes.push(...p.clashes);
      continue;
    }

    // create_* (and anything unrecognized) — the create-tool routing inside
    // describeEntityCalls is descriptor-independent, so any descriptor works.
    const item = { id: NaN } as unknown as RowItem;
    const p = describeEntityCalls([block], { descriptor: INLINE_DESCRIPTORS.task, item, ws: wsFull });
    merged.creates.push(...p.creates);
    merged.rejected.push(...p.rejected);
    merged.links.push(...p.links);
    // §773 — judged on the workspace as the earlier calls leave it: a new milestone linking a task an earlier
    // call reassigned judges the new owner. A create carries nothing forward (its row has no id yet).
    merged.clashes.push(...(judgeClashes?.(block, INLINE_DESCRIPTORS.task, item) ?? []));
  }

  return merged;
}
