# Slice 16 — AppModals + RowContext Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the modal layer (DueBanner + 5 modals + footer + toast) from `task-manager.tsx` into a new `AppModals` component, and move `rowContextValue` construction into `TasksSection` where it is consumed.

**Architecture:** `AppModals` renders all conditional overlays and reads `useTaskForm()` internally for `TaskFormModal`; everything else arrives as props. `TasksSection` adds `useSettings()` + `useHolidaySet()` calls internally and builds the `rowContextValue` useMemo from those + 8 new callback props, removing the single opaque `rowContextValue` prop. `TaskManagerInner` loses ~140 lines.

**Tech Stack:** React 19, TypeScript, Vitest + React Testing Library, Next.js `dynamic()` for lazy-loaded modals

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/app/app-modals.tsx` | **Create** | Render DueBanner, TaskFormModal, DueDatesModal, JiraConflictsModal, AbsenceEditModal, ShiftEditModal, footer, toast |
| `src/app/app-modals.test.tsx` | **Create** | 8 conditional-rendering tests |
| `src/app/tasks-section.tsx` | **Modify** | Remove `rowContextValue` prop; add 8 callback props + `jiraSiteUrl`; call `useSettings()` + `useHolidaySet()` internally; build `rowContextValue` useMemo |
| `src/app/tasks-section.test.tsx` | **Modify** | Update fixture: drop `rowContextValue`, add callbacks + `jiraSiteUrl`; mock `useSettings` + `useHolidaySet` |
| `src/app/task-manager.tsx` | **Modify** | Import `AppModals`; remove `rowContextValue` useMemo; add `onSelectDueTask` callback + two knownAssignees useMemos; replace ~120 JSX lines with `<AppModals>`; thread 8 callbacks + `jiraSiteUrl` to `<TasksSection>` |
| `src/app/version.ts` | **Modify** | Bump to 0.8.4 "Lorca" |
| `CHANGELOG.md` | **Modify** | Add 0.8.4 entry |

---

## Task 1: Create `app-modals.tsx` + `app-modals.test.tsx`

**Files:**
- Create: `src/app/app-modals.tsx`
- Create: `src/app/app-modals.test.tsx`

---

- [ ] **Step 1: Write `app-modals.test.tsx` (8 failing tests)**

```typescript
// src/app/app-modals.test.tsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppModals, type AppModalsProps } from "./app-modals";

// Mock all child components so tests focus on conditional rendering only.
vi.mock("./notifications", () => ({
  DueBanner: () => <div data-testid="due-banner" />,
  DueDatesModal: () => <div data-testid="due-dates-modal" />,
}));
vi.mock("./task-form-modal", () => ({
  TaskFormModal: () => <div data-testid="task-form-modal" />,
}));
// Dynamic imports are intercepted by vi.mock at the module level.
vi.mock("./jira-conflicts-modal", () => ({
  JiraConflictsModal: () => <div data-testid="jira-conflicts-modal" />,
}));
vi.mock("./absence-edit-modal", () => ({
  AbsenceEditModal: () => <div data-testid="absence-edit-modal" />,
}));
vi.mock("./shift-edit-modal", () => ({
  ShiftEditModal: () => <div data-testid="shift-edit-modal" />,
}));
// TaskFormModal calls useTaskForm() internally; mock it.
vi.mock("./task-form-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./task-form-context")>();
  return { ...actual, useTaskForm: vi.fn() };
});
import { useTaskForm, emptyForm, emptyBulkEdit } from "./task-form-context";
const mockUseTaskForm = useTaskForm as ReturnType<typeof vi.fn>;

function stubTaskForm() {
  mockUseTaskForm.mockReturnValue({
    form: emptyForm(), setForm: vi.fn(),
    editingId: null, setEditingId: vi.fn(),
    taskModalOpen: false, setTaskModalOpen: vi.fn(),
    bulkEdit: emptyBulkEdit(), setBulkEdit: vi.fn(),
    bulkEditOpen: false, setBulkEditOpen: vi.fn(),
  });
}

