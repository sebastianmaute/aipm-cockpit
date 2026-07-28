import { describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTaskBudgetLink } from "./use-task-budget-link";
import type { BudgetBucket } from "./types";

const bucket = (id: number, taskIds: number[] = []): BudgetBucket =>
  ({ id, name: `B${id}`, taskIds } as unknown as BudgetBucket);

function setup(editingId: number | null, buckets = [bucket(1, [7]), bucket(2)]) {
  const commitBuckets = vi.fn();
  const flushEditorBuffer = vi.fn();
  const discardEditorBuffer = vi.fn();
  const { result, rerender } = renderHook(
    (props: { editingId: number | null }) =>
      useTaskBudgetLink({
        enabled: true,
        budgets: buckets,
        editingId: props.editingId,
        commitBuckets,
        flushEditorBuffer,
        discardEditorBuffer,
      }),
    { initialProps: { editingId } },
  );
  return { result, rerender, commitBuckets, flushEditorBuffer, discardEditorBuffer };
}

describe("useTaskBudgetLink", () => {
  test("shows the task's current bucket in edit mode", () => {
    expect(setup(7).result.current.budgetLink!.bucketId).toBe(1);
  });

  test("edit mode applies immediately", () => {
    const s = setup(7);
    act(() => s.result.current.budgetLink!.onChange(2));
    expect(s.commitBuckets).toHaveBeenCalledTimes(1);
    const [next] = s.commitBuckets.mock.calls[0];
    expect(next.find((b: BudgetBucket) => b.id === 2)!.taskIds).toEqual([7]);
    expect(next.find((b: BudgetBucket) => b.id === 1)!.taskIds).toEqual([]);
  });

  test("create mode stages instead of committing, then applies on the minted id", () => {
    const s = setup(null);
    act(() => s.result.current.budgetLink!.onChange(2));
    expect(s.commitBuckets).not.toHaveBeenCalled();
    expect(s.result.current.budgetLink!.bucketId).toBe(2);
    act(() => s.result.current.onTaskCreated(42));
    expect(s.flushEditorBuffer).toHaveBeenCalledWith(42);
    const [next] = s.commitBuckets.mock.calls[0];
    expect(next.find((b: BudgetBucket) => b.id === 2)!.taskIds).toEqual([42]);
  });

  test("a create with no bucket chosen commits nothing", () => {
    const s = setup(null);
    act(() => s.result.current.onTaskCreated(42));
    expect(s.flushEditorBuffer).toHaveBeenCalledWith(42);
    expect(s.commitBuckets).not.toHaveBeenCalled();
  });

  test("discard drops the staged selection and forwards to the buffer", () => {
    const s = setup(null);
    act(() => s.result.current.budgetLink!.onChange(2));
    act(() => s.result.current.onEditorDiscard());
    expect(s.discardEditorBuffer).toHaveBeenCalledTimes(1);
    expect(s.result.current.budgetLink!.bucketId).toBeNull();
  });

  test("budgetLink is undefined when the budget module is off", () => {
    const { result } = renderHook(() =>
      useTaskBudgetLink({
        enabled: false, budgets: [bucket(1)], editingId: 7,
        commitBuckets: vi.fn(), flushEditorBuffer: vi.fn(), discardEditorBuffer: vi.fn(),
      }),
    );
    expect(result.current.budgetLink).toBeUndefined();
  });

  test("create mode links the MINTED id even when the open-time id was taken", () => {
    // Seed bucket 2 already holding id 41 (a row a concurrent writer created);
    // the editor was opened when 41 was free.
    const s = setup(null, [bucket(1), bucket(2, [41])]);
    act(() => s.result.current.budgetLink!.onChange(2));
    act(() => s.result.current.onTaskCreated(42));
    const [next] = s.commitBuckets.mock.calls[0];
    expect(next.find((b: BudgetBucket) => b.id === 2)!.taskIds).toEqual([41, 42]);
  });
});
