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
import type { NoteLogEntry, Task } from "./types";

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
    description: "",
    group: "",
    labels: [],
    dependencies: [],
    successorLinks: [],
    originalEstimateMinutes: undefined,
    timeSpentMinutes: undefined,
    pushToJira: false,
    healthOverride: "",
    knowledgeLinks: [],
    resourceId: undefined,
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

  // The reported bug: `validateTaskForm` rejected ANY past due date and Save is
  // gated on that, so every overdue task was unsavable whatever the user was
  // actually changing. This pins the WIRING (the hook must pass isNew=false when
  // editing) — the pure-function tests in task-validation.test.ts all still pass
  // if the flag is hardcoded here, so they cannot catch a mis-thread.
  it("allows saving an existing task whose due date has gone stale", () => {
    const setTasks = vi.fn();
    const existing = makeTask({ id: 1, dueDate: "2029-12-31" });
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          setTasks,
          editingId: 1,
          tasks: [existing],
          tasksRef: { current: [existing] },
          form: { ...validForm(), dueDate: "2029-12-31", status: "Done" as const },
        }),
      ),
    );
    expect(result.current.fieldErrors.dueDate).toBeUndefined();
    expect(result.current.saveDisabled).toBe(false);
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    expect(setTasks).toHaveBeenCalled();
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

