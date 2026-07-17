// src/app/use-task-submit.test.ts
import { act, renderHook } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RaidItem } from "./types";
import { __resetMintStateForTests } from "./id-mint-session";

beforeAll(() => {
  window.scrollTo = vi.fn();
});

// The task-id minter is session-scoped: clear its high-water state before each
// test so the exact-id assertions (max+1, id 1 on empty) stay deterministic.
beforeEach(() => {
  __resetMintStateForTests();
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
    status: "To Do",
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
    status: "To Do" as const,
    blockers: "",
    notes: "",
    group: "",
    labels: [],
    dependencies: [],
    originalEstimateMinutes: undefined,
    timeSpentMinutes: undefined,
    pushToJira: false,
    healthOverride: "",
    knowledgeLinks: [],
    resourceId: undefined,
    noteLog: [],
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
    raid: [] as readonly RaidItem[],
    setRaid: vi.fn(),
    pendingLinkRaidIdRef: { current: null as number | null },
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

  it("logs task.updated with a per-field diff when editing (#22)", () => {
    const logActivity = vi.fn();
    const logActivityChanges = vi.fn();
    const prev = makeTask({ id: 1, taskName: "Test task", assignee: "Alice" });
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          editingId: 1,
          tasks: [prev],
          tasksRef: { current: [prev] },
          logActivity,
          logActivityChanges,
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    expect(logActivity).not.toHaveBeenCalled();
    expect(logActivityChanges).toHaveBeenCalledOnce();
    const [kind, changes, id] = logActivityChanges.mock.calls[0] as [
      string,
      { field: string; from: string; to: string }[],
      number,
    ];
    expect(kind).toBe("task.updated");
    expect(id).toBe(1);
    // Form changed assignee Alice → Bob and taskName Test task → Valid Task.
    expect(changes).toContainEqual({ field: "assignee", from: "Alice", to: "Bob" });
    expect(changes.some((c) => c.field === "taskName")).toBe(true);
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

describe("useTaskSubmit — resourceId threading", () => {
  it("carries form.resourceId onto the created Task", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({
        setTasks, tasks: [], tasksRef: { current: [] },
        form: { ...validForm(), resourceId: 7 },
      })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    const nextList = setTasks.mock.calls[0][0] as Task[];
    const created = nextList[nextList.length - 1];
    expect(created.resourceId).toBe(7);
  });

  it("carries form.resourceId onto the patched Task in the edit branch", () => {
    const setTasks = vi.fn();
    const existing = makeTask({ id: 1, resourceId: undefined });
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({
        setTasks, editingId: 1, tasks: [existing],
        tasksRef: { current: [existing] },
        form: { ...validForm(), assignee: existing.assignee, resourceId: 7 },
      })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    const updater = setTasks.mock.calls[0][0] as (p: Task[]) => Task[];
    const [patched] = updater([existing]);
    expect(patched.resourceId).toBe(7);
  });

  it("openEditModal seeds form.resourceId from the task", () => {
    const setForm = vi.fn();
    const linked = makeTask({ id: 1, resourceId: 9 });
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({ setForm })),
    );
    act(() => result.current.openEditModal(linked));
    const seeded = setForm.mock.calls[0][0] as TaskFormDraft;
    expect(seeded.resourceId).toBe(9);
  });
});

describe("useTaskSubmit — status on save", () => {
  it("saves the chosen status on a new task", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({
        setTasks, tasks: [], tasksRef: { current: [] },
        form: { ...validForm(), status: "In Progress" },
      })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    const nextList = setTasks.mock.calls[0][0] as Task[];
    const created = nextList[nextList.length - 1];
    expect(created.status).toBe("In Progress");
  });

  it("defaults a new task to To Do", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({ setTasks, tasks: [], tasksRef: { current: [] } })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    const nextList = setTasks.mock.calls[0][0] as Task[];
    const created = nextList[nextList.length - 1];
    expect(created.status).toBe("To Do");
  });

  it("creating a task as Done stamps completedDate", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({
        setTasks, tasks: [], tasksRef: { current: [] },
        form: { ...validForm(), status: "Done" },
      })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    const nextList = setTasks.mock.calls[0][0] as Task[];
    const created = nextList[nextList.length - 1];
    expect(created.status).toBe("Done");
    expect(created.completedDate).toBeTruthy();
  });

  it("editing a task to Done stamps completedDate; moving off Done clears it", () => {
    const setTasks = vi.fn();
    const existing = makeTask({ id: 1, assignee: "Bob", status: "To Do", completedDate: "" });

    // To Do -> Done stamps completedDate.
    const toDone = renderHook(() =>
      useTaskSubmit(makeArgs({
        setTasks, editingId: 1, tasks: [existing],
        tasksRef: { current: [existing] },
        form: { ...validForm(), assignee: "Bob", status: "Done" },
      })),
    );
    act(() => toDone.result.current.handleSubmit(fakeSubmitEvent()));
    const doneUpdater = setTasks.mock.calls[0][0] as (p: Task[]) => Task[];
    const [doneRow] = doneUpdater([existing]);
    expect(doneRow.status).toBe("Done");
    expect(doneRow.completedDate).toBeTruthy();

    // Done -> To Do clears completedDate.
    setTasks.mockClear();
    const doneTask = makeTask({ id: 1, assignee: "Bob", status: "Done", completedDate: "2030-01-01" });
    const offDone = renderHook(() =>
      useTaskSubmit(makeArgs({
        setTasks, editingId: 1, tasks: [doneTask],
        tasksRef: { current: [doneTask] },
        form: { ...validForm(), assignee: "Bob", status: "To Do" },
      })),
    );
    act(() => offDone.result.current.handleSubmit(fakeSubmitEvent()));
    const offUpdater = setTasks.mock.calls[0][0] as (p: Task[]) => Task[];
    const [offRow] = offUpdater([doneTask]);
    expect(offRow.status).toBe("To Do");
    expect(offRow.completedDate).toBe("");
  });
});

