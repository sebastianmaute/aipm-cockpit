"use client";
// src/app/task-status-select.tsx — shared inline task-status <select>.
// Used by BOTH the table row (task-row.tsx) and the Kanban card
// (task-kanban-card.tsx) so the disabled-when-Jira-synced + row-unique
// accessible-name behaviour lives in one place.
import { type Lang, t } from "./i18n";
import { TASK_STATUSES, type Task, type TaskStatus } from "./types";
import { statusBadgeClass, statusLabelKey } from "./task-status-ui";
import { isJiraSynced } from "./jira-status-map";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { rowLabel } from "./row-tokens";

interface TaskStatusSelectProps {
  lang: Lang;
  task: Pick<Task, "id" | "taskName" | "status" | "jiraKey">;
  /** ★★ REQUIRED, deliberately. An optional prop defaulting to `task.taskName`
   *  inside this component would compile at a caller that forgot it and ship
   *  the collision silently; required means tsc enumerates the misses. The
   *  fallback lives at the LIST owner, where the map lookup happens. */
  rowToken: string;
  onStatusChange: (id: number, next: TaskStatus) => void;
}

export function TaskStatusSelect({ lang, task, rowToken, onStatusChange }: TaskStatusSelectProps) {
  const synced = isJiraSynced(task);
  return (
    <select
      aria-label={rowLabel(t(lang, "colTaskStatus"), rowToken)}
      value={task.status}
      disabled={synced}
      title={synced ? t(lang, "jiraManagedTooltip") : undefined}
      onChange={(e) => onStatusChange(task.id, e.target.value as TaskStatus)}
      className={`rounded border border-line px-1.5 py-0.5 text-xs font-medium ${statusBadgeClass(task.status)} hover:border-ui-dark-blue ${FOCUS_RING} ${TRANSITION}`}
    >
      {TASK_STATUSES.map((s) => (
        <option key={s} value={s}>{t(lang, statusLabelKey(s))}</option>
      ))}
    </select>
  );
}
