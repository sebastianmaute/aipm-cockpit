import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSnapshots } from "./use-snapshots";
import * as store from "./snapshot-store";
import type { SnapshotRecord } from "./snapshot";
import type { Task } from "./types";

function rec(id: string, bucket: string, isBaseline = false): SnapshotRecord {
  return {
    id, capturedAt: id, bucket, cadence: "weekly", trigger: "auto", isBaseline,
    remainingHours: null, remainingCost: null, pctComplete: 0, forecastEndDate: "2026-07-31",
    planEndDate: "2026-07-31", spi: null, cpi: null, overallRag: "G", scheduleRag: "G",
    budgetRag: "", scopeRag: "", milestones: [], series: [], bucketProgress: [],
  };
}

const baseArgs = {
  active: true,
  workspaceReady: true,
  cadence: "weekly" as const,
  tursoConfig: { httpUrl: "https://db", authToken: "t" },
  projectId: "p1",
  today: new Date("2026-06-10T09:00:00.000Z"), // ISO week 24
  buildContext: () => ({
    model: { progress: { percent: 0 }, overall: { effective: "G" }, schedule: { effective: "G" },
      budget: { effective: null }, scope: { effective: null }, burndown: null,
      evm: { spi: null, cpi: null } },
    tasks: [taskWith(1, "To Do")], milestones: [], planEndDate: "2026-07-31", buckets: [],
  }) as unknown as ReturnType<NonNullable<Parameters<typeof useSnapshots>[0]["buildContext"]>>,
  showToast: vi.fn(),
  lang: "en-US" as const,
  tasks: [] as readonly Task[],
};

const emptyContextArgs = {
  ...baseArgs,
  buildContext: () => ({
    model: { progress: { percent: 0 }, overall: { effective: "G" }, schedule: { effective: "G" },
      budget: { effective: null }, scope: { effective: null }, burndown: null,
      evm: { spi: null, cpi: null } },
    tasks: [], milestones: [], planEndDate: "2026-07-31", buckets: [],
  }) as unknown as ReturnType<NonNullable<Parameters<typeof useSnapshots>[0]["buildContext"]>>,
};

/** A project with scope AND a budget: `model.burndown` is non-null, so its
 *  auto capture is KPI-complete (§78). */
const completeContextArgs = {
  ...baseArgs,
  buildContext: () => ({
    model: { progress: { percent: 42 }, overall: { effective: "G" }, schedule: { effective: "G" },
      budget: { effective: "G" }, scope: { effective: null },
      burndown: { periods: ["2026-06"], plannedRemainingHours: [10], actualRemainingHours: [8],
        plannedRemainingValue: [1000], actualRemainingValue: [800] },
      evm: { spi: 0.9, cpi: 1.1 } },
    tasks: [taskWith(1, "To Do")], milestones: [], planEndDate: "2026-07-31", buckets: [],
  }) as unknown as ReturnType<NonNullable<Parameters<typeof useSnapshots>[0]["buildContext"]>>,
};

function taskWith(id: number, status: Task["status"]): Task {
  return {
    id, taskName: `T${id}`, assignee: "A", assigneeEmail: "a@x.io",
    dueDate: "2026-06-10", lastUpdateDate: "2026-06-01", status,
    priority: "Medium", blockers: "", description: "",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  baseArgs.showToast.mockClear();
});

