import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { dispatcherWrapper, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { DEFAULT_TASK_STATUS, type Task } from "./types";
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
  test("createTask pushes exactly one undo entry", () => {
    const captureComposite = vi.fn();
    const { result } = renderHook(
      () => useChatDispatcher(makeDispatcherArgs({ undo: { captureComposite } })),
      { wrapper: dispatcherWrapper() },
    );

    act(() => {
      result.current.createTask({
        taskName: "Ingest review",
        assignee: "M. Jordan",
        dueDate: "2026-09-30",
      });
    });

    expect(captureComposite).toHaveBeenCalledTimes(1);
    const opts = captureComposite.mock.calls[0][0];
    expect(opts.kind).toBe("task.created");
    expect(opts.primaryCount).toBe(1);
  });

  test("createTask captures a fragment against a non-empty task list", () => {
    const captureComposite = vi.fn();
    const existing = [seedTask(1, "First"), seedTask(2, "Second")];
    const { result } = renderHook(
      () => useChatDispatcher(makeDispatcherArgs({ undo: { captureComposite } })),
      { wrapper: dispatcherWrapper(existing) },
    );

    act(() => {
      result.current.createTask({
        taskName: "Third",
        assignee: "M. Jordan",
        dueDate: "2026-09-30",
      });
    });

    // ★★ DELIBERATELY WEAK, AND IT MUST NOT BE OVERSOLD. `capturePart` returns
    //    null ONLY for an empty image list, so this proves that
    //    `buildBeforeImages` produced an image at all — it can NOT observe the
    //    recorded index, and so cannot tell a `fromArray: next` capture from a
    //    `fromArray: list` one (which silently records index 0 for a row absent
    //    from the pre-op array). Nor can it see that the undo DIRECTION is wrong
    //    for a create: the engine has no create op, so restoring this image
    //    duplicates the row rather than removing it. Both need the real
    //    `useUndoStack` and an actual undo — the round-trip test, not this one.
    expect(captureComposite.mock.calls[0][0].parts[0]).not.toBeNull();
  });
});
