// src/app/chat-proposal-apply.ts — apply the rows the user kept from a staged
// chat plan, as ONE undoable commit.
//
// React-free. Takes the dispatcher, the described rows, the user's selection and
// an open `UndoBatch`; drives the real tool dispatch and reports what each row
// did.
//
// ★★★ THE CALLS ARE RE-INVOKED, NEVER REPLAYED AS A DATA DIFF, and this is the
// invariant with a live counter-example rather than a stylistic preference.
// `send_inquiry`'s handler calls `window.open` on a `mailto:` URL and only THEN
// increments `Task.inquiriesSent`. Rebuilding a plan's effect from the
// before/after rows `describeProposal` computed would bump that counter and open
// no mail client — a send that reports success, sends nothing, and raises no
// error at any layer. Any future tool with an in-handler side effect (a fetch, a
// download, a window) inherits its protection from this rule alone, so route
// every applied row through `runTool` and nothing else.
//
// ★★ `row.stamped` IS REPLAYED, NOT `row.call`. `describeProposal` PRESERVES a
// model-supplied `expectedToken` and stamps one only into an absence, so
// `stamped === call` in the common case — that identity is the normal state, not
// a symptom. Replaying `stamped` is correct in both branches; replaying `call`
// is correct only in one.
//
// ★★★ AND THE CALL THAT IS RE-INVOKED IS THE REMAPPED ONE. A staged create is
// paired with a PROVISIONAL id at propose time; the real minter runs here and
// hands out its own. Replaying a dependent row verbatim therefore addressed the
// provisional number — a live stranger's row, or none at all. Every row goes
// through `remapStagedCall` against the ids the creates ACTUALLY minted, and a
// row still naming an unresolved one is refused rather than replayed.
import { runTool, type ToolDispatcher } from "./chat-tools";
import { TOOL_DEFS } from "./chat-tool-defs";
import { ConcurrencyTokenError } from "./chat-tools-updates";
import { namesPendingMint, remapStagedCall } from "./chat-proposal";
import type { DescribedRow } from "./chat-proposal-describe";
import type { UndoBatch } from "./use-undo-batch";

/** What one selected row did. `index` is the row's position in the FULL
 *  described list — the same identity the review card's checkboxes and
 *  `cascadeDeselect` key on — so a caller can mark the right row without
 *  re-deriving anything from a filtered array. */
export interface AppliedRow {
  readonly index: number;
  readonly ok: boolean;
  /** The write was REFUSED because the row moved since it was staged, so it
   *  wrote nothing.
   *
   *  ★★ SEPARATE FROM A PLAIN FAILURE ON PURPOSE, matched on the ERROR TYPE and
   *  never its message (both `ConcurrencyTokenError` messages are model-facing
   *  recovery instructions and may be reworded). `requireToken` throws BEFORE
   *  the dispatcher is reached, so a stale row is safe to offer for retry; a
   *  hard failure may already have written something and is not. */
  readonly stale?: boolean;
  readonly error?: string;
}

export interface ApplyProposalResult {
  /** One entry per SELECTED row, in the described order. Unselected rows are
   *  absent rather than reported as skipped — the caller owns the selection and
   *  a "skipped" row would read as an outcome. */
  readonly rows: readonly AppliedRow[];
}

/** `AppliedRow.error` for a row refused because a create it names did not
 *  produce a real id. EXPORTED so a card — and a test — can recognise this
 *  outcome without matching prose, the same rule `AppliedRow.stale` follows for
 *  the token refusal it sits beside. */
export const PENDING_MINT_ERROR =
  "a row this call depends on was not created, so this call was not applied";

