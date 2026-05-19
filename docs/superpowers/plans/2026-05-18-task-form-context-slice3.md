# TaskFormProvider (Slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move 5 form-state `useState` calls (`form`, `editingId`, `taskModalOpen`, `bulkEdit`, `bulkEditOpen`) plus the `emptyForm()` / `emptyBulkEdit()` factories and `BulkEditField` type out of `src/app/task-manager.tsx` into a new `TaskFormProvider` context. Pure refactor; no observable behaviour change. Spec: `docs/superpowers/specs/2026-05-18-task-form-context-slice3-design.md`.

**Architecture:** New module `src/app/task-form-context.tsx` exports `TaskFormProvider` (5 `useState` slices), `useTaskForm()` (throws outside provider), and re-exports the `emptyForm`/`emptyBulkEdit`/`BulkEditField`/`TaskFormDraft`/`BulkEditDraft` helpers. `TaskManager` default export wraps `<FiltersProvider><WorkspaceProvider><TaskFormProvider><TaskManagerInner /></TaskFormProvider></WorkspaceProvider></FiltersProvider>`. `TaskManagerInner` destructures from `useTaskForm()` instead of holding the state locally; all existing handlers (`handleSubmit`, `handleCancelEdit`, `applyBulkEdit`) stay where they are.

**Tech Stack:** React 19 + Next 16 (App Router, `"use client"`); TypeScript; Vitest 3 + `@testing-library/react`. Mirrors the pattern of Slice 1's `FiltersProvider` and Slice 2's `WorkspaceProvider`.

---

## File Structure

| File | Role |
|---|---|
| `src/app/task-form-context.tsx` | **NEW** ~130 lines — Context, Provider, hook, `emptyForm`/`emptyBulkEdit` factories, `BulkEditField`/`TaskFormDraft`/`BulkEditDraft` types |
| `src/app/task-form-context.test.tsx` | **NEW** ~140 lines, 5 tests |
| `src/app/task-manager.tsx` | Modified — delete 5 useState + 2 factories + 1 type alias, add `useTaskForm()` destructure + provider wrap, import factories back |

---

## Task 1: Scaffold TaskFormProvider with factories, types, and default-state test

**Files:**
- Create: `src/app/task-form-context.tsx`
- Create: `src/app/task-form-context.test.tsx`
- Test: `src/app/task-form-context.test.tsx`

Follow TDD strictly.

- [ ] **Step 1: Write the failing test**

Create `src/app/task-form-context.test.tsx`:

```tsx
import { describe, test, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import {
  TaskFormProvider,
  useTaskForm,
  emptyForm,
  emptyBulkEdit,
} from "./task-form-context";

function wrapper({ children }: { children: ReactNode }) {
  return <TaskFormProvider>{children}</TaskFormProvider>;
}

describe("TaskFormProvider", () => {
  test("exposes the documented defaults", () => {
    const { result } = renderHook(() => useTaskForm(), { wrapper });
    expect(result.current.form).toEqual(emptyForm());
    expect(result.current.bulkEdit).toEqual(emptyBulkEdit());
    expect(result.current.editingId).toBeNull();
    expect(result.current.taskModalOpen).toBe(false);
    expect(result.current.bulkEditOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/task-form-context.test.tsx`
Expected: FAIL with module resolution error (`Cannot find module './task-form-context'`).

- [ ] **Step 3: Write minimal implementation**

Create `src/app/task-form-context.tsx`:

