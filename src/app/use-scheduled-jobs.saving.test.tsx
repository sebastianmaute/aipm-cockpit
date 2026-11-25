// src/app/use-scheduled-jobs.saving.test.tsx — which jobs have a save in flight (`savingJobs`), with saves held.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useScheduledJobs } from "./use-scheduled-jobs";
import { JobChangedError, JobGoneError, jobSaveId } from "./scheduled-jobs/schedule";
import { acceptJob, storedAcceptanceEntry } from "./scheduled-job-acceptance";
import type { ScheduledJob } from "./scheduled-jobs/types";
import type { TursoConfig } from "./turso-config";

/** The portfolio this file's answers are kept for (`acceptanceScope`). */
const SCOPE = "https://saving.example";

const store = vi.hoisted(() => ({
  list: [] as unknown[],
  gate: null as Promise<void> | null,
  fails: [] as boolean[],
  /** One gate per save, in order: a save waits for its own gate when one is queued. */
  gates: [] as Promise<void>[],
}));
vi.mock("./scheduled-jobs-store", () => ({
  loadScheduledJobs: async () => structuredClone(store.list),
  saveScheduledJobs: async (_config: unknown, next: unknown[]) => {
    if (store.gate) await store.gate;
    const own = store.gates.shift();
    if (own) await own;
    if (store.fails.shift()) throw new Error("offline");
    store.list = structuredClone(next);
  },
}));

const TURSO = { httpUrl: "https://saving.example", authToken: "t" } as unknown as TursoConfig;

function job(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 1, name: "J", type: "portfolioAnalysis", cadence: { kind: "daily", timeOfDay: "09:00" }, enabled: true,
    projectId: "p1", timeZone: "UTC", key: "saving-key", instruction: "b", lastRunAt: null, history: [], ...over,
  };
}

let releaseHeld: () => void = () => {};
function holdSaves(fails: boolean[] = []): void {
  store.fails = [...fails];
  store.gate = new Promise<void>((r) => { releaseHeld = () => { store.gate = null; r(); }; });
}

beforeEach(() => {
  localStorage.clear();
  store.list = [job()];
  store.gate = null;
  store.fails = [];
  store.gates = [];
});
afterEach(() => { releaseHeld(); releaseHeld = () => {}; });

async function mounted() {
  const hook = renderHook(() => useScheduledJobs({ config: TURSO, trackSaving: true }));
  await waitFor(() => expect(hook.result.current.jobs).toHaveLength(1));
  return hook;
}

describe("useScheduledJobs — jobs with a save in flight", () => {
  it("a job is saving from the call until its save settles", async () => {
    const { result } = await mounted();
    holdSaves();
    let saving: Promise<void> = Promise.resolve();
    act(() => { saving = result.current.updateJob(1, { instruction: "c" }, "saving-key"); });
    expect(result.current.savingJobs.has(jobSaveId(job()))).toBe(true);
    releaseHeld();
    await act(async () => { await saving; });
    expect(result.current.savingJobs.has(jobSaveId(job()))).toBe(false);
  });

  it("two overlapping saves of one job keep it saving until both settle", async () => {
    const { result } = await mounted();
    const opens: (() => void)[] = [];
    store.gates = [0, 1].map(() => new Promise<void>((r) => { opens.push(r); }));
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.updateJob(1, { instruction: "c" }, "saving-key");
      second = result.current.updateJob(1, { name: "n" }, "saving-key");
    });
    opens[0]();
    await act(async () => { await first; });
    expect(result.current.savingJobs.has(jobSaveId(job()))).toBe(true); // the second save is still held
    opens[1]();
    await act(async () => { await second; });
    expect(result.current.savingJobs.has(jobSaveId(job()))).toBe(false);
  });

  it("a failed save ends the saving state and leaves this device's answer untouched", async () => {
    act(() => { acceptJob(job(), SCOPE); });
    const before = storedAcceptanceEntry("saving-key", SCOPE);
    const { result } = await mounted();
    holdSaves([true]);
    let saving: Promise<void> = Promise.resolve();
    act(() => { saving = result.current.updateJob(1, { instruction: "c" }, "saving-key"); });
    expect(result.current.savingJobs.size).toBe(1);
    releaseHeld();
    await act(async () => { await saving.catch(() => {}); });
    expect(result.current.savingJobs.size).toBe(0);
    expect(storedAcceptanceEntry("saving-key", SCOPE)).toBe(before);
  });

  it("a job without a key is tracked by its id", async () => {
    store.list = [job({ key: null })];
    const { result } = await mounted();
    holdSaves();
    let saving: Promise<void> = Promise.resolve();
    act(() => { saving = result.current.assignProject(1, "p2", "UTC"); });
    expect(result.current.savingJobs.has("id:1")).toBe(true);
    releaseHeld();
    await act(async () => { await saving; });
    expect(result.current.savingJobs.size).toBe(0);
  });
});

