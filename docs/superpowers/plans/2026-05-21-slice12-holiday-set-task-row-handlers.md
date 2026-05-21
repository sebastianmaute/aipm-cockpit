# Slice 12 — useHolidaySet + useTaskRowHandlers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `useHolidaySet` and `useTaskRowHandlers` from `task-manager.tsx`, removing ~120 lines of inline state and callbacks and releasing v0.8.0 "Hemingway".

**Architecture:** Two plain hooks following the slice 5–11 pattern. `useHolidaySet` wraps the existing `holidaysForCountries` async utility with a cancellation flag. `useTaskRowHandlers` owns `expandedNotes` + `pushingIds` state and the 9 row-level callbacks that previously lived inline; `openEditModal` is passed in as an arg so the hook stays decoupled from form state. `tasksRef` stays inline in task-manager (mutated by `handleSubmit`/`handleGanttBarUpdate`) and is passed through. `handleEdit` duplicate is eliminated; `useBulkOperations` receives `onEdit` directly from the hook.

**Tech Stack:** React 19, TypeScript 5, Vitest 3, @testing-library/react 16, `date-holidays` (via existing `holidaysForCountries` utility)

---

## File Map

| Action | File |
|--------|------|
| Create | `src/app/use-holiday-set.ts` |
| Create | `src/app/use-holiday-set.test.ts` |
| Create | `src/app/use-task-row-handlers.ts` |
| Create | `src/app/use-task-row-handlers.test.ts` |
| Modify | `src/app/task-manager.tsx` |
| Modify | `src/app/version.ts` |
| Modify | `CHANGELOG.md` |
| Modify | `README.md` |

---

## Task 1: Scaffold use-holiday-set.test.ts (RED)

**Files:**
- Create: `src/app/use-holiday-set.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/use-holiday-set.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useHolidaySet } from "./use-holiday-set";

describe("useHolidaySet", () => {
  it("returns empty set initially", () => {
    const { result } = renderHook(() =>
      useHolidaySet({ holidayCountries: ["DE"] }),
    );
    expect(result.current.holidaySet.size).toBe(0);
  });

  it("resolves holidays after async load", async () => {
    const { result } = renderHook(() =>
      useHolidaySet({ holidayCountries: ["DE"] }),
    );
    await act(async () => {});
    expect(result.current.holidaySet.size).toBeGreaterThan(0);
  });

  it("cancels in-flight load on unmount — no state update after unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useHolidaySet({ holidayCountries: ["DE"] }),
    );
    unmount();
    // No "Can't perform a React state update on an unmounted component" warning
    await act(async () => {});
    expect(result.current.holidaySet.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm RED**

```
npx vitest run src/app/use-holiday-set.test.ts
```

Expected: 3 failures — `Cannot find module './use-holiday-set'`

- [ ] **Step 3: Commit the test scaffold**

```
git add src/app/use-holiday-set.test.ts
git commit -m "test(use-holiday-set): scaffold 3 failing tests"
```

---

## Task 2: Implement use-holiday-set.ts (GREEN)

**Files:**
- Create: `src/app/use-holiday-set.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/app/use-holiday-set.ts
"use client";
import { useEffect, useState } from "react";
import { holidaysForCountries } from "./holidays";

interface UseHolidaySetArgs {
  holidayCountries: string[];
}

export function useHolidaySet({ holidayCountries }: UseHolidaySetArgs): {
  holidaySet: Set<string>;
} {
  const [holidaySet, setHolidaySet] = useState<Set<string>>(
    () => new Set<string>(),
  );

  useEffect(() => {
    let cancelled = false;
    void holidaysForCountries(holidayCountries).then((set) => {
      if (!cancelled) setHolidaySet(set);
    });
    return () => {
      cancelled = true;
    };
  }, [holidayCountries]);

  return { holidaySet };
}
```

- [ ] **Step 2: Run tests to confirm GREEN**

```
npx vitest run src/app/use-holiday-set.test.ts
```

Expected: 3 passing

- [ ] **Step 3: Commit**

```
git add src/app/use-holiday-set.ts
git commit -m "feat(use-holiday-set): extract holidaySet state + async load effect"
```

---

## Task 3: Scaffold use-task-row-handlers.test.ts (RED)

**Files:**
- Create: `src/app/use-task-row-handlers.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/use-task-row-handlers.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTaskRowHandlers } from "./use-task-row-handlers";
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

