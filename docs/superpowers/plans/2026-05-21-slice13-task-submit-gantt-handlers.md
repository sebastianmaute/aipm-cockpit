# Slice 13 — useTaskSubmit + useGanttHandlers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `useTaskSubmit` (error state + form submit/cancel/open handlers) and `useGanttHandlers` (Gantt drag handler) from `task-manager.tsx`, reducing it by ~165 lines and tagging the result v0.8.1 "Ibsen".

**Architecture:** `useTaskSubmit` owns `error` state and the three form lifecycle callbacks; an `onPushToJiraRef` forwarding ref breaks the circular dependency between `openEditModal` (needed by `useTaskRowHandlers` as an arg) and `onPushToJira` (returned by `useTaskRowHandlers`). `useGanttHandlers` is a thin wrapper around the single Gantt drag callback. Both hooks follow the established pattern from Slices 5–12 (args object, `useCallback` for every handler, unit-tested in isolation with `renderHook`).

**Tech Stack:** TypeScript 5, React 19 (`useState`, `useCallback`, `useRef`), Vitest 3, `@testing-library/react` 16 (`renderHook`, `act`).

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/app/use-task-submit.ts` | Create | `error` state + `handleSubmit` + `handleCancelEdit` + `openEditModal` |
| `src/app/use-task-submit.test.ts` | Create | 5 unit tests |
| `src/app/use-gantt-handlers.ts` | Create | `handleGanttBarUpdate` wrapped in `useCallback` |
| `src/app/use-gantt-handlers.test.ts` | Create | 3 unit tests |
| `src/app/task-manager.tsx` | Modify | Add imports; remove `error` state, `nextId`, `handleSubmit`, `handleCancelEdit`, `openEditModal`, `handleGanttBarUpdate`; add `onPushToJiraRef` + both hook calls + ref-sync |
| `src/app/version.ts` | Modify | Bump `APP_VERSION` to `"0.8.1"` |
| `CHANGELOG.md` | Modify | Add `[0.8.1] "Ibsen"` entry |
| `README.md` | Modify | Badge `v0.8.0` → `v0.8.1` |

---

### Task 1: Scaffold use-task-submit.test.ts (RED)

**Files:**
- Create: `src/app/use-task-submit.test.ts`

- [ ] **Step 1: Write the failing test file**

```typescript
// src/app/use-task-submit.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTaskSubmit } from "./use-task-submit";
import type { Task } from "./types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Test task",
    assignee: "Alice",
    assigneeEmail: "alice@example.com",
    dueDate: "2030-12-31",
    lastUpdateDate: "2030-01-01",
    priority: "Medium",
    blockers: "",
    notes: "",
    ...overrides,
  };
}

function validForm() {
  return {
    taskName: "Valid Task",
    assignee: "Bob",
    assigneeEmail: "",
    startDate: "",
    dueDate: "2030-12-31",
    lastUpdateDate: "2030-01-01",
    priority: "Medium" as const,
    blockers: "",
    notes: "",
    group: "",
    labels: [],
    dependencies: [],
    pushToJira: false,
    healthOverride: "",
  };
}

function fakeSubmitEvent(): React.FormEvent<HTMLFormElement> {
  return { preventDefault: vi.fn() } as unknown as React.FormEvent<HTMLFormElement>;
}

function makeArgs(overrides: Partial<Parameters<typeof useTaskSubmit>[0]> = {}) {
  return {
    form: validForm(),
    setForm: vi.fn(),
    editingId: null,
    setEditingId: vi.fn(),
    setTaskModalOpen: vi.fn(),
    tasks: [makeTask()],
    today: "2030-01-01",
    lang: "en-US" as const,
    settings: { jira: { enabled: false, siteUrl: "", email: "", apiToken: "", projectKey: "", issueTypes: [] } } as unknown as Parameters<typeof useTaskSubmit>[0]["settings"],
    tasksRef: { current: [makeTask()] },
    setTasks: vi.fn(),
    setContacts: vi.fn(),
    logActivity: vi.fn(),
    showToast: vi.fn(),
    onPushToJiraRef: { current: vi.fn().mockResolvedValue(false) },
    ...overrides,
  };
}

