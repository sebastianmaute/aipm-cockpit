# Slice 8 — useResourcePlanner + useBulkOperations Implementation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract ~620 lines from task-manager.tsx into two focused hooks: `useResourcePlanner` (RAID/absence/shift CRUD) and `useBulkOperations` (selection, bulk edit, voice commands, bulk inquiry).

**Architecture:** Both hooks call context hooks (`useWorkspace`, `useTaskForm`, `useFilters`) internally and accept callbacks as args — identical pattern to slices 5–7. Each gets its own test file with ~12 tests. task-manager.tsx drops from ~2,813 to ~2,200 lines.

**Tech Stack:** React 19, TypeScript, Vitest 3, @testing-library/react 16, `renderHook` + `act`.

**Version target:** v0.7.6 "Duras"

---

## Phase A — useResourcePlanner

### File: `src/app/use-resource-planner.ts`

Owns: RAID CRUD, absence CRUD (including modal state), shift CRUD (including modal state), `handleCreateMitigationTaskFromRaid`.

Reads from context via `useWorkspace()`: `tasks`, `setTasks`, `raid`, `setRaid`, `absences`, `setAbsences`, `shifts`, `setShifts`.

Computes `today` internally via `todayISO()` (same import as task-manager.tsx uses).

```typescript
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { useWorkspace } from "./workspace-context";
import type { Absence, RaidItem, Shift, Task } from "./types";
import type { ActivityKind } from "./activity-log";

export interface UseResourcePlannerArgs {
  lang: Lang;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
}

export interface UseResourcePlannerReturn {
  editingAbsence: { absence: Absence; isNew: boolean } | null;
  editingShift: { shift: Shift; isNew: boolean } | null;
  handleSaveRaidItem: (item: RaidItem) => void;
  handleDeleteRaidItem: (id: number) => void;
  handleOpenAddAbsence: (seed?: Partial<Absence>) => void;
  handleEditAbsence: (absence: Absence) => void;
  handleCloseAbsenceModal: () => void;
  handleSaveAbsence: (next: Absence) => void;
  handleDeleteAbsence: (id: number) => void;
  handleOpenShiftEditor: (existing: Shift | null, seed: { display: string; email: string }) => void;
  handleCloseShiftModal: () => void;
  handleSaveShift: (next: Shift) => void;
  handleDeleteShift: (id: number) => void;
  handleCreateMitigationTaskFromRaid: (raidItemId: number) => number | null;
}
```

### Key implementation notes for useResourcePlanner

**`handleSaveRaidItem` — auto-issue on Risk→Realized transition:**
The auto-issue logic must be extracted faithfully:
- Only fires when `item.category === "R"` AND `previous.status !== "Realized"` AND `item.status === "Realized"` AND no existing Issue already lists this risk as a cause.
- New auto-issue gets `nextRaidId(baseList)` as its id (uses the RAID-specific id helper, NOT task nextId). Find `nextRaidId` in the codebase — it's a utility used in task-manager.tsx.
- Uses `showToast("info", t(lang, "raidAutoCreatedIssue", item.id, newIssueId))`.
- Activity log emits two entries when auto-issue fires: `"raid.statusChanged"` + `"raid.autoIssue"`.
- Use `langRef` pattern so `lang` changes don't re-register the callback.

**`handleCreateMitigationTaskFromRaid` — use tasksRef pattern:**
The original uses `tasksRef.current` to avoid depending on the frequently-rendered `tasks` array. In the hook, maintain an internal `tasksRef` synced via `useEffect`:

```typescript
const { tasks, setTasks, raid, setRaid, ... } = useWorkspace();
const tasksRef = useRef(tasks);
useEffect(() => { tasksRef.current = tasks; }, [tasks]);
```

Then `handleCreateMitigationTaskFromRaid` reads `tasksRef.current` for `nextId` computation.

