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
});
