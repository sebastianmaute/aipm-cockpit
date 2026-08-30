// src/app/use-task-row-handlers.test.ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useRef, useState } from "react";
import { useTaskRowHandlers } from "./use-task-row-handlers";
import { loadJiraApi } from "./use-jira-sync";
import { useUndoStack } from "./undo/use-undo-stack";
import type { Task, Resource } from "./types";

vi.mock("./workspace-tab-context", () => ({
  useWorkspaceTab: vi.fn(() => ({
    activeTab: "chat" as const,
    setActiveTab: vi.fn(),
    isPopout: false,
  })),
}));

vi.mock("./use-jira-sync", () => ({ loadJiraApi: vi.fn() }));

/** A mutable Settings.jira that satisfies onPushToJira's prerequisites. */
function jiraEnabled() {
  return {
    enabled: true,
    siteUrl: "https://x.atlassian.net",
    email: "a@b.c",
    apiToken: "tok",
    projectKey: "LOP",
    issueTypes: ["Task"],
  } as unknown as Parameters<typeof useTaskRowHandlers>[0]["settings"]["jira"];
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Test task",
    assignee: "Alice",
    assigneeEmail: "alice@example.com",
    dueDate: "2030-12-31",
    lastUpdateDate: "2030-01-01",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "",
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
    setWorkspaceCollapsed: vi.fn() as Parameters<
      typeof useTaskRowHandlers
    >[0]["setWorkspaceCollapsed"],
    deselectIdRef: { current: vi.fn() as (id: number) => void },
    handleCancelEdit: vi.fn(),
    logActivity: vi.fn() as Parameters<
      typeof useTaskRowHandlers
    >[0]["logActivity"],
    capture: vi.fn() as Parameters<typeof useTaskRowHandlers>[0]["capture"],
    ...overrides,
  };
}

describe("useTaskRowHandlers", () => {
  it("returns empty pushingIds initially", () => {
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs()));
    expect(result.current.pushingIds.size).toBe(0);
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

  it("onStatusChange no-ops for a Jira-synced task", () => {
    const setTasks = vi.fn();
    const synced = makeTask({ id: 1, jiraKey: "LOP-1", status: "In Progress" });
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ setTasks })),
    );
    act(() => result.current.onStatusChange(1, "Done"));
    // The produced list leaves the synced row's status unchanged.
    const updater = setTasks.mock.calls[0][0] as (p: Task[]) => Task[];
    expect(updater([synced])[0].status).toBe("In Progress");
  });

  it("onStatusChange updates a non-synced task (gate is conditional)", () => {
    const setTasks = vi.fn();
    const open = makeTask({ id: 1, status: "To Do" });
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ setTasks })),
    );
    act(() => result.current.onStatusChange(1, "In Progress"));
    const updater = setTasks.mock.calls[0][0] as (p: Task[]) => Task[];
    expect(updater([open])[0].status).toBe("In Progress");
  });

  it("captures a field-edit undo entry for a status change (status + completedDate)", () => {
    const captureFieldEdit = vi.fn();
    const setTasks = vi.fn();
    const tasksRef = { current: [makeTask({ id: 1, status: "To Do", completedDate: undefined })] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, setTasks, captureFieldEdit })),
    );
    act(() => result.current.onStatusChange(1, "Done"));
    expect(captureFieldEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "task.updated",
        id: 1,
        before: { status: "To Do", completedDate: undefined },
      }),
    );
    const opts = captureFieldEdit.mock.calls[0][0] as {
      after: { status: string; completedDate: string };
    };
    expect(opts.after.status).toBe("Done");
    expect(opts.after.completedDate).toBeTruthy();
  });

  it("does not capture a field-edit undo entry for a Jira-synced task's status", () => {
    const captureFieldEdit = vi.fn();
    const setTasks = vi.fn();
    const tasksRef = { current: [makeTask({ id: 1, jiraKey: "LOP-1", status: "In Progress" })] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, setTasks, captureFieldEdit })),
    );
    act(() => result.current.onStatusChange(1, "Done"));
    expect(captureFieldEdit).not.toHaveBeenCalled();
  });

  it("does not capture a field-edit undo entry when the status is unchanged (no-op)", () => {
    const captureFieldEdit = vi.fn();
    const setTasks = vi.fn();
    const tasksRef = { current: [makeTask({ id: 1, status: "To Do" })] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, setTasks, captureFieldEdit })),
    );
    act(() => result.current.onStatusChange(1, "To Do"));
    expect(captureFieldEdit).not.toHaveBeenCalled();
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

