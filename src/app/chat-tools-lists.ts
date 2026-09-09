// src/app/chat-tools-lists.ts — projections for the AI *read* path.
//
// `list_tasks` is the highest-volume tool call the assistant makes, and it used
// to return `d.listTasks()` verbatim: the whole array, no total, no page size,
// and every rich-HTML field serialized in full. Two costs came out of that —
// "how many tasks exist?" needed a second call, and the model paid for markup
// it cannot reason about (it reasons about a description's TEXT).
//
// ★ ONLY THE LIST PATH IS NARROWED. `get_task` keeps full fidelity on purpose:
// an assistant about to EDIT a description needs the markup it is editing, and
// a note log the model is told it has no tool to read or write is only worth
// paying for on demand. That split is pinned by the "get_task keeps the full
// note log and markup that the list projection strips" control in
// `chat-tools.test.ts` — without it, narrowing BOTH paths would satisfy every
// other assertion in that block.
//
// ★ Pure and DOM-free. `htmlToPlainText` is regex-only (it never reaches
// DOMPurify), so this module is safe to import from the tool layer, which runs
// in both the browser and bare node under vitest.
import { entityToken, type TokenEntity } from "./ai-entity-token";
import { htmlToPlainText } from "./html-to-text";
import { coerceNumericInput } from "./resolve-limit";
import type { Task } from "./types";

/** A read-path row carrying the optimistic-concurrency token the matching
 *  `update_*` tool demands back.
 *
 *  ★★★ THE TOKEN RIDES THE ROW, NOT A SIDECAR MAP, AND THAT IS A SAFETY CHOICE
 *  RATHER THAN A STYLISTIC ONE. The alternative shape — one `{id: token}` map
 *  beside `items` — asks the model to pair a token with a row by looking the id
 *  up in a second structure, and every mispairing it makes is a token that is
 *  *valid* (it is some real row's token) but belongs to the WRONG row. A
 *  mispaired-but-valid token is refused STRUCTURALLY, not by luck — but the
 *  shape still makes the model's job harder for no gain. Adjacency makes the
 *  pairing structural too: the token the model copies is the one sitting inside
 *  the object it is editing.
 *
 *  ★★★ WHAT MAKES THE REFUSAL STRUCTURAL IS THAT `id` IS A COVERED COLUMN, AND
 *  THIS COMMENT USED TO CALL IT LUCK. `id` is the FIRST entry of all six
 *  `*_CSV_COLUMNS` and appears in no `TOKEN_EXCLUDED` list, so two distinct
 *  rows of the same kind always differ in at least that column and their tokens
 *  can only agree through a hash collision across the token's full width. That
 *  is a property to PRESERVE, not an accident to note: understating it invites
 *  a future editor to excise `id` from the projection — plausible on the face
 *  of it, since an id is bookkeeping the model does not edit — believing
 *  nothing rests on it. It does: without `id`, two rows identical in every
 *  other covered field share a token, and a mispairing between them becomes a
 *  genuine false PERMIT.
 *  ★ Do not upgrade "full width" to a bit count here. `ai-entity-token.ts`
 *  records that its own header once asserted 64 bits when the measured figure
 *  was 63; the claim that matters is that a collision is the ONLY way, not how
 *  improbable it is.
 *
 *  ★★ OPTIONAL, AND THE ABSENT CASE IS THE SAFE ONE. A token is emitted only
 *  when the FULL stored row is in hand; when the lookup misses (a row that
 *  vanished between the list read and the per-row lookup — both synchronous
 *  reads of the same ref, so effectively unreachable) the field is simply
 *  omitted. `requireToken` refuses on absence, so the model is told to re-read
 *  rather than handed a token derived from something weaker. Never fall back to
 *  deriving one from the SUMMARY: see `withRowTokens`. */
export type Tokened<T> = T & { expectedToken?: string };

