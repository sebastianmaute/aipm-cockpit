import type { Dispatch, SetStateAction } from "react";
import { describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBudgetBuckets } from "./use-budget-buckets";
import type { BudgetBucket } from "./types";
import type { BudgetHistoryEntry, ProjectBac } from "./budget-history";

// `allocationCount` defaults to 0 so every pre-existing call site (which never
// passes it) keeps producing a bucket with an empty `allocations` array — the
// budget-history stub below reads `allocations.length`, so a bucket without
// the field would throw.
const bucket = (id: number, name = `B${id}`, allocationCount = 0): BudgetBucket =>
  ({
    id, name, taskIds: [],
    allocations: Array.from({ length: allocationCount }, () => ({})),
  } as unknown as BudgetBucket);

type HistoryDeps = {
  projectBac?: (buckets: readonly BudgetBucket[]) => ProjectBac;
  setBudgetHistory?: Dispatch<SetStateAction<readonly BudgetHistoryEntry[]>>;
  today?: string;
};

// Mirrors the brief's stub: 10 hours / 100 EUR per allocation, summed across buckets.
const stubProjectBac = (buckets: readonly BudgetBucket[]): ProjectBac => ({
  hours: buckets.reduce((s, b) => s + b.allocations.length * 10, 0),
  value: buckets.reduce((s, b) => s + b.allocations.length * 100, 0),
});

const TODAY = "2026-01-15";

