// Pure sanitizer for Open-Points inline cell edits.
//
// Each editable cell emits a single-field `Partial<Task>` patch; this collapses
// them through the same per-field validators the form-save path uses, so an
// inline edit can never write an unsanitized value. Kept i18n-free and pure so
// it is unit-testable without rendering the tasks pane (the React handler in
// tasks-section just supplies the live resource/task id sets).
import {
  emailWriteRefusal,
  sanitizeAssignee,
  sanitizeBlockers,
  sanitizeDependencies,
  sanitizeIsoDate,
  sanitizeLoadedEmail,
  sanitizePriority,
  sanitizeTaskName,
} from "./sanitize";
import type { EmailRefusal } from "./sanitize-core";
import { sanitizeRichHtml } from "./sanitize-html";
import type { Task } from "./types";

export interface InlinePatchContext {
  /** True when the id points at a live directory resource (FK validation). */
  hasResource: (id: number) => boolean;
  /** Ids of all live tasks — dependency targets must exist. */
  knownTaskIds: ReadonlySet<number>;
  /** The task being edited (self-dependency guard). */
  ownTaskId: number;
  /** The row's STORED assignee email — an unchanged value is never refused. */
  storedAssigneeEmail?: string;
  /** The stored email of the person THIS patch picked (the resource named by
   *  `patch.resourceId`; the cell's picker is given no address book). A copy of
   *  it is never refused (spec Part 1, decision 2). Only the picked source is
   *  exempt — never every resource's email (pre-flight M10). */
  copySourceEmails?: readonly string[];
}

/** Why the patch's `assigneeEmail` is refused, or null. ★ Reachable only
 *  through a caller other than the picker: the cell sends the stored value or a
 *  picked resource's stored email, both exempt. Kept so the pane's toast and
 *  this sanitizer judge ONE value with ONE rule. */
export function inlineAssigneeEmailRefusal(patch: Partial<Task>, ctx: InlinePatchContext): EmailRefusal | null {
  if (!("assigneeEmail" in patch)) return null;
  return emailWriteRefusal(sanitizeLoadedEmail(patch.assigneeEmail), ctx.storedAssigneeEmail, ctx.copySourceEmails ?? []);
}

/**
 * Validate an inline field patch. Only keys PRESENT in `patch` are emitted, so
 * the caller can spread the result over the row without clobbering untouched
 * fields. `taskName` is dropped when it sanitizes to empty (identity is never
 * blanked); `resourceId` unlinks (→ undefined) unless it points at a live
 * resource; `dependencies` are re-validated against the live task set.
 */
export function sanitizeInlinePatch(patch: Partial<Task>, ctx: InlinePatchContext): Partial<Task> {
  const clean: Partial<Task> = {};
  if ("taskName" in patch) {
    const name = sanitizeTaskName(patch.taskName);
    if (name) clean.taskName = name; // never blank out the task's identity
  }
  if ("assignee" in patch) clean.assignee = sanitizeAssignee(patch.assignee);
  if ("assigneeEmail" in patch && inlineAssigneeEmailRefusal(patch, ctx) === null) {
    clean.assigneeEmail = sanitizeLoadedEmail(patch.assigneeEmail); // a refused value keeps the stored one
  }
  if ("resourceId" in patch) {
    const rid = patch.resourceId;
    clean.resourceId = typeof rid === "number" && ctx.hasResource(rid) ? rid : undefined;
  }
  if ("startDate" in patch) clean.startDate = sanitizeIsoDate(patch.startDate);
  if ("dueDate" in patch) clean.dueDate = sanitizeIsoDate(patch.dueDate);
  if ("priority" in patch) clean.priority = sanitizePriority(patch.priority);
  if ("description" in patch) clean.description = sanitizeRichHtml(patch.description ?? "");
  if ("blockers" in patch) clean.blockers = sanitizeBlockers(patch.blockers);
  if ("dependencies" in patch) {
    clean.dependencies = sanitizeDependencies(patch.dependencies, ctx.knownTaskIds, ctx.ownTaskId);
  }
  return clean;
}