describe("useTaskSubmit — createdDate stamp", () => {
  it("a newly created task records its creation date", () => {
    const setTasks = vi.fn();
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({ setTasks, tasks: [], tasksRef: { current: [] } })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    const nextList = setTasks.mock.calls[0][0] as Task[];
    const created = nextList.at(-1)!;
    expect(created.createdDate).toBe(created.lastUpdateDate);
  });

  it("editing a task leaves its existing createdDate untouched", () => {
    const setTasks = vi.fn();
    const existing = makeTask({ id: 1, assignee: "Bob", createdDate: "2029-06-15" });
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({
        setTasks, editingId: 1, tasks: [existing],
        tasksRef: { current: [existing] },
        form: { ...validForm(), taskName: "New Name", assignee: "Bob" },
      })),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    const updater = setTasks.mock.calls[0][0] as (p: Task[]) => Task[];
    const [patched] = updater([existing]);
    expect(patched.createdDate).toBe("2029-06-15");
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

  // ★★★ `successorLinks` is a STAGING list, never a projection of stored state.
  // The stored `dependencies` are this task's PREDECESSORS; seeding them here
  // would re-read them back out on Save as SUCCESSORS and write a reciprocal
  // link onto every one of them — silently, on a save the user made for an
  // unrelated field. Nothing downstream can catch that: the resolver is handed
  // whatever the draft holds and would apply it faithfully.
  // ★★ The fixture MUST carry stored dependencies. With `dependencies: []` the
  // correct empty seed and a hydrating one produce the same `[]`, and the test
  // passes whichever the code does — the same too-small-fixture vacuity that
  // already had to be fixed once on this branch.
  it("openEditModal seeds successorLinks EMPTY even when the task has stored dependencies", () => {
    const setForm = vi.fn();
    const withDeps = makeTask({
      id: 1,
      dependencies: [{ taskId: 2, type: "FS" }, { taskId: 3, type: "SS" }],
    });
    const { result } = renderHook(() =>
      useTaskSubmit(makeArgs({ setForm })),
    );
    act(() => result.current.openEditModal(withDeps));
    const seeded = setForm.mock.calls[0][0] as TaskFormDraft;
    // Control: the stored links DID reach the draft, on the field that owns
    // them — so `successorLinks` being empty is a real decision and not an
    // artifact of the seed ignoring `dependencies` altogether.
    expect(seeded.dependencies).toEqual([{ taskId: 2, type: "FS" }, { taskId: 3, type: "SS" }]);
    expect(seeded.successorLinks).toEqual([]);
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

// The note log is written STRAIGHT THROUGH to the workspace by NoteLogPanel /
// the floating notes window while the editor is open — it never touches the
// form draft, which carries no note log at all. Save must therefore never
// write anything note-log-shaped back over the live row.
describe("useTaskSubmit — note log is write-through, never round-tripped by Save", () => {
  const note = (id: number, text: string): NoteLogEntry => ({
    id,
    timestamp: "2030-01-01T00:00:00.000Z",
    html: `<p>${text}</p>`,
    text,
  });

  /** Opens the editor on `opened`, then submits against a diverged live row. */
  function saveAfterWriteThrough(opened: Task, live: Task): Task {
    const setTasks = vi.fn();
    const setForm = vi.fn();
    let args: Parameters<typeof useTaskSubmit>[0] = makeArgs({
      setTasks,
      setForm,
      editingId: 1,
      tasks: [opened],
      tasksRef: { current: [opened] },
    });
    const { result, rerender } = renderHook(() => useTaskSubmit(args));

    // 1. open the editor. The draft carries no note log at all.
    act(() => result.current.openEditModal(opened));
    const draft = setForm.mock.calls[0][0] as TaskFormDraft;

    // 2. write-through: the WORKSPACE row changes, the draft does NOT.
    args = makeArgs({
      setTasks,
      setForm,
      editingId: 1,
      tasks: [live],
      tasksRef: { current: [live] },
      form: { ...draft, assignee: live.assignee },
    });
    rerender();

    // 3. save.
    act(() => result.current.handleSubmit(fakeSubmitEvent()));
    const updater = setTasks.mock.calls[0][0] as (p: Task[]) => Task[];
    return updater([live])[0];
  }

  it("does not clobber a note added while the editor was open", () => {
    const opened = makeTask({ id: 1, noteLog: [note(1, "first")] });
    const live = { ...opened, noteLog: [note(1, "first"), note(2, "second")] };
    const saved = saveAfterWriteThrough(opened, live);
    expect(saved.noteLog).toHaveLength(2);
    expect(saved.noteLog?.[1]?.text).toBe("second");
  });

  it("does not resurrect a note deleted while the editor was open", () => {
    const opened = makeTask({ id: 1, noteLog: [note(1, "first"), note(2, "second")] });
    const live = { ...opened, noteLog: [note(1, "first")] };
    const saved = saveAfterWriteThrough(opened, live);
    expect(saved.noteLog).toHaveLength(1);
    expect(saved.noteLog?.[0]?.text).toBe("first");
  });
});

// Dependencies are stored as PREDECESSORS on the owning task, so a staged
// successor link is a write to a DIFFERENT task. Save is where that lands.
describe("useTaskSubmit — staged successor links", () => {
  it("applies a staged successor link to the target task on save", () => {
    const setTasks = vi.fn();
    const tasks = [makeTask({ id: 1, taskName: "Own" }), makeTask({ id: 2, taskName: "Target" })];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          setTasks,
          editingId: 1,
          tasks,
          tasksRef: { current: tasks },
          form: { ...validForm(), successorLinks: [{ taskId: 2, type: "FS" as const }] },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    const updater = setTasks.mock.calls[0][0] as (prev: readonly Task[]) => readonly Task[];
    const next = updater(tasks);
    expect(next.find((t) => t.id === 2)?.dependencies).toEqual([{ taskId: 1, type: "FS" }]);
    // The edited task itself is still written in the same pass.
    expect(next.find((t) => t.id === 1)?.taskName).toBe("Valid Task");
  });

  it("captures ONE composite undo entry for the whole successor fan-out", () => {
    const captureComposite = vi.fn();
    const captureFieldEdit = vi.fn();
    const tasks = [
      makeTask({ id: 1, taskName: "Own" }),
      makeTask({ id: 2, taskName: "First target" }),
      makeTask({ id: 3, taskName: "Second target" }),
    ];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          captureComposite,
          captureFieldEdit,
          editingId: 1,
          tasks,
          tasksRef: { current: tasks },
          form: {
            ...validForm(),
            successorLinks: [
              { taskId: 2, type: "FS" as const },
              { taskId: 3, type: "SS" as const },
            ],
          },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    // ★★★ ONE entry, not two. Two targets used to mean two undo entries and two
    // toasts, so one Ctrl+Z unlinked one target and left the other.
    expect(captureComposite).toHaveBeenCalledOnce();
    const opts = captureComposite.mock.calls[0][0] as {
      primaryCount: number;
      parts: readonly unknown[];
      name?: string;
    };
    expect(opts.primaryCount).toBe(2);
    expect(opts.parts).toHaveLength(1);
    // ★ Above one target the label must NOT name a single row, or the entry
    // claims to be about "Second target" alone.
    expect(opts.name).toBeUndefined();
    // ★ No per-target field entries survive alongside the composite — that
    // would restore the N-entry behaviour AND double-apply on undo.
    const targetFieldEdits = captureFieldEdit.mock.calls
      .map(([o]) => o as { id: number })
      .filter((o) => o.id === 2 || o.id === 3);
    expect(targetFieldEdits).toEqual([]);
  });

  // ★★★ Exercises the FRAGMENT, not the call shape. `captureFieldPart` returns
  // an opaque restore closure, so asserting on `captureComposite`'s arguments
  // alone cannot see which rows get which patch — the assertion would pass
  // against a fragment that reverts nothing, or only the first target.
  it("reverts EVERY successor target in ONE setter pass, touching only dependencies", () => {
    const captureComposite = vi.fn();
    const setTasks = vi.fn();
    const tasks = [
      makeTask({ id: 1, taskName: "Own" }),
      makeTask({ id: 2, taskName: "First target" }),
      makeTask({ id: 3, taskName: "Second target" }),
    ];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          captureComposite,
          setTasks,
          editingId: 1,
          tasks,
          tasksRef: { current: tasks },
          form: {
            ...validForm(),
            successorLinks: [
              { taskId: 2, type: "FS" as const },
              { taskId: 3, type: "SS" as const },
            ],
          },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    const opts = captureComposite.mock.calls[0][0] as {
      parts: readonly { restore: (box: { current: ReadonlyMap<number, number> }, p: boolean) => () => void }[];
    };
    const callsBefore = setTasks.mock.calls.length;
    let redo: (() => void) | undefined;
    act(() => {
      redo = opts.parts[0].restore({ current: new Map() }, false);
    });
    // ★★ ONE state update for the whole fan-out. N passes would re-render per
    // target and is the shape this replaced.
    expect(setTasks.mock.calls.length - callsBefore).toBe(1);

    // The live rows at undo time: both linked, and target 2 ALSO carries a field
    // this save never touched — a concurrent writer's edit. A whole-row capture
    // would discard it (open-followups §50); the field merge must preserve it.
    const live = [
      makeTask({ id: 1, taskName: "Own" }),
      makeTask({
        id: 2,
        taskName: "First target",
        assignee: "Changed by someone else",
        dependencies: [{ taskId: 1, type: "FS" }],
      }),
      makeTask({ id: 3, taskName: "Second target", dependencies: [{ taskId: 1, type: "SS" }] }),
    ];
    const undoUpdater = setTasks.mock.calls.at(-1)![0] as (p: readonly Task[]) => readonly Task[];
    const afterUndo = undoUpdater(live);
    // BOTH targets reverted, not just the first.
    expect(afterUndo.find((t) => t.id === 2)?.dependencies).toEqual([]);
    expect(afterUndo.find((t) => t.id === 3)?.dependencies).toEqual([]);
    // The unrelated concurrent edit survives.
    expect(afterUndo.find((t) => t.id === 2)?.assignee).toBe("Changed by someone else");
    // ★★ Every target is re-stamped, or a reverted row reports as unmodified:
    // `localModifiedAt` is persisted on all six write paths and `diffFields`
    // suppresses it, so nothing downstream would notice the omission.
    for (const id of [2, 3]) {
      const before = live.find((t) => t.id === id)!.localModifiedAt;
      expect(afterUndo.find((t) => t.id === id)?.localModifiedAt).not.toBe(before);
    }

    // ★★★ THE REDO DIRECTION. `restore` returns the closure that re-applies
    // `after`, and it is the one asymmetric line in the fragment — writing
    // `before` there again is a one-identifier slip that leaves Ctrl+Y silently
    // doing nothing while the stack claims it redid.
    expect(redo).toBeTypeOf("function");
    act(() => redo!());
    const redoUpdater = setTasks.mock.calls.at(-1)![0] as (p: readonly Task[]) => readonly Task[];
    const afterRedo = redoUpdater(afterUndo);
    expect(afterRedo.find((t) => t.id === 2)?.dependencies).toEqual([{ taskId: 1, type: "FS" }]);
    expect(afterRedo.find((t) => t.id === 3)?.dependencies).toEqual([{ taskId: 1, type: "SS" }]);
    // And redo must not resurrect the snapshot over the concurrent edit either.
    expect(afterRedo.find((t) => t.id === 2)?.assignee).toBe("Changed by someone else");
  });

  // ★ A single target is the one case where a row NAME is unambiguous, so the
  // label carries it. Pins the lookup resolving the right row, which a
  // `nameSource[0]` slip would break.
  it("names the composite entry after the row when there is exactly ONE target", () => {
    const captureComposite = vi.fn();
    const tasks = [
      makeTask({ id: 1, taskName: "Own" }),
      makeTask({ id: 2, taskName: "Ignored first row" }),
      makeTask({ id: 3, taskName: "The only target" }),
    ];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          captureComposite,
          editingId: 1,
          tasks,
          tasksRef: { current: tasks },
          form: { ...validForm(), successorLinks: [{ taskId: 3, type: "SS" as const }] },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    const opts = captureComposite.mock.calls[0][0] as { primaryCount: number; name?: string };
    expect(opts.primaryCount).toBe(1);
    // ★ The fixture puts a DIFFERENT task first in the list, so a lookup that
    // grabbed `nameSource[0]` would read "Ignored first row" and fail here.
    expect(opts.name).toBe("The only target");
  });

  // ★ Ordering is load-bearing for undo: the composite target entry must land
  // ON TOP of the own-task entries so a bare undo() peels the successor links
  // first. Moving the call above captureFieldChanges passes every other test.
  it("captures the target entries AFTER the own-task entries", () => {
    const order: string[] = [];
    const captureFieldEdit = vi.fn(() => {
      order.push("own");
    });
    const captureComposite = vi.fn(() => {
      order.push("composite");
    });
    const existing = makeTask({ id: 1, taskName: "Old name", assignee: "Bob" });
    const tasks = [existing, makeTask({ id: 2, taskName: "Target" })];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          captureFieldEdit,
          captureComposite,
          editingId: 1,
          tasks,
          tasksRef: { current: tasks },
          form: {
            ...validForm(),
            taskName: "New name",
            assignee: "Bob",
            successorLinks: [{ taskId: 2, type: "FS" as const }],
          },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    // ★ Two different capture APIs now, so ordering has to be read from a
    // SHARED log rather than one mock's call list.
    const ownIdx = order.indexOf("own");
    const targetIdx = order.indexOf("composite");
    // Control: both kinds of entry actually fired, or the comparison is vacuous.
    expect(ownIdx).toBeGreaterThanOrEqual(0);
    expect(targetIdx).toBeGreaterThanOrEqual(0);
    expect(targetIdx).toBeGreaterThan(order.lastIndexOf("own"));
  });

  it("writes the target edits to the activity log", () => {
    const logActivity = vi.fn();
    const tasks = [makeTask({ id: 1, taskName: "Own" }), makeTask({ id: 2, taskName: "Target" })];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          logActivity,
          editingId: 1,
          tasks,
          tasksRef: { current: tasks },
          form: { ...validForm(), successorLinks: [{ taskId: 2, type: "FS" as const }] },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    expect(logActivity).toHaveBeenCalledWith("task.updated", 2, "Target");
  });

  // ★★ Ordering, not just presence. `recordSuccessorEdits` emits one
  // `task.updated` per target, so calling it before `logActivity("task.created")`
  // puts "Target updated" ABOVE "New task created" in the log — a row reported
  // as edited by a task that did not yet exist. Both calls are synchronous and
  // adjacent, so swapping them back is invisible to every other assertion.
  it("logs task.created BEFORE the successor edits it causes", () => {
    const logActivity = vi.fn();
    const tasks = [makeTask({ id: 2, taskName: "Target" })];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          logActivity,
          editingId: null,
          tasks,
          tasksRef: { current: tasks },
          form: { ...validForm(), successorLinks: [{ taskId: 2, type: "FS" as const }] },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    const kinds = logActivity.mock.calls.map(([kind]) => kind as string);
    const createdIdx = kinds.indexOf("task.created");
    const targetIdx = kinds.indexOf("task.updated");
    // Control: BOTH entries fired, or the comparison below is vacuous.
    expect(createdIdx).toBeGreaterThanOrEqual(0);
    expect(targetIdx).toBeGreaterThanOrEqual(0);
    expect(createdIdx).toBeLessThan(targetIdx);
  });

  // ★★★ Asserts the target points at the MINTED id, not merely that some link
  // exists. Resolving before the mint yields no link at all; resolving against
  // the wrong id would yield a link to the wrong task.
  it("applies staged successor links against the newly minted id on create", () => {
    const setTasks = vi.fn();
    const tasks = [makeTask({ id: 2, taskName: "Target" })];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          setTasks,
          editingId: null,
          tasks,
          tasksRef: { current: tasks },
          form: { ...validForm(), successorLinks: [{ taskId: 2, type: "FS" as const }] },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    const next = setTasks.mock.calls[0][0] as readonly Task[];
    const created = next.find((t) => t.taskName === "Valid Task");
    expect(created).toBeDefined();
    expect(next.find((t) => t.id === 2)?.dependencies).toEqual([
      { taskId: created!.id, type: "FS" },
    ]);
  });

  // ★ The toast block is duplicated on the update and create branches, so a
  // test covering one leaves the other free to be deleted. Both are exercised,
  // and both assert the COUNT — two genuinely-missing targets, not one, so an
  // implementation hardcoding "1" cannot pass.
  it.each([
    ["update", 1 as number | null],
    ["create", null as number | null],
  ])("reports the number of links it could not apply (%s path)", (_label, editingId) => {
    const showToast = vi.fn();
    const tasks = [makeTask({ id: 1 })];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          showToast,
          editingId,
          tasks,
          tasksRef: { current: tasks },
          form: {
            ...validForm(),
            successorLinks: [
              { taskId: 98, type: "FS" as const },
              { taskId: 99, type: "FS" as const },
            ],
          },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    // Matched on content, not on call index — the `fieldsAdjusted` toast can
    // also fire on this path and a positional assertion would be fragile.
    const skippedToast = showToast.mock.calls.find(
      ([kind, text]) => kind === "info" && String(text).includes("not applied"),
    );
    expect(skippedToast).toBeDefined();
    expect(String(skippedToast![1])).toContain("2");
  });

  // Re-staging a successor the target already has is NOT a failure: the end
  // state is exactly what was asked for. `successorLinks` is never seeded from
  // stored data, so the picker offers existing successors right back and this
  // is the routine case, not an edge one.
  it("stays silent when a staged link is one the target already has", () => {
    const showToast = vi.fn();
    const setTasks = vi.fn();
    const tasks = [
      makeTask({ id: 1, taskName: "Own" }),
      makeTask({ id: 2, taskName: "Target", dependencies: [{ taskId: 1, type: "FS" }] }),
    ];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          showToast,
          setTasks,
          editingId: 1,
          tasks,
          tasksRef: { current: tasks },
          form: { ...validForm(), successorLinks: [{ taskId: 2, type: "FS" as const }] },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    // ★ POSITIVE CONTROL. "No toast fired" on its own is satisfied by an early
    // return, a rejected form, or the whole feature deleted — assert the save
    // actually ran and that the no-op is a real no-op.
    expect(setTasks).toHaveBeenCalled();
    const updater = setTasks.mock.calls[0][0] as (prev: readonly Task[]) => readonly Task[];
    const next = updater(tasks);
    // Unchanged, and specifically NOT appended a second time.
    expect(next.find((t) => t.id === 2)?.dependencies).toEqual([{ taskId: 1, type: "FS" }]);
    expect(
      showToast.mock.calls.find(
        ([kind, text]) => kind === "info" && String(text).includes("not applied"),
      ),
    ).toBeUndefined();
  });

  // ★ The write must be ADDITIVE against the live row: the resolution decides
  // WHICH links, but the array is rebuilt inside the updater. Assigning the
  // resolved `after` wholesale drops the concurrent writer's edge below.
  it("does not clobber a dependency a concurrent writer added to the target", () => {
    const setTasks = vi.fn();
    const tasks = [
      makeTask({ id: 1, taskName: "Own" }),
      makeTask({ id: 2, taskName: "Target" }),
      makeTask({ id: 3, taskName: "Other" }),
    ];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          setTasks,
          editingId: 1,
          tasks,
          tasksRef: { current: tasks },
          form: { ...validForm(), successorLinks: [{ taskId: 2, type: "FS" as const }] },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    // State moved on between resolve and commit: someone linked 3 -> 2.
    const live = tasks.map((t) =>
      t.id === 2 ? { ...t, dependencies: [{ taskId: 3, type: "FS" as const }] } : t,
    );
    const updater = setTasks.mock.calls[0][0] as (prev: readonly Task[]) => readonly Task[];
    const next = updater(live);
    expect(next.find((t) => t.id === 2)?.dependencies).toEqual([
      { taskId: 3, type: "FS" },
      { taskId: 1, type: "FS" },
    ]);
  });

  // ★★★ The write applies `after` MINUS `before` — the links this save ADDS —
  // not `after` wholesale. The test above cannot tell those apart: its target
  // starts with no dependencies, so `before` is empty and the subtraction is a
  // no-op. Both spellings emit the same array and the filter could be deleted
  // green. Only a target that ALREADY had a link, which a concurrent writer
  // then DELETES, separates them: `after` still carries that stored link, so
  // writing it wholesale RESURRECTS an edge the user just removed elsewhere.
  it("does not resurrect a dependency a concurrent writer deleted from the target", () => {
    const setTasks = vi.fn();
    const tasks = [
      makeTask({ id: 1, taskName: "Own" }),
      // Stored at resolve time, so it lands in `before` AND in `after`.
      makeTask({ id: 2, taskName: "Target", dependencies: [{ taskId: 3, type: "FS" }] }),
      makeTask({ id: 3, taskName: "Other" }),
    ];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          setTasks,
          editingId: 1,
          tasks,
          tasksRef: { current: tasks },
          form: { ...validForm(), successorLinks: [{ taskId: 2, type: "FS" as const }] },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    // State moved on between resolve and commit: someone unlinked 3 -> 2.
    const live = tasks.map((t) => (t.id === 2 ? { ...t, dependencies: [] } : t));
    const updater = setTasks.mock.calls[0][0] as (prev: readonly Task[]) => readonly Task[];
    const next = updater(live);
    // ONLY the link this save adds. `{ taskId: 3 }` stays deleted.
    expect(next.find((t) => t.id === 2)?.dependencies).toEqual([{ taskId: 1, type: "FS" }]);
  });

  // ★★★ The cycle guard must see the predecessors THIS SAVE is about to store,
  // not the ones already on disk. A/B/C: B already depends on C. Editing A to
  // add predecessor B and successor C in one save closes B→A→C→B. Resolving
  // against the unpatched `tasksRef.current` walks an A that still has no
  // predecessors, finds nothing, and stores the cycle.
  it("sees the predecessors staged in the SAME save when checking for a cycle", () => {
    const setTasks = vi.fn();
    const showToast = vi.fn();
    const tasks = [
      makeTask({ id: 1, taskName: "A" }),
      makeTask({ id: 2, taskName: "B", dependencies: [{ taskId: 3, type: "FS" }] }),
      makeTask({ id: 3, taskName: "C" }),
    ];
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          setTasks,
          showToast,
          editingId: 1,
          tasks,
          tasksRef: { current: tasks },
          form: {
            ...validForm(),
            dependencies: [{ taskId: 2, type: "FS" as const }],
            successorLinks: [{ taskId: 3, type: "FS" as const }],
          },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    const updater = setTasks.mock.calls[0][0] as (prev: readonly Task[]) => readonly Task[];
    const next = updater(tasks);
    // C must NOT gain a dependency on A — that edge closes the loop.
    expect(next.find((t) => t.id === 3)?.dependencies ?? []).toEqual([]);
    // And the refusal is reported rather than swallowed.
    expect(
      showToast.mock.calls.find(
        ([kind, text]) => kind === "info" && String(text).includes("not applied"),
      ),
    ).toBeDefined();
  });

  // ★ The create path patches `tasksRef.current` as well as calling setTasks,
  // and the ref is what the NEXT save resolves against. Every other test here
  // reads setTasks' argument, so seeding the ref with the unpatched pre-link
  // array — the natural slip — is invisible to them.
  it("patches tasksRef with the LINKED list on create, not the unlinked one", () => {
    const tasks = [makeTask({ id: 2, taskName: "Target" })];
    const tasksRef = { current: tasks as readonly Task[] };
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          editingId: null,
          tasks,
          tasksRef,
          form: { ...validForm(), successorLinks: [{ taskId: 2, type: "FS" as const }] },
        }),
      ),
    );
    act(() => result.current.handleSubmit(fakeSubmitEvent()));

    const created = tasksRef.current.find((t) => t.taskName === "Valid Task");
    expect(created).toBeDefined();
    expect(tasksRef.current.find((t) => t.id === 2)?.dependencies).toEqual([
      { taskId: created!.id, type: "FS" },
    ]);
  });

  // ★ `emptyForm().successorLinks` is `[]` by construction, so asserting only
  // that the reset is empty passes with this whole feature deleted. What makes
  // it a real guard is the pair: the form under test DID carry a staged link,
  // and what cancel wrote back does not.
  it("discards staged successor links on cancel", () => {
    const setTasks = vi.fn();
    const setForm = vi.fn();
    const tasks = [makeTask({ id: 1 }), makeTask({ id: 2 })];
    const staged = { ...validForm(), successorLinks: [{ taskId: 2, type: "FS" as const }] };
    const { result } = renderHook(() =>
      useTaskSubmit(
        makeArgs({
          setTasks,
          setForm,
          editingId: 1,
          tasks,
          tasksRef: { current: tasks },
          form: staged,
        }),
      ),
    );
    act(() => result.current.handleCancelEdit());

    expect(staged.successorLinks).toHaveLength(1);
    expect(setTasks).not.toHaveBeenCalled();
    const reset = setForm.mock.calls.at(-1)?.[0] as TaskFormDraft;
    expect(reset.successorLinks).toEqual([]);
    expect(reset.successorLinks).not.toEqual(staged.successorLinks);
  });
});
