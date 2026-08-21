# Slice 15 — WorkspaceTabContext + AppHeader + WorkspaceSection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the app `<header>` (~90 lines) and workspace `<section>` (~250 lines) from `task-manager.tsx` into two new components (`AppHeader`, `WorkspaceSection`), backed by a new `WorkspaceTabContext` that manages `activeTab`/`isPopout` state. Update `useTaskRowHandlers` to read those contexts instead of receiving `setActiveTab`/`setWorkspaceCollapsed` as props. Net: ~−340 lines from `task-manager.tsx` (~1,038 → ~698 lines). Version bump to v0.8.3 "Kafka".

**Architecture:** New `WorkspaceTabContext` holds `activeTab`, `setActiveTab`, `isPopout`; provider reads `readPopoutTabFromUrl()` at init via `useState` initializer. `AppHeader` and `WorkspaceSection` read all required context internally; only event-handler callbacks and data-array props are threaded explicitly. `useTaskRowHandlers` drops its two navigation-setter args and calls the hooks directly.

**Tech Stack:** React 19, TypeScript, Next.js (dynamic imports), Vitest + @testing-library/react

---

## File Map

| Action | Path |
|--------|------|
| Create | `src/app/workspace-tab-context.tsx` |
| Create | `src/app/workspace-tab-context.test.tsx` |
| Modify | `src/app/use-task-row-handlers.ts` |
| Modify | `src/app/use-task-row-handlers.test.ts` |
| Create | `src/app/app-header.tsx` |
| Create | `src/app/app-header.test.tsx` |
| Create | `src/app/workspace-section.tsx` |
| Create | `src/app/workspace-section.test.tsx` |
| Modify | `src/app/task-manager.tsx` |
| Modify | `src/app/version.ts` |
| Modify | `CHANGELOG.md` |

---

### Task 1: Create `workspace-tab-context.tsx` + 2 smoke tests

**Files:**
- Create: `src/app/workspace-tab-context.tsx`
- Create: `src/app/workspace-tab-context.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/workspace-tab-context.test.tsx
import { act, renderHook } from "@testing-library/react";
import { useLayoutEffect, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";

function wrapper({ children }: { children: ReactNode }) {
  return <WorkspaceTabProvider>{children}</WorkspaceTabProvider>;
}

describe("WorkspaceTabContext", () => {
  it("default activeTab is 'chat' and isPopout is false", () => {
    const { result } = renderHook(() => useWorkspaceTab(), { wrapper });
    expect(result.current.activeTab).toBe("chat");
    expect(result.current.isPopout).toBe(false);
  });

  it("setActiveTab updates activeTab", () => {
    const { result } = renderHook(
      () => {
        const ctx = useWorkspaceTab();
        useLayoutEffect(() => {
          ctx.setActiveTab("reports");
        }, []);
        return ctx;
      },
      { wrapper },
    );
    expect(result.current.activeTab).toBe("reports");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/workspace-tab-context.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```tsx
// src/app/workspace-tab-context.tsx
"use client";
import React, { createContext, useContext, useState } from "react";
import { type PopoutTab, readPopoutTabFromUrl } from "./broadcast-sync";

export type TopTab = "chat" | "reports" | "gantt" | "raid" | "resources" | "activity";

interface WorkspaceTabContextValue {
  activeTab: TopTab;
  setActiveTab: React.Dispatch<React.SetStateAction<TopTab>>;
  isPopout: boolean;
}

const WorkspaceTabContext = createContext<WorkspaceTabContextValue | null>(null);

export function WorkspaceTabProvider({ children }: { children: React.ReactNode }) {
  const [popoutTab] = useState<PopoutTab | null>(() => readPopoutTabFromUrl());
  const isPopout = popoutTab !== null;
  const [activeTab, setActiveTab] = useState<TopTab>(popoutTab ?? "chat");
  return (
    <WorkspaceTabContext.Provider value={{ activeTab, setActiveTab, isPopout }}>
      {children}
    </WorkspaceTabContext.Provider>
  );
}

