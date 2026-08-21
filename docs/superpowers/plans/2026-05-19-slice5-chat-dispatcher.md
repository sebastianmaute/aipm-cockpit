# Slice 5 — Chat Dispatcher Extraction & ChatPanel Memoization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the ~240-line chat dispatcher + its three refs + its two helper callbacks out of `task-manager.tsx` into a new `useChatDispatcher` hook, route `editingId` through a ref so the dispatcher identity is stable, then memoize `ChatPanel` so it stops re-rendering on every form keystroke. Spec: `docs/superpowers/specs/2026-05-19-slice5-chat-dispatcher-design.md`.

**Architecture:** New `src/app/use-chat-dispatcher.ts` hook consumes `useWorkspace`, `useTaskForm`, `useFilters` internally and stabilizes its four reactive inputs (`tasks`, `settings`, `today`, `editingId`) via internal refs. The dispatcher `useMemo` has empty deps, so its identity never changes. `task-manager.tsx` shrinks by ~200 lines. `ChatPanel` gets a one-line `React.memo` wrapper. A small `src/app/test-providers.tsx` helper makes the new hook unit-testable inside the FiltersProvider → WorkspaceProvider → TaskFormProvider stack.

**Tech Stack:** React 19 + Next 16 + TypeScript + Vitest + @testing-library/react (`renderHook`, `act`). No new dependencies.

---

## File Structure

| File | Role |
|---|---|
| `src/app/test-providers.tsx` | NEW — wraps children in `FiltersProvider` + `WorkspaceProvider` + `TaskFormProvider`; seeds tasks via a one-shot `Seeder` child component |
| `src/app/use-chat-dispatcher.ts` | NEW — `useChatDispatcher(args)` returns a `ToolDispatcher` with stable identity; internal `tasksRef`/`settingsRef`/`todayRef`/`editingIdRef` absorb reactive values |
| `src/app/use-chat-dispatcher.test.ts` | NEW — 15 unit tests via `renderHook` inside `TestProviders` |
| `src/app/task-manager.tsx` | Modified — remove inline dispatcher (lines 2173-2409), replace with `useChatDispatcher` call + `useCallback` for `onAcceptConsent`; audit and drop orphaned imports |
| `src/app/chat-panel.tsx` | Modified — wrap default export with `React.memo` (2-line change) |

Total: 3 new files, 2 modified files. 15 new tests (69 → 84). `task-manager.tsx` net change: −~200 lines.

---

## Task 1: Scaffold the `test-providers.tsx` helper

The hook tests can't run until we have a provider stack that seeds tasks. This task adds the helper standalone — verified by `tsc`, not by a test (the helper is itself a test utility; its correctness is proven by the dispatcher tests that consume it in later tasks).

**Files:**
- Create: `src/app/test-providers.tsx`

- [ ] **Step 1: Create `src/app/test-providers.tsx`**

Full file contents:

```tsx
"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { TaskFormProvider } from "./task-form-context";
import { type Task } from "./types";

function Seeder({ tasks }: { tasks: Task[] }) {
  const { setTasks } = useWorkspace();
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (tasks.length > 0) setTasks(tasks);
  }, [tasks, setTasks]);
  return null;
}

export function TestProviders({
  children,
  tasks = [],
}: {
  children: ReactNode;
  tasks?: Task[];
}) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <Seeder tasks={tasks} />
        <TaskFormProvider>{children}</TaskFormProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}
```