/** Attach `full`'s token to the model-facing row `row`.
 *
 *  ★★★ `row` AND `full` ARE DELIBERATELY TWO ARGUMENTS AND MUST NOT BE COLLAPSED
 *  INTO ONE. `row` is what the model reads (often a `*Summary`); `full` is the
 *  stored entity the token is derived from. Deriving from `row` would be a
 *  FALSE PERMIT for every field the summary omits — `RaidSummary` drops
 *  `description` and `mitigation`, so a summary-derived token is byte-identical
 *  before and after an edit to either, and the guard would permit the overwrite
 *  it exists to stop.
 *
 *  ★★ PINNED BY `chat-tools.test.ts`, in the describe "the read path hands out
 *  a token the write path accepts" — specifically its `it.each(ROUND_TRIP)`
 *  case's `expect(row.expectedToken).toBe(FRESH_*_TOKEN)`, whose `FRESH_*`
 *  constants come from the fixture makers rather than from either path, so a
 *  summary-derived token cannot satisfy them. `ai-entity-token.test.ts` does
 *  NOT pin it and this comment cited that file for a release: measured, a
 *  summary-derivation mutant leaves `ai-entity-token.test.ts` fully green
 *  (`grep -ci summary src/app/ai-entity-token.test.ts` returns 0 — it never
 *  mentions the concept) while `chat-tools.test.ts` goes red. */
export function withToken<T extends object>(
  kind: TokenEntity,
  row: T,
  full: object | null,
): Tokened<T> {
  if (!full) return row;
  return { ...row, expectedToken: entityToken(kind, full) };
}

/** Attach a per-row token to every row of a list tool's result.
 *
 *  ★★★ THE LIST PATH IS NOT AN OPTIMISATION OF THE `get_*` PATH — FOR FOUR OF
 *  THE SIX GUARDED ENTITIES IT IS THE ONLY PATH. RAID, changes, milestones and
 *  stakeholders have no `get_*` tool at all (`grep -oE 'name: "get_[a-z_]+"'
 *  src/app/chat-tool-defs.ts` returns `get_task`, `get_resource`,
 *  `get_app_state`, `get_dashboard_snapshot` — no register among them), so a
 *  model reads them only through `list_raid` / `list_changes` /
 *  `list_milestones` / `list_stakeholders`. Attaching the token to single-entity
 *  reads alone would leave those four permanently unwritable: their `update_*`
 *  tools refuse on absence, and the token is a hash the model cannot compute.
 *
 *  ★ `getRow` is called once per row, so this is O(n) `find`s over the live
 *  array — quadratic in the register's size. Stated rather than optimised: the
 *  registers this runs over are project-scale (tens to low hundreds of rows),
 *  the work is a synchronous field compare per row, and an id→row Map built per
 *  call would trade that for an allocation the small case does not need. If a
 *  register ever grows past a few thousand rows, index first and measure. */
export function withRowTokens<T extends { id: number }>(
  kind: TokenEntity,
  rows: readonly T[],
  getRow: (id: number) => object | null,
): Tokened<T>[] {
  return rows.map((row) => withToken(kind, row, getRow(row.id)));
}

/** A task as `list_tasks` reports it: every field of `Task` except the note
 *  log, with `description` projected to plain text.
 *
 *  ★★★ `noteLog` IS DROPPED OUTRIGHT, NOT PROJECTED, and it must stay dropped.
 *  It was 37.8% of this payload on a 140-task project — the single largest
 *  field by a factor of five — while `lib/app-feature-guide.md` told the model
 *  four times that it has no tool for notes. The app was paying to ship data
 *  it had forbidden the model to use.
 *  ★★ The capability was RELOCATED, not deleted: `get_task` still returns the
 *  full `Task` including `noteLog` with its HTML, at roughly 112 tokens per
 *  task on demand instead of thousands in bulk. `get_task`'s tool description
 *  carries the read-only constraint. Pinned by "list_tasks carries no note log
 *  at all" and by the get_task control beside it — both are needed.
 *  ★ The other five list tools already project to `*Summary` types that carry
 *  no rich HTML at all, which is why only this one needed narrowing. */
export type TaskListItem = Omit<Task, "description" | "noteLog"> & {
  description: string;
};