describe("useTaskRowHandlers — onSwimlaneDrop", () => {
  /** Applies the (sole) updater passed to a mocked setTasks against `tasks`.
   *  When setTasks was never called (a refused/no-op drop), returns `tasks`
   *  unchanged — mirrors "nothing was written". */
  function applyUpdater(setTasksMock: ReturnType<typeof vi.fn>, tasks: Task[]): Task[] {
    if (setTasksMock.mock.calls.length === 0) return tasks;
    const updater = setTasksMock.mock.calls[0][0] as (p: Task[]) => Task[];
    return updater(tasks);
  }

  it("a swimlane drop writes assignment and status in one update", () => {
    const setTasks = vi.fn();
    const captureFieldEdit = vi.fn();
    const tasks = [makeTask({ id: 1, status: "To Do", assignee: "", resourceId: undefined })];
    const tasksRef = { current: tasks };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, setTasks, captureFieldEdit })),
    );
    act(() =>
      result.current.onSwimlaneDrop(
        1,
        { key: "res:7", label: "Anna Jordan", resourceId: 7 },
        "In Progress",
      ),
    );
    expect(setTasks).toHaveBeenCalledTimes(1);
    const next = applyUpdater(setTasks, tasks);
    expect(next[0]).toMatchObject({ resourceId: 7, assignee: "Anna Jordan", status: "In Progress" });
    // One undo entry captures all four changed fields.
    expect(captureFieldEdit).toHaveBeenCalledTimes(1);
    const opts = captureFieldEdit.mock.calls[0][0] as {
      before: Partial<Task>;
      after: Partial<Task>;
    };
    expect(opts.before).toMatchObject({ assignee: "", resourceId: undefined, status: "To Do" });
    expect(opts.after).toMatchObject({ assignee: "Anna Jordan", resourceId: 7, status: "In Progress" });
  });

  it("dropping into Unassigned clears both the link and the name", () => {
    const setTasks = vi.fn();
    const tasks = [makeTask({ id: 1, status: "To Do", assignee: "Anna Jordan", resourceId: 7 })];
    const tasksRef = { current: tasks };
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ tasksRef, setTasks })));
    act(() =>
      result.current.onSwimlaneDrop(1, { key: "unassigned", label: "", resourceId: null }, "To Do"),
    );
    const next = applyUpdater(setTasks, tasks);
    expect(next[0].resourceId).toBeUndefined();
    expect(next[0].assignee).toBe("");
  });

  it("dropping into Done sets completedDate (status invariant holds)", () => {
    const setTasks = vi.fn();
    const tasks = [makeTask({ id: 1, status: "To Do", assignee: "", resourceId: undefined })];
    const tasksRef = { current: tasks };
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ tasksRef, setTasks })));
    act(() =>
      result.current.onSwimlaneDrop(1, { key: "unassigned", label: "", resourceId: null }, "Done"),
    );
    const next = applyUpdater(setTasks, tasks);
    expect(next[0].completedDate).toBeTruthy();
  });

  it("dropping into a free-string lane sets assignee without a resourceId", () => {
    const setTasks = vi.fn();
    const tasks = [makeTask({ id: 1, status: "To Do", assignee: "", resourceId: undefined })];
    const tasksRef = { current: tasks };
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ tasksRef, setTasks })));
    act(() =>
      result.current.onSwimlaneDrop(
        1,
        { key: "name:Contractor X", label: "Contractor X", resourceId: null },
        "To Do",
      ),
    );
    const next = applyUpdater(setTasks, tasks);
    expect(next[0].assignee).toBe("Contractor X");
    expect(next[0].resourceId).toBeUndefined();
  });

  it("a Jira-synced task is not written at all", () => {
    const setTasks = vi.fn();
    const captureFieldEdit = vi.fn();
    const tasks = [makeTask({ id: 1, jiraKey: "LOP-9", status: "To Do", assignee: "Alice", resourceId: undefined })];
    const tasksRef = { current: tasks };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, setTasks, captureFieldEdit })),
    );
    act(() =>
      result.current.onSwimlaneDrop(1, { key: "res:7", label: "A", resourceId: 7 }, "Done"),
    );
    expect(setTasks).not.toHaveBeenCalled();
    expect(captureFieldEdit).not.toHaveBeenCalled();
    const next = applyUpdater(setTasks, tasks);
    expect(next[0]).toEqual(tasks[0]);
  });

  it("a no-op drop (same lane, same status) records no undo entry", () => {
    const setTasks = vi.fn();
    const captureFieldEdit = vi.fn();
    const tasks = [makeTask({ id: 1, status: "To Do", assignee: "", resourceId: undefined })];
    const tasksRef = { current: tasks };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, setTasks, captureFieldEdit })),
    );
    act(() =>
      result.current.onSwimlaneDrop(1, { key: "unassigned", label: "", resourceId: null }, "To Do"),
    );
    expect(captureFieldEdit).not.toHaveBeenCalled();
    expect(setTasks).not.toHaveBeenCalled();
  });
});

