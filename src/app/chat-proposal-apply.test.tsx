import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { applyProposal } from "./chat-proposal-apply";
import type { ProposedCall } from "./chat-proposal";
import { describeProposal } from "./chat-proposal-describe";
import { type TestSeed } from "./test-providers";
import { DEFAULT_TASK_STATUS, type Milestone, type Task } from "./types";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { useUndoBatch } from "./use-undo-batch";
import { useUndoStack } from "./undo/use-undo-stack";
import { emptyWorkspace, type Workspace } from "./workspace";
import { resetMintState } from "./id-mint-session";

/** A minimal VALID `Task`, mirroring `use-chat-dispatcher.undo.test.tsx`'s rule:
 *  every non-optional field of the type and nothing more, so a write is refused
 *  by the guard under test rather than by a sanitizer rejecting a lazy fixture. */
function seedTask(id: number, taskName: string, assigneeEmail = ""): Task {
  return {
    id,
    taskName,
    assignee: "M. Jordan",
    assigneeEmail,
    dueDate: "2026-09-30",
    lastUpdateDate: "2026-05-19",
    priority: "Medium",
    status: DEFAULT_TASK_STATUS,
    blockers: "",
    description: "",
  };
}

function seedMilestone(id: number, name: string): Milestone {
  return { id, name, date: "2026-06-30", linkedTaskIds: [] };
}

/** THREE rows per slice, ids 1-2-3, every write targeting the MIDDLE one — a
 *  head or tail row makes index 0 (or `length`) accidentally correct, so such a
 *  fixture cannot tell a restored index from a clamped fallback. */
const SEED: TestSeed = {
  tasks: [seedTask(1, "First"), seedTask(2, "Before"), seedTask(3, "Third")],
  milestones: [seedMilestone(1, "M1"), seedMilestone(2, "M2"), seedMilestone(3, "M3")],
};

/** The workspace `describeProposal` grounds the plan against. It MUST mirror the
 *  seeded state exactly: the `expectedToken` it stamps is derived from these
 *  rows, and a fixture that drifts from the provider's would make every applied
 *  row refuse as stale — which reads as a broken apply path. */
function seedWorkspace(seed: TestSeed = SEED): Workspace {
  return { ...emptyWorkspace(), tasks: seed.tasks ?? [], milestones: seed.milestones ?? [] };
}

/** Mounts the REAL undo stack, the REAL batch wrapper and the REAL dispatcher in
 *  one hook body, wired exactly as `task-manager.tsx` will wire them: the batch
 *  takes the live stack, and its `undo` surface — not the stack itself — is what
 *  the dispatcher captures through.
 *
 *  ★★★ THE REAL STACK, NEVER A MOCK. A `vi.fn()` proves `captureComposite` was
 *  called ONCE; it cannot prove the single entry it was called with actually
 *  restores both entities, and "one call carrying the wrong fragments" is the
 *  defect this whole module exists to avoid. Only the real engine putting the
 *  real rows back is a witness. */
function renderApply(seed: TestSeed = SEED) {
  const logActivity = vi.fn();
  const showToast = vi.fn();
  const showToastAction = vi.fn();
  return renderHook(
    () => {
      const undo = useUndoStack({ lang: "en-US", logActivity, showToast, showToastAction });
      const batch = useUndoBatch(undo);
      const dispatcher = useChatDispatcher(makeDispatcherArgs({ undo: batch.undo }));
      return { undo, batch, dispatcher };
    },
    { wrapper: dispatcherWrapperWith(seed) },
  );
}

type Rendered = ReturnType<typeof renderApply>["result"];

/** Describe `calls` against `ws`, then apply every row. Returns the per-row
 *  outcomes. `await act` because each replayed write sets React state. */
async function applyAll(result: Rendered, calls: readonly ProposedCall[], ws = seedWorkspace()) {
  const rows = describeProposal(calls, ws);
  const selected = new Set(rows.map((_, i) => i));
  let outcome: Awaited<ReturnType<typeof applyProposal>> | undefined;
  await act(async () => {
    outcome = await applyProposal({
      dispatcher: result.current.dispatcher,
      rows,
      selected,
      batch: result.current.batch,
    });
  });
  return outcome!;
}

// ★★★ THE MINTER IS MODULE-SCOPED, so a create in one test raises the mark for
// every later one and a hardcoded minted id is order-dependent. `mintId` takes
// `Math.max(highWater, listMax) + 1` over a module-level Map (`id-mint-session.ts`),
// which is correct in production (an id is never reused within a session) and is
// exactly what makes an unreset fixture drift: the all-creates test below first
// read [1, 2, 3, 5, 6] because a create in an EARLIER test had already spent 4.
// Resetting per test is what lets the assertions name the minted id at all.
beforeEach(() => {
  resetMintState();
});

const taskIds = (r: Rendered) => r.current.dispatcher.listTasks().map((t) => t.id);
const milestoneIds = (r: Rendered) => r.current.dispatcher.listMilestones().map((m) => m.id);

