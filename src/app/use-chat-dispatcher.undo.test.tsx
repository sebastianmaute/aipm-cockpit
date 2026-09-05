import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  dispatcherWrapper,
  dispatcherWrapperWith,
  makeDispatcherArgs,
} from "../test/chat-dispatcher-fixture";
import { type ToolDispatcher } from "./chat-tools";
import { __resetMintStateForTests } from "./id-mint-session";
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
import { capturePart, useUndoStack } from "./undo/use-undo-stack";
import { useWorkspace } from "./workspace-context";

// ★★★ THE MINTER IS MODULE-SCOPED, so a create in one test raises the mark for
// every later one and a hardcoded minted id is order-dependent. `mintId` takes
// `Math.max(highWater, listMax) + 1` over a module-level Map
// (`id-mint-session.ts`) — correct in production (an id is never reused within a
// session) and exactly what makes an unreset fixture drift. This file got away
// without a reset only while it minted each kind AT MOST ONCE; it now has two
// `createTask` call sites (the absence test below and the counterfactual at the
// bottom), and CI runs the suite under `--sequence.shuffle`, which reorders
// tests WITHIN a file — so whichever ran first would silently decide the
// other's minted id. Resetting per test is what lets every assertion name the
// id it expects. Inert for both `SITES` tables: every row there only updates or
// deletes, and nothing in them mints.
beforeEach(__resetMintStateForTests);

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
  // ★★★ TASK 3 DEPENDS ON TASK 2, AND IT IS THE ONLY ACTOR `deleteTask`'s
  //   CASCADE HAS. That writer derives every task whose `dependencies[]` names
  //   the doomed id and captures them as `edited` ALONGSIDE `removed: [doomed]`
  //   in ONE part, so undo puts the row back WITH its inbound links; capturing
  //   only `removed` resurrects a task every dependent has forgotten, "which
  //   reads as a successful undo and is not one" (its own comment). With no
  //   dependent anywhere in the fixture, `dependents` is `[]` at every call
  //   site and `edited: dependents` → `edited: []` survives the entire file.
  //   ★★ SET HERE AND NOT IN `seedTask`: the two tests at the top of the file
  //   build their own lists from that helper and must stay dependency-free, and
  //   task 2 itself must keep NO dependencies — the `setTaskDependencies` row
  //   below asserts the restored value is `undefined`, which is only true of a
  //   row that never had the key.
  //   ★★ TWO LINKS, NOT ONE, and the second is what makes the cascade
  //   assertions discriminating. With a lone `taskId: 2` link, "strip only the
  //   links naming the doomed id" and "strip every link on every dependent"
  //   produce the identical `[]`, so the `d.taskId !== id` filter inside
  //   `deleteTask` could be widened to a constant `false` with the suite green.
  //   The surviving `taskId: 1` link is the witness that the strip was targeted.
  tasks: [
    seedTask(1, "First"),
    seedTask(2, "Before"),
    {
      ...seedTask(3, "Third"),
      dependencies: [
        { taskId: 1, type: "FS" },
        { taskId: 2, type: "FS" },
      ],
    },
  ],
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
  /** Runs after the REAL `undo()` in the round-trip suite below. This is the
   *  ONLY assertion in the file that can see a wrong before-image at this site.
   *
   *  ★★★ IT MUST ASSERT ORDER AS WELL AS VALUES, and order is the half that is
   *  easy to leave out. `capturePart` resolves an image's index with
   *  `Math.max(0, fromArray.findIndex(...))`, so a POST-op `fromArray` yields
   *  -1 → 0 and the row returns at the HEAD: [2, 1, 3] instead of [1, 2, 3]. A
   *  presence-only check (`toContain`, `toHaveLength`) is byte-identical
   *  against both, which is exactly how the wrong-`fromArray` mutant survives.
   *  Compare the WHOLE id sequence.
   *
   *  ★★ And it must assert a FIELD, not just the sequence — an UPDATE site
   *  never changes the order at all, so an order-only check there is vacuous
   *  and would pass against a merged-row capture reverting nothing. */
  restored: (d: ToolDispatcher) => void;
  kind: string;
  entityKey: string;
  primaryCount: number;
}