export function useWorkspaceTab(): WorkspaceTabContextValue {
  const ctx = useContext(WorkspaceTabContext);
  if (!ctx) throw new Error("useWorkspaceTab must be used inside WorkspaceTabProvider");
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/workspace-tab-context.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace-tab-context.tsx src/app/workspace-tab-context.test.tsx
git commit -m "feat(slice15): add WorkspaceTabContext — TopTab type + provider + hook"
```

---

### Task 2: Update `use-task-row-handlers.ts` — remove setter args, read contexts

**Files:**
- Modify: `src/app/use-task-row-handlers.ts`
- Modify: `src/app/use-task-row-handlers.test.ts`

- [ ] **Step 1: Update the test — add context mock, remove setter args**

Replace the entire content of `src/app/use-task-row-handlers.test.ts`:

```ts
// src/app/use-task-row-handlers.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTaskRowHandlers } from "./use-task-row-handlers";
import type { Task } from "./types";

vi.mock("./workspace-tab-context", () => ({
  useWorkspaceTab: vi.fn(() => ({
    activeTab: "chat" as const,
    setActiveTab: vi.fn(),
    isPopout: false,
  })),
}));

vi.mock("./use-workspace-collapsed", () => ({
  useWorkspaceCollapsed: vi.fn(() => ({
    workspaceCollapsed: false,
    setWorkspaceCollapsed: vi.fn(),
  })),
}));

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
    } as unknown as Parameters<typeof useTaskRowHandlers>[0]["settings"],
    lang: "en-US" as const,
    today: "2030-01-01",
    editingId: null,
    showToast: vi.fn() as (kind: "info" | "error", text: string) => void,
    openEditModal: vi.fn() as (task: Task) => void,
    setTasks: vi.fn() as Parameters<typeof useTaskRowHandlers>[0]["setTasks"],
    setRaidFilterTaskId: vi.fn() as Parameters<
      typeof useTaskRowHandlers
    >[0]["setRaidFilterTaskId"],
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-task-row-handlers.test.ts`
Expected: FAIL — type errors or runtime errors (setActiveTab still referenced in interface)

- [ ] **Step 3: Update `use-task-row-handlers.ts`**

Replace the entire file:

```ts
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
import { useWorkspaceTab } from "./workspace-tab-context";
import { useWorkspaceCollapsed } from "./use-workspace-collapsed";

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
    deselectIdRef,
    handleCancelEdit,
    logActivity,
  } = args;

  const { setActiveTab } = useWorkspaceTab();
  const { setWorkspaceCollapsed } = useWorkspaceCollapsed();

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/use-task-row-handlers.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Run tsc to confirm no type errors**

Run: `npx tsc --noEmit`
Expected: 0 new errors (1 pre-existing error in `use-due-alerts.test.ts` is unrelated)

- [ ] **Step 6: Commit**

```bash
git add src/app/use-task-row-handlers.ts src/app/use-task-row-handlers.test.ts
git commit -m "refactor(slice15): useTaskRowHandlers reads activeTab+collapsed from context"
```

---

### Task 3: Create `app-header.tsx` + 2 smoke tests

**Files:**
- Create: `src/app/app-header.tsx`
- Create: `src/app/app-header.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/app/app-header.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { WorkspaceProvider } from "./workspace-context";
import { AppHeader } from "./app-header";
import type { AppHeaderProps } from "./app-header";

vi.mock("./use-settings", () => ({
  useSettings: vi.fn(() => ({
    settings: {
      lang: "en-US",
      jira: { enabled: false, siteUrl: "", email: "", apiToken: "", projectKey: "", issueTypes: [] },
      ai: { consentAccepted: false, provider: "none" },
      notifications: { banner: { enabled: false, thresholdWorkDays: 3 }, popup: { enabled: false, thresholdWorkDays: 3 } },
      holidayCountries: [],
    },
    setSettings: vi.fn(),
    hydrated: true,
    i18nReady: true,
    lang: "en-US" as const,
  })),
}));

function makeProps(overrides: Partial<AppHeaderProps> = {}): AppHeaderProps {
  return {
    handleCancelEdit: vi.fn(),
    setTaskModalOpen: vi.fn(),
    bannerItems: [],
    setBannerDismissed: vi.fn(),
    setDueModalOpen: vi.fn(),
    showToast: vi.fn(),
    handleCommand: vi.fn(),
    storageDescription: "",
    storageReady: true,
    onPickStorageFile: vi.fn(),
    onOpenStorageFile: vi.fn(),
    onGrantStorageWrite: vi.fn(),
    ...overrides,
  };
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
    </WorkspaceProvider>
  );
}

describe("AppHeader", () => {
  it("renders the app title heading", () => {
    render(<AppHeader {...makeProps()} />, { wrapper: Wrapper });
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("bell badge shows count when bannerItems has entries", () => {
    const items = [
      { taskId: 1, taskName: "Task A", daysUntilDue: 1 },
      { taskId: 2, taskName: "Task B", daysUntilDue: 2 },
    ];
    render(<AppHeader {...makeProps({ bannerItems: items })} />, { wrapper: Wrapper });
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/app-header.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write `app-header.tsx`**

Copy the `<header>` block verbatim from `task-manager.tsx` lines 488–576 into the new component. The component reads `useSettings()` and `useWorkspace()` internally.

```tsx
// src/app/app-header.tsx
"use client";
import dynamic from "next/dynamic";
import type React from "react";
import { t } from "./i18n";
import { ExportMenu } from "./export-menu";
import { HelpMenu } from "./help-menu";
import { VersionMenu } from "./version-menu";
import { type Settings, SettingsMenu } from "./settings-menu";
import { useSettings } from "./use-settings";
import { useWorkspace } from "./workspace-context";

