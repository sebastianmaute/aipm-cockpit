import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useNotesWindow } from "./use-notes-window";
import type { ChangeItem, RaidItem, Resource, Task } from "./types";

const RESOURCES: Resource[] = [
  { id: 1, firstName: "Alice", lastName: "Anders", roleId: null, utilizationMode: "percent", utilization: {} },
];

// Cast-built fixtures: only the fields this hook reads matter, and a full Task /
// RaidItem literal would bury them.
const TASKS = [
  {
    id: 7,
    taskName: "Draft charter",
    noteLog: [
      { id: 1, timestamp: "2026-01-01T10:00:00Z", html: "<p>Kickoff held</p>", text: "Kickoff held", authorResourceId: 1 },
    ],
  },
  { id: 8, taskName: "Other task" },
] as unknown as Task[];

const RAID = [{ id: 3, title: "Vendor delay" }] as unknown as RaidItem[];

const CHANGES = [
  {
    id: 5,
    title: "Scope cut",
    noteLog: [
      { id: 1, timestamp: "2026-02-01T09:00:00Z", html: "<p>CCB deferred</p>", text: "CCB deferred", authorResourceId: 1 },
    ],
  },
  { id: 6, title: "Budget uplift" },
] as unknown as ChangeItem[];

function setup() {
  const setTasks = vi.fn();
  const setRaid = vi.fn();
  const setChanges = vi.fn();
  const logActivity = vi.fn();
  const { result } = renderHook(() =>
    useNotesWindow({
      tasks: TASKS,
      raid: RAID,
      changes: CHANGES,
      setTasks,
      setRaid,
      setChanges,
      selfResourceId: 1,
      resources: RESOURCES,
      lang: "en-US",
      logActivity,
    }),
  );
  return { result, setTasks, setRaid, setChanges, logActivity };
}

describe("useNotesWindow — notePanelPropsFor", () => {
  it("resolves entries from the live entity while the floating window is SHUT", () => {
    const { result } = setup();
    // The gap this exists to close: `notesWindowProps` derives its entries from
    // `notesTarget`, which is null until the window opens — so the always-mounted
    // in-editor panel cannot reuse them.
    expect(result.current.notesTarget).toBeNull();
    expect(result.current.notesWindowProps.entries).toEqual([]);

    expect(result.current.notePanelPropsFor("task", 7).entries).toHaveLength(1);
    expect(result.current.notePanelPropsFor("task", 8).entries).toEqual([]);
  });

  it("carries a labelSuffix so a second mounted surface cannot collide", () => {
    const { result } = setup();
    // ★ REQUIRED here, unlike the floating window (whose dialog label already
    //   names the entity): with both surfaces open on one task an absent suffix
    //   renders two identical "Edit – #1" buttons. axe checks that a name EXISTS,
    //   never that it is unique, so no gate would catch the regression.
    expect(result.current.notePanelPropsFor("task", 7).labelSuffix).toBe("Draft charter");
    expect(result.current.notePanelPropsFor("raid", 3).labelSuffix).toBe("Vendor delay");
  });

  it("writes an added note straight through to the workspace", () => {
    const { result, setTasks, logActivity } = setup();
    result.current.notePanelPropsFor("task", 7).onAdd("<p>New</p>", "New");

    expect(setTasks).toHaveBeenCalledTimes(1);
    // Functional setter — the bulk "N saves in one tick" landmine.
    expect(typeof setTasks.mock.calls[0][0]).toBe("function");

    // ★★ APPLY the updater. Asserting only that a function was passed accepts
    // `setTasks(prev => prev)` — a no-op write — so the whole
    // `prev.map(tk => tk.id === id ? {...tk, noteLog: addNote(...)} : tk)`
    // composition was verified nowhere (notes-window.test.tsx renders the
    // presentational panel with mock callbacks and never reaches this).
    const next = (setTasks.mock.calls[0][0] as (p: Task[]) => Task[])(TASKS);
    expect(next.find((t) => t.id === 7)?.noteLog).toHaveLength(2);
    // ★ ID ROUTING. logActivity's label comes from a SEPARATE lookup, so without
    // this a handler writing the note to the WRONG task still passes every
    // assertion above — including the one naming "Draft charter".
    expect(next.find((t) => t.id === 8)?.noteLog).toBeUndefined();

    expect(logActivity).toHaveBeenCalledWith("task.updated", 7, "Draft charter");
  });
});

