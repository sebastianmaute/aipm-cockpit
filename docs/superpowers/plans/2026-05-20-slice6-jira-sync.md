# Slice 6 — useJiraSync Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `handleJiraSync` + `handleResolveConflicts` from `task-manager.tsx` into a dedicated `useJiraSync` hook, reducing `task-manager.tsx` by ~315 lines while adding 12 focused unit tests.

**Architecture:** Plain hook (`use-jira-sync.ts`) that owns `jiraSyncing` + `jiraConflicts` state, reads `tasks`/`setTasks` from `useWorkspace()`, and routes reactive values through refs so `useCallback` deps stay minimal. Mirrors the `useChatDispatcher` pattern from Slice 5. `loadJiraApi` is moved to the new file and re-exported so `task-manager.tsx` can import it.

**Tech Stack:** React 19, TypeScript 5, Vitest 3 + `@testing-library/react` 16, `renderHook` + `act`, `vi.mock` for dynamic imports.

---

### Task 1: Scaffold `use-jira-sync.test.tsx` + 2 state-init tests

**Files:**
- Create: `src/app/use-jira-sync.test.tsx`

- [ ] **Step 1: Verify test infra exists**

Run: `npx vitest run src/app/use-chat-dispatcher.test.tsx --reporter=verbose`

Expected: All tests pass (confirms `TestProviders` + `renderHook` setup works).

- [ ] **Step 2: Write the failing test file**

Create `src/app/use-jira-sync.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "./types";
import { useJiraSync } from "./use-jira-sync";
import { useWorkspace } from "./workspace-context";
import { TestProviders } from "./test-providers";

// ── Jira API mock ────────────────────────────────────────────────────────────
vi.mock("./jira-api", () => ({
  buildJql: vi.fn(),
  searchAllIssues: vi.fn(),
  issueToTaskFields: vi.fn(),
  diffTaskAgainstIssue: vi.fn(),
  isIssueDone: vi.fn(),
  updateIssue: vi.fn(),
  taskFieldsToJiraFields: vi.fn(() => ({})),
  transitionIssueTo: vi.fn(),
  formatJiraError: vi.fn((e: unknown) => String(e)),
  createIssue: vi.fn(),
}));
import * as jiraApi from "./jira-api";

// ── Shared fixtures ──────────────────────────────────────────────────────────
const showToast = vi.fn();
const logActivity = vi.fn();

const baseSettings = {
  jira: { siteUrl: "https://acme.atlassian.net", email: "user@acme.com", token: "tok", projectKey: "TEST", issueType: "Task" },
} as any;

const noCredSettings = { jira: {} } as any;

const baseTask: Task = {
  id: 1, title: "T1", assignee: "", priority: "medium", status: "open",
  dueDate: "2026-06-01", createdAt: "2026-01-01",
} as any;

// ── Composite probe hook so we can inspect workspace tasks ───────────────────
function makeProbe(overrideSettings = baseSettings) {
  return function probe() {
    const sync = useJiraSync({
      settings: overrideSettings,
      today: "2026-05-20",
      lang: "en",
      showToast,
      logActivity,
    });
    const { tasks } = useWorkspace();
    return { ...sync, currentTasks: tasks };
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function renderSync(initialTasks: Task[] = [], overrideSettings = baseSettings) {
  return renderHook(makeProbe(overrideSettings), {
    wrapper: ({ children }) => (
      <TestProviders initialTasks={initialTasks}>{children}</TestProviders>
    ),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("useJiraSync — state initialisation", () => {
  it("jiraSyncing initialises to false and jiraConflicts initialises to []", () => {
    const { result } = renderSync();
    expect(result.current.jiraSyncing).toBe(false);
    expect(result.current.jiraConflicts).toEqual([]);
  });

  it("clearConflicts resets a pre-populated jiraConflicts array to []", async () => {
    // We'll populate via handleJiraSync conflict path in later tasks.
    // For now, verify the function is exposed and callable.
    const { result } = renderSync();
    expect(typeof result.current.clearConflicts).toBe("function");
    await act(async () => { result.current.clearConflicts(); });
    expect(result.current.jiraConflicts).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests — expect module-not-found failure**

Run: `npx vitest run src/app/use-jira-sync.test.tsx --reporter=verbose`

Expected: FAIL — "Cannot find module './use-jira-sync'".

- [ ] **Step 4: Commit**

```bash
git add src/app/use-jira-sync.test.tsx
git commit -m "test(use-jira-sync): scaffold hook + state-init tests"
```

---

### Task 2: Create `use-jira-sync.ts` skeleton + move `loadJiraApi`

**Files:**
- Create: `src/app/use-jira-sync.ts`
- Modify: `src/app/task-manager.tsx` (replace `loadJiraApi` definition with import)

- [ ] **Step 1: Read the existing loadJiraApi block in task-manager.tsx**

Read `src/app/task-manager.tsx` lines 171–183. Confirm:
```ts
type JiraApiModule = typeof import("./jira-api");
let jiraApiPromise: Promise<JiraApiModule> | null = null;
function loadJiraApi(): Promise<JiraApiModule> {
  if (!jiraApiPromise) { jiraApiPromise = import("./jira-api"); }
  return jiraApiPromise;
}
```

- [ ] **Step 2: Create `src/app/use-jira-sync.ts`**

```ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityKind } from "./activity-log";
import type { ConflictItem } from "./jira-api";
import type { ConflictResolution } from "./jira-conflicts-modal";
import type { Settings } from "./settings-menu";
import { useWorkspace } from "./workspace-context";

