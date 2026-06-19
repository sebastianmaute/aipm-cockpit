"use client";

import { createContext, memo, useContext, type MouseEvent, type ReactNode } from "react";
import { computeTaskHealth, formatHealthTooltip, healthDot, type TaskHealth } from "./health";
import { priorityLabel, t, type Lang } from "./i18n";
import { formatDuration } from "./duration";
import { RaidBadge } from "./task-raid-badge";
import { priorityStyle } from "./task-status-ui";
import { TaskStatusSelect } from "./task-status-select";
import { type ChangeItem, type Task, type TaskDependency, type TaskStatus, type RaidItem } from "./types";

export interface RowContextValue {
  lang: Lang;
  today: string;
  holidaySet: Set<string>;

  // Flattened from settings.jira so consumers only re-render
  // on Jira-config change, not on unrelated settings changes.
  jiraSiteUrl: string;
  jiraEnabled: boolean;
  jiraProjectKey: string;

  hiddenCols: Set<string>;
  tasksById: Map<number, Task>;

  // Stable callbacks (useCallback'd in TaskManagerInner).
  onToggleSelect: (id: number) => void;
  onToggleNoteExpanded: (id: number) => void;
  onJumpToRaid: (id: number) => void;
  onToggleComplete: (task: Task) => void;
  onSendInquiry: (task: Task) => void;
  onPushToJira: (id: number) => void;
  onStatusChange: (id: number, next: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
}

const RowContext = createContext<RowContextValue | undefined>(undefined);

export function RowContextProvider({
  value,
  children,
}: {
  value: RowContextValue;
  children: ReactNode;
}) {
  return <RowContext.Provider value={value}>{children}</RowContext.Provider>;
}

export function useTaskRowContext(): RowContextValue {
  const ctx = useContext(RowContext);
  if (!ctx)
    throw new Error("useTaskRowContext must be used within RowContext.Provider");
  return ctx;
}

// Marker re-export so TaskRow consumers can pass a typed `RaidItem[]` prop
// without importing from `./types` separately.
export type { RaidItem };

const NOTES_COLLAPSED_MAX = 50;

/**
 * Produce a one-line summary of a note for the collapsed Notes cell.
 *
 * Rules (in order):
 *   1. Take only the first line — anything past the first `\n` is hidden.
 *   2. If that line fits within `maxLen`, show it as-is (still flagged as
 *      truncated when there were more lines hidden below).
 *   3. Otherwise, cut at the last whitespace ≤ maxLen so we never split mid-word.
 *      Fall back to a hard slice only when the first word itself is too long.
 */
function summarizeNote(
  notes: string,
  maxLen: number,
): { text: string; truncated: boolean } {
  if (!notes) return { text: "", truncated: false };

  const newlineIdx = notes.search(/\r?\n/);
  const firstLine = newlineIdx >= 0 ? notes.slice(0, newlineIdx) : notes;
  const hasMoreLines = firstLine.length < notes.length;

  if (firstLine.length <= maxLen) {
    return { text: firstLine, truncated: hasMoreLines };
  }

  const window = firstLine.slice(0, maxLen + 1);
  const lastWs = window.search(/\s\S*$/);
  const cut = lastWs > Math.floor(maxLen / 2) ? lastWs : maxLen;
  return { text: firstLine.slice(0, cut).trimEnd(), truncated: true };
}

/**
 * Build the Jira browse URL only when siteUrl parses to an http(s) origin.
 * Without this guard, a user-supplied siteUrl like "javascript:..." would
 * render as an executable href.
 */
function safeJiraIssueHref(siteUrl: string, key: string): string | null {
  try {
    const u = new URL(siteUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.origin}/browse/${encodeURIComponent(key)}`;
  } catch {
    return null;
  }
}

function Td({
  children,
  className,
  title,
  stopClick,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  /** Keep a click inside this cell from bubbling to the row's row-click
   *  handler (e.g. the inline status dropdown). */
  stopClick?: boolean;
}) {
  const onClick = stopClick
    ? (e: MouseEvent<HTMLTableCellElement>) => e.stopPropagation()
    : undefined;
  return <td title={title} onClick={onClick} className={`px-4 py-3 ${className ?? ""}`}>{children}</td>;
}

interface TaskRowProps {
  task: Task;
  isSelected: boolean;
  isEditing: boolean;
  isExpanded: boolean;
  isPushing: boolean;
  raidRefs: RaidItem[] | undefined;
  changeRefs?: ChangeItem[];
  isStriped?: boolean;
}

function TaskRowImpl({
  task,
  isSelected,
  isEditing,
  isExpanded,
  isPushing,
  raidRefs,
  changeRefs,
  isStriped = false,
}: TaskRowProps) {
  const {
    lang,
    today,
    holidaySet,
    jiraSiteUrl,
    hiddenCols,
    onToggleSelect,
    onStatusChange,
    onEdit,
  } = useTaskRowContext();

  const isComplete = !!task.completedDate;
  const health: TaskHealth = computeTaskHealth(task, today, holidaySet);
  const label = isComplete
    ? t(lang, "completedOn", task.completedDate!)
    : formatHealthTooltip(health, lang);

  // Precedence: editing > selected > completed > zebra stripe. The selected
  // branch intentionally drops the stripe — full-opacity bg-surface-muted
  // already covers the /40 tint.
  const stateClass = isEditing
    ? "bg-AIPM-purple/10 dark:bg-AIPM-purple/15"
    : isSelected
      ? "bg-surface-muted"
      : isComplete
        ? // Completed rows are signalled by the strikethrough title + a muted
          // tint — NOT `opacity`, which dims all text/badges below the WCAG AA
          // contrast threshold (axe flagged the whole row).
          "bg-surface-muted/60"
        : isStriped
          ? "bg-surface-muted/40"
          : "";

  return (
    <tr className={`align-top ${stateClass}`}>
      <Td>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(task.id)}
          aria-label={t(lang, "selectRow", task.id)}
          className="h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green dark:border-line"
        />
      </Td>
      {!hiddenCols.has("status") && (
        <Td>
          {isComplete && !task.healthOverride ? (
            <span role="img" title={label} aria-label={label} className="text-AIPM-green-strong">✓</span>
          ) : (
            <span role="img" title={label} aria-label={label} className={`inline-block h-2.5 w-2.5 rounded-full ${healthDot[health.color]}`} />
          )}
        </Td>
      )}
      {!hiddenCols.has("id") && <Td className="font-mono text-muted-foreground">
        <button
          type="button"
          onClick={() => onEdit(task)}
          title={`#${task.id} — ${t(lang, "clickToEdit")}`}
          aria-label={`#${task.id} — ${t(lang, "clickToEdit")}`}
          className="cursor-pointer rounded-md border border-transparent px-2 py-0.5 font-mono text-muted-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted"
        >#{task.id}</button>
        {(() => {
          if (!task.jiraKey || !jiraSiteUrl) return null;
          const href = safeJiraIssueHref(jiraSiteUrl, task.jiraKey);
          if (!href) return null;
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={
                task.jiraIssueType
                  ? `${task.jiraKey} (${task.jiraIssueType})`
                  : task.jiraKey
              }
              className="ml-1 inline-block rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-AIPM-dark-blue no-underline hover:bg-AIPM-dark-blue hover:text-white dark:text-AIPM-blue dark:hover:bg-AIPM-dark-blue dark:hover:text-white"
            >
              {task.jiraKey}
            </a>
          );
        })()}
        {raidRefs && raidRefs.length > 0 && (
          <RaidBadge taskId={task.id} refs={raidRefs} />
        )}
        {changeRefs && changeRefs.length > 0 && (
          <span
            title={t(lang, "taskRowChangesBadge", changeRefs.length)}
            aria-label={t(lang, "taskRowChangesBadge", changeRefs.length)}
            className="ml-1 inline-flex items-center rounded bg-AIPM-blue/15 px-1.5 py-0.5 text-[10px] font-medium text-AIPM-dark-blue dark:bg-AIPM-blue/20 dark:text-AIPM-light-grey"
          >
            {t(lang, "taskRowChangesBadge", changeRefs.length)}
          </span>
        )}
      </Td>}
      <Td
        className={`font-medium text-foreground ${isComplete ? "line-through" : ""}`}
      >
        <button
          type="button"
          onClick={() => onEdit(task)}
          title={`${task.taskName} — ${t(lang, "clickToEdit")}`}
          className="cursor-pointer rounded-md border border-transparent px-2 py-0.5 text-left font-medium hover:border-AIPM-dark-blue hover:bg-surface-muted"
        >{task.taskName}</button>
        {(task.group || (task.labels?.length ?? 0) > 0) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {task.group && (
              <span className="inline-flex rounded-md bg-AIPM-dark-blue/10 px-1.5 py-0.5 text-[10px] font-medium text-AIPM-dark-blue dark:bg-AIPM-dark-blue/30 dark:text-AIPM-light-grey">
                {task.group}
              </span>
            )}
            {(task.labels ?? []).map((l) => (
              <span
                key={l}
                className="inline-flex rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground"
              >
                {l}
              </span>
            ))}
          </div>
        )}
      </Td>
      {!hiddenCols.has("assignee") && (
        <Td title={`${t(lang, "assignee")}: ${task.assignee || "—"}`}>
          {task.assignee || "—"}
        </Td>
      )}
      {!hiddenCols.has("startDate") && (
        <Td className="whitespace-nowrap text-muted-foreground" title={`${t(lang, "startDate")}: ${task.startDate || "—"}`}>
          {task.startDate || "—"}
        </Td>
      )}
      {!hiddenCols.has("dueDate") && <Td title={`${t(lang, "dueDate")}: ${task.dueDate || "—"}`}>{task.dueDate}</Td>}
      {!hiddenCols.has("lastUpdateDate") && <Td title={`${t(lang, "lastUpdateDate")}: ${task.lastUpdateDate || "—"}`}>{task.lastUpdateDate}</Td>}
      {!hiddenCols.has("priority") && (
        <Td>
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${priorityStyle[task.priority]}`}>
            {priorityLabel(lang, task.priority)}
          </span>
        </Td>
      )}
      {!hiddenCols.has("taskStatus") && (
        <Td stopClick>
          <TaskStatusSelect lang={lang} task={task} onStatusChange={onStatusChange} />
        </Td>
      )}
      {!hiddenCols.has("blockers") && (
        <Td className="max-w-xs whitespace-pre-wrap text-muted-foreground">
          {task.blockers || "—"}
        </Td>
      )}
      {!hiddenCols.has("notes") && (
        <Td className="max-w-xs text-muted-foreground">
          <NotesCell notes={task.notes ?? ""} isExpanded={isExpanded} taskId={task.id} />
        </Td>
      )}
      {!hiddenCols.has("depRelations") && (
        <Td className="text-muted-foreground">
          <DependencyChips deps={task.dependencies ?? []} />
        </Td>
      )}
      {!hiddenCols.has("estimate") && (
        <Td className="text-right font-mono text-muted-foreground">
          {formatDuration(task.originalEstimateMinutes ?? 0) || "—"}
        </Td>
      )}
      {!hiddenCols.has("spent") && (
        <Td className="text-right font-mono text-muted-foreground">
          {formatDuration(task.timeSpentMinutes ?? 0) || "—"}
        </Td>
      )}
      <Td>
        <TaskActions task={task} isPushing={isPushing} />
      </Td>
    </tr>
  );
}

export const TaskRow = memo(TaskRowImpl);

interface NotesCellProps {
  notes: string;
  isExpanded: boolean;
  taskId: number;
}

function NotesCellImpl({ notes, isExpanded, taskId }: NotesCellProps) {
  const { lang, onToggleNoteExpanded } = useTaskRowContext();
  if (!notes) return <span>—</span>;
  const summary = summarizeNote(notes, NOTES_COLLAPSED_MAX);
  const displayed = isExpanded
    ? notes
    : summary.text + (summary.truncated ? " …" : "");
  return (
    <div className="flex flex-col gap-1">
      <span className={isExpanded ? "whitespace-pre-wrap" : "whitespace-normal"}>
        {displayed}
      </span>
      {summary.truncated && (
        <button
          type="button"
          onClick={() => onToggleNoteExpanded(taskId)}
          className="self-start text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue"
          aria-expanded={isExpanded}
        >
          {isExpanded ? t(lang, "showLess") : t(lang, "showMore")}
        </button>
      )}
    </div>
  );
}

export const NotesCell = memo(NotesCellImpl);

interface TaskActionsProps {
  task: Task;
  isPushing: boolean;
}

function TaskActionsImpl({ task, isPushing }: TaskActionsProps) {
  const {
    lang,
    jiraEnabled,
    jiraProjectKey,
    onToggleComplete,
    onSendInquiry,
    onPushToJira,
    onEdit,
    onDelete,
  } = useTaskRowContext();
  return (
    <div className="flex flex-col gap-1 whitespace-nowrap">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onToggleComplete(task)}
          className="text-xs font-medium text-AIPM-green-strong underline-offset-2 hover:underline"
        >
          {task.completedDate ? t(lang, "reopenTask") : t(lang, "markComplete")}
        </button>
        {!task.completedDate && (
          <button
            type="button"
            onClick={() => onSendInquiry(task)}
            className="text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue"
          >
            {t(lang, "sendInquiry")}
          </button>
        )}
        {jiraEnabled && jiraProjectKey && !task.jiraKey && !task.completedDate && (
          <button
            type="button"
            onClick={() => onPushToJira(task.id)}
            disabled={isPushing}
            className="text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-AIPM-blue"
          >
            {isPushing ? t(lang, "jiraPushing") : t(lang, "jiraPushToJira")}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onEdit(task)}
          className="text-xs font-medium text-foreground underline-offset-2 hover:underline"
        >
          {t(lang, "edit")}
        </button>
        <button
          type="button"
          onClick={() => onDelete(task.id)}
          className="text-xs font-medium text-AIPM-pink-strong underline-offset-2 hover:underline"
        >
          {t(lang, "delete")}
        </button>
      </div>
    </div>
  );
}

export const TaskActions = memo(TaskActionsImpl);

interface DependencyChipsProps {
  deps: TaskDependency[];
}

function DependencyChipsImpl({ deps }: DependencyChipsProps) {
  const { lang, tasksById } = useTaskRowContext();
  if (deps.length === 0) return <span>—</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {deps.map((dep, i) => {
        const pred = tasksById.get(dep.taskId);
        const predName = pred?.taskName ?? t(lang, "depMissing");
        return (
          <li key={`dep-${dep.taskId}-${dep.type}-${i}`}>
            <span
              title={`${t(lang, "depDependsOn")} #${dep.taskId} (${dep.type}) — ${predName}`}
              className="inline-flex items-center gap-0.5 rounded-full bg-AIPM-blue/15 px-1.5 py-0.5 text-[10px] font-medium text-AIPM-dark-blue dark:bg-AIPM-blue/25 dark:text-AIPM-light-grey"
            >
              <span className="font-mono">{dep.type}</span>
              <span className="opacity-70">·</span>
              <span className="font-mono">#{dep.taskId}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const DependencyChips = memo(DependencyChipsImpl);