describe("useNotesWindow — the change arm", () => {
  type ChangeUpdater = (prev: ChangeItem[]) => ChangeItem[];

  it("opens, adds and edits a note on a change", () => {
    const { result, setChanges, logActivity } = setup();
    expect(result.current.notesTarget).toBeNull();

    act(() => {
      result.current.openChangeNotes(5);
    });
    expect(result.current.notesTarget).toEqual({ kind: "change", id: 5 });
    // The floating window now resolves THIS change's log and its display name
    // (`title`, not `name` — a change has no `name` field).
    expect(result.current.notesWindowProps.entries).toHaveLength(1);
    expect(result.current.notesWindowProps.entityLabel).toBe("Scope cut");

    act(() => {
      result.current.notesWindowProps.onAdd("<p>CCB approved</p>", "CCB approved");
    });
    expect(setChanges).toHaveBeenCalledTimes(1);
    // Functional setter — the bulk "N saves in one tick" landmine.
    expect(typeof setChanges.mock.calls[0][0]).toBe("function");

    // ★★ APPLY the updater: asserting only that a function was passed accepts
    // `setChanges(prev => prev)`, a no-op write that verifies nothing.
    const added = (setChanges.mock.calls[0][0] as ChangeUpdater)(CHANGES as ChangeItem[]);
    expect(added.find((c) => c.id === 5)?.noteLog).toHaveLength(2);
    // ★ ID ROUTING. logActivity's label comes from a SEPARATE lookup, so a
    // handler writing the note to the WRONG change still satisfies everything
    // above — including the assertion naming "Scope cut".
    expect(added.find((c) => c.id === 6)?.noteLog).toBeUndefined();
    expect(logActivity).toHaveBeenCalledWith("change.updated", 5, "Scope cut");

    act(() => {
      result.current.notesWindowProps.onEdit(1, "<p>Amended</p>", "Amended");
    });
    const edited = (setChanges.mock.calls[1][0] as ChangeUpdater)(CHANGES as ChangeItem[]);
    expect(edited.find((c) => c.id === 5)?.noteLog?.[0].text).toBe("Amended");
    expect(edited.find((c) => c.id === 5)?.noteLog).toHaveLength(1);
  });

  it("deletes a note on a change through the same write path", () => {
    const { result, setChanges } = setup();
    act(() => {
      result.current.openChangeNotes(5);
    });
    act(() => {
      result.current.notesWindowProps.onDelete(1);
    });
    const next = (setChanges.mock.calls[0][0] as ChangeUpdater)(CHANGES as ChangeItem[]);
    expect(next.find((c) => c.id === 5)?.noteLog).toEqual([]);
  });

  it("serves the in-editor panel from the live change while the window is SHUT", () => {
    const { result } = setup();
    expect(result.current.notesTarget).toBeNull();
    expect(result.current.notePanelPropsFor("change", 5).entries).toHaveLength(1);
    expect(result.current.notePanelPropsFor("change", 6).entries).toEqual([]);
    // labelSuffix keeps a second mounted surface's per-entry controls unique.
    expect(result.current.notePanelPropsFor("change", 5).labelSuffix).toBe("Scope cut");
  });

  // ★★★ WRITE-THROUGH. The log is owned by the notes window, NOT by the change
  // editor's draft: `handleSaveChange` reads `noteLog` back from the STORED row
  // (Task 5), so routing a note commit through it would read the note back out
  // and LOSE it. This pins that the panel's onAdd lands in `changes` directly —
  // `setChanges` is the only setter it touches.
  it("writes a note straight into `changes`, never through a change-save handler", () => {
    const { result, setChanges, setTasks, setRaid } = setup();
    result.current.notePanelPropsFor("change", 5).onAdd("<p>From the editor</p>", "From the editor");

    expect(setChanges).toHaveBeenCalledTimes(1);
    expect(setTasks).not.toHaveBeenCalled();
    expect(setRaid).not.toHaveBeenCalled();
    const next = (setChanges.mock.calls[0][0] as ChangeUpdater)(CHANGES as ChangeItem[]);
    const row = next.find((c) => c.id === 5);
    expect(row?.noteLog?.map((n) => n.text)).toEqual(["CCB deferred", "From the editor"]);
    // The write stamps localModifiedAt like every other note write.
    expect(typeof row?.localModifiedAt).toBe("string");
  });
});