describe("useScheduledJobs — a save that checks the stored instruction first", () => {
  it("writes when the stored instruction is one the caller allows", async () => {
    const { result } = await mounted();
    await act(async () => { await result.current.updateJob(1, { instruction: "c" }, "saving-key", { expectInstruction: () => "b" }); });
    expect((store.list[0] as ScheduledJob).instruction).toBe("c");
  });

  it("judges the expected text when the save RUNS, not when it is called", async () => {
    const { result } = await mounted();
    const opens: (() => void)[] = [];
    store.gates = [0].map(() => new Promise<void>((r) => { opens.push(r); }));
    let expected = "not yet";
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.updateJob(1, { name: "n" }, "saving-key"); // holds the chain
      second = result.current.updateJob(1, { instruction: "c" }, "saving-key", { expectInstruction: () => expected });
    });
    expected = "b"; // learned after the call, before the save runs
    opens[0]();
    await act(async () => { await first; await second; });
    expect((store.list[0] as ScheduledJob).instruction).toBe("c");
  });

  it("tells the caller, inside the write chain, that its text was written", async () => {
    const { result } = await mounted();
    const onWritten = vi.fn();
    await act(async () => { await result.current.updateJob(1, { instruction: "c" }, "saving-key", { expectInstruction: () => "b", onWritten }); });
    expect(onWritten).toHaveBeenCalledTimes(1);
  });

  it("a null expectation (a stale save) refuses, even when the stored text equals the text being saved", async () => {
    store.list = [job({ instruction: "c" })];
    const { result } = await mounted();
    let error: unknown = null;
    await act(async () => {
      await result.current.updateJob(1, { instruction: "c" }, "saving-key", { expectInstruction: () => null }).catch((e: unknown) => { error = e; });
    });
    expect(error).toBeInstanceOf(JobChangedError);
  });

  it("tells the caller about a refusal inside the write chain, before the next queued write is judged", async () => {
    store.list = [job({ instruction: "x" })];
    const { result } = await mounted();
    const seen: string[] = [];
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.updateJob(1, { instruction: "c" }, "saving-key", {
        expectInstruction: () => "b", onRefused: () => { seen.push("refused"); },
      }).catch(() => {});
      second = result.current.updateJob(1, { instruction: "cd" }, "saving-key", {
        expectInstruction: () => { seen.push("judged"); return "x"; },
      });
    });
    await act(async () => { await first; await second; });
    expect(seen).toEqual(["refused", "judged"]);
  });

  it("does not call onRefused for a write that lands", async () => {
    const { result } = await mounted();
    const onRefused = vi.fn();
    await act(async () => { await result.current.updateJob(1, { instruction: "c" }, "saving-key", { expectInstruction: () => "b", onRefused }); });
    expect(onRefused).not.toHaveBeenCalled();
  });

  it("a stored text that already equals the text being saved counts as success, not a refusal", async () => {
    store.list = [job({ instruction: "c" })]; // another device saved the same text
    const { result } = await mounted();
    await act(async () => { await result.current.updateJob(1, { instruction: "c" }, "saving-key", { expectInstruction: () => "b" }); });
    expect((store.list[0] as ScheduledJob).instruction).toBe("c");
  });

  it("refuses, writes nothing, answers nothing and re-reads the list when the stored instruction changed", async () => {
    act(() => { acceptJob(job(), SCOPE); });
    const before = storedAcceptanceEntry("saving-key", SCOPE);
    const { result } = await mounted();
    store.list = [job({ instruction: "d" })]; // another device, not yet re-read here
    let error: unknown = null;
    await act(async () => {
      await result.current.updateJob(1, { instruction: "c" }, "saving-key", { expectInstruction: () => "b" }).catch((e: unknown) => { error = e; });
    });
    expect(error).toBeInstanceOf(JobChangedError);
    expect((error as JobChangedError).stored).toBe("d");
    expect((store.list[0] as ScheduledJob).instruction).toBe("d");
    expect(storedAcceptanceEntry("saving-key", SCOPE)).toBe(before);
    await waitFor(() => expect(result.current.jobs[0].instruction).toBe("d")); // the list was read again
    expect(result.current.savingJobs.size).toBe(0);
  });

  it("an empty stored instruction compares as the empty text", async () => {
    store.list = [job({ instruction: undefined })];
    const { result } = await mounted();
    await act(async () => { await result.current.updateJob(1, { instruction: "c" }, "saving-key", { expectInstruction: () => "" }); });
    expect((store.list[0] as ScheduledJob).instruction).toBe("c");
  });
});

