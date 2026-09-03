// src/app/chat-tools-lists.ts — projections for the AI *read* path.
//
// `list_tasks` is the highest-volume tool call the assistant makes, and it used
// to return `d.listTasks()` verbatim: the whole array, no total, no page size,
// and every rich-HTML field serialized in full. Two costs came out of that —
// "how many tasks exist?" needed a second call, and the model paid for markup
// it cannot reason about (it reasons about a description's TEXT).
//
// ★ ONLY THE LIST PATH IS SLIMMED. `get_task` keeps full fidelity on purpose:
// an assistant about to EDIT a description needs the markup it is editing, and
// the volume that justifies the projection is all on the list side. That split
// is pinned by the "get_task keeps the full markup that the list projection
// strips" control in `chat-tools.test.ts` — without it, slimming BOTH paths
// would satisfy every other assertion in that block.
//
// ★ Pure and DOM-free. `htmlToPlainText` is regex-only (it never reaches
// DOMPurify), so this module is safe to import from the tool layer, which runs
// in both the browser and bare node under vitest.
import { entityToken, type TokenEntity } from "./ai-entity-token";
import { htmlToPlainText } from "./html-to-text";
import type { NoteLogEntry, Task } from "./types";

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

/** A `noteLog` entry as the list path reports it: the entry minus its `html`
 *  body. Dropping the markup is not a truncation — `NoteLogEntry.text` is the
 *  CANONICAL plain projection of that html (`sanitizeNoteLogWith` re-derives
 *  it on every load whenever the html projects to anything, and drops an entry
 *  that would end up with no text at all), so the reader loses nothing it could
 *  have read. Timestamp, author and id survive: the model still knows when and
 *  by whom a note was written. */
export type NoteLogListEntry = Omit<NoteLogEntry, "html">;

/** A task as `list_tasks` reports it: every field of `Task`, with the two rich
 *  HTML carriers projected to text. ★ `description` and `noteLog` are the
 *  ENTIRE slimming target on this path — the other five list tools already
 *  project to `*Summary` types that carry no rich HTML at all. */
export type TaskListItem = Omit<Task, "description" | "noteLog"> & {
  description: string;
  noteLog?: NoteLogListEntry[];
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

function slimNoteEntry(entry: NoteLogEntry): NoteLogListEntry {
  const { html, ...rest } = entry;
  // `text` is guaranteed non-empty by the load sanitizer, but this projection
  // also runs over rows minted in-session, so fall back rather than emit an
  // entry whose body is gone in both spellings.
  return { ...rest, text: entry.text || (html ? htmlToPlainText(html) : "") };
}

export function slimTaskForList(task: Task): TaskListItem {
  const { description, noteLog, ...rest } = task;
  return {
    ...rest,
    description: description ? htmlToPlainText(description) : "",
    ...(noteLog === undefined ? {} : { noteLog: noteLog.map(slimNoteEntry) }),
  };
}

/**
 * Wrap `tasks` in the paginated envelope `list_tasks` returns.
 *
 * `rawLimit` is untrusted model output: anything that does not FLOOR to a
 * positive finite number is treated as "no limit", which is also what an absent
 * one means.
 *
 * ★★★ FLOOR FIRST, THEN TEST POSITIVITY — THE OTHER ORDER HAS A HOLE ON THE
 * OPEN INTERVAL (0,1). This read `rawLimit > 0 ? Math.floor(rawLimit) :
 * undefined`, so `0.5` passed the positivity test as written, floored to `0`,
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
  const floored =
    typeof rawLimit === "number" && Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 0;
  const limit = floored > 0 ? floored : undefined;
  const page = limit === undefined ? tasks : tasks.slice(0, limit);
  return {
    // ★ The token comes from the FULL `task`, never from the slimmed item the
    // model sees: `slimTaskForList` projects `description` and `noteLog` to
    // text, and a token derived from that projection could not tell two
    // descriptions apart that differ only in markup.
    items: page.map((task) => withToken("task", slimTaskForList(task), task)),
    total: tasks.length,
    ...(limit === undefined ? {} : { limit }),
  };
}
