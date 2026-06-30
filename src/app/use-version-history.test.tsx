import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as store from "./version-store";
import { useVersionHistory } from "./use-version-history";

vi.mock("./version-store", { spy: true });
const cfg = { url: "x", authToken: "t" } as never;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); vi.useRealTimers(); });

// Stable references so the hook's useCallback deps don't change every render
// (a fresh onError/getPayload each render would re-run the list effect → loop).
const stableOnError = vi.fn();
const stableGetPayload = () => '{"tasks":[1]}';

function args(over = {}) {
  return { config: cfg, projectId: "p1", enabled: true, idleMs: 1000, retention: 50,
    getPayload: stableGetPayload, onError: stableOnError, ...over };
}

describe("useVersionHistory", () => {
  it("coalesces rapid saves into ONE auto capture after the idle window", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const { result } = renderHook(() => useVersionHistory(args()));
    act(() => { result.current.notifySaved(); result.current.notifySaved(); result.current.notifySaved(); });
    expect(append).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][1].trigger).toBe("auto");
  });

  it("skips capture when the payload is unchanged since the last version", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const { result } = renderHook(() => useVersionHistory(args()));
    act(() => { result.current.notifySaved(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(append).toHaveBeenCalledTimes(1);
    act(() => { result.current.notifySaved(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(append).toHaveBeenCalledTimes(1); // unchanged → no 2nd capture
  });

  it("skips an auto capture when only volatile bookkeeping (localModifiedAt) changed", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const base = { raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
      grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
    let payload = JSON.stringify({ tasks: [{ id: 1, taskName: "A", localModifiedAt: "2026-01-01T00:00:00.000Z" }], ...base });
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => payload })));

    act(() => { result.current.notifySaved(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(append).toHaveBeenCalledTimes(1); // first snapshot

    // Same content, only the timestamp moved — the byte string differs but the
    // semantic diff is empty, so no new version should be written.
    payload = JSON.stringify({ tasks: [{ id: 1, taskName: "A", localModifiedAt: "2026-02-02T00:00:00.000Z" }], ...base });
    act(() => { result.current.notifySaved(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(append).toHaveBeenCalledTimes(1); // timestamp-only → no 2nd capture
  });

  it("captureNow writes a manual version immediately with the label", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const { result } = renderHook(() => useVersionHistory(args()));
    await act(async () => { await result.current.captureNow("Before review"); });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][1]).toMatchObject({ trigger: "manual", label: "Before review" });
  });

  it("stores a change-summary computed against the previous capture", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const base = { raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
      grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
    let payload = JSON.stringify({ tasks: [{ id: 1, title: "A" }], ...base });
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => payload })));
    await act(async () => { await result.current.captureNow("v1"); });
    expect(append.mock.calls[0][1].summary).toBeNull(); // first capture: no previous
    payload = JSON.stringify({ tasks: [{ id: 1, title: "B" }], ...base });
    await act(async () => { await result.current.captureNow("v2"); });
    expect(append.mock.calls[1][1].summary).toMatch(/Tasks \(1\)/);
  });

  it("does NOT auto-capture after a reload when nothing changed (seeds baseline from the latest stored version)", async () => {
    const base = { raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
      grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
    const payload = JSON.stringify({ tasks: [{ id: 1, title: "A" }], ...base });
    // History already has a version with this exact content (the prior session).
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([
      { id: "v1", projectId: "p1", capturedAt: "2026-01-01T00:00:00.000Z", trigger: "auto", label: null, summary: null },
    ]);
    vi.spyOn(store, "loadVersionPayload").mockResolvedValue(payload);
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => payload })));
    // Flush the mount refresh so the baseline seeds before the idle timer fires.
    await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
    act(() => { result.current.notifySaved(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(append).not.toHaveBeenCalled(); // unchanged since last stored version → no redundant capture
  });

  it("computes a summary for the FIRST capture of a session against the latest stored version", async () => {
    const base = { raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
      grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
    const stored = JSON.stringify({ tasks: [{ id: 1, title: "A" }], ...base });
    const current = JSON.stringify({ tasks: [{ id: 1, title: "B" }, { id: 2, title: "C" }], ...base });
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([
      { id: "v1", projectId: "p1", capturedAt: "2026-01-01T00:00:00.000Z", trigger: "auto", label: null, summary: null },
    ]);
    vi.spyOn(store, "loadVersionPayload").mockResolvedValue(stored);
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => current })));
    await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
    await act(async () => { await result.current.captureNow("v2"); });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][1].summary).toMatch(/Tasks \(2\)/); // 1 modified + 1 added, vs seeded baseline
  });

  it("is inert when disabled (off-Turso)", async () => {
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    const list = vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const { result } = renderHook(() => useVersionHistory(args({ enabled: false })));
    act(() => { result.current.notifySaved(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(append).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  // Regression: when inactive, the refresh callback must NOT churn `versions`
  // with a fresh [] each call. A new array is a state change that re-renders;
  // with an unstable caller arg (an inline onError, as the real call site had)
  // that re-creates `refresh`, the refresh effect re-runs and calls refresh
  // again — a mount-time whole-tree render loop (~1000 renders/sec) that froze
  // the app. The inactive path now returns the same reference, so it can't loop.
  it("inactive + unstable onError keeps versions stable and does not loop", async () => {
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      // Fresh onError EVERY render — the production bug shape.
      return useVersionHistory(args({ enabled: false, onError: () => {} }));
    });
    const firstVersions = result.current.versions;
    // Flush the refresh effect's microtask chain several times.
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(result.current.versions).toBe(firstVersions); // same ref → no churn
    expect(renders).toBeLessThan(5); // bounded, not a runaway loop
  });

  it("restore applies the reverted workspace and logs the restore", async () => {
    const base = { raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
      grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
    const version = JSON.stringify({ tasks: [{ id: 1, title: "Old" }], ...base });
    vi.spyOn(store, "loadVersionPayload").mockResolvedValue(version);
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const now = JSON.stringify({ tasks: [{ id: 1, title: "New" }], ...base });
    const applyWorkspace = vi.fn();
    const logActivity = vi.fn();
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => now, applyWorkspace, logActivity })));
    await act(async () => { await result.current.restore("v1", { "tasks:1": ["title"] }, "v1-label"); });
    expect(applyWorkspace).toHaveBeenCalledTimes(1);
    const applied = applyWorkspace.mock.calls[0][0];
    expect(applied.tasks[0].title).toBe("Old");
    expect(logActivity).toHaveBeenCalledWith("history.restore", 1, "v1-label");
  });

  it("loadDiff compares a version payload against the current workspace", async () => {
    const base = { raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
      grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
    const older = JSON.stringify({ tasks: [{ id: 1, title: "A" }], ...base });
    vi.spyOn(store, "loadVersionPayload").mockResolvedValue(older);
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const now = JSON.stringify({ tasks: [{ id: 1, title: "B" }], ...base });
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => now })));
    let changes: unknown[] = [];
    await act(async () => { changes = await result.current.loadDiff("v1", "now"); });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ collection: "tasks", recordId: 1, type: "modified" });
  });

  it("captures an immediate version of the restored state (no stale getPayload)", async () => {
    const base = { raid: [], absences: [], shifts: [], resources: [], roles: [], disciplines: [],
      grades: [], plan: {}, budgets: [], milestones: [], changes: [], stakeholders: [], status: {} };
    const version = JSON.stringify({ tasks: [{ id: 1, title: "Old" }], ...base });
    vi.spyOn(store, "loadVersionPayload").mockResolvedValue(version);
    vi.spyOn(store, "pruneVersions").mockResolvedValue();
    vi.spyOn(store, "listVersionMeta").mockResolvedValue([]);
    const append = vi.spyOn(store, "appendVersion").mockResolvedValue();
    const now = JSON.stringify({ tasks: [{ id: 1, title: "New" }], ...base });
    const { result } = renderHook(() => useVersionHistory(args({ getPayload: () => now, applyWorkspace: vi.fn(), logActivity: vi.fn() })));
    await act(async () => { await result.current.restore("v1", { "tasks:1": ["title"] }, "Baseline"); });
    expect(append).toHaveBeenCalledTimes(1);
    const captured = JSON.parse(append.mock.calls[0][1].payload);
    expect(captured.tasks[0].title).toBe("Old"); // the RESTORED state was captured
  });
});
