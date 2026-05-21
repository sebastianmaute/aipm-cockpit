# Slice 14 — TasksSection + UI Component Extraction Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the tasks `<section>` JSX and the inline UI helper components from `task-manager.tsx` into two new files, reducing `task-manager.tsx` by ~520 lines (from ~1,705 to ~1,185 lines).

**Version bump:** v0.8.2 "Joyce"

---

## Motivation

Slices 5–13 extracted all extractable hooks from `TaskManagerInner`. The remaining bulk is JSX. The tasks `<section>` (~310 lines: toolbar, filter row, bulk-edit bar, resizable table with column headers and `TaskRow`s) and the six UI helper components at the bottom of the file (~210 lines: `TabButton`, `Th`, `SortableTh`, three icon components) are the two largest independent chunks.

---

## New Files

### `src/app/task-manager-ui.tsx`

Pure presentational components with no hooks or state. Moved verbatim from the bottom of `task-manager.tsx`.

Exports:
- `TabButton` — workspace tab strip button with optional popout icon
- `Th` — table header cell with optional column-resize handle
- `SortableTh` — sortable table header cell with sort indicator + resize handle
- `ResetSizeIcon` — SVG icon for "reset panel size"
- `ResetColWidthsIcon` — SVG icon for "reset column widths"
- `EraserIcon` — SVG icon for "clear all tasks"

No tests needed — pure SVG/JSX, zero logic.

### `src/app/tasks-section.tsx`

Renders the entire tasks `<section>`: toolbar row (col-config dropdown, task count, Add Task / Jira Sync / reset buttons), filter row (search + 4 selects), bulk-edit selection bar, `BulkEditModal`, and the resizable table with `colgroup`, `thead`, `tbody` / empty states.

**Context consumed internally** (component must be rendered inside all three providers):
- `useFilters()` — search, filters, sort state (`sortKey`, `sortDir`, `setSortKey`, `setSortDir`), setters
- `useWorkspace()` — `tasks`, `filteredSortedTasks`, `uniqueAssignees`, `uniqueGroups`, `uniqueLabels`
- `useTaskForm()` — `editingId`, `bulkEditOpen`, `setBulkEditOpen`

`toggleSort` is defined locally inside `TasksSection` using `setSortKey`/`setSortDir` from `useFilters()`.

File-local constants (moved from `task-manager.tsx`):
- `CONFIGURABLE_COLS` — the 10-entry column config array
- `inputClass` — shared CSS string for filter inputs/selects

---

## `TasksSectionProps` Interface

```typescript
export interface TasksSectionProps {
  lang: Lang;
  today: string;
  rowContextValue: RowContextValue;
  // column manager
  hiddenCols: Set<string>;
  setHiddenCols: React.Dispatch<React.SetStateAction<Set<string>>>;
  colWidths: Record<string, number | undefined>;
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
```

`BulkEditDraft` is imported from `./task-form-context`. `RaidItem` from `./types`. `RowContextValue` from `./task-row`.

---

## Changes to `task-manager.tsx`

**Remove:**
- `TabButton`, `Th`, `SortableTh`, `ResetSizeIcon`, `ResetColWidthsIcon`, `EraserIcon` function definitions (~210 lines)
- The entire tasks `<section>` JSX block (~310 lines)
- `CONFIGURABLE_COLS` constant
- `inputClass` constant
- `toggleSort` function (moves into `TasksSection`)

**Add:**
- `import { TabButton, Th, SortableTh, ResetSizeIcon, ResetColWidthsIcon, EraserIcon } from "./task-manager-ui";`
- `import { TasksSection } from "./tasks-section";`
- Replace the tasks `<section>` JSX with `<TasksSection ... />` (28 props)

**Net:** ~−520 lines; `task-manager.tsx` ~1,185 lines.

---

## Testing

**`src/app/tasks-section.test.tsx`** — 3 smoke tests, all wrapping in `FiltersProvider` + `WorkspaceProvider` + `TaskFormProvider` with minimal stub props for `TasksSectionProps`:

1. **Empty state** — `tasks = []` in context → renders the "no tasks" empty placeholder text
2. **Filtered-empty state** — `tasks` non-empty but `filteredSortedTasks = []` → renders the "no tasks match filter" placeholder
3. **Table renders** — both `tasks` and `filteredSortedTasks` non-empty → `<table>` element is present in the DOM

No interaction tests (sort, filter, bulk-select) — those behaviours live in `useFilters`, `useBulkOperations`, `useTaskRowHandlers` which have their own suites.

---

## Task Breakdown

1. **Create `task-manager-ui.tsx`** — move 6 UI helper components verbatim; commit
2. **Scaffold `tasks-section.test.tsx`** — 3 failing smoke tests (RED); commit
3. **Create `tasks-section.tsx`** — implement `TasksSection` (tests go GREEN); commit
4. **Refactor `task-manager.tsx`** — remove extracted code, add imports, replace tasks section with `<TasksSection />`; tsc clean, 189+ tests green; commit
5. **Version bump** — `version.ts` → `"0.8.2"`, CHANGELOG entry; commit