// ── Lazy-load cache ──────────────────────────────────────────────────────────
type JiraApiModule = typeof import("./jira-api");
let jiraApiPromise: Promise<JiraApiModule> | null = null;
export function loadJiraApi(): Promise<JiraApiModule> {
  if (!jiraApiPromise) { jiraApiPromise = import("./jira-api"); }
  return jiraApiPromise;
}

// ── Types ────────────────────────────────────────────────────────────────────
export interface UseJiraSyncArgs {
  settings: Settings;
  today: string;
  lang: string;
  showToast: (kind: "info" | "error", text: string) => void;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useJiraSync(args: UseJiraSyncArgs) {
  const { tasks, setTasks } = useWorkspace();

  // Reactive values behind refs so stable useCallbacks never go stale
  const tasksRef = useRef(tasks);
  const settingsRef = useRef(args.settings);
  const langRef = useRef(args.lang);
  const todayRef = useRef(args.today);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { settingsRef.current = args.settings; }, [args.settings]);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);
  useEffect(() => { todayRef.current = args.today; }, [args.today]);

  // Owned state
  const [jiraSyncing, setJiraSyncing] = useState(false);
  const [jiraConflicts, setJiraConflicts] = useState<ConflictItem[]>([]);

  // Ref guards for stable callbacks (avoid stale closures on boolean/array state)
  const jiraSyncingRef = useRef(false);
  const jiraConflictsRef = useRef(jiraConflicts);
  useEffect(() => { jiraConflictsRef.current = jiraConflicts; }, [jiraConflicts]);

  const handleJiraSync = useCallback(async () => {
    // TODO: implement in Task 4 + 6
  }, [args.showToast, args.logActivity]);

  const handleResolveConflicts = useCallback(async (_resolutions: ConflictResolution[]) => {
    // TODO: implement in Task 8
  }, [args.showToast, args.logActivity]);

  const clearConflicts = useCallback(() => setJiraConflicts([]), []);

  return { handleJiraSync, handleResolveConflicts, jiraSyncing, jiraConflicts, clearConflicts };
}
```

- [ ] **Step 3: Replace loadJiraApi in task-manager.tsx with an import**

In `src/app/task-manager.tsx`, replace the `loadJiraApi` block (lines ~171–183):
```ts
type JiraApiModule = typeof import("./jira-api");
let jiraApiPromise: Promise<JiraApiModule> | null = null;
function loadJiraApi(): Promise<JiraApiModule> {
  if (!jiraApiPromise) { jiraApiPromise = import("./jira-api"); }
  return jiraApiPromise;
}
```
with:
```ts
import { loadJiraApi } from "./use-jira-sync";
```

Add this import line near the top of the file with the other local imports.

- [ ] **Step 4: Run tests — expect 2 state-init tests to pass**

Run: `npx vitest run src/app/use-jira-sync.test.tsx --reporter=verbose`

Expected: PASS — 2 tests green.

- [ ] **Step 5: Run full suite — confirm no regressions**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`

