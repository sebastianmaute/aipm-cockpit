"use client";
// src/app/task-kanban-card.tsx — rich, compact card for the Kanban board.
// Mirrors the essentials task-row.tsx shows in the table (priority, health,
// Jira/RAID/change badges) but laid out for a narrow column. The status
// <select> and badges are shared with the row via TaskStatusSelect / RaidBadge.
import { type Lang, priorityLabel, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { computeTaskHealth, formatHealthTooltip, type TaskHealth } from "./health";
import { RagDot } from "./rag-dot";
import { isTaskFinished } from "./task-status";
import { Badge } from "./badge";
import { JiraBadge } from "./task-jira-badge";
import { RaidBadge } from "./task-raid-badge";
import { priorityStyle } from "./task-status-ui";
import { TaskStatusSelect } from "./task-status-select";
import { effectiveAssignee } from "./resource-foundation";
import type { ChangeItem, RaidItem, Resource, Task, TaskStatus } from "./types";

const EMPTY_RESOURCE_LOOKUP: ReadonlyMap<number, Resource> = new Map();

interface TaskKanbanCardProps {
  lang: Lang;
  task: Task;
  today: string;
  holidaySet: Set<string>;
  /** Directory lookup (id -> Resource) for resolving the LIVE assignee name of
   *  a linked task; the stored `assignee` cache goes stale after a rename.
   *  Optional (defaults empty) so lightweight callers/tests can omit it. */
  resourcesById?: ReadonlyMap<number, Resource>;
  raidRefs?: RaidItem[];
  changeRefs?: ChangeItem[];
  onStatusChange: (id: number, next: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onJumpToRaid: (taskId: number) => void;
  readOnlyProject?: boolean;
  /** Inline "Ask Claude" task edit (SP1 board wiring). Optional so lightweight
   *  callers/tests can omit them (mirrors task-row.tsx's context-driven gate). */
  onAiEdit?: (task: Task) => void;
  aiEditEnabled?: (task: Task) => boolean;
}

export function TaskKanbanCard({
  lang,
  task,
  today,
  holidaySet,
  resourcesById,
  raidRefs,
  changeRefs,
  onStatusChange,
  onEdit,
  onJumpToRaid,
  readOnlyProject,
  onAiEdit,
  aiEditEnabled,
}: TaskKanbanCardProps) {
  // Linked tasks show the resource's LIVE name; the stored `assignee` cache can
  // be stale after a rename/re-link (falls back to the cache when unlinked).
  const assigneeName = effectiveAssignee(task, resourcesById ?? EMPTY_RESOURCE_LOOKUP);
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
        <RagDot level={health.color} size="md" className="mt-1" label={healthTip} />
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
        <Badge pill className={`font-medium ${priorityClass}`}>
          {priorityLabel(lang, task.priority)}
        </Badge>
        {task.jiraKey && <JiraBadge jiraKey={task.jiraKey} lang={lang} readOnlyProject={readOnlyProject} />}
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
        <span title={`${t(lang, "assignee")}: ${assigneeName || "—"}`}>{assigneeName || "—"}</span>
        {task.dueDate && (
          <span
            title={`${t(lang, "dueDate")}: ${task.dueDate}`}
            className={overdue ? "font-medium text-AIPM-pink-strong" : ""}
          >
            {task.dueDate}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-1.5">
        <TaskStatusSelect lang={lang} task={task} onStatusChange={onStatusChange} />
        {aiEditEnabled?.(task) && (
          <button
            type="button"
            onClick={() => onAiEdit?.(task)}
            aria-label={`${t(lang, "inlineAiEdit")} – ${task.taskName}`}
            title={t(lang, "inlineAiEdit")}
            className={`rounded-md px-1.5 text-AIPM-dark-blue opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-AIPM-dark-blue dark:text-AIPM-light-grey ${INTERACTIVE}`}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path d="M10 2l1.6 4.4L16 8l-4.4 1.6L10 14l-1.6-4.4L4 8l4.4-1.6L10 2z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