describe("useTaskRowHandlers — onSendInquiry", () => {
  let hrefValue = "";
  let originalLocation: Location;
  beforeEach(() => {
    hrefValue = "";
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        get href() {
          return hrefValue;
        },
        set href(v: string) {
          hrefValue = v;
        },
      },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    vi.restoreAllMocks();
  });

  it("opens a mailto and increments inquiriesSent when an email is on file", () => {
    const setTasks = vi.fn();
    const task = makeTask({ id: 1, assigneeEmail: "alice@example.com", inquiriesSent: 2 });
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks })));
    act(() => result.current.onSendInquiry(task));
    expect(hrefValue.startsWith("mailto:")).toBe(true);
    const updater = setTasks.mock.calls.at(-1)![0] as (p: Task[]) => Task[];
    expect(updater([task])[0].inquiriesSent).toBe(3);
  });

  it("sends to the linked resource's LIVE email, not a stale cached assigneeEmail", () => {
    const setTasks = vi.fn();
    const task = makeTask({ id: 1, assigneeEmail: "old@corp.com", resourceId: 7 });
    const resourcesById = new Map<number, Resource>([
      [7, { id: 7, firstName: "Live", lastName: "Person", roleId: null, utilizationMode: "percent", utilization: {}, email: "current@corp.com" } as Resource],
    ]);
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks, resourcesById })));
    act(() => result.current.onSendInquiry(task));
    expect(hrefValue).toContain(encodeURIComponent("current@corp.com"));
    expect(hrefValue).not.toContain(encodeURIComponent("old@corp.com"));
  });

  it("aborts silently when the email prompt is cancelled", () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    const setTasks = vi.fn();
    const task = makeTask({ id: 1, assigneeEmail: "", assignee: "No Email Person" });
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks })));
    act(() => result.current.onSendInquiry(task));
    expect(setTasks).not.toHaveBeenCalled();
    expect(hrefValue).toBe("");
  });

  it("alerts and aborts on an invalid prompted email", () => {
    vi.spyOn(window, "prompt").mockReturnValue("not-an-email");
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const setTasks = vi.fn();
    const task = makeTask({ id: 1, assigneeEmail: "", assignee: "No Email Person" });
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks })));
    act(() => result.current.onSendInquiry(task));
    expect(alertSpy).toHaveBeenCalled();
    expect(setTasks).not.toHaveBeenCalled();
  });

  it("persists a valid prompted email and proceeds to send", () => {
    vi.spyOn(window, "prompt").mockReturnValue("bob@example.com");
    const setTasks = vi.fn();
    const task = makeTask({ id: 1, assigneeEmail: "", assignee: "Bob" });
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks })));
    act(() => result.current.onSendInquiry(task));
    // First updater persists the prompted email onto the row.
    const persist = setTasks.mock.calls[0][0] as (p: Task[]) => Task[];
    expect(persist([task])[0].assigneeEmail).toBe("bob@example.com");
    expect(hrefValue.startsWith("mailto:")).toBe(true);
  });

  it("uses the default template body (rendered, plain-texted) when resolveTemplateBody returns one", () => {
    const setTasks = vi.fn();
    const task = makeTask({ id: 1, assigneeEmail: "alice@example.com", taskName: "Ship It" });
    const resolveTemplateBody = vi.fn(() => "<p>Hi {{taskName}}</p>");
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks, resolveTemplateBody })));
    act(() => result.current.onSendInquiry(task));
    const decoded = decodeURIComponent(hrefValue);
    expect(decoded).toContain("Hi Ship It");
    expect(resolveTemplateBody).toHaveBeenCalledWith("status-inquiry");
  });

  it("falls back to the i18n body when no template is resolved", () => {
    const setTasks = vi.fn();
    const task = makeTask({ id: 1, assigneeEmail: "alice@example.com", taskName: "Ship It" });
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks, resolveTemplateBody: () => null })));
    act(() => result.current.onSendInquiry(task));
    expect(hrefValue.startsWith("mailto:")).toBe(true);
    // i18n fallback body does NOT contain the raw template markup
    expect(decodeURIComponent(hrefValue)).not.toContain("{{taskName}}");
  });

  it("delegates to sendCommTemplate when provided", () => {
    const sendCommTemplate = vi.fn();
    const setTasks = vi.fn();
    const task = makeTask({ id: 1, assigneeEmail: "alice@example.com", taskName: "Ship" });
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks, sendCommTemplate })));
    act(() => result.current.onSendInquiry(task));
    expect(sendCommTemplate).toHaveBeenCalledWith(expect.objectContaining({ to: "alice@example.com" }));
    expect(hrefValue).toBe(""); // did NOT use mailto directly
  });
});

