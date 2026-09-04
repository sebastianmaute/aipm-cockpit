import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  dispatcherWrapper,
  dispatcherWrapperWith,
  makeDispatcherArgs,
} from "../test/chat-dispatcher-fixture";
import { type ToolDispatcher } from "./chat-tools";
import { type TestSeed } from "./test-providers";
import {
  DEFAULT_TASK_STATUS,
  type ChangeItem,
  type Milestone,
  type RaidItem,
  type Resource,
  type Stakeholder,
  type Task,
} from "./types";
import { useChatDispatcher } from "./use-chat-dispatcher";

/** A minimal VALID `Task` — every non-optional field of the type, nothing more.
 *  Seeded through `dispatcherWrapper`, which is the ONLY way to give the hook a
 *  task list (`makeDispatcherArgs` has no `initialTasks`; see the fixture). */
function seedTask(id: number, taskName: string): Task {
  return {
    id,
    taskName,
    assignee: "M. Jordan",
    assigneeEmail: "",
    dueDate: "2026-09-30",
    lastUpdateDate: "2026-05-19",
    priority: "Medium",
    status: DEFAULT_TASK_STATUS,
    blockers: "",
    description: "",
  };
}

// CHARACTERIZATION (RED by design until the capture lands): every HUMAN write
// path goes through the shipped undo stack (`undo/use-undo-stack.ts`); the AI
// tool-call path is the one writer that bypasses it, so an AI write is
// unrecoverable. This file pins the contract that closes that gap.
describe("AI writes capture undo", () => {
  test("createTask captures NO undo entry — the engine cannot reverse a create", () => {
    // ★★★ NOT AN OMISSION. `UndoOp` is "delete" | "edit" (undo-stack.ts) and the
    //   undo direction never removes. A create captured as a `removed` image is
    //   WORSE than no capture: the row is still live at undo time, so
    //   applyUndoRestoreWithRemap takes its id-reuse branch, mints max+1 and
    //   splices in a SECOND copy — undoing a create DUPLICATES the row.
    //   Adding a capture here is a regression, not a completion. Creates are
    //   protected by the staging gate instead (a turn writing >1 row stages).
    const captureComposite = vi.fn();
    const existing = [seedTask(1, "First"), seedTask(2, "Second")];
    const { result } = renderHook(
      () => useChatDispatcher(makeDispatcherArgs({ undo: { captureComposite } })),
      { wrapper: dispatcherWrapper(existing) },
    );

    let created: Task | undefined;
    act(() => {
      created = result.current.createTask({
        taskName: "Third",
        assignee: "M. Jordan",
        dueDate: "2026-09-30",
      });
    });

    // ★ POSITIVE OBSERVABLE FIRST — a `not.toHaveBeenCalled()` is vacuous when
    //   the path never ran, and would pass just as well if `createTask` threw on
    //   its first line. These two assertions prove the create actually happened:
    //   the row was minted (id 3 = max+1 over the seeded two) and it carries the
    //   requested name, so the absence below is an absence ON A LIVE PATH.
    expect(created?.id).toBe(3);
    expect(created?.taskName).toBe("Third");

    expect(captureComposite).not.toHaveBeenCalled();
  });

  test("updateTask captures the PRE-edit row as an edit image", () => {
    // The image must hold the value as it was BEFORE the edit. Capturing the
    // merged row would store the new values as the "before" image and undo
    // would be a silent no-op — green against a wrong implementation.
    const captureComposite = vi.fn();
    const existing = [seedTask(1, "First"), seedTask(2, "Before")];
    const { result } = renderHook(
      () => useChatDispatcher(makeDispatcherArgs({ undo: { captureComposite } })),
      { wrapper: dispatcherWrapper(existing) },
    );

    // ★ No `= null` initializer: control-flow analysis does not follow the
    //   assignment inside the `act` closure, so an initialized `let` narrows to
    //   `null` and `updated?.taskName` fails tsc as `never` (vitest is green
    //   either way — the build-vs-tsc split AGENTS.md warns about).
    let updated: Task | null | undefined;
    act(() => {
      updated = result.current.updateTask(2, { taskName: "After" });
    });

    // Positive observable: the edit really landed, so what follows is an
    // assertion about a LIVE path rather than about an early throw.
    expect(updated?.taskName).toBe("After");
    expect(result.current.getTask(2)?.taskName).toBe("After");

    expect(captureComposite).toHaveBeenCalledTimes(1);
    const opts = captureComposite.mock.calls[0][0];
    expect(opts.kind).toBe("task.updated");
    expect(opts.primaryCount).toBe(1);
    expect(opts.parts[0]).not.toBeNull();
    expect(opts.name).toBe("Before");

    // ★★★ THE LOAD-BEARING ASSERTION, AND IT HAS TO BE A ROUND-TRIP.
    //   `capturePart` returns `{ isPrimary, restore }` — the before-images are
    //   CLOSED OVER, never exposed — so NOTHING reachable off the mock's
    //   argument can tell an `edited: [existing]` capture from an
    //   `edited: [mergedBase]` one: both build exactly one non-null fragment.
    //   Every assertion above therefore survives that mutant. Running the
    //   fragment's own restore thunk is the only way to observe WHICH row was
    //   captured: against the pre-edit image it reverts the name to "Before";
    //   against the merged row it writes "After" back over "After" — a silent
    //   no-op, which is precisely the defect this test exists to catch.
    act(() => {
      opts.parts[0].restore({ current: new Map<number, number>() }, true);
    });
    expect(result.current.getTask(2)?.taskName).toBe("Before");
    // The op touched ONLY the row it captured — row 1 is untouched, so the
    // revert is not a wholesale rewrite of the list.
    expect(result.current.getTask(1)?.taskName).toBe("First");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Every REMAINING update/delete writer on the assistant's tool surface.
 *
 * ★★★ THE SITE LIST WAS BUILT FROM THE CODE, NOT FROM THE TOOL NAMES, and the
 * two disagree. `grep "^      \(create\|update\|delete\)[A-Za-z]*: ("` over
 * use-chat-dispatcher.ts finds EIGHT methods and is wrong twice over: it misses
 * `setTaskDependencies` (a real task edit whose name starts with neither verb —
 * its own body already calls itself "the 21st writer ... a grep structurally
 * cannot find"), and the register writers do not live in that file at all.
 * RAID / changes / milestones / stakeholders are in `use-register-tools.ts`,
 * reached through the same dispatcher object by spread. Enumerate with:
 *   grep -nE "^\s+(create|update|delete)[A-Z][A-Za-z0-9_]*:" \
 *     src/app/use-chat-dispatcher.ts src/app/use-register-tools.ts
 * plus `setTaskDependencies` by hand.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Minimal VALID rows for the non-task slices — every non-optional field of the
 *  type and nothing more, the same rule `seedTask` follows. A `{id, name}` stub
 *  is NOT interchangeable: each update writer runs its row through a sanitizer
 *  that returns null for an invalid shape and then THROWS, so a lazy fixture
 *  fails as "invalid update" rather than as a missing capture. */
function seedRaid(id: number, title: string): RaidItem {
  return {
    id, category: "R", title, status: "Open",
    linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-05-01",
  };
}
function seedChange(id: number, title: string): ChangeItem {
  return {
    id, title, description: "", type: "Scope", status: "Proposed",
    raisedDate: "2026-05-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
  };
}
function seedMilestone(id: number, name: string): Milestone {
  return { id, name, date: "2026-06-30", linkedTaskIds: [] };
}
function seedStakeholder(id: number, name: string): Stakeholder {
  return { id, name, category: "Internal", influence: "High", interest: "High", raci: {} };
}
function seedResource(id: number, firstName: string): Resource {
  return {
    id, firstName, lastName: "Jordan",
    roleId: null, utilizationMode: "percent", utilization: {},
  };
}

/** THREE rows per slice, ids 1-2-3, and every write below targets id 2 — the
 *  MIDDLE one. Deleting a head or tail row makes index 0 (or `length`)
 *  accidentally correct, so a restore-index assertion against such a fixture
 *  passes whether or not `fromArray` is the pre-op array. */
const SEED: TestSeed = {
  tasks: [seedTask(1, "First"), seedTask(2, "Before"), seedTask(3, "Third")],
  resources: [seedResource(1, "Ada"), seedResource(2, "Grace"), seedResource(3, "Alan")],
  raid: [seedRaid(1, "R1"), seedRaid(2, "R2"), seedRaid(3, "R3")],
  changes: [seedChange(1, "C1"), seedChange(2, "C2"), seedChange(3, "C3")],
  milestones: [seedMilestone(1, "M1"), seedMilestone(2, "M2"), seedMilestone(3, "M3")],
  stakeholders: [seedStakeholder(1, "S1"), seedStakeholder(2, "S2"), seedStakeholder(3, "S3")],
};

interface SiteRow {
  /** The dispatcher method under test — also the `test.each` title. */
  site: string;
  act: (d: ToolDispatcher) => void;
  /** Reads state back to prove the write LANDED. Without it a capture
   *  assertion is untethered: every update writer returns null and every
   *  delete returns false from its own `!existing` guard, and
   *  `setTaskDependencies` returns a fully-formed object from BOTH of its
   *  refuse-to-write early returns. */
  verify: (d: ToolDispatcher) => void;
  kind: string;
  entityKey: string;
  primaryCount: number;
}

const SITES: SiteRow[] = [
  {
    site: "updateTask",
    act: (d) => { d.updateTask(2, { taskName: "After" }); },
    verify: (d) => { expect(d.getTask(2)?.taskName).toBe("After"); },
    kind: "task.updated", entityKey: "task", primaryCount: 1,
  },
  {
    site: "setTaskDependencies",
    act: (d) => { d.setTaskDependencies(2, [{ taskId: 1, type: "FS" }]); },
    verify: (d) => { expect(d.getTask(2)?.dependencies?.length).toBe(1); },
    kind: "task.updated", entityKey: "task", primaryCount: 1,
  },
  {
    site: "deleteTask",
    act: (d) => { d.deleteTask(2); },
    verify: (d) => { expect(d.getTask(2)).toBeNull(); },
    kind: "task.deleted", entityKey: "task", primaryCount: 1,
  },
  {
    site: "deleteAllTasks",
    act: (d) => { d.deleteAllTasks(); },
    verify: (d) => { expect(d.listTasks()).toHaveLength(0); },
    // ★ `bulk.delete`, and `primaryCount` is the SEEDED count, not 1 — the
    //   badge counts the rows the user loses, not the calls made.
    kind: "bulk.delete", entityKey: "task", primaryCount: 3,
  },
  {
    site: "updateResource",
    act: (d) => { d.updateResource(2, { department: "PMO" }); },
    verify: (d) => { expect(d.getResourceRow(2)?.department).toBe("PMO"); },
    kind: "resource.updated", entityKey: "resource", primaryCount: 1,
  },
  {
    site: "deleteResource",
    act: (d) => { d.deleteResource(2); },
    verify: (d) => { expect(d.getResourceRow(2)).toBeNull(); },
    kind: "resource.deleted", entityKey: "resource", primaryCount: 1,
  },
  {
    site: "updateRaid",
    act: (d) => { d.updateRaid(2, { title: "After" }); },
    verify: (d) => { expect(d.getRaidRow(2)?.title).toBe("After"); },
    kind: "raid.updated", entityKey: "raid", primaryCount: 1,
  },
  {
    site: "deleteRaid",
    act: (d) => { d.deleteRaid(2); },
    verify: (d) => { expect(d.getRaidRow(2)).toBeNull(); },
    kind: "raid.deleted", entityKey: "raid", primaryCount: 1,
  },
  {
    site: "updateChange",
    act: (d) => { d.updateChange(2, { title: "After" }); },
    verify: (d) => { expect(d.getChangeRow(2)?.title).toBe("After"); },
    kind: "change.updated", entityKey: "change", primaryCount: 1,
  },
  {
    site: "deleteChange",
    act: (d) => { d.deleteChange(2); },
    verify: (d) => { expect(d.getChangeRow(2)).toBeNull(); },
    kind: "change.deleted", entityKey: "change", primaryCount: 1,
  },
  {
    site: "updateMilestone",
    act: (d) => { d.updateMilestone(2, { name: "After" }); },
    verify: (d) => { expect(d.getMilestoneRow(2)?.name).toBe("After"); },
    kind: "milestone.updated", entityKey: "milestone", primaryCount: 1,
  },
  {
    site: "deleteMilestone",
    act: (d) => { d.deleteMilestone(2); },
    verify: (d) => { expect(d.getMilestoneRow(2)).toBeNull(); },
    kind: "milestone.deleted", entityKey: "milestone", primaryCount: 1,
  },
  {
    site: "updateStakeholder",
    act: (d) => { d.updateStakeholder(2, { name: "After" }); },
    verify: (d) => { expect(d.getStakeholderRow(2)?.name).toBe("After"); },
    kind: "stakeholder.updated", entityKey: "stakeholder", primaryCount: 1,
  },
  {
    site: "deleteStakeholder",
    act: (d) => { d.deleteStakeholder(2); },
    verify: (d) => { expect(d.getStakeholderRow(2)).toBeNull(); },
    kind: "stakeholder.deleted", entityKey: "stakeholder", primaryCount: 1,
  },
];

describe("every AI update and delete captures undo", () => {
  test.each(SITES)(
    "$site captures one composite entry",
    ({ act: write, verify, kind, entityKey, primaryCount }) => {
      const captureComposite = vi.fn();
      const { result } = renderHook(
        () => useChatDispatcher(makeDispatcherArgs({ undo: { captureComposite } })),
        { wrapper: dispatcherWrapperWith(SEED) },
      );

      act(() => { write(result.current); });
      verify(result.current); // the write landed — see `verify`'s doc

      expect(captureComposite).toHaveBeenCalledTimes(1);
      const opts = captureComposite.mock.calls[0][0];
      expect(opts.kind).toBe(kind);
      expect(opts.entityKey).toBe(entityKey);
      expect(opts.primaryCount).toBe(primaryCount);
      expect(opts.parts[0]).not.toBeNull();
    },
  );

  // ★★★ THE TABLE ABOVE CANNOT SEE A WRONG BEFORE-IMAGE. `capturePart` returns
  // `{ isPrimary, restore }` and closes over its images, so `kind`,
  // `entityKey`, `primaryCount` and `parts[0] !== null` are BYTE-IDENTICAL
  // whether the site captured the correct pre-op row or the wrong post-op one.
  // Fourteen green rows prove only that *a* capture happened. The two tests
  // below run a fragment's own restore thunk, which is the only way to observe
  // WHICH image went in — one per op, on an entity the `updateTask` test above
  // does not already cover.

  test("updateRaid captures the PRE-edit row, not the merged one", () => {
    const captureComposite = vi.fn();
    const { result } = renderHook(
      () => useChatDispatcher(makeDispatcherArgs({ undo: { captureComposite } })),
      { wrapper: dispatcherWrapperWith(SEED) },
    );

    act(() => { result.current.updateRaid(2, { title: "After" }); });
    expect(result.current.getRaidRow(2)?.title).toBe("After");

    const opts = captureComposite.mock.calls[0][0];
    act(() => {
      opts.parts[0].restore({ current: new Map<number, number>() }, true);
    });
    // Against the stored row this reverts to "R2"; against `merged` it writes
    // "After" back over "After" — a silent no-op the table cannot distinguish.
    expect(result.current.getRaidRow(2)?.title).toBe("R2");
    // Only the captured row moved — this is not a wholesale list rewrite.
    expect(result.current.getRaidRow(1)?.title).toBe("R1");
  });

  test("deleteChange restores the row at its OWN index, not at the head", () => {
    const captureComposite = vi.fn();
    const { result } = renderHook(
      () => useChatDispatcher(makeDispatcherArgs({ undo: { captureComposite } })),
      { wrapper: dispatcherWrapperWith(SEED) },
    );

    act(() => { result.current.deleteChange(2); });
    expect(result.current.listChanges().map((c) => c.id)).toEqual([1, 3]);

    const opts = captureComposite.mock.calls[0][0];
    act(() => {
      opts.parts[0].restore({ current: new Map<number, number>() }, true);
    });
    // ★★★ THE ORDER IS THE ASSERTION, NOT THE PRESENCE. `capturePart` resolves
    // the image's index with `Math.max(0, fromArray.findIndex(...))`, so a
    // post-op `fromArray` yields -1 → 0 and the row comes back at the HEAD:
    // [2, 1, 3]. A `toContain`-style presence check passes against both, which
    // is why the middle row and the full-order comparison both matter.
    expect(result.current.listChanges().map((c) => c.id)).toEqual([1, 2, 3]);
  });
});
