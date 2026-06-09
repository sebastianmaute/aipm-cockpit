// src/app/task-validation.ts
//
// Pure, per-field validation for the task form. Single source of truth shared by
// the submit handler (use-task-submit.ts), the inline per-field error display
// (task-form-fields.tsx), and submit gating (the Save button's disabled state).
// Returns i18n message KEYS keyed by form field — no rendering, no i18n
// resolution, no React here.

import { type TaskFormDraft } from "./task-form-context";
import {
  isValidEmail,
  sanitizeAssignee,
  sanitizeEmail,
  sanitizeIsoDate,
  sanitizeTaskName,
} from "./sanitize";

/** The task-form fields that can carry a validation error. */
export type TaskErrorField = "taskName" | "assignee" | "dueDate" | "assigneeEmail";

/** i18n message keys used for inline task-form errors. */
export type TaskErrorKey =
  | "errorTaskNameRequired"
  | "errorAssigneeRequired"
  | "errorDueDateRequired"
  | "errorPastDate"
  | "errorInvalidEmail";

export type TaskFieldErrors = Partial<Record<TaskErrorField, TaskErrorKey>>;

/**
 * Validate a task-form draft. `today` is an ISO date (YYYY-MM-DD); a due date
 * earlier than it is rejected. Mirrors the checks the submit handler enforces,
 * but reported per field instead of as one banner.
 */
export function validateTaskForm(form: TaskFormDraft, today: string): TaskFieldErrors {
  const errors: TaskFieldErrors = {};

  if (!sanitizeTaskName(form.taskName)) errors.taskName = "errorTaskNameRequired";
  if (!sanitizeAssignee(form.assignee)) errors.assignee = "errorAssigneeRequired";

  const dueDate = sanitizeIsoDate(form.dueDate);
  if (!dueDate) errors.dueDate = "errorDueDateRequired";
  else if (dueDate < today) errors.dueDate = "errorPastDate";

  // A blank email is allowed (the field is optional); a non-empty one must parse.
  const email = sanitizeEmail(form.assigneeEmail);
  if (email && !isValidEmail(email)) errors.assigneeEmail = "errorInvalidEmail";

  return errors;
}

/** True when the draft has at least one validation error (gates submit). */
export function hasTaskErrors(errors: TaskFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