describe("useTaskRowHandlers — onPushToJira", () => {
  const loadJiraApiMock = vi.mocked(loadJiraApi);
  afterEach(() => vi.restoreAllMocks());

  function apiStub(createIssue: ReturnType<typeof vi.fn>) {
    loadJiraApiMock.mockResolvedValue({
      createIssue,
      taskFieldsToJiraFields: vi.fn(() => ({})),
      formatJiraError: vi.fn((e: unknown) => String(e)),
    } as unknown as Awaited<ReturnType<typeof loadJiraApi>>);
  }

  it("rejects when Jira is disabled (error toast, returns false)", async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ showToast })));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.onPushToJira(1);
    });
    expect(ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });

  it("no-ops a task that already has a jiraKey (no API call, false)", async () => {
    const createIssue = vi.fn();
    apiStub(createIssue);
    const tasksRef = { current: [makeTask({ id: 1, jiraKey: "LOP-9" })] };
    const settings = { jira: jiraEnabled() } as Parameters<typeof useTaskRowHandlers>[0]["settings"];
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ tasksRef, settings })));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.onPushToJira(1);
    });
    expect(ok).toBe(false);
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("on success stamps jiraKey/lastSyncedAt, clears localModifiedAt, toasts info, returns true", async () => {
    const createIssue = vi.fn(async () => ({ key: "LOP-42" }));
    apiStub(createIssue);
    const setTasks = vi.fn();
    const showToast = vi.fn();
    const tasksRef = { current: [makeTask({ id: 1, localModifiedAt: "2030-01-02T00:00:00Z" })] };
    const settings = { jira: jiraEnabled() } as Parameters<typeof useTaskRowHandlers>[0]["settings"];
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, settings, setTasks, showToast })),
    );
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.onPushToJira(1);
    });
    expect(ok).toBe(true);
    const pushed = (setTasks.mock.calls.at(-1)![0] as Task[]).find((t) => t.id === 1)!;
    expect(pushed.jiraKey).toBe("LOP-42");
    expect(pushed.lastSyncedAt).toBeTruthy();
    expect(pushed.localModifiedAt).toBeUndefined();
    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
  });

  it("reports an error and returns false when createIssue rejects", async () => {
    apiStub(vi.fn(async () => { throw new Error("boom"); }));
    const showToast = vi.fn();
    const tasksRef = { current: [makeTask({ id: 1 })] };
    const settings = { jira: jiraEnabled() } as Parameters<typeof useTaskRowHandlers>[0]["settings"];
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, settings, showToast })),
    );
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.onPushToJira(1);
    });
    expect(ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });

  it("reports an error when the created issue has no key", async () => {
    apiStub(vi.fn(async () => ({})));
    const showToast = vi.fn();
    const tasksRef = { current: [makeTask({ id: 1 })] };
    const settings = { jira: jiraEnabled() } as Parameters<typeof useTaskRowHandlers>[0]["settings"];
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, settings, showToast })),
    );
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.onPushToJira(1);
    });
    expect(ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });
});

