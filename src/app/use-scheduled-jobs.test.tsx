// src/app/use-scheduled-jobs.test.tsx — localStorage-backed hook tests.
import { StrictMode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
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

  it("createJob mints a permanent key and keeps the project, zone and instruction", async () => {
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.createJob({
        name: "A", cadence: dailyCadence, enabled: true, projectId: "p1", timeZone: "UTC", instruction: "focus",
      });
      await result.current.createJob({ name: "B", cadence: dailyCadence, enabled: true });
    });
    const [a, b] = result.current.jobs;
    expect(a).toMatchObject({ projectId: "p1", timeZone: "UTC", instruction: "focus" });
    expect(a.key).toMatch(/\S+/);
    expect(b).toMatchObject({ projectId: null, timeZone: null });
    expect(b.key).toMatch(/\S+/);
    expect(b.key).not.toBe(a.key);
  });

  it("assignProject on a legacy job persists project, key and zone in one save; a second keeps the key", async () => {
    localStorage.setItem("aipm-cockpit:scheduled-jobs", JSON.stringify([{
      id: 1, name: "Old", type: "portfolioAnalysis", cadence: dailyCadence, enabled: true, lastRunAt: null, history: [],
    }]));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    const spy = vi.spyOn(Storage.prototype, "setItem");
    await act(async () => { await result.current.assignProject(1, "p1", "Europe/Berlin"); });
    const writes = spy.mock.calls.filter(([k]) => k === "aipm-cockpit:scheduled-jobs");
    expect(writes).toHaveLength(1);
    const saved = JSON.parse(writes[0][1] as string)[0];
    expect(saved.projectId).toBe("p1");
    expect(saved.timeZone).toBe("Europe/Berlin");
    expect(saved.key).toMatch(/\S+/);
    await act(async () => { await result.current.assignProject(1, "p2", "UTC"); });
    const again = result.current.jobs[0];
    expect(again.projectId).toBe("p2");
    expect(again.key).toBe(saved.key);
    expect(again.timeZone).toBe("Europe/Berlin");
    spy.mockRestore();
  });

  it("clearProject returns a job to unassigned but keeps its key", async () => {
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.createJob({ name: "A", cadence: dailyCadence, enabled: true, projectId: "p1", timeZone: "UTC" });
    });
    const key = result.current.jobs[0].key;
    await act(async () => { await result.current.clearProject(result.current.jobs[0].id); });
    expect(result.current.jobs[0].projectId).toBeNull();
    expect(result.current.jobs[0].key).toBe(key);
  });

  it("keyed writes touch only the job with that key; disableJob switches a job off", async () => {
    localStorage.setItem("aipm-cockpit:scheduled-jobs", JSON.stringify([{
      id: 1, name: "Other portfolio's job", type: "portfolioAnalysis", cadence: dailyCadence, enabled: true,
      projectId: "p9", timeZone: "UTC", key: "key-other", lastRunAt: null, history: [],
    }]));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    const run = { ranAt: "2026-10-23T09:00:00.000Z", summary: "s", actionCount: 0, ok: true };
    await act(async () => {
      await result.current.disableJob(1, "key-mine");
      await result.current.clearProject(1, "key-mine");
      await result.current.recordRun(1, run, "key-mine");
    });
    expect(result.current.jobs[0]).toMatchObject({ enabled: true, projectId: "p9", history: [] });
    await act(async () => { await result.current.disableJob(1, "key-other"); });
    expect(result.current.jobs[0].enabled).toBe(false);
  });

  it("createJob normalises instruction and drops an invalid zone", async () => {
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.createJob({
        name: "A", cadence: dailyCadence, enabled: true, instruction: "  x  ", timeZone: "Not/AZone",
      });
    });
    expect(result.current.jobs[0].instruction).toBe("x");
    expect(result.current.jobs[0].timeZone).toBeNull();
  });

  it("assignProject stores an invalid zone as null", async () => {
    localStorage.setItem("aipm-cockpit:scheduled-jobs", JSON.stringify([{
      id: 1, name: "Old", type: "portfolioAnalysis", cadence: dailyCadence, enabled: true, lastRunAt: null, history: [],
    }]));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => { await result.current.assignProject(1, "p1", "Not/AZone"); });
    expect(result.current.jobs[0].timeZone).toBeNull();
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

  // KILLED BY: spreading the raw patch (an untrimmed instruction or an invalid zone would be stored).
  it("updateJob normalises the instruction and the zone like a create and a load do", async () => {
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await result.current.createJob({ name: "A", cadence: dailyCadence, enabled: true, projectId: "p1", timeZone: "UTC" }); });
    const id = result.current.jobs[0].id;
    await act(async () => { await result.current.updateJob(id, { instruction: "  focus  ", timeZone: "Asia/Tokyo" }); });
    expect(result.current.jobs[0]).toMatchObject({ instruction: "focus", timeZone: "Asia/Tokyo" });
    await act(async () => { await result.current.updateJob(id, { instruction: "   ", timeZone: "Not/AZone" }); });
    expect(result.current.jobs[0].instruction).toBeUndefined();
    expect(result.current.jobs[0].timeZone).toBe("Asia/Tokyo"); // an invalid zone leaves the stored one
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

// §750 — the runner (use-ai-orchestration.ts) and Settings (scheduled-jobs-section.tsx) each mount this
// hook. Each kept the list it read on mount, so a job created in Settings never reached the runner until a
// reload, and a run the runner recorded never showed in Settings.
describe("useScheduledJobs — every instance sees one list (§750)", () => {
  beforeEach(() => localStorage.clear());

  async function mountTwo() {
    const runner = renderHook(() => useScheduledJobs({ config: null }));
    const settings = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(runner.result.current.ready && settings.result.current.ready).toBe(true));
    return { runner, settings };
  }

  it("a job created in one instance reaches the other", async () => {
    const { runner, settings } = await mountTwo();
    await act(async () => {
      await settings.result.current.createJob({ name: "Weekly review", cadence: dailyCadence, enabled: true });
    });
    await waitFor(() => expect(runner.result.current.jobs.map((j) => j.name)).toEqual(["Weekly review"]));
  });

  it("a run one instance records shows in the other", async () => {
    const { runner, settings } = await mountTwo();
    await act(async () => {
      await settings.result.current.createJob({ name: "Weekly review", cadence: dailyCadence, enabled: true });
    });
    await waitFor(() => expect(runner.result.current.jobs).toHaveLength(1));
    await act(async () => {
      await runner.result.current.recordRun(1, run("2026-10-19T09:00:00.000Z"));
    });
    await waitFor(() => expect(settings.result.current.jobs[0]?.lastRunAt).toBe("2026-10-19T09:00:00.000Z"));
  });

  it("an edit and a delete in one instance reach the other", async () => {
    const { runner, settings } = await mountTwo();
    await act(async () => {
      await settings.result.current.createJob({ name: "A", cadence: dailyCadence, enabled: true });
      await settings.result.current.createJob({ name: "B", cadence: dailyCadence, enabled: true });
    });
    await act(async () => {
      await settings.result.current.updateJob(1, { enabled: false });
      await settings.result.current.deleteJob(2);
    });
    await waitFor(() => expect(runner.result.current.jobs.map((j) => [j.name, j.enabled])).toEqual([["A", false]]));
  });

  // Each instance re-reads the stored list before writing, but two instances writing at once both read
  // the list before either saved: the second save dropped the first one's change.
  it("writes from two instances at once both land", async () => {
    const { runner, settings } = await mountTwo();
    await act(async () => {
      await Promise.all([
        settings.result.current.createJob({ name: "From Settings", cadence: dailyCadence, enabled: true }),
        runner.result.current.createJob({ name: "From the runner", cadence: dailyCadence, enabled: true }),
      ]);
    });
    await waitFor(() => expect(settings.result.current.jobs.map((j) => j.name).sort()).toEqual(["From Settings", "From the runner"]));
    expect(runner.result.current.jobs.map((j) => j.id).sort()).toEqual([1, 2]);
  });
});

