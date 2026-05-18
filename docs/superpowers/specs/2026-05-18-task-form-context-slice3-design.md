# Slice 3 — TaskFormProvider (Task Form Context)

**Date:** 2026-05-18
**Slice:** 3 of 3 in the `task-manager.tsx` decomposition.
**Predecessors:**
- Slice 1 — FiltersProvider (`docs/superpowers/specs/2026-05-17-filters-context-slice1-design.md`)
- Slice 2 — WorkspaceProvider (`docs/superpowers/specs/2026-05-18-workspace-context-slice2-design.md`)
- Slice 2b — TaskRow extraction + memoization (`docs/superpowers/specs/2026-05-18-task-row-memo-slice2b-design.md`)
- Slice 2b spec named the intent: "the add/edit/bulk-edit form drafts can now move into their own provider next. The form's open/close state and draft contents are the last remaining UI-state cluster in `TaskManagerInner`."

## Problem

After Slices 1, 2, and 2b, `TaskManagerInner` no longer owns filters, tasks, derivations, or the row JSX. Five `useState` calls still live there and form a single conceptual cluster: the add/edit task form and the bulk-edit form. They are:

- `form` — the draft `Task` (a single-row create/edit form).
- `editingId` — `null` while adding, `task.id` while editing.
- `taskModalOpen` — visibility of the add/edit modal.
- `bulkEdit` — the draft bulk-edit object.
- `bulkEditOpen` — visibility of the bulk-edit modal.

These five slices are tightly coupled to the form modals and to the form-submit/cancel handlers. They are also the last UI-state cluster in `TaskManagerInner` that isn't already in a provider. Extracting them completes the decomposition: every category of state has a clear home, and `TaskManagerInner` becomes mostly orchestration + remaining smaller state (toast, drag state, JIRA-conflict modal state, etc.).

## Goal

Move the five form-state slices out of `TaskManagerInner` into a new `TaskFormProvider`, with no observable behaviour change. Pure refactor — same shape as Slices 1 and 2. The provider holds state + setters only; form-orchestration handlers (`handleSubmit`, `handleCancelEdit`, `applyBulkEdit`) stay in `TaskManagerInner`.

## Non-goals

- **Moving handler functions** (`handleSubmit`, `handleCancelEdit`, `applyBulkEdit`). They stay in `TaskManagerInner`. The provider is data-only — same symmetry Slice 1 and Slice 2 used.
- **Moving the `error` validation state.** It belongs near `handleSubmit` and the modal that displays it. Out of scope.
- **Extracting the modal components themselves** (e.g., a dedicated `<TaskFormModal>` / `<BulkEditModal>`). Possible follow-up but separate concern.
- **Reducer pattern.** Five independent `useState` slices behind one provider is simpler than a reducer for this scope.
- **Adding any new functionality.** Pure refactor.

## Architecture

### Provider composition

```
TaskManager (default export, thin wrapper)
  └ <FiltersProvider>
      └ <WorkspaceProvider>
          └ <TaskFormProvider>           NEW
              └ <TaskManagerInner>
                  └ <RowContextProvider>  (Slice 2b, unchanged)
                      └ <table>...
```

`TaskFormProvider` doesn't read any other context. The chosen ordering is for layering consistency with the existing stack — it could sit anywhere outside `TaskManagerInner` without behaviour change.

### New file: `src/app/task-form-context.tsx`

Shape (illustrative — exact field shapes come from the existing `emptyForm()` and `emptyBulkEdit()` factories that move with the provider):

```ts
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
    form, setForm,
    editingId, setEditingId,
    taskModalOpen, setTaskModalOpen,
    bulkEdit, setBulkEdit,
    bulkEditOpen, setBulkEditOpen,
  };

  return (
    <TaskFormContext.Provider value={value}>
      {children}
    </TaskFormContext.Provider>
  );
}

export function useTaskForm(): TaskFormValue {
  const ctx = useContext(TaskFormContext);
  if (!ctx) throw new Error("useTaskForm must be used within TaskFormProvider");
  return ctx;
}
```