describe("applyProposal", () => {
  test("applying a two-entity plan pushes exactly ONE undo entry", async () => {
    const { result } = renderApply();
    expect(result.current.undo.stack).toHaveLength(0);

    // ★★★ TWO ENTITIES IS LOAD-BEARING. A single-entity plan is green against an
    //   implementation that pushes one entry PER ARRAY, because there is only
    //   one array. Only a plan spanning a task AND a milestone tells
    //   `captureComposite({parts:[a,b]})` apart from two separate captures.
    const outcome = await applyAll(result, [
      { name: "update_task", input: { id: 2, taskName: "After" } },
      { name: "update_milestone", input: { id: 2, name: "M2 moved" } },
    ]);

    // Positive observable FIRST: both writes really landed, so the depth
    // assertion below is about a live path rather than about two early throws.
    expect(outcome.rows).toEqual([
      { index: 0, ok: true },
      { index: 1, ok: true },
    ]);
    expect(result.current.dispatcher.getTask(2)?.taskName).toBe("After");
    expect(result.current.dispatcher.getMilestoneRow(2)?.name).toBe("M2 moved");

    // Grew by EXACTLY one — "is 1" would also pass against a path that captured
    // twice if the seed had left an entry behind, which is why depth was read
    // before the apply.
    expect(result.current.undo.stack).toHaveLength(1);

    act(() => {
      result.current.undo.undo();
    });

    // BOTH entities restored by the ONE entry — values and order.
    expect(result.current.dispatcher.getTask(2)?.taskName).toBe("Before");
    expect(result.current.dispatcher.getMilestoneRow(2)?.name).toBe("M2");
    expect(taskIds(result)).toEqual([1, 2, 3]);
    expect(milestoneIds(result)).toEqual([1, 2, 3]);
    // Neighbours untouched: an edit-image revert is a targeted in-place swap.
    expect(result.current.dispatcher.getTask(1)?.taskName).toBe("First");
    expect(result.current.dispatcher.getMilestoneRow(3)?.name).toBe("M3");

    // Consumed, not merely applied.
    expect(result.current.undo.stack).toHaveLength(0);
  });

  test("a row whose token went stale fails ALONE", async () => {
    const { result } = renderApply();
    const ws = seedWorkspace();
    const rows = describeProposal(
      [
        { name: "update_task", input: { id: 2, taskName: "Planned 2" } },
        { name: "update_task", input: { id: 3, taskName: "Planned 3" } },
      ],
      ws,
    );

    // A concurrent writer moves row 2 AFTER the plan was stamped — the exact
    // window `expectedToken` exists to cover.
    act(() => {
      result.current.dispatcher.updateTask(2, { taskName: "Moved by someone else" });
    });
    const before = result.current.undo.stack.length;

    let outcome: Awaited<ReturnType<typeof applyProposal>> | undefined;
    await act(async () => {
      outcome = await applyProposal({
        dispatcher: result.current.dispatcher,
        rows,
        selected: new Set([0, 1]),
        batch: result.current.batch,
      });
    });

    expect(outcome!.rows[0].ok).toBe(false);
    // ★ Typed, not message-matched — both refusal messages are model-facing
    //   recovery instructions and may be reworded at any time.
    expect(outcome!.rows[0].stale).toBe(true);
    expect(outcome!.rows[0].index).toBe(0);
    expect(outcome!.rows[1]).toEqual({ index: 1, ok: true });

    // The refused row wrote NOTHING; the other row applied.
    expect(result.current.dispatcher.getTask(2)?.taskName).toBe("Moved by someone else");
    expect(result.current.dispatcher.getTask(3)?.taskName).toBe("Planned 3");
    // One entry for the partial apply — the concurrent write above pushed its own.
    expect(result.current.undo.stack).toHaveLength(before + 1);
  });

  test("a mixed create + update + delete plan is ONE entry that leaves the create in place", async () => {
    const { result } = renderApply();
    expect(result.current.undo.stack).toHaveLength(0);

    const outcome = await applyAll(result, [
      { name: "create_task", input: { taskName: "Minted", assignee: "M. Jordan", dueDate: "2026-10-01" } },
      { name: "update_task", input: { id: 2, taskName: "After" } },
      { name: "delete_task", input: { id: 3 } },
    ]);

    expect(outcome.rows.every((r) => r.ok)).toBe(true);
    // 1 kept, 2 edited, 3 gone, 4 minted (max+1 over the seeded three).
    expect(taskIds(result)).toEqual([1, 2, 4]);
    expect(result.current.dispatcher.getTask(4)?.taskName).toBe("Minted");
    expect(result.current.undo.stack).toHaveLength(1);

    // ★★ `primaryCount` counts only what the entry can PUT BACK: the update and
    //   the delete. Three — the number of rows APPLIED — would make the toast
    //   and the undo badge claim a row no before-image exists for.
    expect(result.current.undo.stack[0].count).toBe(2);

    act(() => {
      result.current.undo.undo();
    });

    // ★★★ THE CREATED ROW SURVIVES, and asserting otherwise would be asserting a
    //   defect: the undo engine's ops are "delete" | "edit" only, so a create has
    //   no before-image. Capturing one as a `removed` image would take the
    //   id-reuse branch at undo time and splice in a SECOND copy — undoing the
    //   create would DUPLICATE it. Row 4 staying put is the honest behaviour, and
    //   the exact id list is what catches the duplicate.
    expect(taskIds(result)).toEqual([1, 2, 3, 4]);
    expect(result.current.dispatcher.getTask(4)?.taskName).toBe("Minted");
    // …and the two reversible rows really were reversed.
    expect(result.current.dispatcher.getTask(2)?.taskName).toBe("Before");
    expect(result.current.dispatcher.getTask(3)?.taskName).toBe("Third");
    expect(result.current.undo.stack).toHaveLength(0);
  });

  test("an all-creates plan applies and pushes ZERO undo entries", async () => {
    const { result } = renderApply();

    const outcome = await applyAll(result, [
      { name: "create_task", input: { taskName: "A", assignee: "M. Jordan", dueDate: "2026-10-01" } },
      { name: "create_task", input: { taskName: "B", assignee: "M. Jordan", dueDate: "2026-10-02" } },
    ]);

    // Positive observable: both creates landed, so the absence below is an
    // absence on a LIVE path.
    expect(outcome.rows.every((r) => r.ok)).toBe(true);
    expect(taskIds(result)).toEqual([1, 2, 3, 4, 5]);

    // No fragments were collected, so no entry — not an EMPTY entry, which would
    // still cost a slot of the 25-deep cap and offer the user a no-op undo.
    expect(result.current.undo.stack).toHaveLength(0);
  });

  test("deleting two rows in one plan restores both at their own indices", async () => {
    const { result } = renderApply();

    const outcome = await applyAll(result, [
      { name: "delete_task", input: { id: 1 } },
      { name: "delete_task", input: { id: 3 } },
    ]);

    expect(outcome.rows.every((r) => r.ok)).toBe(true);
    expect(taskIds(result)).toEqual([2]);
    // TWO fragments over the SAME array, folded into one entry.
    expect(result.current.undo.stack).toHaveLength(1);
    expect(result.current.undo.stack[0].count).toBe(2);

    act(() => {
      result.current.undo.undo();
    });

    // ORDER is the assertion, not presence — a mis-resolved index hands back
    // [1, 3, 2] or [3, 1, 2] and every `toContain` check passes anyway.
    expect(taskIds(result)).toEqual([1, 2, 3]);
    expect(result.current.dispatcher.getTask(1)?.taskName).toBe("First");
    expect(result.current.dispatcher.getTask(3)?.taskName).toBe("Third");
  });
});

