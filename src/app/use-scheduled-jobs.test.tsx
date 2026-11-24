// src/app/use-scheduled-jobs.test.tsx — localStorage-backed hook tests.
import { StrictMode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useScheduledJobs } from "./use-scheduled-jobs";
import { ACCEPTANCE_KEY, acceptanceState, acceptJob, declineJob, isAcceptedHere, jobFingerprint, storedAcceptanceEntry } from "./scheduled-job-acceptance";
import { forgetOwnEdit, ownEditTarget } from "./scheduled-job-own-edit";
import type { ScheduledJob } from "./scheduled-jobs/types";
import { getDeviceLabel } from "./device-label";
import { JOB_HISTORY_CAP, type JobCadence, type ScheduledJobRun } from "./scheduled-jobs/types";

vi.mock("./device-label", () => ({ getDeviceLabel: vi.fn(() => "unknown") }));

const dailyCadence: JobCadence = { kind: "daily", timeOfDay: "09:00" };

function run(ranAt: string): ScheduledJobRun {
  return { ranAt, summary: `run ${ranAt}`, actionCount: 1, ok: true };
}

describe("useScheduledJobs (localStorage backend)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(getDeviceLabel).mockReturnValue("unknown");
  });

  it("a new job records this device's label", async () => {
    vi.mocked(getDeviceLabel).mockReturnValue("abcd1234");
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.createJob({ name: "A", cadence: dailyCadence, enabled: true });
    });
    expect(result.current.jobs[0].createdBy).toBe("abcd1234");
  });

  it("an unknown label is not recorded", async () => {
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.createJob({ name: "A", cadence: dailyCadence, enabled: true });
    });
    expect("createdBy" in result.current.jobs[0]).toBe(false);
  });

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
  it("readFresh started while a save is in flight resolves with the saved list", async () => {
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    let fresh: Awaited<ReturnType<typeof result.current.readFresh>> = [];
    await act(async () => {
      const saving = result.current.createJob({ name: "Late", cadence: dailyCadence, enabled: true });
      fresh = await result.current.readFresh();
      await saving;
    });
    expect(fresh.map((j) => j.name)).toEqual(["Late"]);
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

describe("useScheduledJobs acceptance on this device", () => {
  const JOBS_KEY = "aipm-cockpit:scheduled-jobs";
  const seed = (extra: Record<string, unknown> = {}) => localStorage.setItem(JOBS_KEY, JSON.stringify([{
    id: 1, name: "J", type: "portfolioAnalysis", cadence: dailyCadence, enabled: true,
    projectId: "p1", timeZone: "UTC", key: "key-1", instruction: "b", lastRunAt: null, history: [], ...extra,
  }]));
  const accepted = (): Record<string, string> => JSON.parse(localStorage.getItem(ACCEPTANCE_KEY) ?? "{}");

  beforeEach(() => {
    localStorage.clear();
    forgetOwnEdit("key-1");
    vi.mocked(getDeviceLabel).mockReturnValue("unknown");
  });

  const version = (over: Partial<ScheduledJob>): ScheduledJob => ({
    id: 1, name: "J", type: "portfolioAnalysis", cadence: dailyCadence, enabled: true,
    projectId: "p1", timeZone: "UTC", key: "key-1", instruction: "b", lastRunAt: null, history: [], ...over,
  });

  it("an instruction edit on an accepted job accepts the new version before its save resolves", async () => {
    seed();
    act(() => { acceptJob(version({})); });
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => {
      const saving = result.current.updateJob(1, { instruction: "c" }, "key-1");
      expect(acceptanceState(version({ instruction: "c" }))).toBe("accepted");
      await saving;
    });
    expect(acceptanceState(result.current.jobs[0])).toBe("accepted");
  });

  it("an instruction edit on a stopped job stops the new version before its save resolves", async () => {
    seed();
    act(() => { declineJob(version({})); });
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => {
      const saving = result.current.updateJob(1, { instruction: "c" }, "key-1");
      expect(acceptanceState(version({ instruction: "c" }))).toBe("declined");
      await saving;
    });
    expect(acceptanceState(result.current.jobs[0])).toBe("declined");
  });

  it("an edit that leaves the instruction as it was records nothing", async () => {
    seed();
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => { await result.current.updateJob(1, { instruction: "b" }, "key-1"); });
    expect(acceptanceState(result.current.jobs[0])).toBe("none");
  });

  it("a failed save puts the previous entry back and forgets the edit", async () => {
    seed();
    act(() => { declineJob(version({ instruction: "a" })); });
    const prev = storedAcceptanceEntry("key-1");
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    const realSetItem = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === JOBS_KEY) throw new Error("quota");
      realSetItem.call(this, k, v);
    });
    let rejected = false;
    let duringSave: string | undefined;
    try {
      await act(async () => {
        const saving = result.current.updateJob(1, { instruction: "c" }, "key-1");
        duringSave = acceptanceState(version({ instruction: "c" }));
        await saving.catch(() => { rejected = true; });
      });
    } finally {
      spy.mockRestore();
    }
    expect(duringSave).toBe("declined");
    expect(rejected).toBe(true);
    expect(storedAcceptanceEntry("key-1")).toBe(prev);
    expect(ownEditTarget(version({}))).toBe(jobFingerprint(version({})));
  });

  it("a Stop of the new version, then a failed save, stops the version the store still holds", async () => {
    seed();
    act(() => { acceptJob(version({})); });
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    const realSetItem = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === JOBS_KEY) throw new Error("quota");
      realSetItem.call(this, k, v);
    });
    try {
      await act(async () => {
        const saving = result.current.updateJob(1, { instruction: "c" }, "key-1");
        declineJob(version({ instruction: "c" })); // the user's Stop, aimed at the version being saved
        await saving.catch(() => {});
      });
    } finally {
      spy.mockRestore();
    }
    expect(result.current.jobs[0].instruction).toBe("b");
    expect(acceptanceState(result.current.jobs[0])).toBe("declined");
  });

  for (const [label, answer, expected] of [
    ["accepted", acceptJob, "accepted"],
    ["stopped", declineJob, "declined"],
  ] as const) {
    it(`two overlapping own edits of a ${label} job that both fail leave the original answer`, async () => {
      seed();
      act(() => { answer(version({})); });
      const { result } = renderHook(() => useScheduledJobs({ config: null }));
      await waitFor(() => expect(result.current.jobs).toHaveLength(1));
      const realSetItem = Storage.prototype.setItem;
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
        if (k === JOBS_KEY) throw new Error("quota");
        realSetItem.call(this, k, v);
      });
      try {
        await act(async () => {
          const first = result.current.updateJob(1, { instruction: "c" }, "key-1").catch(() => {});
          const second = result.current.updateJob(1, { instruction: "d" }, "key-1").catch(() => {});
          await Promise.all([first, second]);
        });
      } finally {
        spy.mockRestore();
      }
      expect(result.current.jobs[0].instruction).toBe("b");
      expect(acceptanceState(result.current.jobs[0])).toBe(expected);
    });
  }

  it("a Stop of the new version clicked while the edit saves stays stopped", async () => {
    seed();
    act(() => { acceptJob(version({})); });
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => {
      const saving = result.current.updateJob(1, { instruction: "c" }, "key-1");
      declineJob(version({ instruction: "c" }));
      await saving;
    });
    expect(acceptanceState(result.current.jobs[0])).toBe("declined");
  });

  it("two overlapping own edits: the second version is accepted at once and after both saves", async () => {
    seed();
    act(() => { acceptJob(version({})); });
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => {
      const first = result.current.updateJob(1, { instruction: "c" }, "key-1");
      const second = result.current.updateJob(1, { instruction: "d" }, "key-1");
      expect(acceptanceState(version({ instruction: "d" }))).toBe("accepted");
      await Promise.all([first, second]);
    });
    expect(acceptanceState(result.current.jobs[0])).toBe("accepted");
  });

  it("an edit whose other half changed in the store leaves the stored job reading changed", async () => {
    seed();
    act(() => { acceptJob(version({})); });
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    seed({ projectId: "p9" }); // another device moved the job to another project
    await act(async () => { await result.current.updateJob(1, { instruction: "c" }, "key-1"); });
    expect(result.current.jobs[0]).toMatchObject({ projectId: "p9", instruction: "c" });
    expect(acceptanceState(result.current.jobs[0])).toBe("changed");
  });

  it("while the edit saves its version is the row's target; once saved, the stored job's own", async () => {
    seed();
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    seed({ projectId: "p9" });
    await act(async () => {
      const saving = result.current.updateJob(1, { instruction: "c" }, "key-1");
      expect(ownEditTarget(version({}))).toBe(jobFingerprint(version({ instruction: "c" })));
      await saving;
    });
    expect(ownEditTarget(result.current.jobs[0])).toBe(jobFingerprint(result.current.jobs[0]));
  });

  it("creating a job accepts it on this device", async () => {
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.createJob({ name: "A", cadence: dailyCadence, enabled: true, projectId: "p1", instruction: "x" });
    });
    expect(acceptanceState(result.current.jobs[0])).toBe("accepted");
  });

  it("assigning a project accepts the job", async () => {
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await result.current.createJob({ name: "A", cadence: dailyCadence, enabled: true }); });
    const { id, key } = result.current.jobs[0];
    await act(async () => { await result.current.assignProject(id, "p2", "UTC", key ?? undefined); });
    expect(result.current.jobs[0].projectId).toBe("p2");
    expect(acceptanceState(result.current.jobs[0])).toBe("accepted");
  });

  it("editing the instruction of an accepted job keeps it accepted", async () => {
    seed();
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ "key-1": jobFingerprint({ projectId: "p1", instruction: "b" }) }));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => { await result.current.updateJob(1, { instruction: "c" }, "key-1"); });
    expect(acceptanceState(result.current.jobs[0])).toBe("accepted");
    expect(accepted()["key-1"]).toBe(jobFingerprint({ projectId: "p1", instruction: "c" }));
  });

  it("editing a job that changed since this device accepted it answers nothing", async () => {
    seed();
    const before = jobFingerprint({ projectId: "p1", instruction: "a" });
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ "key-1": before }));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    expect(acceptanceState(result.current.jobs[0])).toBe("changed");
    await act(async () => {
      const saving = result.current.updateJob(1, { instruction: "c" }, "key-1");
      expect(accepted()["key-1"]).toBe(before);
      await saving;
    });
    expect(acceptanceState(result.current.jobs[0])).toBe("changed");
    expect(accepted()["key-1"]).toBe(before);
  });

  it("an own revert while the first edit still saves keeps the answer for the version written last", async () => {
    seed();
    act(() => { acceptJob(version({})); });
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => {
      const first = result.current.updateJob(1, { instruction: "c" }, "key-1");
      const back = result.current.updateJob(1, { instruction: "b" }, "key-1"); // the tab still displays b
      await Promise.all([first, back]);
    });
    expect(result.current.jobs[0].instruction).toBe("b");
    expect(acceptanceState(result.current.jobs[0])).toBe("accepted");
  });

  it("renaming does not accept", async () => {
    seed();
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => { await result.current.updateJob(1, { name: "n" }, "key-1"); });
    expect(result.current.jobs[0].name).toBe("n");
    expect(acceptanceState(result.current.jobs[0])).toBe("none");
  });

  it("a failed save accepts nothing", async () => {
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    let rejected = false;
    await act(async () => {
      await result.current.createJob({ name: "A", cadence: dailyCadence, enabled: true, projectId: "p1" }).catch(() => { rejected = true; });
    });
    spy.mockRestore();
    expect(rejected).toBe(true);
    expect(localStorage.getItem(ACCEPTANCE_KEY)).toBeNull();
  });

  it("deleting forgets; a re-created job is not accepted by the old entry", async () => {
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const input = { name: "A", cadence: dailyCadence, enabled: true, projectId: "p1", instruction: "x" };
    await act(async () => { await result.current.createJob(input); });
    const oldKey = result.current.jobs[0].key as string;
    expect(accepted()).toHaveProperty(oldKey);
    await act(async () => { await result.current.deleteJob(result.current.jobs[0].id, oldKey); });
    expect(accepted()).not.toHaveProperty(oldKey);
    await act(async () => { await result.current.createJob(input); });
    const fresh = result.current.jobs[0];
    expect(fresh.key).not.toBe(oldKey);
    expect(Object.keys(accepted())).toEqual([fresh.key]);
  });

  it("clearProject does not accept", async () => {
    seed();
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => { await result.current.clearProject(1, "key-1"); });
    expect(acceptanceState(result.current.jobs[0])).toBe("none");
  });

  it("an instruction edit does not accept a project changed elsewhere", async () => {
    seed();
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ "key-1": jobFingerprint({ projectId: "p1", instruction: "a" }) }));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    seed({ projectId: "p9" }); // another device changed the project behind the hook's back
    await act(async () => { await result.current.updateJob(1, { instruction: "c" }, "key-1"); });
    expect(result.current.jobs[0].projectId).toBe("p9");
    expect(acceptanceState(result.current.jobs[0])).not.toBe("accepted");
  });

  it("assigning a project does not accept an instruction changed elsewhere", async () => {
    seed();
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ "key-1": jobFingerprint({ projectId: "p1", instruction: "b" }) }));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    seed({ instruction: "changed elsewhere" });
    await act(async () => { await result.current.assignProject(1, "p2", "UTC", "key-1"); });
    expect(result.current.jobs[0].projectId).toBe("p2");
    expect(acceptanceState(result.current.jobs[0])).not.toBe("accepted");
  });

  it("an instruction edit on a job this device stopped keeps it stopped", async () => {
    seed();
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ "key-1": "declined:" + jobFingerprint({ projectId: "p1", instruction: "b" }) }));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => { await result.current.updateJob(1, { instruction: "c" }, "key-1"); });
    expect(acceptanceState(result.current.jobs[0])).toBe("declined");
    expect(isAcceptedHere(result.current.jobs[0])).toBe(false);
  });

  it("an edit on a job whose decline is for an older version keeps it stopped", async () => {
    seed();
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ "key-1": "declined:" + jobFingerprint({ projectId: "p1", instruction: "a" }) }));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => { await result.current.updateJob(1, { instruction: "c" }, "key-1"); });
    expect(acceptanceState(result.current.jobs[0])).toBe("declined");
  });

  it("assigning a project on a job this device stopped keeps it stopped", async () => {
    seed();
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ "key-1": "declined:" + jobFingerprint({ projectId: "p1", instruction: "b" }) }));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => { await result.current.assignProject(1, "p2", "UTC", "key-1"); });
    expect(result.current.jobs[0].projectId).toBe("p2");
    expect(acceptanceState(result.current.jobs[0])).toBe("declined");
  });

  it("an edit on a job this device never answered answers nothing, but its version is the row's target", async () => {
    seed();
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => {
      const saving = result.current.updateJob(1, { instruction: "c" }, "key-1");
      expect(storedAcceptanceEntry("key-1")).toBeNull();
      expect(ownEditTarget(version({}))).toBe(jobFingerprint(version({ instruction: "c" })));
      await saving;
    });
    expect(acceptanceState(result.current.jobs[0])).toBe("none");
  });

  it("a decline that lands while an edit's save is pending wins over the edit", async () => {
    seed();
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ "key-1": jobFingerprint({ projectId: "p1", instruction: "b" }) }));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    const old = result.current.jobs[0];
    await act(async () => {
      const saving = result.current.updateJob(1, { instruction: "c" }, "key-1");
      declineJob(old); // the user stops the job while the save is in the write chain
      await saving;
    });
    expect(result.current.jobs[0].instruction).toBe("c");
    expect(isAcceptedHere(result.current.jobs[0])).toBe(false);
    expect(acceptanceState(old)).toBe("declined");
  });

  it("an assignment while a decline lands is not accepted either", async () => {
    seed();
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ "key-1": jobFingerprint({ projectId: "p1", instruction: "b" }) }));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    const old = result.current.jobs[0];
    await act(async () => {
      const saving = result.current.assignProject(1, "p2", "UTC", "key-1");
      declineJob(old);
      await saving;
    });
    expect(isAcceptedHere(result.current.jobs[0])).toBe(false);
  });

  it("two of this device's own overlapping edits both end accepted", async () => {
    seed();
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ "key-1": jobFingerprint({ projectId: "p1", instruction: "b" }) }));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => {
      const first = result.current.updateJob(1, { instruction: "c" }, "key-1");
      const second = result.current.updateJob(1, { instruction: "d" }, "key-1");
      await Promise.all([first, second]);
    });
    expect(result.current.jobs[0].instruction).toBe("d");
    expect(acceptanceState(result.current.jobs[0])).toBe("accepted");
  });

  it("a decline between two overlapping own edits still wins", async () => {
    seed();
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ "key-1": jobFingerprint({ projectId: "p1", instruction: "b" }) }));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    const old = result.current.jobs[0];
    await act(async () => {
      const first = result.current.updateJob(1, { instruction: "c" }, "key-1");
      const second = result.current.updateJob(1, { instruction: "d" }, "key-1");
      await first;
      declineJob(old); // the user stops the job after the first edit recorded, before the second save lands
      await second;
    });
    expect(result.current.jobs[0].instruction).toBe("d");
    expect(isAcceptedHere(result.current.jobs[0])).toBe(false);
  });

  it("a stale own-write value never lets a later edit override a Stop", async () => {
    seed();
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ "key-1": "declined:" + jobFingerprint({ projectId: "p1", instruction: "b" }) }));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => { await result.current.updateJob(1, { instruction: "c" }, "key-1"); }); // stays stopped
    const c = result.current.jobs[0];
    expect(acceptanceState(c)).toBe("declined");
    act(() => { acceptJob(c); }); // the user accepts c
    await act(async () => {
      const saving = result.current.updateJob(1, { instruction: "d" }, "key-1");
      declineJob(c); // ...and stops c during d's save
      await saving;
    });
    expect(result.current.jobs[0].instruction).toBe("d");
    expect(isAcceptedHere(result.current.jobs[0])).toBe(false);
  });

  it("an Accept clicked during a stopped job's edit save stands", async () => {
    seed();
    localStorage.setItem(ACCEPTANCE_KEY, JSON.stringify({ "key-1": jobFingerprint({ projectId: "p1", instruction: "b" }) }));
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => { await result.current.updateJob(1, { instruction: "c" }, "key-1"); }); // accepted c, map = fp(c)
    const c = result.current.jobs[0];
    act(() => { declineJob(c); }); // the user stops c
    await act(async () => {
      const saving = result.current.updateJob(1, { instruction: "d" }, "key-1");
      acceptJob(c); // ...then accepts c again during d's save
      await saving;
    });
    expect(acceptanceState(c)).toBe("accepted");
  });

  it("resetting the instruction to the default accepts the default fingerprint", async () => {
    seed();
    act(() => { acceptJob(version({})); });
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    await act(async () => { await result.current.updateJob(1, { instruction: undefined }, "key-1"); });
    expect(acceptanceState(result.current.jobs[0])).toBe("accepted");
    expect(accepted()["key-1"]).toBe(jobFingerprint({ projectId: "p1", instruction: undefined }));
  });
});