The bodies of `emptyForm()` and `emptyBulkEdit()` are lifted verbatim from `task-manager.tsx` (currently around lines 267 and 298). `todayISO()` is a small helper already used elsewhere in `task-manager.tsx`; it's duplicated here rather than imported because it's a one-liner and avoiding the cross-file dependency is simpler than re-exporting the existing one. (Alternative considered: move `todayISO` to a shared utility. Rejected for scope.)

### Changes to `src/app/task-manager.tsx`

1. **Provider wrap.** The default export gains one more layer:

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

2. **Inside `TaskManagerInner`:**
   - Delete the 5 form `useState` declarations:
     - `const [form, setForm] = useState(emptyForm);` (currently line 347)
     - `const [editingId, setEditingId] = useState<number | null>(null);` (currently line 380)
     - `const [taskModalOpen, setTaskModalOpen] = useState(false);` (currently line 392)
     - `const [bulkEdit, setBulkEdit] = useState(emptyBulkEdit);` (currently line 457)
     - `const [bulkEditOpen, setBulkEditOpen] = useState(false);` (currently line 456)
   - Delete the local `emptyForm()` function (currently lines 267–285).
   - Delete the local `emptyBulkEdit()` function (currently lines 298–321).
   - Delete the local `BulkEditField` type alias (currently lines 287–296).
   - Add a destructure from `useTaskForm()` near the top of the body (after the existing `useFilters()` and `useWorkspace()` destructures):

     ```ts
     const {
       form, setForm,
       editingId, setEditingId,
       taskModalOpen, setTaskModalOpen,
       bulkEdit, setBulkEdit,
       bulkEditOpen, setBulkEditOpen,
     } = useTaskForm();
     ```

   - Add imports for `emptyForm`, `emptyBulkEdit`, `BulkEditField`, `TaskFormProvider` from `./task-form-context`. The `emptyForm()` and `emptyBulkEdit()` calls inside handlers (`handleSubmit` reset, `handleCancelEdit`, etc.) continue to work — they just resolve to imports now.
   - Every existing in-file reference to the five state names continues to work unchanged. ~14 call sites total across `task-manager.tsx` (search for `setForm(`, `setEditingId(`, `setTaskModalOpen(`, `setBulkEdit(`, `setBulkEditOpen(` — adjust each if needed; most should already match).

### `setForm` / `setBulkEdit` callers

Reads / writes happen across:
- `handleEdit` (now `onEdit` after Slice 2b) — sets the form fields from a task.
- `handleSubmit` — reads form, resets it on success.
- `handleCancelEdit` — resets form + editing flags.
- Voice command branch — `setForm({ ...emptyForm(), taskName: cmd.taskName })`.
- Inline `onChange` handlers in the form modal — `setForm(prev => ({...prev, taskName: e.target.value}))` etc.
- `applyBulkEdit` — reads bulkEdit.
- Bulk-edit modal `onChange` handlers — `setBulkEdit(prev => ({...prev, …}))`.

All call sites read setters from the destructure now instead of from local `useState`. Updater-form callers (`setForm(prev => …)`, `setBulkEdit(prev => …)`) work unchanged because the setter type is `Dispatch<SetStateAction<T>>` — same widening Slices 1 and 2 settled on.

### Files affected

| File | Change |
|---|---|
| `src/app/task-form-context.tsx` | **NEW** ~130 lines (factories + types + provider + hook) |
| `src/app/task-form-context.test.tsx` | **NEW** ~120 lines, 5 tests |
| `src/app/task-manager.tsx` | net −35 / +10 lines (delete 5 useState + 2 factories + 1 type, add destructure + provider wrap) |
| `src/app/filters-context.tsx`, `src/app/workspace-context.tsx`, `src/app/task-row.tsx` | No change |

## Testing

`src/app/task-form-context.test.tsx`, 5 tests, follows the same shape as `filters-context.test.tsx` and `workspace-context.test.tsx`:

