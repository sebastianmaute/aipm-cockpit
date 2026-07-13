"use client";

import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { computeTaskHealth, formatHealthTooltip, healthDot, type TaskHealth } from "./health";
import { priorityLabel, t, type Lang } from "./i18n";
import { formatDuration } from "./duration";
import { isReadOnlyIssue } from "./jira-projects";
import type { JiraExtraProject } from "./settings-types";
import { JiraBadge } from "./task-jira-badge";
import { RaidBadge } from "./task-raid-badge";
import { priorityStyle } from "./task-status-ui";
import { TaskStatusSelect } from "./task-status-select";
import { flashOutlineClass } from "./use-deeplink-row-flash";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";
import { useInlineCellEdit, type InlineField } from "./use-inline-cell-edit";
import { effectiveAssignee } from "./resource-foundation";
import { ResourcePicker, type ResourcePickerValue } from "./resource-picker";
import { DependenciesEditor } from "./dependencies-editor";
import { usePopoverDismiss } from "./use-popover-dismiss";
import type { Contact } from "./contacts";
import { PRIORITIES, type ChangeItem, type Priority, type Resource, type Task, type TaskDependency, type TaskStatus, type RaidItem } from "./types";

export interface RowContextValue {
  lang: Lang;
  today: string;
  holidaySet: Set<string>;

  // Flattened from settings.jira so consumers only re-render
  // on Jira-config change, not on unrelated settings changes.
  jiraSiteUrl: string;
  jiraExtraProjects: readonly JiraExtraProject[];
  jiraEnabled: boolean;
  jiraProjectKey: string;

  hiddenCols: Set<string>;

