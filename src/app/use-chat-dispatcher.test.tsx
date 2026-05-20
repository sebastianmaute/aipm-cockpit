import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { TestProviders } from "./test-providers";
import { type Settings } from "./settings-menu";
import { type StorageConfig } from "./storage";
import { useTaskForm } from "./task-form-context";
import { type Task } from "./types";

function makeSettings(): Settings {
  const storageConfig: StorageConfig = { kind: "browser" };
  return {
    language: "en-US",
    holidayCountries: [],
    storageConfig,
    ai: {
      apiKey: "",
      model: "claude-sonnet-4-6",
      consentAccepted: false,
    },
    notifications: {
      banner: { enabled: true, thresholdWorkDays: 3 },
      toast: { enabled: true, thresholdWorkDays: 3 },
      popup: { enabled: true, thresholdWorkDays: 3 },
    },
    jira: {
      enabled: false,
      siteUrl: "",
      email: "",
      apiToken: "",
      projectKey: "",
      projectName: "",
      issueTypes: [],
      assigneeMode: "currentUser",
      assigneeAccountId: "",
      assigneeDisplayName: "",
    },
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
  const { result } = renderHook(
    () =>
      useChatDispatcher({
        settings,
        today: "2026-05-19",
        setSelectedIds,
        setSettings,
      }),
    { wrapper },
  );
  return { result, setSelectedIds, setSettings };
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
  });

  it("setLanguage calls setSettings with an updater that merges language", () => {
    const { result, setSettings } = renderDispatcher();
    result.current.setLanguage("de");
    expect(setSettings).toHaveBeenCalledTimes(1);
    const updater = setSettings.mock.calls[0][0] as (s: Settings) => Settings;
    const prev = makeSettings();
    const next = updater(prev);
    expect(next.language).toBe("de");
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
});
