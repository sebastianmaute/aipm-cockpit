import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useNotesWindow } from "./use-notes-window";
import type { RaidItem, Resource, Task } from "./types";

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

function setup() {
  const setTasks = vi.fn();
  const setRaid = vi.fn();
  const logActivity = vi.fn();
  const { result } = renderHook(() =>
    useNotesWindow({
      tasks: TASKS,
      raid: RAID,
      setTasks,
      setRaid,
      selfResourceId: 1,
      resources: RESOURCES,
      lang: "en-US",
      logActivity,
    }),
  );
  return { result, setTasks, setRaid, logActivity };
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
    expect(logActivity).toHaveBeenCalledWith("task.updated", 7, "Draft charter");
  });
});