/** `AppliedRow.error` for a row that targets a row created EARLIER IN THE SAME
 *  PLAN with a tool that requires a concurrency token.
 *
 *  ★★★ IT EXISTS TO STOP THIS FAILURE WEARING THE `stale` LABEL, WHICH LIES.
 *   A pending row is deliberately never stamped (`describeProposal` says why),
 *   so the remapped call reaches `requireToken` carrying nothing and throws
 *   `ConcurrencyTokenError` — which `applyProposal` would record as
 *   `stale: true`, defined on `AppliedRow` as "the row moved since it was
 *   staged". Nothing moved: the row did not EXIST when it was staged. A card
 *   rendering that tells the user their data changed underneath them and invites
 *   a retry that cannot succeed at any number of attempts.
 *
 *  ★★ IT IS A CAPABILITY GAP, NOT A CONFLICT, and the wording says so. Fixing
 *   the underlying gap means stamping from the create's return value, and that
 *   is blocked: `entityToken` needs the FULL row while five of the seven creates
 *   return a `*Summary`, and `withToken`'s own docstring records that a
 *   summary-derived token is wrong and is pinned against. That needs a
 *   per-entity full-row resolver and is its own slice. Until then this refusal
 *   is honest about what happened; it does not make the write land. */
export const NEW_ROW_TOKEN_UNAVAILABLE_ERROR =
  "this call targets a row created earlier in the same plan, and a row created " +
  "during an apply cannot yet carry the concurrency token this tool requires — " +
  "it was not applied";

/** Tools whose SCHEMA marks `expectedToken` as REQUIRED, derived from the live
 *  `TOOL_DEFS` rather than typed out.
 *
 *  ★★ DERIVED SO A NEW GUARDED TOOL IS COVERED WITHOUT AN EDIT HERE. A literal
 *   list would name the seven that exist today and go silently stale — and the
 *   nearest existing table, `insights/recommend-tokens.ts`' `UPDATE_TARGET`, is
 *   NOT this set: it omits `update_resource`, because `RecommendPlanWorkspace`
 *   has no `resources` slice. Reusing it would have left resource updates
 *   wearing the wrong label, which is the defect this constant exists to fix.
 *
 *  ★★★ THREE DIFFERENT FACTS LIVE HERE AND THEY ALL EQUAL SEVEN TODAY BY
 *   COINCIDENCE. (1) `expectedToken` appears in a tool's schema `properties` —
 *   the fact `insights/recommend-tokens.test.ts` already derives from. (2) It
 *   appears in that schema's `required` — the fact THIS set derives from, and
 *   the right one, because an OPTIONAL token is a tool the model may legally
 *   call without one. (3) `requireToken` is actually reached at runtime — what
 *   truly decides whether the row throws.
 *
 *  ★★ (1) AND (2) ARE PINNED TO EACH OTHER by a test in
 *   `chat-proposal-apply.test.tsx`, because a schema edit moving `expectedToken`
 *   OUT of `required` while leaving it in `properties` is an entirely plausible
 *   change: it would leave that existing test green, silently drop the tool from
 *   this set, and restore the `stale` lie for exactly that tool.
 *
 *  ★★★ (3) IS DELIBERATELY UNPINNED. Mapping enforcement back to tool names
 *   means parsing a switch statement, which would rot faster than the drift it
 *   watches. Read it by hand with the repo's own command (it lives at
 *   `chat-tools-documents.ts`, above `DOC_TOKEN_TOOLS`):
 *     awk '/case "/{c=$0} /requireToken\("|requireTaskWriteToken\(/{print c}' src/app/chat-tools.ts
 *   RUN 2026-09-04: it prints exactly seven cases — `update_task`,
 *   `set_task_dependencies`, and the five other `update_*` — matching this set.
 *   A tool that enforced a token without declaring one `required` would slip
 *   past this guard silently, because the guard simply would not fire. Do not
 *   read the agreement as a gate. */
export const TOKEN_REQUIRED_TOOLS: ReadonlySet<string> = new Set(
  (TOOL_DEFS as ReadonlyArray<{ name: string; input_schema?: unknown }>)
    .filter((d) => {
      const required = (d.input_schema as { required?: unknown } | undefined)?.required;
      return Array.isArray(required) && required.includes("expectedToken");
    })
    .map((d) => d.name),
);

/** `requireToken`'s OWN predicate for "a usable token", mirrored so this refusal
 *  and that throw cannot disagree about which calls carry one — a call the guard
 *  waved through must be one `requireToken` would accept the token OF, even if
 *  it then rejects its VALUE. */
