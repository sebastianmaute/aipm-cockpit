// §810 — the AI cannot lift a function withdrawal on its own. While the project hides Resources (or Stakeholders),
// an `update_settings` whose `enabledModules` turns that function back ON always goes to the review card, whatever
// the review switch says; until the card is applied the withdrawn tools are still refused, and applying it turns
// the function on. The REAL dispatcher (its live functions), people allowed, so Resources is the only gate.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
vi.mock("./ai-privacy-context", () => import("../test/ai-privacy-unprotected"));
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { applyProposal } from "./chat-proposal-apply";
import { buildPlanRows, liftsFunctionWithdrawal, shouldStage, type ProposedCall } from "./chat-proposal";
import { describeProposal } from "./chat-proposal-describe";
import { RESOURCES_HIDDEN_TOOL_REFUSAL } from "./chat-tool-defs";
import { runTool, type ToolDispatcher } from "./chat-tools";
import type { FeatureModuleId } from "./feature-modules";
import { resetMintState } from "./id-mint-session";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { useUndoBatch } from "./use-undo-batch";
import { useUndoStack } from "./undo/use-undo-stack";
import { emptyWorkspace } from "./workspace";
import { useWorkspace } from "./workspace-context";

const HIDDEN: FeatureModuleId[] = ["dashboard", "raid"];

function renderDispatcher() {
  return renderHook(
    () => {
      const undo = useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction: vi.fn() });
      const batch = useUndoBatch(undo);
      const dispatcher = useChatDispatcher(makeDispatcherArgs({ undo: batch.undo }));
      const { features, setFeatures } = useWorkspace();
      return { batch, dispatcher, features, setFeatures };
    },
    { wrapper: dispatcherWrapperWith({ features: HIDDEN }) },
  );
}

/** The staging decision as chat-panel makes it: the dispatcher's live functions decide what is withdrawn. */
function stages(d: ToolDispatcher, calls: readonly ProposedCall[]): boolean {
  const lifts = (c: ProposedCall) =>
    liftsFunctionWithdrawal(c, { resources: d.isResourcesHidden(), stakeholders: d.isStakeholdersHidden() });
  return shouldStage(calls, undefined, undefined, false, lifts);
}

beforeEach(() => {
  resetMintState();
});

describe("turning a hidden function back on through the AI (§810)", () => {
  test("a lone call that turns Resources on stages, and the Resources tools stay refused until it is applied", async () => {
    const { result } = renderDispatcher();
    const reEnable: ProposedCall = { name: "update_settings", input: { enabledModules: [...HIDDEN, "resources"] } };
    expect(stages(result.current.dispatcher, [reEnable])).toBe(true);
    // Staged, not run: the executor still reads the saved functions and refuses a Resources tool in this send.
    await expect(runTool(result.current.dispatcher, "list_resources", {})).rejects.toThrow(RESOURCES_HIDDEN_TOOL_REFUSAL);

    // The owner applies the card: the function is on and the tool is served.
    const rows = describeProposal([reEnable], { ...emptyWorkspace(), features: HIDDEN }, buildPlanRows([reEnable], []));
    await act(async () => {
      await applyProposal({
        dispatcher: result.current.dispatcher, rows, selected: new Set([0]),
        batch: result.current.batch, getFeatures: () => result.current.features,
      });
    });
    expect(result.current.features).toContain("resources");
    await expect(runTool(result.current.dispatcher, "list_resources", {})).resolves.toEqual([]);
  });

  test("a lone call that turns Stakeholders on stages while Stakeholders is hidden", () => {
    const { result } = renderDispatcher();
    expect(stages(result.current.dispatcher, [{ name: "update_settings", input: { enabledModules: [...HIDDEN, "stakeholders"] } }])).toBe(true);
  });

  test("CONTROL: a lone call that keeps or hides functions applies at once, as before", () => {
    const { result } = renderDispatcher();
    expect(stages(result.current.dispatcher, [{ name: "update_settings", input: { enabledModules: ["raid"] } }])).toBe(false);
    expect(stages(result.current.dispatcher, [{ name: "update_settings", input: { enabledModules: [...HIDDEN, "budget"] } }])).toBe(false);
  });

  test("CONTROL: with Resources shown, naming it again is not a re-enable", () => {
    expect(liftsFunctionWithdrawal({ name: "update_settings", input: { enabledModules: ["resources"] } }, { resources: false, stakeholders: false })).toBe(false);
    expect(liftsFunctionWithdrawal({ name: "update_task", input: { id: 1 } }, { resources: true, stakeholders: true })).toBe(false);
  });
});