  // Stable callbacks (useCallback'd in TaskManagerInner).
  onToggleSelect: (id: number) => void;
  onToggleNoteExpanded: (id: number) => void;
  onJumpToRaid: (id: number) => void;
  onSendInquiry: (task: Task) => void;
  onPushToJira: (id: number) => void;
  onStatusChange: (id: number, next: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
  // Inline "Ask Claude" task edit (SP1): per-row trigger + its enablement gate,
  // threaded from the single useInlineAiEdit instance in TasksSection.
  onAiEdit: (task: Task) => void;
  aiEditEnabled: (task: Task) => boolean;
  // Inline Open-Points cell editing: applies a sanitized field patch to one task
  // (functional setter + localModifiedAt stamp on the pane side). Jira-synced
  // rows are skipped there (read-only) and render no inline affordance here.
  onInlinePatch: (taskId: number, patch: Partial<Task>) => void;
  // Directory lookup (id -> Resource) for resolving the LIVE assignee name of a
  // linked task. The stored `assignee` string is only a cache and goes stale
  // after a resource rename/re-link, so linked rows render the resource's
  // current name instead. Built once (useMemo) on the pane side.
  resourcesById: ReadonlyMap<number, Resource>;
  // Full directory list for the inline assignee ResourcePicker (dropdown of
  // resources + free-text). Reference-stable from the pane; contacts are NOT
  // threaded (inline picker suggests directory resources only).
  resources: readonly Resource[];
}

const RowContext = createContext<RowContextValue | undefined>(undefined);

// `tasksById` lives in its OWN context, split out of RowContextValue: it gets a
// brand-new Map on ANY task edit (audit #6/#32), so bundling it into the main
// value would re-render every row on every edit. Only the dependency-chip cell
// reads the lookup, so only it re-renders when the map changes; the main value
// stays reference-stable and unchanged rows are skipped by their React.memo.
const RowLookupContext = createContext<Map<number, Task> | undefined>(undefined);

/** Stable shared empty lookup for callers that render no dependency chips. */
const EMPTY_TASK_LOOKUP: Map<number, Task> = new Map();

/** Inline assignee picker suggests directory resources + free text only — no
 *  contacts are threaded into the row, so a stable empty list is passed. */
const EMPTY_CONTACTS: Contact[] = [];

/** Stable empty task list for a closed relations popover (the predecessor list
 *  is only materialised while the popover is open). */
const EMPTY_TASKS: readonly Task[] = [];

export function RowContextProvider({
  value,
  tasksById = EMPTY_TASK_LOOKUP,
  children,
}: {
  value: RowContextValue;
  tasksById?: Map<number, Task>;
  children: ReactNode;
}) {
  return (
    <RowContext.Provider value={value}>
      <RowLookupContext.Provider value={tasksById}>{children}</RowLookupContext.Provider>
    </RowContext.Provider>
  );
}

export function useTaskRowContext(): RowContextValue {
  const ctx = useContext(RowContext);
  if (!ctx)
    throw new Error("useTaskRowContext must be used within RowContext.Provider");
  return ctx;
}

export function useTaskLookup(): Map<number, Task> {
  const ctx = useContext(RowLookupContext);
  if (!ctx)
    throw new Error("useTaskLookup must be used within RowContext.Provider");
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
  isFlashed?: boolean;
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
  isFlashed = false,
}: TaskRowProps) {
  const {
    lang,
    today,
    holidaySet,
    jiraSiteUrl,
    jiraExtraProjects,
    jiraProjectKey,
    hiddenCols,
    onToggleSelect,
    onJumpToRaid,
    onStatusChange,
    onEdit,
    onAiEdit,
    aiEditEnabled,
    onInlinePatch,
    resourcesById,
    resources,
  } = useTaskRowContext();

  // Single-active-cell inline editor for this row. A committed field routes
  // through the pane's sanitizing patch handler; Jira-synced rows stay read-only
  // (no inline affordance) and only the display value renders.
  const inline = useInlineCellEdit((field, value) =>
    onInlinePatch(task.id, { [field]: value } as Partial<Task>),
  );
  const inlineEditable = !task.jiraKey;
  // Inline assignee editing uses the shared ResourcePicker (directory dropdown +
  // free text). The picked value is held locally while the cell is open and
  // committed on blur — listbox rows select via onMouseDown+preventDefault so the
  // input never blurs mid-selection, making commit-on-blur safe. Contacts are not
  // threaded inline (directory + free text only).
  const [assigneeDraft, setAssigneeDraft] = useState<ResourcePickerValue | null>(null);
  const beginAssigneeEdit = () => {
    setAssigneeDraft({ name: task.assignee, email: task.assigneeEmail, resourceId: task.resourceId ?? null });
    inline.begin("assignee", task.assignee);
  };
  const commitAssignee = () => {
    const d = assigneeDraft;
    setAssigneeDraft(null);
    inline.cancel();
    if (!d) return;
    const resourceId = d.resourceId ?? undefined;
    // Skip a redundant write (opening + blurring without changing anything would
    // otherwise re-persist the fields and bump localModifiedAt).
    const unchanged =
      d.name === task.assignee &&
      d.email === task.assigneeEmail &&
      resourceId === (task.resourceId ?? undefined);
    if (unchanged) return;
    onInlinePatch(task.id, { assignee: d.name, assigneeEmail: d.email, resourceId });
  };
  const onInlineKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      inline.commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      inline.cancel();
    }
  };
  // Name cell: single-click opens the full editor, double-click inline-renames.
  // A raw onClick fires on the first click of a double-click (opening the editor
  // and unmounting the row before dblclick lands), so DEFER the open and let a
  // double-click cancel it. Non-editable (Jira) rows open immediately.
  const nameClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (nameClickTimer.current) clearTimeout(nameClickTimer.current); }, []);
  const handleNameClick = () => {
    if (!inlineEditable) { onEdit(task); return; }
    if (nameClickTimer.current) clearTimeout(nameClickTimer.current);
    nameClickTimer.current = setTimeout(() => { nameClickTimer.current = null; onEdit(task); }, 220);
  };
  const handleNameDoubleClick = () => {
    if (!inlineEditable) return;
    if (nameClickTimer.current) { clearTimeout(nameClickTimer.current); nameClickTimer.current = null; }
    inline.begin("taskName", task.taskName);
  };
  // Text/date inline cells (assignee/startDate/dueDate) share one shape: a
  // labelled ghost button that reveals an <input> on click, committing on
  // blur/Enter and cancelling on Escape. Priority (a <select>) + taskName
  // (double-click) are handled bespoke below.
  const renderInlineField = (
    field: Extract<InlineField, "assignee" | "startDate" | "dueDate">,
    type: "text" | "date",
    current: string,
    display: ReactNode,
    displayClass?: string,
  ): ReactNode => {
    if (!inlineEditable) return display;
    const label = `${t(lang, field)} – ${task.taskName}`;
    if (inline.editing === field) {
      return (
        <input
          autoFocus
          type={type}
          value={inline.draft}
          onChange={(e) => inline.setDraft(e.target.value)}
          onBlur={inline.commit}
          onKeyDown={onInlineKeyDown}
          aria-label={label}
          className={`w-full rounded-md border border-line bg-surface px-2 py-0.5 text-sm text-foreground ${FOCUS_RING} ${TRANSITION}`}
        />
      );
    }
    return (
      <button
        type="button"
        onClick={() => inline.begin(field, current)}
        aria-label={label}
        className={`w-full rounded-md border border-transparent px-2 py-0.5 text-left hover:border-AIPM-dark-blue hover:bg-surface-muted ${displayClass ?? ""} ${INTERACTIVE}`}
      >
        {display}
      </button>
    );
  };

  // Multiline inline cells (notes/blockers): double-click the cell to open a
  // textarea (mirrors the task-name double-click), commit on blur, cancel on
  // Escape, Ctrl/Cmd+Enter also commits (Enter alone inserts a newline). Keeps
  // the read display (incl. the notes show-more toggle) untouched when idle.
  const onTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      inline.cancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      inline.commit();
    }
  };
  const renderInlineTextarea = (
    field: Extract<InlineField, "notes" | "blockers">,
    current: string,
    display: ReactNode,
  ): ReactNode => {
    if (inlineEditable && inline.editing === field) {
      return (
        <textarea
          autoFocus
          rows={3}
          value={inline.draft}
          onChange={(e) => inline.setDraft(e.target.value)}
          onBlur={inline.commit}
          onKeyDown={onTextareaKeyDown}
          aria-label={`${t(lang, field)} – ${task.taskName}`}
          className={`w-full resize-y rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground ${FOCUS_RING} ${TRANSITION}`}
        />
      );
    }
    if (!inlineEditable) return display;
    return (
      <div
        onDoubleClick={() => inline.begin(field, current)}
        title={t(lang, "doubleClickToEdit")}
        className="cursor-text rounded-md border border-transparent px-1 hover:border-AIPM-dark-blue"
      >
        {display}
      </div>
    );
  };

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
    <tr
      data-deeplink-row={task.id}
      className={["group align-top", stateClass, flashOutlineClass(isFlashed)]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Leading cell always renders (reserves width → no hover layout shift);
          the inline "Ask Claude" trigger is revealed on row hover / focus and
          only mounts when the row is AI-editable (not popout / not Jira-synced). */}
      <Td className="w-8">
        {aiEditEnabled(task) && (
          <button
            type="button"
            onClick={() => onAiEdit(task)}
            aria-label={`${t(lang, "inlineAiEdit")} – ${task.taskName}`}
            title={t(lang, "inlineAiEdit")}
            className={`rounded-md px-1.5 text-AIPM-dark-blue opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-AIPM-dark-blue dark:text-AIPM-light-grey ${INTERACTIVE}`}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path d="M10 2l1.6 4.4L16 8l-4.4 1.6L10 14l-1.6-4.4L4 8l4.4-1.6L10 2z" />
            </svg>
          </button>
        )}
      </Td>
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
          className={`cursor-pointer rounded-md border border-transparent px-2 py-0.5 font-mono text-muted-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
        >#{task.id}</button>
        {(() => {
          if (!task.jiraKey || !jiraSiteUrl) return null;
          const href = safeJiraIssueHref(jiraSiteUrl, task.jiraKey);
          if (!href) return null;
          return (
            <span className="ml-1">
              <JiraBadge
                jiraKey={task.jiraKey}
                lang={lang}
                href={href}
                issueType={task.jiraIssueType}
                readOnlyProject={isReadOnlyIssue(task.jiraKey, { projectKey: jiraProjectKey, extraProjects: jiraExtraProjects })}
              />
            </span>
          );
        })()}
        {raidRefs && raidRefs.length > 0 && (
          <RaidBadge taskId={task.id} refs={raidRefs} lang={lang} onJumpToRaid={onJumpToRaid} />
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
        {inlineEditable && inline.editing === "taskName" ? (
          <input
            autoFocus
            value={inline.draft}
            onChange={(e) => inline.setDraft(e.target.value)}
            onBlur={inline.commit}
            onKeyDown={onInlineKeyDown}
            aria-label={`${t(lang, "taskName")} – ${task.taskName}`}
            className={`w-full rounded-md border border-line bg-surface px-2 py-0.5 text-sm font-medium text-foreground ${FOCUS_RING} ${TRANSITION}`}
          />
        ) : (
          <button
            type="button"
            onClick={handleNameClick}
            onDoubleClick={handleNameDoubleClick}
            title={`${task.taskName} — ${t(lang, "clickToEdit")}`}
            className={`cursor-pointer rounded-md border border-transparent px-2 py-0.5 text-left font-medium hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
          >{task.taskName}</button>
        )}
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
      {!hiddenCols.has("assignee") && (() => {
        // Inline edit via the ResourcePicker: pick a directory resource (sets the
        // FK) or type a free-text name (clears it). Linked rows render the
        // resource's LIVE name over the stale cache. Jira-synced rows are
        // read-only (no picker).
        const displayName = effectiveAssignee(task, resourcesById);
        return (
          <Td title={`${t(lang, "assignee")}: ${displayName || "—"}`}>
            {inlineEditable && inline.editing === "assignee" ? (
              <ResourcePicker
                lang={lang}
                value={assigneeDraft ?? { name: task.assignee, email: task.assigneeEmail, resourceId: task.resourceId ?? null }}
                resources={resources}
                contacts={EMPTY_CONTACTS}
                onChange={setAssigneeDraft}
                onBlur={commitAssignee}
                placeholder={t(lang, "assignee")}
                aria-label={`${t(lang, "assignee")} – ${task.taskName}`}
              />
            ) : inlineEditable ? (
              <button
                type="button"
                onClick={beginAssigneeEdit}
                aria-label={`${t(lang, "assignee")} – ${task.taskName}`}
                className={`w-full rounded-md border border-transparent px-2 py-0.5 text-left hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
              >
                {displayName || "—"}
              </button>
            ) : (
              <span className="px-2 py-0.5">{displayName || "—"}</span>
            )}
          </Td>
        );
      })()}
      {!hiddenCols.has("startDate") && (
        <Td className="whitespace-nowrap" title={`${t(lang, "startDate")}: ${task.startDate || "—"}`}>
          {renderInlineField("startDate", "date", task.startDate ?? "", task.startDate || "—", "text-muted-foreground")}
        </Td>
      )}
      {!hiddenCols.has("dueDate") && (
        <Td title={`${t(lang, "dueDate")}: ${task.dueDate || "—"}`}>
          {renderInlineField("dueDate", "date", task.dueDate ?? "", task.dueDate || "—")}
        </Td>
      )}
      {!hiddenCols.has("lastUpdateDate") && <Td title={`${t(lang, "lastUpdateDate")}: ${task.lastUpdateDate || "—"}`}>{task.lastUpdateDate}</Td>}
      {!hiddenCols.has("priority") && (
        <Td stopClick>
          {inlineEditable && inline.editing === "priority" ? (
            <select
              autoFocus
              value={inline.draft}
              onChange={(e) => {
                onInlinePatch(task.id, { priority: e.target.value as Priority });
                inline.cancel();
              }}
              onBlur={inline.cancel}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  inline.cancel();
                }
              }}
              aria-label={`${t(lang, "priority")} – ${task.taskName}`}
              className={`rounded-md border border-line bg-surface px-2 py-1 text-xs text-foreground ${FOCUS_RING} ${TRANSITION}`}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{priorityLabel(lang, p)}</option>
              ))}
            </select>
          ) : inlineEditable ? (
            <button
              type="button"
              onClick={() => inline.begin("priority", task.priority)}
              aria-label={`${t(lang, "priority")} – ${task.taskName}`}
              className={`rounded-md border border-transparent p-0.5 hover:border-AIPM-dark-blue ${INTERACTIVE}`}
            >
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${priorityStyle[task.priority]}`}>
                {priorityLabel(lang, task.priority)}
              </span>
            </button>
          ) : (
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${priorityStyle[task.priority]}`}>
              {priorityLabel(lang, task.priority)}
            </span>
          )}
        </Td>
      )}
      {!hiddenCols.has("taskStatus") && (
        <Td stopClick>
          <TaskStatusSelect lang={lang} task={task} onStatusChange={onStatusChange} />
        </Td>
      )}
      {!hiddenCols.has("blockers") && (
        <Td className="max-w-xs whitespace-pre-wrap text-muted-foreground">
          {renderInlineTextarea("blockers", task.blockers, task.blockers || "—")}
        </Td>
      )}
      {!hiddenCols.has("notes") && (
        <Td className="max-w-xs text-muted-foreground">
          {renderInlineTextarea(
            "notes",
            task.notes ?? "",
            <NotesCell notes={task.notes ?? ""} isExpanded={isExpanded} taskId={task.id} />,
          )}
        </Td>
      )}
      {!hiddenCols.has("depRelations") && (
        <Td className="text-muted-foreground">
          <DepRelationsCell task={task} editable={inlineEditable} />
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
          className={`self-start text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue ${INTERACTIVE}`}
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
    onSendInquiry,
    onPushToJira,
    onEdit,
    onDelete,
  } = useTaskRowContext();
  return (
    <div className="flex flex-col gap-1 whitespace-nowrap">
      <div className="flex flex-wrap gap-2">
        {!task.completedDate && (
          <button
            type="button"
            onClick={() => onSendInquiry(task)}
            className={`text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue ${INTERACTIVE}`}
          >
            {t(lang, "sendInquiry")}
          </button>
        )}
        {jiraEnabled && jiraProjectKey && !task.jiraKey && !task.completedDate && (
          <button
            type="button"
            onClick={() => onPushToJira(task.id)}
            disabled={isPushing}
            className={`text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-AIPM-blue ${INTERACTIVE}`}
          >
            {isPushing ? t(lang, "jiraPushing") : t(lang, "jiraPushToJira")}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onEdit(task)}
          className={`text-xs font-medium text-foreground underline-offset-2 hover:underline ${INTERACTIVE}`}
        >
          {t(lang, "edit")}
        </button>
        <button
          type="button"
          onClick={() => onDelete(task.id)}
          className={`text-xs font-medium text-AIPM-pink-strong underline-offset-2 hover:underline ${INTERACTIVE}`}
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
  const { lang } = useTaskRowContext();
  const tasksById = useTaskLookup();
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

interface DepRelationsCellProps {
  task: Task;
  editable: boolean;
}

/** Dependency (relations) cell: read-only chips plus, for non-Jira rows, an edit
 *  button opening a popover that reuses the modal's DependenciesEditor. Edits
 *  route through the pane's sanitizing `onInlinePatch` (re-validates cycles /
 *  dangling refs). Reads the task lookup for the predecessor dropdown — same
 *  single-cell re-render scope as the chips it wraps. */
function DepRelationsCellImpl({ task, editable }: DepRelationsCellProps) {
  const { lang, onInlinePatch } = useTaskRowContext();
  const tasksById = useTaskLookup();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, wrapRef, () => setOpen(false));
  const deps = task.dependencies ?? [];
  // Only materialise the predecessor list while the popover is open — otherwise
  // every mounted row would re-spread the whole task Map on any edit (the cell
  // is a lookup-context consumer). One popover open at a time ⇒ O(n), not O(rows·n).
  const allTasks = useMemo(() => (open ? [...tasksById.values()] : EMPTY_TASKS), [open, tasksById]);
  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-start gap-1">
        <DependencyChips deps={deps} />
        {editable && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={`${t(lang, "depEditRelations")} – ${task.taskName}`}
            title={t(lang, "depEditRelations")}
            aria-expanded={open}
            className={`shrink-0 rounded-md p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground ${INTERACTIVE}`}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-8.5 8.5a1 1 0 01-.464.263l-3 .857a.5.5 0 01-.618-.618l.857-3a1 1 0 01.263-.464l8.5-8.5z" />
            </svg>
          </button>
        )}
      </div>
      {open && editable && (
        <div
          role="dialog"
          aria-label={t(lang, "depEditRelations")}
          className="absolute left-0 top-full z-40 mt-1 w-80 rounded-lg border border-line bg-surface p-3"
        >
          <DependenciesEditor
            lang={lang}
            value={deps}
            allTasks={allTasks}
            ownTaskId={task.id}
            onChange={(next) => onInlinePatch(task.id, { dependencies: next })}
          />
        </div>
      )}
    </div>
  );
}

const DepRelationsCell = memo(DepRelationsCellImpl);

