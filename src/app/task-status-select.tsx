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

interface TaskStatusSelectProps {
  lang: Lang;
  task: Pick<Task, "id" | "taskName" | "status" | "jiraKey">;
  onStatusChange: (id: number, next: TaskStatus) => void;
}

export function TaskStatusSelect({ lang, task, onStatusChange }: TaskStatusSelectProps) {
  const synced = isJiraSynced(task);
  return (
    <select
      aria-label={`${t(lang, "colTaskStatus")} – ${task.taskName}`}
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