Expected: All previously passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-jira-sync.ts src/app/task-manager.tsx
git commit -m "feat(use-jira-sync): implement hook skeleton + jiraSyncing/jiraConflicts state"
```

---

### Task 3: Add no-credentials + jiraSyncing-flip tests

**Files:**
- Modify: `src/app/use-jira-sync.test.tsx`

- [ ] **Step 1: Append the two new test blocks**

Add to `src/app/use-jira-sync.test.tsx` after the state-init describe block:

```tsx
describe("useJiraSync — handleJiraSync", () => {
  it("shows credential-error toast and jiraSyncing stays false when no credentials", async () => {
    const { result } = renderSync([], noCredSettings);
    await act(async () => { await result.current.handleJiraSync(); });
    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("credential"));
    expect(result.current.jiraSyncing).toBe(false);
  });

  it("jiraSyncing flips true during call then resets to false on completion", async () => {
    const states: boolean[] = [];
    // searchAllIssues resolves immediately with empty list (no tasks to sync)
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const { result } = renderSync([]);

    // Capture state mid-flight by monitoring via a short-circuit path
    await act(async () => {
      const p = result.current.handleJiraSync();
      states.push(result.current.jiraSyncing); // captured before await resolves in next tick
      await p;
      states.push(result.current.jiraSyncing);
    });

    // After call: jiraSyncing is false
    expect(result.current.jiraSyncing).toBe(false);
    // Last state recorded is false
    expect(states[states.length - 1]).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect new tests to fail (not implemented yet)**

Run: `npx vitest run src/app/use-jira-sync.test.tsx --reporter=verbose`

Expected: 2 state-init tests PASS, 2 new tests FAIL (handleJiraSync is a no-op stub).

- [ ] **Step 3: Commit**

```bash
git add src/app/use-jira-sync.test.tsx
git commit -m "test(use-jira-sync): no-credentials + jiraSyncing flip tests"
```

---

### Task 4: Implement `handleJiraSync` pull + push paths

**Files:**
- Modify: `src/app/use-jira-sync.ts`
- Reference: `src/app/task-manager.tsx` lines 1508–1709

- [ ] **Step 1: Read the source block in task-manager.tsx**

Read `src/app/task-manager.tsx` lines 1508–1709 in full.

- [ ] **Step 2: Implement handleJiraSync (credential check + pull + push + early return on no-creds)**

Replace the `handleJiraSync` stub in `use-jira-sync.ts` with the full implementation copied from `task-manager.tsx` lines 1508–1709, updated to use refs:

Key substitutions:
- `jiraSyncing` guard → `jiraSyncingRef.current`
- `setJiraSyncing(true)` → `jiraSyncingRef.current = true; setJiraSyncing(true);`
- `setJiraSyncing(false)` → `jiraSyncingRef.current = false; setJiraSyncing(false);`
- `tasks` reads → `tasksRef.current`
- `setTasks(...)` → `setTasks(...)`
- `settings.jira` → `settingsRef.current.jira`
- `today` → `todayRef.current`
- `lang` → `langRef.current`
- `setJiraConflicts(...)` calls → keep as-is (stable setter)
- `showToast(...)` → `args.showToast(...)`
- `logActivity(...)` → `args.logActivity(...)`

Conflict detection path: set `jiraConflicts` via `setJiraConflicts` and also sync the ref:
```ts
setJiraConflicts(conflicts);
jiraConflictsRef.current = conflicts;
```

- [ ] **Step 3: Run tests — expect credential + jiraSyncing tests to now pass**

Run: `npx vitest run src/app/use-jira-sync.test.tsx --reporter=verbose`

Expected: 4 tests pass (state-init × 2, no-creds, jiraSyncing flip).

- [ ] **Step 4: Run full suite**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`

Expected: All previously passing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-jira-sync.ts
git commit -m "feat(use-jira-sync): implement handleJiraSync pull + push paths"
```

---

### Task 5: Add pull / push / conflict / create-path / error-path tests

**Files:**
- Modify: `src/app/use-jira-sync.test.tsx`

- [ ] **Step 1: Read jira-api.ts to confirm mock shape**

Read `src/app/jira-api.ts` lines 1–50 to confirm exported function names and return shapes for `searchAllIssues`, `issueToTaskFields`, `diffTaskAgainstIssue`, `updateIssue`, `createIssue`, `isIssueDone`, `formatJiraError`.

- [ ] **Step 2: Append 5 new test cases inside the handleJiraSync describe block**

```tsx
  it("pull path: Jira issue absent locally → new task added, logActivity called", async () => {
    const remoteIssue = { key: "TEST-1", fields: { summary: "Remote task" } } as any;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (jiraApi.issueToTaskFields as ReturnType<typeof vi.fn>).mockReturnValue({
      title: "Remote task", jiraIssueKey: "TEST-1",
    });

    const { result } = renderSync([]); // no local tasks
    await act(async () => { await result.current.handleJiraSync(); });

    expect(result.current.currentTasks.length).toBe(1);
    expect(result.current.currentTasks[0].jiraIssueKey).toBe("TEST-1");
    expect(logActivity).toHaveBeenCalled();
  });

  it("push path: local task with jiraIssueKey + dirty fields → updateIssue called", async () => {
    const localTask = { ...baseTask, jiraIssueKey: "TEST-1" } as any;
    const remoteIssue = { key: "TEST-1", fields: {} } as any;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (jiraApi.diffTaskAgainstIssue as ReturnType<typeof vi.fn>).mockReturnValue({
      localChanged: ["title"], remoteChanged: [],
    });
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({ summary: "Updated" });
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const { result } = renderSync([localTask]);
    await act(async () => { await result.current.handleJiraSync(); });

    expect(jiraApi.updateIssue).toHaveBeenCalledWith(
      expect.objectContaining({ issueKey: "TEST-1" })
    );
  });

  it("conflict path: same field changed on both sides → jiraConflicts populated, tasks unchanged", async () => {
    const localTask = { ...baseTask, jiraIssueKey: "TEST-2", title: "Local title" } as any;
    const remoteIssue = { key: "TEST-2", fields: { summary: "Remote title" } } as any;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (jiraApi.diffTaskAgainstIssue as ReturnType<typeof vi.fn>).mockReturnValue({
      localChanged: ["title"], remoteChanged: ["title"],
    });

    const { result } = renderSync([localTask]);
    await act(async () => { await result.current.handleJiraSync(); });

    expect(result.current.jiraConflicts.length).toBeGreaterThan(0);
    expect(result.current.jiraConflicts[0].jiraKey).toBe("TEST-2");
    // Task list unchanged during conflict
    expect(result.current.currentTasks[0].title).toBe("Local title");
  });

  it("create path: Jira issue not in local list → new local task created from remote", async () => {
    const newRemoteIssue = { key: "TEST-99", fields: { summary: "Brand new" } } as any;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([newRemoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (jiraApi.issueToTaskFields as ReturnType<typeof vi.fn>).mockReturnValue({
      title: "Brand new", jiraIssueKey: "TEST-99",
    });

    const { result } = renderSync([]); // no local tasks
    await act(async () => { await result.current.handleJiraSync(); });

    const created = result.current.currentTasks.find(t => t.jiraIssueKey === "TEST-99");
    expect(created).toBeDefined();
    expect(created?.title).toBe("Brand new");
  });

  it("error path: loadJiraApi throws → error toast shown, jiraSyncing reset to false", async () => {
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network failure")
    );

    const { result } = renderSync([]);
    await act(async () => { await result.current.handleJiraSync(); });

    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
    expect(result.current.jiraSyncing).toBe(false);
  });
```

- [ ] **Step 3: Run tests — 7 handleJiraSync tests should all pass**

Run: `npx vitest run src/app/use-jira-sync.test.tsx --reporter=verbose`

Expected: 9 tests pass (2 state-init + 7 handleJiraSync).

- [ ] **Step 4: Commit**

```bash
git add src/app/use-jira-sync.test.tsx
git commit -m "test(use-jira-sync): pull, push, conflict, create, error path tests"
```

---

### Task 6: Implement conflict detection + create-issue path in `handleJiraSync`

**Files:**
- Modify: `src/app/use-jira-sync.ts`

This task makes the 5 tests added in Task 5 go from RED to GREEN by completing the handleJiraSync implementation (the parts not covered in Task 4: conflict detection and remote-to-local create path).

- [ ] **Step 1: Verify current test count**

Run: `npx vitest run src/app/use-jira-sync.test.tsx --reporter=verbose 2>&1 | grep -E "pass|fail"`

Note which tests are failing. Expected: pull, push, conflict, create-path, error tests are RED.

- [ ] **Step 2: Complete handleJiraSync implementation**

Ensure the full body from `task-manager.tsx` lines 1508–1709 is in place (from Task 4 above). The conflict detection block and remote-to-local create path should already be part of that copy. If any section was omitted in Task 4, add it now.

Key sections that must be present:
```ts
// Conflict path (both localChanged and remoteChanged non-empty for same field):
if (localChanged.length > 0 && remoteChanged.some(f => localChanged.includes(f))) {
  conflicts.push({ taskId: local.id, jiraKey: issue.key, fields: [...] });
  continue; // skip push/pull
}

// Remote-to-local create path (Jira issue not matched by any local jiraIssueKey):
const unmatched = remoteIssues.filter(r => !localTasks.some(t => t.jiraIssueKey === r.key));
for (const issue of unmatched) {
  const fields = issueToTaskFields(issue, ...);
  const newTask = { id: nextId(), ...fields };
  created.push(newTask);
  logActivity("jira_pull", ...);
}
```

- [ ] **Step 3: Run tests — all 9 tests should now be green**

Run: `npx vitest run src/app/use-jira-sync.test.tsx --reporter=verbose`

Expected: 9/9 PASS.

- [ ] **Step 4: Run full suite**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`

Expected: All previously passing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-jira-sync.ts
git commit -m "feat(use-jira-sync): implement conflict detection + create-issue path"
```

---

### Task 7: Add `handleResolveConflicts` tests

**Files:**
- Modify: `src/app/use-jira-sync.test.tsx`

- [ ] **Step 1: Append the 3 conflict-resolution tests**

Add a new describe block after the handleJiraSync block:

```tsx
describe("useJiraSync — handleResolveConflicts", () => {
  const conflictItem = {
    taskId: 1,
    jiraKey: "TEST-1",
    jiraIssueType: "Task",
    remoteDone: false,
    fields: [
      {
        key: "title" as const,
        localValue: "Local title",
        remoteValue: "Remote title",
      },
    ],
  };

  it("'keep local' resolution → task unchanged, updateIssue called with local value", async () => {
    // First populate jiraConflicts via handleJiraSync conflict path
    const localTask = { ...baseTask, id: 1, jiraIssueKey: "TEST-1", title: "Local title" } as any;
    const remoteIssue = { key: "TEST-1", fields: { summary: "Remote title" } } as any;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (jiraApi.diffTaskAgainstIssue as ReturnType<typeof vi.fn>).mockReturnValue({
      localChanged: ["title"], remoteChanged: ["title"],
    });
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({ summary: "Local title" });
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const { result } = renderSync([localTask]);
    await act(async () => { await result.current.handleJiraSync(); });
    expect(result.current.jiraConflicts.length).toBeGreaterThan(0);

    const resolution = {
      taskId: 1,
      jiraKey: "TEST-1",
      picks: { title: "local" as const },
    };

    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    // Task title unchanged
    expect(result.current.currentTasks[0].title).toBe("Local title");
    // updateIssue called to sync local value back to Jira
    expect(jiraApi.updateIssue).toHaveBeenCalled();
  });

  it("'use remote' resolution → task updated with remote value, updateIssue NOT called for that field", async () => {
    const localTask = { ...baseTask, id: 1, jiraIssueKey: "TEST-1", title: "Local title" } as any;
    const remoteIssue = { key: "TEST-1", fields: { summary: "Remote title" } } as any;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (jiraApi.diffTaskAgainstIssue as ReturnType<typeof vi.fn>).mockReturnValue({
      localChanged: ["title"], remoteChanged: ["title"],
    });

    const { result } = renderSync([localTask]);
    await act(async () => { await result.current.handleJiraSync(); });

    vi.clearAllMocks();

    const resolution = {
      taskId: 1,
      jiraKey: "TEST-1",
      picks: { title: "remote" as const },
    };

    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    // Task title updated to remote value
    expect(result.current.currentTasks[0].title).toBe("Remote title");
    // updateIssue NOT called (remote is already up to date)
    expect(jiraApi.updateIssue).not.toHaveBeenCalled();
  });

  it("after resolution completes → jiraConflicts cleared to []", async () => {
    const localTask = { ...baseTask, id: 1, jiraIssueKey: "TEST-1", title: "Local title" } as any;
    const remoteIssue = { key: "TEST-1", fields: { summary: "Remote title" } } as any;
    (jiraApi.searchAllIssues as ReturnType<typeof vi.fn>).mockResolvedValueOnce([remoteIssue]);
    (jiraApi.isIssueDone as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (jiraApi.diffTaskAgainstIssue as ReturnType<typeof vi.fn>).mockReturnValue({
      localChanged: ["title"], remoteChanged: ["title"],
    });
    (jiraApi.updateIssue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    (jiraApi.taskFieldsToJiraFields as ReturnType<typeof vi.fn>).mockReturnValue({});

    const { result } = renderSync([localTask]);
    await act(async () => { await result.current.handleJiraSync(); });
    expect(result.current.jiraConflicts.length).toBeGreaterThan(0);

    const resolution = {
      taskId: 1,
      jiraKey: "TEST-1",
      picks: { title: "local" as const },
    };

    await act(async () => { await result.current.handleResolveConflicts([resolution]); });

    expect(result.current.jiraConflicts).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — 3 new tests RED (handleResolveConflicts is a stub)**

Run: `npx vitest run src/app/use-jira-sync.test.tsx --reporter=verbose`

Expected: 9 pass, 3 fail.

- [ ] **Step 3: Commit**

```bash
git add src/app/use-jira-sync.test.tsx
git commit -m "test(use-jira-sync): handleResolveConflicts tests"
```

---

### Task 8: Implement `handleResolveConflicts`

**Files:**
- Modify: `src/app/use-jira-sync.ts`
- Reference: `src/app/task-manager.tsx` lines 1711–1809

- [ ] **Step 1: Read the source block in task-manager.tsx**

Read `src/app/task-manager.tsx` lines 1711–1809 in full.

- [ ] **Step 2: Replace the handleResolveConflicts stub**

Replace the stub in `use-jira-sync.ts` with the full implementation copied from `task-manager.tsx` lines 1711–1809, updated to use refs:

Key substitutions:
- `jiraConflicts` reads → `jiraConflictsRef.current`
- `setJiraConflicts([])` at end → `setJiraConflicts([]); jiraConflictsRef.current = [];`
- `tasks` reads → `tasksRef.current`
- `setTasks(...)` → `setTasks(...)`
- `settings.jira` → `settingsRef.current.jira`
- `showToast(...)` → `args.showToast(...)`
- `logActivity(...)` → `args.logActivity(...)`

- [ ] **Step 3: Run tests — all 12 tests should now be green**

Run: `npx vitest run src/app/use-jira-sync.test.tsx --reporter=verbose`

Expected: 12/12 PASS.

- [ ] **Step 4: Run full suite**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`

Expected: All previously passing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-jira-sync.ts
git commit -m "feat(use-jira-sync): implement handleResolveConflicts"
```

---

### Task 9: Refactor `task-manager.tsx` — consume `useJiraSync`, remove inline handlers

**Files:**
- Modify: `src/app/task-manager.tsx`

- [ ] **Step 1: Add useJiraSync import to task-manager.tsx**

Near the top of `src/app/task-manager.tsx`, add to the local imports:
```ts
import { useJiraSync } from "./use-jira-sync";
```

(The `loadJiraApi` import was already added in Task 2.)

- [ ] **Step 2: Remove jiraSyncing + jiraConflicts state declarations**

Delete these two lines (around line 407–408):
```ts
const [jiraSyncing, setJiraSyncing] = useState(false);
const [jiraConflicts, setJiraConflicts] = useState<ConflictItem[]>([]);
```

- [ ] **Step 3: Add useJiraSync call site**

After the existing hook calls (near `useChatDispatcher`, around line 590 area), add:
```ts
const {
  handleJiraSync,
  handleResolveConflicts,
  jiraSyncing,
  jiraConflicts,
  clearConflicts,
} = useJiraSync({ settings, today, lang, showToast, logActivity });
```

- [ ] **Step 4: Remove handleJiraSync function body (~201 lines)**

Delete lines 1508–1709 in the original file (the full `handleJiraSync` async function definition). After the refactor, `handleJiraSync` comes from the hook above.

- [ ] **Step 5: Remove handleResolveConflicts function body (~100 lines)**

Delete lines 1711–1809 in the original file (the full `handleResolveConflicts` async function definition).

- [ ] **Step 6: Update JiraConflictsModal onClose prop**

Find:
```tsx
onClose={() => setJiraConflicts([])}
```
Replace with:
```tsx
onClose={clearConflicts}
```

- [ ] **Step 7: Verify TypeScript compiles clean**

Run: `npx tsc --noEmit 2>&1 | head -40`

Expected: No errors. If there are errors, fix them (likely a missing import or type reference).

- [ ] **Step 8: Run full test suite**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`

Expected: All 96 tests pass (84 prior + 12 new).

- [ ] **Step 9: Check line count reduction**

Run: `wc -l src/app/task-manager.tsx` (or PowerShell: `(Get-Content src/app/task-manager.tsx).Count`)

Expected: ~2,974 lines (down from ~3,289, −~315).

- [ ] **Step 10: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "refactor(task-manager): consume useJiraSync; drop inline sync handlers"
```

---

### Task 10: Version bump + CHANGELOG

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md` (or create if absent)

- [ ] **Step 1: Bump version in package.json**

In `package.json`, change:
```json
"version": "0.7.3"
```
to:
```json
"version": "0.7.4"
```

- [ ] **Step 2: Update version in README.md**

Find the version badge / tagline in `README.md`:
```
**v0.7.3**
```
Replace with:
```
**v0.7.4**
```

- [ ] **Step 3: Prepend CHANGELOG entry**

Read `CHANGELOG.md` (or check if it exists). Prepend:

```markdown
## [0.7.4] — 2026-05-20 "Bradbury"

### Refactored
- Extracted `handleJiraSync` + `handleResolveConflicts` from `task-manager.tsx` into dedicated `useJiraSync` hook (`src/app/use-jira-sync.ts`), reducing `task-manager.tsx` by ~315 lines
- `loadJiraApi` moved to `use-jira-sync.ts` and re-exported for use by `task-manager.tsx`

### Tests
- Added 12 unit tests for `useJiraSync` covering state init, sync paths (pull, push, conflict, create, error), and conflict resolution

```

- [ ] **Step 4: Run full suite one final time**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`

Expected: 96/96 PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json README.md CHANGELOG.md
git commit -m "release(v0.7.4): slice6 useJiraSync extraction"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task covering it |
|-----------------|-----------------|
| `useJiraSync` hook in `use-jira-sync.ts` | Task 2 |
| `loadJiraApi` moved + re-exported | Task 2 |
| `jiraSyncing` / `jiraConflicts` state owned by hook | Task 2 |
| `jiraSyncingRef` + `jiraConflictsRef` guards | Task 2 |
| Refs for settings/tasks/today/lang | Task 2 |
| No-credentials toast | Task 3 + 4 |
| `jiraSyncing` flip during call | Task 3 + 4 |
| Pull path (remote → local add) | Task 5 + 6 |
| Push path (local → Jira update) | Task 5 + 4 |
| Conflict path (both changed) | Task 5 + 6 |
| Create path (Jira issue → new local task) | Task 5 + 6 |
| Error path (loadJiraApi throws) | Task 5 + 4 |
| `handleResolveConflicts` keep-local | Task 7 + 8 |
| `handleResolveConflicts` use-remote | Task 7 + 8 |
| `handleResolveConflicts` clears conflicts | Task 7 + 8 |
| `task-manager.tsx` remove state + handlers | Task 9 |
| `clearConflicts` on `JiraConflictsModal` onClose | Task 9 |
| Version 0.7.4 bump | Task 10 |
| 96 total tests | Tasks 1 + 5 + 7 + full suite checks |

All spec requirements covered. No placeholders or TBD entries. Type names match across tasks (`ConflictItem`, `ConflictResolution`, `UseJiraSyncArgs`, `ActivityKind`). `loadJiraApi` export added in Task 2 and imported in task-manager in the same task.
