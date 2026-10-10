"use client";
// src/app/tasks-section-toolbar.tsx — the Open Points pane's control row and
// its selection bar, split out of `tasks-section.tsx` (§492, the panel-split
// convention in AGENTS.md). PURE PRESENTATIONAL: every value and handler arrives
// as a prop and this file calls no hook and reads no context, so the
// orchestrator stays the one owner of state. The two Outlook calendar controls
// and the duplicate finder arrive pre-built (`calendarControls`, `dedupButton`)
// because their hooks live in the orchestrator.
//
// ★ The trailing group stays Print · reset-columns · reset-size, with the
// destructive Clear-all before it (AGENTS.md "Toolbar button ORDER convention").
import type React from "react";
import { ArrowPathIcon, CheckCircleIcon, EyeSlashIcon } from "./icons";
import { type Lang, type TranslationKey, priorityLabel, t } from "./i18n";
import { PRIORITIES, type Priority, type Resource } from "./types";
import { TaskSwimlaneToolbar } from "./task-swimlane-toolbar";
import { ToggleButton } from "./toggle-button";
import { SegmentedControl } from "./segmented-control";
import type { HealthFilter } from "./health";
import type { Settings } from "./settings-types";
import { FILTER_ALL, type TaskFilterValues } from "./task-filters";
import { SavedViewsControl } from "./saved-views-control";
import { INTERACTIVE } from "./interaction-styles";
import { ColumnConfigPopover } from "./column-config-popover";
import { Select } from "./form-controls";
import { AddButton, PaneSearchInput } from "./pane-toolbar";
import { IconButton } from "./icon-button";
import { EraserIcon, PrintButton, ResetColWidthsButton, ResetSizeButton } from "./task-manager-ui";
import { TOUR_ANCHORS } from "./app-tour";
import { Button } from "./button";

export type TasksViewMode = NonNullable<Settings["tasksViewMode"]>;

// ★ Exported for its guard test: `taskName` must never appear here (see open-points-table-geometry.ts).
export const CONFIGURABLE_COLS: Array<{ key: string; labelKey: TranslationKey }> = [
  { key: "status",         labelKey: "health" },
  { key: "id",             labelKey: "id" },
  { key: "assignee",       labelKey: "assignee" },
  { key: "startDate",      labelKey: "start" },
  { key: "dueDate",        labelKey: "due" },
  { key: "lastUpdateDate", labelKey: "lastUpdate" },
  { key: "createdDate",    labelKey: "colCreatedDate" },
  { key: "priority",       labelKey: "priority" },
  { key: "taskStatus",     labelKey: "colTaskStatus" },
  { key: "blockers",       labelKey: "blockers" },
  { key: "description",    labelKey: "description" },
  { key: "notesLog",       labelKey: "noteLogTitle" },
  { key: "depRelations",   labelKey: "depRelations" },
  { key: "estimate",       labelKey: "taskOriginalEstimate" },
  { key: "spent",          labelKey: "taskTimeSpent" },
];

export interface TasksToolbarProps {
  lang: Lang;
  /** Opens the task editor for a NEW task (discarding any in-progress edit). */
  onAdd: () => void;
  jiraEnabled: boolean;
  handleJiraSync: () => void;
  jiraSyncing: boolean;
  jiraProjectKey: string;
  dedupButton: React.ReactNode;
  hideFinished: boolean;
  onToggleHideFinished: () => void;
  hideExternal: boolean;
  onToggleHideExternal: () => void;
  tasksViewMode: TasksViewMode;
  setTasksViewMode: (mode: TasksViewMode) => void;
  assignableResources: readonly Resource[];
  laneIds: readonly number[];
  addLane: (id: number) => void;
  search: string;
  setSearch: (value: string) => void;
  priorityFilter: Priority | "All";
  setPriorityFilter: (value: Priority | "All") => void;
  effectiveFilters: TaskFilterValues;
  setAssigneeFilter: (value: string) => void;
  setGroupFilter: (value: string) => void;
  setLabelFilter: (value: string) => void;
  uniqueAssignees: readonly string[];
  uniqueGroups: readonly string[];
  uniqueLabels: readonly string[];
  healthFilter: HealthFilter;
  setHealthFilter: (value: HealthFilter) => void;
  hiddenCols: Set<string>;
  setHiddenCols: React.Dispatch<React.SetStateAction<Set<string>>>;
  calendarControls: React.ReactNode;
  onClearAll: () => void;
  clearDisabled: boolean;
  resetColWidths: () => void;
  resetTableSize: () => void;
}

