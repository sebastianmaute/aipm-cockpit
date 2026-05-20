import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { TestProviders } from "./test-providers";
import { type Settings } from "./settings-menu";
import { type StorageConfig } from "./storage";
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
});
