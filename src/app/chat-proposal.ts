// src/app/chat-proposal.ts — the staging gate for a chat turn's tool calls.
//
// Pure and i18n-free. Decides whether a turn's tool calls apply immediately or
// stage for review.
//
// ★ Deliberately knows nothing about React, the workspace or the dispatcher.
//   Everything here is a function of the CALL LIST alone, which is what makes
//   the gate testable without a fixture workspace.

/** One tool call the model emitted. Structurally identical to the insights
 *  pipeline's `InsightToolCall` (`insights/insight.ts`); kept as its own name
 *  because chat proposals are not insight recommendations and merging the two
 *  types would couple the register's persisted shape to the chat transcript's. */
export interface ProposedCall {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/** Tools that remove data. Any one of these stages the whole turn, regardless of
 *  how many calls it made — a single `delete_all_tasks` is one call and is the
 *  most destructive thing the model can do.
 *
 *  ★★ `delete_document` belongs here even though a deleted document leaves a
 *   restorable version (`deleteDocument` returns `restorableVersionId`). The
 *   recovery path is the Documents tombstone list, not the undo stack, and
 *   nothing on the chat surface points at it — so from the chat user's seat the
 *   delete is as final as the other seven. */
const DESTRUCTIVE_TOOLS: ReadonlySet<string> = new Set([
  "delete_task", "delete_all_tasks", "delete_raid_item", "delete_change",
  "delete_milestone", "delete_stakeholder", "delete_resource",
  "delete_document",
]);

/** Tools that write PROJECT ENTITY data.
 *
 *  ★ `set_language`, `set_filters` and `update_settings` are deliberately ABSENT.
 *   They change device-local preferences, not project data — verified:
 *   `setLanguage` and `updateSettings` write through `args.setSettings` only
 *   (`use-chat-dispatcher.ts`), touching no workspace setter and no `Workspace`
 *   slice, and persist via `writeSettings` into localStorage; `set_filters`
 *   routes to `applyFilters`, which writes the pane's filter state. None of them
 *   is in the undo stack either, so staging them would offer a review of
 *   something the rest of the app treats as ephemeral.
 *
 *  ★★★ `send_inquiry` IS here, and it is the non-obvious member. It reads like a
 *   send-an-email action, but its dispatcher handler increments
 *   `Task.inquiriesSent` through `setTasks` — a persisted `Workspace.tasks`
 *   write, with NO undo capture. Two of them is a bulk outbound action over
 *   project data, which is exactly what this gate exists to put in front of the
 *   user. ★★ CONSEQUENCE FOR WHOEVER APPLIES A STAGED TURN: its handler also
 *   calls `window.open` on a `mailto:` URL, so the mail client opens WHEN THE
 *   CALL RUNS. A staged turn must therefore be applied by RE-INVOKING the call,
 *   never by replaying a data diff — a diff-replay would bump the counter and
 *   silently send nothing.
 *
 *  ★★ The three document writes are here even though document writes take no
 *   undo capture at all (`use-document-tools.ts` says so at three sites) and
 *   rely on `documentVersions` instead. That argues for MORE staging, not less:
 *   the single-write exemption below is justified by undo, and documents have
 *   none, so the only thing standing between the model and an unreviewed
 *   multi-document rewrite is this gate. */
const ENTITY_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "create_task", "update_task", "set_task_dependencies", "send_inquiry",
  "create_raid_item", "update_raid_item",
  "create_change", "update_change",
  "create_milestone", "update_milestone",
  "create_stakeholder", "update_stakeholder",
  "create_resource", "update_resource",
  "create_document", "update_document",
  ...DESTRUCTIVE_TOOLS,
]);

export function isDestructiveTool(name: string): boolean {
  return DESTRUCTIVE_TOOLS.has(name);
}

export function isEntityWriteTool(name: string): boolean {
  return ENTITY_WRITE_TOOLS.has(name);
}

/** True when this turn must be reviewed before anything is written: it deletes
 *  something, or it writes more than one row. A single non-destructive write
 *  applies immediately and relies on undo. */
export function shouldStage(calls: readonly ProposedCall[]): boolean {
  let writes = 0;
  for (const c of calls) {
    if (isDestructiveTool(c.name)) return true;
    if (isEntityWriteTool(c.name)) writes += 1;
  }
  return writes > 1;
}

/** True for a tool that MINTS a row rather than addressing an existing one.
 *
 *  ★ The prefix IS the whole rule — verified against the live `TOOL_DEFS`: all
 *   seven `create_*` tools are entity writes, and nothing else in the 45 is
 *   named `create_*`. `chat-proposal.test.ts` partitions the live array against
 *   a literal list of the seven, so a new `create_*` tool goes red there.
 *
 *  ★★ Exported because `buildPlanRows` consumes exactly one minted id per create
 *   and the CALLER has to mint that many. A caller re-deriving "is this a
 *   create?" independently is how the two sides drift; when they do drift, the
 *   symptom is a dependent silently linked to nothing — the very failure the
 *   cascade exists to prevent. Same predicate, one definition. */
