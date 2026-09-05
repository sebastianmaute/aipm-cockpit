// src/app/chat-proposal-stage.ts — the pure half of the chat staging wiring.
//
// React-free and i18n-free. `chat-panel.tsx` is the sole consumer; everything
// here is a function of the call list plus the live workspace, so the staging
// decisions are testable without rendering the panel.
//
// ★ Why a module rather than four helpers inside the panel: the panel is a
//   client component whose tests drive it through a mocked `fetch`, and every
//   one of these functions has a failure mode a rendered assertion states only
//   indirectly (the WRONG mint sequence, the WRONG list, a title that silently
//   degrades to a tool name). They are pinned directly in
//   `chat-proposal-stage.test.ts`.
import {
  CREATE_MINT_KIND,
  isCreateTool,
  type PlanRow,
  type ProposedCall,
} from "./chat-proposal";
import { TOOL_ENTITY, type DescribedRow } from "./chat-proposal-describe";
import { INLINE_DESCRIPTORS } from "./inline-ai-edit/entity-descriptor";
import { mintIds } from "./id-mint-session";
import type { Workspace } from "./workspace";

/** What the model is told about a write the user has not approved yet.
 *
 *  ★★ IT MUST SAY BOTH "not applied" AND "do not re-issue". A `tool_result`
 *   reporting only that nothing happened reads to the model as a transient
 *   failure, and the obvious recovery is to call the tool again — which would
 *   stage a SECOND copy of the same write onto the same card. Saying the write
 *   is queued for the user closes that loop.
 *
 *  ★ ENGLISH AND NOT TRANSLATED, deliberately: it is model-facing, exactly like
 *   `INTERRUPTED_TOOL_RESULT` and `CONTINUE_NUDGE` in `chat-api.ts`. Nothing
 *   here reaches the user's screen. */
export const STAGED_TOOL_RESULT =
  "This write was staged for the user to review and has NOT been applied. " +
  "Do not call this tool again for the same change. Tell the user the proposed " +
  "changes are waiting for their approval in the review card.";

/** The `tool_result` body for one staged call.
 *
 *  ★★★ A CREATE MUST DISCLOSE ITS PROVISIONAL ID, and this is the whole reason
 *   the result is not a single constant. A staged `create_task` writes nothing,
 *   so a follow-up `update_task` in the SAME turn has no id to name — the model
 *   would either invent one or give up and re-issue the create. The provisional
 *   id is exactly what `buildPlanRows` paired the row with, so a dependent call
 *   naming it is graphed as a real dependency and remapped onto the REAL id at
 *   apply time (`remapStagedCall`).
 *
 *  ★★ IT IS ANNOUNCED AS PROVISIONAL, not as the row's id. The number is
 *   guaranteed NOT to survive apply — `mintProvisionalIds` advances the session
 *   high-water mark, so the real minter hands out a strictly higher one — and a
 *   model told otherwise could report it to the user as the created row's id. */
export function stagedToolResult(mintedId: number | undefined): string {
  if (mintedId === undefined) return STAGED_TOOL_RESULT;
  return (
    `${STAGED_TOOL_RESULT} If the user approves it, this row will be created; ` +
    `refer to it as id ${mintedId} in later calls in THIS turn only. That number ` +
    "is provisional and is not the id the row will finally have, so never show it to the user."
  );
}

/** The workspace list a create's id sequence is minted against, for a create
 *  tool that has no `INLINE_DESCRIPTORS` entity.
 *
 *  ★ `create_document` is the only member today, and it is a literal for the
 *   same reason `CREATE_MINT_KIND`'s own `create_document` row is: documents
 *   have no descriptor, so there is no second source to derive it from. A new
 *   descriptor-less create tool that is missed here falls through to the empty
 *   list below — see `mintListFor`. */
const NO_DESCRIPTOR_LIST: Readonly<Record<string, keyof Workspace>> = {
  create_document: "documents",
};

/** The live rows a create tool's provisional id must clear.
 *
 *  ★★ DERIVED FROM `INLINE_DESCRIPTORS` VIA `TOOL_ENTITY`, never hand-typed —
 *   the descriptor already states each entity's `createTool` beside its
 *   `wsKey`, so a renamed tool or a moved slice cannot leave a stale copy here.
 *   This is the same derivation `CREATE_MINT_KIND`'s docstring records for its
 *   own six values, applied to the other half of the same fact.
 *
 *  ★ An unknown tool yields `[]` rather than throwing. `mintIds` takes
 *   `max(sessionMark, listMax)`, so an empty list is not a wrong answer — it is
 *   the answer that trusts the session mark alone. See `mintProvisionalIds` for
 *   why that is a fallback and not the design. */
