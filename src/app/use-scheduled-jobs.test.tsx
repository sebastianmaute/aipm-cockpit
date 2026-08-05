// src/app/use-scheduled-jobs.test.tsx — localStorage-backed hook tests.
import { StrictMode } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useScheduledJobs } from "./use-scheduled-jobs";
import { JOB_HISTORY_CAP, type JobCadence, type ScheduledJobRun } from "./scheduled-jobs/types";

const dailyCadence: JobCadence = { kind: "daily", timeOfDay: "09:00" };

function run(ranAt: string): ScheduledJobRun {
  return { ranAt, summary: `run ${ranAt}`, actionCount: 1, ok: true };
}

describe("useScheduledJobs (localStorage backend)", () => {
  beforeEach(() => localStorage.clear());

  it("starts empty and reports ready", async () => {
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.jobs).toEqual([]);
  });

  it("createJob adds a job with id 1, then increments", async () => {
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.createJob({ name: "Daily", cadence: dailyCadence, enabled: true });
    });
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0].id).toBe(1);
    expect(result.current.jobs[0].name).toBe("Daily");
    expect(result.current.jobs[0].type).toBe("portfolioAnalysis");

    await act(async () => {
      await result.current.createJob({ name: "Second", cadence: dailyCadence, enabled: false });
    });
    expect(result.current.jobs).toHaveLength(2);
    expect(result.current.jobs[1].id).toBe(2);
  });

  it("updateJob applies a patch immutably and preserves id", async () => {
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.createJob({ name: "A", cadence: dailyCadence, enabled: true });
    });
    const id = result.current.jobs[0].id;

    await act(async () => {
      await result.current.updateJob(id, { name: "Renamed", enabled: false });
    });
    expect(result.current.jobs[0].id).toBe(id);
    expect(result.current.jobs[0].name).toBe("Renamed");
    expect(result.current.jobs[0].enabled).toBe(false);
  });

  it("deleteJob removes the job", async () => {
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.createJob({ name: "A", cadence: dailyCadence, enabled: true });
    });
    const id = result.current.jobs[0].id;

    await act(async () => {
      await result.current.deleteJob(id);
    });
    expect(result.current.jobs).toHaveLength(0);
  });

  it("recordRun grows history newest-first and sets lastRunAt", async () => {
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.createJob({ name: "A", cadence: dailyCadence, enabled: true });
    });
    const id = result.current.jobs[0].id;

    await act(async () => {
      await result.current.recordRun(id, run("2026-06-01T09:00:00.000Z"));
    });
    await act(async () => {
      await result.current.recordRun(id, run("2026-06-02T09:00:00.000Z"));
    });

    const job = result.current.jobs[0];
    expect(job.history).toHaveLength(2);
    expect(job.history[0].ranAt).toBe("2026-06-02T09:00:00.000Z"); // newest first
    expect(job.lastRunAt).toBe("2026-06-02T09:00:00.000Z");
  });

  it("recordRun caps history at JOB_HISTORY_CAP", async () => {
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.createJob({ name: "A", cadence: dailyCadence, enabled: true });
    });
    const id = result.current.jobs[0].id;

    for (let i = 0; i < JOB_HISTORY_CAP + 5; i += 1) {
      // Serial awaits so each run goes through the write chain in order.
      await act(async () => {
        await result.current.recordRun(id, run(`2026-06-${String(i + 1).padStart(2, "0")}T09:00:00.000Z`));
      });
    }
    expect(result.current.jobs[0].history).toHaveLength(JOB_HISTORY_CAP);
  });

  it("persists across hook remounts (localStorage round-trip)", async () => {
    const first = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(async () => {
      await first.result.current.createJob({ name: "Persisted", cadence: dailyCadence, enabled: true });
    });

    const second = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(second.result.current.jobs.length).toBe(1));
    expect(second.result.current.jobs[0].name).toBe("Persisted");
  });
});

describe("useScheduledJobs — StrictMode mount re-set (§76)", () => {
  beforeEach(() => localStorage.clear());

  it("still applies the loaded jobs after StrictMode's remount", async () => {
    // Seed one job through the public API so the second render has something
    // to load. localStorage persists between the two renderHook calls.
    const seed = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(seed.result.current.ready).toBe(true));
    await act(async () => {
      await seed.result.current.createJob({ name: "Daily", cadence: dailyCadence, enabled: true });
    });
    seed.unmount();

    // StrictMode mounts → unmounts → remounts. `refresh()`'s promise resolves
    // AFTER that cycle, so `mountedRef.current = true` in the mount effect body
    // is what lets setJobs/setReady land at all.
    //
    // Delete that line from use-scheduled-jobs.ts and this fails: `ready` never
    // becomes true, so the `waitFor` below times out — `setReady(true)` is
    // gated on the same `mountedRef.current` check as `setJobs`, so both are
    // suppressed together. That matters because in dev it means
    // useScheduledJobRunner sees an empty list and no scheduled job ever fires.
    //
    // ★★★ `wrapper: StrictMode` is load-bearing — do NOT "simplify" it to
    //     `wrapper: ({children}) => <StrictMode>{children}</StrictMode>`. Passing
    //     the component itself leaves nothing between the root and StrictMode;
    //     composing it inside a wrapper function puts a fiber above it on the
    //     same branch, and on a mount commit that silences the double invoke —
    //     the test then passes with the pinned line DELETED and looks identical.
    //     Measured for the sibling guard in use-storage-backend.test.tsx. The
    //     rule, the React-internals reason and every measured edge live in ONE
    //     place: `src/app/strictmode.meta.test.tsx`.
    const { result } = renderHook(() => useScheduledJobs({ config: null }), {
      wrapper: StrictMode,
    });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0].name).toBe("Daily");
  });
});