function makeProps(): AppModalsProps {
  return {
    lang: "en-US",
    isPopout: false,
    bannerDismissed: true,
    setBannerDismissed: vi.fn(),
    bannerItems: [],
    setDueModalOpen: vi.fn(),
    dueModalOpen: false,
    dueModalItems: [],
    onSelectDueTask: vi.fn(),
    onCloseDueModal: vi.fn(),
    jiraConflicts: [],
    handleResolveConflicts: vi.fn(),
    clearConflicts: vi.fn(),
    editingAbsence: null,
    absenceKnownAssignees: [],
    handleSaveAbsence: vi.fn(),
    handleDeleteAbsence: vi.fn(),
    handleCloseAbsenceModal: vi.fn(),
    editingShift: null,
    shiftKnownAssignees: [],
    shiftExistingAssigneeKeys: new Set(),
    handleSaveShift: vi.fn(),
    handleDeleteShift: vi.fn(),
    handleCloseShiftModal: vi.fn(),
    today: "2026-05-22",
    nextId: 1,
    contactsList: [],
    absences: [],
    tasksForDeps: [],
    uniqueGroups: [],
    uniqueLabels: [],
    editingIsJiraLinked: false,
    jiraEnabled: false,
    error: null,
    holidaySet: new Set(),
    jiraProjectKey: undefined,
    jiraDefaultIssueType: undefined,
    modalRef: React.createRef<HTMLDivElement>(),
    handleSubmit: vi.fn(),
    handleCancelEdit: vi.fn(),
    handleRemoveContact: vi.fn(),
    showToast: vi.fn(),
    toast: null,
  };
}

