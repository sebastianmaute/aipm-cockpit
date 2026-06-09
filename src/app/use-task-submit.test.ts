// src/app/use-task-submit.test.ts
import { act, renderHook } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  window.scrollTo = vi.fn();
});
import { useTaskSubmit } from "./use-task-submit";
import type { TaskFormDraft } from "./task-form-context";
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

function validForm(): TaskFormDraft {
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
    originalEstimateMinutes: undefined,
    timeSpentMinutes: undefined,
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
  it("is not disabled and has no field errors for a valid initial form", () => {
    const { result } = renderHook(() => useTaskSubmit(makeArgs()));
    expect(result.current.saveDisabled).toBe(false);
    expect(result.current.fieldErrors).toEqual({});
  });

  it("flags the missing field and blocks submit when a required field is empty", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({ setTasks, form: { ...validForm(), taskName: "" } })),
    );
    expect(result.current.saveDisabled).toBe(true);
    expect(result.current.fieldErrors.taskName).toBe("errorTaskNameRequired");
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    expect(setTasks).not.toHaveBeenCalled();
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

  it("clears submitted when reopening for edit (next form starts quiet)", () => {
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({ form: { ...validForm(), taskName: "" } })),
    );
    // A blocked submit flips submitted true so all field errors reveal.
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    expect(result.current.submitted).toBe(true);
    act(() => result.current.openEditModal(makeTask()));
    expect(result.current.submitted).toBe(false);
  });

  it("clears submitted on cancel", () => {
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({ form: { ...validForm(), taskName: "" } })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    expect(result.current.submitted).toBe(true);
    act(() => result.current.handleCancelEdit());
    expect(result.current.submitted).toBe(false);
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

describe("useTaskSubmit — validation guards", () => {
  it("rejects a due date in the past", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({ setTasks, form: { ...validForm(), dueDate: "2029-12-31" } })),
    );
    expect(result.current.fieldErrors.dueDate).toBe("errorPastDate");
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    expect(setTasks).not.toHaveBeenCalled();
  });

  it("rejects an invalid assignee email", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({ setTasks, form: { ...validForm(), assigneeEmail: "not-an-email" } })),
    );
    expect(result.current.fieldErrors.assigneeEmail).toBe("errorInvalidEmail");
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    expect(setTasks).not.toHaveBeenCalled();
  });

  it("blocks reassigning a Jira-linked task to a different assignee", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const setTasks = vi.fn();
    const setEditingId = vi.fn();
    const linked = makeTask({ id: 1, jiraKey: "LOP-1", assignee: "Alice" });
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({
        setTasks, setEditingId, editingId: 1, tasks: [linked],
        form: { ...validForm(), assignee: "Bob" },
      })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    expect(alertSpy).toHaveBeenCalled();
    expect(setTasks).not.toHaveBeenCalled();
    expect(setEditingId).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

describe("useTaskSubmit — edit branch", () => {
  it("patches the edited row, stamps localModifiedAt, clears editing, logs task.updated", () => {
    const setTasks = vi.fn();
    const setEditingId = vi.fn();
    const logActivity = vi.fn();
    const existing = makeTask({ id: 1, taskName: "Old", assignee: "Bob" });
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({
        setTasks, setEditingId, logActivity, editingId: 1, tasks: [existing],
        tasksRef: { current: [existing] },
        form: { ...validForm(), taskName: "New Name", assignee: "Bob" },
      })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    const updater = setTasks.mock.calls[0][0] as (p: Task[]) => Task[];
    const [patched] = updater([existing]);
    expect(patched.taskName).toBe("New Name");
    expect(patched.localModifiedAt).toBeTruthy();
    expect(setEditingId).toHaveBeenCalledWith(null);
    expect(logActivity).toHaveBeenCalledWith("task.updated", 1, "New Name");
  });
});

describe("useTaskSubmit — new task: id, startDate clamp, push-to-jira", () => {
  it("assigns max(id)+1 and clamps a startDate later than dueDate down to dueDate", () => {
    const setTasks = vi.fn();
    const existing = [makeTask({ id: 5 }), makeTask({ id: 2 })];
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({
        setTasks, tasks: existing, tasksRef: { current: existing },
        form: { ...validForm(), startDate: "2031-06-01", dueDate: "2030-12-31" },
      })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    const nextList = setTasks.mock.calls[0][0] as Task[];
    const created = nextList[nextList.length - 1];
    expect(created.id).toBe(6); // max(5,2)+1
    expect(created.startDate).toBe("2030-12-31"); // clamped to dueDate
  });

  it("assigns id 1 when there are no existing tasks", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({ setTasks, tasks: [], tasksRef: { current: [] } })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    const nextList = setTasks.mock.calls[0][0] as Task[];
    expect(nextList[0].id).toBe(1);
  });

  it("pushes to Jira after creation when enabled + pushToJira + projectKey", () => {
    const push = vi.fn().mockResolvedValue(true);
    const setTaskModalOpen = vi.fn();
    const settings = {
      jira: { enabled: true, siteUrl: "https://x", email: "a@b.c", apiToken: "t", projectKey: "LOP", issueTypes: ["Task"] },
    } as unknown as Parameters<typeof useTaskSubmit>[0]["settings"];
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({
        settings, setTaskModalOpen, tasks: [], tasksRef: { current: [] },
        onPushToJiraRef: { current: push },
        form: { ...validForm(), pushToJira: true },
      })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    expect(push).toHaveBeenCalledWith(1);
    expect(setTaskModalOpen).toHaveBeenCalledWith(false);
  });

  it("does NOT push to Jira when integration is disabled", () => {
    const push = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({
        tasks: [], tasksRef: { current: [] },
        onPushToJiraRef: { current: push },
        form: { ...validForm(), pushToJira: true }, // but settings.jira.enabled is false
      })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    expect(push).not.toHaveBeenCalled();
  });
});
