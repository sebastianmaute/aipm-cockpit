// src/app/chat-task-patch.ts — the two PURE halves of the chat dispatcher's
// `updateTask`, split out of use-chat-dispatcher.ts to keep that file under the
// 800-line ratchet. Same precedent (and same shape) as chat-settings-patch.ts:
// no refs, no React, no i18n — the caller owns state and messaging.
//
// ★ Both throw rather than returning a result union, because that is exactly
//   what the dispatcher did inline and `runTool` already surfaces a thrown
//   Error as the tool result the model reads.

import {
  isValidEmail,
  sanitizeAssignee,
  sanitizeBlockers,
  sanitizeEmail,
  sanitizeGroup,
  sanitizeIsoDate,
  sanitizeLabels,
  sanitizeNonNegInt,
  sanitizePriority,
  sanitizeTaskName,
} from "./sanitize";
import { sanitizeAiRichText } from "./ai-rich-text";
import { type Task } from "./types";

/** Jira-managed fields can't be changed locally on linked tasks. A no-op for a
 *  task with no `jiraKey`. Throws with the issue key named, so the model can
 *  tell the user WHERE to make the change. */
export function assertJiraManagedUnchanged(
  existing: Task,
  patch: Partial<Task>,
): void {
  if (!existing.jiraKey) return;
  if (
    patch.assignee !== undefined &&
    sanitizeAssignee(patch.assignee) !== sanitizeAssignee(existing.assignee)
  ) {
    throw new Error(
      `Assignee for ${existing.jiraKey} is managed in Jira. Change it in Jira and re-sync.`,
    );
  }
  // ★ `undefined` VALUE but the key PRESENT is the reopen request — a plain
  //   `patch.completedDate === undefined` test cannot tell it from an absent key.
  if (
    patch.completedDate === undefined &&
    "completedDate" in patch &&
    existing.completedDate
  ) {
    throw new Error(
      `Reopening ${existing.jiraKey} must be done in Jira (workflow transition required).`,
    );
  }
  if (patch.status !== undefined && patch.status !== existing.status) {
    throw new Error(
      `Status for ${existing.jiraKey} is managed in Jira; change it via the Jira workflow and re-sync.`,
    );
  }
}

/** Per-field sanitize of a model-supplied task patch. Only keys the model
 *  actually SUPPLIED are carried, so a spread over the stored task leaves every
 *  other field byte-identical.
 *
 *  ★ `status` is deliberately NOT handled here — it is the one field that must
 *  route through `applyStatusChange` (it keeps the Done/completedDate
 *  invariant), which the caller does after merging. */
export function buildTaskCleanPatch(
  patch: Partial<Task>,
  existing: Task,
): Partial<Task> {
  const cleanPatch: Partial<Task> = {};
  if (patch.taskName !== undefined)
    cleanPatch.taskName = sanitizeTaskName(patch.taskName);
  if (patch.assignee !== undefined)
    cleanPatch.assignee = sanitizeAssignee(patch.assignee);
  if (patch.assigneeEmail !== undefined) {
    const e = sanitizeEmail(patch.assigneeEmail);
    if (e && !isValidEmail(e)) throw new Error("assigneeEmail is invalid");
    cleanPatch.assigneeEmail = e;
  }
  if (patch.dueDate !== undefined) {
    const d = sanitizeIsoDate(patch.dueDate);
    if (!d) throw new Error("dueDate must be YYYY-MM-DD");
    cleanPatch.dueDate = d;
  }
  if (patch.lastUpdateDate !== undefined) {
    const d = sanitizeIsoDate(patch.lastUpdateDate);
    if (d) cleanPatch.lastUpdateDate = d;
  }
  if (patch.priority !== undefined)
    cleanPatch.priority = sanitizePriority(patch.priority, existing.priority);
  if (patch.blockers !== undefined)
    cleanPatch.blockers = sanitizeBlockers(patch.blockers);
  // ★★★ Accepts BOTH shapes: `plainToHtml` escapes & < >, so HTML stored as
  // "<p>&lt;p&gt;…". Landmine: AGENTS.md "Rich-text register descriptions".
  if (patch.description !== undefined)
    cleanPatch.description = sanitizeAiRichText(patch.description);
  if (patch.inquiriesSent !== undefined)
    cleanPatch.inquiriesSent = sanitizeNonNegInt(patch.inquiriesSent);
  if (patch.group !== undefined) cleanPatch.group = sanitizeGroup(patch.group);
  if (patch.labels !== undefined)
    cleanPatch.labels = sanitizeLabels(patch.labels);
  return cleanPatch;
}