function makeArgs(
  overrides: Partial<Parameters<typeof useTaskRowHandlers>[0]> = {},
) {
  const tasksRef = { current: [makeTask()] };
  return {
    tasksRef,
    settings: {
      jira: {
        enabled: false,
        siteUrl: "",
        email: "",
        apiToken: "",
        projectKey: "",
        issueTypes: [],
      },
    } as Parameters<typeof useTaskRowHandlers>[0]["settings"],
    lang: "en-US" as const,
    today: "2030-01-01",
    editingId: null,
    showToast: vi.fn() as (kind: "info" | "error", text: string) => void,
    openEditModal: vi.fn() as (task: Task) => void,
    setTasks: vi.fn() as Parameters<typeof useTaskRowHandlers>[0]["setTasks"],
    setRaidFilterTaskId: vi.fn() as Parameters<
      typeof useTaskRowHandlers
    >[0]["setRaidFilterTaskId"],
    setActiveTab: vi.fn() as Parameters<
      typeof useTaskRowHandlers
    >[0]["setActiveTab"],
    setWorkspaceCollapsed: vi.fn() as Parameters<
      typeof useTaskRowHandlers
    >[0]["setWorkspaceCollapsed"],
    deselectIdRef: { current: vi.fn() as (id: number) => void },
    handleCancelEdit: vi.fn(),
    logActivity: vi.fn() as Parameters<
      typeof useTaskRowHandlers
    >[0]["logActivity"],
    ...overrides,
  };
}

describe("useTaskRowHandlers", () => {
  it("returns empty expandedNotes and pushingIds initially", () => {
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs()));
    expect(result.current.expandedNotes.size).toBe(0);
    expect(result.current.pushingIds.size).toBe(0);
  });

  it("onToggleNoteExpanded adds then removes id from expandedNotes", () => {
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs()));
    act(() => result.current.onToggleNoteExpanded(1));
    expect(result.current.expandedNotes.has(1)).toBe(true);
    act(() => result.current.onToggleNoteExpanded(1));
    expect(result.current.expandedNotes.has(1)).toBe(false);
  });

  it("onToggleComplete calls setTasks", () => {
    const setTasks = vi.fn();
    const task = makeTask();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ setTasks })),
    );
    act(() => result.current.onToggleComplete(task));
    expect(setTasks).toHaveBeenCalled();
  });

  it("onDelete calls setTasks when user confirms", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const setTasks = vi.fn();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ setTasks })),
    );
    act(() => result.current.onDelete(1));
    expect(setTasks).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("onEdit calls openEditModal with the task", () => {
    const openEditModal = vi.fn();
    const task = makeTask();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ openEditModal })),
    );
    act(() => result.current.onEdit(task));
    expect(openEditModal).toHaveBeenCalledWith(task);
  });

  it("handleClearRaidTaskFilter calls setRaidFilterTaskId with null", () => {
    const setRaidFilterTaskId = vi.fn();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ setRaidFilterTaskId })),
    );
    act(() => result.current.handleClearRaidTaskFilter());
    expect(setRaidFilterTaskId).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: Run tests to confirm RED**

```
npx vitest run src/app/use-task-row-handlers.test.ts
```

Expected: 6 failures — `Cannot find module './use-task-row-handlers'`

- [ ] **Step 3: Commit the test scaffold**

```
git add src/app/use-task-row-handlers.test.ts
git commit -m "test(use-task-row-handlers): scaffold 6 failing tests"
```

---