/** Whole-id-sequence helper. Every `list*` returns rows carrying `id`, so one
 *  shape covers all six slices — and comparing the SEQUENCE (never membership)
 *  is what makes a head-insertion visible. */
function ids(rows: readonly { id: number }[]): number[] {
  return rows.map((row) => row.id);
}

const SITES: SiteRow[] = [
  {
    site: "updateTask",
    act: (d) => { d.updateTask(2, { taskName: "After" }); },
    verify: (d) => { expect(d.getTask(2)?.taskName).toBe("After"); },
    restored: (d) => {
      expect(d.getTask(2)?.taskName).toBe("Before");
      expect(ids(d.listTasks())).toEqual([1, 2, 3]);
    },
    kind: "task.updated", entityKey: "task", primaryCount: 1,
  },
  {
    site: "setTaskDependencies",
    act: (d) => { d.setTaskDependencies(2, [{ taskId: 1, type: "FS" }]); },
    verify: (d) => { expect(d.getTask(2)?.dependencies?.length).toBe(1); },
    // ★ `seedTask` sets no `dependencies` key at all, so the pre-op image has
    //   none and a correct revert leaves the field undefined. A merged-row
    //   capture would put the one-element array back and this goes red.
    restored: (d) => {
      expect(d.getTask(2)?.dependencies).toBeUndefined();
      expect(ids(d.listTasks())).toEqual([1, 2, 3]);
    },
    kind: "task.updated", entityKey: "task", primaryCount: 1,
  },
  {
    site: "deleteTask",
    act: (d) => { d.deleteTask(2); },
    verify: (d) => {
      expect(d.getTask(2)).toBeNull();
      // ★★ THE CASCADE RAN, AND RAN TARGETED. Task 3's inbound link to the
      //   doomed task 2 was stripped by the delete's own `.map`; its unrelated
      //   link to task 1 survived. Without this the `restored` assertion below
      //   is untethered — a `deleteTask` that stopped stripping dependencies at
      //   all would leave both links in place and the round trip would read as
      //   a correct restore of something that never moved.
      expect(d.getTask(3)?.dependencies).toEqual([{ taskId: 1, type: "FS" }]);
    },
    restored: (d) => {
      expect(ids(d.listTasks())).toEqual([1, 2, 3]);
      // …and the row that came back carries its own data, not a husk.
      expect(d.getTask(2)?.taskName).toBe("Before");
      expect(d.getTask(2)?.assignee).toBe("M. Jordan");
      // ★★★ THE CASCADE IS REVERSED TOO, AND BY VALUE. `deleteTask` captures
      //   the dependents as `edited` in the SAME part as the `removed` row;
      //   `edited: dependents` → `edited: []` (or dropping the line) leaves
      //   task 3 with `[]` here while every other assertion in this file stays
      //   green — the resurrected task is back with its inbound link gone.
      //   Compared by VALUE and in ORDER, not merely for non-emptiness: after
      //   the strip task 3 still holds ONE link, so a length check is satisfied
      //   by the un-restored state and a `toContain` by either link alone.
      expect(d.getTask(3)?.dependencies).toEqual([
        { taskId: 1, type: "FS" },
        { taskId: 2, type: "FS" },
      ]);
    },
    kind: "task.deleted", entityKey: "task", primaryCount: 1,
  },
  {
    site: "deleteAllTasks",
    act: (d) => { d.deleteAllTasks(); },
    verify: (d) => { expect(d.listTasks()).toHaveLength(0); },
    // ★★ The one site where the ORDER assertion cannot be satisfied by a
    //   `Math.max(0, -1)` accident: three rows come back, so a head-collapsing
    //   restore yields a permutation, not [1, 2, 3].
    restored: (d) => {
      expect(ids(d.listTasks())).toEqual([1, 2, 3]);
      expect(d.listTasks().map((row) => row.taskName)).toEqual(["First", "Before", "Third"]);
    },
    // ★★ `task.deleted`, mirroring the human mass delete
    //   (`use-bulk-operations.ts` captures `task.deleted` with a count and logs
    //   `bulk.delete` to the ACTIVITY log separately). Asserting the kind here
    //   is what stops a future edit reaching for the activity vocabulary again:
    //   both label renderers pick their verb with a `.deleted` suffix test, so
    //   a `bulk.delete` undo kind printed "Edited 3 item(s)" over a wipe-
    //   everything. `entityKey` does not rescue that — it chooses the noun, not
    //   the verb, and the entity arm's own fallback is the same
    //   `undoToastEdit`, so it produced a string identical to the generic arm's.
    // ★ `primaryCount` is the SEEDED count, not 1 — the badge counts the rows
    //   the user loses, not the calls made.
    kind: "task.deleted", entityKey: "task", primaryCount: 3,
  },
  {
    site: "updateResource",
    act: (d) => { d.updateResource(2, { department: "PMO" }); },
    verify: (d) => { expect(d.getResourceRow(2)?.department).toBe("PMO"); },
    // ★ `seedResource` sets no `department`, so a correct revert clears it.
    restored: (d) => {
      expect(d.getResourceRow(2)?.department).toBeUndefined();
      expect(ids(d.listResources())).toEqual([1, 2, 3]);
    },
    kind: "resource.updated", entityKey: "resource", primaryCount: 1,
  },
  {
    site: "deleteResource",
    act: (d) => { d.deleteResource(2); },
    verify: (d) => { expect(d.getResourceRow(2)).toBeNull(); },
    restored: (d) => {
      expect(ids(d.listResources())).toEqual([1, 2, 3]);
      expect(d.getResourceRow(2)?.firstName).toBe("Grace");
    },
    kind: "resource.deleted", entityKey: "resource", primaryCount: 1,
  },
  {
    site: "updateRaid",
    act: (d) => { d.updateRaid(2, { title: "After" }); },
    verify: (d) => { expect(d.getRaidRow(2)?.title).toBe("After"); },
    restored: (d) => {
      expect(d.getRaidRow(2)?.title).toBe("R2");
      expect(ids(d.listRaid())).toEqual([1, 2, 3]);
    },
    kind: "raid.updated", entityKey: "raid", primaryCount: 1,
  },
  {
    site: "deleteRaid",
    act: (d) => { d.deleteRaid(2); },
    verify: (d) => { expect(d.getRaidRow(2)).toBeNull(); },
    restored: (d) => {
      expect(ids(d.listRaid())).toEqual([1, 2, 3]);
      expect(d.getRaidRow(2)?.title).toBe("R2");
    },
    kind: "raid.deleted", entityKey: "raid", primaryCount: 1,
  },
  {
    site: "updateChange",
    act: (d) => { d.updateChange(2, { title: "After" }); },
    verify: (d) => { expect(d.getChangeRow(2)?.title).toBe("After"); },
    restored: (d) => {
      expect(d.getChangeRow(2)?.title).toBe("C2");
      expect(ids(d.listChanges())).toEqual([1, 2, 3]);
    },
    kind: "change.updated", entityKey: "change", primaryCount: 1,
  },
  {
    site: "deleteChange",
    act: (d) => { d.deleteChange(2); },
    verify: (d) => { expect(d.getChangeRow(2)).toBeNull(); },
    restored: (d) => {
      expect(ids(d.listChanges())).toEqual([1, 2, 3]);
      expect(d.getChangeRow(2)?.title).toBe("C2");
    },
    kind: "change.deleted", entityKey: "change", primaryCount: 1,
  },
  {
    site: "updateMilestone",
    act: (d) => { d.updateMilestone(2, { name: "After" }); },
    verify: (d) => { expect(d.getMilestoneRow(2)?.name).toBe("After"); },
    restored: (d) => {
      expect(d.getMilestoneRow(2)?.name).toBe("M2");
      expect(ids(d.listMilestones())).toEqual([1, 2, 3]);
    },
    kind: "milestone.updated", entityKey: "milestone", primaryCount: 1,
  },
  {
    site: "deleteMilestone",
    act: (d) => { d.deleteMilestone(2); },
    verify: (d) => { expect(d.getMilestoneRow(2)).toBeNull(); },
    restored: (d) => {
      expect(ids(d.listMilestones())).toEqual([1, 2, 3]);
      expect(d.getMilestoneRow(2)?.name).toBe("M2");
    },
    kind: "milestone.deleted", entityKey: "milestone", primaryCount: 1,
  },
  {
    site: "updateStakeholder",
    act: (d) => { d.updateStakeholder(2, { name: "After" }); },
    verify: (d) => { expect(d.getStakeholderRow(2)?.name).toBe("After"); },
    restored: (d) => {
      expect(d.getStakeholderRow(2)?.name).toBe("S2");
      expect(ids(d.listStakeholders())).toEqual([1, 2, 3]);
    },
    kind: "stakeholder.updated", entityKey: "stakeholder", primaryCount: 1,
  },
  {
    site: "deleteStakeholder",
    act: (d) => { d.deleteStakeholder(2); },
    verify: (d) => { expect(d.getStakeholderRow(2)).toBeNull(); },
    restored: (d) => {
      expect(ids(d.listStakeholders())).toEqual([1, 2, 3]);
      expect(d.getStakeholderRow(2)?.name).toBe("S2");
    },
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

  // ★★★ THIS DESCRIBE CANNOT SEE A WRONG BEFORE-IMAGE — nothing in it can, and
  // that is why it is not the only suite over `SITES`. `capturePart` returns
  // `{ isPrimary, restore }` and closes over its images, so `kind`,
  // `entityKey`, `primaryCount` and `parts[0] !== null` are BYTE-IDENTICAL
  // whether the site captured the correct pre-op row or the wrong post-op one.
  // Fourteen green rows here prove only that *a* capture happened, at the right
  // label, on a path that really wrote. WHICH image went in is proved by the
  // round-trip suite at the bottom of this file, which drives the SAME fourteen
  // rows through the real stack and asserts each row's `restored`.
  //
  // ★★ MEASURED, not assumed: an early `fromArray` mutant on `deleteChange`
  // turned that round trip red while this describe's own `deleteChange` row
  // stayed GREEN. Do not "consolidate" the two suites — they answer different
  // questions and only one of them can fail on a wrong image.
  //
  // The two tests below run a fragment's own `restore` thunk by hand. They
  // predate the round-trip table and are kept as the narrow witness that the
  // FRAGMENT itself holds the right image, independent of `pushEntry`, the
  // stack and the composite runner — one per op.

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

/* ────────────────────────────────────────────────────────────────────────────
 * THE OTHER FIVE CREATE WRITERS — absence coverage, one row each.
 *
 * ★★★ `createTask`'s absence is pinned at the TOP of this file and was, until
 * now, the ONLY one of the six pinned anywhere. A contributor "completing the
 * pattern" at `createResource`, `createRaid`, `createChange`, `createMilestone`
 * or `createStakeholder` reintroduced the duplicate-on-undo defect with the
 * whole suite green — nothing asserted that those five don't capture. The
 * reasoning for the absence is `createTask`'s (`use-chat-dispatcher.ts`) and is
 * executed at the bottom of this file, not restated here.
 *
 * ★★ EVERY ROW CARRIES POSITIVE OBSERVABLES, for the reason the `createTask`
 * test spells out: `not.toHaveBeenCalled()` passes just as well when the path
 * never ran — the writer threw on its first line, or the row's own `create`
 * thunk was quietly emptied. Each row therefore asserts the minted id (4 =
 * max+1 over the three seeded rows, deterministic because of the `beforeEach`
 * mint reset at the top of this file), the name the writer echoed back, and
 * that the slice actually GREW to four. The absence is then an absence on a
 * LIVE path, which is the only kind worth asserting.
 * ──────────────────────────────────────────────────────────────────────────── */

interface CreateRow {
  /** The dispatcher method under test — also the `test.each` title. */
  site: string;
  /** Runs the writer and hands back the minted id plus the name field it echoed.
   *  ★ Each row extracts its own field rather than the table assuming a common
   *  one: the five summaries are different shapes (`firstName` for a resource,
   *  `title` for RAID and changes, `name` for milestones and stakeholders). */
  create: (d: ToolDispatcher) => { id: number; name: string };
  /** The name the row asked for, as it should come back through the sanitizer. */
  name: string;
  /** Row count of THIS writer's slice — 3 seeded, 4 after a create that landed. */
  count: (d: ToolDispatcher) => number;
}

const CREATE_SITES: CreateRow[] = [
  {
    site: "createResource",
    // ★ `createResource` lives in `use-chat-dispatcher.ts`; the four below are
    //   spread in from `use-register-tools.ts` — same dispatcher object, and
    //   the reason the site list in this file is built from the code and not
    //   from one file's method names.
    create: (d) => {
      const row = d.createResource({ firstName: "Ida", lastName: "Rhodes" });
      return { id: row.id, name: row.firstName };
    },
    name: "Ida",
    count: (d) => d.listResources().length,
  },
  {
    site: "createRaid",
    create: (d) => {
      const row = d.createRaid({ category: "R", title: "R4" });
      return { id: row.id, name: row.title };
    },
    name: "R4",
    count: (d) => d.listRaid().length,
  },
  {
    site: "createChange",
    create: (d) => {
      const row = d.createChange({ title: "C4" });
      return { id: row.id, name: row.title };
    },
    name: "C4",
    count: (d) => d.listChanges().length,
  },
  {
    site: "createMilestone",
    // ★ `date` is non-optional on `MilestoneInput` and the sanitizer rejects a
    //   milestone without one — a name-only input throws rather than creating,
    //   and the absence assertion would then be the vacuity it is meant to catch.
    create: (d) => {
      const row = d.createMilestone({ name: "M4", date: "2026-07-31" });
      return { id: row.id, name: row.name };
    },
    name: "M4",
    count: (d) => d.listMilestones().length,
  },
  {
    site: "createStakeholder",
    create: (d) => {
      const row = d.createStakeholder({ name: "S4" });
      return { id: row.id, name: row.name };
    },
    name: "S4",
    count: (d) => d.listStakeholders().length,
  },
];

describe("AI creates capture NO undo entry", () => {
  test.each(CREATE_SITES)("$site captures nothing", ({ create, name, count }) => {
    const captureComposite = vi.fn();
    const { result } = renderHook(
      () => useChatDispatcher(makeDispatcherArgs({ undo: { captureComposite } })),
      { wrapper: dispatcherWrapperWith(SEED) },
    );

    let made: { id: number; name: string } | undefined;
    act(() => { made = create(result.current); });

    // POSITIVE OBSERVABLES FIRST — see the block comment above.
    expect(made?.id).toBe(4);
    expect(made?.name).toBe(name);
    expect(count(result.current)).toBe(4);

    expect(captureComposite).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * ROUND TRIPS THROUGH THE **REAL** `useUndoStack`.
 *
 * ★★★ EVERY TEST ABOVE MOCKS `captureComposite`, AND A MOCK CANNOT PROVE UNDO
 * WORKS. It proves the capture was CALLED, and — where a test runs the
 * fragment's own `restore` thunk by hand — that the fragment holds the right
 * image. Neither exercises `pushEntry`, the stack, `commitUndo`, or the
 * composite runner the production `undo()` actually drives. A wrong before-image
 * is the whole defect class Phase 1 exists to prevent, and the only witness that
 * cannot be faked is the real engine putting the real row back.
 *
 * ★★ THE DEPENDENCY IS NO LONGER OPTIONAL, and this note used to say it was.
 * `ChatDispatcherArgs.undo` is now REQUIRED, so tsc — not a test — is what
 * catches `task-manager.tsx` dropping the prop, which is the failure that had
 * no witness at all while the field was `undo?:`. What these round trips still
 * carry, and nothing else does, is the other half: a capture site that stops
 * FEEDING the stack, or feeds it the wrong image, goes red here even though the
 * prop is present and every mock-based assertion above is satisfied.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Mounts the REAL undo stack and the REAL dispatcher in ONE hook body and wires
 *  the first into the second, so a write and its undo travel the whole
 *  production path: the site's `captureComposite` → `pushEntry` → the composite
 *  runner → the same workspace setter the dispatcher itself writes through.
 *
 *  ★ The three `useUndoStack` deps are minted OUTSIDE the hook body, not inside
 *  it: `useUndoStack` keeps them in a ref refreshed every render, so a fresh
 *  `vi.fn()` per render would work but would scatter the recorded calls across
 *  throwaway mocks. They are unasserted here either way — the stack's toast and
 *  activity rows are `use-undo-stack.test.ts`'s business, not this file's. */
function renderRealUndo(seed: TestSeed) {
  const logActivity = vi.fn();
  const showToast = vi.fn();
  const showToastAction = vi.fn();
  return renderHook(
    () => {
      const undo = useUndoStack({ lang: "en-US", logActivity, showToast, showToastAction });
      // ★ `undo` is a FRESH object every render and that is fine — the
      //   dispatcher reads `undoRef.current`, refreshed by an effect keyed on
      //   `args.undo`. This mirrors `task-manager.tsx`, which passes `undoApi`
      //   unmemoized for the same reason.
      const dispatcher = useChatDispatcher(makeDispatcherArgs({ undo }));
      // ★ The SAME workspace setter the dispatcher's own capture sites pass to
      //   `capturePart`. Used by exactly ONE test — the counterfactual create at
      //   the bottom, which has to build the capture production deliberately
      //   refuses to build, and cannot do that without the real setter. Every
      //   other test here ignores it.
      const { setTasks } = useWorkspace();
      return { undo, dispatcher, setTasks };
    },
    { wrapper: dispatcherWrapperWith(seed) },
  );
}

describe("AI writes round-trip through the real undo stack", () => {
  // ★★★ THE SAME FOURTEEN ROWS AS THE MOCK TABLE, AND THIS IS THE SUITE THAT
  //   PROVES CORRECTNESS. Each row writes through the dispatcher, calls the
  //   REAL `undo()`, and then asserts its `restored` — original field values
  //   AND original id sequence. Before this existed, only four of the fourteen
  //   sites had any before-image coverage at all (`updateTask` / `deleteTask`
  //   below, plus the two hand-run restore thunks above); the other ten could
  //   each carry the wrong-`fromArray` or capture-after-merge defect with the
  //   whole file green.
  //
  //   ★★ The stack-depth assertions are not decoration. "grew by exactly one"
  //   catches a site that captures TWICE (a double entry means the user has to
  //   undo twice for one AI write), and the trailing "back to zero" catches an
  //   entry that was applied without being consumed. Neither is visible in the
  //   entity arrays.
  test.each(SITES)(
    "$site is fully reversed by the real undo()",
    ({ act: write, verify, restored }) => {
      const { result } = renderRealUndo(SEED);
      expect(result.current.undo.stack).toHaveLength(0);

      act(() => { write(result.current.dispatcher); });
      verify(result.current.dispatcher); // the write landed — see `verify`'s doc
      expect(result.current.undo.stack).toHaveLength(1);

      act(() => { result.current.undo.undo(); });

      restored(result.current.dispatcher);
      expect(result.current.undo.stack).toHaveLength(0);
    },
  );

  test("undoing an AI updateTask restores the ORIGINAL field values in place", () => {
    const { result } = renderRealUndo(SEED);
    // Depth BEFORE, so the assertion below is "grew by exactly 1" rather than
    // "is 1" — the latter passes against a site that captures twice and one
    // that captures never, if the seed had happened to leave an entry behind.
    expect(result.current.undo.stack).toHaveLength(0);

    // TWO fields, so the round trip cannot pass by reverting a single one.
    act(() => {
      result.current.dispatcher.updateTask(2, { taskName: "After", priority: "High" });
    });

    expect(result.current.dispatcher.getTask(2)?.taskName).toBe("After");
    expect(result.current.dispatcher.getTask(2)?.priority).toBe("High");
    expect(result.current.undo.stack).toHaveLength(1);

    act(() => { result.current.undo.undo(); });

    // ★★★ THE MUTANT THIS KILLS: capturing `merged` instead of `existing` in
    //   `updateTask` makes the restore write "After"/"High" back over
    //   "After"/"High" — a silent no-op. Every mock-based assertion in this file
    //   survives that; these two do not.
    const restored = result.current.dispatcher.getTask(2);
    expect(restored?.taskName).toBe("Before");
    expect(restored?.priority).toBe("Medium");

    // ORIGINAL INDEX, and the neighbours untouched — an edit-image revert must
    // be a targeted in-place swap, not a wholesale list rewrite.
    expect(result.current.dispatcher.listTasks().map((row) => row.id)).toEqual([1, 2, 3]);
    expect(result.current.dispatcher.getTask(1)?.taskName).toBe("First");
    expect(result.current.dispatcher.getTask(3)?.taskName).toBe("Third");

    // The entry was consumed, not merely applied.
    expect(result.current.undo.stack).toHaveLength(0);
  });

  test("undoing an AI deleteTask puts the MIDDLE row back at its own index", () => {
    const { result } = renderRealUndo(SEED);
    expect(result.current.undo.stack).toHaveLength(0);

    // ★ id 2 of 1-2-3. Deleting the head or the tail makes index 0 (or `length`)
    //   accidentally correct, so such a fixture cannot tell a correct restore
    //   index from a `Math.max(0, -1)` fallback — the middle row can.
    act(() => { result.current.dispatcher.deleteTask(2); });

    expect(result.current.dispatcher.listTasks().map((row) => row.id)).toEqual([1, 3]);
    expect(result.current.undo.stack).toHaveLength(1);

    act(() => { result.current.undo.undo(); });

    // The ORDER is the assertion, not the presence: a post-op `fromArray` would
    // resolve index -1 → 0 and hand back [2, 1, 3].
    expect(result.current.dispatcher.listTasks().map((row) => row.id)).toEqual([1, 2, 3]);
    // …and the row that came back carries its own data, not a husk.
    expect(result.current.dispatcher.getTask(2)?.taskName).toBe("Before");
    expect(result.current.dispatcher.getTask(2)?.assignee).toBe("M. Jordan");
    expect(result.current.undo.stack).toHaveLength(0);

    // ★★ THE REDO DIRECTION, which no AI-capture round trip exercised. A redo of
    //   an AI delete RE-REMOVES the row, which is the §295 arming shape — a
    //   redo that re-applies a "delete" op — so this asserts the row is gone
    //   again rather than merely that redo ran without throwing.
    expect(result.current.undo.redoStack).toHaveLength(1);

    act(() => { result.current.undo.redo(); });

    expect(result.current.dispatcher.listTasks().map((row) => row.id)).toEqual([1, 3]);
    expect(result.current.dispatcher.getTask(2)).toBeNull();
    expect(result.current.undo.stack).toHaveLength(1);
    expect(result.current.undo.redoStack).toHaveLength(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * WHY THE SIX CREATE WRITERS CAPTURE NOTHING — the counterfactual, EXECUTED.
 *
 * `use-chat-dispatcher.ts` justifies the omission in prose: "Measured against
 * the real engine, not reasoned: seeding two rows, creating a third and undoing
 * yields FOUR rows." Nothing executed it. The test below does, at the same seed
 * size, against the real stack.
 *
 * ★★★ IT HAS TO SYNTHESISE THE CAPTURE, AND THERE IS NO WAY AROUND THAT. The
 * claim is a COUNTERFACTUAL about code that deliberately does not exist, so the
 * only executable witness is one that performs the refused capture itself.
 * Everything else in the test is production: the real `createTask`, the real
 * `useUndoStack`, the real `undo()`, the real workspace setter, and a
 * `capturePart` call shaped exactly like every delete site's. DO NOT read the
 * `captureComposite` block as a template — it is the regression, quarantined in
 * a test so the reasoning stops being an unverified sentence.
 *
 * ★★ WHAT IT DOES AND DOES NOT PROVE. It kills mutants in the ENGINE's id-reuse
 * branch (`applyUndoRestoreWithRemap`) as reached through the dispatcher, and —
 * via the stack-depth assertion before the synthetic capture — it proves against
 * the REAL stack that `createTask` pushes nothing, where the absence test at the
 * top of this file proves it only against a mock. It does NOT go red if a
 * capture is added to one of the OTHER five creates; that is what the
 * `CREATE_SITES` table above is for.
 *
 * ★ The engine primitive itself is already covered directly and heavily —
 * `undo/undo-stack.test.ts` exercises the re-mint branch including simultaneous
 * re-mints. What was missing was the COMPOSED claim at this level.
 * ──────────────────────────────────────────────────────────────────────────── */

describe("capturing a create would duplicate the row", () => {
  test("seeding two rows, creating a third and undoing yields FOUR rows", () => {
    // TWO seeded rows, matching the measurement the prose reports verbatim.
    const { result } = renderRealUndo({
      tasks: [seedTask(1, "First"), seedTask(2, "Second")],
    });
    expect(result.current.undo.stack).toHaveLength(0);

    // The PRE-op array — what a real capture site passes as `fromArray`.
    const beforeCreate = result.current.dispatcher.listTasks();

    let created: Task | undefined;
    act(() => {
      created = result.current.dispatcher.createTask({
        taskName: "Third",
        assignee: "M. Jordan",
        dueDate: "2026-09-30",
      });
    });

    expect(created?.id).toBe(3);
    expect(result.current.dispatcher.listTasks().map((row) => row.id)).toEqual([1, 2, 3]);

    // ★★ PRODUCTION PUSHED NOTHING, and this is the assertion against the REAL
    //   stack rather than a mock: `createTask` ran to completion, the row is
    //   live, and the stack is still empty.
    expect(result.current.undo.stack).toHaveLength(0);

    // ★ A `const`, not the `let` above: narrowing on a `let` assigned inside an
    //   `act` closure does not survive into the next closure, so the capture
    //   below would need a non-null assertion without this hop.
    if (!created) throw new Error("createTask returned nothing — the capture below needs the row");
    const createdRow: Task = created;

    // ── THE REFUSED CAPTURE, shaped exactly as a delete site would shape it:
    //    the created row as a `removed` image against the pre-op array.
    act(() => {
      result.current.undo.captureComposite({
        kind: "task.created",
        primaryCount: 1,
        parts: [capturePart({
          setter: result.current.setTasks,
          removed: [createdRow],
          fromArray: beforeCreate,
          isPrimary: true,
        })],
        name: createdRow.taskName,
        entityKey: "task",
      });
    });
    expect(result.current.undo.stack).toHaveLength(1);

    act(() => { result.current.undo.undo(); });

    // ★★★ FOUR ROWS FROM THREE. The created row is STILL LIVE at undo time, so
    //   `applyUndoRestoreWithRemap` takes its id-reuse branch: it refuses to
    //   clobber the live id 3 and re-inserts the image under a fresh id (max+1
    //   = 4) at the index the pre-op array resolved for it (`findIndex` → -1 →
    //   `Math.max(0, …)` → the HEAD). The engine is behaving correctly — it is
    //   the CAPTURE that is wrong, and "undo" has added a row instead of
    //   removing one.
    const after = result.current.dispatcher.listTasks();
    expect(after.map((row) => row.id)).toEqual([4, 1, 2, 3]);
    // …and the duplicate is a duplicate: TWO rows now carry the created name.
    expect(after.filter((row) => row.taskName === "Third").map((row) => row.id)).toEqual([4, 3]);
  });
});