describe("useSnapshots", () => {
  it("loads history and auto-captures when the current bucket is missing", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([rec("2026-06-01T00:00:00.000Z", "2026-W23", true)]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    const { result } = renderHook(() => useSnapshots(baseArgs));
    await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    expect(append.mock.calls[0][1].bucket).toBe("2026-W24");
    await waitFor(() => expect(result.current.snapshots.length).toBeGreaterThanOrEqual(1));
  });

  // ★★★ REGRESSION (Trends recorded an empty project): the auto-capture effect
  // and the workspace load are two INDEPENDENT async reads fired on the same
  // commit. `loadSnapshots` (2 small tables) reliably beats `backend.load()`
  // (the whole workspace), so capture ran against the still-empty render scope:
  // no tasks, no budgets, a default-seeded plan. That writes a row with null
  // remainingHours/remainingCost/spi/cpi and pctComplete 0 — and because the
  // bucket now EXISTS, the real values are never captured for it again. Every
  // weekly bucket in a live project was poisoned this way.
  it("does NOT auto-capture until the workspace has finished loading", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    // The capture below is complete and first, so it is flagged through the
    // store (§78) — stub that write so it never reaches the network.
    vi.spyOn(store, "setBaseline").mockResolvedValue();
    const { rerender } = renderHook((args: Parameters<typeof useSnapshots>[0]) => useSnapshots(args), {
      initialProps: { ...baseArgs, workspaceReady: false },
    });
    await waitFor(() => expect(store.loadSnapshots).not.toHaveBeenCalled());
    expect(append).not.toHaveBeenCalled();

    // The workspace lands: NOW the capture is allowed, and it sees real data.
    rerender({
      ...baseArgs,
      workspaceReady: true,
      buildContext: () => ({
        model: { progress: { percent: 42 }, overall: { effective: "G" }, schedule: { effective: "G" },
          budget: { effective: "G" }, scope: { effective: null },
          burndown: { periods: ["2026-06"], plannedRemainingHours: [10], actualRemainingHours: [8],
            plannedRemainingValue: [1000], actualRemainingValue: [800] },
          evm: { spi: 0.9, cpi: 1.1 } },
        tasks: [], milestones: [], planEndDate: "2026-07-31", buckets: [],
      }) as unknown as ReturnType<NonNullable<Parameters<typeof useSnapshots>[0]["buildContext"]>>,
    });

    await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    const captured = append.mock.calls[0][1];
    expect(captured.remainingHours).toBe(8);
    expect(captured.remainingCost).toBe(800);
    expect(captured.spi).toBe(0.9);
    expect(captured.cpi).toBe(1.1);
    expect(captured.pctComplete).toBe(42);
  });

  // ★★★ open-followups §78: `createTursoProject` applies an EMPTY workspace and
  // changes projectId in one batch, so `workspaceReady` is legitimately true
  // with nothing to capture. Without this gate the effect wrote a null-KPI row
  // that — being the first ever — was also the BASELINE, so every later
  // variance row compared against nulls forever.
  it("does not auto-capture a project with no tasks, milestones or burndown", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    renderHook(() => useSnapshots(emptyContextArgs));
    // POSITIVE observable first: prove the effect ran PAST its
    // active/workspaceReady/config guard, so this cannot pass because the hook
    // did nothing at all. ★ It does not prove the `hasCapturableContent` branch
    // itself was reached — a `stale()` return sits between — so the mutation
    // check (flip the gate to `if (false)` and watch this test die) is what
    // actually pins the branch. Do not upgrade this comment's claim without
    // adding an observable that distinguishes the two.
    await waitFor(() => expect(store.loadSnapshots).toHaveBeenCalledTimes(1));
    expect(append).not.toHaveBeenCalled();
    // ★ Deliberately NO `expect(result.current.snapshots).toEqual([])` here: the
    // decline path calls `setSnapshots(history)` with `history === []`, which is
    // also the initial value, so that assertion cannot fail either way. The
    // `append` assertion above is the real one.
  });

  // §78, the partial-KPI half. MIGRATED: this used to assert `isBaseline ===
  // true`, pinning the defect. `baseArgs` has a task but no budget
  // (`burndown: null`), so the row is still captured — scope is worth
  // recording — but it must not become the baseline with null remaining
  // hours/cost for every later variance row to compare against.
  it("still auto-captures once the project has scope, but does not baseline a row with no budget", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    const setBase = vi.spyOn(store, "setBaseline").mockResolvedValue();
    const { result } = renderHook(() => useSnapshots(baseArgs));
    await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    expect(append.mock.calls[0][1].isBaseline).toBe(false);
    await waitFor(() => expect(result.current.snapshots).toHaveLength(1));
    expect(setBase).not.toHaveBeenCalled();
    expect(result.current.snapshots[0].isBaseline).toBe(false);
  });

  it("flags the first COMPLETE auto capture as the baseline once an incomplete one came first", async () => {
    const partial = rec("2026-06-01T00:00:00.000Z", "2026-W23"); // unflagged, null KPIs
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([partial]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    const setBase = vi.spyOn(store, "setBaseline").mockResolvedValue();
    const { result } = renderHook(() => useSnapshots(completeContextArgs));
    await waitFor(() => expect(setBase).toHaveBeenCalledTimes(1));
    const appended = append.mock.calls[0][1];
    expect(appended.remainingHours).toBe(8);
    // Persisted through the store op, on the row just captured.
    expect(setBase).toHaveBeenCalledWith(baseArgs.tursoConfig, appended.id, "p1");
    await waitFor(() => expect(result.current.baseline?.id).toBe(appended.id));
    expect(result.current.snapshots.find((s) => s.id === partial.id)?.isBaseline).toBe(false);
  });

  // §78 fix round: the rule is "the FIRST complete row", not "any complete row
  // while nothing is flagged". A user who deleted the baseline in Trends leaves
  // complete, unflagged rows; the next auto capture must not flag itself.
  it("does not flag a later complete capture when a complete row already exists unflagged", async () => {
    const earlierComplete = { ...rec("2026-06-01T00:00:00.000Z", "2026-W23"), remainingHours: 12, remainingCost: 1200 };
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([earlierComplete]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    const setBase = vi.spyOn(store, "setBaseline").mockResolvedValue();
    const { result } = renderHook(() => useSnapshots(completeContextArgs));
    await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    expect(append.mock.calls[0][1].remainingHours).toBe(8); // positive control: the new row IS complete
    await waitFor(() => expect(result.current.snapshots).toHaveLength(2));
    expect(setBase).not.toHaveBeenCalled();
    // The earliest row stays the effective baseline, as it was before.
    expect(result.current.baseline?.id).toBe(earlierComplete.id);
  });

  it("does not baseline a budgeted first capture whose burndown has no actuals yet", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    const setBase = vi.spyOn(store, "setBaseline").mockResolvedValue();
    const { result } = renderHook(() =>
      useSnapshots({
        ...completeContextArgs,
        buildContext: () => ({
          ...completeContextArgs.buildContext(),
          model: {
            ...completeContextArgs.buildContext().model,
            burndown: { periods: ["2026-06"], plannedRemainingHours: [10], actualRemainingHours: [null],
              plannedRemainingValue: [1000], actualRemainingValue: [null] },
          },
        }) as unknown as ReturnType<NonNullable<Parameters<typeof useSnapshots>[0]["buildContext"]>>,
      }),
    );
    await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    expect(append.mock.calls[0][1].remainingHours).toBeNull();
    await waitFor(() => expect(result.current.snapshots).toHaveLength(1));
    expect(setBase).not.toHaveBeenCalled();
  });

  it("never moves an existing baseline from the auto capture", async () => {
    const flagged = rec("2026-06-01T00:00:00.000Z", "2026-W23", true);
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([flagged]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    const setBase = vi.spyOn(store, "setBaseline").mockResolvedValue();
    const { result } = renderHook(() => useSnapshots(completeContextArgs));
    await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    expect(append.mock.calls[0][1].remainingHours).toBe(8); // positive control: it WAS complete
    await waitFor(() => expect(result.current.snapshots).toHaveLength(2));
    expect(setBase).not.toHaveBeenCalled();
    expect(result.current.baseline?.id).toBe(flagged.id);
  });

  it("does NOT auto-capture when the current bucket already has a snapshot", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([rec("2026-06-10T00:00:00.000Z", "2026-W24", true)]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    renderHook(() => useSnapshots(baseArgs));
    await waitFor(() => expect(store.loadSnapshots).toHaveBeenCalled());
    expect(append).not.toHaveBeenCalled();
  });

  it("is inert when inactive (never touches the store, never toasts)", async () => {
    const load = vi.spyOn(store, "loadSnapshots").mockResolvedValue([]);
    const showToast = vi.fn();
    renderHook(() => useSnapshots({ ...baseArgs, active: false, showToast }));
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
    // The auto-capture EFFECT (not a user action) must stay silent on mount.
    expect(showToast).not.toHaveBeenCalled();
  });

  it("never runs the store when active but the Turso config is missing", async () => {
    // Guards the StorageNotReadyError on mount: storage kind can be "turso"
    // while the URL/token are unset/quarantined, so active can leak true.
    const load = vi.spyOn(store, "loadSnapshots").mockResolvedValue([]);
    renderHook(() => useSnapshots({ ...baseArgs, active: true, tursoConfig: null }));
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
  });

  it("exposes the baseline (flagged) and computes gaps", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([
      rec("2026-05-25T00:00:00.000Z", "2026-W22", true),
      rec("2026-06-10T00:00:00.000Z", "2026-W24"),
    ]);
    vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    const { result } = renderHook(() => useSnapshots(baseArgs));
    await waitFor(() => expect(result.current.baseline?.bucket).toBe("2026-W22"));
    expect(result.current.gaps).toContain("2026-W23");
  });

  it("captureNow stamps a real-clock id but the current bucket", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([rec("2026-06-10T00:00:00.000Z", "2026-W24", true)]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    const { result } = renderHook(() => useSnapshots(baseArgs));
    await waitFor(() => expect(store.loadSnapshots).toHaveBeenCalled());
    await result.current.captureNow();
    expect(append).toHaveBeenCalledTimes(1); // only the manual one (bucket already present -> no auto)
    const manual = append.mock.calls[0][1];
    expect(manual.trigger).toBe("manual");
    expect(manual.bucket).toBe("2026-W24");            // gate-consistent (from today)
    expect(manual.id).not.toBe("2026-06-10T09:00:00.000Z"); // real wall clock, not `today`
    expect(manual.id).toBe(manual.capturedAt);          // id === capturedAt invariant
  });

  it("a manual capture during an in-flight load is not clobbered by the load result", async () => {
    let resolveLoad!: (v: SnapshotRecord[]) => void;
    const loadPromise = new Promise<SnapshotRecord[]>((r) => { resolveLoad = r; });
    vi.spyOn(store, "loadSnapshots").mockReturnValue(loadPromise);
    vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    const { result } = renderHook(() => useSnapshots(baseArgs));
    // Load is in flight (unresolved). Fire a manual capture.
    await act(async () => { await result.current.captureNow(); });
    expect(result.current.snapshots.some((s) => s.trigger === "manual")).toBe(true);
    // Resolve the load with history lacking the manual record; it must NOT clobber.
    resolveLoad([rec("2026-06-10T00:00:00.000Z", "2026-W24", true)]);
    await waitFor(() => expect(store.loadSnapshots).toHaveBeenCalled());
    expect(result.current.snapshots.some((s) => s.trigger === "manual")).toBe(true);
  });

  it("setBaseline flips the flag and deleteSnapshot removes by id", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([rec("2026-06-10T00:00:00.000Z", "2026-W24", true)]);
    vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    const sb = vi.spyOn(store, "setBaseline").mockResolvedValue();
    const del = vi.spyOn(store, "deleteSnapshot").mockResolvedValue();
    const { result } = renderHook(() => useSnapshots(baseArgs));
    await waitFor(() => expect(result.current.snapshots.length).toBe(1));
    const id = result.current.snapshots[0].id;
    await act(async () => { await result.current.setBaseline(id); });
    expect(sb).toHaveBeenCalledWith(baseArgs.tursoConfig, id, "p1");
    expect(result.current.snapshots[0].isBaseline).toBe(true);
    await act(async () => { await result.current.deleteSnapshot(id); });
    expect(del).toHaveBeenCalledWith(baseArgs.tursoConfig, id, "p1");
    expect(result.current.snapshots).toHaveLength(0);
  });

  it("routes a manual-capture store error to onError", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([rec("2026-06-10T00:00:00.000Z", "2026-W24", true)]);
    vi.spyOn(store, "appendSnapshot").mockRejectedValue(new Error("boom"));
    const onError = vi.fn();
    const { result } = renderHook(() => useSnapshots({ ...baseArgs, onError }));
    await waitFor(() => expect(store.loadSnapshots).toHaveBeenCalled());
    await act(async () => { await result.current.captureNow(); });
    expect(onError).toHaveBeenCalled();
  });

  it("rebaselineNow appends a manual snapshot and flags it as the new baseline", async () => {
    // Use a snapshot in the current bucket (W24) so auto-capture is suppressed.
    const existing = rec("2026-06-10T00:00:00.000Z", "2026-W24", true);
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([existing]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    const setBase = vi.spyOn(store, "setBaseline").mockResolvedValue();
    const { result } = renderHook(() => useSnapshots(baseArgs));
    await waitFor(() => expect(result.current.snapshots.length).toBe(1));
    await act(async () => { await result.current.rebaselineNow(); });
    expect(append).toHaveBeenCalledTimes(1);
    const appended = append.mock.calls[0][1] as import("./snapshot").SnapshotRecord;
    expect(appended.trigger).toBe("manual");
    expect(setBase).toHaveBeenCalledWith(baseArgs.tursoConfig, appended.id, "p1");
    expect(result.current.baseline?.id).toBe(appended.id);
  });

  it("deleteSnapshots removes all given ids from state in one call", async () => {
    const snapA = rec("2026-05-25T00:00:00.000Z", "2026-W22");
    const snapB = rec("2026-06-01T00:00:00.000Z", "2026-W23");
    const snapC = rec("2026-06-10T00:00:00.000Z", "2026-W24", true);
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([snapA, snapB, snapC]);
    vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    const delMany = vi.spyOn(store, "deleteSnapshots").mockResolvedValue();
    const { result } = renderHook(() => useSnapshots(baseArgs));
    await waitFor(() => expect(result.current.snapshots.length).toBe(3));
    await act(async () => { await result.current.deleteSnapshots([snapA.id, snapB.id]); });
    expect(delMany).toHaveBeenCalledWith(baseArgs.tursoConfig, [snapA.id, snapB.id], "p1");
    expect(result.current.snapshots).toHaveLength(1);
    expect(result.current.snapshots[0].id).toBe(snapC.id);
  });

  it("deleteSnapshots is a no-op when inactive, but reports a capability-gap toast", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([]);
    const delMany = vi.spyOn(store, "deleteSnapshots").mockResolvedValue();
    const showToast = vi.fn();
    const { result } = renderHook(() => useSnapshots({ ...baseArgs, active: false, showToast }));
    await act(async () => { await result.current.deleteSnapshots(["x"]); });
    expect(delMany).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
  });

  it("captureNow/rebaselineNow/setBaseline/deleteSnapshot each report the same capability-gap toast when inactive", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    const setBase = vi.spyOn(store, "setBaseline").mockResolvedValue();
    const del = vi.spyOn(store, "deleteSnapshot").mockResolvedValue();
    const showToast = vi.fn();
    const { result } = renderHook(() => useSnapshots({ ...baseArgs, active: false, showToast }));

    await act(async () => { await result.current.captureNow(); });
    await act(async () => { await result.current.rebaselineNow(); });
    await act(async () => { await result.current.setBaseline("x"); });
    await act(async () => { await result.current.deleteSnapshot("x"); });

    expect(append).not.toHaveBeenCalled();
    expect(setBase).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(4);
    for (const call of showToast.mock.calls) {
      expect(call[0]).toBe("info");
      expect(typeof call[1]).toBe("string");
    }
  });
});