## Task 4: Implement use-task-row-handlers.ts (GREEN)

**Files:**
- Create: `src/app/use-task-row-handlers.ts`
- Modify: `src/app/task-manager.tsx` (export `TopTab` only — one-line change)

**Context:** `TopTab` is currently unexported in `task-manager.tsx` line 182. `ActivityKind` is exported from `./activity-log`. `loadJiraApi` is re-exported from `./use-jira-sync`. `isValidEmail` from `./sanitize`, `greetingName` from `./contacts`. The `handleCancelEditRef` pattern (sync ref updated in an effect) mirrors the `logActivityRef` pattern used in `use-bulk-operations.ts` and `use-resource-planner.ts`.

- [ ] **Step 1: Export TopTab from task-manager.tsx**

In `src/app/task-manager.tsx` at line 182, change:

```typescript
type TopTab = "chat" | "reports" | "gantt" | "raid" | "resources" | "activity";
```

to:

```typescript
export type TopTab = "chat" | "reports" | "gantt" | "raid" | "resources" | "activity";
```

- [ ] **Step 2: Write the implementation**

```typescript
// src/app/use-task-row-handlers.ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { t, type Lang } from "./i18n";
import { isValidEmail } from "./sanitize";
import { greetingName } from "./contacts";
import { loadJiraApi } from "./use-jira-sync";
import type { ActivityKind } from "./activity-log";
import type { Task } from "./types";
import type { Settings } from "./settings-menu";
import type { TopTab } from "./task-manager";

export interface UseTaskRowHandlersArgs {
  tasksRef: React.MutableRefObject<Task[]>;
  settings: Settings;
  lang: Lang;
  today: string;
  editingId: number | null;
  showToast: (kind: "info" | "error", text: string) => void;
  openEditModal: (task: Task) => void;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setRaidFilterTaskId: React.Dispatch<React.SetStateAction<number | null>>;
  setActiveTab: React.Dispatch<React.SetStateAction<TopTab>>;
  setWorkspaceCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  deselectIdRef: React.MutableRefObject<(id: number) => void>;
  handleCancelEdit: () => void;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
}

export function useTaskRowHandlers(args: UseTaskRowHandlersArgs) {
  const {
    tasksRef,
    settings,
    lang,
    today,
    editingId,
    showToast,
    openEditModal,
    setTasks,
    setRaidFilterTaskId,
    setActiveTab,
    setWorkspaceCollapsed,
    deselectIdRef,
    handleCancelEdit,
    logActivity,
  } = args;

  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());
  const [pushingIds, setPushingIds] = useState<Set<number>>(new Set());

  // Stable ref wrappers for potentially-recreated callbacks — mirrors the
  // pattern used in use-bulk-operations.ts and use-resource-planner.ts.
  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);
  const logActivityRef = useRef(logActivity);
  useEffect(() => {
    logActivityRef.current = logActivity;
  }, [logActivity]);
  const handleCancelEditRef = useRef(handleCancelEdit);
  useEffect(() => {
    handleCancelEditRef.current = handleCancelEdit;
  }, [handleCancelEdit]);

  const onToggleNoteExpanded = useCallback((id: number) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onJumpToRaid = useCallback(
    (id: number) => {
      setRaidFilterTaskId(id);
      setActiveTab("raid");
      setWorkspaceCollapsed((prev) => (prev ? false : prev));
    },
    [setRaidFilterTaskId, setActiveTab, setWorkspaceCollapsed],
  );

  const onToggleComplete = useCallback(
    (task: Task) => {
      if (task.completedDate && task.jiraKey) {
        window.alert(t(lang, "jiraReopenForbidden", task.jiraKey));
        return;
      }
      const wasComplete = !!task.completedDate;
      const stamp = new Date().toISOString();
      setTasks((prev) =>
        prev.map((row) => {
          if (row.id !== task.id) return row;
          if (row.completedDate) {
            return { ...row, completedDate: undefined, localModifiedAt: stamp };
          }
          return { ...row, completedDate: today, localModifiedAt: stamp };
        }),
      );
      if (editingId === task.id) handleCancelEditRef.current();
      logActivityRef.current(
        wasComplete ? "task.reopened" : "task.completed",
        task.id,
        task.taskName,
      );
    },
    [lang, today, editingId, setTasks],
  );

  const onSendInquiry = useCallback(
    (task: Task) => {
      let email = task.assigneeEmail?.trim();
      if (!email && isValidEmail(task.assignee)) {
        email = task.assignee.trim();
      }
      if (!email) {
        const provided = window.prompt(
          t(lang, "promptEmail", task.assignee),
          "",
        );
        if (provided === null) return;
        const trimmed = provided.trim();
        if (!isValidEmail(trimmed)) {
          window.alert(t(lang, "errorInvalidEmail"));
          return;
        }
        email = trimmed;
        setTasks((prev) =>
          prev.map((row) =>
            row.id === task.id ? { ...row, assigneeEmail: trimmed } : row,
          ),
        );
      }
      const greeting = greetingName(task.assignee) || task.assignee;
      const subject = t(lang, "emailSubject", task.id, task.taskName);
      const body = t(
        lang,
        "emailBodyTemplate",
        greeting,
        task.id,
        task.taskName,
        task.dueDate,
        task.lastUpdateDate,
      );
      const url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = url;
      setTasks((prev) =>
        prev.map((row) =>
          row.id === task.id
            ? { ...row, inquiriesSent: (row.inquiriesSent ?? 0) + 1 }
            : row,
        ),
      );
    },
    [lang, setTasks],
  );

  const onPushToJira = useCallback(
    async (taskId: number): Promise<boolean> => {
      const jiraCfg = settings.jira;
      if (!jiraCfg.enabled || !jiraCfg.projectKey) {
        showToastRef.current("error", t(lang, "jiraPushPrereq"));
        return false;
      }
      const task = tasksRef.current.find((row) => row.id === taskId);
      if (!task) return false;
      if (task.jiraKey) return false;
      if (pushingIds.has(taskId)) return false;

      setPushingIds((prev) => {
        const next = new Set(prev);
        next.add(taskId);
        return next;
      });

      const { createIssue, taskFieldsToJiraFields, formatJiraError } =
        await loadJiraApi();
      const issueType = jiraCfg.issueTypes[0] ?? "Task";
      try {
        const created = await createIssue(
          {
            siteUrl: jiraCfg.siteUrl,
            email: jiraCfg.email,
            apiToken: jiraCfg.apiToken,
          },
          jiraCfg.projectKey,
          issueType,
          taskFieldsToJiraFields(task),
        );
        if (!created?.key) {
          showToastRef.current(
            "error",
            t(lang, "jiraPushFailed", `#${taskId}`, "no key"),
          );
          return false;
        }
        const syncStamp = new Date().toISOString();
        const next = tasksRef.current.map((row) =>
          row.id === taskId
            ? {
                ...row,
                jiraKey: created.key,
                jiraIssueType: issueType,
                lastSyncedAt: syncStamp,
                localModifiedAt: undefined,
              }
            : row,
        );
        tasksRef.current = next;
        setTasks(next);
        showToastRef.current(
          "info",
          t(lang, "jiraPushedToast", created.key, issueType),
        );
        return true;
      } catch (err) {
        showToastRef.current(
          "error",
          t(lang, "jiraPushFailed", `#${taskId}`, formatJiraError(err)),
        );
        return false;
      } finally {
        setPushingIds((prev) => {
          if (!prev.has(taskId)) return prev;
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      }
    },
    [settings.jira, lang, tasksRef, pushingIds, setTasks],
  );

  const onEdit = useCallback(
    (task: Task) => {
      openEditModal(task);
    },
    [openEditModal],
  );

  const onDelete = useCallback(
    (id: number) => {
      if (!window.confirm(t(lang, "confirmDelete", id))) return;
      const deletedName =
        tasksRef.current.find((tk) => tk.id === id)?.taskName ?? "";
      setTasks((prev) =>
        prev
          .filter((tk) => tk.id !== id)
          .map((tk) =>
            tk.dependencies?.some((d) => d.taskId === id)
              ? {
                  ...tk,
                  dependencies: tk.dependencies!.filter(
                    (d) => d.taskId !== id,
                  ),
                }
              : tk,
          ),
      );
      deselectIdRef.current(id);
      if (editingId === id) handleCancelEditRef.current();
      logActivityRef.current("task.deleted", id, deletedName);
    },
    [lang, tasksRef, setTasks, deselectIdRef, editingId],
  );

  const handleClearRaidTaskFilter = useCallback(() => {
    setRaidFilterTaskId(null);
  }, [setRaidFilterTaskId]);

  const handleJumpToTaskFromRaid = useCallback(
    (taskId: number) => {
      const task = tasksRef.current.find((tk) => tk.id === taskId);
      if (task) openEditModal(task);
    },
    [tasksRef, openEditModal],
  );

  return {
    expandedNotes,
    setExpandedNotes,
    pushingIds,
    setPushingIds,
    onToggleNoteExpanded,
    onJumpToRaid,
    onToggleComplete,
    onSendInquiry,
    onPushToJira,
    onEdit,
    onDelete,
    handleClearRaidTaskFilter,
    handleJumpToTaskFromRaid,
  };
}
```

- [ ] **Step 3: Run the new tests to confirm GREEN**

```
npx vitest run src/app/use-task-row-handlers.test.ts
```

Expected: 6 passing

- [ ] **Step 4: Run full suite to confirm no regressions**

```
npx vitest run
```

Expected: all existing tests still pass (the two new hook files don't touch task-manager yet)

- [ ] **Step 5: Commit**

```
git add src/app/use-task-row-handlers.ts src/app/task-manager.tsx
git commit -m "feat(use-task-row-handlers): extract 9 row callbacks + expandedNotes/pushingIds state; export TopTab"
```

---

## Task 5: Refactor task-manager.tsx to consume both hooks

**Files:**
- Modify: `src/app/task-manager.tsx`

**Context:** Eight discrete edit blocks. Apply them in order. The ordering in the refactored file will be: `tasksRef` + `openEditModal` declared immediately before `useTaskRowHandlers` (between `useResourcePlanner` and `useBulkOperations`). `handleCancelEdit` is a function declaration (hoisted), so it is safe to pass to `useTaskRowHandlers` even though `useTaskRowHandlers` appears before `handleCancelEdit` in the file. `settingsRef`/`todayRef` became dead code in Slice 11 and are removed here.

- [ ] **Step 1: Add imports**

After the line `import { useWorkspaceCollapsed } from "./use-workspace-collapsed";` add:

```typescript
import { useHolidaySet } from "./use-holiday-set";
import { useTaskRowHandlers } from "./use-task-row-handlers";
```

- [ ] **Step 2: Remove pushingIds and expandedNotes state declarations**

Find and delete these lines (around line 319):

```typescript
  const [pushingIds, setPushingIds] = useState<Set<number>>(new Set());
  // Tracks which rows have their Notes cell expanded. Default is collapsed
  // (i.e. id not in the set) — collapsed notes are capped at NOTES_COLLAPSED_MAX
  // characters with an ellipsis and a "Show more" toggle.
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());
```

- [ ] **Step 3: Remove the 7 inline useCallback blocks and their header comment**

Delete the entire block that starts with:

```
  // Row-related handlers converted to useCallback for TaskRow consumption.
  // Placed here, after lang/today are defined, before first usage.

  const onToggleNoteExpanded = useCallback((id: number) => {
```

and ends with the closing `}, [lang, editingId, logActivity]);` of `onDelete`. This is approximately lines 337–538.

- [ ] **Step 4: Replace holidaySet state + effect with useHolidaySet**

Find and replace this block (around lines 547–564):

```typescript
  // `holidaysForCountries` is now async because `date-holidays` (and its
  // transitive moment + moment-timezone, ~100 KB+ gzipped) is dynamically
  // imported only when the user has at least one country selected. We
  // mirror the result into local state; consumers continue to read a
  // plain `Set<string>` and just see an empty set briefly on first paint
  // (or until a non-empty selection is loaded).
  const [holidaySet, setHolidaySet] = useState<Set<string>>(
    () => new Set<string>(),
  );
  useEffect(() => {
    let cancelled = false;
    void holidaysForCountries(settings.holidayCountries).then((set) => {
      if (!cancelled) setHolidaySet(set);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.holidayCountries]);
```

with:

```typescript
  const { holidaySet } = useHolidaySet({
    holidayCountries: settings.holidayCountries,
  });
```

- [ ] **Step 5: Remove handleEdit duplicate, handleClearRaidTaskFilter, handleJumpToTaskFromRaid**

Find and delete this entire block (around lines 713–751):

```typescript
  const handleEdit = useCallback((task: Task) => {
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
  }, []);

  // Stable refs for the props passed to memoized <RaidPanel>. Without these
  // every parent re-render (search keystroke, column drag, etc.) would
  // produce a new function identity and bust the memo.
  const handleClearRaidTaskFilter = useCallback(() => {
    setRaidFilterTaskId(null);
  }, []);

  const handleJumpToTaskFromRaid = useCallback(
    (taskId: number) => {
      const task = tasksRef.current.find((tk) => tk.id === taskId);
      if (task) handleEdit(task);
    },
    [handleEdit],
  );
```

- [ ] **Step 6: After useResourcePlanner, insert tasksRef + openEditModal + useTaskRowHandlers**

Find the closing `});` of the `useResourcePlanner` call. Immediately after it (before the `const { selectedIds, ...` line that starts `useBulkOperations`) insert:

```typescript
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const openEditModal = useCallback((task: Task) => {
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
  }, []);

  const {
    expandedNotes,
    setExpandedNotes,
    pushingIds,
    setPushingIds,
    onToggleNoteExpanded,
    onJumpToRaid,
    onToggleComplete,
    onSendInquiry,
    onPushToJira,
    onEdit,
    onDelete,
    handleClearRaidTaskFilter,
    handleJumpToTaskFromRaid,
  } = useTaskRowHandlers({
    tasksRef,
    settings,
    lang,
    today,
    editingId,
    showToast,
    openEditModal,
    setTasks,
    setRaidFilterTaskId,
    setActiveTab,
    setWorkspaceCollapsed,
    deselectIdRef,
    handleCancelEdit,
    logActivity,
  });
```

- [ ] **Step 7: Update useBulkOperations handlers**

Find the line inside the `useBulkOperations` call:

```typescript
    handlers: { onEdit: handleEdit, onDelete, onSendInquiry },
```

Change it to:

```typescript
    handlers: { onEdit, onDelete, onSendInquiry },
```

- [ ] **Step 8: Remove tasksRef original location + dead settingsRef/todayRef**

Find and delete this entire block (around lines 855–868):

```typescript
  // Refs used by task-manager handlers (voice commands, sync helpers, etc.).
  // The chat dispatcher has its own internal refs inside useChatDispatcher.
  const tasksRef = useRef(tasks);
  const settingsRef = useRef(settings);
  const todayRef = useRef(today);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    todayRef.current = today;
  }, [today]);