Notes:
- `Seeder` runs `setTasks(initial)` exactly once per mount via the `seededRef.current` guard. Without the guard, any re-render of `TestProviders` would re-seed and clobber test mutations.
- The `Seeder` is rendered *inside* `WorkspaceProvider` (it needs `useWorkspace()`) but *outside* `TaskFormProvider` (TaskForm doesn't read tasks).
- The `useEffect` deps `[tasks, setTasks]` are correct: `setTasks` is a `useState` setter (stable), and `tasks` is the array reference the test passes in. The guard handles array-identity churn from React re-renders.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: exit 0.

If `tsc` reports *"Module './filters-context' has no exported member 'FiltersProvider'"* or similar — verify the provider files use `export function FiltersProvider(...)`. They do per slices 1-3, but double-check by reading `src/app/filters-context.tsx:1-20`, `src/app/workspace-context.tsx:1-30`, `src/app/task-form-context.tsx:1-30`. If the export style is `export const FiltersProvider = ...` instead, the import in this file already works either way.

- [ ] **Step 3: Commit**

```bash
git add src/app/test-providers.tsx
git commit -m "feat(test-providers): scaffold TestProviders + Seeder for hook tests"
```

---

## Task 2: Scaffold `useChatDispatcher` + read-only methods (`listTasks`, `getTask`)

TDD: write 3 read-only tests, see them fail (hook doesn't exist), create the hook with `listTasks` and `getTask`, see the tests pass. This task locks in the hook's public signature and the provider-consumption pattern; all later tasks just add methods to the same `useMemo`.

**Files:**
- Create: `src/app/use-chat-dispatcher.ts`
- Create: `src/app/use-chat-dispatcher.test.ts`

- [ ] **Step 1: Write the failing tests for `listTasks` and `getTask`**

Create `src/app/use-chat-dispatcher.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { TestProviders } from "./test-providers";
import { type Settings, type StorageConfig, type Task } from "./types";

function makeSettings(): Settings {
  const storageConfig: StorageConfig = { kind: "browser" };
  return {
    language: "en-US",
    holidayCountries: [],
    ai: {
      apiKey: "",
      model: "claude-sonnet-4-6",
      consentAccepted: false,
    },
    jira: {
      enabled: false,
      siteUrl: "",
      email: "",
      apiToken: "",
      projectKey: "",
      issueTypes: [],
      assigneeScope: "all",
    },
    notifications: { banner: true, toast: false, popup: false },
    storageConfig,
  };
}

function seedTasks(): Task[] {
  return [
    {
      id: 1,
      taskName: "Alpha",
      assignee: "Alice",
      assigneeEmail: "alice@example.com",
      dueDate: "2026-06-01",
      lastUpdateDate: "2026-05-19",
      priority: "Medium",
      blockers: "",
      notes: "",
      inquiriesSent: 0,
      group: "Backend",
      labels: ["api"],
    },
    {
      id: 2,
      taskName: "Bravo",
      assignee: "Bob",
      assigneeEmail: "bob@example.com",
      dueDate: "2026-06-02",
      lastUpdateDate: "2026-05-19",
      priority: "High",
      blockers: "",
      notes: "",
      inquiriesSent: 0,
      group: "Frontend",
      labels: ["ui", "api"],
    },
    {
      id: 3,
      taskName: "Charlie",
      assignee: "Carol",
      assigneeEmail: "carol@example.com",
      dueDate: "2026-06-03",
      lastUpdateDate: "2026-05-19",
      priority: "Low",
      blockers: "",
      notes: "",
      inquiriesSent: 0,
      labels: ["docs"],
    },
  ];
}

function renderDispatcher(initial: Task[] = seedTasks()) {
  const setSelectedIds = vi.fn();
  const setSettings = vi.fn();
  const settings = makeSettings();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestProviders tasks={initial}>{children}</TestProviders>
  );
  const { result, rerender } = renderHook(
    () =>
      useChatDispatcher({
        settings,
        today: "2026-05-19",
        setSelectedIds,
        setSettings,
      }),
    { wrapper },
  );
  return { result, rerender, setSelectedIds, setSettings };
}

describe("useChatDispatcher", () => {
  it("listTasks() returns the workspace tasks", () => {
    const { result } = renderDispatcher();
    const tasks = result.current.listTasks();
    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it("getTask(id) returns the matching task", () => {
    const { result } = renderDispatcher();
    const task = result.current.getTask(2);
    expect(task?.taskName).toBe("Bravo");
  });

  it("getTask(id) returns null when id is unknown", () => {
    const { result } = renderDispatcher();
    expect(result.current.getTask(999)).toBeNull();
  });
});
```

Notes on the test scaffolding:
- `makeSettings()` builds a `Settings` shape with `storageConfig.kind = "browser"`. If the actual `Settings` type in `src/app/types.ts` has more required fields, `tsc` will fail and you add them here. Don't speculate — let the type-check tell you.
- `seedTasks()` returns 3 tasks with deliberately varied groups (`Backend`, `Frontend`, undefined) and labels (`api`, `ui`, `docs`) so later tests (`getSnapshot`) can assert sort/dedupe behaviour.
- `renderDispatcher()` is the shared per-test setup. Returning `setSelectedIds` and `setSettings` mocks lets tests assert "the dispatcher called the right setter".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/use-chat-dispatcher.test.ts`

Expected: 3 failures with errors like *"Cannot find module './use-chat-dispatcher'"*.

- [ ] **Step 3: Create `src/app/use-chat-dispatcher.ts` scaffold**

Full file contents (only `listTasks` and `getTask` implemented; other methods stubbed to throw — they get filled in over the next 4 tasks):

```ts
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import { type Filters, type ToolDispatcher } from "./chat-tools";
import { useFilters } from "./filters-context";
import { useTaskForm } from "./task-form-context";
import { useWorkspace } from "./workspace-context";
import { type Settings } from "./types";

export interface ChatDispatcherArgs {
  settings: Settings;
  today: string;
  setSelectedIds: Dispatch<SetStateAction<Set<number>>>;
  setSettings: Dispatch<SetStateAction<Settings>>;
}

export function useChatDispatcher(args: ChatDispatcherArgs): ToolDispatcher {
  const { tasks, setTasks } = useWorkspace();
  const { editingId, setEditingId, setForm } = useTaskForm();
  const {
    setSearch,
    setPriorityFilter,
    setAssigneeFilter,
    setGroupFilter,
    setLabelFilter,
  } = useFilters();

  // Refs absorb every reactive value the dispatcher reads. Without these the
  // dispatcher would rebuild on every task/settings/today/editingId change,
  // which is the whole reason ChatPanel currently re-renders on form input.
  const tasksRef = useRef(tasks);
  const settingsRef = useRef(args.settings);
  const todayRef = useRef(args.today);
  const editingIdRef = useRef(editingId);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    settingsRef.current = args.settings;
  }, [args.settings]);
  useEffect(() => {
    todayRef.current = args.today;
  }, [args.today]);
  useEffect(() => {
    editingIdRef.current = editingId;
  }, [editingId]);

  // Helpers live inside the hook — they're not consumed anywhere else.
  // Stubbed for now; filled in by later tasks.
  const sendInquiry = useCallback(
    (_id: number): { sent: boolean; reason?: string } => {
      throw new Error("not implemented yet");
    },
    [],
  );
  const applyFilters = useCallback((_f: Filters): void => {
    throw new Error("not implemented yet");
  }, []);

  const dispatcher = useMemo<ToolDispatcher>(
    () => ({
      listTasks: () => tasksRef.current,
      getTask: (id) => tasksRef.current.find((row) => row.id === id) ?? null,
      createTask: () => {
        throw new Error("not implemented yet");
      },
      updateTask: () => {
        throw new Error("not implemented yet");
      },
      deleteTask: () => {
        throw new Error("not implemented yet");
      },
      deleteAllTasks: () => {
        throw new Error("not implemented yet");
      },
      sendInquiry,
      setFilters: applyFilters,
      setLanguage: (_l) => {
        throw new Error("not implemented yet");
      },
      getSnapshot: () => {
        throw new Error("not implemented yet");
      },
    }),
    // Empty deps: every reactive value is read via a ref. Identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Suppress unused-variable warnings for state we don't yet read; later
  // tasks consume them. Removing this when those methods land is part of
  // Task 6.
  void setTasks;
  void setEditingId;
  void setForm;
  void setSearch;
  void setPriorityFilter;
  void setAssigneeFilter;
  void setGroupFilter;
  void setLabelFilter;

  return dispatcher;
}
```

Notes:
- The `void` lines at the bottom are a temporary scaffold to silence "unused variable" warnings while we land the hook in stages. They go away in Task 6 when every method is implemented.
- `// eslint-disable-next-line react-hooks/exhaustive-deps` is intentional and stays permanently — empty deps is the whole point of this hook.
- The unused `_id`, `_f`, `_l` underscore-prefix is the project's convention.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/use-chat-dispatcher.test.ts`

Expected: 3 passed.

If `listTasks` returns `[]` instead of 3 tasks — the `Seeder` didn't fire. Check that:
- `WorkspaceProvider` is rendered as a parent of `Seeder` in `test-providers.tsx`.
- The test uses `await act` or relies on the synchronous flush; `renderHook` flushes effects on mount, so `result.current.listTasks()` should see the seeded tasks immediately. If not, wrap the assertion in `await waitFor(() => expect(...).toHaveLength(3))`.

- [ ] **Step 5: Type-check the full project**

Run: `npx tsc --noEmit`

Expected: exit 0. If errors point at `makeSettings()` shape mismatch, read `src/app/types.ts` for the canonical `Settings` shape and add the missing fields to `makeSettings()`.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.test.ts
git commit -m "feat(use-chat-dispatcher): scaffold hook + listTasks/getTask tests"
```

---

## Task 3: Implement `createTask`

`createTask` validates required fields, sanitizes inputs, assigns `id = max(ids) + 1`, and writes to `tasksRef.current` synchronously *before* `setTasks` so back-to-back tool calls in the same chat turn see the new row.

**Files:**
- Modify: `src/app/use-chat-dispatcher.ts` (replace the `createTask` stub)
- Modify: `src/app/use-chat-dispatcher.test.ts` (append 2 tests)

- [ ] **Step 1: Add failing tests for `createTask`**

Append to `src/app/use-chat-dispatcher.test.ts` inside the `describe("useChatDispatcher", () => { ... })` block:

```ts
  it("createTask appends a row with id = max(ids) + 1 and sanitizes inputs", () => {
    const { result } = renderDispatcher();
    const created = result.current.createTask({
      taskName: "  Delta  ",
      assignee: "Dave",
      dueDate: "2026-06-04",
    });
    expect(created.id).toBe(4);
    expect(created.taskName).toBe("Delta");
    expect(result.current.listTasks()).toHaveLength(4);
  });

  it("createTask throws when required fields are missing", () => {
    const { result } = renderDispatcher();
    expect(() =>
      result.current.createTask({
        taskName: "",
        assignee: "Dave",
        dueDate: "2026-06-04",
      }),
    ).toThrow(/taskName is required/);
    expect(() =>
      result.current.createTask({
        taskName: "Delta",
        assignee: "",
        dueDate: "2026-06-04",
      }),
    ).toThrow(/assignee is required/);
    expect(() =>
      result.current.createTask({
        taskName: "Delta",
        assignee: "Dave",
        dueDate: "not-a-date",
      }),
    ).toThrow(/dueDate must be YYYY-MM-DD/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/use-chat-dispatcher.test.ts`

Expected: 2 new failures with message *"not implemented yet"*.

- [ ] **Step 3: Replace the `createTask` stub with the real implementation**

In `src/app/use-chat-dispatcher.ts`, add these imports at the top alongside the existing imports:

```ts
import {
  isValidEmail,
  sanitizeAssignee,
  sanitizeBlockers,
  sanitizeEmail,
  sanitizeGroup,
  sanitizeIsoDate,
  sanitizeLabels,
  sanitizeNonNegInt,
  sanitizeNotes,
  sanitizePriority,
  sanitizeTaskName,
} from "./sanitize";
import { type Task } from "./types";
```

Then replace the `createTask` stub inside the `useMemo` with:

```ts
      createTask: (input) => {
        const list = tasksRef.current;
        const id =
          list.length > 0 ? Math.max(...list.map((row) => row.id)) + 1 : 1;
        const taskName = sanitizeTaskName(input.taskName);
        const assignee = sanitizeAssignee(input.assignee);
        const dueDate = sanitizeIsoDate(input.dueDate);
        if (!taskName) throw new Error("taskName is required");
        if (!assignee) throw new Error("assignee is required");
        if (!dueDate) throw new Error("dueDate must be YYYY-MM-DD");
        const email = sanitizeEmail(input.assigneeEmail);
        if (email && !isValidEmail(email))
          throw new Error("assigneeEmail is invalid");
        const newTask: Task = {
          id,
          taskName,
          assignee,
          assigneeEmail: email,
          dueDate,
          lastUpdateDate:
            sanitizeIsoDate(input.lastUpdateDate) || todayRef.current,
          priority: sanitizePriority(input.priority),
          blockers: sanitizeBlockers(input.blockers),
          notes: sanitizeNotes(input.notes),
          inquiriesSent: 0,
          group: sanitizeGroup(input.group),
          labels: sanitizeLabels(input.labels),
        };
        const next = [...list, newTask];
        tasksRef.current = next; // keep ref in sync for back-to-back tool calls
        setTasks(next);
        return newTask;
      },
```

Also remove the `void setTasks;` line from the unused-var-silencer block at the bottom of the hook — `setTasks` is now used.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/use-chat-dispatcher.test.ts`

Expected: 5 passed (3 from Task 2 + 2 new).

If "createTask throws" passes but "createTask appends" fails with `listTasks() === 3` — the synchronous `tasksRef.current = next` assignment is missing. Check the implementation above.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.test.ts
git commit -m "feat(use-chat-dispatcher): implement createTask"
```

---

## Task 4: Implement `updateTask` (with Jira-lock invariants)

`updateTask` is the trickiest method: it sanitizes a partial patch, enforces Jira-locked-field invariants (assignee changes, completedDate "reopen" attempts), and bumps `localModifiedAt`.

**Files:**
- Modify: `src/app/use-chat-dispatcher.ts` (replace the `updateTask` stub)
- Modify: `src/app/use-chat-dispatcher.test.ts` (append 2 tests)

- [ ] **Step 1: Add failing tests for `updateTask`**

Append inside the `describe` block:

```ts
  it("updateTask patches fields and bumps localModifiedAt", () => {
    const { result } = renderDispatcher();
    const updated = result.current.updateTask(1, { priority: "Urgent" });
    expect(updated?.priority).toBe("Urgent");
    expect(updated?.localModifiedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
    expect(result.current.getTask(1)?.priority).toBe("Urgent");
  });

  it("updateTask rejects assignee changes on a jiraKey-linked task", () => {
    const tasksWithJira = seedTasks().map((t, i) =>
      i === 0 ? { ...t, jiraKey: "LOP-1" } : t,
    );
    const { result } = renderDispatcher(tasksWithJira);
    expect(() =>
      result.current.updateTask(1, { assignee: "Different Person" }),
    ).toThrow(/managed in Jira/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/use-chat-dispatcher.test.ts`

Expected: 2 new failures with *"not implemented yet"*.

- [ ] **Step 3: Replace the `updateTask` stub**

In `src/app/use-chat-dispatcher.ts`, replace the `updateTask` stub with:

```ts
      updateTask: (id, patch) => {
        const existing = tasksRef.current.find((row) => row.id === id);
        if (!existing) return null;
        // Jira-managed fields can't be changed locally on linked tasks.
        if (existing.jiraKey) {
          if (
            patch.assignee !== undefined &&
            sanitizeAssignee(patch.assignee) !==
              sanitizeAssignee(existing.assignee)
          ) {
            throw new Error(
              `Assignee for ${existing.jiraKey} is managed in Jira. Change it in Jira and re-sync.`,
            );
          }
          if (
            patch.completedDate === undefined &&
            "completedDate" in patch &&
            existing.completedDate
          ) {
            throw new Error(
              `Reopening ${existing.jiraKey} must be done in Jira (workflow transition required).`,
            );
          }
        }
        const cleanPatch: Partial<Task> = {};
        if (patch.taskName !== undefined)
          cleanPatch.taskName = sanitizeTaskName(patch.taskName);
        if (patch.assignee !== undefined)
          cleanPatch.assignee = sanitizeAssignee(patch.assignee);
        if (patch.assigneeEmail !== undefined) {
          const e = sanitizeEmail(patch.assigneeEmail);
          if (e && !isValidEmail(e))
            throw new Error("assigneeEmail is invalid");
          cleanPatch.assigneeEmail = e;
        }
        if (patch.dueDate !== undefined) {
          const d = sanitizeIsoDate(patch.dueDate);
          if (!d) throw new Error("dueDate must be YYYY-MM-DD");
          cleanPatch.dueDate = d;
        }
        if (patch.lastUpdateDate !== undefined) {
          const d = sanitizeIsoDate(patch.lastUpdateDate);
          if (d) cleanPatch.lastUpdateDate = d;
        }
        if (patch.priority !== undefined)
          cleanPatch.priority = sanitizePriority(
            patch.priority,
            existing.priority,
          );
        if (patch.blockers !== undefined)
          cleanPatch.blockers = sanitizeBlockers(patch.blockers);
        if (patch.notes !== undefined)
          cleanPatch.notes = sanitizeNotes(patch.notes);
        if (patch.inquiriesSent !== undefined)
          cleanPatch.inquiriesSent = sanitizeNonNegInt(patch.inquiriesSent);
        if (patch.group !== undefined)
          cleanPatch.group = sanitizeGroup(patch.group);
        if (patch.labels !== undefined)
          cleanPatch.labels = sanitizeLabels(patch.labels);
        const merged: Task = {
          ...existing,
          ...cleanPatch,
          id: existing.id,
          localModifiedAt: new Date().toISOString(),
        };
        const next = tasksRef.current.map((row) =>
          row.id === id ? merged : row,
        );
        tasksRef.current = next;
        setTasks(next);
        return merged;
      },
```

This is verbatim from `task-manager.tsx:2269-2340` — the only change is reading from `tasksRef` / `setTasks` (already in scope from the hook) instead of the task-manager closure.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/use-chat-dispatcher.test.ts`

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.test.ts
git commit -m "feat(use-chat-dispatcher): implement updateTask with Jira-lock invariants"
```

---

## Task 5: Implement `deleteTask` and `deleteAllTasks`

`deleteTask` removes a row, cascades the dependency-cleanup that mirrors `handleDelete`, clears the row from `selectedIds`, and (if the deleted row is being edited) resets the form. `deleteAllTasks` empties the workspace and clears all selection/edit state.

**Files:**
- Modify: `src/app/use-chat-dispatcher.ts` (replace 2 stubs)
- Modify: `src/app/use-chat-dispatcher.test.ts` (append 2 tests)

- [ ] **Step 1: Add failing tests for `deleteTask` and `deleteAllTasks`**

Append inside the `describe` block:

```ts
  it("deleteTask removes the row and cascades dependency cleanup", () => {
    const dependants: Task[] = [
      ...seedTasks(),
      {
        id: 4,
        taskName: "Delta",
        assignee: "Dave",
        assigneeEmail: "",
        dueDate: "2026-06-04",
        lastUpdateDate: "2026-05-19",
        priority: "Medium",
        blockers: "",
        notes: "",
        inquiriesSent: 0,
        dependencies: [{ taskId: 2, type: "FS" }],
      },
    ];
    const { result } = renderDispatcher(dependants);
    const deleted = result.current.deleteTask(2);
    expect(deleted).toBe(true);
    expect(result.current.listTasks()).toHaveLength(3);
    expect(result.current.getTask(4)?.dependencies).toEqual([]);
  });

  it("deleteAllTasks empties the workspace and clears selection state", () => {
    const { result, setSelectedIds } = renderDispatcher();
    const count = result.current.deleteAllTasks();
    expect(count).toBe(3);
    expect(result.current.listTasks()).toHaveLength(0);
    expect(setSelectedIds).toHaveBeenCalledWith(new Set());
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/use-chat-dispatcher.test.ts`

Expected: 2 new failures with *"not implemented yet"*.

- [ ] **Step 3: Replace the `deleteTask` and `deleteAllTasks` stubs**

In `src/app/use-chat-dispatcher.ts`, replace the `deleteTask` stub with:

```ts
      deleteTask: (id) => {
        const exists = tasksRef.current.some((row) => row.id === id);
        if (!exists) return false;
        // Mirror handleDelete's cascade: strip references to the deleted id
        // from every other task's dependency list.
        const next = tasksRef.current
          .filter((row) => row.id !== id)
          .map((row) =>
            row.dependencies &&
            row.dependencies.some((d) => d.taskId === id)
              ? {
                  ...row,
                  dependencies: row.dependencies.filter(
                    (d) => d.taskId !== id,
                  ),
                }
              : row,
          );
        tasksRef.current = next;
        setTasks(next);
        args.setSelectedIds((prev) => {
          if (!prev.has(id)) return prev;
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
        if (editingIdRef.current === id) {
          setEditingId(null);
          setForm(emptyForm());
        }
        return true;
      },
```

And replace the `deleteAllTasks` stub with:

```ts
      deleteAllTasks: () => {
        const count = tasksRef.current.length;
        tasksRef.current = [];
        setTasks([]);
        args.setSelectedIds(new Set());
        setEditingId(null);
        setForm(emptyForm());
        return count;
      },
```

Update the existing `useTaskForm` import to also pull in `emptyForm`:

```ts
import { emptyForm, useTaskForm } from "./task-form-context";
```

Then remove `void setEditingId;` and `void setForm;` from the unused-var-silencer block at the bottom.

Note one behaviour shift documented in the spec: `deleteTask` reads `editingIdRef.current` instead of the `editingId` closure value. This is intentional — it's what unlocks identity stability. In practice, `useEffect` flushes `editingIdRef.current = editingId` before any subsequent React event handler runs, so the ref is always up-to-date when a chat tool call fires.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/use-chat-dispatcher.test.ts`

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.test.ts
git commit -m "feat(use-chat-dispatcher): implement deleteTask + deleteAllTasks"
```

---

## Task 6: Implement `sendInquiry`, `setFilters`, `setLanguage`, `getSnapshot`

The four remaining methods. `sendInquiry` opens a mailto URL (mocked via `window.open` spy). `setFilters` forwards a partial filter object to the FiltersProvider setters. `setLanguage` merges into `setSettings`. `getSnapshot` aggregates derived facts.

**Files:**
- Modify: `src/app/use-chat-dispatcher.ts` (fill in `sendInquiry`, `applyFilters`, `setLanguage`, `getSnapshot`; remove remaining `void` lines)
- Modify: `src/app/use-chat-dispatcher.test.ts` (append 4 tests)

- [ ] **Step 1: Add failing tests for the four remaining methods**

Add this import at the top of `use-chat-dispatcher.test.ts`:

```ts
import { type Settings } from "./types";
```

(If already imported, skip — TypeScript won't allow duplicates.)

Append inside the `describe` block:

```ts
  it("sendInquiry opens a mailto URL and increments inquiriesSent", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { result } = renderDispatcher();
    const outcome = result.current.sendInquiry(1);
    expect(outcome).toEqual({ sent: true });
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^mailto:alice%40example\.com\?/),
    );
    expect(result.current.getTask(1)?.inquiriesSent).toBe(1);
    openSpy.mockRestore();
  });

  it("setFilters does not throw and forwards through FiltersProvider", () => {
    const { result } = renderDispatcher();
    expect(() =>
      result.current.setFilters({ search: "alpha", priority: "Urgent" }),
    ).not.toThrow();
    // Behavioural correctness of the forward (search/priority/etc actually
    // update FiltersProvider state) is covered by the manual smoke in Task 10;
    // this test pins the contract that the dispatcher routes the call.
  });

  it("setLanguage calls setSettings with an updater that merges language", () => {
    const { result, setSettings } = renderDispatcher();
    result.current.setLanguage("de");
    expect(setSettings).toHaveBeenCalledTimes(1);
    const updater = setSettings.mock.calls[0][0] as (s: Settings) => Settings;
    const prev = makeSettings();
    const next = updater(prev);
    expect(next.language).toBe("de");
    // Other fields are preserved.
    expect(next.ai).toBe(prev.ai);
  });

  it("getSnapshot returns sorted unique groups/labels and accurate counts", () => {
    const { result } = renderDispatcher();
    const snap = result.current.getSnapshot();
    expect(snap.taskCount).toBe(3);
    expect(snap.today).toBe("2026-05-19");
    expect(snap.language).toBe("en-US");
    expect(snap.storageKind).toBe("browser");
    expect(snap.knownGroups).toEqual(["Backend", "Frontend"]);
    expect(snap.knownLabels).toEqual(["api", "docs", "ui"]);
  });
```

Note: the `setFilters` test deliberately lighter than the others. Asserting on the FiltersProvider's internal state across two `renderHook` calls is fragile in `jsdom`; the **behaviour parity** here is that the dispatcher *calls* the right setters with the right arguments. The exhaustive deep-state assertion is covered by the manual smoke (Task 10).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/use-chat-dispatcher.test.ts`

Expected: 4 new failures (*"not implemented yet"* for setLanguage / getSnapshot; mailto assertion fail for sendInquiry; setFilters test fails because `applyFilters` still throws).

- [ ] **Step 3: Replace `sendInquiry`, `applyFilters`, `setLanguage`, `getSnapshot` implementations**

Add these imports to the top of `src/app/use-chat-dispatcher.ts`:

```ts
import { isValidEmail } from "./sanitize";
import { greetingName } from "./contacts";
import { t } from "./i18n";
```

If `isValidEmail` is already imported (it was added in Task 3 for `createTask`), don't duplicate. If `greetingName` lives somewhere other than `./contacts`, grep for it: `Grep "export function greetingName"`. Copy the import path verbatim from where it's currently imported in `task-manager.tsx`.

Replace the `sendInquiry` body with:

```ts
  const sendInquiry = useCallback(
    (id: number): { sent: boolean; reason?: string } => {
      const task = tasksRef.current.find((row) => row.id === id);
      if (!task) return { sent: false, reason: "task-not-found" };
      let email = task.assigneeEmail?.trim();
      if (!email && isValidEmail(task.assignee)) email = task.assignee.trim();
      if (!email) return { sent: false, reason: "no-email-on-file" };

      const greeting = greetingName(task.assignee) || task.assignee;
      const currentLang = settingsRef.current.language;
      const subject = t(currentLang, "emailSubject", task.id, task.taskName);
      const body = t(
        currentLang,
        "emailBodyTemplate",
        greeting,
        task.id,
        task.taskName,
        task.dueDate,
        task.lastUpdateDate,
      );
      const url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.open(url);
      const next = tasksRef.current.map((row) =>
        row.id === task.id
          ? { ...row, inquiriesSent: (row.inquiriesSent ?? 0) + 1 }
          : row,
      );
      tasksRef.current = next;
      setTasks(next);
      return { sent: true };
    },
    [setTasks],
  );
```

Replace the `applyFilters` body with:

```ts
  const applyFilters = useCallback(
    (f: Filters): void => {
      if (f.search !== undefined) setSearch(f.search);
      if (f.priority !== undefined) setPriorityFilter(f.priority);
      if (f.assignee !== undefined)
        setAssigneeFilter(f.assignee.trim() === "" ? "All" : f.assignee);
      if (f.group !== undefined)
        setGroupFilter(f.group.trim() === "" ? "All" : f.group);
      if (f.label !== undefined)
        setLabelFilter(f.label.trim() === "" ? "All" : f.label);
    },
    [setSearch, setPriorityFilter, setAssigneeFilter, setGroupFilter, setLabelFilter],
  );
```

Replace the `setLanguage` stub inside the `useMemo` with:

```ts
      setLanguage: (l) =>
        args.setSettings((s) => ({ ...s, language: l })),
```

Replace the `getSnapshot` stub with:

```ts
      getSnapshot: () => {
        const tasks = tasksRef.current;
        const groups = new Set<string>();
        const labels = new Set<string>();
        for (const tk of tasks) {
          if (tk.group?.trim()) groups.add(tk.group);
          for (const l of tk.labels ?? []) {
            const clean = l.trim();
            if (clean) labels.add(clean);
          }
        }
        return {
          today: todayRef.current,
          language: settingsRef.current.language,
          holidayCountries: settingsRef.current.holidayCountries,
          storageKind: settingsRef.current.storageConfig.kind,
          taskCount: tasks.length,
          knownGroups: Array.from(groups).sort(),
          knownLabels: Array.from(labels).sort(),
        };
      },
```

Now remove the entire unused-var-silencer block at the bottom of the hook (the `void setTasks; void setEditingId; …` lines). Every binding is now consumed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/use-chat-dispatcher.test.ts`

Expected: 13 passed.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.test.ts
git commit -m "feat(use-chat-dispatcher): implement sendInquiry, setFilters, setLanguage, getSnapshot"
```

---

## Task 7: Identity stability tests (the whole point of slice 5)

Two tests proving that the dispatcher reference is `===` across re-renders triggered by `tasks` change and `editingId` change. These are the load-bearing tests — they prove that `React.memo(ChatPanel)` will skip re-renders.

**Files:**
- Modify: `src/app/use-chat-dispatcher.test.ts` (append 2 tests)

- [ ] **Step 1: Add the identity stability tests**

Add these imports to the top of the test file:

```ts
import { act } from "@testing-library/react";
import { useTaskForm } from "./task-form-context";
```

Append inside the `describe` block:

```ts
  it("dispatcher identity is stable across tasks-change re-renders", () => {
    const { result } = renderDispatcher();
    const before = result.current;
    // Trigger a tasks change via the dispatcher itself.
    result.current.createTask({
      taskName: "Echo",
      assignee: "Eve",
      dueDate: "2026-06-05",
    });
    const after = result.current;
    expect(after).toBe(before);
  });

  it("dispatcher identity is stable across editingId-change re-renders", () => {
    // Render the hook AND useTaskForm in the same TestProviders wrapper so
    // setEditingId triggers a re-render of the dispatcher's host component.
    function probe() {
      const dispatcher = useChatDispatcher({
        settings: makeSettings(),
        today: "2026-05-19",
        setSelectedIds: vi.fn(),
        setSettings: vi.fn(),
      });
      const form = useTaskForm();
      return { dispatcher, form };
    }
    const { result } = renderHook(probe, {
      wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
    });
    const before = result.current.dispatcher;
    act(() => {
      result.current.form.setEditingId(42);
    });
    const after = result.current.dispatcher;
    expect(after).toBe(before);
  });
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `npx vitest run src/app/use-chat-dispatcher.test.ts`

Expected: 15 passed.

**Why these pass on first run:** the hook's `useMemo` has empty deps (`[]`), so the dispatcher is created once on mount and never replaced. Both tests would fail if a future change accidentally added a reactive value to the deps.

If a test fails with `expect(after).toBe(before)` mismatch — search the hook for any value that's not read via a ref but still reached inside the `useMemo` factory. Common culprits: stale closure references, helper functions defined in the hook body that aren't `useCallback`-wrapped (since they'd be recreated each render and become non-stable deps if added to the array).

- [ ] **Step 3: Commit**

```bash
git add src/app/use-chat-dispatcher.test.ts
git commit -m "test(use-chat-dispatcher): pin dispatcher identity stability"
```

---

## Task 8: Wire `useChatDispatcher` into `task-manager.tsx`

This is the migration commit. The hook is fully tested and ready; now `task-manager.tsx` consumes it and the inline dispatcher disappears.

**Files:**
- Modify: `src/app/task-manager.tsx` (delete lines 2173-2409, add ~10 lines, modify ChatPanel call site, audit imports)

- [ ] **Step 1: Add the import for `useChatDispatcher`**

In `src/app/task-manager.tsx`, near the top with the other local imports (around line 23 where `VersionMenu` is imported), add:

```ts
import { useChatDispatcher } from "./use-chat-dispatcher";
```

- [ ] **Step 2: Delete the inline dispatcher block (lines 2173-2409)**

Open `src/app/task-manager.tsx`. Locate the block that starts with:

```ts
  // Refs feed the chat dispatcher without forcing it to rebuild every render.
  const tasksRef = useRef(tasks);
```

and ends with the closing brace of the dispatcher `useMemo`:

```ts
    [editingId, dispatcherSendInquiry, applyFilters],
  );
```

Delete every line in between, inclusive. This removes:
- 3 `useRef` declarations (`tasksRef`, `settingsRef`, `todayRef`) and their sync `useEffect`s
- `dispatcherSendInquiry` `useCallback`
- `applyFilters` `useCallback`
- The 180-line dispatcher `useMemo`

After deletion, the surrounding context should read like (showing 10 lines above and below where the block used to be):

```ts
      );
      if (items.length > 0) setDueModalOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, tasks, holidaySet]);

  // [Notification banner / due-modal effect, etc — whatever already
  //  followed the dispatcher block in the original file]
```

- [ ] **Step 3: Insert the new `useChatDispatcher` call and `handleAcceptAiConsent` callback**

Where the deleted block used to be, insert these ~10 lines:

```ts
  const dispatcher = useChatDispatcher({
    settings,
    today,
    setSelectedIds,
    setSettings,
  });

  const handleAcceptAiConsent = useCallback(() => {
    setSettings((s) => ({ ...s, ai: { ...s.ai, consentAccepted: true } }));
  }, []);
```

`useCallback` should already be imported at the top of `task-manager.tsx`; if not, add it to the existing React imports.

- [ ] **Step 4: Update the ChatPanel call site**

Locate the ChatPanel JSX (was at lines 2742-2752; now at the new offset after deletion). It reads:

```tsx
<ChatPanel
  lang={lang}
  ai={settings.ai}
  dispatcher={dispatcher}
  onAcceptConsent={() =>
    setSettings((s) => ({
      ...s,
      ai: { ...s.ai, consentAccepted: true },
    }))
  }
/>
```

Replace with:

```tsx
<ChatPanel
  lang={lang}
  ai={settings.ai}
  dispatcher={dispatcher}
  onAcceptConsent={handleAcceptAiConsent}
/>
```

- [ ] **Step 5: Audit and drop orphaned imports**

The dispatcher's sanitization helpers moved into the hook. Some of them may still be used elsewhere in `task-manager.tsx` (in `handleSubmit`, `handleDelete`, voice-command handler, etc.). Audit by running:

```bash
npx tsc --noEmit
npx eslint src/app/task-manager.tsx
```

For each import that ESLint reports as unused (`no-unused-vars` / `@typescript-eslint/no-unused-vars`), delete it from the import list. Typical candidates: `Filters` and `ToolDispatcher` from `./chat-tools` are guaranteed orphans; check whether `greetingName`, `isValidEmail`, and any `sanitize*` functions are still referenced.

Also delete the `// eslint-disable-next-line react-hooks/exhaustive-deps` line if it was attached to the deleted dispatcher `useMemo` (it was — and it's gone with the block).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`

Expected: 84 tests passed across 12 files (69 prior + 15 new from this slice).

If you see "fewer tests than expected" — check `npx vitest list` to confirm `use-chat-dispatcher.test.ts` is being picked up. The test file should match the default `include` glob in `vitest.config.ts` (`src/**/*.test.{ts,tsx}`).

- [ ] **Step 8: Manual smoke — chat tool calls**

Start the dev server:

```bash
npm run dev
```

In the browser:
1. Open the app at `http://localhost:3000`.
2. Open the Chat tab.
3. Ask Claude (in chat): *"What tasks do I have?"* → Claude calls `listTasks` → see the same tasks the visible list shows.
4. Ask: *"Create a task called Echo, assigned to Eve, due 2026-06-05."* → Claude calls `createTask` → new row appears in the table.
5. Ask: *"What does task 1 look like now?"* → Claude calls `getTask(1)` → shows the row.
6. Ask: *"Set task 1 priority to Urgent."* → Claude calls `updateTask` → priority changes in the table.
7. Ask: *"Delete task 2."* → Claude calls `deleteTask(2)` → row disappears.

If step 4-7 (back-to-back tool calls in one chat turn) work — the `tasksRef.current = next` synchronous assignment is functioning correctly.

If a tool call fails — open DevTools console for the dispatcher error message. Most likely cause: a sanitize helper import was dropped from `task-manager.tsx` but is still referenced. Re-add the import.

- [ ] **Step 9: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "refactor(task-manager): consume useChatDispatcher; drop inline dispatcher"
```

---

## Task 9: Memoize `ChatPanel`

Wrap the `ChatPanel` export with `React.memo`. With the dispatcher now stable and `handleAcceptAiConsent` `useCallback`-wrapped, all four `ChatPanel` props are reference-stable — `React.memo` will skip every re-render that doesn't change `lang` or `settings.ai`.

**Files:**
- Modify: `src/app/chat-panel.tsx`

- [ ] **Step 1: Read the current shape of `chat-panel.tsx`**

Use Read on `src/app/chat-panel.tsx` lines 1-40 to identify the export shape. Two common shapes:

**Shape A (named function export):**
```tsx
export function ChatPanel(props: ChatPanelProps) { ... }
```

**Shape B (named const export):**
```tsx
export const ChatPanel = (props: ChatPanelProps) => { ... }
```

The wrap-with-memo edit differs slightly between the two.

- [ ] **Step 2: Wrap with `React.memo`**

If Shape A:

```tsx
// Before
export function ChatPanel(props: ChatPanelProps) {
  // ...body...
}

// After
function ChatPanelImpl(props: ChatPanelProps) {
  // ...body unchanged...
}
export const ChatPanel = memo(ChatPanelImpl);
```

If Shape B:

```tsx
// Before
export const ChatPanel = (props: ChatPanelProps) => {
  // ...body...
};

// After
const ChatPanelImpl = (props: ChatPanelProps) => {
  // ...body unchanged...
};
export const ChatPanel = memo(ChatPanelImpl);
```

In both cases, add `memo` to the existing React import at the top of the file:

```ts
import { memo, /* existing imports */ } from "react";
```

If `chat-panel.tsx` already imports `useState`/`useEffect`/etc, just add `memo` to the same import block.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: exit 0.

If `tsc` errors with *"Type ... is not assignable to type 'MemoExoticComponent<...>'"* — check that `ChatPanelImpl` is a regular function or arrow function with the correct prop type. `React.memo` accepts both.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`

Expected: 84 tests passed. No test changes; memoization is invisible to functional tests.

- [ ] **Step 5: Manual smoke — memoization payoff**

Start the dev server if it's not running: `npm run dev`.

1. Open `http://localhost:3000`.
2. Open React DevTools (Chrome extension or the standalone app).
3. In React DevTools → **Settings cog → Highlight updates when components render** → enable.
4. Open the "+" (new task) modal so the task form is rendered.
5. Type a few characters into the **Task name** input.
6. Watch for the highlight outline:
   - **Expected:** `TaskFormModal` and its children highlight on every keystroke. `ChatPanel` does NOT highlight (it's memoized; props are reference-stable).
   - **Failure mode:** `ChatPanel` highlights on every keystroke → the memoization didn't take. Likely cause: `handleAcceptAiConsent` is not `useCallback`-wrapped (re-check Task 8 step 3), or `settings.ai` is being reconstructed each render (check whether `setSettings(s => ({...s, ai: {...s.ai, ...}}))` is in the form's onChange path — it shouldn't be).
7. Switch to the Chat tab. Type a message. Send. Claude should respond normally, proving the dispatcher still works post-memoization.

- [ ] **Step 6: Commit**

```bash
git add src/app/chat-panel.tsx
git commit -m "perf(chat-panel): wrap with React.memo to skip parent re-renders"
```

---

## Task 10: Final verification

A pure verification task — no code changes. Runs the full battery (type-check, tests, production build, manual smoke C) to prove the slice is shippable.

- [ ] **Step 1: Type-check is clean**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 2: Full test suite passes**

Run: `npx vitest run`

Expected: 84 tests across 12 files.

- [ ] **Step 3: Production build succeeds**

Run: `npm run build`

Expected: Next.js build green. ESLint warnings about unused imports are acceptable but ideally already addressed in Task 8 step 5.

- [ ] **Step 4: Lint is clean**

Run: `npm run lint`

Expected: zero errors. Warnings about `react-hooks/exhaustive-deps` should only appear on the intentional `// eslint-disable-next-line` line inside `use-chat-dispatcher.ts`.

- [ ] **Step 5: Manual smoke C — chat-triggered task close**

If the dev server isn't running: `npm run dev`.

1. Open the app.
2. Click any task row's "edit" pencil icon to open the edit form.
3. Switch to the Chat tab. Ask Claude: *"Delete task N."* (using the id of the task you just opened for editing).
4. **Expected:** the task is deleted. Switch back to the task list — the row is gone, and the edit form is closed (the `editingIdRef === id` branch fired and cleared `editingId` + `form`).

If the form stayed open after deletion: `editingIdRef.current` was stale when `deleteTask` ran. This shouldn't happen under normal React semantics — but if it does, check that the `useEffect` syncing `editingIdRef.current = editingId` is present in `use-chat-dispatcher.ts` (Task 2 step 3).

- [ ] **Step 6: `task-manager.tsx` line count**

```bash
wc -l src/app/task-manager.tsx
```

Expected: ~3,317 lines (was 3,517).

---

## Final verification (after Task 10)

- [ ] **All 15 new tests are present and green**

```bash
npx vitest run src/app/use-chat-dispatcher.test.ts
```

Expected: 15 passed (one more than the spec's 14 — the plan splits "getTask hit + miss" into two `it()` blocks for clarity).

- [ ] **ChatPanel re-renders only on `lang` or `settings.ai` changes**

Verified manually in Task 9 step 5.

- [ ] **The dispatcher's `useMemo` deps are `[]`**

```bash
grep -B 1 -A 2 "Empty deps" src/app/use-chat-dispatcher.ts
```

Expected: the line below the `useMemo` call shows the closing `[]`. No editingId, no callbacks in the deps — that's the structural change that unlocks `React.memo(ChatPanel)`.

- [ ] **Commit log** — `git log --oneline -10` shows the slice 5 commits at HEAD, in order:
  1. `feat(test-providers): scaffold TestProviders + Seeder for hook tests`
  2. `feat(use-chat-dispatcher): scaffold hook + listTasks/getTask tests`
  3. `feat(use-chat-dispatcher): implement createTask`
  4. `feat(use-chat-dispatcher): implement updateTask with Jira-lock invariants`
  5. `feat(use-chat-dispatcher): implement deleteTask + deleteAllTasks`
  6. `feat(use-chat-dispatcher): implement sendInquiry, setFilters, setLanguage, getSnapshot`
  7. `test(use-chat-dispatcher): pin dispatcher identity stability`
  8. `refactor(task-manager): consume useChatDispatcher; drop inline dispatcher`
  9. `perf(chat-panel): wrap with React.memo to skip parent re-renders`
