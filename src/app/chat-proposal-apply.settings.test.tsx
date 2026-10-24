// §779 — an `update_settings { enabledModules }` beside a task write now goes to the review card (owner
// decision 2026-10-24, "Count it"). Apply re-invokes each staged call, so the staged settings row must reach
// the same handler a lone call does and save the project's functions. The REAL dispatcher and undo batch, as
// in chat-proposal-apply.test.tsx.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { applyProposal } from "./chat-proposal-apply";
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
      const { features, tasks } = useWorkspace();
      return { batch, dispatcher, features, tasks };
    },
    { wrapper: dispatcherWrapperWith(SEED) },
  );
}

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
    const plan = buildPlanRows(calls, []);
    const rows = describeProposal(calls, { ...emptyWorkspace(), tasks: [TASK] }, plan);
    let outcome: Awaited<ReturnType<typeof applyProposal>> | undefined;
    await act(async () => {
      outcome = await applyProposal({
        dispatcher: result.current.dispatcher,
        rows,
        selected: new Set([0, 1]),
        batch: result.current.batch,
      });
    });
    expect(outcome!.rows.map((r) => r.ok)).toEqual([true, true]);
    expect(result.current.features).toEqual(LEAN);
    expect(result.current.tasks.find((t) => t.id === 1)?.priority).toBe("High");
  });
});