describe("useSnapshots completion variance for an all-cancelled project", () => {
  // Gated in the HOOK, not at either render site, because both surfaces that
  // show variance read this one value. The pure filter and the pure predicate
  // have their own tests; this pins that the hook actually applies them.
  function renderWithTasks(tasks: readonly Task[]) {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([
      rec("2026-06-01T00:00:00.000Z", "2026-W23", true),
      { ...rec("2026-06-10T00:00:00.000Z", "2026-W24"), pctComplete: 0 },
    ]);
    vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    return renderHook(() => useSnapshots({ ...baseArgs, tasks }));
  }

  it("drops the completion row when every task is cancelled", async () => {
    const { result } = renderWithTasks([taskWith(1, "Cancelled"), taskWith(2, "Cancelled")]);
    await waitFor(() => expect(result.current.variance.length).toBeGreaterThan(0));
    expect(result.current.variance.find((r) => r.key === "pctComplete")).toBeUndefined();
    // Control: the other rows survive, so the absence above is the filter and
    // not an empty variance list.
    expect(result.current.variance.find((r) => r.key === "remainingHours")).toBeDefined();
  });

  it("keeps the completion row when only some work is cancelled", async () => {
    const { result } = renderWithTasks([taskWith(1, "Cancelled"), taskWith(2, "To Do")]);
    await waitFor(() => expect(result.current.variance.length).toBeGreaterThan(0));
    expect(result.current.variance.find((r) => r.key === "pctComplete")).toBeDefined();
  });

  it("keeps the completion row for a project with no tasks at all", async () => {
    const { result } = renderWithTasks([]);
    await waitFor(() => expect(result.current.variance.length).toBeGreaterThan(0));
    expect(result.current.variance.find((r) => r.key === "pctComplete")).toBeDefined();
  });
});