describe("useTaskSubmit — field-level edit undo", () => {
  it("captures a per-group field edit for both name and status changes", () => {
    const setTasks = vi.fn();
    const captureFieldEdit = vi.fn();
    const existing = makeTask({ id: 1, taskName: "Old Name", assignee: "Bob", status: "To Do", completedDate: "" });
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({
        setTasks, editingId: 1, tasks: [existing],
        tasksRef: { current: [existing] },
        captureFieldEdit,
        form: { ...validForm(), taskName: "New Name", assignee: "Bob", status: "Done" },
      })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    const nameCall = captureFieldEdit.mock.calls.find(
      (c) => "name" in (c[0].before ?? {}) || "taskName" in (c[0].before ?? {}),
    );
    const statusCall = captureFieldEdit.mock.calls.find((c) => "status" in (c[0].before ?? {}));
    expect(nameCall).toBeTruthy();
    expect(statusCall).toBeTruthy();
    expect(statusCall![0].after).toHaveProperty("completedDate");
  });
});

describe("useTaskSubmit — RAID back-link on task create", () => {
  function makeRaidItem(overrides: Partial<RaidItem> = {}): RaidItem {
    return {
      id: 7,
      category: "R",
      title: "Test risk",
      status: "Open",
      linkedTaskIds: [],
      causedByRaidIds: [],
      stakeholderIds: [],
      raisedDate: "2030-01-01",
      ...overrides,
    };
  }

  it("links the created task id into the RAID item and clears the ref", () => {
    const pendingLinkRaidIdRef = { current: 7 as number | null };
    let raidState: readonly RaidItem[] = [makeRaidItem({ id: 7, linkedTaskIds: [] })];
    const setRaid: React.Dispatch<React.SetStateAction<readonly RaidItem[]>> = (u) => {
      raidState = typeof u === "function" ? u(raidState) : u;
    };
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({
        tasks: [],
        tasksRef: { current: [] },
        editingId: null,
        raid: raidState,
        setRaid,
        pendingLinkRaidIdRef,
      })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    expect(raidState[0].linkedTaskIds).toHaveLength(1);
    expect(raidState[0].linkedTaskIds[0]).toBe(1); // nextId([]) === 1
    expect(pendingLinkRaidIdRef.current).toBeNull();
  });

  it("does not throw and leaves raid unchanged when the RAID item id is missing", () => {
    const pendingLinkRaidIdRef = { current: 99 as number | null };
    const setTasks = vi.fn();
    let raidState: readonly RaidItem[] = [makeRaidItem({ id: 7, linkedTaskIds: [] })];
    const setRaid: React.Dispatch<React.SetStateAction<readonly RaidItem[]>> = (u) => {
      raidState = typeof u === "function" ? u(raidState) : u;
    };
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({
        tasks: [],
        tasksRef: { current: [] },
        setTasks,
        raid: raidState,
        setRaid,
        pendingLinkRaidIdRef,
      })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    expect(raidState[0].linkedTaskIds).toHaveLength(0); // unchanged
    expect(pendingLinkRaidIdRef.current).toBeNull();
    expect(setTasks).toHaveBeenCalled(); // task still created
  });

  it("cancel clears the pending link ref", () => {
    const pendingLinkRaidIdRef = { current: 5 as number | null };
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({ pendingLinkRaidIdRef })),
    );
    act(() => result.current.handleCancelEdit());
    expect(pendingLinkRaidIdRef.current).toBeNull();
  });

  it("does not call setRaid when pendingLinkRaidIdRef is null", () => {
    const setRaid = vi.fn();
    const pendingLinkRaidIdRef = { current: null as number | null };
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({
        tasks: [],
        tasksRef: { current: [] },
        setRaid,
        pendingLinkRaidIdRef,
      })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    expect(setRaid).not.toHaveBeenCalled();
  });
});