describe("useTaskRowHandlers — onDelete & navigation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does nothing when the delete confirmation is dismissed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const setTasks = vi.fn();
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks })));
    act(() => result.current.onDelete(1));
    expect(setTasks).not.toHaveBeenCalled();
  });

  it("removes the task, strips it from other tasks' dependencies, deselects and logs", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const setTasks = vi.fn();
    const logActivity = vi.fn();
    const deselect = vi.fn();
    const target = makeTask({ id: 1, taskName: "Doomed" });
    const dependent = makeTask({ id: 2, dependencies: [{ taskId: 1, type: "FS" }] as Task["dependencies"] });
    const tasksRef = { current: [target, dependent] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, setTasks, logActivity, deselectIdRef: { current: deselect } })),
    );
    act(() => result.current.onDelete(1));
    const updater = setTasks.mock.calls[0][0] as (p: Task[]) => Task[];
    const next = updater([target, dependent]);
    expect(next.map((t) => t.id)).toEqual([2]);
    expect(next[0].dependencies).toEqual([]);
    expect(deselect).toHaveBeenCalledWith(1);
    expect(logActivity).toHaveBeenCalledWith("task.deleted", 1, "Doomed");
  });

  it("captures the deleted task PLUS dependents whose dependency was stripped (undo)", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const capture = vi.fn();
    const target = makeTask({ id: 1, taskName: "Doomed" });
    const dependent = makeTask({ id: 2, dependencies: [{ taskId: 1, type: "FS" }] as Task["dependencies"] });
    const tasksRef = { current: [target, dependent] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, setTasks: vi.fn(), capture })),
    );
    act(() => result.current.onDelete(1));
    expect(capture).toHaveBeenCalledTimes(1);
    const opts = capture.mock.calls[0][0] as { kind: string; removed: Task[]; edited: Task[] };
    expect(opts.kind).toBe("task.deleted");
    expect(opts.removed.map((t) => t.id)).toEqual([1]);
    expect(opts.edited.map((t) => t.id)).toEqual([2]);
  });

  it("onJumpToRaid sets the filter, switches to the raid tab, and uncollapses", () => {
    const setRaidFilterTaskId = vi.fn();
    const setWorkspaceCollapsed = vi.fn();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ setRaidFilterTaskId, setWorkspaceCollapsed })),
    );
    act(() => result.current.onJumpToRaid(7));
    expect(setRaidFilterTaskId).toHaveBeenCalledWith(7);
    // setWorkspaceCollapsed receives an updater that forces false when collapsed.
    const updater = setWorkspaceCollapsed.mock.calls[0][0] as (p: boolean) => boolean;
    expect(updater(true)).toBe(false);
  });

  it("handleJumpToTaskFromRaid opens the editor only for a known task", () => {
    const openEditModal = vi.fn();
    const tasksRef = { current: [makeTask({ id: 5 })] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, openEditModal })),
    );
    act(() => result.current.handleJumpToTaskFromRaid(999));
    expect(openEditModal).not.toHaveBeenCalled();
    act(() => result.current.handleJumpToTaskFromRaid(5));
    expect(openEditModal).toHaveBeenCalledWith(tasksRef.current[0]);
  });
});