```tsx
"use client";

import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { type Health } from "./health";
import { type Priority, type TaskDependency } from "./types";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyForm() {
  return {
    taskName: "",
    assignee: "",
    assigneeEmail: "",
    startDate: "",
    dueDate: "",
    lastUpdateDate: todayISO(),
    priority: "Medium" as Priority,
    blockers: "",
    notes: "",
    group: "",
    labels: [] as string[],
    dependencies: [] as TaskDependency[],
    pushToJira: false,
    // Empty string = "Auto" (no override). Mapped to undefined on save.
    healthOverride: "" as "" | Health,
  };
}

export type TaskFormDraft = ReturnType<typeof emptyForm>;

export type BulkEditField =
  | "priority"
  | "dueDate"
  | "lastUpdateDate"
  | "assignee"
  | "assigneeEmail"
  | "blockers"
  | "notes"
  | "group"
  | "labels";

export function emptyBulkEdit() {
  return {
    enabled: {
      priority: false,
      dueDate: false,
      lastUpdateDate: false,
      assignee: false,
      assigneeEmail: false,
      blockers: false,
      notes: false,
      group: false,
      labels: false,
    } as Record<BulkEditField, boolean>,
    priority: "Medium" as Priority,
    dueDate: "",
    lastUpdateDate: todayISO(),
    assignee: "",
    assigneeEmail: "",
    blockers: "",
    notes: "",
    group: "",
    labels: [] as string[],
  };
}

export type BulkEditDraft = ReturnType<typeof emptyBulkEdit>;

interface TaskFormValue {
  form: TaskFormDraft;
  setForm: Dispatch<SetStateAction<TaskFormDraft>>;
  editingId: number | null;
  setEditingId: Dispatch<SetStateAction<number | null>>;
  taskModalOpen: boolean;
  setTaskModalOpen: Dispatch<SetStateAction<boolean>>;

  bulkEdit: BulkEditDraft;
  setBulkEdit: Dispatch<SetStateAction<BulkEditDraft>>;
  bulkEditOpen: boolean;
  setBulkEditOpen: Dispatch<SetStateAction<boolean>>;
}

const TaskFormContext = createContext<TaskFormValue | undefined>(undefined);

export function TaskFormProvider({ children }: { children: ReactNode }) {
  const [form, setForm] = useState<TaskFormDraft>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [bulkEdit, setBulkEdit] = useState<BulkEditDraft>(emptyBulkEdit);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  const value: TaskFormValue = {
    form,
    setForm,
    editingId,
    setEditingId,
    taskModalOpen,
    setTaskModalOpen,
    bulkEdit,
    setBulkEdit,
    bulkEditOpen,
    setBulkEditOpen,
  };

  return (
    <TaskFormContext.Provider value={value}>
      {children}
    </TaskFormContext.Provider>
  );
}

export function useTaskForm(): TaskFormValue {
  const ctx = useContext(TaskFormContext);
  // Outside-provider behaviour is tightened in Task 5.
  return ctx as TaskFormValue;
}
```