describe("useScheduledJobs — instances that do not track saves, and jobs deleted elsewhere", () => {
  it("an instance without trackSaving keeps one empty saving set and adds no re-render for it (recordRun)", async () => {
    let renders = 0;
    const { result } = renderHook(() => { renders += 1; return useScheduledJobs({ config: TURSO }); });
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    const before = result.current.savingJobs;
    const rendersBefore = renders;
    await act(async () => { await result.current.recordRun(1, { ranAt: "2026-11-24T09:00:00Z", summary: "s", actionCount: 0, ok: true }, "saving-key"); });
    expect(result.current.savingJobs).toBe(before);
    expect(result.current.savingJobs.size).toBe(0);
    // Only the new list re-renders (no saving-state renders on either side of the write).
    expect(renders - rendersBefore).toBeLessThanOrEqual(2);
  });

  it("an edit of a job deleted on another device writes nothing, tells nobody it was written, and rejects as gone", async () => {
    const { result } = await mounted();
    store.list = []; // deleted elsewhere
    const onWritten = vi.fn();
    let error: unknown = null;
    await act(async () => {
      await result.current.updateJob(1, { instruction: "c" }, "saving-key", { expectInstruction: () => "b", onWritten }).catch((e: unknown) => { error = e; });
    });
    expect(error).toBeInstanceOf(JobGoneError);
    expect(onWritten).not.toHaveBeenCalled();
    expect(store.list).toEqual([]);
  });

  it("assigning a project to a job deleted elsewhere rejects as gone and reads the list again", async () => {
    const { result } = await mounted();
    store.list = [];
    let error: unknown = null;
    await act(async () => { await result.current.assignProject(1, "p2", "UTC", "saving-key").catch((e: unknown) => { error = e; }); });
    expect(error).toBeInstanceOf(JobGoneError);
    await waitFor(() => expect(result.current.jobs).toEqual([])); // the row goes away
  });

  it("the runner's writes to a deleted job still resolve quietly", async () => {
    const { result } = await mounted();
    store.list = [];
    await act(async () => { await result.current.clearProject(1, "saving-key"); });
    await act(async () => { await result.current.disableJob(1, "saving-key"); });
    expect(store.list).toEqual([]);
  });
});
