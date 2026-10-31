// §774 Task 5 — a reassignment by Claude (`update_task`) moves the task's planned hours through the
// shared step, in the SAME undo entry as the task write, and leaves the model a note of what moved.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
// AI people protection, Task 6: rendered without task-manager's privacy provider, where the people getter
// fails closed (protected) and the executor would strip person fields. These tests are about the feature.
vi.mock("./ai-privacy-context", () => import("../test/ai-privacy-unprotected"));
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { LIAM, LIAM_OWNS, MAYA, RIG_TASK, expectedNotice, rigSpies, useReassignRigOver } from "../test/reassign-hours-rig";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { useUndoBatch } from "./use-undo-batch";
import { runTool } from "./chat-tools";
import { entityToken } from "./ai-entity-token";
import { useWorkspace } from "./workspace-context";

function renderWithHours() {
  const spies = rigSpies();
  return renderHook(
    () => {
      const { tasks, setTasks, resources, setResources } = useWorkspace();
      const rig = useReassignRigOver(spies, { tasks, setTasks, resources, setResources });
      const dispatcher = useChatDispatcher(makeDispatcherArgs({ undo: rig.undo, reassignHours: rig.reassignHours }));
      return { ...rig, dispatcher };
    },
    { wrapper: dispatcherWrapperWith({ tasks: [RIG_TASK], resources: [MAYA, LIAM] }) },
  );
}

const util = (rs: readonly { id: number; utilization: Record<string, number> }[], id: number) => rs.find((r) => r.id === id)?.utilization;

describe("update_task moves the planned hours (§774)", () => {
  it("update_task reassign moves the hours and reports them in the tool result", () => {
    const { result } = renderWithHours();
    act(() => { result.current.dispatcher.updateTask(RIG_TASK.id, { assignee: LIAM_OWNS.assignee }); });

    expect(result.current.dispatcher.getTask(RIG_TASK.id)?.resourceId).toBe(2);
    expect(util(result.current.resources, 1)).toEqual({ "2026-09": 32, "2026-10": 32, "2026-11": 20 });
    expect(util(result.current.resources, 2)).toEqual({ "2026-09": 8, "2026-10": 8 });
    const note = expectedNotice({ task: { ...RIG_TASK, ...LIAM_OWNS }, fromResourceId: 1, toResourceId: 2, fromAssignee: "Maya Patel" });
    expect(note).not.toBeNull();
    expect(result.current.dispatcher.takePlannedHoursNote?.()).toBe(note);
    // Read once: a second read is empty, so the next tool call cannot repeat it.
    expect(result.current.dispatcher.takePlannedHoursNote?.()).toBeNull();
  });

  it("the reassignment and its hours are ONE undo entry", () => {
    const { result } = renderWithHours();
    act(() => { result.current.dispatcher.updateTask(RIG_TASK.id, { assignee: LIAM_OWNS.assignee }); });
    expect(result.current.undo.stack).toHaveLength(1);
    expect(util(result.current.resources, 2)).toEqual({ "2026-09": 8, "2026-10": 8 });

    act(() => { result.current.undo.undo(); });
    expect(result.current.dispatcher.getTask(RIG_TASK.id)?.resourceId).toBe(1);
    expect(util(result.current.resources, 1)).toEqual(MAYA.utilization);
    expect(util(result.current.resources, 2)).toEqual({});
  });

  it("an update_task that only changes another field moves nothing and reports nothing extra", () => {
    const { result } = renderWithHours();
    act(() => { result.current.dispatcher.updateTask(RIG_TASK.id, { priority: "High" }); });
    expect(util(result.current.resources, 1)).toEqual(MAYA.utilization);
    expect(util(result.current.resources, 2)).toEqual({});
    expect(result.current.dispatcher.takePlannedHoursNote?.() ?? null).toBeNull();
    expect(result.current.undo.stack).toHaveLength(1);
  });
});

// A staged chat plan applies its tool calls inside `runBatched`, which collapses every capture into ONE entry.
function renderStaged() {
  const spies = rigSpies();
  const second = { ...RIG_TASK, id: 11, taskName: "Test plan", remainingEstimateMinutes: 8 * 60 };
  const view = renderHook(
    () => {
      const { tasks, setTasks, resources, setResources } = useWorkspace();
      const rig = useReassignRigOver(spies, { tasks, setTasks, resources, setResources });
      const batch = useUndoBatch(rig.undo);
      const dispatcher = useChatDispatcher(makeDispatcherArgs({ undo: batch.undo, reassignHours: rig.reassignHours }));
      return { ...rig, batch, dispatcher };
    },
    { wrapper: dispatcherWrapperWith({ tasks: [RIG_TASK, second], resources: [MAYA, LIAM] }) },
  );
  return { ...view, spies };
}

describe("a staged plan's reassignments (§774)", () => {
  it("a staged plan's reassign is one undo entry with its hours", async () => {
    const { result, spies } = renderStaged();
    await act(async () => {
      await result.current.batch.runBatched(async () => {
        result.current.dispatcher.updateTask(10, { assignee: LIAM_OWNS.assignee });
        result.current.dispatcher.updateTask(11, { assignee: LIAM_OWNS.assignee });
      });
    });
    expect(result.current.undo.stack).toHaveLength(1);
    // 16 h + 8 h, each split evenly over Sep and Oct.
    expect(util(result.current.resources, 2)).toEqual({ "2026-09": 12, "2026-10": 12 });
    expect(util(result.current.resources, 1)).toEqual({ "2026-09": 28, "2026-10": 28, "2026-11": 20 });
    // The collapsed entry's toast still says what moved.
    const toast = spies.showToastAction.mock.calls.at(-1)?.[1] ?? "";
    expect(toast).toContain("Liam Foster");

    act(() => { result.current.undo.undo(); });
    expect(result.current.dispatcher.getTask(10)?.resourceId).toBe(1);
    expect(result.current.dispatcher.getTask(11)?.resourceId).toBe(1);
    expect(util(result.current.resources, 1)).toEqual(MAYA.utilization);
    expect(util(result.current.resources, 2)).toEqual({});
  });
});

// Inline AI edit applies its card through `runTool(dispatcher, "update_task", patch)` on the SAME dispatcher
// (`use-inline-entity-edit.ts`), so the tool path below is the path it takes.
describe("inline AI edit (§774)", () => {
  it("inline AI edit reassign moves the hours", async () => {
    const { result } = renderWithHours();
    const stored = result.current.dispatcher.getTask(RIG_TASK.id);
    expect(stored).not.toBeNull();
    let out: Record<string, unknown> = {};
    await act(async () => {
      out = (await runTool(result.current.dispatcher, "update_task", {
        id: RIG_TASK.id, expectedToken: entityToken("task", stored!), assignee: LIAM_OWNS.assignee,
      })) as Record<string, unknown>;
    });
    expect(util(result.current.resources, 2)).toEqual({ "2026-09": 8, "2026-10": 8 });
    expect(out.plannedHours).toEqual(expect.stringContaining("Liam Foster"));
  });
});