function setup(budgets: readonly BudgetBucket[], extra: HistoryDeps = {}) {
  const setBudgets = vi.fn();
  const allowDestructiveSave = vi.fn();
  const capture = vi.fn();
  const captureComposite = vi.fn();
  const logActivity = vi.fn();
  const { result } = renderHook(() =>
    useBudgetBuckets({
      budgets, setBudgets, allowDestructiveSave, capture, captureComposite, logActivity, ...extra,
    }),
  );
  return { result, setBudgets, allowDestructiveSave, capture, captureComposite, logActivity };
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
  // ★★ `budgets` is a COUNTED slice, so a deliberate bucket deletion can trip
  // the save-time data-loss guard. The bypass is ONE-SHOT: these two tests are
  // split so vitest cannot abort at the first hard assertion and leave the
  // other unexecuted — the leak case is the one that turns a data-loss FIX into
  // a data-loss VECTOR, and it must be proved on its own.
  test("commitBuckets arms the destructive-save bypass once when it removed a bucket", () => {
    const keep = bucket(1); // by reference — see the delete test
    const gone = bucket(2, "Build");
    const s = setup([keep, gone]);
    s.result.current.commitBuckets([keep]);
    expect(s.allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  test("commitBuckets does NOT arm when the commit removed nothing", () => {
    const keep = bucket(1, "Design");
    const gone = bucket(2, "Build");
    const s = setup([keep, gone]);
    // An EDIT-only commit: `touched` is 1, `deleted` is empty. Arming here
    // would leak the one-shot bypass into whatever save comes next.
    s.result.current.commitBuckets([{ ...keep, name: "Design phase" }, gone]);
    expect(s.allowDestructiveSave).not.toHaveBeenCalled();
    // POSITIVE CONTROL — same hook, same spy. Without it this block passes
    // identically against a tree where the arming line was never written.
    s.result.current.commitBuckets([keep]);
    expect(s.allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  test("callerLogs suppresses the boundary log so a bulk apply writes ONE row", () => {
    const prev = bucket(1, "Design");
    const s = setup([prev]);
    s.result.current.commitBuckets([{ ...prev, name: "x" }], { kind: "bulk.edit", callerLogs: true });
    expect(s.logActivity).not.toHaveBeenCalled();
    expect(s.setBudgets).toHaveBeenCalledTimes(1);
  });
});

describe("commitBuckets — budget history recording", () => {
  test("(a) creating a bucket that moves BAC writes [baseline, created] named after the new bucket", () => {
    const keep = bucket(1, "Design", 0);
    const setBudgetHistory = vi.fn();
    const s = setup([keep], { projectBac: stubProjectBac, setBudgetHistory, today: TODAY });
    const created = bucket(2, "Build", 1);
    s.result.current.commitBuckets([keep, created]);

    expect(setBudgetHistory).toHaveBeenCalledTimes(1);
    const updater = setBudgetHistory.mock.calls[0][0];
    expect(typeof updater).toBe("function");
    const result = (updater as (h: readonly BudgetHistoryEntry[]) => readonly BudgetHistoryEntry[])([]);
    expect(result.map((e) => e.kind)).toEqual(["baseline", "created"]);
    expect(result[1].bucketName).toBe("Build");
    expect(result[0].projectBacHours).toBe(0);
    expect(result[1].projectBacHours).toBe(10);
  });

  test("(b) a rename-only update writes nothing observable — the updater is a no-op over any seed", () => {
    const prev = bucket(1, "Design", 2);
    const setBudgetHistory = vi.fn();
    const s = setup([prev], { projectBac: stubProjectBac, setBudgetHistory, today: TODAY });
    s.result.current.commitBuckets([{ ...prev, name: "Design phase" }]);

    if (setBudgetHistory.mock.calls.length === 0) return; // acceptable per ambiguity resolution
    const updater = setBudgetHistory.mock.calls[0][0];
    const seed: readonly BudgetHistoryEntry[] = [];
    const applied = typeof updater === "function"
      ? (updater as (h: readonly BudgetHistoryEntry[]) => readonly BudgetHistoryEntry[])(seed)
      : updater;
    expect(applied).toBe(seed);
  });

  test("(c) deleting writes a deleted entry named after the removed bucket", () => {
    const keep = bucket(1, "Design", 0);
    const gone = bucket(2, "Build", 3);
    const setBudgetHistory = vi.fn();
    const s = setup([keep, gone], { projectBac: stubProjectBac, setBudgetHistory, today: TODAY });
    s.result.current.commitBuckets([keep]);

    expect(setBudgetHistory).toHaveBeenCalledTimes(1);
    const updater = setBudgetHistory.mock.calls[0][0] as (h: readonly BudgetHistoryEntry[]) => readonly BudgetHistoryEntry[];
    const result = updater([]);
    const deletedEntry = result.find((e) => e.kind === "deleted");
    expect(deletedEntry?.bucketName).toBe("Build");
  });

  test("(d) without projectBac (an old caller) nothing is recorded and nothing throws", () => {
    const keep = bucket(1, "Design", 0);
    const s = setup([keep]);
    expect(() => {
      s.result.current.commitBuckets([{ ...keep, name: "x" }]);
    }).not.toThrow();
    expect(s.setBudgets).toHaveBeenCalledTimes(1);
  });

  test("(e) two commits in one tick both land — setBudgetHistory is called with a FUNCTIONAL updater", () => {
    let historyState: readonly BudgetHistoryEntry[] = [];
    const setBudgetHistory = vi.fn((updater: unknown) => {
      historyState = typeof updater === "function"
        ? (updater as (h: readonly BudgetHistoryEntry[]) => readonly BudgetHistoryEntry[])(historyState)
        : (updater as readonly BudgetHistoryEntry[]);
    });
    const prev = bucket(1, "Design", 0);
    const s = setup([prev], { projectBac: stubProjectBac, setBudgetHistory, today: TODAY });

    s.result.current.commitBuckets([{ ...prev, name: "Design", allocations: [{}] } as unknown as BudgetBucket]);
    s.result.current.commitBuckets([{ ...prev, name: "Design", allocations: [{}, {}] } as unknown as BudgetBucket]);

    expect(setBudgetHistory).toHaveBeenCalledTimes(2);
    expect(historyState).toHaveLength(3);
  });
});
