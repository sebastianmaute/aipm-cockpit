import { describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBudgetBuckets } from "./use-budget-buckets";
import type { BudgetBucket } from "./types";

const bucket = (id: number, name = `B${id}`): BudgetBucket =>
  ({ id, name, taskIds: [] } as unknown as BudgetBucket);

function setup(budgets: readonly BudgetBucket[]) {
  const setBudgets = vi.fn();
  const capture = vi.fn();
  const captureComposite = vi.fn();
  const logActivity = vi.fn();
  const { result } = renderHook(() =>
    useBudgetBuckets({ budgets, setBudgets, capture, captureComposite, logActivity }),
  );
  return { result, setBudgets, capture, captureComposite, logActivity };
}

describe("commitBuckets", () => {
  test("an unchanged array writes nothing, captures nothing and logs nothing", () => {
    const before = [bucket(1)];
    const s = setup(before);
    s.result.current.commitBuckets([...before]);
    expect(s.setBudgets).not.toHaveBeenCalled();
    expect(s.capture).not.toHaveBeenCalled();
    expect(s.logActivity).not.toHaveBeenCalled();
  });

  test("an edit captures the PREVIOUS row image, not the next one", () => {
    const prev = bucket(1, "Design");
    const s = setup([prev]);
    s.result.current.commitBuckets([{ ...prev, name: "Design phase" }]);
    expect(s.capture).toHaveBeenCalledTimes(1);
    const opts = s.capture.mock.calls[0][0];
    expect(opts.edited).toEqual([prev]);
    expect(opts.entityKey).toBe("budget");
    expect(s.setBudgets).toHaveBeenCalledTimes(1);
  });

  test("a delete captures the removed row and logs budget.deleted", () => {
    // `keep` is threaded through BY REFERENCE — a re-minted equal object would
    // read as an edit and make this a delete+edit commit, not the pure delete
    // the assertions describe.
    const keep = bucket(1);
    const gone = bucket(2, "Build");
    const s = setup([keep, gone]);
    s.result.current.commitBuckets([keep]);
    expect(s.capture.mock.calls[0][0].removed).toEqual([gone]);
    expect(s.logActivity).toHaveBeenCalledWith("budget.deleted", "Build");
  });

  test("a create logs budget.created and captures NOTHING (no before-image exists)", () => {
    const keep = bucket(1); // by reference — see the delete test
    const s = setup([keep]);
    s.result.current.commitBuckets([keep, bucket(2, "New")], { kind: "budget.created", name: "New" });
    expect(s.capture).not.toHaveBeenCalled();
    expect(s.logActivity).toHaveBeenCalledWith("budget.created", "New");
    expect(s.setBudgets).toHaveBeenCalledTimes(1);
  });

  test("explicit meta.kind wins over the derived kind", () => {
    const prev = bucket(1, "Design");
    const s = setup([prev]);
    s.result.current.commitBuckets([{ ...prev, name: "x" }], { kind: "budget.deleted", name: "Design" });
    expect(s.logActivity).toHaveBeenCalledWith("budget.deleted", "Design");
  });

  test("a tasksPart routes through captureComposite instead of capture", () => {
    const prev = bucket(1, "Design");
    const s = setup([prev]);
    const tasksPart = { isPrimary: false, restore: () => () => {} };
    s.result.current.commitBuckets([{ ...prev, name: "x" }], {
      kind: "bulk.edit", primaryCount: 3, tasksPart,
    });
    expect(s.capture).not.toHaveBeenCalled();
    expect(s.captureComposite).toHaveBeenCalledTimes(1);
    const opts = s.captureComposite.mock.calls[0][0];
    expect(opts.primaryCount).toBe(3);
    expect(opts.parts[0]).toBe(tasksPart);
    expect(opts.parts[1]).not.toBeNull();
  });
  test("callerLogs suppresses the boundary log so a bulk apply writes ONE row", () => {
    const prev = bucket(1, "Design");
    const s = setup([prev]);
    s.result.current.commitBuckets([{ ...prev, name: "x" }], { kind: "bulk.edit", callerLogs: true });
    expect(s.logActivity).not.toHaveBeenCalled();
    expect(s.setBudgets).toHaveBeenCalledTimes(1);
  });
});
