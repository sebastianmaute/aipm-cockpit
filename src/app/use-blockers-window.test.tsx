import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { useBlockersWindow } from "./use-blockers-window";
import { useUndoStack } from "./undo/use-undo-stack";
import type { Resource, Task } from "./types";
import type { Lang } from "./i18n";

const RESOURCES: Resource[] = [
  { id: 1, firstName: "Alice", lastName: "Anders", roleId: null, utilizationMode: "percent", utilization: {} },
];

// Cast-built: only the fields this hook reads matter.
const TASKS = [
  { id: 7, taskName: "Draft charter", blockers: "" },
  { id: 8, taskName: "Other task", blockers: "" },
] as unknown as Task[];

/** The hook over REAL state, so functional updates chain exactly as they do in
 *  the app — a `vi.fn()` setter could not show two adds in one tick landing. */
function setup(selfResourceId: number | null = 1) {
  const logActivity = vi.fn();
  const { result } = renderHook(() => {
    const [tasks, setTasks] = useState<readonly Task[]>(TASKS);
    const win = useBlockersWindow({ tasks, setTasks, selfResourceId, resources: RESOURCES, lang: "en-US", logActivity, loadPending: false });
    return { tasks, setTasks, win };
  });
  return { result, logActivity };
}

const task7 = (tasks: readonly Task[]) => tasks.find((tk) => tk.id === 7)!;

describe("useBlockersWindow", () => {
  it("is closed until a task is opened, then targets that task", () => {
    const { result } = setup();
    expect(result.current.win.blockersWindowProps.open).toBe(false);
    act(() => result.current.win.openTaskBlockers(7));
    expect(result.current.win.blockersWindowProps.open).toBe(true);
    expect(result.current.win.blockersWindowProps.entityLabel).toBe("Draft charter");
    expect(result.current.win.blockersWindowProps.taskId).toBe(7);
    act(() => result.current.win.blockersWindowProps.onClose());
    expect(result.current.win.blockersWindowProps.open).toBe(false);
  });

  it("two quick adds get distinct ids and both land", () => {
    const { result } = setup();
    act(() => result.current.win.openTaskBlockers(7));
    act(() => {
      result.current.win.blockersWindowProps.onAdd("First");
      result.current.win.blockersWindowProps.onAdd("Second");
    });
    const log = task7(result.current.tasks).blockerLog ?? [];
    expect(log.map((e) => [e.id, e.text])).toEqual([
      [1, "First"],
      [2, "Second"],
    ]);
    expect(task7(result.current.tasks).blockers).toBe("First\nSecond");
    expect(result.current.win.blockersWindowProps.entries).toHaveLength(2);
  });

  it("a no-op write (blank add, unknown entry) neither writes the row nor logs activity", () => {
    const { result, logActivity } = setup();
    act(() => result.current.win.openTaskBlockers(7));
    const before = result.current.tasks;
    act(() => {
      result.current.win.blockersWindowProps.onAdd("   ");
      result.current.win.blockersWindowProps.onResolve(99);
      result.current.win.blockersWindowProps.onDelete(99);
    });
    // Same array by reference: no setTasks write, no localModifiedAt stamp.
    expect(result.current.tasks).toBe(before);
    expect(logActivity).not.toHaveBeenCalled();
    // Positive control: a real add writes and logs exactly once.
    act(() => result.current.win.blockersWindowProps.onAdd("Real"));
    expect(result.current.tasks).not.toBe(before);
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith("task.updated", 7, "Draft charter");
  });

  // A double-click on Resolve: React re-renders between the two discrete
  // clicks, so the second sees the entry already resolved — the mutator hands
  // the row back and nothing is written or logged. Same for an edit that
  // changes nothing.
  it("a second resolve of the same entry, or an unchanged edit, writes and logs nothing", () => {
    const { result, logActivity } = setup();
    act(() => result.current.win.openTaskBlockers(7));
    act(() => result.current.win.blockersWindowProps.onAdd("One"));
    act(() => result.current.win.blockersWindowProps.onResolve(1));
    expect(task7(result.current.tasks).blockerLog?.[0]?.resolvedAt).toEqual(expect.any(String));
    expect(logActivity).toHaveBeenCalledTimes(2);
    const before = result.current.tasks;
    act(() => result.current.win.blockersWindowProps.onResolve(1));
    act(() => result.current.win.blockersWindowProps.onEdit(1, " One "));
    expect(result.current.tasks).toBe(before);
    expect(task7(result.current.tasks).blockerLog?.[0]?.editedAt).toBeUndefined();
    expect(logActivity).toHaveBeenCalledTimes(2);
  });

  it("stamps the self resource as the author", () => {
    const { result } = setup();
    act(() => result.current.win.openTaskBlockers(7));
    act(() => result.current.win.blockersWindowProps.onAdd("Mine"));
    expect(task7(result.current.tasks).blockerLog?.[0]).toMatchObject({
      authorResourceId: 1,
      authorName: "Alice Anders",
    });
  });

  it("adds with no author when no self resource is set", () => {
    const { result } = setup(null);
    act(() => result.current.win.openTaskBlockers(7));
    act(() => result.current.win.blockersWindowProps.onAdd("Anon"));
    const entry = task7(result.current.tasks).blockerLog?.[0];
    expect(entry?.text).toBe("Anon");
    expect(entry && "authorResourceId" in entry).toBe(false);
    expect(entry && "authorName" in entry).toBe(false);
  });

  it("a write targets the stored row", () => {
    const { result } = setup();
    act(() => result.current.win.openTaskBlockers(7));
    // A concurrent writer changes the row after the window opened.
    act(() =>
      result.current.setTasks((prev) =>
        prev.map((tk) => (tk.id === 7 ? { ...tk, taskName: "Renamed", priority: "High" } : tk)),
      ),
    );
    act(() => result.current.win.blockersWindowProps.onAdd("Waiting"));
    const row = task7(result.current.tasks);
    expect(row.taskName).toBe("Renamed");
    expect(row.priority).toBe("High");
    expect(row.blockerLog?.map((e) => e.text)).toEqual(["Waiting"]);
    // The other task is untouched (same reference).
    expect(result.current.tasks.find((tk) => tk.id === 8)).toBe(TASKS[1]);
  });

  it("each action logs task.updated with the task id", () => {
    const { result, logActivity } = setup();
    act(() => result.current.win.openTaskBlockers(7));
    const props = () => result.current.win.blockersWindowProps;
    act(() => props().onAdd("One"));
    act(() => props().onEdit(1, "One edited"));
    act(() => props().onResolve(1));
    act(() => props().onReopen(1));
    act(() => props().onDelete(1));

    expect(logActivity).toHaveBeenCalledTimes(5);
    for (const call of logActivity.mock.calls) {
      expect(call).toEqual(["task.updated", 7, "Draft charter"]);
    }
    expect(task7(result.current.tasks).blockerLog).toEqual([]);
  });

  it("edit, resolve and reopen change the stored entry", () => {
    const { result } = setup();
    act(() => result.current.win.openTaskBlockers(7));
    const props = () => result.current.win.blockersWindowProps;
    act(() => props().onAdd("One"));
    act(() => props().onEdit(1, "One edited"));
    expect(task7(result.current.tasks).blockers).toBe("One edited");
    act(() => props().onResolve(1));
    expect(task7(result.current.tasks).blockerLog?.[0].resolvedAt).toEqual(expect.any(String));
    expect(task7(result.current.tasks).blockers).toBe("");
    act(() => props().onReopen(1));
    expect(task7(result.current.tasks).blockerLog?.[0].resolvedAt).toBeUndefined();
    expect(task7(result.current.tasks).blockers).toBe("One edited");
  });

  it("writes nothing while the window is closed", () => {
    const { result, logActivity } = setup();
    act(() => result.current.win.blockersWindowProps.onAdd("Ignored"));
    expect(task7(result.current.tasks).blockerLog).toBeUndefined();
    expect(logActivity).not.toHaveBeenCalled();
  });
});

