"use client";
// src/app/task-kanban-card.tsx — rich, compact card for the Kanban board.
// Mirrors the essentials task-row.tsx shows in the table (priority, health,
// Jira/RAID/change badges) but laid out for a narrow column. The status
// <select> and badges are shared with the row via TaskStatusSelect / RaidBadge.
import { SparklesIcon } from "./icons";
import { type Lang, priorityLabel, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { computeTaskHealth, formatHealthTooltip, type TaskHealth } from "./health";
import { RagDot } from "./rag-dot";
import { isTaskFinished } from "./task-status";
import { Badge } from "./badge";
import { JiraBadge } from "./task-jira-badge";
import { isJiraSynced } from "./jira-status-map";
import { RaidBadge } from "./task-raid-badge";
import { DocumentBadge } from "./document-badge";
import { refKey } from "./document-ref";
import type { ProjectDocument } from "./document-model";
import { priorityStyle } from "./task-status-ui";
import { TaskStatusSelect } from "./task-status-select";
import { effectiveAssignee, resourceDisplayName } from "./resource-foundation";
import { Select } from "./form-controls";
import { rowLabel } from "./row-tokens";
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
  /** This card's row-unique display token, from the board's `tokens` map.
   *  ★ PROPS, never context — the board renders cards OUTSIDE RowContextProvider. */
  rowToken: string;
  raidRefs?: RaidItem[];
  changeRefs?: ChangeItem[];
  /** ★★ PROPS, never context: the board renders cards OUTSIDE RowContextProvider
   *  and `useWorkspaceTab` throws without a provider. Optional so lightweight
   *  callers/tests can omit them — no badge renders then. */
  documentsByEntity?: ReadonlyMap<string, readonly ProjectDocument[]>;
  onOpenDocuments?: (taskId: number) => void;
  onStatusChange: (id: number, next: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onJumpToRaid: (taskId: number) => void;
  readOnlyProject?: boolean;
  /** Inline "Ask Claude" task edit (SP1 board wiring). Optional so lightweight
   *  callers/tests can omit them (mirrors task-row.tsx's context-driven gate). */
  onAiEdit?: (task: Task) => void;
  aiEditEnabled?: (task: Task) => boolean;
  /** Swimlane keyboard assign path. Both must be passed to render the control;
   *  the board (1-D) passes neither. */
  assignableResources?: readonly Resource[];
  onAssign?: (taskId: number, resourceId: number | null) => void;
}

export function TaskKanbanCard({
  lang,
  task,
  today,
  holidaySet,
  resourcesById,
  rowToken,
  raidRefs,
  changeRefs,
  documentsByEntity,
  onOpenDocuments,
  onStatusChange,
  onEdit,
  onJumpToRaid,
  readOnlyProject,
  onAiEdit,
  aiEditEnabled,
  assignableResources,
  onAssign,
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
          // ★★★ Without this the accessible name is the CONTENT — two cards
          // named "Alpha" render two identically-named buttons, on the most
          // prominent control on the card. Mirrors task-row.tsx's name button.
          // 2.5.3 holds by CONTAINMENT: visible "Alpha" sits inside the token
          // "Alpha (1)". Set unconditionally — with no collision the token IS
          // the bare name, so this restates the content rather than changing
          // behaviour.
          aria-label={rowToken}
          title={`${task.taskName} — ${t(lang, "clickToEdit")}`}
          className={`cursor-pointer rounded-md border border-transparent px-1 text-left font-medium text-foreground hover:border-ui-dark-blue hover:bg-surface ${INTERACTIVE}`}
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
        <DocumentBadge
          lang={lang}
          count={documentsByEntity?.get(refKey("task", task.id))?.length ?? 0}
          entityTitle={rowToken}
          onOpen={() => onOpenDocuments?.(task.id)}
        />
        {changeRefs && changeRefs.length > 0 && (
          <span
            title={changesLabel}
            aria-label={changesLabel}
            className="inline-flex items-center rounded bg-ui-blue/15 px-1.5 py-0.5 text-[10px] font-medium text-ui-dark-blue dark:bg-ui-blue/20 dark:text-ui-light-grey"
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
            className={overdue ? "font-medium text-ui-pink-strong" : ""}
          >
            {task.dueDate}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-1.5">
        <TaskStatusSelect lang={lang} task={task} rowToken={rowToken} onStatusChange={onStatusChange} />
        {aiEditEnabled?.(task) && (
          <button
            type="button"
            onClick={() => onAiEdit?.(task)}
            aria-label={rowLabel(t(lang, "inlineAiEdit"), rowToken)}
            title={t(lang, "inlineAiEdit")}
            className={`rounded-md px-1.5 text-ui-dark-blue opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-ui-dark-blue dark:text-ui-light-grey ${INTERACTIVE}`}
          >
            <SparklesIcon aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>

      {onAssign && assignableResources && !isJiraSynced(task) && (
        <Select
          size="xs"
          value={task.resourceId ?? ""}
          aria-label={t(lang, "assignPersonLabel", rowToken)}
          onChange={(e) => onAssign(task.id, e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{t(lang, "swimlaneUnassigned")}</option>
          {assignableResources.map((r) => (
            <option key={r.id} value={r.id}>
              {resourceDisplayName(r)}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