describe("applyProposal re-invokes rather than replaying a diff", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("send_inquiry opens the mail client, not just the counter", async () => {
    // ★★★ THE INVARIANT WITH NO OTHER COVER. `sendInquiry` calls `window.open`
    //   on a `mailto:` URL and only THEN increments `inquiriesSent`. An apply
    //   path that rebuilt the plan's effect from the computed before/after rows
    //   would bump the counter and open nothing — a send that reports success,
    //   sends nothing, and errors at no layer. Only re-invoking the tool fires
    //   this spy.
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    // The seeded default email is blank, which short-circuits to
    // `no-email-on-file` BEFORE `window.open` — a fixture that would make this
    // test pass for the wrong reason if it also failed to open.
    const seed: TestSeed = { tasks: [seedTask(1, "Chase me", "ada@example.com")] };
    const { result } = renderApply(seed);

    const outcome = await applyAll(result, [{ name: "send_inquiry", input: { id: 1 } }], seedWorkspace(seed));

    expect(outcome.rows).toEqual([{ index: 0, ok: true }]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0][0])).toMatch(/^mailto:ada%40example\.com\?/);
    // The counter moved too — so the spy is not passing over a path that opened
    // the client and then failed to write.
    expect(result.current.dispatcher.getTask(1)?.inquiriesSent).toBe(1);
  });
});

describe("applyProposal honours the selection", () => {
  test("an unselected row is neither applied nor reported", async () => {
    const { result } = renderApply();
    const rows = describeProposal(
      [
        { name: "update_task", input: { id: 2, taskName: "Kept" } },
        { name: "update_task", input: { id: 3, taskName: "Dropped" } },
      ],
      seedWorkspace(),
    );

    let outcome: Awaited<ReturnType<typeof applyProposal>> | undefined;
    await act(async () => {
      outcome = await applyProposal({
        dispatcher: result.current.dispatcher,
        rows,
        selected: new Set([0]),
        batch: result.current.batch,
      });
    });

    // The reported index is the row's position in the FULL list, so the card can
    // mark the right checkbox without re-deriving anything from a filtered array.
    expect(outcome!.rows).toEqual([{ index: 0, ok: true }]);
    expect(result.current.dispatcher.getTask(2)?.taskName).toBe("Kept");
    expect(result.current.dispatcher.getTask(3)?.taskName).toBe("Third");
  });
});
