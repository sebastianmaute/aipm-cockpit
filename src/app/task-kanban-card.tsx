"use client";
// src/app/task-kanban-card.tsx — rich, compact card for the Kanban board.
// Mirrors the essentials task-row.tsx shows in the table (priority, health,
// Jira/RAID/change badges) but laid out for a narrow column. The status
// <select> and badges are shared with the row via TaskStatusSelect / RaidBadge.
import { type Lang, priorityLabel, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { computeTaskHealth, formatHealthTooltip, healthDot, type TaskHealth } from "./health";
import { isTaskFinished } from "./task-status";
import { JiraBadge } from "./task-jira-badge";
import { RaidBadge } from "./task-raid-badge";
import { priorityStyle } from "./task-status-ui";
import { TaskStatusSelect } from "./task-status-select";
import type { ChangeItem, RaidItem, Task, TaskStatus } from "./types";

interface TaskKanbanCardProps {
  lang: Lang;
  task: Task;
  today: string;
  holidaySet: Set<string>;
  raidRefs?: RaidItem[];
  changeRefs?: ChangeItem[];
  onStatusChange: (id: number, next: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onJumpToRaid: (taskId: number) => void;
}

export function TaskKanbanCard({
  lang,
  task,
  today,
  holidaySet,
  raidRefs,
  changeRefs,
  onStatusChange,
  onEdit,
  onJumpToRaid,
}: TaskKanbanCardProps) {
  const health: TaskHealth = computeTaskHealth(task, today, holidaySet);
  const healthTip = formatHealthTooltip(health, lang);
  const overdue = !!task.dueDate && task.dueDate < today && !isTaskFinished(task);
  // Legacy/partial tasks may carry an unset priority; fall back to the Medium
  // style rather than emitting an `undefined` class.
  const priorityClass = priorityStyle[task.priority] ?? priorityStyle.Medium;
  const changesLabel =
    changeRefs && changeRefs.length > 0
      ? t(lang, "taskRowChangesBadge", changeRefs.length)
      : "";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-1.5">
        <span
          role="img"
          title={healthTip}
          aria-label={healthTip}
          className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${healthDot[health.color]}`}
        />
        <button
          type="button"
          onClick={() => onEdit(task)}
          title={`${task.taskName} — ${t(lang, "clickToEdit")}`}
          className={`cursor-pointer rounded-md border border-transparent px-1 text-left font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface ${INTERACTIVE}`}
        >
          {task.taskName}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${priorityClass}`}>
          {priorityLabel(lang, task.priority)}
        </span>
        {task.jiraKey && <JiraBadge jiraKey={task.jiraKey} lang={lang} />}
        {raidRefs && raidRefs.length > 0 && (
          <RaidBadge taskId={task.id} refs={raidRefs} lang={lang} onJumpToRaid={onJumpToRaid} />
        )}
        {changeRefs && changeRefs.length > 0 && (
          <span
            title={changesLabel}
            aria-label={changesLabel}
            className="inline-flex items-center rounded bg-AIPM-blue/15 px-1.5 py-0.5 text-[10px] font-medium text-AIPM-dark-blue dark:bg-AIPM-blue/20 dark:text-AIPM-light-grey"
          >
            {changesLabel}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-muted-foreground">
        <span title={`${t(lang, "assignee")}: ${task.assignee || "—"}`}>{task.assignee || "—"}</span>
        {task.dueDate && (
          <span
            title={`${t(lang, "dueDate")}: ${task.dueDate}`}
            className={overdue ? "font-medium text-AIPM-pink-strong" : ""}
          >
            {task.dueDate}
          </span>
        )}
      </div>

      <TaskStatusSelect lang={lang} task={task} onStatusChange={onStatusChange} />
    </div>
  );
}
