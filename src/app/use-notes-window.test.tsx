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

// ★ `category` is REAL here, not left to default blank: the raid activity call
//   logs (id, category, title), and against a blank category the arity
//   assertion below could not tell slot 1 from slot 2 — a "wrong field in slot
//   1" mutation would still pass.
const RAID = [{ id: 3, category: "R", title: "Vendor delay" }] as unknown as RaidItem[];

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

  it("logs a RAID note write with ALL THREE template arguments", () => {
    const { result, setRaid, logActivity } = setup();
    result.current.notePanelPropsFor("raid", 3).onAdd("<p>New</p>", "New");

    expect(setRaid).toHaveBeenCalledTimes(1);
    const next = (setRaid.mock.calls[0][0] as (p: RaidItem[]) => RaidItem[])(RAID);
    expect(next.find((r) => r.id === 3)?.noteLog).toHaveLength(1);

    // ★★★ ARITY, and nothing else pins it. `activityRaidUpdated` is
    //   "RAID #{0} updated ({1}): {2}" — THREE placeholders — while
    //   `logActivity` ends in `...args`, so a two-arg call COMPILES and the
    //   suite stays green. It shipped exactly that way: the title landed in the
    //   CATEGORY slot and a literal "{2}" was rendered to the user in the
    //   Activity panel and, since search_history, fed to the model too.
    //   `use-resource-planner.test.tsx` pins its OWN raid path — a different
    //   function with a different arg list — so it is not coverage for this one.
    expect(logActivity).toHaveBeenCalledWith("raid.updated", 3, "R", "Vendor delay");

    // ★ THREE call sites share this shape, and onAdd alone leaves two unpinned;
    //   the arity was dropped independently at each one.
    result.current.notePanelPropsFor("raid", 3).onEdit(1, "<p>Edited</p>", "Edited");
    result.current.notePanelPropsFor("raid", 3).onDelete(1);
    expect(logActivity).toHaveBeenCalledTimes(3);
    expect(logActivity.mock.calls[1]).toEqual(["raid.updated", 3, "R", "Vendor delay"]);
    expect(logActivity.mock.calls[2]).toEqual(["raid.updated", 3, "R", "Vendor delay"]);
  });
});