describe("useTaskSubmit", () => {
  it("error is null initially", () => {
    const { result } = renderHook(() => useTaskSubmit(makeArgs()));
    expect(result.current.error).toBeNull();
  });

  it("handleSubmit sets error when required fields are missing", () => {
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({ form: { ...validForm(), taskName: "" } })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    expect(result.current.error).not.toBeNull();
  });

  it("handleSubmit calls setTasks on valid new-task submission", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({ setTasks })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    expect(setTasks).toHaveBeenCalled();
  });

  it("handleCancelEdit resets editingId", () => {
    const setEditingId = vi.fn();
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({ setEditingId })),
    );
    act(() => result.current.handleCancelEdit());
    expect(setEditingId).toHaveBeenCalledWith(null);
  });

  it("openEditModal calls setEditingId with the task id", () => {
    const setEditingId = vi.fn();
    const task = makeTask();
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({ setEditingId })),
    );
    act(() => result.current.openEditModal(task));
    expect(setEditingId).toHaveBeenCalledWith(task.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/app/use-task-submit.test.ts
```

Expected: 5 failures — `Cannot find module './use-task-submit'`.

- [ ] **Step 3: Commit the failing tests**

```
git add src/app/use-task-submit.test.ts
git commit -m "test(use-task-submit): 5 failing tests (RED)"
```

---

### Task 2: Implement use-task-submit.ts (GREEN)

**Files:**
- Create: `src/app/use-task-submit.ts`

- [ ] **Step 1: Create the implementation file**

```typescript
// src/app/use-task-submit.ts
"use client";
import { useCallback, useState } from "react";
import type React from "react";
import { emptyForm, type TaskFormDraft } from "./task-form-context";
import { upsertContact, type Contact } from "./contacts";
import { type ActivityKind } from "./activity-log";
import { t, type Lang } from "./i18n";
import { type Settings } from "./settings-menu";
import { type Task } from "./types";
import {
  isValidEmail,
  sanitizeAssignee,
  sanitizeBlockers,
  sanitizeDependencies,
  sanitizeEmail,
  sanitizeGroup,
  sanitizeIsoDate,
  sanitizeLabels,
  sanitizeNotes,
  sanitizePriority,
  sanitizeTaskName,
} from "./sanitize";

export interface UseTaskSubmitArgs {
  form: TaskFormDraft;
  setForm: React.Dispatch<React.SetStateAction<TaskFormDraft>>;
  editingId: number | null;
  setEditingId: React.Dispatch<React.SetStateAction<number | null>>;
  setTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  tasks: Task[];
  today: string;
  lang: Lang;
  settings: Settings;
  tasksRef: React.MutableRefObject<Task[]>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setContacts: React.Dispatch<React.SetStateAction<Contact[]>>;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  onPushToJiraRef: React.MutableRefObject<(taskId: number) => Promise<boolean>>;
}

export function useTaskSubmit(args: UseTaskSubmitArgs): {
  error: string | null;
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  handleCancelEdit: () => void;
  openEditModal: (task: Task) => void;
} {
  const {
    form,
    setForm,
    editingId,
    setEditingId,
    setTaskModalOpen,
    tasks,
    today,
    lang,
    settings,
    tasksRef,
    setTasks,
    setContacts,
    logActivity,
    onPushToJiraRef,
  } = args;

  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);

      const taskName = sanitizeTaskName(form.taskName);
      const assignee = sanitizeAssignee(form.assignee);
      const dueDate = sanitizeIsoDate(form.dueDate);

      if (!taskName || !assignee || !dueDate) {
        setError(t(lang, "errorRequired"));
        return;
      }
      if (dueDate < today) {
        setError(t(lang, "errorPastDate"));
        return;
      }

      if (editingId !== null) {
        const existing = tasks.find((row) => row.id === editingId);
        if (
          existing?.jiraKey &&
          sanitizeAssignee(existing.assignee) !== assignee
        ) {
          window.alert(t(lang, "jiraAssigneeForbidden", existing.jiraKey));
          return;
        }
      }

      const email = sanitizeEmail(form.assigneeEmail);
      if (email && !isValidEmail(email)) {
        setError(t(lang, "errorInvalidEmail"));
        return;
      }

      const knownIds = new Set(tasks.map((row) => row.id));
      const cleanDependencies = sanitizeDependencies(
        form.dependencies,
        knownIds,
        editingId,
      );

      const rawStart = sanitizeIsoDate(form.startDate);
      const startDate =
        rawStart && rawStart > dueDate ? dueDate : rawStart || undefined;

      const payload = {
        taskName,
        assignee,
        assigneeEmail: email,
        startDate,
        dueDate,
        lastUpdateDate: sanitizeIsoDate(form.lastUpdateDate) || today,
        priority: sanitizePriority(form.priority),
        blockers: sanitizeBlockers(form.blockers),
        notes: sanitizeNotes(form.notes),
        group: sanitizeGroup(form.group),
        labels: sanitizeLabels(form.labels),
        dependencies: cleanDependencies,
        healthOverride: form.healthOverride || undefined,
      };

      setContacts((prev) => upsertContact(prev, assignee, email));

      if (editingId !== null) {
        const stamp = new Date().toISOString();
        const updatedId = editingId;
        setTasks((prev) =>
          prev.map((row) =>
            row.id === editingId
              ? { ...row, ...payload, localModifiedAt: stamp }
              : row,
          ),
        );
        setEditingId(null);
        logActivity("task.updated", updatedId, taskName);
      } else {
        const nextId =
          tasks.length > 0 ? Math.max(...tasks.map((row) => row.id)) + 1 : 1;
        const newTask: Task = { id: nextId, ...payload, inquiriesSent: 0 };
        const newId = newTask.id;
        const shouldPush =
          form.pushToJira &&
          settings.jira.enabled &&
          !!settings.jira.projectKey;
        const nextList = [...tasksRef.current, newTask];
        tasksRef.current = nextList;
        setTasks(nextList);
        logActivity("task.created", newId, taskName);
        if (shouldPush) {
          void onPushToJiraRef.current(newId);
        }
      }
      setForm(emptyForm());
      setTaskModalOpen(false);
    },
    [
      form,
      editingId,
      tasks,
      today,
      lang,
      settings,
      tasksRef,
      setTasks,
      setEditingId,
      setForm,
      setTaskModalOpen,
      setContacts,
      logActivity,
      onPushToJiraRef,
    ],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setError(null);
    setForm(emptyForm());
    setTaskModalOpen(false);
  }, [setEditingId, setForm, setTaskModalOpen]);

  const openEditModal = useCallback(
    (task: Task) => {
      setEditingId(task.id);
      setError(null);
      setTaskModalOpen(true);
      setForm({
        taskName: task.taskName,
        assignee: task.assignee,
        assigneeEmail: task.assigneeEmail ?? "",
        startDate: task.startDate ?? "",
        dueDate: task.dueDate,
        lastUpdateDate: task.lastUpdateDate,
        priority: task.priority,
        blockers: task.blockers,
        notes: task.notes,
        group: task.group ?? "",
        labels: task.labels ?? [],
        dependencies: task.dependencies ?? [],
        pushToJira: false,
        healthOverride: task.healthOverride ?? "",
      });
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [setEditingId, setTaskModalOpen, setForm],
  );

  return { error, handleSubmit, handleCancelEdit, openEditModal };
}
```

- [ ] **Step 2: Run tests — all 5 must pass**

```
npx vitest run src/app/use-task-submit.test.ts
```

Expected: `5 passed`.

- [ ] **Step 3: Commit**

```
git add src/app/use-task-submit.ts
git commit -m "feat(use-task-submit): extract error state + handleSubmit + handleCancelEdit + openEditModal"
```

---

### Task 3: Scaffold use-gantt-handlers.test.ts (RED)

**Files:**
- Create: `src/app/use-gantt-handlers.test.ts`

- [ ] **Step 1: Write the failing test file**

```typescript
// src/app/use-gantt-handlers.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGanttHandlers } from "./use-gantt-handlers";
import type { Task } from "./types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Test task",
    assignee: "Alice",
    assigneeEmail: "",
    dueDate: "2030-12-31",
    lastUpdateDate: "2030-01-01",
    priority: "Medium",
    blockers: "",
    notes: "",
    ...overrides,
  };
}

