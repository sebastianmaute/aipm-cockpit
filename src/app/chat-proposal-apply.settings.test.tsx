// §779 — an `update_settings { enabledModules }` beside a task write now goes to the review card (owner
// decision 2026-10-24, "Count it"). Apply re-invokes each staged call, so the staged settings row must reach
// the same handler a lone call does and save the project's functions. The REAL dispatcher and undo batch, as
// in chat-proposal-apply.test.tsx.
//
// The write takes no concurrency token, so Apply re-judges a functions row against the saved functions
// itself: the card described the change against a baseline, and if the project's functions moved since,
// the row is refused as a conflict and writes nothing.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { applyProposal, failureKindOf, type FailedAppliedRow } from "./chat-proposal-apply";
import { buildPlanRows, shouldStage, type ProposedCall } from "./chat-proposal";
import { describeProposal } from "./chat-proposal-describe";
import type { FeatureModuleId } from "./feature-modules";
import { resetMintState } from "./id-mint-session";
import type { TestSeed } from "./test-providers";
import { DEFAULT_TASK_STATUS, type Task } from "./types";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { useUndoBatch } from "./use-undo-batch";
import { useUndoStack } from "./undo/use-undo-stack";
import { emptyWorkspace } from "./workspace";
import { useWorkspace } from "./workspace-context";

const LEAN: FeatureModuleId[] = ["dashboard", "milestones", "raid"];
const SAVED: FeatureModuleId[] = ["dashboard", "budget"];

const TASK: Task = {
  id: 1,
  taskName: "Draft the plan",
  assignee: "M. Bennett",
  assigneeEmail: "",
  dueDate: "2026-09-30",
  lastUpdateDate: "2026-05-19",
  priority: "Medium",
  status: DEFAULT_TASK_STATUS,
  blockers: "",
  description: "",
};
const SEED: TestSeed = { tasks: [TASK] };

function renderApply() {
  return renderHook(
    () => {
      const undo = useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction: vi.fn() });
      const batch = useUndoBatch(undo);
      const dispatcher = useChatDispatcher(makeDispatcherArgs({ undo: batch.undo }));
      const { features, setFeatures, tasks } = useWorkspace();
      return { batch, dispatcher, features, setFeatures, tasks };
    },
    { wrapper: dispatcherWrapperWith(SEED) },
  );
}

type Rendered = ReturnType<typeof renderApply>["result"];

/** Describe `calls` against saved functions `staged`; optionally move the live functions to `moved`
 *  before Apply; then apply `selected`, reading the LIVE functions as chat-panel wires it. */
async function stageAndApply(
  result: Rendered,
  calls: readonly ProposedCall[],
  staged: readonly FeatureModuleId[] | undefined,
  opts: { selected?: readonly number[]; moved?: FeatureModuleId[] } = {},
) {
  const rows = describeProposal(calls, { ...emptyWorkspace(), tasks: [TASK], features: staged }, buildPlanRows(calls, []));
  if (opts.moved) {
    const moved = opts.moved;
    act(() => { result.current.setFeatures(moved); });
  }
  let outcome: Awaited<ReturnType<typeof applyProposal>> | undefined;
  await act(async () => {
    outcome = await applyProposal({
      dispatcher: result.current.dispatcher,
      rows,
      selected: new Set(opts.selected ?? calls.map((_, i) => i)),
      batch: result.current.batch,
      getFeatures: () => result.current.features,
    });
  });
  return { rows, outcome: outcome! };
}

const kind = (row: { ok: boolean }) => failureKindOf(row as FailedAppliedRow);

beforeEach(() => {
  resetMintState();
});

describe("a staged update_settings { enabledModules } applies the functions change (§779)", () => {
  // Mutation: dropping `if (changes.features) setFeatures(...)` in `updateSettings` turns this red
  // (the staged row reports success while the project's functions stay unset).
  test("both rows apply and the project's saved functions are the staged list", async () => {
    const { result } = renderApply();
    const calls: ProposedCall[] = [
      { name: "update_task", input: { id: 1, priority: "High" } },
      { name: "update_settings", input: { enabledModules: LEAN } },
    ];
    expect(shouldStage(calls)).toBe(true);
    const { outcome } = await stageAndApply(result, calls, undefined);
    expect(outcome.rows.map((r) => r.ok)).toEqual([true, true]);
    expect(result.current.features).toEqual(LEAN);
    expect(result.current.tasks.find((t) => t.id === 1)?.priority).toBe("High");
  });
});

describe("Apply refuses a functions row whose baseline moved (§779)", () => {
  const PAIR: ProposedCall[] = [
    { name: "update_task", input: { id: 1, priority: "High" } },
    { name: "update_settings", input: { enabledModules: LEAN } },
  ];

  // Mutation: dropping the baseline check in `applyProposal` turns this red (the row applies over the
  // user's change, which the card never showed).
  test("functions changed after staging → the row is refused as a conflict and writes nothing", async () => {
    const { result } = renderApply();
    act(() => { result.current.setFeatures(SAVED); });
    const { outcome } = await stageAndApply(result, PAIR, SAVED, { moved: [...SAVED, "changes"] });
    const [task, functions] = outcome.rows;
    expect(task.ok).toBe(true);
    expect(functions.ok).toBe(false);
    expect(kind(functions)).toBe("conflict");
    expect(result.current.features).toEqual([...SAVED, "changes"]);
  });

  test("functions unchanged since staging → the row applies", async () => {
    const { result } = renderApply();
    act(() => { result.current.setFeatures(SAVED); });
    const { outcome } = await stageAndApply(result, PAIR, SAVED);
    expect(outcome.rows.map((r) => r.ok)).toEqual([true, true]);
    expect(result.current.features).toEqual(LEAN);
  });

  // The order of a saved list does not count: the check compares sets.
  test("the same functions in another order still apply", async () => {
    const { result } = renderApply();
    act(() => { result.current.setFeatures(["budget", "dashboard"]); });
    const { outcome } = await stageAndApply(result, [PAIR[1]], SAVED);
    expect(outcome.rows[0].ok).toBe(true);
  });
});

describe("two functions rows in one staged turn (§779)", () => {
  const TWO: ProposedCall[] = [
    { name: "update_settings", input: { enabledModules: LEAN } },
    { name: "update_settings", input: { enabledModules: ["raid"] } },
  ];

  // Mutation: not threading row 1's result as row 2's Apply-time baseline turns this red (row 2 is
  // refused as a conflict against the list row 1 just wrote).
  test("both apply in order, and the second's baseline is the first's result", async () => {
    const { result } = renderApply();
    act(() => { result.current.setFeatures(SAVED); });
    const { rows, outcome } = await stageAndApply(result, TWO, SAVED);
    expect(rows[1].functions?.before).toEqual(LEAN);
    expect(outcome.rows.map((r) => r.ok)).toEqual([true, true]);
    expect(result.current.features).toEqual(["raid"]);
  });

  test("with the first refused on the card, the second is refused as a conflict", async () => {
    const { result } = renderApply();
    act(() => { result.current.setFeatures(SAVED); });
    const { outcome } = await stageAndApply(result, TWO, SAVED, { selected: [1] });
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0].ok).toBe(false);
    expect(kind(outcome.rows[0])).toBe("conflict");
    expect(result.current.features).toEqual(SAVED);
  });
});
