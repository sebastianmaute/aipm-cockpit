// src/app/chat-proposal-describe.ts
//
// Pure, i18n-free. Grounds a STAGED chat turn against the LIVE workspace,
// producing one human-readable `EditPlan` per proposed call so the review card
// can render a row per write and refuse a row whose target has moved.
//
// ★★★ `describeEntityCalls` IS BOUND TO A SINGLE `ctx.item`, AND A CHAT PLAN IS
// NOT. Its update branch rejects any call whose `input.id` differs from
// `item.id`, so calling it ONCE for a whole plan describes row one and rejects
// every other row as "unsupported" — silently, since a rejection is a normal
// part of an EditPlan. Every call is therefore described SEPARATELY, seeded
// with its OWN target row. `insights/recommend-plan.ts` does the same thing for
// the same reason and this file follows its shape deliberately; the one
// difference is the workspace type (see below).
//
// ★★ IT TAKES THE FULL `Workspace`, NOT `RecommendPlanWorkspace`. That type is
// `Pick<Workspace, "tasks"|"raid"|"changes"|"milestones"|"stakeholders">` and
// has no `resources`, while chat can write all SIX entities.
// `describeEntityCalls` builds `ownIds` from `ws[d.wsKey]` UNGUARDED and before
// any branch, so a resource call against a workspace missing that slice THROWS
// rather than yielding an empty plan. Pinned by the resource test.
import type { Workspace } from "./workspace";
import { describeEntityCalls, type EditPlan, type ToolUseLike } from "./inline-ai-edit/plan";
import {
  INLINE_DESCRIPTORS,
  type EntityDescriptor,
  type InlineEntity,
} from "./inline-ai-edit/entity-descriptor";
import { stampCall } from "./insights/recommend-tokens";
import type { ProposedCall } from "./chat-proposal";

// The `item` shape describeEntityCalls expects, without exporting a new type
// from plan.ts (which stays untouched — only read here).
type RowItem = Parameters<typeof describeEntityCalls>[1]["item"];

type ProposalOp = "create" | "update" | "delete";

/** Tool name → the descriptor entity it addresses, and which operation it is.
 *
 *  ★★ DERIVED FROM `INLINE_DESCRIPTORS`, never hand-typed. Each descriptor
 *   already names its own `createTool`/`updateTool`/`deleteTool`, so the 18
 *   strings have exactly one definition and a renamed tool cannot leave a stale
 *   copy here. `chat-proposal-describe.test.ts` cross-checks the derived key set
 *   against the gate's own `isEntityWriteTool`, in both directions. */
const toolEntity: Record<string, InlineEntity> = {};
const toolOp: Record<string, ProposalOp> = {};
for (const d of Object.values(INLINE_DESCRIPTORS) as EntityDescriptor[]) {
  toolEntity[d.createTool] = d.entity;
  toolOp[d.createTool] = "create";
  toolEntity[d.updateTool] = d.entity;
  toolOp[d.updateTool] = "update";
  toolEntity[d.deleteTool] = d.entity;
  toolOp[d.deleteTool] = "delete";
}
export const TOOL_ENTITY: Readonly<Record<string, InlineEntity>> = toolEntity;

export interface DescribedRow {
  readonly call: ProposedCall;
  /** The same call with `expectedToken` stamped from the live row, ready to
   *  replay. Identical to `call` for anything `stampCall` has no target for. */
  readonly stamped: ProposedCall;
  readonly plan: EditPlan;
}

function emptyPlan(): EditPlan {
  return { updates: [], creates: [], deletes: [], rejected: [] };
}

/** The probe row `describeEntityCalls` is bound to, per operation.
 *
 *  ★★★ THE DELETE SEED IS THE CALL'S OWN ID, NOT A NaN SENTINEL, and the
 *   difference is invisible in a green suite. The delete branch guards
 *   `name === d.deleteTool && id !== item.id` (meant for the inline editor's one
 *   opened row); `NaN` compares unequal to everything, so a NaN seed rejects
 *   EVERY own-entity delete as "unsupported" and the deletion never appears on
 *   the card. Seeding the call's own id makes that guard a trivial pass so the
 *   real grounding — does this row still exist — does the work instead.
 *
 *  ★ An UPDATE falls back to the NaN sentinel deliberately: a miss must reject
 *   as "unknown-id", which is what an id matching no row produces. A CREATE's
 *   item is never read on that branch. */
function seedItem(
  op: ProposalOp,
  d: EntityDescriptor,
  input: Readonly<Record<string, unknown>>,
  ws: Workspace,
): RowItem {
  if (op === "create") return { id: Number.NaN } as unknown as RowItem;
  const id = Number((input as { id?: unknown }).id);
  if (op === "delete") return { id } as unknown as RowItem;
  const rows = ws[d.wsKey] as ReadonlyArray<{ id: number }>;
  return (rows.find((r) => r.id === id) ?? { id: Number.NaN }) as unknown as RowItem;
}

/** One `DescribedRow` per proposed call, IN THE INPUT'S ORDER — position is the
 *  review card's row identity, so nothing here filters or reorders.
 *
 *  ★★ A CALL THE DESCRIPTOR ENGINE CANNOT DIFF STILL GETS A ROW, with an empty
 *   plan. Documents are the live case: `create_document`/`update_document`/
 *   `delete_document` are in the staging gate's write set (so a turn containing
 *   one stages) but there is no `document` entity in `INLINE_DESCRIPTORS`, so no
 *   before/after is derivable. `delete_all_tasks`, `send_inquiry` and
 *   `set_task_dependencies` are the same shape. Dropping them would hide a
 *   staged write from the very card that exists to let the user refuse it — a
 *   row the user cannot see is a row they cannot reject — so the row is emitted
 *   and the CARD is responsible for labelling it from `call.name`.
 *   ★ They are NOT reported as `rejected`: that word means "this call will not
 *   be applied", and these apply normally. */
export function describeProposal(
  calls: readonly ProposedCall[],
  ws: Workspace,
): readonly DescribedRow[] {
  const rows: DescribedRow[] = [];

  for (const call of calls) {
    const stamped: ProposedCall = stampCall(call, ws);
    const entity = TOOL_ENTITY[call.name];
    const op = toolOp[call.name];

    if (entity === undefined || op === undefined) {
      rows.push({ call, stamped, plan: emptyPlan() });
      continue;
    }

    const d = INLINE_DESCRIPTORS[entity];
    const block: ToolUseLike = { type: "tool_use", name: call.name, input: call.input };
    const plan = describeEntityCalls([block], {
      descriptor: d,
      item: seedItem(op, d, call.input, ws),
      ws,
    });
    rows.push({ call, stamped, plan });
  }

  return rows;
}
