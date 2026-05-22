# Slice 16 — AppModals + RowContext Promotion Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the modal layer (5 modals + DueBanner + footer + toast) into an `AppModals` component, and move `rowContextValue` construction from `TaskManagerInner` into `TasksSection`, completing the main structural decomposition of `task-manager.tsx`.

**Version bump:** v0.8.4 (codename TBD at version-bump task)

---

## Motivation

After Slice 15 (v0.8.3 "Kafka"), `task-manager.tsx` is 593 lines. Two things remain inline in `TaskManagerInner`:

1. **Modal layer (~120 lines of JSX):** `DueBanner` + `TaskFormModal` + `DueDatesModal` + `JiraConflictsModal` + `AbsenceEditModal` + `ShiftEditModal` + `<footer>` + toast `<div>`. These are unrelated to one another and clutter the return statement.

2. **`rowContextValue` useMemo (18 lines):** A 14-field object assembled from hooks already called throughout `TaskManagerInner`, threaded into `TasksSection` as a single opaque prop. Moving this assembly into `TasksSection` (where it is consumed) improves cohesion and removes the `RowContextValue` boundary from the `TaskManagerInner` → `TasksSection` interface.

---

## New Files

### `src/app/app-modals.tsx`

Renders the modal layer. Reads `useTaskForm()` internally for `TaskFormModal` (which already reads `taskModalOpen`, `form`, `editingId` from `TaskFormContext`). Receives all other state as explicit props.

**Conditional rendering rules:**
- `DueBanner`: `!isPopout && !bannerDismissed`
- `TaskFormModal`: always rendered (open state managed internally via `useTaskForm()`)
- `DueDatesModal`: `dueModalOpen`
- `JiraConflictsModal`: `jiraConflicts.length > 0`
- `AbsenceEditModal`: `editingAbsence !== null`
- `ShiftEditModal`: `editingShift !== null`
- `<footer>`: `!isPopout`
- toast `<div>`: `toast !== null`

**Props interface:**

```typescript
interface AppModalsProps {
  lang: Lang
  isPopout: boolean

  // banner
  bannerDismissed: boolean
  setBannerDismissed: React.Dispatch<React.SetStateAction<boolean>>
  bannerItems: AlertableTask[]
  setDueModalOpen: React.Dispatch<React.SetStateAction<boolean>>

  // due dates modal
  dueModalOpen: boolean
  dueModalItems: AlertableTask[]
  onSelectDueTask: (taskId: number) => void  // opens edit modal then closes due modal
  onCloseDueModal: () => void

  // jira conflicts modal
  jiraConflicts: JiraConflict[]
  handleResolveConflicts: () => void
  clearConflicts: () => void

  // absence modal
  editingAbsence: { absence: Absence; isNew: boolean } | null
  absenceKnownAssignees: { name: string; email: string }[]
  handleSaveAbsence: (a: Absence) => void
  handleDeleteAbsence: (id: string) => void
  handleCloseAbsenceModal: () => void

  // shift modal
  editingShift: { shift: Shift; isNew: boolean } | null
  shiftKnownAssignees: { name: string; email: string }[]
  shiftExistingAssigneeKeys: Set<string>
  handleSaveShift: (s: Shift) => void
  handleDeleteShift: (id: string) => void
  handleCloseShiftModal: () => void

  // TaskFormModal remaining props (taskModalOpen comes from useTaskForm())
  today: string
  nextId: number
  contactsList: ContactEntry[]
  absences: Absence[]
  tasksForDeps: Task[]
  uniqueGroups: string[]
  uniqueLabels: string[]
  editingIsJiraLinked: boolean
  jiraEnabled: boolean
  error: string | null
  holidaySet: Set<string>
  jiraProjectKey: string
  jiraDefaultIssueType: string
  modalRef: React.RefObject<HTMLElement | null>
  handleSubmit: (f: TaskForm) => void
  handleCancelEdit: () => void
  handleRemoveContact: (email: string) => void
  showToast: ShowToast

  // toast
  toast: Toast | null
}
```

**Note on `absenceKnownAssignees` / `shiftKnownAssignees`:** `TaskManagerInner` computes these inline in the JSX today (mapping `tasks`, `absences`, `shifts`). Move the computation into `TaskManagerInner` as two `useMemo` calls and pass the results as props, rather than having `AppModals` read `useWorkspace()`.

### `src/app/app-modals.test.tsx`

~8 tests. Wrap with `FiltersProvider > WorkspaceProvider > TaskFormProvider > WorkspaceTabProvider` to satisfy `useTaskForm()`.

