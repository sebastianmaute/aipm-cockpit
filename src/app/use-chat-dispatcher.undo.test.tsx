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
});