describe("useScheduledJobs re-reads when the page is looked at again", () => {
  const JOBS_KEY = "aipm-cockpit:scheduled-jobs";
  const store = (n: number) => localStorage.setItem(JOBS_KEY, JSON.stringify(Array.from({ length: n }, (_, i) => ({
    id: i + 1, name: `J${i + 1}`, type: "portfolioAnalysis", cadence: dailyCadence, enabled: true,
    projectId: "p1", timeZone: "UTC", key: `vis-${i + 1}`, lastRunAt: null, history: [],
  }))));

  beforeEach(() => { localStorage.clear(); });

  it("a visible tab and a focused window load the list again", async () => {
    store(1);
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    store(2);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => expect(result.current.jobs).toHaveLength(2));
    store(3);
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(result.current.jobs).toHaveLength(3));
    visibility.mockRestore();
  });

  it("a hidden tab does not load", async () => {
    store(1);
    const { result } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(getItem.mock.calls.filter(([k]) => k === JOBS_KEY)).toHaveLength(0);
    visibility.mockRestore();
    getItem.mockRestore();
  });

  it("unmounting removes both listeners", async () => {
    const addDoc = vi.spyOn(document, "addEventListener");
    const addWin = vi.spyOn(window, "addEventListener");
    const removeDoc = vi.spyOn(document, "removeEventListener");
    const removeWin = vi.spyOn(window, "removeEventListener");
    const { result, unmount } = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const onVisible = addDoc.mock.calls.find(([type]) => type === "visibilitychange")?.[1];
    const onFocus = addWin.mock.calls.find(([type]) => type === "focus")?.[1];
    expect(onVisible).toBeDefined();
    expect(onFocus).toBeDefined();
    unmount();
    expect(removeDoc.mock.calls.some(([type, fn]) => type === "visibilitychange" && fn === onVisible)).toBe(true);
    expect(removeWin.mock.calls.some(([type, fn]) => type === "focus" && fn === onFocus)).toBe(true);
    for (const s of [addDoc, addWin, removeDoc, removeWin]) s.mockRestore();
  });
});