```

- [ ] **Step 9: Run the full test suite**

```
npx vitest run
```

Expected: all tests pass. Then verify TypeScript:

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 10: Commit**

```
git add src/app/task-manager.tsx
git commit -m "refactor(task-manager): consume useHolidaySet + useTaskRowHandlers; remove handleEdit duplicate; remove dead refs (~120 lines)"
```

---

## Task 6: Version bump v0.8.0 "Hemingway"

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Update version.ts**

In `src/app/version.ts`, prepend a new comment block before the existing comments and update the two exported constants:

Add at the very top of the comment block:

```typescript
// 0.8.0 extracts useHolidaySet (~25 LoC) and useTaskRowHandlers (~150 LoC)
// from task-manager.tsx. Slice 12 of the decomposition: useHolidaySet wraps
// the async holidaysForCountries utility with a cancellation guard.
// useTaskRowHandlers owns expandedNotes + pushingIds state and the 9 row
// callbacks (onToggleNoteExpanded, onJumpToRaid, onToggleComplete,
// onSendInquiry, onPushToJira, onEdit, onDelete, handleClearRaidTaskFilter,
// handleJumpToTaskFromRaid). handleEdit duplicate eliminated; openEditModal
// introduced as a stable useCallback in task-manager. TopTab exported.
// Dead settingsRef/todayRef removed. 9 new unit tests.
// task-manager.tsx ~−120 lines; now ~1,870 lines.
```

Change the constants:

```typescript
export const APP_VERSION = "0.8.0";
export const APP_BUILD_DATE = "2026-05-21";
```

- [ ] **Step 2: Update CHANGELOG.md**

Add a new section at the top (after the `# Changelog` heading or equivalent):

