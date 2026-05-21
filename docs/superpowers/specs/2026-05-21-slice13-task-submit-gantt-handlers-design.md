# Slice 13 — useTaskSubmit + useGanttHandlers Design

**Version:** v0.8.1 "Ibsen"
**Date:** 2026-05-21
**Status:** Approved

---

## Overview

Extract two hooks from `task-manager.tsx` as part of the ongoing decomposition series (Slices 5–12 pattern). `useTaskSubmit` owns `error` state and the three form lifecycle functions (`handleSubmit`, `handleCancelEdit`, `openEditModal`). `useGanttHandlers` owns `handleGanttBarUpdate`. Together they remove ~165 lines from task-manager.tsx.

---

## Architecture

### New Files

| File | Responsibility |
|------|---------------|
| `src/app/use-task-submit.ts` | `error` state + `handleSubmit` + `handleCancelEdit` + `openEditModal` |
| `src/app/use-task-submit.test.ts` | 5 Vitest unit tests |
| `src/app/use-gantt-handlers.ts` | `handleGanttBarUpdate` |
| `src/app/use-gantt-handlers.test.ts` | 3 Vitest unit tests |

### Modified Files

| File | Change |
|------|--------|
| `src/app/task-manager.tsx` | Add imports; remove `error` state, `handleSubmit`, `handleCancelEdit`, `openEditModal`, `handleGanttBarUpdate`; insert `onPushToJiraRef` + both hook calls; sync ref after `useTaskRowHandlers` |
| `src/app/version.ts` | Bump to v0.8.1 |
| `CHANGELOG.md` | [0.8.1] "Ibsen" entry |
| `README.md` | Badge v0.8.0 → v0.8.1 |

### Circular Dependency Resolution

`openEditModal` must be available before `useTaskRowHandlers` (which receives it as an arg), but `handleSubmit` needs `onPushToJira` which comes back from `useTaskRowHandlers`. Resolved with the `onPushToJiraRef` pattern — identical to `handleCancelEditRef`/`showToastRef` already used in `use-task-row-handlers.ts`.

### Hook Call Order in task-manager.tsx

```
useTaskForm()                               // form state (existing, Slice 3)
  ↓
onPushToJiraRef = useRef(noop)              // NEW — breaks circular dep
useTaskSubmit({ …, onPushToJiraRef })       // NEW — provides openEditModal + handleCancelEdit
  ↓
useTaskRowHandlers({ openEditModal, handleCancelEdit, … })   // existing (Slice 12)
onPushToJiraRef.current = onPushToJira      // NEW — sync ref after hook returns
  ↓
useGanttHandlers({ tasksRef, setTasks, today })  // NEW
```

---

## Hook Interfaces

### useTaskSubmit

```typescript
// src/app/use-task-submit.ts
import type React from "react";
import type { TaskForm } from "./task-form-context";
import type { Task } from "./types";
import type { Settings } from "./settings-menu";
import type { Lang } from "./i18n";
import type { Contact } from "./contacts";
import type { ActivityKind } from "./activity-log";

export interface UseTaskSubmitArgs {
  form: TaskForm;
  setForm: React.Dispatch<React.SetStateAction<TaskForm>>;
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
}
```

**Implementation notes:**
- `nextId` computed internally: `tasks.length > 0 ? Math.max(...tasks.map(t => t.id)) + 1 : 1`
- `error` owned via `useState<string | null>(null)`
- `setError` never exposed — `openEditModal` and `handleCancelEdit` call it directly
- `handleSubmit` calls `onPushToJiraRef.current(newId)` (not `onPushToJira` directly)
- All three handlers wrapped in `useCallback` with appropriate deps
- Sanitize helpers (`sanitizeTaskName`, `sanitizeAssignee`, etc.) imported from `./sanitize`
- `upsertContact` imported from `./contacts`
- `emptyForm` imported from `./task-form-context`

### useGanttHandlers

```typescript
// src/app/use-gantt-handlers.ts
import type React from "react";
import type { Task } from "./types";

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
}
```

**Implementation notes:**
- `handleGanttBarUpdate` wrapped in `useCallback` with deps `[tasksRef, setTasks, today]`
- Uses `sanitizeIsoDate` from `./sanitize` for date validation
- Clamps start > due to due date (preserves existing behavior)
- Stamps `lastUpdateDate: today` and `localModifiedAt: new Date().toISOString()` on the edited row
- Updates both `tasksRef.current` and `setTasks` synchronously (same pattern as `onPushToJira`)

---

## Tests

### useTaskSubmit — 5 tests

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

### useGanttHandlers — 3 tests

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

---

## Version

- **Version:** `0.8.1`
- **Codename:** Ibsen
- **Date:** 2026-05-21
- **Rationale:** Patch bump — pure extraction, no user-visible behaviour change

---

## Approved Decisions

1. **Two hooks, not one** — `useTaskSubmit` (form lifecycle) and `useGanttHandlers` (Gantt drag) are semantically distinct; separate files, separate tests.
2. **`onPushToJiraRef` pattern** — breaks the `openEditModal` ↔ `onPushToJira` circular dep using the same ref-sync technique already established in `use-task-row-handlers.ts`.
3. **`nextId` computed inside `useTaskSubmit`** — not an arg; derived from `tasks` which is already passed for validation.
4. **`setError` not exposed** — stays internal; callers get `error` (read-only) and the three handler functions that clear/set it implicitly.
5. **`handleGanttBarUpdate` wrapped in `useCallback`** — consistent with all other extracted callbacks in this decomposition series.