**Utility functions:** Before writing the hook, grep for `nextRaidId`, `emptyAbsenceDraft`, `emptyShiftDraft`, `todayISO` in the codebase to find their exact import paths.

---

## Phase B — useBulkOperations

### File: `src/app/use-bulk-operations.ts`

Owns: `selectedIds` state, `onToggleSelect`, `toggleSelectAllVisible`, `clearSelection`, `cancelBulkEdit`, `applyBulkEdit`, `handleBulkSendInquiry`, `handleClearAll`, `handleCommand`.

Reads from context via:
- `useWorkspace()` → `tasks`, `setTasks`, `filteredSortedTasks`
- `useTaskForm()` → `bulkEdit`, `setBulkEdit`, `bulkEditOpen`, `setBulkEditOpen`, `setForm`, `setEditingId`, `setTaskModalOpen`
- `useFilters()` → `setSearch`

```typescript
"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import type { Settings } from "./settings-menu";
import type { Task } from "./types";
import type { ActivityKind } from "./activity-log";
import type { Command } from "./voice"; // grep for Command type to find exact import
import { useWorkspace } from "./workspace-context";
import { useTaskForm } from "./task-form-context";
import { useFilters } from "./filters-context";

export interface BulkRowHandlers {
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
  onSendInquiry: (task: Task) => void;
}

export interface UseBulkOperationsArgs {
  lang: Lang;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  handlers: BulkRowHandlers;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
}

export interface UseBulkOperationsReturn {
  selectedIds: Set<number>;
  allVisibleSelected: boolean;
  selectedJiraCount: number;
  onToggleSelect: (id: number) => void;
  toggleSelectAllVisible: () => void;
  clearSelection: () => void;
  cancelBulkEdit: () => void;
  applyBulkEdit: () => void;
  handleBulkSendInquiry: () => void;
  handleClearAll: () => void;
  handleCommand: (cmd: Command, originalText: string) => void;
}
```

### Key implementation notes for useBulkOperations