function makeArgs(overrides: Partial<Parameters<typeof useGanttHandlers>[0]> = {}) {
  return {
    tasksRef: { current: [makeTask()] },
    setTasks: vi.fn(),
    today: "2030-01-01",
    ...overrides,
  };
}

describe("useGanttHandlers", () => {
  it("handleGanttBarUpdate calls setTasks with updated dates", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() => useGanttHandlers(makeArgs({ setTasks })));
    act(() => result.current.handleGanttBarUpdate({
      taskId: 1,
      startDate: "2030-01-01",
      dueDate: "2030-01-31",
    }));
    expect(setTasks).toHaveBeenCalled();
  });

  it("handleGanttBarUpdate no-ops on unparseable due date", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() => useGanttHandlers(makeArgs({ setTasks })));
    act(() => result.current.handleGanttBarUpdate({
      taskId: 1,
      startDate: "2030-01-01",
      dueDate: "not-a-date",
    }));
    expect(setTasks).not.toHaveBeenCalled();
  });

  it("handleGanttBarUpdate clamps start date that exceeds due date", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() => useGanttHandlers(makeArgs({ setTasks })));
    act(() => result.current.handleGanttBarUpdate({
      taskId: 1,
      startDate: "2030-02-01",
      dueDate: "2030-01-15",
    }));
    expect(setTasks).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ startDate: "2030-01-15" }),
      ]),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/app/use-gantt-handlers.test.ts
