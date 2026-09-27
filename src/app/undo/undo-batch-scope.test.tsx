// §628 — an undo BATCH is stamped with the scope epoch it OPENED in.
//
// `useUndoBatch.runBatched` pushes its one composite after `await fn()`. A stamp
// taken at PUSH time would label a batch whose rows were read in project A with
// project B's epoch if a switch landed mid-batch, and then neither the falling-edge
// prune nor the restore-time check could ever drop it: an undo would write A's rows
// into B. The batch passes its opening epoch as `readEpoch`, and a stale one is
// refused at push.
//
// Mutations (each named, each turns a test here red):
//   BM1 — the flush passes `one` instead of `{ ...one, readEpoch: openEpoch }`
//         (the push-time epoch): "a batch read in A and closed in B" is red.
//   BM2 — delete the stale `readEpoch` refusal in `pushEntry`: the same test is red
//         (the entry reaches the stack, stamped A).
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { useUndoStack, usePruneUndoOnScopeChange, capturePart } from "./use-undo-stack";
import { useUndoBatch } from "../use-undo-batch";

type Row = { id: number; name: string };

const A_BEFORE: readonly Row[] = [{ id: 1, name: "A1" }, { id: 2, name: "A2" }, { id: 3, name: "A3" }];
const A_AFTER: readonly Row[] = [{ id: 1, name: "A1" }, { id: 3, name: "A3" }];
// B has its OWN task 2, so a wrongly-applied undo of A's delete visibly changes B.
const B_ROWS: readonly Row[] = [{ id: 1, name: "B1" }, { id: 2, name: "B2-unrelated" }, { id: 7, name: "B7" }];

function setup() {
  let epoch = 0;
  const getScopeEpoch = () => epoch;
  const deps = {
    lang: "en-US" as const,
    logActivity: vi.fn(),
    showToast: vi.fn(),
    showToastAction: vi.fn(),
    getScopeEpoch,
  };
  const box = { rows: A_BEFORE };
  const setter: Dispatch<SetStateAction<readonly Row[]>> = (u) => {
    box.rows = typeof u === "function" ? u(box.rows) : u;
  };
  const hook = renderHook(
    ({ loadPending }: { loadPending: boolean }) => {
      const api = useUndoStack(deps);
      usePruneUndoOnScopeChange(loadPending, api.pruneStale);
      const batch = useUndoBatch(api, getScopeEpoch);
      return { api, batch };
    },
    { initialProps: { loadPending: false } },
  );

  /** Open a batch that deletes task 2 in A and captures it, then waits on a gate. */
  function openBatch() {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let done!: Promise<void>;
    act(() => {
      done = hook.result.current.batch.runBatched(async () => {
        const from = box.rows;
        box.rows = A_AFTER;
        hook.result.current.batch.undo.captureComposite({
          kind: "task.deleted",
          primaryCount: 1,
          parts: [capturePart({ setter, removed: [from[1]], fromArray: from, isPrimary: true })],
        });
        await gate;
      });
    });
    return async () => { await act(async () => { release(); await done; }); };
  }

  return { hook, deps, box, openBatch, bump: () => { epoch += 1; } };
}

describe("useUndoBatch — scope epoch (§628)", () => {
  it("a batch that opens and closes in one scope pushes one entry, and its undo applies", async () => {
    const { hook, deps, box, openBatch } = setup();
    const close = openBatch();
    // Collected, not pushed, while the batch is open.
    expect(hook.result.current.api.stack).toHaveLength(0);
    await close();
    expect(hook.result.current.api.stack).toHaveLength(1);
    expect(deps.showToastAction).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.api.undo());
    expect(box.rows).toEqual(A_BEFORE);
  });

  it("a batch read in A and closed after a switch to B is refused, and nothing reaches B on undo", async () => {
    const { hook, deps, box, openBatch, bump } = setup();
    const close = openBatch();
    // The switch lands mid-batch: hold rises, epoch bumps, B loads, hold falls.
    hook.rerender({ loadPending: true });
    bump();
    box.rows = B_ROWS;
    hook.rerender({ loadPending: false });

    await close();

    expect(hook.result.current.api.stack).toHaveLength(0);
    expect(hook.result.current.api.canUndo).toBe(false);
    expect(deps.showToastAction).not.toHaveBeenCalled();
    act(() => hook.result.current.api.undo());
    expect(box.rows).toEqual(B_ROWS);
    expect(deps.logActivity).not.toHaveBeenCalled();
  });
});
