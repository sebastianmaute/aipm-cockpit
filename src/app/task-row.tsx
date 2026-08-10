"use client";

import { createContext, memo, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { SparklesIcon } from "@heroicons/react/24/outline";
import { computeTaskHealth, formatHealthTooltip, type TaskHealth } from "./health";
import { isTaskClosed, isTaskDelivered } from "./task-closed";
import { descriptionText } from "./rich-text-projection";
import { priorityLabel, t, type Lang } from "./i18n";
import { formatDuration } from "./duration";
import { isReadOnlyIssue } from "./jira-projects";
import type { JiraExtraProject } from "./settings-types";
import { Badge } from "./badge";
import { JiraBadge } from "./task-jira-badge";
import { NotesBadgeButton } from "./notes-badge-button";
import { RaidBadge } from "./task-raid-badge";
import { DocumentBadge } from "./document-badge";
import { refKey } from "./document-ref";
import type { ProjectDocument } from "./document-model";
import { TaskStatusGlyph } from "./task-status-glyph";
import { priorityStyle } from "./task-status-ui";
import { TaskStatusSelect } from "./task-status-select";
import { flashOutlineClass } from "./use-deeplink-row-flash";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";
import { Input, Select } from "./form-controls";
import { useInlineCellEdit, type InlineField } from "./use-inline-cell-edit";
import { effectiveAssignee } from "./resource-foundation";
import { ResourcePicker, type ResourcePickerValue } from "./resource-picker";
import { PopoverPanel } from "./popover-panel";
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
  /** Open the floating notes window for a task (running note log). */
  onOpenNotes: (id: number) => void;
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
  padding = "normal",
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  /** Keep a click inside this cell from bubbling to the row's row-click
   *  handler (e.g. the inline status dropdown). */
  stopClick?: boolean;
  /** Mirrors Th's tight variant — must match the header or columns misalign. */
  padding?: "normal" | "tight";
}) {
  const onClick = stopClick
    ? (e: MouseEvent<HTMLTableCellElement>) => e.stopPropagation()
    : undefined;
  return <td title={title} onClick={onClick} className={`${padding === "tight" ? "px-1" : "px-4"} py-3 ${className ?? ""}`}>{children}</td>;
}

interface TaskRowProps {
  task: Task;
  isSelected: boolean;
  isEditing: boolean;
  isPushing: boolean;
  raidRefs: RaidItem[] | undefined;
  changeRefs?: ChangeItem[];
  /** Linked-documents reverse index (`refKey(kind, id)` → documents) and the
   *  Documents deep-link. PROPS, not context — the same pair feeds the Kanban
   *  card, which renders outside every provider a hook could read. Optional so
   *  lightweight callers/tests can omit them; no badge renders then. */
  documentsByEntity?: ReadonlyMap<string, readonly ProjectDocument[]>;
  onOpenDocuments?: (taskId: number) => void;
  isStriped?: boolean;
  isFlashed?: boolean;
}