**`handleCommand` — inline cancelEdit:**
`handleCommand` calls `handleCancelEdit()` before opening a modal. Since the hook has `useTaskForm()` internally, implement cancel inline using context setters rather than passing it as an arg:
```typescript
// inline cancel (used inside "openForm" and "openFormWith" cases):
setEditingId(null);
setForm(emptyForm());
setTaskModalOpen(false);
```
Find `emptyForm` in the codebase (it's a factory for the empty form object).

**`allVisibleSelected` + `selectedJiraCount` — derived computations:**
```typescript
const visibleIds = useMemo(
  () => filteredSortedTasks.map((r) => r.id),
  [filteredSortedTasks]
);
const allVisibleSelected = useMemo(
  () => visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id)),
  [visibleIds, selectedIds]
);
const selectedJiraCount = useMemo(
  () => tasks.reduce((n, r) => (selectedIds.has(r.id) && r.jiraKey ? n + 1 : n), 0),
  [tasks, selectedIds]
);
```

**`applyBulkEdit` — reads `bulkEdit` from `useTaskForm()`:**
No parameters — all state comes from context and owned `selectedIds`. Grep for sanitize helpers (`sanitizeIsoDate`, `sanitizePriority`, `sanitizeAssignee`, etc.) to find their import paths.

**`handleClearAll`:**
```typescript
function handleClearAll() {
  if (tasks.length === 0) return;
  if (!window.confirm(t(langRef.current, "confirmClearAll", tasks.length))) return;
  setTasks([]);
  setSelectedIds(new Set());
  setEditingId(null);
  setForm(emptyForm());
  setTaskModalOpen(false);
}
```

**`langRef` pattern:**
```typescript
const langRef = useRef(args.lang);
useEffect(() => { langRef.current = args.lang; }, [args.lang]);
```
Use `langRef.current` in all handlers so `lang` changes don't re-register callbacks.

---

## task-manager.tsx changes

**Remove (~620 lines):**
- `selectedIds` useState (line ~375)
- `onToggleSelect` useCallback (line ~432)
- `editingAbsence` useState (line ~950)
- `editingShift` useState (line ~1029)
- All RAID handlers: `handleSaveRaidItem`, `handleDeleteRaidItem` (lines ~855–942)
- All absence handlers: `handleOpenAddAbsence`, `handleEditAbsence`, `handleCloseAbsenceModal`, `handleSaveAbsence`, `handleDeleteAbsence` (lines ~954–1020)
- All shift handlers: `handleOpenShiftEditor`, `handleCloseShiftModal`, `handleSaveShift`, `handleDeleteShift` (lines ~1033–1087)
- `handleCreateMitigationTaskFromRaid` (lines ~1095–1135)
- `handleClearAll` (lines ~1375–1381)
- `handleCommand` (lines ~1383–1437)
- `toggleSelectAllVisible`, `clearSelection`, `cancelBulkEdit`, `applyBulkEdit` (lines ~1447–1531)
- `handleBulkSendInquiry` (lines ~1533–1642)
- `allVisibleSelected`, `selectedJiraCount` inline computations (lines ~1439–1445)

**Add (~6 lines):**
```typescript
import { useResourcePlanner } from "./use-resource-planner";
import { useBulkOperations } from "./use-bulk-operations";

// after useStorageBackend call site:
const {
  editingAbsence, editingShift,
  handleSaveRaidItem, handleDeleteRaidItem,
  handleOpenAddAbsence, handleEditAbsence, handleCloseAbsenceModal,
  handleSaveAbsence, handleDeleteAbsence,
  handleOpenShiftEditor, handleCloseShiftModal, handleSaveShift, handleDeleteShift,
  handleCreateMitigationTaskFromRaid,
} = useResourcePlanner({ lang, logActivity, showToast });

const {
  selectedIds, allVisibleSelected, selectedJiraCount,
  onToggleSelect, toggleSelectAllVisible, clearSelection,
  cancelBulkEdit, applyBulkEdit, handleBulkSendInquiry, handleClearAll, handleCommand,
} = useBulkOperations({
  lang, settings, setSettings,
  handlers: { onEdit: handleEdit, onDelete, onSendInquiry },
  logActivity, showToast,
});
```

**Note on `tasksRef`:** task-manager.tsx currently maintains its own `tasksRef` (used by other hooks). After extraction, verify whether `tasksRef` is still needed in task-manager. If `useResourcePlanner` and all other consumers of `tasksRef` are in hooks, the task-manager copy can be removed.

---

## Testing

### `src/app/use-resource-planner.test.tsx`

Render pattern:
```typescript
import { renderHook, act } from "@testing-library/react";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { useResourcePlanner, type UseResourcePlannerArgs } from "./use-resource-planner";
import { defaultSettings } from "./settings-menu"; // adjust import
import type { Lang } from "./i18n";

function renderPlanner(overrides?: Partial<UseResourcePlannerArgs>) {
  const logActivity = vi.fn();
  const showToast = vi.fn();
  const args: UseResourcePlannerArgs = {
    lang: "en-US" as Lang,
    logActivity,
    showToast,
    ...overrides,
  };
  const { result } = renderHook(
    () => ({
      planner: useResourcePlanner(args),
      workspace: useWorkspace(),
    }),
    { wrapper: WorkspaceProvider }
  );
  return { result, logActivity, showToast };
}
```

**Required tests (12):**
1. `editingAbsence` and `editingShift` are null initially
2. `handleOpenAddAbsence()` → `editingAbsence.isNew === true`, id is monotonically assigned
3. `handleEditAbsence(absence)` → `editingAbsence.isNew === false`, same object
4. `handleCloseAbsenceModal()` → `editingAbsence === null`
5. `handleSaveAbsence(newAbsence)` adds to `workspace.absences`, logs `"absence.created"`
6. `handleSaveAbsence(existingAbsence)` updates in place, logs `"absence.updated"`
7. `handleDeleteAbsence(id)` removes from `workspace.absences`, logs `"absence.deleted"`, clears modal
8. `handleSaveShift(newShift)` adds to `workspace.shifts`, logs `"shift.created"`
9. `handleDeleteShift(id)` removes from `workspace.shifts`, logs `"shift.deleted"`
10. `handleSaveRaidItem(newItem)` adds to `workspace.raid`, logs `"raid.created"`
11. `handleSaveRaidItem(item)` with Risk→Realized transition: auto-issue added to raid, `showToast` called, logs `"raid.statusChanged"` + `"raid.autoIssue"`
12. `handleCreateMitigationTaskFromRaid(raidItemId)`: new task added to `workspace.tasks`, `raid[0].linkedTaskIds` contains new task id, returns the new task id

### `src/app/use-bulk-operations.test.tsx`

Render pattern (needs all three providers):
```typescript
import { renderHook, act } from "@testing-library/react";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { TaskFormProvider } from "./task-form-context";
import { FiltersProvider } from "./filters-context";
import { useBulkOperations, type UseBulkOperationsArgs } from "./use-bulk-operations";
import { defaultSettings } from "./settings-menu";
import type { Lang } from "./i18n";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <FiltersProvider>
        <TaskFormProvider>{children}</TaskFormProvider>
      </FiltersProvider>
    </WorkspaceProvider>
  );
}

function renderBulk(overrides?: Partial<UseBulkOperationsArgs>) {
  const handlers = { onEdit: vi.fn(), onDelete: vi.fn(), onSendInquiry: vi.fn() };
  const setSettings = vi.fn();
  const logActivity = vi.fn();
  const showToast = vi.fn();
  const args: UseBulkOperationsArgs = {
    lang: "en-US" as Lang,
    settings: defaultSettings,
    setSettings,
    handlers,
    logActivity,
    showToast,
    ...overrides,
  };
  const { result } = renderHook(
    () => ({ bulk: useBulkOperations(args), workspace: useWorkspace() }),
    { wrapper: Wrapper }
  );
  return { result, handlers, setSettings, logActivity, showToast };
}
```

**Required tests (12):**
1. `selectedIds` is empty initially; `allVisibleSelected` is false
2. `onToggleSelect(id)` adds id; calling again removes it (toggle)
3. `clearSelection()` empties `selectedIds`
4. `toggleSelectAllVisible()` selects all filtered tasks; calling again deselects
5. `applyBulkEdit()` shows toast "no fields" when no bulk-edit fields enabled
6. `applyBulkEdit()` patches all selected tasks with enabled fields + logs `"bulk.edit"` + clears selection
7. `handleClearAll()` does nothing when `tasks.length === 0`
8. `handleClearAll()` with `window.confirm` returning true: clears tasks and selectedIds
9. `handleClearAll()` with `window.confirm` returning false: tasks unchanged
10. `handleCommand({ kind: "edit", id: <taskId> }, "")` calls `handlers.onEdit` with matching task
11. `handleCommand({ kind: "search", query: "foo" }, "")` updates search filter to `"foo"`
12. `handleBulkSendInquiry()` with selected tasks that have emails: calls `window.open` with mailto links + logs `"bulk.inquiries"` + clears selection

---

## Commit sequence

```
test(use-resource-planner): scaffold test file + 2 state-init tests (RED)
feat(use-resource-planner): create hook skeleton (GREEN)
test(use-resource-planner): add RAID + absence + shift handler tests (RED)
feat(use-resource-planner): implement all CRUD handlers (GREEN)
test(use-bulk-operations): scaffold test file + state-init tests (RED)
feat(use-bulk-operations): create hook skeleton (GREEN)
test(use-bulk-operations): add bulk handler + command tests (RED)
feat(use-bulk-operations): implement all bulk handlers (GREEN)
refactor(task-manager): consume useResourcePlanner + useBulkOperations
release(v0.7.6): Duras - useResourcePlanner + useBulkOperations extraction
```