```

Expected: 3 failures — `Cannot find module './use-gantt-handlers'`.

- [ ] **Step 3: Commit the failing tests**

```
git add src/app/use-gantt-handlers.test.ts
git commit -m "test(use-gantt-handlers): 3 failing tests (RED)"
```

---

### Task 4: Implement use-gantt-handlers.ts (GREEN)

**Files:**
- Create: `src/app/use-gantt-handlers.ts`

- [ ] **Step 1: Create the implementation file**

```typescript
// src/app/use-gantt-handlers.ts
"use client";
import { useCallback } from "react";
import type React from "react";
import { type Task } from "./types";
import { sanitizeIsoDate } from "./sanitize";

export interface UseGanttHandlersArgs {
  tasksRef: React.MutableRefObject<Task[]>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  today: string;
}

export function useGanttHandlers(args: UseGanttHandlersArgs): {
  handleGanttBarUpdate: (edit: {
    taskId: number;
    startDate: string;
    dueDate: string;
  }) => void;
} {
  const { tasksRef, setTasks, today } = args;

  const handleGanttBarUpdate = useCallback(
    (edit: { taskId: number; startDate: string; dueDate: string }) => {
      const start = sanitizeIsoDate(edit.startDate);
      const due = sanitizeIsoDate(edit.dueDate);
      if (!due) return;
      const finalStart = start && start > due ? due : start;
      const stamp = new Date().toISOString();
      const next = tasksRef.current.map((row) =>
        row.id === edit.taskId
          ? {
              ...row,
              startDate: finalStart || undefined,
              dueDate: due,
              lastUpdateDate: today,
              localModifiedAt: stamp,
            }
          : row,
      );
      tasksRef.current = next;
      setTasks(next);
    },
    [tasksRef, setTasks, today],
  );

  return { handleGanttBarUpdate };
}
```

- [ ] **Step 2: Run tests — all 3 must pass**

```
npx vitest run src/app/use-gantt-handlers.test.ts
```

Expected: `3 passed`.

- [ ] **Step 3: Run full test suite to confirm no regressions**

```
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```
git add src/app/use-gantt-handlers.ts
git commit -m "feat(use-gantt-handlers): extract handleGanttBarUpdate into standalone hook"
```

