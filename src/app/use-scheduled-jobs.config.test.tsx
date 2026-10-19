// src/app/use-scheduled-jobs.config.test.tsx — §750 review: the store's backend (localStorage, or Turso once a
// config is set) can change while a job write is in flight. The write must load from and save to ONE backend, and
// an instance that moved to the other backend must show THAT backend's list, not the write's result. The store is
// faked with one list per config, and its load and save can be held.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ScheduledJob } from "./scheduled-jobs/types";
import type { TursoConfig } from "./turso-config";

const store = vi.hoisted(() => ({
  lists: new Map<unknown, ScheduledJob[]>(),
  saves: [] as Array<{ config: unknown; names: string[] }>,
  holdLoadOf: undefined as unknown,
  holdSave: false,
  releaseLoad: (): void => {},
  releaseSave: (): void => {},
}));

vi.mock("./scheduled-jobs-store", () => ({
  loadScheduledJobs: async (config: unknown) => {
    const list = [...(store.lists.get(config) ?? [])];
    if (store.holdLoadOf !== undefined && config === store.holdLoadOf) {
      store.holdLoadOf = undefined;
      await new Promise<void>((resolve) => { store.releaseLoad = resolve; });
    }
    return list;
  },
  saveScheduledJobs: async (config: unknown, jobs: readonly ScheduledJob[]) => {
    if (store.holdSave) {
      store.holdSave = false;
      await new Promise<void>((resolve) => { store.releaseSave = resolve; });
    }
    store.lists.set(config, [...jobs]);
    store.saves.push({ config, names: jobs.map((j) => j.name) });
  },
}));

import { useScheduledJobs } from "./use-scheduled-jobs";

const TURSO = { url: "libsql://fictional.example", authToken: "tok" } as unknown as TursoConfig;
const job = (id: number, name: string): ScheduledJob =>
  ({ id, name, type: "portfolioAnalysis", cadence: { kind: "daily", timeOfDay: "09:00" }, enabled: true, lastRunAt: null, history: [] }) as ScheduledJob;

function mount(config: TursoConfig | null) {
  return renderHook((props: { config: TursoConfig | null }) => useScheduledJobs({ config: props.config }), { initialProps: { config } });
}

beforeEach(() => {
  store.lists = new Map([[null, [job(1, "local")]], [TURSO, [job(1, "turso")]]]);
  store.saves = [];
  store.holdLoadOf = undefined;
  store.holdSave = false;
});

describe("useScheduledJobs — a backend change during a write (§750 review)", () => {
  // KILLED BY: reading `cfgRef.current` again for the save (the list loaded from localStorage lands in Turso).
  it("a write saves to the backend it loaded from, even if the config changed in between", async () => {
    const h = mount(null);
    await waitFor(() => expect(h.result.current.jobs.map((j) => j.name)).toEqual(["local"]));
    store.holdLoadOf = null; // the write's own load
    let writing!: Promise<void>;
    act(() => { writing = h.result.current.updateJob(1, { name: "local edited" }); });
    await waitFor(() => expect(store.holdLoadOf).toBeUndefined()); // PRECONDITION: the write's load is held
    h.rerender({ config: TURSO });
    await act(async () => { store.releaseLoad(); await writing; });
    expect(store.saves).toEqual([{ config: null, names: ["local edited"] }]);
    expect(store.lists.get(TURSO)!.map((j) => j.name)).toEqual(["turso"]);
  });

  // KILLED BY: applying the write's list whatever config the instance is on now.
  it("an instance that moved to the other backend keeps that backend's list when the old write lands", async () => {
    const h = mount(null);
    await waitFor(() => expect(h.result.current.jobs.map((j) => j.name)).toEqual(["local"]));
    store.holdSave = true;
    let writing!: Promise<void>;
    act(() => { writing = h.result.current.updateJob(1, { name: "local edited" }); });
    await waitFor(() => expect(store.holdSave).toBe(false)); // PRECONDITION: the save is held
    h.rerender({ config: TURSO });
    await waitFor(() => expect(h.result.current.jobs.map((j) => j.name)).toEqual(["turso"]));
    await act(async () => { store.releaseSave(); await writing; });
    expect(h.result.current.jobs.map((j) => j.name)).toEqual(["turso"]);
  });

  // KILLED BY: one save counter for every backend (the Turso read, started before the localStorage save landed,
  // is dropped and the instance keeps the localStorage list).
  it("a read of the new backend is not dropped by a save to the old one", async () => {
    const h = mount(null);
    await waitFor(() => expect(h.result.current.jobs.map((j) => j.name)).toEqual(["local"]));
    store.holdSave = true;
    let writing!: Promise<void>;
    act(() => { writing = h.result.current.updateJob(1, { name: "local edited" }); });
    await waitFor(() => expect(store.holdSave).toBe(false)); // PRECONDITION: the save is held
    store.holdLoadOf = TURSO;
    h.rerender({ config: TURSO });
    await waitFor(() => expect(store.holdLoadOf).toBeUndefined()); // PRECONDITION: the Turso read is held
    await act(async () => { store.releaseSave(); await writing; });
    await act(async () => { store.releaseLoad(); });
    await waitFor(() => expect(h.result.current.jobs.map((j) => j.name)).toEqual(["turso"]));
  });
});