describe("useScheduledJobs: a newer version's jobs and fields survive (§772 cr3)", () => {
  const KEY = "aipm-cockpit:scheduled-jobs";
  const known = { id: 1, name: "Known", type: "portfolioAnalysis", cadence: dailyCadence, enabled: true, projectId: "p1", timeZone: "UTC", key: "k1", lastRunAt: null, history: [], futureField: { a: 1 } };
  const foreign = { id: 2, name: "From the future", type: "portfolioAnalysis", cadence: { kind: "monthly", dayOfMonth: 3, timeOfDay: "09:00" }, enabled: true, mystery: [1, 2] };
  const stored = (): Record<string, unknown>[] => JSON.parse(localStorage.getItem(KEY) ?? "[]");

  beforeEach(() => localStorage.clear());

  // KILLED BY: an edit that rebuilds jobs from the known fields (or drops the foreign one).
  it("an edit of another job keeps both the unknown field and the foreign job, byte for byte", async () => {
    localStorage.setItem(KEY, JSON.stringify([known, foreign]));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(2));
    await act(async () => { await result.current.updateJob(1, { name: "Renamed" }); });
    const after = stored();
    expect(after[0]).toMatchObject({ name: "Renamed", futureField: { a: 1 } });
    expect(after[1]).toEqual(foreign);
  });

  // KILLED BY: letting an edit, a run record or a project change reach a foreign job.
  it("no write other than a delete reaches a foreign job", async () => {
    localStorage.setItem(KEY, JSON.stringify([known, foreign]));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(2));
    await act(async () => {
      await result.current.updateJob(2, { name: "x", enabled: false });
      await result.current.assignProject(2, "p9", "UTC");
      await result.current.clearProject(2);
      await result.current.disableJob(2);
      await result.current.recordRun(2, run("2026-10-23T09:00:00.000Z"));
    });
    expect(stored()[1]).toEqual(foreign);
    // What the list shows is untouched too (the run record is not appended to the placeholder).
    const shown = result.current.jobs.find((j) => j.id === 2);
    expect(shown?.history).toEqual([]);
    expect(shown?.lastRunAt).toBeNull();
  });

  // KILLED BY: dropping a job whose id is not a number.
  it("a job with a non-numeric id survives an edit of another job and can be deleted", async () => {
    const odd = { ...foreign, id: "job-abc" };
    localStorage.setItem(KEY, JSON.stringify([known, odd]));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(2));
    await act(async () => { await result.current.updateJob(1, { name: "Renamed" }); });
    expect(stored()[1]).toEqual(odd);
    const placeholder = result.current.jobs.find((j) => j.foreign)!.id;
    await act(async () => { await result.current.deleteJob(placeholder); });
    expect(stored().map((j) => j.id)).toEqual([1]);
  });

  it("a foreign job can still be deleted", async () => {
    localStorage.setItem(KEY, JSON.stringify([known, foreign]));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(2));
    await act(async () => { await result.current.deleteJob(2); });
    expect(stored().map((j) => j.id)).toEqual([1]);
  });
});
