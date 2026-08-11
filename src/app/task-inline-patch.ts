// Pure sanitizer for Open-Points inline cell edits.
//
// Each editable cell emits a single-field `Partial<Task>` patch; this collapses
// them through the same per-field validators the form-save path uses, so an
// inline edit can never write an unsanitized value. Kept i18n-free and pure so
// it is unit-testable without rendering the tasks pane (the React handler in
// tasks-section just supplies the live resource/task id sets).
import {
  sanitizeAssignee,
  sanitizeBlockers,
  sanitizeDependencies,
  sanitizeEmail,
  sanitizeIsoDate,
  sanitizePriority,
  sanitizeTaskName,
} from "./sanitize";
import { sanitizeRichHtml } from "./sanitize-html";
import type { Task } from "./types";

export interface InlinePatchContext {
  /** True when the id points at a live directory resource (FK validation). */
  hasResource: (id: number) => boolean;
  /** Ids of all live tasks — dependency targets must exist. */
  knownTaskIds: ReadonlySet<number>;
  /** The task being edited (self-dependency guard). */
  ownTaskId: number;
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
  if ("assigneeEmail" in patch) clean.assigneeEmail = sanitizeEmail(patch.assigneeEmail);
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