Tests:
1. Smoke: renders without error when all flags off/null
2. Renders `DueBanner` when `bannerDismissed: false`, hidden when `true`
3. `setBannerDismissed(true)` called when banner dismissed
4. Renders `DueDatesModal` when `dueModalOpen: true`
5. Renders `JiraConflictsModal` when `jiraConflicts.length > 0`
6. Renders `AbsenceEditModal` when `editingAbsence` non-null
7. Renders `ShiftEditModal` when `editingShift` non-null
8. Footer present when `isPopout: false`, absent when `isPopout: true`

---

## Modified Files

### `src/app/tasks-section.tsx`

**Interface change:**

Remove:
```typescript
rowContextValue: RowContextValue
```

Add:
```typescript
// row context callbacks (from useTaskRowHandlers / useBulkOperations in TaskManagerInner)
onToggleSelect: (id: number) => void
onToggleNoteExpanded: (id: number) => void
onJumpToRaid: (taskId: number) => void
onToggleComplete: (id: number) => void
onSendInquiry: (id: number) => void
onPushToJira: (id: number) => Promise<boolean>
onEdit: (task: Task) => void
onDelete: (id: number) => void

// row context data not already in TasksSectionProps
jiraSiteUrl: string   // jiraEnabled + jiraProjectKey already present as props
```

**Internal additions:**
- Add `tasksById` to the existing `useWorkspace()` destructure (line 117 already calls `useWorkspace()`).
- Call `useSettings()` to read `settings.holidayCountries` (needed by `useHolidaySet`).
- Call `useHolidaySet({ holidayCountries: settings.holidayCountries })` to get `holidaySet`.
- Build `rowContextValue` useMemo from: existing props `lang`, `today`, `hiddenCols`, `jiraEnabled`, `jiraProjectKey`; new prop `jiraSiteUrl`; internal `holidaySet`, `tasksById`; and the 8 callback props.

**Note:** `useTaskRowHandlers` is NOT moved into `TasksSection`. It stays in `TaskManagerInner` because its outputs (`expandedNotes`, `pushingIds`, `handleClearRaidTaskFilter`, `handleJumpToTaskFromRaid`) are used by `TaskManagerInner` and `WorkspaceSection`. The 8 callbacks flow as explicit props.

### `src/app/tasks-section.test.tsx`

- Drop `rowContextValue` from `makeProps()` fixture.
- Add the 8 callback props as `vi.fn()` stubs.
- Add `jiraSiteUrl: ""` to `makeProps()`.
- Stub `useHolidaySet` returning `{ holidaySet: new Set() }`.
- Stub `useSettings` returning minimal settings with `holidayCountries: []` (same pattern as other test files).

### `src/app/task-manager.tsx`

**Remove:**
- `rowContextValue` useMemo (~18 lines, lines 319–356).
- The ~120-line modal/banner/footer/toast JSX block.
- Import for `type RowContextValue` from `./task-row` (no longer needed in this file).

**Add:**
- Import `AppModals` from `./app-modals`.
- Two `useMemo` calls for `absenceKnownAssignees` and `shiftKnownAssignees` (extracted from inline JSX).
- `<AppModals .../>` in JSX (replaces the removed block).

**Change:**
- `<TasksSection>`: replace `rowContextValue={rowContextValue}` with the 8 callback props + `jiraSiteUrl={settings.jira.siteUrl}`.

**Unchanged:**
- Outer `<div>` container, `<WorkspaceSection>`, structural wrappers — all stay inline.
- Provider tree in default export — unchanged.

---

## Data Flow After Slice 16

```
TaskManagerInner (owns all hook calls, modal useState)
  ├── <AppModals>
  │     reads useTaskForm() → TaskFormModal
  │     receives modal state / callbacks as props
  │     renders DueBanner, 5 modals, footer, toast
  │
  ├── <WorkspaceSection>  (unchanged from Slice 15)
  │
  └── <TasksSection>
        reads useWorkspace()   → tasks, filteredSortedTasks, tasksById
        reads useSettings()    → holidayCountries
        reads useHolidaySet()  → holidaySet
        receives 8 callbacks + jiraSiteUrl from TaskManagerInner as props
        builds rowContextValue useMemo internally
        wraps table with <RowContextProvider value={rowContextValue}>
```

---

## Testing

All existing tests must remain green. Key new coverage:

| File | New/Modified | Key assertions |
|------|-------------|----------------|
| `app-modals.test.tsx` | New, ~8 tests | Conditional rendering per flag |
| `tasks-section.test.tsx` | Modify fixture | rowContextValue removed, callbacks added |
| `task-manager.test.tsx` | Modify fixture if props change | Smoke pass |

---

## Tasks (for implementation plan)

1. Create `app-modals.tsx` + `app-modals.test.tsx`
2. Update `tasks-section.tsx` + `tasks-section.test.tsx` — remove `rowContextValue` prop, add callbacks + internal hooks
3. Refactor `task-manager.tsx` — add `<AppModals>`, remove `rowContextValue` useMemo, thread callbacks to `TasksSection`
4. Version bump v0.8.4 + CHANGELOG