export function isCreateTool(name: string): boolean {
  return name.startsWith("create_");
}

/** One row of a staged plan. `index` is its position in the emitted call list and
 *  is the row's stable identity — nothing here is keyed by array position after
 *  a filter, because a filtered index would shift under a deselect. */
export interface PlanRow {
  readonly index: number;
  readonly call: ProposedCall;
  /** Set on a staged create: the id minted for the row it will create. */
  readonly mintedId?: number;
  /** Index of the row whose `mintedId` this call's `id` refers to. */
  readonly dependsOn?: number;
}

/** Pair each call with its provisional id and its dependency.
 *  `mintedIds` supplies one id per CREATE call, in emission order.
 *
 *  ★★ THROWS when `mintedIds` is shorter than the plan's create count, rather
 *   than leaving a row without a `mintedId`. A create with no id resolves no
 *   dependents, so rejecting it would silently NOT cascade — a review card that
 *   looks correct and applies a call pointing at a row that will never exist.
 *   The caller mints from the same `isCreateTool` predicate, so the throw is an
 *   assertion on our own wiring, not a response to model output: it is
 *   unreachable while the two sides agree, and loud the moment they do not.
 *   A LONGER array is deliberately accepted — the surplus is unused and the
 *   pairing of the first N is unaffected.
 *
 *  ★ `Number(input.id)` mirrors `chat-tools.ts`, which addresses every row that
 *   way at apply time (`const id = Number(input.id)`, seven sites). The graph
 *   therefore links exactly where the dispatcher would write — including a
 *   string id, which would reach the created row. */
export function buildPlanRows(
  calls: readonly ProposedCall[],
  mintedIds: readonly number[],
): readonly PlanRow[] {
  const idToRow = new Map<number, number>();
  const rows: PlanRow[] = [];
  let mintCursor = 0;

  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    const isCreate = isCreateTool(call.name);

    let mintedId: number | undefined;
    if (isCreate) {
      if (mintCursor >= mintedIds.length) {
        throw new RangeError(
          `buildPlanRows: ran out of minted ids at call ${index} ("${call.name}") — ` +
            `${mintedIds.length} supplied, one is needed per create`,
        );
      }
      mintedId = mintedIds[mintCursor];
      mintCursor += 1;
      idToRow.set(mintedId, index);
    }

    // A create cannot depend on its own id, so the lookup happens only for
    // non-creates. Ordering matters: `idToRow` is populated as we walk, so a
    // forward reference (a call naming an id minted LATER) resolves to
    // undefined rather than to the wrong row. That also makes every `dependsOn`
    // point STRICTLY BACKWARD, which is what keeps the cascade below acyclic.
    const referenced = isCreate ? Number.NaN : Number((call.input as { id?: unknown }).id);
    const dependsOn = Number.isFinite(referenced) ? idToRow.get(referenced) : undefined;

    rows.push({ index, call, mintedId, dependsOn });
  }
  return rows;
}

/** Deselect `index` and, transitively, every row that depends on it. Pure —
 *  returns a new set and never mutates the one passed in.
 *
 *  ★★ The `next.delete(cur)` result GATES THE WALK, and that is BEHAVIOUR, not
 *   an optimisation — measured by mutation, not reasoned. Dropping the guard
 *   (`next.delete(cur) || true`) turns "deselecting a row already deselected
 *   leaves the rest alone" red: the walk runs on through that row's dependents
 *   and deselects them too. The walk therefore STOPS at the first row that was
 *   not selected. Both readings are defensible once the input state is already
 *   inconsistent (a selected row whose dependency is not selected) — which this
 *   function alone cannot produce — so a test pins the one we chose.
 *  ★ The guard also BOUNDS the walk on a HAND-BUILT `rows` array. Every
 *   `dependsOn` in a `buildPlanRows` graph points strictly backward, so no cycle
 *   is constructible there; a caller assembling rows by hand could write a
 *   two-row cycle that would otherwise re-enqueue forever. */
export function cascadeDeselect(
  rows: readonly PlanRow[],
  selected: ReadonlySet<number>,
  index: number,
): ReadonlySet<number> {
  const next = new Set(selected);
  const drop: number[] = [index];

  let cur = drop.pop();
  while (cur !== undefined) {
    if (next.delete(cur)) {
      for (const row of rows) if (row.dependsOn === cur) drop.push(row.index);
    }
    cur = drop.pop();
  }
  return next;
}
