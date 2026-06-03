import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
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
});
