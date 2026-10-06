// Pins useTaskEditorCreate (use-task-editor-create.ts, §491): the task
// editor's create-RAID and new-linked-task wiring. In edit mode each applies at
// once to the task being edited; in create mode each is staged in the editor
// buffer and applied by its flush. The setters and the activity logger are
// mocks; the buffer, the sanitizer, the id minting and the link helper are the
// real ones.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { RaidItem, Task } from "./types";
import type { LinkedTaskDraft } from "./task-linked-task-modal";
import { __resetMintStateForTests } from "./id-mint-session";
import { useTaskEditorCreate, type TaskEditorCreateDeps } from "./use-task-editor-create";

const TODAY = "2026-10-06";

function task(id: number, over: Partial<Task> = {}): Task {
  return {
    id, taskName: `T${id}`, assignee: "", assigneeEmail: "", dueDate: "", lastUpdateDate: "2026-01-01",
    priority: "Medium", status: "To Do", blockers: "", description: "", inquiriesSent: 0, dependencies: [],
    ...over,
  } as Task;
}

function raidItem(id: number): RaidItem {
  return { id, category: "R", title: `R${id}`, raisedDate: "2026-01-01", linkedTaskIds: [] } as unknown as RaidItem;
}

const DRAFT: LinkedTaskDraft = { taskName: "Child", assignee: "Ada", dueDate: "2026-11-01", priority: "High", direction: "successor" };

function makeDeps(over: Partial<TaskEditorCreateDeps> = {}): TaskEditorCreateDeps {
  return {
    tasksRef: { current: [task(1), task(2)] },
    raid: [raidItem(1), raidItem(2)],
    setTasks: vi.fn(),
    setRaid: vi.fn(),
    editingId: 1,
    today: TODAY,
    logActivity: vi.fn(),
    ...over,
  };
}

/** Runs every functional `setTasks` call in order over `start`. */
function applyTaskUpdates(setTasks: TaskEditorCreateDeps["setTasks"], start: readonly Task[]): readonly Task[] {
  return vi.mocked(setTasks).mock.calls.reduce<readonly Task[]>(
    (list, [arg]) => (typeof arg === "function" ? arg(list) : arg),
    start,
  );
}

beforeEach(() => {
  __resetMintStateForTests();
});

describe("useTaskEditorCreate — create RAID from the editor", () => {
  it("in edit mode applies at once: sanitized row linked to the edited task, logged with (id, category, title)", () => {
    const deps = makeDeps({ editingId: 7 });
    const { result } = renderHook(() => useTaskEditorCreate(deps));
    act(() => result.current.handleAddRaidFromEditor({ category: "bogus", title: "  Vendor slip  " }));

    expect(deps.setRaid).toHaveBeenCalledTimes(1);
    const next = vi.mocked(deps.setRaid).mock.calls[0][0] as RaidItem[];
    expect(next.slice(0, 2)).toEqual(deps.raid);
    const row = next[2];
    expect(row).toMatchObject({ id: 3, category: "R", title: "Vendor slip", raisedDate: TODAY, linkedTaskIds: [7] });
    // The SANITIZED category and title, three args — not the raw spec.
    expect(deps.logActivity).toHaveBeenCalledWith("raid.created", 3, "R", "Vendor slip");
    expect(result.current.editorBuffer.pendingRaid).toEqual([]);
  });

  it("skips a malformed spec: nothing stored, nothing logged", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useTaskEditorCreate(deps));
    act(() => result.current.handleAddRaidFromEditor({ category: "R", title: "   " }));
    expect(deps.setRaid).not.toHaveBeenCalled();
    expect(deps.logActivity).not.toHaveBeenCalled();
  });

  it("in create mode stages, and the flush mints distinct ids for back-to-back items linked to the new parent", () => {
    const deps = makeDeps({ editingId: null });
    const { result } = renderHook(() => useTaskEditorCreate(deps));
    act(() => {
      result.current.handleAddRaidFromEditor({ category: "R", title: "First" });
      result.current.handleAddRaidFromEditor({ category: "I", title: "Second" });
    });
    expect(deps.setRaid).not.toHaveBeenCalled();
    expect(result.current.editorBuffer.pendingRaid).toEqual([
      { category: "R", title: "First" },
      { category: "I", title: "Second" },
    ]);

    act(() => result.current.editorBuffer.flush(42));
    const calls = vi.mocked(deps.setRaid).mock.calls.map(([arg]) => arg as RaidItem[]);
    expect(calls).toHaveLength(2);
    expect(calls[1].map((r) => [r.id, r.title, r.linkedTaskIds])).toEqual([
      [1, "R1", []],
      [2, "R2", []],
      [3, "First", [42]],
      [4, "Second", [42]],
    ]);
    expect(result.current.editorBuffer.pendingRaid).toEqual([]);
  });

  it("mints from the latest RAID list after a rerender", () => {
    const deps = makeDeps();
    const { result, rerender } = renderHook((d: TaskEditorCreateDeps) => useTaskEditorCreate(d), { initialProps: deps });
    rerender({ ...deps, raid: [raidItem(1), raidItem(9)] });
    act(() => result.current.handleAddRaidFromEditor({ category: "R", title: "Late" }));
    const next = vi.mocked(deps.setRaid).mock.calls[0][0] as RaidItem[];
    expect(next.map((r) => r.id)).toEqual([1, 9, 10]);
  });
});