// ★★★ REGRESSION GUARD — the lane-unification fix introduced this and review
// caught it. A task whose free-string `assignee` uniquely names a directory
// person now RENDERS in `res:<id>` while its stored `resourceId` is still null:
// `backfillTaskResourceFks` stamps the FK at LOAD, so a task created in-session
// has never been through it. The old guard compared the STORED field against the
// lane's id, so dropping such a card back onto its own cell read as a lane
// CHANGE — it wrote, stamped `localModifiedAt`, pushed an undo entry the user
// never made and armed the autosave (a network round trip on Turso) for a drag
// that visibly moved nothing. The guard must ask where the row DISPLAYS.
describe("onSwimlaneDrop — dropping a card back on its own cell", () => {
  const resources: Resource[] = [
    { id: 1, firstName: "Alice", lastName: "Ng", roleId: null,
      utilizationMode: "percent", utilization: {} },
  ];
  const resourcesById: ReadonlyMap<number, Resource> = new Map(resources.map((r) => [r.id, r]));
  // Unlinked on purpose: `resourceId` absent is the whole point of the case.
  const nameOnly = () => ({ current: [makeTask({ id: 1, assignee: "Alice Ng", status: "To Do" })] });
  const ownLane = { key: "res:1", label: "Alice Ng", resourceId: 1 };

  it("writes nothing and records no undo entry", () => {
    const setTasks = vi.fn();
    const captureFieldEdit = vi.fn();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({
        tasksRef: nameOnly(),
        setTasks,
        resourcesById,
        captureFieldEdit,
      })),
    );
    act(() => result.current.onSwimlaneDrop(1, ownLane, "To Do"));
    expect(setTasks).not.toHaveBeenCalled();
    expect(captureFieldEdit).not.toHaveBeenCalled();
  });

  // Control: proves the guard is not simply swallowing every drop. Same lane,
  // different status — the status half of the cell changed, so this MUST write.
  it("still writes when only the STATUS half of the cell changed", () => {
    const setTasks = vi.fn();
    const captureFieldEdit = vi.fn();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({
        tasksRef: nameOnly(),
        setTasks,
        resourcesById,
        captureFieldEdit,
      })),
    );
    act(() => result.current.onSwimlaneDrop(1, ownLane, "In Progress"));
    expect(setTasks).toHaveBeenCalled();
    expect(captureFieldEdit).toHaveBeenCalled();
  });

  // Control: a genuine lane change still writes and stamps the FK.
  it("still writes when the card moves to a different lane", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({
        tasksRef: nameOnly(),
        setTasks,
        resourcesById,
      })),
    );
    act(() =>
      result.current.onSwimlaneDrop(1, { key: "unassigned", label: "", resourceId: null }, "To Do"),
    );
    expect(setTasks).toHaveBeenCalled();
  });
});

// ★★★ THE ASSIGN PATH IS NOT A DRAG, AND THE DISPLAY-BASED NO-OP TEST BREAKS IT.
// `tasks-section.tsx` onAssignFromCard routes the per-card assignee <select>
// through this same handler with the task's CURRENT status. The select is
// controlled on `task.resourceId` (`task-kanban-card.tsx`), so a task whose
// free-string assignee names a directory person shows "Unassigned" while its
// card sits in that person's lane — the exact row the FK repair exists for.
// Asking "does it already DISPLAY here" answers yes, swallows the write, and the
// controlled select snaps back: an inert control with no feedback. Asking "does
// it already STORE this" answers no, so the repair lands.
describe("onSwimlaneDrop — explicit assign from a card", () => {
  const resources: Resource[] = [
    { id: 1, firstName: "Alice", lastName: "Ng", roleId: null,
      utilizationMode: "percent", utilization: {} },
  ];
  const resourcesById: ReadonlyMap<number, Resource> = new Map(resources.map((r) => [r.id, r]));
  const ownLane = { key: "res:1", label: "Alice Ng", resourceId: 1 };

  it("stamps the FK when the picked person is the one the card already displays under", () => {
    const setTasks = vi.fn();
    // Name-only: renders in res:1, stores no FK. Status unchanged, lane key
    // unchanged — everything a drag would call a no-op.
    const tasksRef = { current: [makeTask({ id: 1, assignee: "Alice Ng", status: "To Do" })] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, setTasks, resourcesById })),
    );
    act(() => result.current.onSwimlaneDrop(1, ownLane, "To Do", "assign"));
    expect(setTasks).toHaveBeenCalled();
  });

  it("still no-ops an assign that genuinely changes nothing", () => {
    const setTasks = vi.fn();
    // Already linked AND already named — the stored state matches the pick, so
    // there is nothing to write. Without this the fix could be "always write".
    const tasksRef = {
      current: [makeTask({ id: 1, assignee: "Alice Ng", resourceId: 1, status: "To Do" })],
    };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ tasksRef, setTasks, resourcesById })),
    );
    act(() => result.current.onSwimlaneDrop(1, ownLane, "To Do", "assign"));
    expect(setTasks).not.toHaveBeenCalled();
  });
});

