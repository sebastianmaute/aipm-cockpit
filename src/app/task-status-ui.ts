// src/app/task-status-ui.ts — status → i18n label key (UI layer; not in the pure engine).
import type { TranslationKey } from "./i18n";
import type { TaskStatus } from "./types";

const STATUS_LABEL_KEY: Record<TaskStatus, TranslationKey> = {
  "To Do": "statusToDo",
  "In Progress": "statusInProgress",
  "On Hold": "statusOnHold",
  "In Review": "statusInReview",
  "Cancelled": "statusCancelled",
  "Done": "statusDone",
};

export function statusLabelKey(s: TaskStatus): TranslationKey {
  return STATUS_LABEL_KEY[s];
}

// Badge tints for the workflow-status column. Sanctioned AIPM palette tokens
// ONLY (see globals.css) — mirrors the priority badge style in task-row.tsx.
// To Do is neutral-muted; In Progress carries the blue working tint; On Hold
// uses purple; In Review uses pink (kept distinct from In Progress); Cancelled
// is muted + struck through; Done is green.
const STATUS_BADGE_CLASS: Record<TaskStatus, string> = {
  "To Do": "bg-surface-muted text-muted-foreground",
  "In Progress": "bg-AIPM-blue/15 text-AIPM-dark-blue dark:bg-AIPM-blue/20 dark:text-AIPM-light-grey",
  "On Hold": "bg-AIPM-purple/15 text-AIPM-dark-blue dark:bg-AIPM-purple/20 dark:text-AIPM-light-grey",
  "In Review": "bg-AIPM-pink/15 text-AIPM-dark-blue dark:bg-AIPM-pink/20 dark:text-AIPM-light-grey",
  "Cancelled": "bg-surface-muted text-muted-foreground line-through",
  "Done": "bg-AIPM-green/15 text-AIPM-dark-blue dark:bg-AIPM-green/20 dark:text-AIPM-light-grey",
};

export function statusBadgeClass(s: TaskStatus): string {
  return STATUS_BADGE_CLASS[s];
}