The `// Outside-provider behaviour is tightened in Task 5.` comment is intentional — Task 5 will replace this body with a proper guard. Keep the comment for now.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/task-form-context.test.tsx`
Expected: PASS — 1 test.

Also run the full suite: `npx vitest run`
Expected: 54 tests across 9 test files (53 prior + 1 new).

- [ ] **Step 5: Commit**

PowerShell — stage and commit ONLY the 2 new files. Pathspec form keeps other previously-staged files out:

```powershell
git add src/app/task-form-context.tsx src/app/task-form-context.test.tsx
git commit src/app/task-form-context.tsx src/app/task-form-context.test.tsx -m "feat(task-form-context): scaffold TaskFormProvider + default state test"
```

No Co-Authored-By trailer (repo disables attribution globally).

---

## Task 2: setForm accepts object replacement

**Files:**
- Modify: `src/app/task-form-context.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/app/task-form-context.test.tsx`:

1. Update the `@testing-library/react` import to add `act`:

   FROM:
   ```tsx
   import { renderHook } from "@testing-library/react";
   ```

   TO:
   ```tsx
   import { renderHook, act } from "@testing-library/react";
   ```

2. Append inside the existing `describe("TaskFormProvider", ...)` block, before the closing `})`:

```tsx
  test("setForm accepts object replacement", () => {
    const { result } = renderHook(() => useTaskForm(), { wrapper });

    act(() =>
      result.current.setForm({ ...emptyForm(), taskName: "hello" }),
    );

    expect(result.current.form.taskName).toBe("hello");
    expect(result.current.form.assignee).toBe("");
    expect(result.current.form.priority).toBe("Medium");
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/app/task-form-context.test.tsx`
Expected: PASS — 2 tests. (The provider already supports `setForm` from Task 1's scaffold; this is a behaviour check.)

- [ ] **Step 3: Commit**

```powershell
git add src/app/task-form-context.test.tsx
git commit src/app/task-form-context.test.tsx -m "test(task-form-context): cover setForm with object replacement"
```

---

## Task 3: setForm accepts updater function

**Files:**
- Modify: `src/app/task-form-context.test.tsx`

This test validates the `Dispatch<SetStateAction>` shape used by inline input handlers (`setForm(prev => ({...prev, taskName: e.target.value}))`).

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("TaskFormProvider", ...)` block, before the closing `})`:

```tsx
  test("setForm accepts an updater function", () => {
    const { result } = renderHook(() => useTaskForm(), { wrapper });

    act(() =>
      result.current.setForm((prev) => ({ ...prev, priority: "High" })),
    );

    expect(result.current.form.priority).toBe("High");
    // Other fields should still be defaults.
    expect(result.current.form.taskName).toBe("");
    expect(result.current.form.assignee).toBe("");
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/app/task-form-context.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 3: Commit**

```powershell
git add src/app/task-form-context.test.tsx
git commit src/app/task-form-context.test.tsx -m "test(task-form-context): cover setForm with updater function"
```

---

## Task 4: Modal toggles + setEditingId cluster

**Files:**
- Modify: `src/app/task-form-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("TaskFormProvider", ...)` block, before the closing `})`:

```tsx
  test("modal toggles and setEditingId work as a cluster", () => {
    const { result } = renderHook(() => useTaskForm(), { wrapper });

    // Enter "edit task #7" mode.
    act(() => {
      result.current.setEditingId(7);
      result.current.setTaskModalOpen(true);
    });
    expect(result.current.editingId).toBe(7);
    expect(result.current.taskModalOpen).toBe(true);

    // Close modal — editingId is NOT auto-reset.
    act(() => result.current.setTaskModalOpen(false));
    expect(result.current.taskModalOpen).toBe(false);
    expect(result.current.editingId).toBe(7);

    // Bulk-edit cluster mirrors the same pattern.
    act(() => {
      result.current.setBulkEdit((prev) => ({ ...prev, priority: "Urgent" }));
      result.current.setBulkEditOpen(true);
    });
    expect(result.current.bulkEdit.priority).toBe("Urgent");
    expect(result.current.bulkEditOpen).toBe(true);

    act(() => result.current.setBulkEditOpen(false));
    expect(result.current.bulkEditOpen).toBe(false);
    expect(result.current.bulkEdit.priority).toBe("Urgent");
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/app/task-form-context.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 3: Commit**

```powershell
git add src/app/task-form-context.test.tsx
git commit src/app/task-form-context.test.tsx -m "test(task-form-context): cover modal toggles + setEditingId cluster"
```

---

## Task 5: useTaskForm() outside a provider throws

**Files:**
- Modify: `src/app/task-form-context.tsx`
- Modify: `src/app/task-form-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("TaskFormProvider", ...)` block, before the closing `})`:

```tsx
  test("useTaskForm() outside a TaskFormProvider throws a documented error", () => {
    // React logs the rendering error to console.error in dev; silence it
    // so the test output stays clean. Restore after to avoid hiding
    // unrelated noise from later tests.
    const original = console.error;
    console.error = () => {};
    try {
      expect(() => renderHook(() => useTaskForm())).toThrow(
        "useTaskForm must be used within TaskFormProvider",
      );
    } finally {
      console.error = original;
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/task-form-context.test.tsx`
Expected: FAIL — the hook currently casts `undefined` to `TaskFormValue` (placeholder from Task 1), so `renderHook(...)` does not throw the specific message yet.

- [ ] **Step 3: Implement the guard**

In `src/app/task-form-context.tsx`, replace the body of `useTaskForm`:

```tsx
export function useTaskForm(): TaskFormValue {
  const ctx = useContext(TaskFormContext);
  // Outside-provider behaviour is tightened in Task 5.
  return ctx as TaskFormValue;
}
```

with:

```tsx
export function useTaskForm(): TaskFormValue {
  const ctx = useContext(TaskFormContext);
  if (!ctx) throw new Error("useTaskForm must be used within TaskFormProvider");
  return ctx;
}
```

The placeholder comment is gone; the guard is the documented behaviour.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/task-form-context.test.tsx`
Expected: PASS — 5 tests.

Also run full suite: `npx vitest run`
Expected: 58 tests across 9 files (53 prior + 5 new in this slice).

- [ ] **Step 5: Commit**

```powershell
git add src/app/task-form-context.tsx src/app/task-form-context.test.tsx
git commit src/app/task-form-context.tsx src/app/task-form-context.test.tsx -m "feat(task-form-context): throw when useTaskForm() runs outside provider"
```

---

## Task 6: Migrate task-manager.tsx to consume TaskFormProvider

**Files:**
- Modify: `src/app/task-manager.tsx`

No new unit tests in this task — `task-manager.tsx` has no test coverage of its own (intentional; previous slices established this pattern). Verification is build + full suite + manual smoke.

- [ ] **Step 1: Add the TaskFormProvider + helpers import**

In `src/app/task-manager.tsx`, group with the other context imports (search for `from "./filters-context"` to find the right neighborhood). Add a new import line:

```tsx
import {
  TaskFormProvider,
  emptyBulkEdit,
  emptyForm,
  useTaskForm,
  type BulkEditField,
} from "./task-form-context";
```

(`BulkEditField` may not be needed anywhere in `task-manager.tsx` after the cleanup — Step 3 deletes the local type alias and the only consumers are the bulk-edit handlers. Verify in Step 6 by removing the import if no usages remain; the build error will be informative.)

- [ ] **Step 2: Delete the 2 local factory functions and the local type alias**

In `src/app/task-manager.tsx`:

1. Find and delete the local `emptyForm()` function (currently around lines 267–285):

   ```tsx
   function emptyForm() {
     return {
       taskName: "",
       assignee: "",
       /* … */
       healthOverride: "" as "" | Health,
     };
   }
   ```

2. Find and delete the local `BulkEditField` type alias (currently around lines 287–296):

   ```tsx
   type BulkEditField =
     | "priority"
     | "dueDate"
     /* … */
     | "labels";
   ```

3. Find and delete the local `emptyBulkEdit()` function (currently around lines 298–321):

   ```tsx
   function emptyBulkEdit() {
     return {
       enabled: { /* … */ } as Record<BulkEditField, boolean>,
       priority: "Medium" as Priority,
       /* … */
     };
   }
   ```

Build will be temporarily broken; Steps 3–5 fix it.

- [ ] **Step 3: Delete the 5 form-related useState declarations**

Inside `TaskManagerInner`, find and delete each of these declarations (line numbers shift as edits accumulate — search by name):

1. `const [form, setForm] = useState(emptyForm);` (currently around line 347)
2. `const [editingId, setEditingId] = useState<number | null>(null);` (currently around line 380)
3. `const [taskModalOpen, setTaskModalOpen] = useState(false);` (currently around line 392)
4. `const [bulkEditOpen, setBulkEditOpen] = useState(false);` (currently around line 456)
5. `const [bulkEdit, setBulkEdit] = useState(emptyBulkEdit);` (currently around line 457)

- [ ] **Step 4: Add the useTaskForm() destructure**

Inside `TaskManagerInner`, find the existing `useFilters()` destructure (search for `} = useFilters();`) and the `useWorkspace()` destructure (search for `} = useWorkspace();`). Immediately after both, add:

```tsx
  // Form / modal state owned by TaskFormProvider (Slice 3 of the
  // task-manager decomposition; see
  // docs/superpowers/specs/2026-05-18-task-form-context-slice3-design.md).
  // The default export wraps this component in <TaskFormProvider> inside
  // <WorkspaceProvider>.
  const {
    form,
    setForm,
    editingId,
    setEditingId,
    taskModalOpen,
    setTaskModalOpen,
    bulkEdit,
    setBulkEdit,
    bulkEditOpen,
    setBulkEditOpen,
  } = useTaskForm();