describe("AppModals", () => {
  it("renders TaskFormModal unconditionally", () => {
    stubTaskForm();
    render(<AppModals {...makeProps()} />);
    expect(screen.getByTestId("task-form-modal")).toBeInTheDocument();
  });

  it("hides DueBanner when bannerDismissed is true", () => {
    stubTaskForm();
    render(<AppModals {...makeProps()} bannerDismissed={true} isPopout={false} bannerItems={[{ taskId: 1, taskName: "T", daysUntilDue: 1, category: "soon" }]} />);
    expect(screen.queryByTestId("due-banner")).not.toBeInTheDocument();
  });

  it("shows DueBanner when bannerDismissed is false and isPopout is false", () => {
    stubTaskForm();
    render(<AppModals {...makeProps()} bannerDismissed={false} isPopout={false} bannerItems={[{ taskId: 1, taskName: "T", daysUntilDue: 1, category: "soon" }]} />);
    expect(screen.getByTestId("due-banner")).toBeInTheDocument();
  });

  it("shows DueDatesModal when dueModalOpen is true", () => {
    stubTaskForm();
    render(<AppModals {...makeProps()} dueModalOpen={true} />);
    expect(screen.getByTestId("due-dates-modal")).toBeInTheDocument();
  });

  it("shows JiraConflictsModal when jiraConflicts is non-empty", () => {
    stubTaskForm();
    render(<AppModals {...makeProps()} jiraConflicts={[{} as any]} />);
    expect(screen.getByTestId("jira-conflicts-modal")).toBeInTheDocument();
  });

  it("shows AbsenceEditModal when editingAbsence is non-null", () => {
    stubTaskForm();
    render(<AppModals {...makeProps()} editingAbsence={{ absence: {} as any, isNew: false }} />);
    expect(screen.getByTestId("absence-edit-modal")).toBeInTheDocument();
  });

  it("shows ShiftEditModal when editingShift is non-null", () => {
    stubTaskForm();
    render(<AppModals {...makeProps()} editingShift={{ shift: {} as any, isNew: false }} />);
    expect(screen.getByTestId("shift-edit-modal")).toBeInTheDocument();
  });

  it("shows footer when isPopout is false, hides it when isPopout is true", () => {
    stubTaskForm();
    const { rerender } = render(<AppModals {...makeProps()} isPopout={false} />);
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    rerender(<AppModals {...makeProps()} isPopout={true} />);
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/app/app-modals.test.tsx
```

Expected: FAIL — `Cannot find module './app-modals'`

- [ ] **Step 3: Create `src/app/app-modals.tsx`**

```typescript
"use client";

import dynamic from "next/dynamic";
import { type RefObject } from "react";
import type React from "react";
import type { listContacts } from "./contacts";
import { type Lang } from "./i18n";
import { DueBanner, DueDatesModal } from "./notifications";
import { TaskFormModal } from "./task-form-modal";
import type { AlertableTask } from "./due-dates";
import type { ConflictItem } from "./jira-api";
import type { Absence, Shift, Task } from "./types";

const JiraConflictsModal = dynamic(
  () => import("./jira-conflicts-modal").then((m) => m.JiraConflictsModal),
  { ssr: false },
);
const AbsenceEditModal = dynamic(
  () => import("./absence-edit-modal").then((m) => m.AbsenceEditModal),
  { ssr: false },
);
const ShiftEditModal = dynamic(
  () => import("./shift-edit-modal").then((m) => m.ShiftEditModal),
  { ssr: false },
);

export interface AppModalsProps {
  lang: Lang;
  isPopout: boolean;

  // DueBanner
  bannerDismissed: boolean;
  setBannerDismissed: React.Dispatch<React.SetStateAction<boolean>>;
  bannerItems: AlertableTask[];
  setDueModalOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // DueDatesModal
  dueModalOpen: boolean;
  dueModalItems: AlertableTask[];
  onSelectDueTask: (taskId: number) => void;
  onCloseDueModal: () => void;

  // JiraConflictsModal
  jiraConflicts: ConflictItem[];
  handleResolveConflicts: () => void;
  clearConflicts: () => void;

  // AbsenceEditModal
  editingAbsence: { absence: Absence; isNew: boolean } | null;
  absenceKnownAssignees: ReadonlyArray<{ name: string; email?: string }>;
  handleSaveAbsence: (a: Absence) => void;
  handleDeleteAbsence: (id: number) => void;
  handleCloseAbsenceModal: () => void;

  // ShiftEditModal
  editingShift: { shift: Shift; isNew: boolean } | null;
  shiftKnownAssignees: ReadonlyArray<{ name: string; email?: string }>;
  shiftExistingAssigneeKeys: ReadonlySet<string>;
  handleSaveShift: (s: Shift) => void;
  handleDeleteShift: (id: number) => void;
  handleCloseShiftModal: () => void;

  // TaskFormModal remaining props (taskModalOpen read internally via useTaskForm())
  today: string;
  nextId: number;
  contactsList: ReturnType<typeof listContacts>;
  absences: Absence[];
  tasksForDeps: Task[];
  uniqueGroups: string[];
  uniqueLabels: string[];
  editingIsJiraLinked: boolean;
  jiraEnabled: boolean;
  error: string | null;
  holidaySet: Set<string>;
  jiraProjectKey: string | undefined;
  jiraDefaultIssueType: string | undefined;
  modalRef: RefObject<HTMLDivElement | null>;
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  handleCancelEdit: () => void;
  handleRemoveContact: (name: string) => void;
  showToast: (kind: "info" | "error", text: string) => void;

  // Toast notification
  toast: { kind: "info" | "error"; text: string } | null;
}

export function AppModals({
  lang,
  isPopout,
  bannerDismissed,
  setBannerDismissed,
  bannerItems,
  setDueModalOpen,
  dueModalOpen,
  dueModalItems,
  onSelectDueTask,
  onCloseDueModal,
  jiraConflicts,
  handleResolveConflicts,
  clearConflicts,
  editingAbsence,
  absenceKnownAssignees,
  handleSaveAbsence,
  handleDeleteAbsence,
  handleCloseAbsenceModal,
  editingShift,
  shiftKnownAssignees,
  shiftExistingAssigneeKeys,
  handleSaveShift,
  handleDeleteShift,
  handleCloseShiftModal,
  today,
  nextId,
  contactsList,
  absences,
  tasksForDeps,
  uniqueGroups,
  uniqueLabels,
  editingIsJiraLinked,
  jiraEnabled,
  error,
  holidaySet,
  jiraProjectKey,
  jiraDefaultIssueType,
  modalRef,
  handleSubmit,
  handleCancelEdit,
  handleRemoveContact,
  showToast,
  toast,
}: AppModalsProps) {
  return (
    <>
      {!isPopout && !bannerDismissed && (
        <DueBanner
          items={bannerItems}
          lang={lang}
          onOpenList={() => setDueModalOpen(true)}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      <TaskFormModal
        lang={lang}
        today={today}
        nextId={nextId}
        contactsList={contactsList}
        absences={absences}
        tasksForDeps={tasksForDeps}
        uniqueGroups={uniqueGroups}
        uniqueLabels={uniqueLabels}
        editingIsJiraLinked={editingIsJiraLinked}
        jiraEnabled={jiraEnabled}
        error={error}
        holidaySet={holidaySet}
        jiraProjectKey={jiraProjectKey}
        jiraDefaultIssueType={jiraDefaultIssueType}
        modalRef={modalRef}
        onSubmit={handleSubmit}
        onCancel={handleCancelEdit}
        onRemoveContact={handleRemoveContact}
        onShowToast={showToast}
      />

      {dueModalOpen && (
        <DueDatesModal
          items={dueModalItems}
          lang={lang}
          onClose={onCloseDueModal}
          onSelectTask={onSelectDueTask}
        />
      )}

      {jiraConflicts.length > 0 && (
        <JiraConflictsModal
          lang={lang}
          conflicts={jiraConflicts}
          onResolve={handleResolveConflicts}
          onClose={clearConflicts}
        />
      )}

      {editingAbsence && (
        <AbsenceEditModal
          lang={lang}
          absence={editingAbsence.absence}
          isNew={editingAbsence.isNew}
          knownAssignees={absenceKnownAssignees}
          onSave={handleSaveAbsence}
          onDelete={handleDeleteAbsence}
          onClose={handleCloseAbsenceModal}
        />
      )}

      {editingShift && (
        <ShiftEditModal
          lang={lang}
          shift={editingShift.shift}
          isNew={editingShift.isNew}
          existingAssigneeKeys={shiftExistingAssigneeKeys}
          knownAssignees={shiftKnownAssignees}
          onSave={handleSaveShift}
          onDelete={handleDeleteShift}
          onClose={handleCloseShiftModal}
        />
      )}

      {!isPopout && (
        <footer className="mt-12 flex items-center justify-between gap-4 border-t border-AIPM-light-grey pt-6 text-xs text-AIPM-medium-grey dark:border-zinc-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/AIPM-logo.svg" alt="Acme" className="h-6 w-auto" />
          <span className="text-right italic">
            Identity Excellence Delivered. Globally.
          </span>
        </footer>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 right-4 z-30 max-w-md rounded-md px-4 py-2.5 text-sm shadow-lg ${
            toast.kind === "error"
              ? "bg-AIPM-pink text-white"
              : "bg-AIPM-dark-blue text-white"
          }`}
        >
          {toast.text}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run src/app/app-modals.test.tsx
```

Expected: 8 PASS

- [ ] **Step 5: Run full suite to confirm no regressions**

```
npx vitest run
```

Expected: all existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/app-modals.tsx src/app/app-modals.test.tsx
git commit -m "feat(app-modals): extract modal layer from task-manager.tsx"
```

---

## Task 2: Update `tasks-section.tsx` + `tasks-section.test.tsx`

**Files:**
- Modify: `src/app/tasks-section.tsx` (interface lines 35–73, function body ~lines 107–130)
- Modify: `src/app/tasks-section.test.tsx`

**Context:** `tasks-section.tsx` currently receives a single `rowContextValue: RowContextValue` prop and passes it directly to `<RowContextProvider>` (around line 383). After this task it builds `rowContextValue` internally: adds `tasksById` to its existing `useWorkspace()` call; calls `useSettings()` for `settings.holidayCountries`; calls `useHolidaySet()`; assembles the useMemo from all those + 8 new callback props. `jiraEnabled` and `jiraProjectKey` are already props; `jiraSiteUrl` is new. The `<RowContextProvider value={rowContextValue}>` wrapping stays unchanged.

---

- [ ] **Step 1: Rewrite `src/app/tasks-section.test.tsx`**

Replace the entire file with the version below. The three test cases are identical — only the mocks, stubs, and `makeProps` fixture change:

```typescript
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { t } from "./i18n";

vi.mock("./workspace-context", () => ({ useWorkspace: vi.fn() }));
vi.mock("./filters-context", () => ({ useFilters: vi.fn() }));
vi.mock("./task-form-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./task-form-context")>();
  return { ...actual, useTaskForm: vi.fn() };
});
vi.mock("./task-row", () => ({
  RowContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TaskRow: ({ task }: { task: { id: number; taskName: string } }) => (
    <tr><td>{task.taskName}</td></tr>
  ),
}));
vi.mock("./use-settings", () => ({ useSettings: vi.fn() }));
vi.mock("./use-holiday-set", () => ({ useHolidaySet: vi.fn() }));

import { useWorkspace } from "./workspace-context";
import { useFilters } from "./filters-context";
import { useTaskForm, emptyForm, emptyBulkEdit } from "./task-form-context";
import { useSettings } from "./use-settings";
import { useHolidaySet } from "./use-holiday-set";
import { TasksSection, type TasksSectionProps } from "./tasks-section";

const mockUseWorkspace = useWorkspace as ReturnType<typeof vi.fn>;
const mockUseFilters = useFilters as ReturnType<typeof vi.fn>;
const mockUseTaskForm = useTaskForm as ReturnType<typeof vi.fn>;
const mockUseSettings = useSettings as ReturnType<typeof vi.fn>;
const mockUseHolidaySet = useHolidaySet as ReturnType<typeof vi.fn>;

function stubFilters() {
  mockUseFilters.mockReturnValue({
    search: "", setSearch: vi.fn(),
    searchDebounced: "",
    setSearchImmediate: vi.fn(),
    priorityFilter: "All", setPriorityFilter: vi.fn(),
    assigneeFilter: "All", setAssigneeFilter: vi.fn(),
    groupFilter: "All", setGroupFilter: vi.fn(),
    labelFilter: "All", setLabelFilter: vi.fn(),
    sortKey: "taskName", sortDir: "asc",
    setSortKey: vi.fn(), setSortDir: vi.fn(),
    raidFilterTaskId: null, setRaidFilterTaskId: vi.fn(),
    resetFilters: vi.fn(),
  });
}

function stubTaskForm() {
  mockUseTaskForm.mockReturnValue({
    form: emptyForm(), setForm: vi.fn(),
    editingId: null, setEditingId: vi.fn(),
    taskModalOpen: false, setTaskModalOpen: vi.fn(),
    bulkEdit: emptyBulkEdit(), setBulkEdit: vi.fn(),
    bulkEditOpen: false, setBulkEditOpen: vi.fn(),
  });
}

function stubWorkspace(tasks: unknown[], filteredSortedTasks: unknown[]) {
  mockUseWorkspace.mockReturnValue({
    tasks,
    setTasks: vi.fn(),
    filteredSortedTasks,
    uniqueAssignees: [],
    uniqueGroups: [],
    uniqueLabels: [],
    tasksById: new Map(),
    taskSearchIndex: new Map(),
    raid: [], setRaid: vi.fn(),
    absences: [], setAbsences: vi.fn(),
    shifts: [], setShifts: vi.fn(),
  });
}

function stubSettings() {
  mockUseSettings.mockReturnValue({
    settings: {
      holidayCountries: [],
      jira: { siteUrl: "", enabled: false, projectKey: "", issueTypes: [] },
      notifications: {
        banner: { enabled: false, thresholdWorkDays: 5 },
        popup: { enabled: false, thresholdWorkDays: 3 },
      },
      ai: { consentAccepted: false },
      lang: "en-US",
    },
    setSettings: vi.fn(),
    hydrated: true,
    i18nReady: true,
    lang: "en-US",
  });
}

function stubHolidaySet() {
  mockUseHolidaySet.mockReturnValue({ holidaySet: new Set<string>() });
}

function makeProps(): TasksSectionProps {
  return {
    lang: "en-US",
    today: "2026-05-22",
    // row context data + callbacks (replaced rowContextValue prop)
    jiraSiteUrl: "",
    onToggleSelect: vi.fn(),
    onToggleNoteExpanded: vi.fn(),
    onJumpToRaid: vi.fn(),
    onToggleComplete: vi.fn(),
    onSendInquiry: vi.fn(),
    onPushToJira: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    // column manager
    hiddenCols: new Set(),
    setHiddenCols: vi.fn(),
    colWidths: {},
    colConfigOpen: false,
    setColConfigOpen: vi.fn(),
    colConfigRef: React.createRef<HTMLDivElement>(),
    startColResize: vi.fn(),
    resetColWidths: vi.fn(),
    // resizable table
    tableRef: React.createRef<HTMLElement>(),
    resetTableSize: vi.fn(),
    // row state
    expandedNotes: new Set(),
    pushingIds: new Set(),
    raidByTask: new Map(),
    // jira
    jiraEnabled: false,
    jiraSyncing: false,
    jiraProjectKey: "",
    handleJiraSync: vi.fn(),
    // task actions
    handleCancelEdit: vi.fn(),
    setTaskModalOpen: vi.fn(),
    handleClearAll: vi.fn(),
    // bulk operations
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
    stubSettings();
    stubHolidaySet();
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

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/app/tasks-section.test.tsx
```

Expected: FAIL — type errors or `rowContextValue` not found in props / missing stubs

- [ ] **Step 3: Update `src/app/tasks-section.tsx` — imports**

Add after `import type React from "react";`:

```typescript
import { useMemo } from "react";
import { useSettings } from "./use-settings";
import { useHolidaySet } from "./use-holiday-set";
```

Add `type Task` to the existing `./types` import (currently `import { PRIORITIES, type Priority, type RaidItem } from "./types"`):

```typescript
import { PRIORITIES, type Priority, type RaidItem, type Task } from "./types";
```

- [ ] **Step 4: Update `TasksSectionProps` interface**

Replace:

```typescript
  rowContextValue: RowContextValue;
```

With:

```typescript
  // Row-context data not already in props
  jiraSiteUrl: string;
  // Row-context callbacks — assembled into rowContextValue useMemo internally
  onToggleSelect: (id: number) => void;
  onToggleNoteExpanded: (id: number) => void;
  onJumpToRaid: (id: number) => void;
  onToggleComplete: (task: Task) => void;
  onSendInquiry: (task: Task) => void;
  onPushToJira: (id: number) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
```

- [ ] **Step 5: Update the function destructure signature**

Replace `rowContextValue,` in the parameter list with the 9 new names:

```typescript
  jiraSiteUrl,
  onToggleSelect,
  onToggleNoteExpanded,
  onJumpToRaid,
  onToggleComplete,
  onSendInquiry,
  onPushToJira,
  onEdit,
  onDelete,
```

- [ ] **Step 6: Add `tasksById` to the existing `useWorkspace()` call**

Change the existing destructure (around line 117) from:

```typescript
  const { tasks, filteredSortedTasks, uniqueAssignees, uniqueGroups, uniqueLabels } =
    useWorkspace();
```

To:

```typescript
  const { tasks, filteredSortedTasks, uniqueAssignees, uniqueGroups, uniqueLabels, tasksById } =
    useWorkspace();
```

- [ ] **Step 7: Add `useSettings`, `useHolidaySet`, and `rowContextValue` useMemo**

Insert after the existing `const { editingId, bulkEditOpen, setBulkEditOpen } = useTaskForm();` line:

```typescript
  const { settings } = useSettings();
  const { holidaySet } = useHolidaySet({ holidayCountries: settings.holidayCountries });

  const rowContextValue = useMemo<RowContextValue>(
    () => ({
      lang,
      today,
      holidaySet,
      jiraSiteUrl,
      jiraEnabled,
      jiraProjectKey,
      hiddenCols,
      tasksById,
      onToggleSelect,
      onToggleNoteExpanded,
      onJumpToRaid,
      onToggleComplete,
      onSendInquiry,
      onPushToJira,
      onEdit,
      onDelete,
    }),
    [
      lang,
      today,
      holidaySet,
      jiraSiteUrl,
      jiraEnabled,
      jiraProjectKey,
      hiddenCols,
      tasksById,
      onToggleSelect,
      onToggleNoteExpanded,
      onJumpToRaid,
      onToggleComplete,
      onSendInquiry,
      onPushToJira,
      onEdit,
      onDelete,
    ],
  );
```

- [ ] **Step 8: Run tests to verify they pass**

```
npx vitest run src/app/tasks-section.test.tsx
```

Expected: 3 PASS

- [ ] **Step 9: Run full suite**

```
npx vitest run
```

Expected: all tests PASS (task-manager.tsx will have a TypeScript type error because it still passes `rowContextValue` — fixed in Task 3)

- [ ] **Step 10: Commit**

```bash
git add src/app/tasks-section.tsx src/app/tasks-section.test.tsx
git commit -m "refactor(tasks-section): build rowContextValue internally; remove rowContextValue prop"
```

---

## Task 3: Refactor `task-manager.tsx`

**Files:**
- Modify: `src/app/task-manager.tsx`

**Context:** After Tasks 1–2, `task-manager.tsx` passes a now-removed `rowContextValue` prop (TypeScript error) and still renders the modal/banner/footer/toast block inline (~120 lines). This task: removes the `rowContextValue` useMemo; adds three new memos + one useCallback; replaces the inline block with `<AppModals>`; updates `<TasksSection>` props; cleans up imports that moved to `app-modals.tsx`.

---

- [ ] **Step 1: Update imports**

**Add:**
```typescript
import { AppModals } from "./app-modals";
```

**Remove** these lines (they move to `app-modals.tsx`):
```typescript
import { DueBanner, DueDatesModal } from "./notifications";
```
```typescript
const JiraConflictsModal = dynamic(
  () => import("./jira-conflicts-modal").then((m) => m.JiraConflictsModal),
  { ssr: false },
);
const AbsenceEditModal = dynamic(
  () => import("./absence-edit-modal").then((m) => m.AbsenceEditModal),
  { ssr: false },
);
const ShiftEditModal = dynamic(
  () => import("./shift-edit-modal").then((m) => m.ShiftEditModal),
  { ssr: false },
);
```
```typescript
import { TaskFormModal } from "./task-form-modal";
```
```typescript
import { type RowContextValue } from "./task-row";
```

Also remove the `dynamic` import (`import dynamic from "next/dynamic"`) — all dynamic panel imports were removed in Slice 15 and the three modal dynamic imports are being moved now, so `dynamic` has no remaining uses in this file.

- [ ] **Step 2: Remove `rowContextValue` useMemo**

Delete this entire block (~lines 319–356):

```typescript
  const rowContextValue = useMemo<RowContextValue>(
    () => ({
      lang,
      today,
      holidaySet,
      jiraSiteUrl: settings.jira.siteUrl,
      jiraEnabled: settings.jira.enabled,
      jiraProjectKey: settings.jira.projectKey,
      hiddenCols,
      tasksById,
      onToggleSelect,
      onToggleNoteExpanded,
      onJumpToRaid,
      onToggleComplete,
      onSendInquiry,
      onPushToJira,
      onEdit,
      onDelete,
    }),
    [
      lang,
      today,
      holidaySet,
      settings.jira.siteUrl,
      settings.jira.enabled,
      settings.jira.projectKey,
      hiddenCols,
      tasksById,
      onToggleSelect,
      onToggleNoteExpanded,
      onJumpToRaid,
      onToggleComplete,
      onSendInquiry,
      onPushToJira,
      onEdit,
      onDelete,
    ],
  );
```

- [ ] **Step 3: Add knownAssignees useMemos + onSelectDueTask callback**

Insert after the existing `dueModalItems` useMemo (around line 299):

```typescript
  const absenceKnownAssignees = useMemo(
    () => [
      ...tasks.map((tk) => ({ name: tk.assignee, email: tk.assigneeEmail })),
      ...absences.map((a) => ({ name: a.assignee, email: a.assigneeEmail })),
    ],
    [tasks, absences],
  );

  const shiftKnownAssignees = useMemo(
    () => [
      ...tasks.map((tk) => ({ name: tk.assignee, email: tk.assigneeEmail })),
      ...absences.map((a) => ({ name: a.assignee, email: a.assigneeEmail })),
      ...shifts.map((s) => ({ name: s.assignee, email: s.assigneeEmail })),
    ],
    [tasks, absences, shifts],
  );

  const shiftExistingAssigneeKeys = useMemo(
    () =>
      new Set(
        shifts
          .filter((s) => editingShift === null || s.id !== editingShift.shift.id)
          .map((s) => s.assignee.trim().toLowerCase()),
      ),
    [shifts, editingShift],
  );

  const onSelectDueTask = useCallback(
    (taskId: number) => {
      const task = tasks.find((row) => row.id === taskId);
      if (task) {
        setDueModalOpen(false);
        openEditModal(task);
      }
    },
    [tasks, setDueModalOpen, openEditModal],
  );
```

- [ ] **Step 4: Replace inline modal/banner/footer/toast JSX with `<AppModals>`**

In the JSX return, **delete** everything from `{!isPopout && !bannerDismissed && (` through the closing `)}` of the `{toast && ...}` block (the ~120 line span after `<WorkspaceSection>` and before `</div>`).

**Replace** with:

```tsx
      <AppModals
        lang={lang}
        isPopout={isPopout}
        bannerDismissed={bannerDismissed}
        setBannerDismissed={setBannerDismissed}
        bannerItems={bannerItems}
        setDueModalOpen={setDueModalOpen}
        dueModalOpen={dueModalOpen}
        dueModalItems={dueModalItems}
        onSelectDueTask={onSelectDueTask}
        onCloseDueModal={() => setDueModalOpen(false)}
        jiraConflicts={jiraConflicts}
        handleResolveConflicts={handleResolveConflicts}
        clearConflicts={clearConflicts}
        editingAbsence={editingAbsence}
        absenceKnownAssignees={absenceKnownAssignees}
        handleSaveAbsence={handleSaveAbsence}
        handleDeleteAbsence={handleDeleteAbsence}
        handleCloseAbsenceModal={handleCloseAbsenceModal}
        editingShift={editingShift}
        shiftKnownAssignees={shiftKnownAssignees}
        shiftExistingAssigneeKeys={shiftExistingAssigneeKeys}
        handleSaveShift={handleSaveShift}
        handleDeleteShift={handleDeleteShift}
        handleCloseShiftModal={handleCloseShiftModal}
        today={today}
        nextId={nextId}
        contactsList={contactsList}
        absences={absences}
        tasksForDeps={tasks}
        uniqueGroups={uniqueGroups}
        uniqueLabels={uniqueLabels}
        editingIsJiraLinked={editingIsJiraLinked}
        jiraEnabled={settings.jira.enabled}
        error={error}
        holidaySet={holidaySet}
        jiraProjectKey={settings.jira.projectKey}
        jiraDefaultIssueType={settings.jira.issueTypes[0]}
        modalRef={modalRef}
        handleSubmit={handleSubmit}
        handleCancelEdit={handleCancelEdit}
        handleRemoveContact={handleRemoveContact}
        showToast={showToast}
        toast={toast}
      />
```

- [ ] **Step 5: Update `<TasksSection>` props**

In the `<TasksSection>` JSX, **replace**:

```tsx
          rowContextValue={rowContextValue}
```

**With**:

```tsx
          jiraSiteUrl={settings.jira.siteUrl}
          onToggleSelect={onToggleSelect}
          onToggleNoteExpanded={onToggleNoteExpanded}
          onJumpToRaid={onJumpToRaid}
          onToggleComplete={onToggleComplete}
          onSendInquiry={onSendInquiry}
          onPushToJira={onPushToJira}
          onEdit={onEdit}
          onDelete={onDelete}
```

- [ ] **Step 6: Run TypeScript check**

```
npx tsc --noEmit
```

Expected: 0 new errors (one pre-existing error in `use-due-alerts.test.ts` unrelated to this slice may remain — confirm it existed before this task)

- [ ] **Step 7: Run full test suite**

```
npx vitest run
```

Expected: all tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "refactor(task-manager): replace modal block with AppModals; thread callbacks to TasksSection"
```

---

## Task 4: Version bump v0.8.4 "Lorca" + CHANGELOG

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`

---

- [ ] **Step 1: Update `src/app/version.ts`**

Prepend a new comment line at the very top (before the existing `// 0.8.3 ...` block):

```typescript
// 0.8.4 extracts the modal layer (DueBanner, TaskFormModal, DueDatesModal,
// JiraConflictsModal, AbsenceEditModal, ShiftEditModal, footer, toast) from
// task-manager.tsx into AppModals. TasksSection builds rowContextValue
// internally (useSettings + useHolidaySet + tasksById from useWorkspace);
// receives 8 row-handler callbacks + jiraSiteUrl as explicit props instead of
// the compiled RowContextValue object. task-manager.tsx −~140 lines. Slice 16.
```

Change the constants:

```typescript
export const APP_VERSION = "0.8.4";
export const APP_BUILD_DATE = "2026-05-22";
```

- [ ] **Step 2: Update `CHANGELOG.md`**

Insert a new section immediately after line 11 (before `## [0.8.3]`):

```markdown
## [0.8.4] "Lorca" — 2026-05-22

### Refactored
- Extract `AppModals` from `task-manager.tsx`: renders `DueBanner`, `TaskFormModal`, `DueDatesModal`, `JiraConflictsModal`, `AbsenceEditModal`, `ShiftEditModal`, `<footer>`, and toast
- `TasksSection` builds `rowContextValue` internally: calls `useSettings()` + `useHolidaySet()`; receives 8 row-handler callbacks + `jiraSiteUrl` as explicit props instead of a single opaque `RowContextValue` prop
- `task-manager.tsx`: −~140 lines

```

- [ ] **Step 3: Run full test suite**

```
npx vitest run
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "release(v0.8.4): Lorca — AppModals + RowContext promotion"
```
