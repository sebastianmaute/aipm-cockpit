// src/app/chat-proposal-describe-project.ts — the review card's rows for a staged `update_project` (§715).
//
// Pure, i18n-free. The project record has no `INLINE_DESCRIPTORS` entry (it is one record per project, with
// no create/update/delete triple), so `describeEntityCalls` cannot diff it; its rows are built here from the
// SAME judge the write runs, `applyProjectPatch`, so the card cannot disagree with the write about a field.
//
// ★★★ PREVIEW/APPLY PARITY (docs/AGENTS/ai-assistant.md). Every row's `after` is the value the write
//  STORES: an accepted or normalised field shows the judged value, a refused field shows the stored value
//  and goes into `plan.rejected` with its `field`, so `stripRejectedFields` drops it before the replay and
//  the call that is sent is exactly the one the card shows as landing.
// ★★ THE ROWS ARE THE VERDICTS OF THE CALL THAT IS SENT, not the one the model wrote — the rule
//  `describeBlockUntilStable` follows for entity rows. A field refused on one pass is removed and the rest
//  re-judged until no new refusal appears, so a sibling judged against a refused value cannot slip through.
import type { ProposedCall } from "./chat-proposal";
import { entityToken } from "./ai-entity-token";
import type { EditPlan, FieldDiff, Rejected } from "./inline-ai-edit/plan";
import { applyProjectPatch, PROJECT_AI_FIELDS, type ProjectAiField } from "./project-ai-fields";
import type { ProjectMeta } from "./types";

export const UPDATE_PROJECT_TOOL = "update_project";

export type ProjectRowState = "change" | "normalised" | "refused";

export interface ProjectCallRow {
  readonly field: ProjectAiField;
  readonly before: string;
  /** What the write stores: the judged value, or the stored value when `state` is `"refused"`. */
  readonly after: string;
  readonly state: ProjectRowState;
  /** Why a refused field keeps its stored value, or how a normalised one was reshaped. */
  readonly reason?: string;
}

export interface ProjectCallDescription {
  readonly label: string;
  /** In `PROJECT_AI_FIELDS` order, one per offered field the call passes. */
  readonly rows: readonly ProjectCallRow[];
  /** Keys the call passes that are not project fields Claude may set; the write ignores them. */
  readonly ignored: readonly string[];
}

/** A stored project value as the card prints it. An absent optional field reads as "". */
export function projectFieldText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function withoutKeys(input: Readonly<Record<string, unknown>>, drop: ReadonlySet<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([k]) => !drop.has(k)));
}

const projectLabel = (stored: ProjectMeta): string => `Project "${stored.name}"`;

/** The card line for a staged `update_project`, naming the STORED project (never the name the call
 *  sets), or null for any other tool or when no project is open. */
export function projectRowTitle(call: ProposedCall, stored: ProjectMeta | undefined): string | null {
  return call.name === UPDATE_PROJECT_TOOL && stored !== undefined ? projectLabel(stored) : null;
}

/** The card's rows for one `update_project` call against the stored record. */
export function describeProjectCall(
  input: Readonly<Record<string, unknown>>,
  stored: ProjectMeta,
): ProjectCallDescription {
  const refused = new Map<ProjectAiField, string>();
  for (;;) {
    const { next, rows, unknownKeys } = applyProjectPatch(stored, withoutKeys(input, new Set(refused.keys())));
    const fresh = rows.filter((r) => r.verdict.kind === "refused" && !refused.has(r.field));
    for (const r of fresh) if (r.verdict.kind === "refused") refused.set(r.field, r.verdict.reason);
    if (fresh.length > 0) continue;
    const judged = new Map(rows.map((r) => [r.field, r]));
    const out: ProjectCallRow[] = [];
    for (const field of PROJECT_AI_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
      const before = projectFieldText(stored[field]);
      const reason = refused.get(field);
      if (reason !== undefined) {
        out.push({ field, before, after: before, state: "refused", reason });
        continue;
      }
      const verdict = judged.get(field)?.verdict;
      const normalised = verdict?.kind === "normalised";
      out.push({
        field,
        before,
        after: projectFieldText(next[field]),
        state: normalised ? "normalised" : "change",
        ...(normalised ? { reason: verdict.note } : {}),
      });
    }
    return { label: projectLabel(stored), rows: out, ignored: unknownKeys };
  }
}

/** The `EditPlan` the card and the apply path read for a staged `update_project`.
 *
 *  ★★ A row whose `after` equals its `before` is not an update: rewriting the stored value is a no-op, so
 *   it is left off the card, the way the entity engine leaves an unchanged field off. A call whose only
 *   remaining fields are refused therefore `writesNothing` and is not sent (§534). */
export function describeProjectPlan(call: ProposedCall, stored: ProjectMeta | undefined): EditPlan {
  const plan: EditPlan = { updates: [], creates: [], deletes: [], rejected: [], links: [] };
  if (stored === undefined) {
    plan.rejected.push({ toolName: call.name, reason: "unknown-id", detail: "no project is open" });
    return plan;
  }
  const { rows, ignored } = describeProjectCall(call.input, stored);
  for (const row of rows) {
    if (row.state === "refused") {
      plan.rejected.push(refusal(call.name, row.field, row.reason ?? "", "bad-input"));
    } else if (row.after !== row.before) {
      const diff: FieldDiff = { entity: "project", field: row.field, before: row.before, after: row.after };
      plan.updates.push(diff);
    }
  }
  for (const key of ignored) {
    plan.rejected.push(refusal(call.name, key, "not a project field Claude may set", "unsupported"));
  }
  return plan;
}

function refusal(toolName: string, field: string, detail: string, reason: Rejected["reason"]): Rejected {
  return { toolName, reason, detail, field };
}

/** The call with `expectedToken` stamped from the staged project when the model sent none — the same
 *  absence-only rule `describeProposal` applies to every other token-guarded row. */
export function stampProjectCall(call: ProposedCall, stored: ProjectMeta | undefined): ProposedCall {
  const supplied = (call.input as { expectedToken?: unknown }).expectedToken;
  if (supplied != null || stored === undefined) return call;
  return { ...call, input: { ...call.input, expectedToken: entityToken("project", stored) } };
}
