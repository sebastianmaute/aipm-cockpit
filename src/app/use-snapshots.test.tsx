import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSnapshots } from "./use-snapshots";
import * as store from "./snapshot-store";
import type { SnapshotRecord } from "./snapshot";

function rec(id: string, bucket: string, isBaseline = false): SnapshotRecord {
  return {
    id, capturedAt: id, bucket, cadence: "weekly", trigger: "auto", isBaseline,
    remainingHours: null, remainingCost: null, pctComplete: 0, forecastEndDate: "2026-07-31",
    planEndDate: "2026-07-31", spi: null, cpi: null, overallRag: "G", scheduleRag: "G",
    budgetRag: "", scopeRag: "", currency: "EUR", milestones: [], series: [],
  };
}

const baseArgs = {
  active: true,
  cadence: "weekly" as const,
  tursoConfig: { httpUrl: "https://db", authToken: "t" },
  projectId: "p1",
  today: new Date("2026-06-10T09:00:00.000Z"), // ISO week 24
  buildContext: () => ({
    model: { progress: { percent: 0 }, overall: { effective: "G" }, schedule: { effective: "G" },
      budget: { effective: null }, scope: { effective: null }, burndown: null,
      evm: { spi: null, cpi: null } },
    tasks: [], milestones: [], planEndDate: "2026-07-31", currency: "EUR",
  }) as unknown as ReturnType<NonNullable<Parameters<typeof useSnapshots>[0]["buildContext"]>>,
};

afterEach(() => vi.restoreAllMocks());

describe("useSnapshots", () => {
  it("loads history and auto-captures when the current bucket is missing", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([rec("2026-06-01T00:00:00.000Z", "2026-W23", true)]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    const { result } = renderHook(() => useSnapshots(baseArgs));
    await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    expect(append.mock.calls[0][1].bucket).toBe("2026-W24");
    await waitFor(() => expect(result.current.snapshots.length).toBeGreaterThanOrEqual(1));
  });

  it("does NOT auto-capture when the current bucket already has a snapshot", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([rec("2026-06-10T00:00:00.000Z", "2026-W24", true)]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    renderHook(() => useSnapshots(baseArgs));
    await waitFor(() => expect(store.loadSnapshots).toHaveBeenCalled());
    expect(append).not.toHaveBeenCalled();
  });

  it("is inert when inactive (never touches the store)", async () => {
    const load = vi.spyOn(store, "loadSnapshots").mockResolvedValue([]);
    renderHook(() => useSnapshots({ ...baseArgs, active: false }));
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
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

  it("deleteSnapshots is a no-op when inactive", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([]);
    const delMany = vi.spyOn(store, "deleteSnapshots").mockResolvedValue();
    const { result } = renderHook(() => useSnapshots({ ...baseArgs, active: false }));
    await act(async () => { await result.current.deleteSnapshots(["x"]); });
    expect(delMany).not.toHaveBeenCalled();
  });
});