---

### Task 5: Refactor task-manager.tsx

**Files:**
- Modify: `src/app/task-manager.tsx`

This task removes ~165 lines from `task-manager.tsx` by wiring the two new hooks. Apply each edit below in order; run `npx tsc --noEmit` after all edits to confirm no type errors introduced.

#### 5a — Add imports

- [ ] **Step 1: Add the two new hook imports** after `import { useTaskRowHandlers } from "./use-task-row-handlers";` (currently ~line 34):

```typescript
import { useTaskSubmit } from "./use-task-submit";
import { useGanttHandlers } from "./use-gantt-handlers";
```

#### 5b — Remove inline state and functions

- [ ] **Step 2: Remove the `error` state declaration** (the line `const [error, setError] = useState<string | null>(null);` immediately after the `useColumnManager` destructure, currently ~line 237).

- [ ] **Step 3: Remove the `nextId` computation** (currently ~lines 366–367, the two lines starting with `const nextId =`).

- [ ] **Step 4: Remove the `handleSubmit` function** — the entire block from `function handleSubmit(e: React.FormEvent<HTMLFormElement>) {` through its closing `}` (~lines 384–491, ~108 lines).

- [ ] **Step 5: Remove the `handleCancelEdit` function** — the entire block from `function handleCancelEdit() {` through its closing `}` (~lines 494–499, 6 lines).

- [ ] **Step 6: Remove the `openEditModal` useCallback** — the entire block from `const openEditModal = useCallback(` through its closing `}, []);` (~lines 523–546, ~25 lines).

#### 5c — Insert onPushToJiraRef + useTaskSubmit

After the `tasksRef` `useRef` + `useEffect` sync block (currently ~lines 518–521, which stay in place), insert:

- [ ] **Step 7: Insert `onPushToJiraRef` declaration and `useTaskSubmit` call**

```typescript
  const onPushToJiraRef = useRef<(taskId: number) => Promise<boolean>>(
    () => Promise.resolve(false),
  );
  const { error, handleSubmit, handleCancelEdit, openEditModal } = useTaskSubmit({
    form,
    setForm,
    editingId,
    setEditingId,
    setTaskModalOpen,
    tasks,
    today,
    lang,
    settings,
    tasksRef,
    setTasks,
    setContacts,
    logActivity,
    showToast,
    onPushToJiraRef,
  });
```

#### 5d — Sync onPushToJiraRef after useTaskRowHandlers

`useTaskRowHandlers` returns `onPushToJira`. This must be written into `onPushToJiraRef.current` immediately after the hook's closing `});`.

- [ ] **Step 8: After the closing `});` of `useTaskRowHandlers`**, add:

```typescript
  onPushToJiraRef.current = onPushToJira;
```

#### 5e — Replace handleGanttBarUpdate with useGanttHandlers

- [ ] **Step 9: Remove the `handleGanttBarUpdate` function** — the entire block from the JSDoc comment `/** Commit a Gantt drag-edit…` through the function's closing `}` (~lines 606–644, ~39 lines including the comment).

- [ ] **Step 10: After `deselectIdRef.current = deselectId;`**, insert:

```typescript
  const { handleGanttBarUpdate } = useGanttHandlers({ tasksRef, setTasks, today });
```

#### 5f — Clean up now-unused imports

After the removals, these items are no longer used directly in `task-manager.tsx` (they moved into the hooks). Remove them from the `./sanitize` import:

```
isValidEmail, sanitizeAssignee, sanitizeBlockers, sanitizeDependencies,
sanitizeEmail, sanitizeGroup, sanitizeIsoDate, sanitizeLabels,
sanitizeNotes, sanitizePriority, sanitizeTaskName
```

Also remove `upsertContact` from the `./contacts` import (it moved into `useTaskSubmit`). Keep `greetingName` if it is still referenced in the JSX.

Check whether `sanitizeNonNegInt` and `sanitizeVoiceTranscript` are still referenced; keep them only if so.