describe("useTaskEditorCreate — new linked task", () => {
  it("in edit mode commits the child, advances the task mirror, logs it, links it to the edited task and closes the modal", () => {
    const deps = makeDeps({ editingId: 1 });
    const { result } = renderHook(() => useTaskEditorCreate(deps));
    act(() => result.current.setLinkedTaskOpen(true));
    expect(result.current.linkedTaskOpen).toBe(true);

    act(() => result.current.handleCreateLinkedTask(DRAFT));

    const committed = vi.mocked(deps.setTasks).mock.calls[0][0] as Task[];
    const child = committed[2];
    expect(child).toMatchObject({
      id: 3, taskName: "Child", assignee: "Ada", assigneeEmail: "", dueDate: "2026-11-01", lastUpdateDate: TODAY,
      priority: "High", status: "To Do", completedDate: "", blockers: "", description: "", inquiriesSent: 0, dependencies: [],
    });
    expect(deps.tasksRef.current).toBe(committed);
    expect(deps.logActivity).toHaveBeenCalledWith("task.created", 3, "Child");
    // "successor": the child depends on the edited parent (FS).
    const final = applyTaskUpdates(deps.setTasks, [task(1), task(2)]);
    expect(final.find((t) => t.id === 3)?.dependencies).toEqual([{ taskId: 1, type: "FS" }]);
    expect(result.current.linkedTaskOpen).toBe(false);
    expect(result.current.editorBuffer.pendingLinks).toEqual([]);
  });

  it("in create mode stages the link and the flush wires it to the new parent", () => {
    const deps = makeDeps({ editingId: null });
    const { result } = renderHook(() => useTaskEditorCreate(deps));
    act(() => result.current.handleCreateLinkedTask({ ...DRAFT, direction: "predecessor" }));

    expect(vi.mocked(deps.setTasks).mock.calls).toHaveLength(1); // the child only
    expect(result.current.editorBuffer.pendingLinks).toEqual([{ childId: 3, direction: "predecessor", type: "FS" }]);

    act(() => result.current.editorBuffer.flush(1));
    // "predecessor": the parent depends on the child.
    const final = applyTaskUpdates(deps.setTasks, [task(1), task(2)]);
    expect(final.find((t) => t.id === 1)?.dependencies).toEqual([{ taskId: 3, type: "FS" }]);
  });

  it("mints back-to-back children from the advanced mirror", () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useTaskEditorCreate(deps));
    act(() => {
      result.current.handleCreateLinkedTask(DRAFT);
      result.current.handleCreateLinkedTask({ ...DRAFT, taskName: "Second" });
    });
    expect(deps.tasksRef.current.map((t) => t.id)).toEqual([1, 2, 3, 4]);
    expect(deps.logActivity).toHaveBeenCalledWith("task.created", 4, "Second");
  });
});

describe("useTaskEditorCreate — identity", () => {
  it("keeps the handlers and the buffer's flush/discard stable across a rerender with the same deps", () => {
    const deps = makeDeps();
    const { result, rerender } = renderHook((d: TaskEditorCreateDeps) => useTaskEditorCreate(d), { initialProps: deps });
    const first = result.current;
    rerender({ ...deps });
    expect(result.current.handleAddRaidFromEditor).toBe(first.handleAddRaidFromEditor);
    expect(result.current.handleCreateLinkedTask).toBe(first.handleCreateLinkedTask);
    expect(result.current.editorBuffer.flush).toBe(first.editorBuffer.flush);
    expect(result.current.editorBuffer.discard).toBe(first.editorBuffer.discard);
  });
});
