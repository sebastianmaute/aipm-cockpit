# Slice 14 — TasksSection + UI Component Extraction Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the 6 inline UI helper components from the bottom of `task-manager.tsx` into `task-manager-ui.tsx`, and extract the entire tasks `<section>` JSX block into `tasks-section.tsx`. Net result: `task-manager.tsx` loses ~520 lines (from ~1,705 to ~1,185).

**Architecture:** `task-manager-ui.tsx` is pure presentational (no hooks/state). `tasks-section.tsx` reads `useFilters()`, `useWorkspace()`, and `useTaskForm()` from providers that already wrap it; receives 31 explicit props for state that originates outside those three contexts.

**Tech Stack:** React 19, TypeScript, Vitest 3, @testing-library/react 16, Tailwind CSS.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/app/task-manager-ui.tsx` | **Create** | 6 pure UI components: `TabButton`, `Th`, `SortableTh`, `ResetSizeIcon`, `ResetColWidthsIcon`, `EraserIcon` |
| `src/app/tasks-section.tsx` | **Create** | Tasks `<section>` component reading 3 contexts + 31 explicit props |
| `src/app/tasks-section.test.tsx` | **Create** | 3 smoke tests (empty, filter-empty, table-renders) |
| `src/app/task-manager.tsx` | **Modify** | Remove extracted code, add imports, replace section JSX with `<TasksSection />` |
| `src/app/version.ts` | **Modify** | Bump to `"0.8.2"` |
| `CHANGELOG.md` | **Modify** | Prepend v0.8.2 "Joyce" entry |

---

## Task 1: Create `task-manager-ui.tsx`

**Files:**
- Create: `src/app/task-manager-ui.tsx`

- [ ] **Step 1: Confirm no existing file**

  Run: `ls src/app/task-manager-ui.tsx`
  Expected: file not found (error).

- [ ] **Step 2: Create the file — move 6 components verbatim**

  `src/app/task-manager-ui.tsx`:
  ```typescript
  "use client";
  import type React from "react";
  import { type SortDir, type SortKey } from "./filters-context";

  export function TabButton({
    active,
    onClick,
    controls,
    children,
    onPopout,
    popoutLabel,
  }: {
    active: boolean;
    onClick: () => void;
    controls: string;
    children: React.ReactNode;
    onPopout?: () => void;
    popoutLabel?: string;
  }) {
    const colorClass = active
      ? "border-AIPM-green text-AIPM-dark-blue dark:border-AIPM-green dark:text-AIPM-light-grey"
      : "border-transparent text-AIPM-medium-grey hover:text-AIPM-dark-blue dark:text-zinc-400 dark:hover:text-zinc-200";
    return (
      <div
        className={`-mb-px inline-flex items-stretch rounded-t-md border-b-2 transition-colors ${colorClass}`}
      >
        <button
          type="button"
          role="tab"
          aria-selected={active}
          aria-controls={controls}
          onClick={onClick}
          className={`py-2 pl-4 text-sm font-medium ${onPopout ? "pr-1" : "pr-4"}`}
        >
          {children}
        </button>
        {onPopout && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPopout();
            }}
            aria-label={popoutLabel}
            title={popoutLabel}
            className="rounded-tr-md px-1.5 py-2 opacity-50 hover:opacity-100 focus-visible:opacity-100"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="h-3.5 w-3.5"
            >
              <path d="M9.5 2.5h4v4" />
              <path d="m13.5 2.5-5.5 5.5" />
              <path d="M11 9v2.5A1.5 1.5 0 0 1 9.5 13H4A1.5 1.5 0 0 1 2.5 11.5V6A1.5 1.5 0 0 1 4 4.5h2.5" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  export function ResetSizeIcon() {
    return (
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-4 w-4"
      >
        {/* center square */}
        <rect x="8.5" y="8.5" width="3" height="3" fill="currentColor" stroke="none" />
        {/* top arrow */}
        <line x1="10" y1="2" x2="10" y2="6.5" />
        <polyline points="8,4.5 10,6.5 12,4.5" />
        {/* bottom arrow */}
        <line x1="10" y1="18" x2="10" y2="13.5" />
        <polyline points="8,15.5 10,13.5 12,15.5" />
        {/* left arrow */}
        <line x1="2" y1="10" x2="6.5" y2="10" />
        <polyline points="4.5,8 6.5,10 4.5,12" />
        {/* right arrow */}
        <line x1="18" y1="10" x2="13.5" y2="10" />
        <polyline points="15.5,8 13.5,10 15.5,12" />
      </svg>
    );
  }

  export function ResetColWidthsIcon() {
    return (
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-4 w-4"
      >
        <rect x="7" y="3" width="6" height="14" fill="currentColor" fillOpacity="0.15" stroke="none" />
        <line x1="7" y1="3" x2="7" y2="17" />
        <line x1="13" y1="3" x2="13" y2="17" />
        <line x1="1.5" y1="10" x2="5.5" y2="10" />
        <polyline points="5.5,8.5 7,10 5.5,11.5" />
        <line x1="18.5" y1="10" x2="14.5" y2="10" />
        <polyline points="14.5,8.5 13,10 14.5,11.5" />
      </svg>
    );
  }

  export function EraserIcon() {
    return (
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-4 w-4"
      >
        <g transform="rotate(-30, 10, 10)">
          <path
            d="M2 9.5 Q2 7 4 7 L7.5 7 L7.5 13 L4 13 Q2 13 2 10.5 Z"
            fill="currentColor"
            fillOpacity="0.35"
            stroke="none"
          />
          <rect x="2" y="7" width="16" height="6" rx="2" />
          <line x1="7.5" y1="7" x2="7.5" y2="13" />
        </g>
      </svg>
    );
  }

  export function Th({
    children,
    onResize,
  }: {
    children: React.ReactNode;
    onResize?: (e: React.MouseEvent) => void;
  }) {
    return (
      <th className="relative px-4 py-2 font-medium">
        {children}
        {onResize && (
          <div
            onMouseDown={onResize}
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-AIPM-dark-blue/40 dark:hover:bg-AIPM-blue/40"
          />
        )}
      </th>
    );
  }

  export function SortableTh({
    label,
    sortKey,
    currentKey,
    dir,
    onClick,
    onResize,
  }: {
    label: string;
    sortKey: SortKey;
    currentKey: SortKey;
    dir: SortDir;
    onClick: (k: SortKey) => void;
    onResize?: (e: React.MouseEvent) => void;
  }) {
    const isActive = currentKey === sortKey;
    const indicator = isActive ? (dir === "asc" ? "↑" : "↓") : "";
    return (
      <th className="relative px-4 py-2 font-medium">
        <button
          type="button"
          onClick={() => onClick(sortKey)}
          className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-zinc-900 dark:hover:text-zinc-100 ${isActive ? "text-zinc-900 dark:text-zinc-100" : ""}`}
        >
          {label}
          <span aria-hidden className="text-[0.65rem]">
            {indicator}
          </span>
        </button>
        {onResize && (
          <div
            onMouseDown={onResize}
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-AIPM-dark-blue/40 dark:hover:bg-AIPM-blue/40"
          />
        )}
      </th>
    );
  }
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/task-manager-ui.tsx
  git commit -m "feat(task-manager-ui): extract 6 UI helper components from task-manager.tsx"
  ```

---

## Task 2: Scaffold `tasks-section.test.tsx` — RED

**Files:**
- Create: `src/app/tasks-section.test.tsx`

- [ ] **Step 1: Write 3 failing smoke tests**

  `src/app/tasks-section.test.tsx`:
  ```typescript
  import React from "react";
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { t } from "./i18n";

  vi.mock("./workspace-context", () => ({ useWorkspace: vi.fn() }));
  vi.mock("./filters-context", () => ({ useFilters: vi.fn() }));
  vi.mock("./task-form-context", () => ({ useTaskForm: vi.fn() }));
  vi.mock("./task-row", () => ({
    RowContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TaskRow: ({ task }: { task: { id: number; taskName: string } }) => (
      <tr><td>{task.taskName}</td></tr>
    ),
  }));

  import { useWorkspace } from "./workspace-context";
  import { useFilters } from "./filters-context";
  import { useTaskForm } from "./task-form-context";
  import { TasksSection, type TasksSectionProps } from "./tasks-section";

  const mockUseWorkspace = useWorkspace as ReturnType<typeof vi.fn>;
  const mockUseFilters = useFilters as ReturnType<typeof vi.fn>;
  const mockUseTaskForm = useTaskForm as ReturnType<typeof vi.fn>;

  function stubFilters() {
    mockUseFilters.mockReturnValue({
      search: "", setSearch: vi.fn(),
      priorityFilter: "All", setPriorityFilter: vi.fn(),
      assigneeFilter: "All", setAssigneeFilter: vi.fn(),
      groupFilter: "All", setGroupFilter: vi.fn(),
      labelFilter: "All", setLabelFilter: vi.fn(),
      sortKey: "taskName", sortDir: "asc",
      setSortKey: vi.fn(), setSortDir: vi.fn(),
    });
  }

  function stubTaskForm() {
    mockUseTaskForm.mockReturnValue({
      editingId: null,
      bulkEditOpen: false,
      setBulkEditOpen: vi.fn(),
    });
  }

  function stubWorkspace(tasks: unknown[], filteredSortedTasks: unknown[]) {
    mockUseWorkspace.mockReturnValue({
      tasks,
      filteredSortedTasks,
      uniqueAssignees: [],
      uniqueGroups: [],
      uniqueLabels: [],
    });
  }

  function makeProps(): TasksSectionProps {
    return {
      lang: "en-US",
      today: "2026-05-21",
      rowContextValue: {} as TasksSectionProps["rowContextValue"],
      hiddenCols: new Set(),
      setHiddenCols: vi.fn(),
      colWidths: {},
      colConfigOpen: false,
      setColConfigOpen: vi.fn(),
      colConfigRef: { current: null } as React.RefObject<HTMLDivElement>,
      startColResize: vi.fn(),
      resetColWidths: vi.fn(),
      tableRef: { current: null } as React.RefObject<HTMLElement>,
      resetTableSize: vi.fn(),
      expandedNotes: new Set(),
      pushingIds: new Set(),
      raidByTask: new Map(),
      jiraEnabled: false,
      jiraSyncing: false,
      jiraProjectKey: "",
      handleJiraSync: vi.fn(),
      handleCancelEdit: vi.fn(),
      setTaskModalOpen: vi.fn(),
      handleClearAll: vi.fn(),
      selectedIds: new Set(),
      allVisibleSelected: false,
      selectedJiraCount: 0,
      toggleSelectAllVisible: vi.fn(),
      clearSelection: vi.fn(),
      handleBulkSendInquiry: vi.fn(),
      applyBulkEdit: vi.fn(),
      cancelBulkEdit: vi.fn(),
    };
  }

  describe("TasksSection", () => {
    beforeEach(() => {
      stubFilters();
      stubTaskForm();
    });

    it("renders 'no tasks' placeholder when tasks list is empty", () => {
      stubWorkspace([], []);
      render(<TasksSection {...makeProps()} />);
      expect(screen.getByText(t("en-US", "noTasks"))).toBeInTheDocument();
    });

    it("renders 'no tasks filtered' placeholder when tasks exist but filter yields empty", () => {
      stubWorkspace([{ id: 1, taskName: "T1" }], []);
      render(<TasksSection {...makeProps()} />);
      expect(screen.getByText(t("en-US", "noTasksFiltered"))).toBeInTheDocument();
    });

    it("renders table when both tasks and filtered list are non-empty", () => {
      const task = { id: 1, taskName: "T1" };
      stubWorkspace([task], [task]);
      const { container } = render(<TasksSection {...makeProps()} />);
      expect(container.querySelector("table")).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run tests to confirm RED**

  Run: `npx vitest run src/app/tasks-section.test.tsx`
  Expected: 3 failures — `Cannot find module './tasks-section'`

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/tasks-section.test.tsx
  git commit -m "test(tasks-section): scaffold 3 failing smoke tests (RED)"
  ```

---

## Task 3: Create `tasks-section.tsx` — GREEN

**Files:**
- Create: `src/app/tasks-section.tsx`

- [ ] **Step 1: Create the file**

  `src/app/tasks-section.tsx`:
  ```typescript
  "use client";
  import type React from "react";
  import { type Lang, type TranslationKey, priorityLabel, t } from "./i18n";
  import { PRIORITIES, type Priority, type RaidItem } from "./types";
  import { type SortDir, type SortKey, useFilters } from "./filters-context";
  import { useWorkspace } from "./workspace-context";
  import { useTaskForm, type BulkEditDraft } from "./task-form-context";
  import { BulkEditModal } from "./bulk-edit-modal";
  import { RowContextProvider, TaskRow, type RowContextValue } from "./task-row";
  import { DEFAULT_COL_WIDTHS } from "./use-column-manager";
  import {
    EraserIcon,
    ResetColWidthsIcon,
    ResetSizeIcon,
    SortableTh,
    Th,
  } from "./task-manager-ui";

  const CONFIGURABLE_COLS: Array<{ key: string; labelKey: TranslationKey }> = [
    { key: "status",         labelKey: "colStatus" },
    { key: "id",             labelKey: "id" },
    { key: "assignee",       labelKey: "assignee" },
    { key: "startDate",      labelKey: "start" },
    { key: "dueDate",        labelKey: "due" },
    { key: "lastUpdateDate", labelKey: "lastUpdate" },
    { key: "priority",       labelKey: "priority" },
    { key: "blockers",       labelKey: "blockers" },
    { key: "notes",          labelKey: "notes" },
    { key: "depRelations",   labelKey: "depRelations" },
  ];

  const inputClass =
    "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

  export interface TasksSectionProps {
    lang: Lang;
    today: string;
    rowContextValue: RowContextValue;
    // column manager
    hiddenCols: Set<string>;
    setHiddenCols: React.Dispatch<React.SetStateAction<Set<string>>>;
    colWidths: Record<string, number>;
    colConfigOpen: boolean;
    setColConfigOpen: React.Dispatch<React.SetStateAction<boolean>>;
    colConfigRef: React.RefObject<HTMLDivElement>;
    startColResize: (col: string, e: React.MouseEvent) => void;
    resetColWidths: () => void;
    // resizable table
    tableRef: React.RefObject<HTMLElement>;
    resetTableSize: () => void;
    // row state
    expandedNotes: Set<number>;
    pushingIds: Set<number>;
    raidByTask: Map<number, RaidItem[]>;
    // jira
    jiraEnabled: boolean;
    jiraSyncing: boolean;
    jiraProjectKey: string;
    handleJiraSync: () => void;
    // task actions
    handleCancelEdit: () => void;
    setTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
    handleClearAll: () => void;
    // bulk operations
    selectedIds: Set<number>;
    allVisibleSelected: boolean;
    selectedJiraCount: number;
    toggleSelectAllVisible: () => void;
    clearSelection: () => void;
    handleBulkSendInquiry: () => void;
    applyBulkEdit: (draft: BulkEditDraft) => void;
    cancelBulkEdit: () => void;
  }

  export function TasksSection({
    lang,
    today,
    rowContextValue,
    hiddenCols,
    setHiddenCols,
    colWidths,
    colConfigOpen,
    setColConfigOpen,
    colConfigRef,
    startColResize,
    resetColWidths,
    tableRef,
    resetTableSize,
    expandedNotes,
    pushingIds,
    raidByTask,
    jiraEnabled,
    jiraSyncing,
    jiraProjectKey,
    handleJiraSync,
    handleCancelEdit,
    setTaskModalOpen,
    handleClearAll,
    selectedIds,
    allVisibleSelected,
    selectedJiraCount,
    toggleSelectAllVisible,
    clearSelection,
    handleBulkSendInquiry,
    applyBulkEdit,
    cancelBulkEdit,
  }: TasksSectionProps) {
    const {
      search, setSearch,
      priorityFilter, setPriorityFilter,
      assigneeFilter, setAssigneeFilter,
      groupFilter, setGroupFilter,
      labelFilter, setLabelFilter,
      sortKey, sortDir, setSortKey, setSortDir,
    } = useFilters();

    const { tasks, filteredSortedTasks, uniqueAssignees, uniqueGroups, uniqueLabels } =
      useWorkspace();

    const { editingId, bulkEditOpen, setBulkEditOpen } = useTaskForm();

    function toggleSort(key: SortKey) {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    }

    return (
      <section
        ref={tableRef}
        title={t(lang, "tableResizeHint")}
        className="mb-10 flex h-[560px] min-h-[300px] min-w-[520px] resize flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        {/* shrink-0 wrapper keeps header, filters and bulk-edit from growing into the table area */}
        <div className="shrink-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div ref={colConfigRef} className="relative">
              <button
                type="button"
                onClick={() => setColConfigOpen((o) => !o)}
                aria-label={t(lang, "colConfigTitle")}
                title={t(lang, "colConfigTitle")}
                aria-expanded={colConfigOpen}
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
                  <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.25 1.252a6.013 6.013 0 011.317.757l1.198-.42a1 1 0 011.15.376l1.18 2.044a1 1 0 01-.205 1.274l-.96.836a6.02 6.02 0 010 1.514l.96.836a1 1 0 01.205 1.274l-1.18 2.044a1 1 0 01-1.15.376l-1.198-.42a6.014 6.014 0 01-1.317.757l-.25 1.252a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.25-1.252a6.013 6.013 0 01-1.317-.757l-1.198.42a1 1 0 01-1.15-.376L2.745 13.3a1 1 0 01.205-1.274l.96-.836a6.023 6.023 0 010-1.514l-.96-.836a1 1 0 01-.205-1.274L3.925 5.52a1 1 0 011.15-.376l1.198.42a6.013 6.013 0 011.317-.757l.25-1.252zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                </svg>
              </button>
              {colConfigOpen && (
                <div
                  role="dialog"
                  aria-label={t(lang, "colConfigTitle")}
                  className="absolute left-0 top-full z-40 mt-1 w-52 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    {t(lang, "colConfigTitle")}
                  </p>
                  <ul className="space-y-1">
                    {CONFIGURABLE_COLS.map(({ key, labelKey }) => (
                      <li key={key}>
                        <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800">
                          <input
                            type="checkbox"
                            checked={!hiddenCols.has(key)}
                            onChange={() =>
                              setHiddenCols((prev) => {
                                const next = new Set(prev);
                                next.has(key) ? next.delete(key) : next.add(key);
                                return next;
                              })
                            }
                            className="h-3.5 w-3.5 rounded border-zinc-300 text-AIPM-dark-blue focus:ring-AIPM-dark-blue dark:border-zinc-600 dark:bg-zinc-800"
                          />
                          {t(lang, labelKey)}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
              {t(lang, "tasks")}{" "}
              {filteredSortedTasks.length !== tasks.length
                ? t(lang, "tasksCountFiltered", filteredSortedTasks.length, tasks.length)
                : t(lang, "tasksCount", filteredSortedTasks.length)}
            </h2>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                handleCancelEdit();
                setTaskModalOpen(true);
              }}
              aria-label={t(lang, "addTaskButton")}
              title={t(lang, "addTaskButton")}
              className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-AIPM-dark-blue/90"
            >
              + {t(lang, "addTaskButton")}
            </button>
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
                className="inline-flex items-center gap-1.5 rounded-md border border-AIPM-dark-blue bg-white px-3 py-1.5 text-sm font-medium text-AIPM-dark-blue shadow-sm hover:bg-AIPM-light-grey disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                  className={`h-4 w-4 ${jiraSyncing ? "animate-spin" : ""}`}
                >
                  <path
                    fillRule="evenodd"
                    d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z"
                    clipRule="evenodd"
                  />
                </svg>
                {jiraSyncing ? t(lang, "jiraSyncing") : t(lang, "jiraSync")}
              </button>
            )}
            <button
              type="button"
              onClick={resetTableSize}
              aria-label={t(lang, "tableResetSizeHint")}
              title={t(lang, "tableResetSizeHint")}
              className="rounded-md border border-zinc-300 bg-white p-1.5 text-zinc-500 shadow-sm hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <ResetSizeIcon />
            </button>
            <button
              type="button"
              onClick={resetColWidths}
              aria-label={t(lang, "colResetWidthsHint")}
              title={t(lang, "colResetWidthsHint")}
              className="rounded-md border border-zinc-300 bg-white p-1.5 text-zinc-500 shadow-sm hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <ResetColWidthsIcon />
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={tasks.length === 0}
              aria-label={t(lang, "clearAll")}
              title={t(lang, "clearAll")}
              className="rounded-md border border-zinc-300 bg-white p-1.5 text-zinc-500 shadow-sm hover:bg-zinc-50 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <EraserIcon />
            </button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t(lang, "searchPlaceholder")}
            className={inputClass}
          />
          <select
            value={priorityFilter}
            onChange={(e) =>
              setPriorityFilter(e.target.value as Priority | "All")
            }
            className={inputClass}
          >
            <option value="All">{t(lang, "allPriorities")}</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {priorityLabel(lang, p)}
              </option>
            ))}
          </select>
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className={inputClass}
          >
            <option value="All">{t(lang, "allAssignees")}</option>
            {uniqueAssignees.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className={inputClass}
          >
            <option value="All">{t(lang, "allGroups")}</option>
            <option value="">{t(lang, "groupNone")}</option>
            {uniqueGroups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <select
            value={labelFilter}
            onChange={(e) => setLabelFilter(e.target.value)}
            className={inputClass}
          >
            <option value="All">{t(lang, "allLabels")}</option>
            {uniqueLabels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {selectedIds.size > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-AIPM-medium-grey/40 bg-AIPM-light-grey p-3 dark:border-zinc-700 dark:bg-zinc-900">
            <span className="text-sm font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">
              {t(lang, "selectionCount", selectedIds.size)}
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleBulkSendInquiry}
                className="rounded-md bg-AIPM-green px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
              >
                {t(lang, "bulkSendInquiries")}
              </button>
              <button
                type="button"
                onClick={() => setBulkEditOpen((o) => !o)}
                aria-pressed={bulkEditOpen}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {t(lang, "bulkEdit")}
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {t(lang, "clearSelection")}
              </button>
            </div>
          </div>
        )}

        <BulkEditModal
          lang={lang}
          today={today}
          selectedIds={selectedIds}
          selectedJiraCount={selectedJiraCount}
          uniqueGroups={uniqueGroups}
          uniqueLabels={uniqueLabels}
          onApply={applyBulkEdit}
          onCancel={cancelBulkEdit}
        />

        </div>{/* end shrink-0 */}

        {tasks.length === 0 ? (
          <div className="flex-1 rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            {t(lang, "noTasks")}
          </div>
        ) : filteredSortedTasks.length === 0 ? (
          <div className="flex-1 rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            {t(lang, "noTasksFiltered")}
          </div>
        ) : (
          <div
            className="min-h-0 flex-1 w-full overflow-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
          >
            <RowContextProvider value={rowContextValue}>
              <table
                className="divide-y divide-zinc-200 text-left text-sm dark:divide-zinc-800"
                style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}
              >
              <colgroup>
                {(["sel","status","id","taskName","assignee","startDate","dueDate","lastUpdateDate","priority","blockers","notes","depRelations","actions"] as const)
                  .filter((col) => !hiddenCols.has(col))
                  .map((col) => (
                    <col key={col} style={{ width: colWidths[col] ?? DEFAULT_COL_WIDTHS[col] }} />
                  ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 shadow-sm dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <Th onResize={(e) => startColResize("sel", e)}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      aria-label={t(lang, "selectAllVisible")}
                      className="h-4 w-4 cursor-pointer rounded border-zinc-300 text-AIPM-dark-blue focus:ring-AIPM-dark-blue dark:border-zinc-600 dark:bg-zinc-800"
                    />
                  </Th>
                  {!hiddenCols.has("status") && <Th onResize={(e) => startColResize("status", e)}><span className="sr-only">Status</span></Th>}
                  {!hiddenCols.has("id") && <SortableTh label={t(lang, "id")} sortKey="id" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("id", e)} />}
                  <SortableTh label={t(lang, "task")} sortKey="taskName" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("taskName", e)} />
                  {!hiddenCols.has("assignee") && <SortableTh label={t(lang, "assignee")} sortKey="assignee" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("assignee", e)} />}
                  {!hiddenCols.has("startDate") && <SortableTh label={t(lang, "start")} sortKey="startDate" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("startDate", e)} />}
                  {!hiddenCols.has("dueDate") && <SortableTh label={t(lang, "due")} sortKey="dueDate" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("dueDate", e)} />}
                  {!hiddenCols.has("lastUpdateDate") && <SortableTh label={t(lang, "lastUpdate")} sortKey="lastUpdateDate" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("lastUpdateDate", e)} />}
                  {!hiddenCols.has("priority") && <SortableTh label={t(lang, "priority")} sortKey="priority" currentKey={sortKey} dir={sortDir} onClick={toggleSort} onResize={(e) => startColResize("priority", e)} />}
                  {!hiddenCols.has("blockers") && <Th onResize={(e) => startColResize("blockers", e)}>{t(lang, "blockers")}</Th>}
                  {!hiddenCols.has("notes") && <Th onResize={(e) => startColResize("notes", e)}>{t(lang, "notes")}</Th>}
                  {!hiddenCols.has("depRelations") && <Th onResize={(e) => startColResize("depRelations", e)}>{t(lang, "depRelations")}</Th>}
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {filteredSortedTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    isSelected={selectedIds.has(task.id)}
                    isEditing={editingId === task.id}
                    isExpanded={expandedNotes.has(task.id)}
                    isPushing={pushingIds.has(task.id)}
                    raidRefs={raidByTask.get(task.id)}
                  />
                ))}
              </tbody>
              </table>
            </RowContextProvider>
          </div>
        )}
      </section>
    );
  }
  ```

- [ ] **Step 2: Run tests to confirm GREEN**

  Run: `npx vitest run src/app/tasks-section.test.tsx`
  Expected: 3/3 PASS

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/tasks-section.tsx
  git commit -m "feat(tasks-section): implement TasksSection component (smoke tests GREEN)"
  ```

---

## Task 4: Refactor `task-manager.tsx`

**Files:**
- Modify: `src/app/task-manager.tsx`

- [ ] **Step 1: Add new imports**

  Add after the existing task-row import line:
  ```typescript
  import {
    TabButton,
    Th,
    SortableTh,
    ResetSizeIcon,
    ResetColWidthsIcon,
    EraserIcon,
  } from "./task-manager-ui";
  import { TasksSection } from "./tasks-section";
  ```

- [ ] **Step 2: Trim the `filters-context` import**

  Change:
  ```typescript
  import {
    FiltersProvider,
    type SortDir,
    type SortKey,
    useFilters,
  } from "./filters-context";
  ```
  To:
  ```typescript
  import { FiltersProvider } from "./filters-context";
  ```

- [ ] **Step 3: Remove `CONFIGURABLE_COLS`, `inputClass`, and `toggleSort`**

  Delete from `task-manager.tsx`:
  - The `const CONFIGURABLE_COLS: Array<...> = [ ... ];` block (~12 lines)
  - The `const inputClass = "...";` line
  - The `function toggleSort(key: SortKey) { ... }` block (~7 lines)

- [ ] **Step 4: Remove the `useFilters()` call entirely**

  Delete the entire `const { search, setSearch, priorityFilter, ... } = useFilters();` destructuring from `TaskManagerInner`. After the tasks section moves out, no filter state is read directly in `TaskManagerInner`.

- [ ] **Step 5: Trim `useWorkspace()` destructuring**

  Remove `filteredSortedTasks` and `uniqueAssignees` — both are now read inside `TasksSection`. Keep `tasks`, `setTasks`, `uniqueGroups`, `uniqueLabels` (still passed to `TaskFormModal`).

- [ ] **Step 6: Trim `useTaskForm()` destructuring**

  Remove `bulkEditOpen` and `setBulkEditOpen` — now read inside `TasksSection` via `useTaskForm()`. Keep `form`, `setForm`, `editingId`, `setEditingId`, `taskModalOpen`, `setTaskModalOpen`.

- [ ] **Step 7: Replace the tasks `<section>` with `<TasksSection />`**

  Find the `{!isPopout && (<section ref={tableRef} ...>...</section>)}` block (~lines 960–1269) and replace with:

  ```tsx
  {!isPopout && (
    <TasksSection
      lang={lang}
      today={today}
      rowContextValue={rowContextValue}
      hiddenCols={hiddenCols}
      setHiddenCols={setHiddenCols}
      colWidths={colWidths}
      colConfigOpen={colConfigOpen}
      setColConfigOpen={setColConfigOpen}
      colConfigRef={colConfigRef}
      startColResize={startColResize}
      resetColWidths={resetColWidths}
      tableRef={tableRef}
      resetTableSize={resetTableSize}
      expandedNotes={expandedNotes}
      pushingIds={pushingIds}
      raidByTask={raidByTask}
      jiraEnabled={settings.jira.enabled}
      jiraSyncing={jiraSyncing}
      jiraProjectKey={settings.jira.projectKey}
      handleJiraSync={handleJiraSync}
      handleCancelEdit={handleCancelEdit}
      setTaskModalOpen={setTaskModalOpen}
      handleClearAll={handleClearAll}
      selectedIds={selectedIds}
      allVisibleSelected={allVisibleSelected}
      selectedJiraCount={selectedJiraCount}
      toggleSelectAllVisible={toggleSelectAllVisible}
      clearSelection={clearSelection}
      handleBulkSendInquiry={handleBulkSendInquiry}
      applyBulkEdit={applyBulkEdit}
      cancelBulkEdit={cancelBulkEdit}
    />
  )}
  ```

- [ ] **Step 8: Remove the 6 UI component definitions**

  Delete `TabButton`, `ResetSizeIcon`, `ResetColWidthsIcon`, `EraserIcon`, `Th`, and `SortableTh` function definitions from the bottom of `task-manager.tsx` (~210 lines).

- [ ] **Step 9: Type-check and run full test suite**

  Run: `npx tsc --noEmit`
  Expected: 0 errors

  Run: `npx vitest run`
  Expected: all tests green (192+ tests — 189 prior + 3 new smoke tests)

- [ ] **Step 10: Commit**

  ```bash
  git add src/app/task-manager.tsx
  git commit -m "refactor(task-manager): replace tasks section JSX with TasksSection (-520 lines)"
  ```

---

## Task 5: Version bump v0.8.2 "Joyce"

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update `version.ts`**

  Prepend the milestone comment above the existing `0.8.1` comment block:
  ```typescript
  // 0.8.2 extracts 6 UI helper components (TabButton, Th, SortableTh,
  // ResetSizeIcon, ResetColWidthsIcon, EraserIcon) to task-manager-ui.tsx
  // and the entire tasks <section> JSX (~310 lines) to tasks-section.tsx.
  // TasksSection reads useFilters(), useWorkspace(), and useTaskForm()
  // internally; 31 explicit props for column manager, resizable table,
  // row state, Jira, task actions, and bulk operations. 3 smoke tests.
  // task-manager.tsx ~−520 lines; now ~1,185 lines. Slice 14.
  ```

  Change: `export const APP_VERSION = "0.8.1";` → `export const APP_VERSION = "0.8.2";`

- [ ] **Step 2: Prepend CHANGELOG entry**

  Add at the top of `CHANGELOG.md`:
  ```markdown
  ## [0.8.2] "Joyce" — 2026-05-21

  Extract `TabButton`, `Th`, `SortableTh`, `ResetSizeIcon`, `ResetColWidthsIcon`,
  `EraserIcon` to `task-manager-ui.tsx` and the entire tasks `<section>` JSX to
  `tasks-section.tsx`. `TasksSection` reads `useFilters()`, `useWorkspace()`, and
  `useTaskForm()` from providers internally; receives 31 explicit props for state that
  originates outside those contexts (column manager, resizable table, row state, Jira,
  task actions, bulk operations). 3 smoke tests. `task-manager.tsx` −520 lines; now
  ~1,185 lines. Slice 14 of the decomposition.
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/version.ts CHANGELOG.md
  git commit -m "release(v0.8.2): Joyce - TasksSection + UI component extraction"
  ```

---

## Spec-vs-Plan Checklist

| Spec requirement | Covered by |
|-----------------|-----------|
| Extract 6 UI components to `task-manager-ui.tsx` | Task 1 |
| Scaffold 3 failing smoke tests | Task 2 |
| Create `tasks-section.tsx` reading 3 contexts | Task 3 |
| `TasksSectionProps` interface with explicit props | Task 3 Step 1 |
| `CONFIGURABLE_COLS` and `inputClass` moved file-local | Task 3 Step 1 |
| `toggleSort` defined locally inside `TasksSection` | Task 3 Step 1 |
| Remove extracted code from `task-manager.tsx` | Task 4 |
| tsc clean + 189+ tests green | Task 4 Step 9 |
| Version bump v0.8.2 "Joyce" | Task 5 |

**Type correction:** `colWidths` is typed `Record<string, number>` throughout (the spec draft said `Record<string, number | undefined>` but `useColumnManager` returns `Record<string, number>`; the `??` fallback in the JSX is defensive style, not a type requirement).