function mintListFor(name: string, ws: Workspace): readonly { id: number }[] {
  const entity = TOOL_ENTITY[name];
  const key = entity !== undefined ? INLINE_DESCRIPTORS[entity].wsKey : NO_DESCRIPTOR_LIST[name];
  if (key === undefined) return [];
  const rows = ws[key] as unknown;
  return Array.isArray(rows) ? (rows as readonly { id: number }[]) : [];
}

/**
 * One provisional id per CREATE call, in emission order — the array
 * `buildPlanRows` consumes.
 *
 * ★★★ `mintIds`, NEVER `peekMintId`, AND THE DIFFERENCE IS A CORRECTNESS ONE.
 * `mintIds` ADVANCES the session high-water mark, so the real minter that runs
 * at apply time returns a strictly higher number and the provisional id ALWAYS
 * differs from the real one. `peekMintId` does not advance: the FIRST create's
 * provisional id would equal the id apply mints for it, so `remapStagedCall`
 * would be a no-op for that row and live for every later one. A remap that
 * fires on some rows and not others is worse than one that never fires — it
 * looks covered, and the one row it silently skips is the row a test fixture is
 * most likely to use.
 *
 * ★★ THE REAL LIST IS PASSED, NOT `[]`. `seedMintFromWorkspace` runs on every
 * load funnel (`applyWorkspace`, plus the version-restore path), so the session
 * mark is in practice already above every live id and an empty list would give
 * the same answer. Passing the list makes that irrelevant: `mintIds` takes
 * `max(sessionMark, listMax)`, so the id clears the live rows whether or not
 * the seed ran. The workspace is already in hand here for `describeProposal`,
 * so this costs nothing and removes a dependency on a guarantee held somewhere
 * else entirely.
 *
 * ★★ IDS ARE RESERVED PER TOOL, IN ONE `mintIds` CALL PER TOOL, then dealt back
 * out in emission order. Minting one at a time would be equivalent today, but
 * reserving a block is what `mintIds` exists for and it keeps each tool's ids
 * contiguous, which makes a fixture's expected numbers readable.
 *
 * ★★★ THROWS on a create tool `CREATE_MINT_KIND` does not classify, rather than
 * minting under an `undefined` key. That table's drift test derives its expected
 * key set from the live `TOOL_DEFS`, so a new `create_*` tool goes red THERE
 * first; reaching this throw means the gate was edited without the table. Loud
 * beats a plan whose ids came from a sequence nothing else uses — which would
 * hand out id 1 over a live workspace.
 */
export function mintProvisionalIds(
  calls: readonly ProposedCall[],
  ws: Workspace,
): readonly number[] {
  const wanted = new Map<string, number>();
  for (const call of calls) {
    if (!isCreateTool(call.name)) continue;
    wanted.set(call.name, (wanted.get(call.name) ?? 0) + 1);
  }

  const pools = new Map<string, number[]>();
  for (const [name, count] of wanted) {
    const kind = CREATE_MINT_KIND[name];
    if (kind === undefined) {
      throw new Error(
        `mintProvisionalIds: "${name}" is a create tool with no CREATE_MINT_KIND entry`,
      );
    }
    pools.set(name, mintIds(kind, mintListFor(name, ws), count).slice());
  }

  const out: number[] = [];
  for (const call of calls) {
    if (!isCreateTool(call.name)) continue;
    const id = pools.get(call.name)?.shift();
    // Unreachable: the pool for a tool holds exactly as many ids as this loop
    // takes from it. An assertion on our own counting, not on model output.
    if (id === undefined) throw new Error(`mintProvisionalIds: exhausted "${call.name}"`);
    out.push(id);
  }
  return out;
}

/** The document tools that address an EXISTING document by `input.id`, but have
 *  no descriptor — so `TOOL_ENTITY` misses them and `liveRowTitle` would fall
 *  back to the bare tool name.
 *
 *  ★★ THE `TITLED_` PREFIX IS THE POINT, and it was added after a review found
 *   the collision. `chat-tools-documents.ts` has its own module-local
 *   `DOCUMENT_TOOLS` — the FIVE tools `isDocumentTool` routes, `create_document`
 *   and the two READ tools included. Same name, adjacent subject, different
 *   membership, and the difference is precisely the exclusion the next paragraph
 *   calls load-bearing. That one is the older and broader set and keeps its
 *   name; this one says which document tools can be NAMED from the workspace.
 *
 *  ★★★ THIS IS THE ROW THAT MOST NEEDS A NAME. Document chat writes take NO
 *   undo capture (they recover via `documentVersions` instead), so the staged
 *   card is the only thing between the model and an unreviewed multi-document
 *   rewrite — and it was the row the card could say least about.
 *
 *  ★★★ `create_document` is deliberately EXCLUDED, and that exclusion is
 *   load-bearing, not merely accurate: a create call has no id of its own, so
 *   a model-supplied stray `id` on it would resolve against the live list and
 *   label a CREATE row with a DIFFERENT, pre-existing document's title.
 *   `TOOL_ENTITY` misses `create_document` too, so its title still falls
 *   through to `null` here and the caller's own create-title fallback wins.
 *
 *  ★ Deliberately NOT a `document` entry in `INLINE_DESCRIPTORS`: `blocks` is a
 *   typed union outside `diffFields`' scalar model, so a descriptor would diff
 *   the title alone while implying it diffs more. */
