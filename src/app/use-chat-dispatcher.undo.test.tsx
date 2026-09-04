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
