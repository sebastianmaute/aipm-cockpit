// src/app/use-scheduled-jobs.prune.test.tsx — §818: the hook takes its snapshot of stored answers BEFORE the job list
// is read, so an answer another tab writes while the read is under way is not forgotten. The store's load is wrapped
// so the first call reads the list at once but answers only when the test lets it, the order a slow Turso round trip
// produces.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ScheduledJob } from "./scheduled-jobs/types";

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
import { acceptanceState, acceptJob } from "./scheduled-job-acceptance";

const SCOPE = "local";
const JOBS_KEY = "aipm-cockpit:scheduled-jobs";
const job1: ScheduledJob = {
  id: 1, name: "J", type: "portfolioAnalysis", cadence: { kind: "daily", timeOfDay: "09:00" }, enabled: true,
  projectId: "p1", timeZone: "UTC", key: "key-1", instruction: "b", lastRunAt: null, history: [],
};

describe("useScheduledJobs — a prune never forgets an answer written during its read (§818)", () => {
  beforeEach(() => { localStorage.clear(); gate.holdCall = 0; gate.calls = 0; });

  it("an answer another tab writes while the list is being read survives, though the list does not hold its job", async () => {
    localStorage.setItem(JOBS_KEY, JSON.stringify([job1]));
    gate.holdCall = 1;
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(gate.calls).toBe(1)); // the read has the list [job1] and is held

    const created: ScheduledJob = { ...job1, id: 2, key: "key-new" };
    acceptJob(created, SCOPE); // another tab created this job after the read began, and accepted it

    await act(async () => { gate.release(); });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(acceptanceState(created, SCOPE)).toBe("accepted");
  });
});