function hasUsableToken(call: { readonly input: Readonly<Record<string, unknown>> }): boolean {
  const sent = call.input.expectedToken;
  return typeof sent === "string" && sent.length > 0;
}

export interface ApplyProposalArgs {
  readonly dispatcher: ToolDispatcher;
  /** The FULL described list, so `AppliedRow.index` keeps the card's identity. */
  readonly rows: readonly DescribedRow[];
  /** Positions in `rows` the user kept. */
  readonly selected: ReadonlySet<number>;
  /** ★★ `Pick<UndoBatch, "runBatched">`, NOT the whole `UndoBatch`, because
   *  `runBatched` is the only member this function touches — the wrapper's
   *  `undo` half is installed as the DISPATCHER's `undo` prop, one layer up,
   *  and never reaches here. Requiring the full object forced the wiring layer
   *  to fabricate an `undo` it does not own, and a fabricated capture surface
   *  that silently swallows captures is exactly the failure the batch exists to
   *  prevent. The real `UndoBatch` still satisfies this. */
  readonly batch: Pick<UndoBatch, "runBatched">;
}

/** The real id a create tool's result carries, or `undefined` when it carries
 *  none usable.
 *
 *  ★★ ENUMERATED, NOT ASSUMED. All seven creates return an object with a numeric
 *   `id`: `create_task` a `Task`, the five register creates their `*Summary`
 *   (`RaidSummary`/`ChangeSummary`/`MilestoneSummary`/`StakeholderSummary`/
 *   `ResourceSummary`, each declaring `id: number`), and `create_document` the
 *   `{ id, title, blockCount }` its own dispatcher entry declares. `runTool`
 *   erases all of that to `Promise<unknown>`, so the read is a runtime one.
 *
 *  ★ STRICTLY `typeof === "number"`, deliberately NOT `Number(id)`. A create
 *   returning something else is off its own declared contract, and coercing a
 *   surprise into a plausible number would remap dependents onto whatever it
 *   coerced to. Returning `undefined` instead leaves the id PENDING, which
 *   refuses those dependents loudly — the recoverable direction. */
function createdIdOf(result: unknown): number | undefined {
  if (result === null || typeof result !== "object") return undefined;
  const id = (result as { id?: unknown }).id;
  return typeof id === "number" && Number.isFinite(id) ? id : undefined;
}

/** Record what a create actually minted, so later rows can be remapped onto it.
 *
 *  ★★★ A CREATE THAT SUCCEEDS BUT YIELDS NO USABLE ID STAYS `ok: true` AND STAYS
 *   PENDING, and the split is deliberate. The write LANDED — reporting the row
 *   as failed would be a lie the user acts on — but nothing here knows which row
 *   it landed on, so every dependent is refused with `PENDING_MINT_ERROR`
 *   instead of being pointed at a guess. Honest about both halves, and the same
 *   state a create that THREW leaves behind. */
function resolveMintedId(
  row: DescribedRow,
  result: unknown,
  real: Map<string, Map<number, number>>,
  pending: Map<string, Set<number>>,
): void {
  const provisional = row.mintedId;
  if (provisional === undefined) return;
  const realId = createdIdOf(result);
  if (realId === undefined) return;
  let byTool = real.get(row.call.name);
  if (byTool === undefined) {
    byTool = new Map<number, number>();
    real.set(row.call.name, byTool);
  }
  byTool.set(provisional, realId);
  pending.get(row.call.name)?.delete(provisional);
}

