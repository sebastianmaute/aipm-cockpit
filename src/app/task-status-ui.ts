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
