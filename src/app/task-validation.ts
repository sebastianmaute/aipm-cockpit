// src/app/task-validation.ts
//
// Pure, per-field validation for the task form. Single source of truth shared by
// the submit handler (use-task-submit.ts), the inline per-field error display
// (task-form-fields.tsx), and submit gating (the Save button's disabled state).
// Returns i18n message KEYS keyed by form field — no rendering, no i18n
// resolution, no React here.

import { type TaskFormDraft } from "./task-form-context";
import {
  emailWriteRefusal,
  sanitizeAssignee,
  sanitizeIsoDate,
  sanitizeLoadedEmail,
  sanitizeTaskName,
} from "./sanitize";
import { EMAIL_REFUSAL_KEY } from "./email-refusal-i18n";

/** The task-form fields that can carry a validation error. */
export type TaskErrorField = "taskName" | "assignee" | "dueDate" | "assigneeEmail";

/** i18n message keys used for inline task-form errors. */
export type TaskErrorKey =
  | "errorTaskNameRequired"
  | "errorAssigneeRequired"
  | "errorDueDateRequired"
  | "errorPastDate"
  | "errorInvalidEmail"
  | "errorEmailDelimiter";

export type TaskFieldErrors = Partial<Record<TaskErrorField, TaskErrorKey>>;

/**
 * Validate a task-form draft. `today` is an ISO date (YYYY-MM-DD). Mirrors the
 * checks the submit handler enforces, but reported per field instead of as one
 * banner.
 *
 * `isNew` gates the past-date rule ONLY. A due date that has since gone stale
 * must never block editing an existing task — that made every overdue task
 * unsavable, whatever the user was actually changing. Creating a task with a
 * past due date is still refused, which is the case the rule exists for.
 */
export function validateTaskForm(
  form: TaskFormDraft,
  today: string,
  isNew: boolean,
  email: { stored?: string; copySources?: readonly (string | undefined)[] } = {},
): TaskFieldErrors {
  const errors: TaskFieldErrors = {};

  if (!sanitizeTaskName(form.taskName)) errors.taskName = "errorTaskNameRequired";
  if (!sanitizeAssignee(form.assignee)) errors.assignee = "errorAssigneeRequired";

  const dueDate = sanitizeIsoDate(form.dueDate);
  if (!dueDate) errors.dueDate = "errorDueDateRequired";
  else if (isNew && dueDate < today) errors.dueDate = "errorPastDate";

  // A blank email is allowed; a CHANGED one must be write-safe (spec Part 1).
  // M-C4: judged `Name <addr>`-unwrapped, the value `use-task-submit.ts` stores.
  const refusal = emailWriteRefusal(sanitizeLoadedEmail(form.assigneeEmail), email.stored, email.copySources ?? []);
  if (refusal) errors.assigneeEmail = EMAIL_REFUSAL_KEY[refusal];

  return errors;
}

/** True when the draft has at least one validation error (gates submit). */
export function hasTaskErrors(errors: TaskFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