/**
 * Replay every selected row and push at most ONE undo entry for the whole
 * applied plan.
 *
 * ★★★ A ROW THAT FAILS FAILS ALONE. Each call is its own try/catch, so a stale
 * token or a sanitizer rejection stops that row and nothing else — the remaining
 * rows still apply and every outcome is reported. Silence about a partial apply
 * is the expensive failure here: the user approved a plan and would otherwise be
 * told it landed while some of it did not.
 *
 * ★ SEQUENTIAL, never `Promise.all`. The writers keep their own entity refs in
 * sync synchronously (`tasksRef.current = next`) so back-to-back calls compose,
 * and a concurrent fan-out would have several of them computing `next` from the
 * same pre-batch array and clobbering each other.
 *
 * ★★ SEQUENTIAL IS NOW LOAD-BEARING FOR A SECOND REASON, not merely for the
 * refs: a row is remapped against the ids EARLIER rows minted, so the order of
 * this loop IS the order `buildPlanRows` graphed. Every dependency it recorded
 * points strictly backward, which is exactly what makes one forward pass enough.
 */
export async function applyProposal(args: ApplyProposalArgs): Promise<ApplyProposalResult> {
  const { dispatcher, rows, selected, batch } = args;
  const applied: AppliedRow[] = [];

  // create tool → (provisional id → the id the real minter handed out). Filled
  // as each create resolves, and read by `remapStagedCall` for every later row.
  // ENTITY-SCOPED for the reason `TARGET_MINTED_BY` records: two creates in one
  // plan minting the same NUMBER is the common case, not the exotic one, and a
  // number-keyed map would point one create's dependents at the other's row.
  const real = new Map<string, Map<number, number>>();

  // Every provisional id this plan owes, seeded from ALL rows and deleted as its
  // create resolves. A row naming one still in here is refused, never replayed.
  //
  // ★★ SEEDED FROM ALL ROWS, NOT THE SELECTED ONES. `cascadeDeselect` already
  //  guarantees a review-time selection cannot keep a dependent whose create was
  //  refused — but this function takes an arbitrary `selected` set from its
  //  caller, and an inconsistent one would otherwise send the dependent's write
  //  at the raw provisional number. Seeding everything costs nothing and makes
  //  the refusal structural rather than dependent on the caller being correct.
  const pending = new Map<string, Set<number>>();
  for (const row of rows) {
    if (row.mintedId === undefined) continue;
    let ids = pending.get(row.call.name);
    if (ids === undefined) {
      ids = new Set<number>();
      pending.set(row.call.name, ids);
    }
    ids.add(row.mintedId);
  }

  await batch.runBatched(async () => {
    for (let index = 0; index < rows.length; index += 1) {
      if (!selected.has(index)) continue;
      const row = rows[index];
      const { stamped } = row;
      // ★★★ BEFORE the try, and before `runTool` — this is a refusal to write,
      //  not a failed write, so it must not be reported through the catch that
      //  describes what the dispatcher did.
      if (namesPendingMint(stamped, pending)) {
        applied.push({ index, ok: false, error: PENDING_MINT_ERROR });
        continue;
      }
      // ★★ SECOND, AND ONLY REACHABLE ONCE THE MINT RESOLVED — the check above
      //  has already claimed every row whose create did not produce an id, so a
      //  `pendingOn` surviving to here means the target now EXISTS and the row
      //  would be remapped onto it. It still cannot be applied: a pending row is
      //  never stamped, and this tool's schema requires a token. Refused BEFORE
      //  `runTool` so it cannot reach `requireToken` and inherit the `stale`
      //  label, which would tell the user a row moved that never existed.
      //  ★ A MODEL-SUPPLIED token deliberately passes this guard. It may be
      //  garbage, but `requireToken` refuses a wrong VALUE loudly and that
      //  refusal genuinely is a token conflict — relabelling it here would
      //  swallow the one case `stale` is right about.
      if (
        row.pendingOn !== undefined &&
        TOKEN_REQUIRED_TOOLS.has(stamped.name) &&
        !hasUsableToken(stamped)
      ) {
        applied.push({ index, ok: false, error: NEW_ROW_TOKEN_UNAVAILABLE_ERROR });
        continue;
      }
      const call = remapStagedCall(stamped, real);
      try {
        const result = await runTool(dispatcher, call.name, call.input);
        resolveMintedId(row, result, real, pending);
        applied.push({ index, ok: true });
      } catch (e) {
        applied.push({
          index,
          ok: false,
          stale: e instanceof ConcurrencyTokenError,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  });

  return { rows: applied };
}
