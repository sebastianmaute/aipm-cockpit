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
import type { PlanRow, ProposedCall } from "./chat-proposal";

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
  /** Index of the staged row that will MINT this call's target, when the target
   *  does not exist yet. Set only when the caller supplied plan rows.
   *
   *  ★★★ IT IS THE ALTERNATIVE TO A FALSE `rejected`, WHICH IS WHAT THIS PATH
   *   USED TO PRODUCE. `buildPlanRows` treats `[create_task, update_task({ id:
   *   <the minted id> })]` as a first-class applyable dependency (`dependsOn:
   *   0`), while grounding the update against the LIVE workspace misses that id
   *   and reports `{ reason: "unknown-id" }` — so the two halves described one
   *   call incompatibly, and the card would have rendered "will not be applied"
   *   over a row the design intends to apply after the remap. `plan` is EMPTY
   *   for such a row: there is no before-image to diff against, and inventing
   *   one would show a diff from fields the create has not written yet. */
  readonly pendingOn?: number;
}

function emptyPlan(): EditPlan {
  return { updates: [], creates: [], deletes: [], rejected: [] };
}

/** `plan.ts`'s own `str`, for the one rejection this file has to raise itself.
 *  Kept byte-compatible with it so a `detail` cannot depend on WHICH layer
 *  produced the rejection. */
function detailOf(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
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
 *   item is never read on that branch.
 *
 *  ★★ THE DELETE SEED IS THEREFORE ONLY EVER A FINITE NUMBER NOW: `describeProposal`
 *   intercepts a delete whose id is not finite before calling this, because that
 *   is the one case the seed cannot rescue (no value is `!== NaN`-false). Read
 *   the comment at that branch before "simplifying" either side — the two are
 *   one mechanism split across a function boundary. */
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
 *   be applied", and these apply normally.
 *
 *  ★★★ `planRows` IS OPTIONAL AND POSITIONALLY ALIGNED WITH `calls`. Pass the
 *   output of `buildPlanRows` for the SAME array and a row whose target will be
 *   minted earlier in this turn is reported as `pendingOn` instead of a false
 *   `{ reason: "unknown-id" }` — see `DescribedRow.pendingOn`. Agreement between
 *   the two halves is BY CONSTRUCTION rather than by a second rule: the pending
 *   test is `PlanRow.dependsOn`, the very field the cascade keys on, so neither
 *   half can drift into calling a row applyable while the other calls it dead.
 *   Deriving a flat set of provisional ids instead would NOT be equivalent —
 *   `buildPlanRows` links only BACKWARD, so a forward reference (an update
 *   emitted before the create that mints its id) is correctly a genuine unknown
 *   id, and a flat set would wrongly call it pending.
 *   ★ Omitting it keeps the previous behaviour exactly, which is what the
 *   callers that do not stage a multi-row plan want.
 *
 *  ★★ A LENGTH MISMATCH THROWS rather than describing some rows against the
 *   wrong plan row. Like `buildPlanRows`' own `RangeError` this is an assertion
 *   on our wiring, not a response to model output: both arrays come from one
 *   call list, so it is unreachable while the two sides agree. */
export function describeProposal(
  calls: readonly ProposedCall[],
  ws: Workspace,
  planRows?: readonly PlanRow[],
): readonly DescribedRow[] {
  if (planRows !== undefined && planRows.length !== calls.length) {
    throw new RangeError(
      `describeProposal: ${planRows.length} plan rows for ${calls.length} calls — ` +
        "the two must be positionally aligned",
    );
  }
  const rows: DescribedRow[] = [];

  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    // ★★★ ABSENCE IS THE ONLY TRIGGER, AND OVERWRITING A PRESENT TOKEN BREAKS
    //  THE GUARD RATHER THAN MERELY DUPLICATING IT. The model derives its token
    //  from its OWN `get_*` read, at T0. Staging happens at T1 and the user
    //  confirms at T2, so the model's token covers T0→T2 while one minted here
    //  covers only T1→T2. Restamping therefore DROPS T0→T1: a concurrent writer
    //  who moves the row between the model's read and the staging stops being
    //  caught, and the write commits over their edit while `requireToken` reads
    //  as protecting it. `insights/recommend-tokens.ts`'s header names this
    //  exact failure — comparing a value against the very read it came from.
    //  That path stamps unconditionally only because a STORED recommendation
    //  carries no model token to lose; this one does, so the paths differ in
    //  precisely the way that makes copying it weaker.
    //  ★★ ANY non-nullish value counts as present, INCLUDING a malformed one.
    //  `requireToken` refuses a non-string or empty string, so preserving a
    //  garbage token costs a loud refusal the user can retry; overwriting it
    //  would turn that refusal into a PERMIT, which is the direction with no
    //  recovery. `undefined`/`null` mean the model supplied nothing and are the
    //  case this stamp exists for.
    const supplied = (call.input as { expectedToken?: unknown }).expectedToken;
    // ★★ A PENDING ROW IS NEVER STAMPED, AND NOT MERELY BECAUSE THE LOOKUP WOULD
    //  MISS. `stampCall` returns the call unchanged when it cannot find the row,
    //  so the common case is already right — but a provisional id that happens
    //  to collide with a LIVE row's id would otherwise be stamped with THAT
    //  row's token, arming the concurrency guard against an unrelated entity.
    //  The only token a pending row can legitimately carry is one the model
    //  supplied, and that is preserved by the same branch.
    const pendingOn = planRows?.[index]?.dependsOn;
    const stamped: ProposedCall =
      pendingOn !== undefined || supplied != null ? call : stampCall(call, ws);

    if (pendingOn !== undefined) {
      rows.push({ call, stamped, plan: emptyPlan(), pendingOn });
      continue;
    }

    const entity = TOOL_ENTITY[call.name];
    const op = toolOp[call.name];

    if (entity === undefined || op === undefined) {
      rows.push({ call, stamped, plan: emptyPlan() });
      continue;
    }

    // ★★★ THE ONE REJECTION THIS FILE RAISES ITSELF, and it is here because the
    //  seed cannot express "no id". `describeEntityCalls`' own-entity delete
    //  guard is `id !== item.id`; NaN compares unequal to everything, so an
    //  id-less `delete_task({})` trips that guard and is reported "unsupported"
    //  — a reason meaning "this tool cannot address that row from here", when
    //  the truth is that it addresses no row at all. No number seeds around it,
    //  since no value is `!== NaN`-false. What is emitted below is exactly what
    //  the engine's OWN grounding produces once the guard is passed (its row
    //  lookup misses and reports "unknown-id" with the same `detail`), so this
    //  is the missing branch of that function reproduced, not a second opinion.
    //  ★ Descriptor-less deletes (`delete_document`) never reach here — they
    //  took the empty-plan branch above, which is correct: there is nothing to
    //  ground them against either way.
    if (op === "delete" && !Number.isFinite(Number((call.input as { id?: unknown }).id))) {
      const rejected = [
        {
          toolName: call.name,
          reason: "unknown-id" as const,
          detail: detailOf((call.input as { id?: unknown }).id),
        },
      ];
      rows.push({ call, stamped, plan: { ...emptyPlan(), rejected } });
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
