"use client";
import { type Lang, t } from "./i18n";
import type { TaskStatus } from "./types";
import { statusBadgeClass, statusLabelKey } from "./task-status-ui";

// Workflow-status badge for the task table. Non-interactive (just a span), so
// it carries no per-row accessible name — the translated label is its text.
export function TaskStatusBadge({ status, lang }: { status: TaskStatus; lang: Lang }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(status)}`}
    >
      {t(lang, statusLabelKey(status))}
    </span>
  );
}