```

Every existing reference to these 10 names elsewhere in the file continues to work unchanged.

- [ ] **Step 5: Update the default export to wrap with TaskFormProvider**

Find the current default export at the bottom of the file. After Slice 2's wrap, it looks like:

```tsx
export default function TaskManager() {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <TaskManagerInner />
      </WorkspaceProvider>
    </FiltersProvider>
  );
}
```

Replace with:

```tsx
export default function TaskManager() {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <TaskFormProvider>
          <TaskManagerInner />
        </TaskFormProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}
```

- [ ] **Step 6: Build to verify TypeScript and Next compilation**

Run: `npm run build`
Expected: `✓ Compiled successfully` + `Finished TypeScript`. No new warnings.

Common errors and fixes:

- **"Cannot find name 'emptyForm' / 'emptyBulkEdit'"**: an import statement is missing or misspelled. Re-check Step 1.
- **"X is undefined / used before declared"**: the `useTaskForm()` destructure (Step 4) was placed AFTER its first usage in `TaskManagerInner`. Move it earlier — right after `useFilters()` / `useWorkspace()` destructures.
- **"Cannot find name 'BulkEditField'"** somewhere unexpected: a local reference to the type alias survived. Either replace it with the imported one or delete it. If no surviving references, remove the `type BulkEditField` from the import in Step 1.

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: 58 tests across 9 files (53 prior + 5 new from Tasks 1–5). No regressions.

- [ ] **Step 8: Manual smoke (uncommitted)**

PowerShell: `npm run dev`. Open `http://localhost:3000`. Verify the 9 checks from Slice 2b plus two new ones for this slice:

