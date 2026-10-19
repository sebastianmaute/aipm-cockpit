// src/app/use-scheduled-jobs.reread.test.tsx — §750 review: a re-read another instance's write starts must not
// land over this instance's own later write. The store's load is wrapped so one chosen call reads the list at
// once but answers only when the test lets it, which is the order a slow Turso round trip produces.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { JobCadence } from "./scheduled-jobs/types";

const gate = vi.hoisted(() => ({ holdCall: 0, calls: 0, release: (): void => {} }));

vi.mock("./scheduled-jobs-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scheduled-jobs-store")>();
  return {
    ...actual,
    loadScheduledJobs: async (config: Parameters<typeof actual.loadScheduledJobs>[0]) => {
      const list = await actual.loadScheduledJobs(config);
      gate.calls += 1;
      if (gate.calls === gate.holdCall) await new Promise<void>((resolve) => { gate.release = resolve; });
      return list;
    },
  };
});

import { useScheduledJobs } from "./use-scheduled-jobs";

const dailyCadence: JobCadence = { kind: "daily", timeOfDay: "09:00" };

describe("useScheduledJobs — a slow re-read never lands over a newer write (§750)", () => {
  beforeEach(() => { localStorage.clear(); gate.holdCall = 0; gate.calls = 0; });

  it("the other instance keeps its own newer list when the re-read answers last", async () => {
    const settings = renderHook(() => useScheduledJobs({ config: null }));
    const runner = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(settings.result.current.ready && runner.result.current.ready).toBe(true));

    // The next load is Settings' own read before its save; the one after it is the runner's re-read.
    gate.calls = 0;
    gate.holdCall = 2;
    await act(async () => {
      await settings.result.current.createJob({ name: "One", cadence: dailyCadence, enabled: true });
    });
    expect(gate.calls).toBe(2); // the runner's re-read has read ["One"] and is held

    await act(async () => {
      await runner.result.current.createJob({ name: "Two", cadence: dailyCadence, enabled: true });
    });
    expect(runner.result.current.jobs.map((j) => j.name)).toEqual(["One", "Two"]);

    await act(async () => { gate.release(); });
    await waitFor(() => expect(settings.result.current.jobs.map((j) => j.name)).toEqual(["One", "Two"]));
    expect(runner.result.current.jobs.map((j) => j.name)).toEqual(["One", "Two"]);
  });
});