export type ListEnvelope<T> = {
  items: T[];
  /** The count BEFORE `limit` was applied, so "how many tasks exist?" is
   *  answerable from ONE call even when the caller asked for a page. */
  total: number;
  /** Echoed back ONLY when the caller passed a usable one. ★ Omitting it must
   *  leave today's return-everything behaviour untouched, key for key, so no
   *  existing prompt sees a shape it was not written against. */
  limit?: number;
};

export function slimTaskForList(task: Task): TaskListItem {
  // `noteLog` is destructured only to EXCLUDE it from `rest`; it is
  // deliberately never re-attached. See TaskListItem's docstring. This repo's
  // eslint config sets no `ignoreRestSiblings` (verified: `--print-config`
  // shows the rule with no options object), so the binding needs a real read
  // to satisfy `no-unused-vars` — `void` is that read, not a workaround.
  const { description, noteLog, ...rest } = task;
  void noteLog;
  return {
    ...rest,
    description: description ? htmlToPlainText(description) : "",
  };
}

/**
 * Wrap `tasks` in the paginated envelope `list_tasks` returns.
 *
 * `rawLimit` is untrusted model output: anything that does not FLOOR to a
 * positive finite number is treated as "no limit", which is also what an absent
 * one means.
 *
 * ★★ A NUMERIC STRING IS COMPREHENSIBLE INTENT, NOT MALFORMED INPUT, AND THE
 * TWO GET OPPOSITE TREATMENT ON PURPOSE. Models emit `"10"` for a numeric
 * field routinely, and the rule below used to test `typeof rawLimit ===
 * "number"` alone, so `"10"` fell through to "no limit" and returned the WHOLE
 * register — the exact response-cost blowup this envelope exists to bound,
 * silently, on a request whose meaning was never in doubt. `coerceNumericInput`
 * honours the ask; `"abc"` still cannot be read as a page size and still means
 * "no limit". ★ This does NOT reopen the (0,1) hole below: `"0.5"` coerces to
 * 0.5 and floors to 0 exactly as the bare number does.
 * ★★ THE COERCION IS SHARED, THE POLICY IS NOT. `coerceNumericInput`
 * (`resolve-limit.ts`) only answers "is this a finite number?"; the floor, the
 * positivity test and what a non-positive value MEANS stay here, because
 * `resolveLimit`'s answer to the same input is its own fallback page size while
 * this envelope's is "no limit at all". Do not fold the two together.
 *
 * ★ `limit` in the result is the BOUND that was applied to the slice, not a row
 * count — `items.length` is the page size, and a bound larger than `total` is
 * reported as asked (`{limit: 1000, total: 14, items: 14}` is coherent).
 *
 * ★★★ FLOOR FIRST, THEN TEST POSITIVITY — THE OTHER ORDER HAS A HOLE ON THE
 * OPEN INTERVAL (0,1). This used to test `> 0` against the RAW value and floor
 * afterwards, so `0.5` passed the positivity test, floored to `0`,
 * and produced `{items: [], limit: 0, total: N}` — every row withheld from a
 * model that asked for a page, reported as a successful empty result it cannot
 * distinguish from "there are no tasks". `total` would contradict it, but
 * nothing makes the model read that. The docstring above already said such a
 * value means "no limit"; the code and the doc simply disagreed on (0,1), and
 * the doc had the better rule. A fractional limit is malformed model output,
 * and the safe reading of malformed output here is "no limit" — showing
 * everything — not "no rows".
 */
export function listTasksEnvelope(
  tasks: readonly Task[],
  rawLimit: unknown,
): ListEnvelope<Tokened<TaskListItem>> {
  const asNumber = coerceNumericInput(rawLimit);
  const floored = asNumber === undefined ? 0 : Math.floor(asNumber);
  const limit = floored > 0 ? floored : undefined;
  const page = limit === undefined ? tasks : tasks.slice(0, limit);
  return {
    // ★ The token comes from the FULL `task`, never from the slimmed item the
    // model sees: `slimTaskForList` projects `description` to text and drops
    // `noteLog` outright, and a token derived from that projection could not
    // tell two descriptions apart that differ only in markup.
    items: page.map((task) => withToken("task", slimTaskForList(task), task)),
    total: tasks.length,
    ...(limit === undefined ? {} : { limit }),
  };
}