1. **Search debounce:** type a query; list updates after ~150 ms.
2. **Priority filter:** pick a priority; list narrows.
3. **Group / Label / Assignee filter:** each narrows the list.
4. **Sortable column header:** click; sort direction toggles.
5. **RAID badge:** click a task row's RAID badge; RaidPanel opens with task filter applied.
6. **Edit a task:** click Edit on a row, change a field, save. The row updates immediately.
7. **Mark complete / Reopen:** click on one row; only that row changes appearance.
8. **Notes expansion:** expand one row's notes; other rows unaffected.
9. **Cross-window sync (optional):** edit in tab A, watch tab B update.
10. **NEW — Add task:** click `+ Add task` toolbar button. Modal opens. Fill in task name, assignee, due date. Click Add. The new row appears in the list and the modal closes.
11. **NEW — Bulk edit:** select 2+ rows via row checkboxes. Click the bulk-edit toolbar action. Toggle 2 fields (e.g., priority + assignee), set values, click Apply. Both rows update; modal closes; the bulk-edit draft resets on next open.

Stop the dev server.

- [ ] **Step 9: Commit**

```powershell
git add src/app/task-manager.tsx
git commit src/app/task-manager.tsx -m "refactor(task-manager): consume TaskFormProvider for form + modal state"
```

---

## Done

After Task 6:

- `src/app/task-form-context.tsx` owns 5 form-state slices plus the `emptyForm`/`emptyBulkEdit` factories and `BulkEditField` type.
- `src/app/task-manager.tsx` is ~25 lines shorter and no longer manages form state inline. The decomposition reaches a natural stopping point — every category of state has a clear home.
- Five new tests in `src/app/task-form-context.test.tsx`.
- Full suite green at 58 tests across 9 files.
- Pattern consistency: four `*-context.tsx` providers now follow the same shape (`Dispatch<SetStateAction>` setters, `useMemo`'d derivations where applicable, throw-outside-provider guard).
- Optional follow-up Slice 4 (modal component extraction): with form data in context, `<TaskFormModal>` and `<BulkEditModal>` could be lifted out of `TaskManagerInner` and consume the form context directly. Out of scope here but newly feasible.