const VoiceCommandButton = dynamic(
  () => import("./voice-button").then((m) => m.VoiceCommandButton),
  { ssr: false },
);

export interface AppHeaderProps {
  handleCancelEdit: () => void;
  setTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  bannerItems: { taskId: number; taskName: string; daysUntilDue: number }[];
  setBannerDismissed: React.Dispatch<React.SetStateAction<boolean>>;
  setDueModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showToast: (kind: "success" | "error", text: string) => void;
  handleCommand: (cmd: string) => void;
  storageDescription: string;
  storageReady: boolean;
  onPickStorageFile: () => void;
  onOpenStorageFile: () => void;
  onGrantStorageWrite: () => void;
}

export function AppHeader({
  handleCancelEdit,
  setTaskModalOpen,
  bannerItems,
  setBannerDismissed,
  setDueModalOpen,
  showToast,
  handleCommand,
  storageDescription,
  storageReady,
  onPickStorageFile,
  onOpenStorageFile,
  onGrantStorageWrite,
}: AppHeaderProps) {
  const { settings, setSettings, lang } = useSettings();
  const { tasks, raid, absences, shifts } = useWorkspace();

  return (
    <header className="mb-8 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "appTitle")}
        </h1>
        <p className="mt-1 text-sm text-AIPM-dark-grey dark:text-AIPM-medium-grey">
          {t(lang, "appSubtitle")}
        </p>
      </div>
      <div className="flex flex-col items-end gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/AIPM-logo.svg"
          alt="Acme"
          className="h-7 w-auto"
        />
        <div className="flex items-center gap-1">
          <VoiceCommandButton
            lang={lang}
            onCommand={handleCommand}
            onError={(msg) => showToast("error", msg)}
          />
          <button
            type="button"
            onClick={() => {
              handleCancelEdit();
              setTaskModalOpen(true);
            }}
            aria-label={t(lang, "addTaskButton")}
            title={t(lang, "addTaskButton")}
            className="rounded-md p-2 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className="h-5 w-5"
            >
              <path
                fillRule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => {
              setBannerDismissed(false);
              setDueModalOpen(true);
            }}
            aria-label={t(lang, "showDueAlerts")}
            title={t(lang, "showDueAlerts")}
            className="relative rounded-md p-2 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className="h-5 w-5"
            >
              <path d="M10 2a6 6 0 00-6 6v2.586l-.707.707A1 1 0 004 13h12a1 1 0 00.707-1.707L16 10.586V8a6 6 0 00-6-6zM8 15a2 2 0 104 0H8z" />
            </svg>
            {bannerItems.length > 0 && (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-AIPM-pink px-1 text-[10px] font-semibold leading-none text-white"
              >
                {bannerItems.length}
              </span>
            )}
          </button>
          <ExportMenu lang={lang} tasks={tasks} raid={raid} absences={absences} shifts={shifts} />
          <HelpMenu lang={lang} />
          <VersionMenu lang={lang} />
          <SettingsMenu
            settings={settings}
            onChange={setSettings}
            storageDescription={storageDescription}
            storageReady={storageReady}
            onPickStorageFile={onPickStorageFile}
            onOpenStorageFile={onOpenStorageFile}
            onGrantStorageWrite={onGrantStorageWrite}
          />
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/app-header.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/app-header.tsx src/app/app-header.test.tsx
git commit -m "feat(slice15): extract AppHeader component from task-manager.tsx"
```

---

### Task 4: Create `workspace-section.tsx` + 3 smoke tests

**Files:**
- Create: `src/app/workspace-section.tsx`
- Create: `src/app/workspace-section.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/app/workspace-section.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { FiltersProvider } from "./filters-context";
import { WorkspaceSection } from "./workspace-section";
import type { WorkspaceSectionProps } from "./workspace-section";
import { createRef } from "react";
import type { ToolDispatcher } from "./chat-tools";
import type { ActivityEntry } from "./activity-log";
import type { Absence, Shift } from "./types";

vi.mock("./use-settings", () => ({
  useSettings: vi.fn(() => ({
    settings: {
      lang: "en-US",
      ai: { consentAccepted: false, provider: "none" },
      jira: { enabled: false, siteUrl: "", email: "", apiToken: "", projectKey: "", issueTypes: [] },
      notifications: { banner: { enabled: false, thresholdWorkDays: 3 }, popup: { enabled: false, thresholdWorkDays: 3 } },
      holidayCountries: [],
    },
    setSettings: vi.fn(),
    hydrated: true,
    i18nReady: true,
    lang: "en-US" as const,
  })),
}));

vi.mock("./chat-panel", () => ({ ChatPanel: () => <div data-testid="chat-panel" /> }));
vi.mock("./reports", () => ({ ReportsPanel: () => <div data-testid="reports-panel" /> }));
vi.mock("./gantt", () => ({ GanttPanel: () => <div data-testid="gantt-panel" /> }));
vi.mock("./raid-panel", () => ({ RaidPanel: () => <div data-testid="raid-panel" /> }));
vi.mock("./resources-panel", () => ({ ResourcesPanel: () => <div data-testid="resources-panel" /> }));
vi.mock("./activity-log-panel", () => ({ ActivityLogPanel: () => <div data-testid="activity-panel" /> }));

function makeProps(overrides: Partial<WorkspaceSectionProps> = {}): WorkspaceSectionProps {
  return {
    today: "2030-01-01",
    holidaySet: new Set<string>(),
    workspaceRef: createRef<HTMLElement | null>(),
    resetWorkspaceSize: vi.fn(),
    dispatcher: {} as ToolDispatcher,
    handleAcceptAiConsent: vi.fn(),
    handleGanttBarUpdate: vi.fn(),
    handleCancelEdit: vi.fn(),
    setTaskModalOpen: vi.fn(),
    handleClearRaidTaskFilter: vi.fn(),
    handleSaveRaidItem: vi.fn(),
    handleDeleteRaidItem: vi.fn(),
    handleCreateMitigationTaskFromRaid: vi.fn(),
    handleJumpToTaskFromRaid: vi.fn(),
    activityLog: [] as ActivityEntry[],
    handleClearActivityLog: vi.fn(),
    handleOpenAddAbsence: vi.fn(),
    handleEditAbsence: vi.fn() as (absence: Absence) => void,
    handleOpenShiftEditor: vi.fn() as (shift: Shift) => void,
    ...overrides,
  };
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

describe("WorkspaceSection", () => {
  it("section element renders in the DOM", () => {
    render(<WorkspaceSection {...makeProps()} />, { wrapper: Wrapper });
    expect(document.querySelector("section")).toBeInTheDocument();
  });

  it("chat panel is visible by default (no hidden attr)", () => {
    render(<WorkspaceSection {...makeProps()} />, { wrapper: Wrapper });
    const panelChat = document.getElementById("panel-chat");
    expect(panelChat).not.toBeNull();
    expect(panelChat).not.toHaveAttribute("hidden");
  });

  it("raid panel has hidden attr when activeTab is 'chat'", () => {
    render(<WorkspaceSection {...makeProps()} />, { wrapper: Wrapper });
    const panelRaid = document.getElementById("panel-raid");
    expect(panelRaid).not.toBeNull();
    expect(panelRaid).toHaveAttribute("hidden");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/workspace-section.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write `workspace-section.tsx`**

Copy the `<section>` block verbatim from `task-manager.tsx` lines 605–854 into the new component. The component reads `useSettings()`, `useWorkspace()`, `useWorkspaceCollapsed()`, `useWorkspaceTab()`, `useFilters()` internally; all dynamic panel imports live here.

```tsx
// src/app/workspace-section.tsx
"use client";
import dynamic from "next/dynamic";
import type React from "react";
import { t } from "./i18n";
import { openPopoutWindow } from "./broadcast-sync";
import { useSettings } from "./use-settings";
import { useWorkspace } from "./workspace-context";
import { useWorkspaceCollapsed } from "./use-workspace-collapsed";
import { useWorkspaceTab } from "./workspace-tab-context";
import { useFilters } from "./filters-context";
import { TabButton, ResetSizeIcon } from "./task-manager-ui";
import type { ToolDispatcher } from "./chat-tools";
import type { ActivityEntry } from "./activity-log";
import type { Absence, RaidItem, Shift } from "./types";

const ChatPanel = dynamic(
  () => import("./chat-panel").then((m) => m.ChatPanel),
  { ssr: false },
);
const GanttPanel = dynamic(
  () => import("./gantt").then((m) => m.GanttPanel),
  { ssr: false },
);
const ReportsPanel = dynamic(
  () => import("./reports").then((m) => m.ReportsPanel),
  { ssr: false },
);
const RaidPanel = dynamic(
  () => import("./raid-panel").then((m) => m.RaidPanel),
  { ssr: false },
);
const ResourcesPanel = dynamic(
  () => import("./resources-panel").then((m) => m.ResourcesPanel),
  { ssr: false },
);
const ActivityLogPanel = dynamic(
  () => import("./activity-log-panel").then((m) => m.ActivityLogPanel),
  { ssr: false },
);

export interface WorkspaceSectionProps {
  today: string;
  holidaySet: Set<string>;
  workspaceRef: React.RefObject<HTMLElement | null>;
  resetWorkspaceSize: () => void;
  dispatcher: ToolDispatcher;
  handleAcceptAiConsent: () => void;
  handleGanttBarUpdate: (edit: { taskId: number; startDate: string; dueDate: string }) => void;
  handleCancelEdit: () => void;
  setTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleClearRaidTaskFilter: () => void;
  handleSaveRaidItem: (item: RaidItem) => void;
  handleDeleteRaidItem: (id: number) => void;
  handleCreateMitigationTaskFromRaid: (raidId: number) => void;
  handleJumpToTaskFromRaid: (taskId: number) => void;
  activityLog: ActivityEntry[];
  handleClearActivityLog: () => void;
  handleOpenAddAbsence: () => void;
  handleEditAbsence: (absence: Absence) => void;
  handleOpenShiftEditor: (shift: Shift) => void;
}

export function WorkspaceSection({
  today,
  holidaySet,
  workspaceRef,
  resetWorkspaceSize,
  dispatcher,
  handleAcceptAiConsent,
  handleGanttBarUpdate,
  handleCancelEdit,
  setTaskModalOpen,
  handleClearRaidTaskFilter,
  handleSaveRaidItem,
  handleDeleteRaidItem,
  handleCreateMitigationTaskFromRaid,
  handleJumpToTaskFromRaid,
  activityLog,
  handleClearActivityLog,
  handleOpenAddAbsence,
  handleEditAbsence,
  handleOpenShiftEditor,
}: WorkspaceSectionProps) {
  const { settings, lang } = useSettings();
  const { tasks, absences, shifts } = useWorkspace();
  const { workspaceCollapsed, setWorkspaceCollapsed } = useWorkspaceCollapsed();
  const { activeTab, setActiveTab, isPopout } = useWorkspaceTab();
  const { raidFilterTaskId } = useFilters();

  return (
    <section
      ref={workspaceRef}
      title={
        isPopout || workspaceCollapsed
          ? undefined
          : t(lang, "workspaceResizeHint")
      }
      className={
        isPopout
          ? "flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
          : workspaceCollapsed
          ? "mb-10 flex w-full flex-col rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
          : "mb-10 flex h-[560px] min-h-[420px] w-full min-w-[520px] resize flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      }
    >
      {!isPopout && (
      <div
        role="tablist"
        aria-label="Workspace tabs"
        className={
          workspaceCollapsed
            ? "-mx-2 -mt-2 flex shrink-0 items-end gap-1 px-2"
            : "-mx-2 -mt-2 flex shrink-0 items-end gap-1 border-b border-zinc-200 px-2 dark:border-zinc-800"
        }
      >
        <TabButton
          active={activeTab === "chat"}
          onClick={() => {
            setActiveTab("chat");
            if (workspaceCollapsed) setWorkspaceCollapsed(false);
          }}
          controls="panel-chat"
          onPopout={() => openPopoutWindow("chat")}
          popoutLabel={t(lang, "popoutOpenInNewWindow")}
        >
          {t(lang, "tabChat")}
        </TabButton>
        <TabButton
          active={activeTab === "reports"}
          onClick={() => {
            setActiveTab("reports");
            if (workspaceCollapsed) setWorkspaceCollapsed(false);
          }}
          controls="panel-reports"
          onPopout={() => openPopoutWindow("reports")}
          popoutLabel={t(lang, "popoutOpenInNewWindow")}
        >
          {t(lang, "tabReports")}
        </TabButton>
        <TabButton
          active={activeTab === "gantt"}
          onClick={() => {
            setActiveTab("gantt");
            if (workspaceCollapsed) setWorkspaceCollapsed(false);
          }}
          controls="panel-gantt"
          onPopout={() => openPopoutWindow("gantt")}
          popoutLabel={t(lang, "popoutOpenInNewWindow")}
        >
          {t(lang, "tabGantt")}
        </TabButton>
        <TabButton
          active={activeTab === "raid"}
          onClick={() => {
            setActiveTab("raid");
            setWorkspaceCollapsed(false);
            if (workspaceCollapsed) setWorkspaceCollapsed(false);
          }}
          controls="panel-raid"
          onPopout={() => openPopoutWindow("raid")}
          popoutLabel={t(lang, "popoutOpenInNewWindow")}
        >
          {t(lang, "tabRaid")}
        </TabButton>
        <TabButton
          active={activeTab === "resources"}
          onClick={() => {
            setActiveTab("resources");
            if (workspaceCollapsed) setWorkspaceCollapsed(false);
          }}
          controls="panel-resources"
          onPopout={() => openPopoutWindow("resources")}
          popoutLabel={t(lang, "popoutOpenInNewWindow")}
        >
          {t(lang, "tabResources")}
        </TabButton>
        <TabButton
          active={activeTab === "activity"}
          onClick={() => {
            setActiveTab("activity");
            if (workspaceCollapsed) setWorkspaceCollapsed(false);
          }}
          controls="panel-activity"
          onPopout={() => openPopoutWindow("activity")}
          popoutLabel={t(lang, "popoutOpenInNewWindow")}
        >
          {t(lang, "tabActivity")}
        </TabButton>
        {!workspaceCollapsed && (
          <button
            type="button"
            onClick={resetWorkspaceSize}
            aria-label={t(lang, "tableResetSizeHint")}
            title={t(lang, "tableResetSizeHint")}
            className="ml-auto mb-1 rounded-md border border-zinc-300 bg-white p-1.5 text-zinc-500 shadow-sm hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <ResetSizeIcon />
          </button>
        )}
        <button
          type="button"
          onClick={() => setWorkspaceCollapsed((v) => !v)}
          aria-expanded={!workspaceCollapsed}
          aria-controls="workspace-panels"
          title={
            workspaceCollapsed
              ? t(lang, "workspaceExpand")
              : t(lang, "workspaceCollapse")
          }
          className={
            workspaceCollapsed
              ? "ml-auto mb-1 rounded-md p-1.5 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
              : "mb-1 rounded-md p-1.5 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
          }
        >
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
            className={`h-4 w-4 transition-transform ${workspaceCollapsed ? "rotate-180" : ""}`}
          >
            <path
              fillRule="evenodd"
              d="M14.78 12.78a.75.75 0 01-1.06 0L10 9.06l-3.72 3.72a.75.75 0 11-1.06-1.06l4.25-4.25a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
      )}

      <div
        id="workspace-panels"
        hidden={!isPopout && workspaceCollapsed}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          id="panel-chat"
          role="tabpanel"
          hidden={activeTab !== "chat"}
          className="min-h-0 flex-1 pt-4"
        >
          <ChatPanel
            lang={lang}
            ai={settings.ai}
            dispatcher={dispatcher}
            onAcceptConsent={handleAcceptAiConsent}
          />
        </div>

        {activeTab === "reports" && (
          <div
            id="panel-reports"
            role="tabpanel"
            className="min-h-0 flex-1 overflow-y-auto pt-4"
          >
            <ReportsPanel
              tasks={tasks}
              today={today}
              holidaySet={holidaySet}
              lang={lang}
            />
          </div>
        )}

        {activeTab === "gantt" && (
          <div
            id="panel-gantt"
            role="tabpanel"
            className="min-h-0 flex-1 pt-4"
          >
            <GanttPanel
              lang={lang}
              tasks={tasks}
              absences={absences}
              onUpdateBar={handleGanttBarUpdate}
              onAddTask={() => {
                handleCancelEdit();
                setTaskModalOpen(true);
              }}
            />
          </div>
        )}

        <div
          id="panel-raid"
          role="tabpanel"
          hidden={activeTab !== "raid"}
          className="min-h-0 flex-1 pt-4"
        >
          <RaidPanel
            lang={lang}
            tasks={tasks}
            raid={[]}
            today={today}
            filterTaskId={raidFilterTaskId}
            onClearTaskFilter={handleClearRaidTaskFilter}
            onSave={handleSaveRaidItem}
            onDelete={handleDeleteRaidItem}
            onCreateMitigationTask={handleCreateMitigationTaskFromRaid}
            onJumpToTask={handleJumpToTaskFromRaid}
          />
        </div>

        {activeTab === "resources" && (
          <div
            id="panel-resources"
            role="tabpanel"
            className="min-h-0 flex-1 pt-4"
          >
            <ResourcesPanel
              lang={lang}
              tasks={tasks}
              absences={absences}
              shifts={shifts}
              today={today}
              holidaySet={holidaySet}
              onAddAbsence={handleOpenAddAbsence}
              onEditAbsence={handleEditAbsence}
              onEditShift={handleOpenShiftEditor}
            />
          </div>
        )}

        {activeTab === "activity" && (
          <div
            id="panel-activity"
            role="tabpanel"
            className="min-h-0 flex-1 pt-4"
          >
            <ActivityLogPanel
              lang={lang}
              entries={activityLog}
              onClear={handleClearActivityLog}
            />
          </div>
        )}
      </div>
    </section>
  );
}
```

**Note:** `RaidPanel` above passes `raid={[]}` as a stub — replace with `raid` from `useWorkspace()`. Add `raid` to the destructuring of `useWorkspace()` (it's already available alongside `tasks`, `absences`, `shifts`).

Correct `useWorkspace()` destructuring:
```ts
const { tasks, raid, absences, shifts } = useWorkspace();
```

And pass `raid={raid}` to `RaidPanel`.

Also remove the duplicate `setWorkspaceCollapsed(false)` on the RAID tab button — the original in task-manager.tsx does `setRaidFilterTaskId(null)` not a second `setWorkspaceCollapsed`. Correct RAID tab onClick:
```tsx
onClick={() => {
  setActiveTab("raid");
  setWorkspaceCollapsed(false);
  if (workspaceCollapsed) setWorkspaceCollapsed(false);
}}
```
Should be:
```tsx
onClick={() => {
  setActiveTab("raid");
  if (workspaceCollapsed) setWorkspaceCollapsed(false);
}}
```
(The `setRaidFilterTaskId(null)` call is NOT in the tab button — it's only in `handleClearRaidTaskFilter`. Match task-manager.tsx exactly.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/workspace-section.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace-section.tsx src/app/workspace-section.test.tsx
git commit -m "feat(slice15): extract WorkspaceSection component from task-manager.tsx"
```

---

### Task 5: Refactor `task-manager.tsx`

**Files:**
- Modify: `src/app/task-manager.tsx`

- [ ] **Step 1: Add new imports**

After the existing imports, add:
```ts
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { AppHeader } from "./app-header";
import { WorkspaceSection } from "./workspace-section";
```

- [ ] **Step 2: Remove stale imports**

Remove from `task-manager.tsx`:
- Dynamic import of `ChatPanel` (lines 44–47) — moves to `workspace-section.tsx`
- Dynamic import of `GanttPanel` (lines 48–51) — moves to `workspace-section.tsx`
- Dynamic import of `ReportsPanel` (lines 52–55) — moves to `workspace-section.tsx`
- Dynamic import of `RaidPanel` (lines 56–59) — moves to `workspace-section.tsx`
- Dynamic import of `ResourcesPanel` (lines 60–63) — moves to `workspace-section.tsx`
- Dynamic import of `ActivityLogPanel` (lines 64–67) — moves to `workspace-section.tsx`
- Dynamic import of `VoiceCommandButton` (lines 119–122) — moves to `app-header.tsx`
- `import { ExportMenu }` — moves to `app-header.tsx`
- `import { HelpMenu }` — moves to `app-header.tsx`
- `import { VersionMenu }` — moves to `app-header.tsx`
- `import { type Settings, SettingsMenu }` — moves to `app-header.tsx`
- `import type { Command }` from `./voice` — moves to `app-header.tsx`
- `openPopoutWindow`, `type PopoutTab`, `readPopoutTabFromUrl` from `./broadcast-sync` — moves to `workspace-section.tsx` / `workspace-tab-context.tsx`
- `import { TabButton, ResetSizeIcon }` from `./task-manager-ui` — moves to `workspace-section.tsx`

Keep: `FiltersProvider`, `WorkspaceProvider`, `TaskFormProvider`, `useFilters`, `useWorkspace`, `useTaskForm`, `TaskFormModal`, `TasksSection`, `DueBanner`, `DueDatesModal`, and all hook imports still used in `TaskManagerInner`.

- [ ] **Step 3: Remove `TopTab` and `TAB_LABEL_KEYS` from `task-manager.tsx`**

Remove lines 159–170:
```ts
export type TopTab = "chat" | "reports" | "gantt" | "raid" | "resources" | "activity";

const TAB_LABEL_KEYS: Record<TopTab, TranslationKey> = {
  chat: "tabChat",
  reports: "tabReports",
  gantt: "tabGantt",
  raid: "tabRaid",
  resources: "tabResources",
  activity: "tabActivity",
};
```

- [ ] **Step 4: Remove popout/tab state from `TaskManagerInner`, add `useWorkspaceTab()`**

Remove lines 201–203:
```ts
const [popoutTab] = useState<PopoutTab | null>(() => readPopoutTabFromUrl());
const isPopout = popoutTab !== null;
const [activeTab, setActiveTab] = useState<TopTab>(popoutTab ?? "chat");
```

Add after the existing context hook calls (e.g., after `useWorkspaceCollapsed()`):
```ts
const { isPopout } = useWorkspaceTab();
```

- [ ] **Step 5: Remove `setActiveTab`/`setWorkspaceCollapsed` from `useTaskRowHandlers` call**

Change (lines 358–373):
```ts
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
  setActiveTab,        // ← remove
  setWorkspaceCollapsed, // ← remove
  deselectIdRef,
  handleCancelEdit,
  logActivity,
});
```

To:
```ts
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
  deselectIdRef,
  handleCancelEdit,
  logActivity,
});
```

- [ ] **Step 6: Remove the `useEffect` for popout title**

Remove the `useEffect` that sets `document.title` when `isPopout` — it references `popoutTab` and `TAB_LABEL_KEYS` which are now gone. This effect moves to `WorkspaceTabProvider` or can be removed (popout title is set by the provider via `popoutTab` state which is now encapsulated).

Actually, looking at the code: the `useEffect` at lines 266–269 uses `popoutTab` and `TAB_LABEL_KEYS`. Since both are gone from this file, remove this `useEffect` entirely. The popout title setting needs to move to `workspace-tab-context.tsx` or `workspace-section.tsx`. The simplest approach: add a `useEffect` in `WorkspaceTabProvider` to set the document title:

```tsx
// In WorkspaceTabProvider, add after state declarations:
useEffect(() => {
  if (!isPopout || !popoutTab) return;
  document.title = `${t(lang, TAB_LABEL_KEYS[popoutTab])} — ${t(lang, "appTitle")}`;
}, [isPopout, popoutTab, lang]);
```

Wait — `WorkspaceTabProvider` doesn't have access to `lang` or `t`. The simplest fix is to keep this effect in `TaskManagerInner` but source `popoutTab` from `WorkspaceTabContext`. However, `WorkspaceTabContext` doesn't expose `popoutTab` directly (only `activeTab` and `isPopout`).

The cleanest solution: expose `popoutTab` from the context, or move the title effect into `WorkspaceSection` which reads `useWorkspaceTab()`.

**Recommended:** Just remove the `useEffect` for now — the popout title was a nice-to-have. If needed, it can be added back in `WorkspaceSection` using `useEffect` + `useWorkspaceTab()` + `useSettings()`.

- [ ] **Step 7: Replace the `<header>` block with `<AppHeader>`**

Replace lines 487–577:
```tsx
{!isPopout && (
<header className="mb-8 flex items-start justify-between gap-4">
  ...
</header>
)}
```

With:
```tsx
{!isPopout && (
  <AppHeader
    handleCancelEdit={handleCancelEdit}
    setTaskModalOpen={setTaskModalOpen}
    bannerItems={bannerItems}
    setBannerDismissed={setBannerDismissed}
    setDueModalOpen={setDueModalOpen}
    showToast={showToast}
    handleCommand={handleCommand}
    storageDescription={storageDescription}
    storageReady={storageReady}
    onPickStorageFile={onPickStorageFile}
    onOpenStorageFile={onOpenStorageFile}
    onGrantStorageWrite={onGrantWriteAccess}
  />
)}
```

- [ ] **Step 8: Replace the `<section>` block with `<WorkspaceSection>`**

Replace lines 605–854 with:
```tsx
<WorkspaceSection
  today={today}
  holidaySet={holidaySet}
  workspaceRef={workspaceRef}
  resetWorkspaceSize={resetWorkspaceSize}
  dispatcher={dispatcher}
  handleAcceptAiConsent={handleAcceptAiConsent}
  handleGanttBarUpdate={handleGanttBarUpdate}
  handleCancelEdit={handleCancelEdit}
  setTaskModalOpen={setTaskModalOpen}
  handleClearRaidTaskFilter={handleClearRaidTaskFilter}
  handleSaveRaidItem={handleSaveRaidItem}
  handleDeleteRaidItem={handleDeleteRaidItem}
  handleCreateMitigationTaskFromRaid={handleCreateMitigationTaskFromRaid}
  handleJumpToTaskFromRaid={handleJumpToTaskFromRaid}
  activityLog={activityLog}
  handleClearActivityLog={handleClearActivityLog}
  handleOpenAddAbsence={handleOpenAddAbsence}
  handleEditAbsence={handleEditAbsence}
  handleOpenShiftEditor={handleOpenShiftEditor}
/>
```

- [ ] **Step 9: Update provider nesting in the default export**

Change:
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

To:
```tsx
export default function TaskManager() {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <TaskFormProvider>
          <WorkspaceTabProvider>
            <TaskManagerInner />
          </WorkspaceTabProvider>
        </TaskFormProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}
```

- [ ] **Step 10: Run tsc to confirm no type errors**

Run: `npx tsc --noEmit`
Expected: 0 new errors

- [ ] **Step 11: Run full test suite**

Run: `npx vitest run`
Expected: 192+ tests pass, 0 failures

- [ ] **Step 12: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "refactor(slice15): replace header+workspace JSX with AppHeader+WorkspaceSection"
```

---

### Task 6: Version bump v0.8.3 "Kafka" + CHANGELOG

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update `version.ts`**

Current content:
```ts
export const APP_VERSION = "0.8.2";
export const APP_BUILD_DATE = "2026-05-21";
```

Change to:
```ts
export const APP_VERSION = "0.8.3";
export const APP_BUILD_DATE = "2026-05-22";
```

- [ ] **Step 2: Prepend CHANGELOG entry**

Add at the top of `CHANGELOG.md` (before the `## [0.8.2]` line):
```markdown
## [0.8.3] "Kafka" — 2026-05-22

### Refactored
- Extract `WorkspaceTabContext` — `TopTab` type, `WorkspaceTabProvider`, `useWorkspaceTab` hook
- Extract `AppHeader` component (~90 lines) from `task-manager.tsx`
- Extract `WorkspaceSection` component (~250 lines) from `task-manager.tsx`
- `useTaskRowHandlers` reads `activeTab`/`setWorkspaceCollapsed` from context instead of props
- `task-manager.tsx` reduced from ~1,038 to ~698 lines (−340 lines)
```

- [ ] **Step 3: Run final test suite**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "release(v0.8.3): Kafka - WorkspaceTabContext + AppHeader + WorkspaceSection extraction"
```
