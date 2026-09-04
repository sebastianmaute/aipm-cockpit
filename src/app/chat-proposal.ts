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