function TaskRowImpl({
  task,
  isSelected,
  isEditing,
  isPushing,
  raidRefs,
  changeRefs,
  documentsByEntity,
  onOpenDocuments,
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
    onOpenNotes,
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
        <Input
          autoFocus
          type={type}
          size="xs"
          value={inline.draft}
          onChange={(e) => inline.setDraft(e.target.value)}
          onBlur={inline.commit}
          onKeyDown={onInlineKeyDown}
          aria-label={label}
          className="w-full"
        />
      );
    }
    return (
      <button
        type="button"
        onClick={() => inline.begin(field, current)}
        aria-label={label}
        className={`w-full rounded-md border border-transparent px-2 py-0.5 text-left hover:border-ui-dark-blue hover:bg-surface-muted ${displayClass ?? ""} ${INTERACTIVE}`}
      >
        {display}
      </button>
    );
  };

  // Multiline inline cell (blockers): double-click the cell to open a textarea
  // (mirrors the task-name double-click), commit on blur, cancel on Escape,
  // Ctrl/Cmd+Enter also commits (Enter alone inserts a newline). Keeps the read
  // display untouched when idle.
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
    field: Extract<InlineField, "blockers">,
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
        className="cursor-text rounded-md border border-transparent px-1 hover:border-ui-dark-blue"
      >
        {display}
      </div>
    );
  };

  // Two different questions. CLOSED (Done or Cancelled) drives everything about
  // active work — the tint, the strikethrough, the ✓ instead of a RAG dot.
  // DELIVERED is the narrower one, and only it may name a date: a cancelled task
  // carries no completedDate, so labelling it from `isClosed` would render
  // "Completed on undefined".
  const isClosed = isTaskClosed(task);
  const health: TaskHealth = computeTaskHealth(task, today, holidaySet);
  const label = isTaskDelivered(task)
    ? t(lang, "completedOn", task.completedDate!)
    : formatHealthTooltip(health, lang);

  // Precedence: editing > selected > completed > zebra stripe. The selected
  // branch intentionally drops the stripe — full-opacity bg-surface-muted
  // already covers the /40 tint.
  const stateClass = isEditing
    ? "bg-ui-purple/10 dark:bg-ui-purple/15"
    : isSelected
      ? "bg-surface-muted"
      : isClosed
        ? // Closed rows (Done OR Cancelled) are signalled by the strikethrough
          // title + a muted tint — NOT `opacity`, which dims all text/badges
          // below the WCAG AA contrast threshold (axe flagged the whole row).
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
      <Td className="w-7">
        {aiEditEnabled(task) && (
          <button
            type="button"
            onClick={() => onAiEdit(task)}
            aria-label={`${t(lang, "inlineAiEdit")} – ${task.taskName}`}
            title={t(lang, "inlineAiEdit")}
            className={`rounded-md px-1.5 text-ui-dark-blue opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-ui-dark-blue dark:text-ui-light-grey ${INTERACTIVE}`}
          >
            <SparklesIcon aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </Td>
      <Td padding="tight">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(task.id)}
          aria-label={t(lang, "selectRow", task.id)}
          className="h-4 w-4 cursor-pointer rounded border-line text-ui-dark-blue focus:ring-ui-green dark:border-line"
        />
      </Td>
      {!hiddenCols.has("status") && (
        <Td padding="tight">
          <TaskStatusGlyph task={task} health={health} label={label} />
        </Td>
      )}
      {!hiddenCols.has("id") && <Td className="font-mono text-muted-foreground">
        <button
          type="button"
          onClick={() => onEdit(task)}
          title={`#${task.id} — ${t(lang, "clickToEdit")}`}
          aria-label={`#${task.id} — ${t(lang, "clickToEdit")}`}
          className={`cursor-pointer rounded-md border border-transparent px-2 py-0.5 font-mono text-muted-foreground hover:border-ui-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
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
        <DocumentBadge
          lang={lang}
          count={documentsByEntity?.get(refKey("task", task.id))?.length ?? 0}
          entityTitle={task.taskName}
          onOpen={() => onOpenDocuments?.(task.id)}
        />
        {changeRefs && changeRefs.length > 0 && (
          <span
            title={t(lang, "taskRowChangesBadge", changeRefs.length)}
            aria-label={t(lang, "taskRowChangesBadge", changeRefs.length)}
            className="ml-1 inline-flex items-center rounded bg-ui-blue/15 px-1.5 py-0.5 text-[10px] font-medium text-ui-dark-blue dark:bg-ui-blue/20 dark:text-ui-light-grey"
          >
            {t(lang, "taskRowChangesBadge", changeRefs.length)}
          </span>
        )}
      </Td>}
      <Td
        className={`font-medium text-foreground ${isClosed ? "line-through" : ""}`}
      >
        {inlineEditable && inline.editing === "taskName" ? (
          <Input
            autoFocus
            size="xs"
            value={inline.draft}
            onChange={(e) => inline.setDraft(e.target.value)}
            onBlur={inline.commit}
            onKeyDown={onInlineKeyDown}
            aria-label={`${t(lang, "taskName")} – ${task.taskName}`}
            className="w-full font-medium"
          />
        ) : (
          <button
            type="button"
            onClick={handleNameClick}
            onDoubleClick={handleNameDoubleClick}
            title={`${task.taskName} — ${t(lang, "clickToEdit")}`}
            className={`cursor-pointer rounded-md border border-transparent px-2 py-0.5 text-left font-medium hover:border-ui-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
          >{task.taskName}</button>
        )}
        {(task.group || (task.labels?.length ?? 0) > 0) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {task.group && (
              <span className="inline-flex rounded-md bg-ui-dark-blue/10 px-1.5 py-0.5 text-[10px] font-medium text-ui-dark-blue dark:bg-ui-dark-blue/30 dark:text-ui-light-grey">
                {task.group}
              </span>
            )}
            {(task.labels ?? []).map((l) => (
              <Badge key={l} pill size="sm" className="bg-surface-muted font-medium text-foreground">
                {l}
              </Badge>
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
                className={`w-full rounded-md border border-transparent px-2 py-0.5 text-left hover:border-ui-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
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
      {!hiddenCols.has("createdDate") && <Td title={`${t(lang, "colCreatedDate")}: ${task.createdDate || "—"}`}>{task.createdDate || "—"}</Td>}
      {!hiddenCols.has("priority") && (
        <Td stopClick>
          {inlineEditable && inline.editing === "priority" ? (
            <Select
              autoFocus
              size="xs"
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
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{priorityLabel(lang, p)}</option>
              ))}
            </Select>
          ) : inlineEditable ? (
            <button
              type="button"
              onClick={() => inline.begin("priority", task.priority)}
              aria-label={`${t(lang, "priority")} – ${task.taskName}`}
              className={`rounded-md border border-transparent p-0.5 hover:border-ui-dark-blue ${INTERACTIVE}`}
            >
              <Badge pill className={`font-medium ${priorityStyle[task.priority]}`}>
                {priorityLabel(lang, task.priority)}
              </Badge>
            </button>
          ) : (
            <Badge pill className={`font-medium ${priorityStyle[task.priority]}`}>
              {priorityLabel(lang, task.priority)}
            </Badge>
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
      {!hiddenCols.has("description") && (() => {
        // Non-expandable plain-text preview of the (rich HTML) description.
        const preview = descriptionText(task.description);
        return (
          <Td className="max-w-xs truncate text-muted-foreground" title={preview}>
            {preview || "—"}
          </Td>
        );
      })()}
      {!hiddenCols.has("notesLog") && (
        <Td>
          {/* Count badge opening the floating notes window (running note log). */}
          <NotesBadgeButton
            count={task.noteLog?.length ?? 0}
            entityName={task.taskName}
            lang={lang}
            onClick={() => onOpenNotes(task.id)}
          />
        </Td>
      )}
      {!hiddenCols.has("depRelations") && (
        <Td className="text-muted-foreground">
          <DepRelationsCell task={task} />
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const stop = (e: MouseEvent) => e.stopPropagation();

  // Separate component, separate scope — `isClosed` is recomputed here. Both
  // verbs are about work still in play: nobody is chased about a cancelled task,
  // and there is nothing left to push.
  const isClosed = isTaskClosed(task);
  const showSendInquiry = !isClosed;
  const showPushToJira =
    jiraEnabled && !!jiraProjectKey && !task.jiraKey && !isClosed;

  // All row verbs (Edit / Send inquiry / Push to Jira / Delete) live in the
  // ⋮ overflow menu. The trigger's aria-label is row-unique (WCAG 2.4.6) so
  // N rows don't share an identical "More actions" name.
  return (
    <div className="flex items-center whitespace-nowrap">
      <span className="relative">
        <button
          ref={menuBtnRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`${t(lang, "actionMoreActions")} – ${task.taskName}`}
          title={t(lang, "actionMoreActions")}
          onClick={(e) => { stop(e); setMenuOpen((o) => !o); }}
          className={`rounded-md border border-line px-2 py-0.5 text-xs font-medium text-muted-foreground hover:border-ui-dark-blue/40 hover:bg-ui-dark-blue/10 ${FOCUS_RING} ${TRANSITION}`}
        >
          ⋮
        </button>
        <PopoverPanel
          open={menuOpen}
          anchorRef={menuBtnRef}
          onClose={closeMenu}
          role="menu"
          ariaLabel={t(lang, "actionMoreActions")}
          className="flex w-max flex-col py-1"
        >
          <button
            type="button"
            role="menuitem"
            onClick={(e) => { stop(e); setMenuOpen(false); onEdit(task); }}
            className="px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted"
          >
            {t(lang, "edit")}
          </button>
          {showSendInquiry && (
            <button
              type="button"
              role="menuitem"
              onClick={(e) => { stop(e); setMenuOpen(false); onSendInquiry(task); }}
              className="px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted"
            >
              {t(lang, "sendInquiry")}
            </button>
          )}
          {showPushToJira && (
            <button
              type="button"
              role="menuitem"
              disabled={isPushing}
              onClick={(e) => { stop(e); setMenuOpen(false); onPushToJira(task.id); }}
              className="px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPushing ? t(lang, "jiraPushing") : t(lang, "jiraPushToJira")}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={(e) => { stop(e); setMenuOpen(false); onDelete(task.id); }}
            className="px-3 py-1 text-left text-xs text-ui-pink-strong hover:bg-ui-pink/5"
          >
            {t(lang, "delete")}
          </button>
        </PopoverPanel>
      </span>
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
              className="inline-flex items-center gap-0.5 rounded-full bg-ui-blue/15 px-1.5 py-0.5 text-[10px] font-medium text-ui-dark-blue dark:bg-ui-blue/25 dark:text-ui-light-grey"
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

/** Dependency (relations) cell: read-only chips. Editing lives in the task
 *  modal, which is the only surface with a draft to stage successor links in —
 *  this popover wrote through live and had none. */
function DepRelationsCellImpl({ task }: { task: Task }) {
  return <DependencyChips deps={task.dependencies ?? []} />;
}

const DepRelationsCell = memo(DepRelationsCellImpl);

