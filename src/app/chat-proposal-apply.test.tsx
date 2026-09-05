import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import {
  applyProposal,
  failureKindOf,
  NEW_ROW_TOKEN_UNAVAILABLE_ERROR,
  PENDING_MINT_ERROR,
  TOKEN_REQUIRED_TOOLS,
  TOKEN_ROW_SOURCE,
} from "./chat-proposal-apply";
import { buildPlanRows, type ProposedCall } from "./chat-proposal";
import { entityToken, TOKEN_EXCLUDED, type TokenEntity } from "./ai-entity-token";
import { runTool, type ToolDispatcher } from "./chat-tools";
import { TOOL_DEFS } from "./chat-tool-defs";
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

// ---------------------------------------------------------------------------
// §378 — a staged create lands under the id the REAL minter hands out, never the
// provisional one `buildPlanRows` paired it with. Every row below is applied
// through the plan-row overload, which is the only way the apply path can learn
// which provisional id a create replaces.

/** Describe `calls` WITH plan rows (so creates carry a `mintedId`), then apply
 *  every row. `mintedIds` is one provisional id per create, in emission order —
 *  the same contract `buildPlanRows` states. */
async function applyPlan(
  result: Rendered,
  calls: readonly ProposedCall[],
  mintedIds: readonly number[],
  ws = seedWorkspace(),
) {
  const rows = describeProposal(calls, ws, buildPlanRows(calls, mintedIds));
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

describe("applyProposal remaps provisional ids to the real ones", () => {
  // The seeded task ids are 1-2-3 throughout (see SEED), so the first create in
  // a plan mints 4 and the second 5. Every real id named below follows from that.
  test("a delete on a provisional id removes the FIRST create, not the second", async () => {
    const { result } = renderApply();

    // ★★★ TWO CREATES IS LOAD-BEARING. With one, "the delete hit the created
    //   row" is indistinguishable from "the delete hit whatever was created" —
    //   and a remap that resolved every provisional id to the LAST create would
    //   pass. #101 must resolve to the FIRST one specifically.
    const outcome = await applyPlan(
      result,
      [
        { name: "create_task", input: { taskName: "First minted", assignee: "M. Jordan", dueDate: "2026-10-01" } },
        { name: "create_task", input: { taskName: "Second minted", assignee: "M. Jordan", dueDate: "2026-10-02" } },
        { name: "delete_task", input: { id: 101 } },
      ],
      [101, 102],
    );

    expect(outcome.rows.every((r) => r.ok)).toBe(true);
    // 4 was created then deleted; 5 survives. Without the remap the delete
    // reports "task #101 not found" and BOTH creates survive as [1,2,3,4,5].
    expect(taskIds(result)).toEqual([1, 2, 3, 5]);
    expect(result.current.dispatcher.getTask(5)?.taskName).toBe("Second minted");
  });

  test("a KEY-BEARING link entry is rewritten and its other fields survive", async () => {
    const { result } = renderApply();

    // `dependencies[].taskId` is the one link shape whose id sits inside an
    // OBJECT. TRACED, not assumed: `resolveDependencyWrite` delegates to
    // `classifyDependencyEntries` (`task-dependency-write.ts`), which pushes
    // `{ reason: "unknown-id" }` for any taskId outside `knownTaskIds` and never
    // applies it — so an unremapped #101 stores NOTHING. The call still
    // RESOLVES (a rejection is a normal result, not a throw), so `ok: true` is
    // NOT the discriminator here; the stored list below is.
    const outcome = await applyPlan(
      result,
      [
        { name: "create_task", input: { taskName: "Minted", assignee: "M. Jordan", dueDate: "2026-10-01" } },
        { name: "set_task_dependencies", input: { id: 2, dependencies: [{ taskId: 101, type: "FS" }] } },
      ],
      [101],
    );

    expect(outcome.rows.every((r) => r.ok)).toBe(true);
    // The create landed — so the assertion below is about a live row.
    expect(result.current.dispatcher.getTask(4)?.taskName).toBe("Minted");
    expect(result.current.dispatcher.getTask(2)?.dependencies).toEqual([
      { taskId: 4, type: "FS" },
    ]);
  });

  test("a FLAT link array is rewritten", async () => {
    const { result } = renderApply();

    const outcome = await applyPlan(
      result,
      [
        { name: "create_task", input: { taskName: "Minted", assignee: "M. Jordan", dueDate: "2026-10-01" } },
        { name: "create_milestone", input: { name: "Depends on it", date: "2026-11-01", linkedTaskIds: [101] } },
      ],
      [101, 102],
    );

    expect(outcome.rows.every((r) => r.ok)).toBe(true);
    // `sanitizeIdList` does NO referential check, so an unremapped plan stores
    // [101] silently — a dangling link nothing reports.
    expect(result.current.dispatcher.getMilestoneRow(4)?.linkedTaskIds).toEqual([4]);
  });

  // ★★★ THE FIXTURE THE ENTITY SCOPING EXISTS FOR, AND ITS ORDER IS LOAD-BEARING.
  //   Ids are per-entity sequences, so two creates in one plan minting the SAME
  //   number is the common case. A number-keyed lookup takes whichever create was
  //   recorded LAST — so with the TASK create second, `delete_milestone({id:101})`
  //   resolves to the task's real id 4 and deletes the SEEDED milestone #4. With
  //   the creates the other way round the number-blind lookup is ACCIDENTALLY
  //   RIGHT and this fixture cannot express the defect at all.
  test("is ENTITY-SCOPED: two entities minting the same provisional number do not cross", async () => {
    const seed: TestSeed = {
      tasks: [seedTask(1, "First"), seedTask(2, "Before"), seedTask(3, "Third")],
      milestones: [
        seedMilestone(1, "M1"), seedMilestone(2, "M2"), seedMilestone(3, "M3"),
        seedMilestone(4, "M4"), seedMilestone(5, "M5"),
      ],
    };
    const { result } = renderApply(seed);

    const outcome = await applyPlan(
      result,
      [
        { name: "create_milestone", input: { name: "Minted milestone", date: "2026-11-01" } },
        { name: "create_task", input: { taskName: "Minted task", assignee: "M. Jordan", dueDate: "2026-10-01" } },
        { name: "delete_milestone", input: { id: 101 } },
      ],
      [101, 101],
      seedWorkspace(seed),
    );

    expect(outcome.rows.every((r) => r.ok)).toBe(true);
    // The minted milestone (#6) was created and deleted; every SEEDED milestone
    // survives. A number-blind remap deletes #4 and leaves [1,2,3,5,6].
    expect(milestoneIds(result)).toEqual([1, 2, 3, 4, 5]);
    expect(result.current.dispatcher.getMilestoneRow(4)?.name).toBe("M4");
    // The task create is untouched by any of it.
    expect(taskIds(result)).toEqual([1, 2, 3, 4]);
    expect(result.current.dispatcher.getTask(4)?.taskName).toBe("Minted task");
  });

  // ★★★ A CREATE THAT FAILS AT APPLY TIME IS NOT THE CASE `cascadeDeselect`
  //   COVERS. That one handles a row the user REFUSED at review time; this one
  //   was selected and then threw, so its provisional id is never resolved. The
  //   provisional id here is deliberately made to COLLIDE with a live row so the
  //   failure is observable: without the refusal the dependent replays at the raw
  //   number and DELETES A SEEDED TASK. (A collision is not the common case — it
  //   is the fixture that makes a silent wrong write visible.)
  test("a create that FAILS refuses its dependents instead of replaying them", async () => {
    const { result } = renderApply();

    const outcome = await applyPlan(
      result,
      [
        // Missing `assignee`/`dueDate` — `runTool` throws before the dispatcher.
        { name: "create_task", input: { taskName: "Doomed" } },
        { name: "delete_task", input: { id: 2 } },
      ],
      [2],
    );

    expect(outcome.rows[0].ok).toBe(false);
    expect(outcome.rows[0].stale).toBe(false);
    expect(outcome.rows[1].ok).toBe(false);
    // The EXACT error, not merely "not ok": a replayed row would have failed
    // too — with the dispatcher's own "task #2 not found" — and the whole point
    // is that `runTool` was never reached.
    expect(outcome.rows[1].error).toBe(PENDING_MINT_ERROR);
    expect(outcome.rows[1].stale).toBeUndefined();

    // Nothing was created and NOTHING WAS DELETED — the seeded #2 survives.
    expect(taskIds(result)).toEqual([1, 2, 3]);
    expect(result.current.dispatcher.getTask(2)?.taskName).toBe("Before");
  });

  test("a create's dependents apply normally once it succeeds", async () => {
    // The anti-vacuity half of the refusal above: the same shape with a VALID
    // create must NOT be refused, or the guard would be blocking every plan.
    const { result } = renderApply();

    const outcome = await applyPlan(
      result,
      [
        { name: "create_task", input: { taskName: "Fine", assignee: "M. Jordan", dueDate: "2026-10-01" } },
        { name: "delete_task", input: { id: 2 } },
      ],
      [2],
    );

    expect(outcome.rows.every((r) => r.ok)).toBe(true);
    // #2 was the PROVISIONAL id, so the delete followed the create to #4 — the
    // seeded #2 is untouched.
    expect(taskIds(result)).toEqual([1, 2, 3]);
    expect(result.current.dispatcher.getTask(2)?.taskName).toBe("Before");
  });

  // ★★ WITHOUT PLAN ROWS NOTHING IS REMAPPED, and that must stay true: every
  //   existing caller of `describeProposal` passes none, so a remap that fired
  //   on an absent `mintedId` would rewrite ids in plans that never staged one.
  test("a plan described without plan rows is replayed verbatim", async () => {
    const { result } = renderApply();

    const outcome = await applyAll(result, [
      { name: "create_task", input: { taskName: "Minted", assignee: "M. Jordan", dueDate: "2026-10-01" } },
      { name: "delete_task", input: { id: 2 } },
    ]);

    expect(outcome.rows.every((r) => r.ok)).toBe(true);
    // #2 is read as the LIVE row it names, because nothing marked it provisional.
    expect(taskIds(result)).toEqual([1, 3, 4]);
  });
});

describe("a row targeting a row created in the same plan now applies (§380)", () => {
  // ★★★ THIS USED TO PIN A LIE. A pending row is never stamped at DESCRIBE
  //   time, so before §380 the remapped call reached `requireToken` carrying no
  //   token, threw `ConcurrencyTokenError`, and was recorded `stale: true` —
  //   defined on `AppliedRow` as "the row moved since it was staged". The row
  //   did not EXIST when it was staged; nothing moved, and no number of retries
  //   could make the retry that label invited succeed. §380 closes the common
  //   case by stamping a REAL token at apply time through `TOKEN_ROW_SOURCE`
  //   (see the "applying a staged update whose target this same plan created"
  //   block above for the dedicated single-entity coverage, including the one
  //   case that still refuses). This test is kept as the two-entity, two-create
  //   regression pin for the DERIVATION: `TOKEN_REQUIRED_TOOLS` is computed from
  //   `TOOL_DEFS`, so a single tool passing here cannot tell a working
  //   derivation from a hardcoded special case.
  test("it applies both updates instead of the old capability-gap refusal", async () => {
    const { result } = renderApply();

    const outcome = await applyPlan(
      result,
      [
        { name: "create_task", input: { taskName: "Minted", assignee: "M. Jordan", dueDate: "2026-10-01" } },
        { name: "update_task", input: { id: 101, taskName: "Renamed" } },
        { name: "create_milestone", input: { name: "Minted milestone", date: "2026-11-01" } },
        { name: "update_milestone", input: { id: 202, name: "Renamed milestone" } },
      ],
      [101, 202],
    );

    expect(outcome.rows).toEqual([
      { index: 0, ok: true },
      { index: 1, ok: true },
      { index: 2, ok: true },
      { index: 3, ok: true },
    ]);
    expect(result.current.dispatcher.getTask(4)?.taskName).toBe("Renamed");
    expect(result.current.dispatcher.getMilestoneRow(4)?.name).toBe("Renamed milestone");
    expect(taskIds(result)).toEqual([1, 2, 3, 4]);
  });

  // ★★ THE BOUNDARY: a MODEL-supplied token passes this guard on purpose.
  //   `describeProposal` preserves one through the pending branch, and a wrong
  //   VALUE really is a token conflict — `stale` is right about that one, and
  //   relabelling it here would swallow the only case the flag is honest about.
  //   This also proves the guard is not simply refusing every pending row.
  test("a pending row carrying a model token still reaches the token check", async () => {
    const { result } = renderApply();

    const outcome = await applyPlan(
      result,
      [
        { name: "create_task", input: { taskName: "Minted", assignee: "M. Jordan", dueDate: "2026-10-01" } },
        { name: "update_task", input: { id: 101, taskName: "Renamed", expectedToken: "not-a-real-token" } },
      ],
      [101],
    );

    expect(outcome.rows[1].ok).toBe(false);
    expect(outcome.rows[1].error).not.toBe(NEW_ROW_TOKEN_UNAVAILABLE_ERROR);
    // It got as far as `requireToken`, which means the remap resolved #101 to
    // the real #4 and the row was FOUND — a not-found would have thrown first
    // and set no `stale`.
    expect(outcome.rows[1].stale).toBe(true);
  });
});

// §380 — the capability gap the block above pinned is now closed for the
// common case: `TOKEN_ROW_SOURCE` lets a pending row be stamped with a REAL
// token, read through the dispatcher after the create resolved.
describe("applying a staged update whose target this same plan created", () => {
  test("applies an update whose target this same plan created", async () => {
    const { result } = renderApply();

    // create_task mints #101 (real minter hands out #4 — SEED runs 1-2-3); the
    // update row was staged against the provisional id and therefore carries
    // NO `expectedToken`.
    const outcome = await applyPlan(
      result,
      [
        {
          name: "create_task",
          input: { taskName: "Drafted", assignee: "M. Jordan", dueDate: "2026-10-01" },
        },
        { name: "update_task", input: { id: 101, status: "Done" } },
      ],
      [101],
    );

    expect(outcome.rows).toEqual([
      { index: 0, ok: true },
      { index: 1, ok: true },
    ]);
    expect(result.current.dispatcher.getTask(4)?.status).toBe("Done");
  });

  // ★★ THE ONE CASE THE RESOLVER CANNOT RESCUE, and the reason the refusal
  //  stays in place rather than being deleted now that the happy path works.
  //  Deleting the guard would convert a loud, recoverable failure into an
  //  untokened write attempt. A REAL dispatcher's `getTask` cannot be made to
  //  miss a row it just created, so this wraps it with an override that lets
  //  the create land while its row reads back as gone.
  test("still refuses the row when the created row cannot be read back", async () => {
    const { result } = renderApply();
    const ws = seedWorkspace();
    const calls: ProposedCall[] = [
      {
        name: "create_task",
        input: { taskName: "Drafted", assignee: "M. Jordan", dueDate: "2026-10-01" },
      },
      { name: "update_task", input: { id: 101, status: "Done" } },
    ];
    const rows = describeProposal(calls, ws, buildPlanRows(calls, [101]));
    const selected = new Set(rows.map((_, i) => i));
    const dispatcher = {
      ...result.current.dispatcher,
      getTask: (id: number) => (id === 4 ? null : result.current.dispatcher.getTask(id)),
    };

    let outcome: Awaited<ReturnType<typeof applyProposal>> | undefined;
    await act(async () => {
      outcome = await applyProposal({ dispatcher, rows, selected, batch: result.current.batch });
    });

    // The create landed — so the refusal below is on a live path, not a create
    // that never happened.
    expect(outcome!.rows[0].ok).toBe(true);
    expect(outcome!.rows[1]).toEqual({
      index: 1,
      ok: false,
      error: NEW_ROW_TOKEN_UNAVAILABLE_ERROR,
    });
    expect(outcome!.rows[1].stale).toBeUndefined();
  });

  // ★★★ THE STAMPING BLOCK RUNS INSIDE THE PER-ROW `try`, AND THIS IS THE ONLY
  //  THING THAT SAYS SO. `applyProposal`'s contract is that a row which fails
  //  fails ALONE — `chat-panel.tsx` restates it in its own catch comment
  //  ("`applyProposal` catches per row, so reaching here means the BATCH
  //  failed") — and `source.getRow` (a live dispatcher read) plus `entityToken`
  //  (which walks a stored row through a CSV renderer) are new work on that
  //  path. Mutant: hoist the block back above `try {` and this row's throw
  //  escapes the loop, aborting row 2 as well and surfacing as a BATCH failure
  //  with no per-row detail at all.
  // ★ The THIRD row is what makes the case bite: without a row after the throw,
  //  an aborted loop and a per-row failure produce the same visible outcome for
  //  rows 0 and 1.
  test("a throwing resolver fails only ITS row, and later rows still apply", async () => {
    const { result } = renderApply();
    const ws = seedWorkspace();
    const calls: ProposedCall[] = [
      {
        name: "create_task",
        input: { taskName: "Drafted", assignee: "M. Jordan", dueDate: "2026-10-01" },
      },
      { name: "update_task", input: { id: 101, status: "Done" } },
      { name: "update_task", input: { id: 2, taskName: "Later" } },
    ];
    const rows = describeProposal(calls, ws, buildPlanRows(calls, [101]));
    const selected = new Set(rows.map((_, i) => i));
    const dispatcher = {
      ...result.current.dispatcher,
      // ONLY the row this plan created explodes. Every other read stays real,
      // so a refused third row could only be the defect under test.
      getTask: (id: number) => {
        if (id === 4) throw new Error("resolver exploded");
        return result.current.dispatcher.getTask(id);
      },
    };

    let outcome: Awaited<ReturnType<typeof applyProposal>> | undefined;
    await act(async () => {
      outcome = await applyProposal({ dispatcher, rows, selected, batch: result.current.batch });
    });

    expect(outcome!.rows).toEqual([
      { index: 0, ok: true },
      { index: 1, ok: false, stale: false, error: "resolver exploded" },
      { index: 2, ok: true },
    ]);
    // The row AFTER the throw genuinely wrote — the claim the outcome array on
    // its own cannot make.
    expect(result.current.dispatcher.getTask(2)?.taskName).toBe("Later");
  });
});

describe("TOKEN_REQUIRED_TOOLS", () => {
  // ★★★ THREE FACTS, TWO PINNED HERE. `expectedToken` in a schema's
  //   `properties` (what `insights/recommend-tokens.test.ts` already derives),
  //   `expectedToken` in that schema's `required` (what the guard derives), and
  //   `requireToken` actually being reached (what decides the throw) are three
  //   separate things that all equal seven today BY COINCIDENCE. This pins the
  //   first two to each other. The third is deliberately unpinned — see the
  //   docstring on the export for the hand-run command.
  //
  // ★★★ WHAT THIS TEST IS FOR, precisely: a schema edit that made
  //   `expectedToken` OPTIONAL — out of `required`, still in `properties` — is a
  //   plausible change. It would leave the recommend-tokens test GREEN, silently
  //   drop that tool from the guard's set, and restore the `stale` lie for
  //   exactly that tool. Nothing else in the repo would notice.
  //
  // Computed the same way that existing block computes it, deliberately, so the
  // two derivations are comparable rather than merely both plausible.
  const advertised = (TOOL_DEFS as ReadonlyArray<{ name: string; input_schema?: unknown }>)
    .filter(
      (d) =>
        "expectedToken" in
        ((d.input_schema as { properties?: Record<string, unknown> }).properties ?? {}),
    )
    .map((d) => d.name);

  test("the required-derived set matches the properties-derived one", () => {
    // ★★★ ANTI-VACUITY, AND IT IS THE WHOLE TEST. Two derivations that both
    //   collapsed to EMPTY would satisfy the comparison below perfectly — a
    //   "0 mismatches" pass over nothing at all. The size is asserted EXACTLY:
    //   a legitimately added token-guarded tool turns this red, which is the
    //   point. Read a red here as "go look", not as "the guard broke".
    expect(TOKEN_REQUIRED_TOOLS.size).toBe(7);
    expect(advertised).toHaveLength(7);
    expect([...TOKEN_REQUIRED_TOOLS].sort()).toEqual([...advertised].sort());
  });

  test("it names the six update tools and set_task_dependencies", () => {
    // The membership itself, so a diff that changed BOTH derivations in step
    // still has to face a human-written list. `update_resource` is spelled out
    // because it is the member `UPDATE_TARGET` omits — the trap this constant
    // exists to avoid.
    expect([...TOKEN_REQUIRED_TOOLS].sort()).toEqual([
      "set_task_dependencies",
      "update_change",
      "update_milestone",
      "update_raid_item",
      "update_resource",
      "update_stakeholder",
      "update_task",
    ]);
  });
});

// §380 — `TOKEN_ROW_SOURCE` is the map `applyProposal` reads to stamp a real
// token onto a row targeting an entity THIS SAME PLAN created. Both directions
// are asserted, and neither is redundant: a one-directional check passes
// against the mutant that matters — a future token-guarded tool added with no
// map entry, which would fall silently back to the refusal.
describe("TOKEN_ROW_SOURCE", () => {
  test("covers every token-guarded tool", () => {
    const missing = [...TOKEN_REQUIRED_TOOLS].filter((t) => !(t in TOKEN_ROW_SOURCE));
    // The population sits beside the verdict so an empty `TOKEN_REQUIRED_TOOLS`
    // cannot read as a pass.
    expect({ missing, guarded: TOKEN_REQUIRED_TOOLS.size }).toEqual({
      missing: [],
      guarded: TOKEN_REQUIRED_TOOLS.size,
    });
  });

  test("names no tool that is not token-guarded", () => {
    const extra = Object.keys(TOKEN_ROW_SOURCE).filter((t) => !TOKEN_REQUIRED_TOOLS.has(t));
    expect({ extra, mapped: Object.keys(TOKEN_ROW_SOURCE).length }).toEqual({
      extra: [],
      mapped: Object.keys(TOKEN_ROW_SOURCE).length,
    });
  });

  // ★★★ THE TWO CASES ABOVE COMPARE KEY SETS AND NOTHING ELSE, so membership
  //   drift is caught and the VALUES are not. Neither half of an entry is
  //   typed against its key: `getRow` is `(d, id) => object | null` and
  //   `entityToken` takes `object`, so `update_change: { kind: "raid", getRow:
  //   (d, id) => d.getChangeRow(id) }` typechecks and is internally consistent.
  //   Measured before this case existed: that exact mutant left
  //   `chat-proposal-apply.test.tsx` + `chat-proposal-describe.test.ts`
  //   0 failed / 56 passed. Only `update_task` and `update_milestone` had
  //   end-to-end cover (the two blocks above), so five of the seven entries
  //   were unverified.
  //
  // ★★ THE RUNTIME CONSEQUENCE IS THE LIE §381 EXISTS TO REMOVE, not a cosmetic
  //   slip: a token derived through the wrong projection fails `requireToken`,
  //   `applyProposal` records `stale: true`, and the card tells the user the
  //   row "changed since you reviewed" when nothing changed.
  //
  // ★★ GENERALISED OVER THE MAP, never a written-out list of seven — the whole
  //   point is that a new entry is covered the moment it is declared. A
  //   hand-written tool → getter → kind table would BE the map under test, so a
  //   copy of it could not disagree with it.
  describe("every entry agrees with the tool it names", () => {
    /** A dispatcher whose EVERY member answers `row` and records its own name,
     *  so this case never has to name a getter or a writer. That is what keeps
     *  it generalised: `runTool`'s guarded cases all read their row, check the
     *  token and write, and each of those three steps is satisfied by the same
     *  stub. */
    function recordingDispatcher(row: object, reached: string[]): ToolDispatcher {
      return new Proxy(
        {},
        {
          get: (_target, prop) => {
            const member = String(prop);
            return () => {
              reached.push(member);
              return row;
            };
          },
        },
      ) as unknown as ToolDispatcher;
    }

    test("its `kind` stamps a token that tool's own requireToken accepts", async () => {
      // A bare id is enough as the stored row: `entityToken` length-prefixes
      // every COLUMN NAME into the hashed string and no two entities share a
      // column list, so a wrong `kind` moves the token for ANY row. The
      // discrimination assertion below MEASURES that rather than assuming it.
      const row = { id: 1 };
      const kinds = Object.keys(TOKEN_EXCLUDED) as TokenEntity[];
      let checked = 0;

      for (const [tool, source] of Object.entries(TOKEN_ROW_SOURCE)) {
        // Which dispatcher member the RESOLVER reads — the other untyped half
        // of the entry, and a `getRow` pointing at a different entity's getter
        // fails exactly the same way its `kind` does.
        const viaResolver: string[] = [];
        source.getRow(recordingDispatcher(row, viaResolver), 1);

        // The input `applyProposal` builds: the remapped id plus an
        // `expectedToken` derived through `source.kind`, run through the REAL
        // guard rather than a re-derivation of it.
        const reached: string[] = [];
        let thrown: unknown;
        try {
          await runTool(recordingDispatcher(row, reached), tool, {
            id: 1,
            expectedToken: entityToken(source.kind, row),
            // `set_task_dependencies` refuses a non-array BEFORE reaching the
            // token check; the other six ignore or strip the key.
            dependencies: [],
          });
        } catch (e) {
          thrown = e;
        }
        expect({ tool, error: thrown instanceof Error ? thrown.message : thrown }).toEqual({
          tool,
          error: undefined,
        });
        // Anti-vacuity, per entry: a case that returned before touching the
        // dispatcher would satisfy the line above having proved nothing. Every
        // guarded case reads its row FIRST and then writes, and the resolver
        // must read that same member.
        expect({
          tool,
          resolverCalls: viaResolver.length,
          readFirst: reached[0],
          wrote: reached.length >= 2,
        }).toEqual({ tool, resolverCalls: 1, readFirst: viaResolver[0], wrote: true });

        // Anti-vacuity, per entry: the check above is only a test while some
        // OTHER kind hashes this same row differently. If the projections
        // agreed, a wrong `kind` would be undetectable and this loop would pass
        // over a broken map.
        const mine = entityToken(source.kind, row);
        const others = kinds
          .filter((k) => k !== source.kind)
          .map((k) => entityToken(k, row));
        expect({ tool, indistinguishable: others.includes(mine) }).toEqual({
          tool,
          indistinguishable: false,
        });
        checked += 1;
      }

      // Anti-vacuity, for the loop: it ran, over every declared entry, and over
      // a non-zero number of them. An `it.each` over an empty map registers
      // zero tests and reports green.
      expect(checked).toBe(Object.keys(TOKEN_ROW_SOURCE).length);
      expect(checked).toBeGreaterThan(0);
    });
  });
});

// §381 — the card must not call every not-ok row a concurrency conflict.
// `failureKindOf` classifies the four outcomes `applyProposal` can report so a
// consumer picks the right string without matching prose.
describe("failureKindOf", () => {
  test("calls a moved target a conflict", () => {
    expect(failureKindOf({ index: 0, ok: false, stale: true, error: "x changed" })).toBe(
      "conflict",
    );
  });

  test("calls an uncreated dependency a dependency failure, not a conflict", () => {
    expect(failureKindOf({ index: 0, ok: false, error: PENDING_MINT_ERROR })).toBe("dependency");
  });

  test("calls an unreadable new row unreadable, not a conflict", () => {
    expect(failureKindOf({ index: 0, ok: false, error: NEW_ROW_TOKEN_UNAVAILABLE_ERROR })).toBe(
      "unreadable",
    );
  });

  test("calls any other dispatcher throw a plain error, not a conflict", () => {
    expect(
      failureKindOf({ index: 0, ok: false, stale: false, error: "assigneeEmail is invalid" }),
    ).toBe("error");
  });
});