export function TasksToolbar({
  lang, onAdd, jiraEnabled, handleJiraSync, jiraSyncing, jiraProjectKey, dedupButton,
  hideFinished, onToggleHideFinished, hideExternal, onToggleHideExternal, tasksViewMode, setTasksViewMode,
  assignableResources, laneIds, addLane, search, setSearch, priorityFilter, setPriorityFilter, effectiveFilters,
  setAssigneeFilter, setGroupFilter, setLabelFilter, uniqueAssignees, uniqueGroups, uniqueLabels,
  healthFilter, setHealthFilter, hiddenCols, setHiddenCols, calendarControls, onClearAll, clearDisabled,
  resetColWidths, resetTableSize,
}: TasksToolbarProps) {
  // A value found on the tasks is free text, so it can read exactly like one
  // of the select's fixed options ("No group", "All labels"); it is then shown
  // in quotes so the two options do not share a name (§676).
  const fold = (s: string) => s.trim().toLocaleLowerCase();
  const optionName = (value: string, fixed: readonly TranslationKey[]) =>
    fixed.some((key) => fold(t(lang, key)) === fold(value)) ? t(lang, "filterQuotedValue", value) : value;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <AddButton
        onClick={onAdd}
        aria-label={t(lang, "addTaskButton")}
        title={t(lang, "addTaskButton")}
      >
        + {t(lang, "addTaskButton")}
      </AddButton>
      {jiraEnabled && (
        <button
          type="button"
          onClick={handleJiraSync}
          disabled={jiraSyncing || !jiraProjectKey}
          title={
            jiraProjectKey
              ? t(lang, "jiraSync")
              : t(lang, "jiraSyncNoScope")
          }
          className={`inline-flex items-center gap-1.5 rounded-md border border-ui-dark-blue bg-surface px-2.5 py-1.5 text-xs font-medium text-ui-dark-blue dark:text-ui-light-grey hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
        >
          <ArrowPathIcon aria-hidden="true" className={`h-4 w-4 ${jiraSyncing ? "animate-spin" : ""}`} />
          {jiraSyncing ? t(lang, "jiraSyncing") : t(lang, "jiraSync")}
        </button>
      )}
      {dedupButton}
      <ToggleButton lang={lang}
        pressed={hideFinished}
        onToggle={onToggleHideFinished}
        icon={<CheckCircleIcon aria-hidden="true" className="h-3.5 w-3.5" />}
      >
        {t(lang, "hideFinishedTasks")}
      </ToggleButton>
      <ToggleButton lang={lang}
        pressed={hideExternal}
        onToggle={onToggleHideExternal}
        icon={<EyeSlashIcon aria-hidden="true" className="h-3.5 w-3.5" />}
      >
        {t(lang, "hideExternalTasks")}
      </ToggleButton>
      <SegmentedControl
        value={tasksViewMode}
        options={[
          { value: "table", label: t(lang, "tasksViewTable") },
          { value: "board", label: t(lang, "tasksViewBoard") },
          { value: "swimlane", label: t(lang, "tasksViewSwimlane") },
        ]}
        onChange={setTasksViewMode}
        ariaLabel={t(lang, "tasksViewModeLabel")}
        dataTourId={TOUR_ANCHORS.tasksViewMode}
      />
      {tasksViewMode === "swimlane" && (
        <TaskSwimlaneToolbar
          lang={lang}
          resources={assignableResources}
          laneResourceIds={laneIds}
          onAddLane={addLane}
        />
      )}
      <PaneSearchInput
        value={search}
        onChange={setSearch}
        ariaLabel={t(lang, "searchPlaceholder")}
        clearLabel={`${t(lang, "clear")} – ${t(lang, "searchPlaceholder")}`}
        title={t(lang, "tasksSearchHint")}
      />
      <Select
        size="xs"
        value={priorityFilter}
        onChange={(e) =>
          setPriorityFilter(e.target.value as Priority | "All")
        }
        title={t(lang, "priorityFilterHint")}
      >
        <option value="All">{t(lang, "allPriorities")}</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {priorityLabel(lang, p)}
          </option>
        ))}
      </Select>
      <Select
        size="xs"
        value={effectiveFilters.assignee}
        onChange={(e) => setAssigneeFilter(e.target.value)}
        title={t(lang, "assigneeFilterHint")}
      >
        <option value={FILTER_ALL}>{t(lang, "allAssignees")}</option>
        {/* uniqueAssignees KEEPS blanks, so label the unassigned option (value stays ""). */}
        {uniqueAssignees.map((a) => (
          <option key={a} value={a}>
            {a === "" ? t(lang, "assigneeNone") : optionName(a, ["allAssignees", "assigneeNone"])}
          </option>
        ))}
      </Select>
      <Select
        size="xs"
        value={effectiveFilters.group}
        onChange={(e) => setGroupFilter(e.target.value)}
        title={t(lang, "tasksGroupFilterHint")}
      >
        <option value={FILTER_ALL}>{t(lang, "allGroups")}</option>
        <option value="">{t(lang, "groupNone")}</option>
        {uniqueGroups.map((g) => (
          <option key={g} value={g}>
            {optionName(g, ["allGroups", "groupNone"])}
          </option>
        ))}
      </Select>
      <Select
        size="xs"
        value={effectiveFilters.label}
        onChange={(e) => setLabelFilter(e.target.value)}
        title={t(lang, "tasksLabelFilterHint")}
      >
        <option value={FILTER_ALL}>{t(lang, "allLabels")}</option>
        {uniqueLabels.map((l) => (
          <option key={l} value={l}>
            {optionName(l, ["allLabels"])}
          </option>
        ))}
      </Select>
      <Select
        size="xs"
        value={healthFilter}
        onChange={(e) => setHealthFilter(e.target.value as HealthFilter)}
        aria-label={t(lang, "healthFilterLabel")}
        title={t(lang, "healthFilterHint")}
      >
        <option value="all">{t(lang, "allHealth")}</option>
        <option value="red">{t(lang, "healthRed")}</option>
        <option value="amber">{t(lang, "healthAmber")}</option>
        <option value="green">{t(lang, "healthGreen")}</option>
      </Select>
      <ColumnConfigPopover
        lang={lang}
        cols={CONFIGURABLE_COLS}
        hidden={hiddenCols}
        onToggle={(key) =>
          setHiddenCols((prev) => {
            const next = new Set(prev);
            if (next.has(key)) { next.delete(key); } else { next.add(key); }
            return next;
          })
        }
      />
      <SavedViewsControl
        lang={lang}
        hiddenCols={hiddenCols}
        setHiddenCols={setHiddenCols}
        dataTourId={TOUR_ANCHORS.savedViews}
      />
      {calendarControls}
      <IconButton
        variant="dangerBordered"
        size="md"
        onClick={onClearAll}
        disabled={clearDisabled}
        label={t(lang, "clearAll")}
        title={t(lang, "clearAll")}
      >
        <EraserIcon />
      </IconButton>
      <PrintButton lang={lang} />
      <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
      <ResetSizeButton onClick={resetTableSize} lang={lang} />
    </div>
  );
}

export interface TasksSelectionBarProps {
  lang: Lang;
  selectedCount: number;
  handleBulkSendInquiry: () => void;
  bulkEditOpen: boolean;
  onToggleBulkEdit: () => void;
  onDeleteSelected: () => void;
  clearSelection: () => void;
}

/** The bar shown while rows are selected: the count and the four bulk actions. */
export function TasksSelectionBar({
  lang, selectedCount, handleBulkSendInquiry, bulkEditOpen, onToggleBulkEdit, onDeleteSelected, clearSelection,
}: TasksSelectionBarProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-muted p-3">
      <span className="text-sm font-medium text-ui-dark-blue dark:text-ui-light-grey">
        {t(lang, "selectionCount", selectedCount)}
      </span>
      <div className="ml-auto flex flex-wrap gap-2">
        <Button variant="accent" size="sm" onClick={handleBulkSendInquiry}>
          {t(lang, "bulkSendInquiries")}
        </Button>
        <ToggleButton lang={lang} pressed={bulkEditOpen} onToggle={onToggleBulkEdit}>
          {t(lang, "bulkEdit")}
        </ToggleButton>
        <Button
          variant="destructive"
          size="sm"
          type="button"
          onClick={onDeleteSelected}
        >
          {t(lang, "deleteSelected")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={clearSelection}
        >
          {t(lang, "clearSelection")}
        </Button>
      </div>
    </div>
  );
}