// §662: the target id must not outlive its row or a load hold.
describe("useBlockersWindow — target lifetime (§662)", () => {
  function setupProps() {
    return renderHook(
      ({ tasks, loadPending }: { tasks: readonly Task[]; loadPending: boolean }) =>
        useBlockersWindow({
          tasks,
          setTasks: vi.fn(),
          selfResourceId: 1,
          resources: RESOURCES,
          lang: "en-US",
          logActivity: vi.fn(),
          loadPending,
        }),
      { initialProps: { tasks: TASKS as readonly Task[], loadPending: false } },
    );
  }

  it("closes when the target row is deleted and stays closed when the id returns", () => {
    const { result, rerender } = setupProps();
    act(() => result.current.openTaskBlockers(7));
    expect(result.current.blockersWindowProps.open).toBe(true);
    rerender({ tasks: [TASKS[1]], loadPending: false });
    expect(result.current.blockersWindowProps.open).toBe(false);
    // Cleared, not hidden: a row with the same id coming back does not reopen it.
    rerender({ tasks: TASKS, loadPending: false });
    expect(result.current.blockersWindowProps.open).toBe(false);
    expect(result.current.blockersWindowProps.taskId).toBeNull();
  });

  it("closes while a load holds the tree and stays closed afterwards", () => {
    const { result, rerender } = setupProps();
    act(() => result.current.openTaskBlockers(7));
    rerender({ tasks: TASKS, loadPending: true });
    expect(result.current.blockersWindowProps.open).toBe(false);
    rerender({ tasks: TASKS, loadPending: false });
    expect(result.current.blockersWindowProps.open).toBe(false);
  });
});

describe("useBlockersWindow — undo", () => {
  // ★ Blocker writes are write-through (WRITE_THROUGH_FIELDS): a whole-row undo
  // of an UNRELATED edit restores the row image but keeps the live blocker pair,
  // so an entry the window added after that edit survives.
  it("a whole-row undo of an unrelated edit keeps a window-added blocker entry", () => {
    const { result } = renderHook(() => {
      const [tasks, setTasks] = useState<readonly Task[]>(TASKS);
      const undoApi = useUndoStack({ lang: "en-US" as Lang, logActivity: vi.fn(), showToast: vi.fn(), showToastAction: vi.fn() });
      const win = useBlockersWindow({ tasks, setTasks, selfResourceId: 1, resources: RESOURCES, lang: "en-US", logActivity: vi.fn(), loadPending: false });
      return { tasks, setTasks, undoApi, win };
    });
    // An unrelated whole-row edit, captured the way a cascade/dedup op does.
    act(() => {
      result.current.undoApi.capture({ setter: result.current.setTasks, kind: "task.updated", edited: [TASKS[0]], fromArray: TASKS });
      result.current.setTasks((prev) => prev.map((tk) => (tk.id === 7 ? { ...tk, priority: "High" } : tk)));
    });
    act(() => result.current.win.openTaskBlockers(7));
    act(() => result.current.win.blockersWindowProps.onAdd("Added after the edit"));
    expect(result.current.undoApi.stack).toHaveLength(1);

    act(() => result.current.undoApi.undo());
    const row = task7(result.current.tasks);
    // The edit is undone…
    expect(row.priority).toBeUndefined();
    // …and the window entry, with its derived text, is kept.
    expect(row.blockerLog?.map((e) => e.text)).toEqual(["Added after the edit"]);
    expect(row.blockers).toBe("Added after the edit");
  });
});