```markdown
## [0.8.0] — 2026-05-21 "Hemingway"

### Refactor
- Extract `useHolidaySet`: async holiday load with cancellation flag
- Extract `useTaskRowHandlers`: 9 row callbacks + `expandedNotes`/`pushingIds` state
- Eliminate `handleEdit` duplicate; `useBulkOperations` consumes `onEdit` from hook
- Remove dead `settingsRef`/`todayRef` (leftover from Slice 11)
- Export `TopTab` from `task-manager.tsx` for hook type sharing
- `task-manager.tsx` −120 lines (now ~1,870); 9 new unit tests
```

- [ ] **Step 3: Update README.md badge**

Find the version badge (contains `v0.7.9`) and change it to `v0.8.0`.

- [ ] **Step 4: Run full suite one final time**

```
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```
git add src/app/version.ts CHANGELOG.md README.md
git commit -m "release(v0.8.0): Hemingway — useHolidaySet + useTaskRowHandlers extraction"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|-----------------|------|
| `useHolidaySet` wraps `holidaysForCountries` with cancellation flag | 2 |
| `useHolidaySet` takes `holidayCountries: string[]` (not Settings) | 2 |
| 3 tests for useHolidaySet (initial, resolves, cancellation) | 1 |
| `useTaskRowHandlers` owns `expandedNotes` + `pushingIds` | 4 |
| All 9 row callbacks extracted | 4 |
| `openEditModal: (task: Task) => void` decoupled approach | 4, 5 |
| `tasksRef` stays inline in task-manager, passed as arg | 5 step 6 |
| `handleEdit` duplicate eliminated | 5 step 5 |
| `handleClearRaidTaskFilter`/`handleJumpToTaskFromRaid` in hook | 4 |
| 6 tests for useTaskRowHandlers | 3 |
| `TopTab` exported from task-manager | 4 step 1 |
| Dead `settingsRef`/`todayRef` removed | 5 step 8 |
| Version v0.8.0 "Hemingway" | 6 |

**Type consistency:**

- `UseTaskRowHandlersArgs.tasksRef: React.MutableRefObject<Task[]>` — matches `useRef(tasks)` in task-manager
- `UseTaskRowHandlersArgs.logActivity: (kind: ActivityKind, ...) => void` — matches `useActivityLog` return
- `UseTaskRowHandlersArgs.setActiveTab: Dispatch<SetStateAction<TopTab>>` — matches `useState<TopTab>` in task-manager
- `openEditModal: (task: Task) => void` — matches `useCallback((task: Task) => {...}, [])` in task-manager
- Test `makeArgs()` mirrors `UseTaskRowHandlersArgs` exactly — no phantom fields
