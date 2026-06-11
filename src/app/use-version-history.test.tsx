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
    expect(append.mock.calls[1][1].summary).toMatch(/1 Tasks/);
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