const TITLED_DOCUMENT_TOOLS: ReadonlySet<string> = new Set(["update_document", "delete_document"]);

/**
 * The LIVE row's own title for a call that addresses one, or `null`.
 *
 * ★★ THE ANSWER TO `proposalRowTitle`'S OWN DOCSTRING, which says a caller
 * holding the workspace should resolve `input.id` against the live row rather
 * than take its last fallback — the TOOL NAME. An update plan carries only
 * `FieldDiff`s and no label, so without this every `update_*` row on the card
 * would be titled "update_task", and a card that cannot say WHICH row it is
 * about is a card the user cannot refuse a single row on.
 *
 * ★ `null` rather than a fallback string, so the caller composes the precedence
 * itself and this function never has to import the presentational default out
 * of a `.tsx`. A create legitimately has no id and yields `null` here; its
 * title comes from the plan.
 *
 * ★ Resolved through the SAME descriptor `describeProposal` grounds the row
 * against (`TOOL_ENTITY` → `INLINE_DESCRIPTORS`), so the title and the diff
 * beneath it can never describe two different rows.
 */
export function liveRowTitle(call: ProposedCall, ws: Workspace): string | null {
  const entity = TOOL_ENTITY[call.name];
  if (entity === undefined && TITLED_DOCUMENT_TOOLS.has(call.name)) {
    const docId = Number((call.input as { id?: unknown }).id);
    if (!Number.isFinite(docId)) return null;
    const found = ws.documents?.find((doc) => doc.id === docId);
    const docTitle = found?.title;
    return typeof docTitle === "string" && docTitle.trim() !== "" ? docTitle : null;
  }
  if (entity === undefined) return null;
  const d = INLINE_DESCRIPTORS[entity];
  const id = Number((call.input as { id?: unknown }).id);
  if (!Number.isFinite(id)) return null;
  const rows = ws[d.wsKey] as unknown;
  if (!Array.isArray(rows)) return null;
  const found = (rows as readonly { id: number }[]).find((r) => r.id === id);
  if (found === undefined) return null;
  const title = d.titleOf(found as unknown as Record<string, unknown>);
  return typeof title === "string" && title.trim() !== "" ? title : null;
}

/** Every described row's display title, in row order. */
export function proposalTitles(
  rows: readonly DescribedRow[],
  ws: Workspace,
  fallback: (row: DescribedRow) => string,
): readonly string[] {
  return rows.map((row) => liveRowTitle(row.call, ws) ?? fallback(row));
}

/**
 * True when `row` is unselected BECAUSE something it needs is unselected — the
 * card's `cascaded` flag, which also DISABLES its checkbox.
 *
 * ★★★ DISABLING IS WHAT MAKES RE-SELECTION SAFE, and it is the reason there is
 * no `cascadeSelect` counterpart. `cascadeDeselect` guarantees a deselect
 * propagates DOWNSTREAM, but nothing stops a user ticking a dependent back on
 * while its create stays refused — which would send that row's write at a
 * PROVISIONAL id. `applyProposal` refuses such a row structurally (it seeds
 * `pending` from ALL rows, not the selected ones), so the write can never land;
 * this flag is what stops the card OFFERING a click whose only outcome is a
 * refusal the user cannot act on.
 *
 * ★ BOTH edge fields are read, mirroring `cascadeDeselect`. For a
 * `buildPlanRows` row `dependsOn` is always inside `dependsOnAll`, so the union
 * is redundant there — it is not for a hand-built row, and the two functions
 * agreeing about which edges exist matters more than the saved comparison.
 *
 * ★ A SELECTED row is never cascaded. The flag means "held back by a refusal",
 * and a row the user kept is not held back by anything.
 */
export function isCascadedRow(row: PlanRow, selected: ReadonlySet<number>): boolean {
  if (selected.has(row.index)) return false;
  if (row.dependsOn !== undefined && !selected.has(row.dependsOn)) return true;
  return (row.dependsOnAll ?? []).some((dep) => !selected.has(dep));
}

/** Mint an id for one staged proposal. Mirrors `newThreadId` — `crypto` when it
 *  exists, a timestamped fallback otherwise.
 *
 *  ★★ IT IS THE PROPOSAL'S IDENTITY IN THE TRANSCRIPT, and the transcript is
 *   PERSISTED while the plan is not. A restored transcript therefore carries a
 *   marker whose id matches no live plan, which is exactly how the card knows
 *   to render as expired instead of offering a plan staged against a workspace
 *   that has since moved. A reused id would resurrect the wrong plan. */
export function newProposalId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `proposal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