- [ ] **Step 11: Type-check**

```
npx tsc --noEmit
```

Expected: 0 new errors. (A pre-existing error in `use-due-alerts.test.ts` about `backend` property may appear — it predates this slice and can be ignored.)

- [ ] **Step 12: Run full test suite**

```
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 13: Commit**

```
git add src/app/task-manager.tsx
git commit -m "refactor(task-manager): consume useTaskSubmit + useGanttHandlers; remove ~165 inline lines"
```

---

### Task 6: Version bump to v0.8.1 "Ibsen"

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Update `src/app/version.ts`**

Prepend this comment block above the existing `// 0.8.0 …` comment, and change `APP_VERSION`:

```typescript
// 0.8.1 extracts useTaskSubmit (~135 LoC) and useGanttHandlers (~35 LoC)
// from task-manager.tsx. Slice 13 of the decomposition: useTaskSubmit owns
// error state and the three form lifecycle callbacks (handleSubmit,
// handleCancelEdit, openEditModal). useGanttHandlers owns handleGanttBarUpdate.
// Circular dep between openEditModal and onPushToJira resolved via
// onPushToJiraRef (same ref-sync pattern as handleCancelEditRef in Slice 12).
// 8 new unit tests. task-manager.tsx ~−165 lines.
export const APP_VERSION = "0.8.1";
```

Leave `APP_BUILD_DATE`, `APP_REPO_URL`, and `APP_HIGHLIGHT_KEYS` unchanged.

- [ ] **Step 2: Add CHANGELOG entry** — prepend above the existing `## [0.8.0]` block:

```markdown
## [0.8.1] "Ibsen" — 2026-05-21

### Refactored

- Extract `useTaskSubmit`: `error` state + `handleSubmit` + `handleCancelEdit` + `openEditModal`
- Extract `useGanttHandlers`: `handleGanttBarUpdate` wrapped in `useCallback`
- Add `onPushToJiraRef` forwarding ref to break `openEditModal` ↔ `onPushToJira` circular dep
- Remove `nextId` from `task-manager.tsx` (computed inside `useTaskSubmit`)
- `task-manager.tsx` −165 lines; 8 new unit tests
```

- [ ] **Step 3: Update README badge** — change `**v0.8.0**` to `**v0.8.1**` in `README.md`.

- [ ] **Step 4: Commit**

```
git add src/app/version.ts CHANGELOG.md README.md
git commit -m "release(v0.8.1): Ibsen - useTaskSubmit + useGanttHandlers extraction"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Covered by |
|-----------------|------------|
| `useTaskSubmit` owns `error` state | Task 2 — `useState<string \| null>(null)` |
| `handleSubmit` in `useTaskSubmit` | Task 2 — full submit logic in `useCallback` |
| `handleCancelEdit` in `useTaskSubmit` | Task 2 — clears id + error + form |
| `openEditModal` in `useTaskSubmit` | Task 2 — populates form + scrolls |
| `nextId` computed internally | Task 2 — derived from `tasks` arg |
| `setError` not exposed | Task 2 — internal only |
| `useGanttHandlers` owns `handleGanttBarUpdate` | Task 4 |
| `handleGanttBarUpdate` in `useCallback` | Task 4 — deps `[tasksRef, setTasks, today]` |
| Start > due clamped to due | Task 4 |
| Stamps `lastUpdateDate` + `localModifiedAt` | Task 4 |
| `onPushToJiraRef` breaks circular dep | Tasks 5c + 5d |
| Hook call order: `useTaskSubmit` before `useTaskRowHandlers`; ref sync after | Task 5 |
| 5 tests for `useTaskSubmit` | Task 1 |
| 3 tests for `useGanttHandlers` | Task 3 |
| v0.8.1 "Ibsen" bump | Task 6 |

**Type note:** The spec referenced `TaskForm` as the form type; the actual exported type from `task-form-context.tsx` is `TaskFormDraft`. Task 2 uses the correct name.

**Placeholder scan:** No TBD/TODO present. All code blocks are complete and self-contained.
