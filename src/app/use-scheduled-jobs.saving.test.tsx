// src/app/use-scheduled-jobs.saving.test.tsx — which jobs have a save in flight (`savingJobs`), with saves held.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useScheduledJobs } from "./use-scheduled-jobs";
import { jobSaveId } from "./scheduled-jobs/schedule";
import { acceptJob, storedAcceptanceEntry } from "./scheduled-job-acceptance";
import type { ScheduledJob } from "./scheduled-jobs/types";
import type { TursoConfig } from "./turso-config";

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
  const hook = renderHook(() => useScheduledJobs({ config: TURSO }));
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
    act(() => { acceptJob(job()); });
    const before = storedAcceptanceEntry("saving-key");
    const { result } = await mounted();
    holdSaves([true]);
    let saving: Promise<void> = Promise.resolve();
    act(() => { saving = result.current.updateJob(1, { instruction: "c" }, "saving-key"); });
    expect(result.current.savingJobs.size).toBe(1);
    releaseHeld();
    await act(async () => { await saving.catch(() => {}); });
    expect(result.current.savingJobs.size).toBe(0);
    expect(storedAcceptanceEntry("saving-key")).toBe(before);
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