1. **Default state.** Render `<TaskFormProvider>` + probe. Assert:
   - `form` deep-equals `emptyForm()` (with `lastUpdateDate` matching today's ISO date).
   - `bulkEdit` deep-equals `emptyBulkEdit()` (likewise).
   - `editingId === null`.
   - `taskModalOpen === false`.
   - `bulkEditOpen === false`.

2. **`setForm` accepts object replacement.** `act(() => setForm({ ...emptyForm(), taskName: "hello" }))`. Assert `form.taskName === "hello"` and other fields keep defaults.

3. **`setForm` accepts updater function.** `act(() => setForm(prev => ({ ...prev, priority: "High" })))`. Assert `form.priority === "High"`. Validates the `Dispatch<SetStateAction>` shape used by inline input handlers.

4. **Modal toggles and `setEditingId` work as a cluster.**
   - `act(() => { setEditingId(7); setTaskModalOpen(true); })` → assert both.
   - `act(() => setTaskModalOpen(false))` → assert `taskModalOpen === false`, `editingId` still `7` (no auto-reset).
   - `act(() => { setBulkEdit(prev => ({...prev, priority: "Urgent"})); setBulkEditOpen(true); })` → assert both.

5. **`useTaskForm()` outside provider throws.** Bare consumer; expect `"useTaskForm must be used within TaskFormProvider"`. Silences `console.error` with try/finally per the Slice 1/2/2b pattern.

No extra tests for bulk-edit setter mechanics beyond what test #4 already covers — the bulk-edit setters use identical patterns to form setters; duplicate coverage would be over-fitting.

## Verification

- `npm run build` — TypeScript clean, Next 16 bundles successfully.
- `npx vitest run` — full suite green (53 existing + 5 new = 58 tests, 9 test files).
- **Manual smoke** — the 9 checks from Slice 2b plus two new ones:
  - **Add task:** click `+ Add task`, fill the modal, submit. New row appears and the modal closes.
  - **Bulk edit:** select 2+ rows, open bulk edit, toggle 2 fields, apply. Both rows update; modal closes; bulk-edit draft resets on next open.

## Risk & rollback

Mechanical refactor; same shape as Slices 1 and 2. State relocates; semantics don't change.

**Risks:**

- **Missed setter call site.** ~14 call sites across `task-manager.tsx`. Each becomes a read from the `useTaskForm()` destructure. A missed rename → TypeScript fails on undefined identifier. Caught by `npm run build`.
- **Stale import.** `emptyForm()` and `emptyBulkEdit()` are called from multiple handlers. After the move, they're imports from `./task-form-context`. Forgetting to import → TS error. Caught immediately.
- **Updater-form regression.** Inline input handlers use `setForm(prev => …)`. The provider's `Dispatch<SetStateAction>` typing accepts this, but a typo in the destructure (e.g., binding `setForm` to the wrong name) would silently break form input. Test #3 covers this exact path.
- **Provider order.** `TaskFormProvider` doesn't read any other context, so order is forgiving — but reversing it with `TaskManagerInner` would mean `useTaskForm()` throws at first render. Caught immediately by the throw guard.

**Rollback**: `git revert` the slice's commits. No storage-format change, no API change, no migration.

## What this unlocks

- **`TaskManagerInner` is now mostly orchestration**: it owns about 25 remaining `useState` slices (drag state, toast, JIRA-conflict modal state, absence/shift modals, etc.) plus the handlers that bridge contexts. Most of those are short-lived UI concerns that don't merit further extraction — the decomposition reaches a natural stopping point here.
- **Potential follow-up Slice 4 (modal component extraction)**: with form data in context, `<TaskFormModal>` and `<BulkEditModal>` could be lifted out of `TaskManagerInner` and consume the form context directly. Out of scope for Slice 3 but newly feasible.
- **Pattern consistency.** Four `*-context.tsx` providers now follow the same shape (`Dispatch<SetStateAction>` setters, throw-outside-provider guard). Future feature work can mirror the pattern.