// open-followups §50: deleting a task also strips that id from other tasks'
// dependencies[], and those dependents are captured as whole-row EDIT-IMAGES
// (`onDelete`'s `edited: dependents`) — a path Part B's bulk-edit→field-patch
// conversion never touches, so it keeps exercising the engine-level
// `WRITE_THROUGH_FIELDS` backstop after that conversion lands. Wires the REAL
// `useUndoStack` (not the `vi.fn()` `capture` the rest of this file mocks) so an
// undo actually walks `applyUndoRestore`/`applyPreserved` — mirrors the
// real-undo-stack pattern in `absence-move-handler.test.ts`.
describe("useTaskRowHandlers — the preserve backstop survives a real undo", () => {
  function harness(initial: readonly Task[]) {
    return renderHook(() => {
      const [tasks, setTasks] = useState<readonly Task[]>(initial);
      const tasksRef = useRef<readonly Task[]>(tasks);
      useEffect(() => {
        tasksRef.current = tasks;
      }, [tasks]);
      const undo = useUndoStack({
        lang: "en-US",
        logActivity: vi.fn(),
        showToast: vi.fn(),
        showToastAction: vi.fn(),
      });
      const handlers = useTaskRowHandlers(
        makeArgs({ tasksRef, setTasks, capture: undo.capture }),
      );
      return { tasks, setTasks, undo, handlers };
    });
  }

  afterEach(() => vi.restoreAllMocks());

  it("undoing a delete keeps a note added to a DEPENDENT since the delete", () => {
    const blocker = makeTask({ id: 1, taskName: "blocker" });
    const dependent = makeTask({
      id: 2,
      taskName: "dependent",
      dependencies: [{ taskId: 1, type: "FS" }],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result, rerender } = harness([blocker, dependent]);

    act(() => result.current.handlers.onDelete(1));
    rerender();
    expect(result.current.tasks.map((tk) => tk.id)).toEqual([2]);

    // Stand-in for the notes window: writes through to the live row directly,
    // exactly as the real notes window does, with no knowledge of the undo
    // stack. Seeded AFTER the delete — seeding it before is the §48 trap this
    // repo has already paid for twice, and it would pass against unfixed code.
    act(() => {
      result.current.setTasks((prev) =>
        prev.map((tk) =>
          tk.id === 2
            ? {
                ...tk,
                noteLog: [
                  {
                    id: 1,
                    timestamp: "2030-01-02T00:00:00.000Z",
                    html: "<p>added after the delete</p>",
                    text: "added after the delete",
                  },
                ],
              }
            : tk,
        ),
      );
    });
    rerender();

    act(() => result.current.undo.undo());
    rerender();

    const restored = result.current.tasks.find((tk) => tk.id === 2);
    expect(restored?.noteLog?.map((n) => n.text)).toEqual(["added after the delete"]);
    // Anti-vacuity anchor: the dependency strip WAS reverted — without this a
    // harness reverting nothing at all would also pass.
    expect(restored?.dependencies).toEqual([{ taskId: 1, type: "FS" }]);
  });

  it("undoing a delete keeps an outlookEventId stamped on a dependent since the delete", () => {
    const blocker = makeTask({ id: 1, taskName: "blocker" });
    const dependent = makeTask({
      id: 2,
      taskName: "dependent",
      dependencies: [{ taskId: 1, type: "FS" }],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result, rerender } = harness([blocker, dependent]);

    act(() => result.current.handlers.onDelete(1));
    rerender();
    expect(result.current.tasks.map((tk) => tk.id)).toEqual([2]);

    // Stand-in for the background Outlook push: stamps the id Graph returned
    // for this task, with no knowledge of the undo stack. Seeded AFTER delete.
    act(() => {
      result.current.setTasks((prev) =>
        prev.map((tk) => (tk.id === 2 ? { ...tk, outlookEventId: "AAMkAG-evt-1" } : tk)),
      );
    });
    rerender();

    act(() => result.current.undo.undo());
    rerender();

    const restored = result.current.tasks.find((tk) => tk.id === 2);
    // Reverting this is how the next push creates a SECOND event for the same
    // task in the user's real calendar.
    expect(restored?.outlookEventId).toBe("AAMkAG-evt-1");
    expect(restored?.dependencies).toEqual([{ taskId: 1, type: "FS" }]);
  });
});

/** open-followups §235: the inline status `<select>` and the Kanban swimlane drop
 *  are the two fastest ways to complete a task, and neither wrote an activity
 *  entry — while pressing Undo on that same change DID write one ("undo").
 *
 *  ★★ MUTATION-PROVED PER ROUTE, and the two routes were mutated SEPARATELY so
 *  each positive block is evidence for its OWN call site. Observed:
 *  - Mutant E (delete the `statusActivityKind` pair from `onStatusChange` only):
 *    the two inline-select blocks FAILED; the swimlane block PASSED.
 *  - Mutant F (delete it from `onSwimlaneDrop` only): the swimlane block FAILED;
 *    both inline blocks PASSED.
 *  The "writes no transition entry" block passed under BOTH mutants and against
 *  the unfixed code — that is what makes it a control rather than evidence: it
 *  only becomes meaningful once the three positive blocks are green. */
describe("useTaskRowHandlers — status transitions reach the activity log", () => {
  it("logs a completion when the inline select moves a task to Done", () => {
    const logActivity = vi.fn();
    const tasksRef = { current: [makeTask({ id: 1, status: "In Progress" })] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ logActivity, tasksRef })),
    );
    act(() => result.current.onStatusChange(1, "Done"));
    expect(logActivity).toHaveBeenCalledWith("task.completed", 1, "Test task");
  });

  it("logs a reopening when the inline select moves a task off Done", () => {
    const logActivity = vi.fn();
    const tasksRef = {
      current: [makeTask({ id: 1, status: "Done", completedDate: "2030-01-01" })],
    };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ logActivity, tasksRef })),
    );
    act(() => result.current.onStatusChange(1, "In Progress"));
    expect(logActivity).toHaveBeenCalledWith("task.reopened", 1, "Test task");
  });

  it("writes no transition entry when delivered-ness does not change", () => {
    // ★ THIS IS THE ABSENCE ASSERTION, and the two positive blocks above are
    // its CONTROLS. A block whose
    // whole content is `not.toHaveBeenCalledWith` cannot be its own control. On
    // its own it is satisfied by a handler that logs nothing ever; it only
    // carries information once the two blocks above are green.
    const logActivity = vi.fn();
    const tasksRef = { current: [makeTask({ id: 1, status: "To Do" })] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ logActivity, tasksRef })),
    );
    act(() => result.current.onStatusChange(1, "In Progress"));
    expect(logActivity).not.toHaveBeenCalledWith("task.completed", 1, "Test task");
  });

  it("logs a completion when a swimlane drop moves a task to Done", () => {
    const logActivity = vi.fn();
    const tasksRef = {
      current: [makeTask({ id: 1, status: "To Do", assignee: "", resourceId: undefined })],
    };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ logActivity, tasksRef })),
    );
    act(() =>
      result.current.onSwimlaneDrop(
        1,
        { key: "res:7", label: "Anna Jordan", resourceId: 7 },
        "Done",
      ),
    );
    expect(logActivity).toHaveBeenCalledWith("task.completed", 1, "Test task");
  });

  // ★★ A SPLIT PAIR RE-SELECTED AT ITS OWN STATUS IS A REAL WRITE. The setter in
  // `onStatusChange` runs unconditionally for a non-synced row, so
  // `applyStatusChange` clears the stray `completedDate` — while the transition
  // log used to sit behind a `prevRow.status !== next` gate and stayed silent.
  // The fixture is a state `migrateTask` deliberately does not repair: status
  // "To Do" carrying a `completedDate`.
  it("logs a reopening when re-selecting the current status clears a split completedDate", () => {
    const logActivity = vi.fn();
    const tasksRef = {
      current: [makeTask({ id: 1, status: "To Do", completedDate: "2030-01-01" })],
    };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ logActivity, tasksRef })),
    );
    act(() => result.current.onStatusChange(1, "To Do"));
    expect(logActivity).toHaveBeenCalledWith("task.reopened", 1, "Test task");
  });

  // Control for the block above, pinning that dropping the gate did NOT make the
  // handler chatty: an UNSPLIT row re-selected at its own status still logs
  // nothing, because `statusActivityKind` compares delivered-ness rather than
  // status and returns null for it.
  it("still writes nothing when an unsplit row is re-selected at its own status", () => {
    const logActivity = vi.fn();
    const tasksRef = { current: [makeTask({ id: 1, status: "To Do" })] };
    const { result } = renderHook(() =>
      useTaskRowHandlers(makeArgs({ logActivity, tasksRef })),
    );
    act(() => result.current.onStatusChange(1, "To Do"));
    expect(logActivity).not.toHaveBeenCalled();
  });
});
