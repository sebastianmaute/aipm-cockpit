// src/app/use-scheduled-jobs.config.test.tsx — §750 review: the store's backend (localStorage, or Turso once a
// config is set) can change while a job write is in flight. The write must load from and save to ONE backend, and
// an instance that moved to the other backend must show THAT backend's list, not the write's result. The store is
// faked with one list per config, and its load and save can be held.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ScheduledJob } from "./scheduled-jobs/types";
import type { TursoConfig } from "./turso-config";

const store = vi.hoisted(() => ({
  lists: new Map<unknown, ScheduledJob[]>(), // keyed by `keyOf`: the database, not the config object
  saves: [] as Array<{ config: unknown; names: string[] }>,
  holdLoadOf: undefined as unknown,
  holdSave: false,
  releaseLoad: (): void => {},
  releaseSave: (): void => {},
}));

const keyOf = (config: unknown): unknown => (config === null ? null : (config as { httpUrl: string }).httpUrl);

vi.mock("./scheduled-jobs-store", () => ({
  loadScheduledJobs: async (config: unknown) => {
    const list = [...(store.lists.get(keyOf(config)) ?? [])];
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
    store.lists.set(keyOf(config), [...jobs]);
    store.saves.push({ config: keyOf(config), names: jobs.map((j) => j.name) });
  },
}));

import { useScheduledJobs } from "./use-scheduled-jobs";

const TURSO: TursoConfig = { httpUrl: "https://fictional.example", authToken: "tok" };
const job = (id: number, name: string): ScheduledJob =>
  ({ id, name, type: "portfolioAnalysis", cadence: { kind: "daily", timeOfDay: "09:00" }, enabled: true, projectId: null, timeZone: null, key: null, lastRunAt: null, history: [] }) as ScheduledJob;

function mount(config: TursoConfig | null) {
  return renderHook((props: { config: TursoConfig | null }) => useScheduledJobs({ config: props.config }), { initialProps: { config } });
}

beforeEach(() => {
  store.lists = new Map<unknown, ScheduledJob[]>([[null, [job(1, "local")]], [TURSO.httpUrl, [job(1, "turso")]]]);
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
    expect(store.lists.get(TURSO.httpUrl)!.map((j) => j.name)).toEqual(["turso"]);
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

  // §750 third review — the same database under a NEW config object (a token typed again, hydration minting an equal
  // object) is the same backend: a write in flight still reaches this instance, and nothing goes stale.
  // KILLED BY: keying by the config object again (the write's list is not applied after the re-mint).
  it("a config re-created for the same database still gets the write's list", async () => {
    const h = mount(TURSO);
    await waitFor(() => expect(h.result.current.jobs.map((j) => j.name)).toEqual(["turso"]));
    store.holdSave = true;
    let writing!: Promise<void>;
    act(() => { writing = h.result.current.updateJob(1, { name: "turso edited" }); });
    await waitFor(() => expect(store.holdSave).toBe(false)); // PRECONDITION: the save is held
    h.rerender({ config: { ...TURSO } }); // equal, new object
    await act(async () => { store.releaseSave(); await writing; });
    await waitFor(() => expect(h.result.current.jobs.map((j) => j.name)).toEqual(["turso edited"]));
  });
});

describe("useScheduledJobs — jobsSource and keyed writes (§772 final review)", () => {
  // KILLED BY: not setting the source with the list (the runner could tick on the previous backend's jobs).
  it("names the backend its jobs were read from, and keeps the old name until the new read lands", async () => {
    const h = mount(null);
    expect(h.result.current.jobsSource).toBeUndefined();
    await waitFor(() => expect(h.result.current.jobsSource).toBeNull());
    store.holdLoadOf = TURSO;
    h.rerender({ config: TURSO });
    await waitFor(() => expect(store.holdLoadOf).toBeUndefined()); // PRECONDITION: the Turso read is held
    expect(h.result.current.jobs.map((j) => j.name)).toEqual(["local"]);
    expect(h.result.current.jobsSource).toBeNull();
    await act(async () => { store.releaseLoad(); });
    await waitFor(() => expect(h.result.current.jobsSource).toBe(TURSO.httpUrl));
    expect(h.result.current.jobs.map((j) => j.name)).toEqual(["turso"]);
  });

  // KILLED BY: matching updateJob / deleteJob / assignProject by id alone.
  it("an id-matching job with another key is neither updated, deleted nor assigned", async () => {
    store.lists.set(TURSO.httpUrl, [{ ...job(1, "turso"), key: "key-1" }]);
    const h = mount(TURSO);
    await waitFor(() => expect(h.result.current.jobs).toHaveLength(1));
    await act(async () => { await h.result.current.updateJob(1, { name: "wrong" }, "other-key"); });
    await act(async () => { await h.result.current.assignProject(1, "p9", "UTC", "other-key"); });
    await act(async () => { await h.result.current.deleteJob(1, "other-key"); });
    expect(h.result.current.jobs.map((j) => [j.name, j.projectId])).toEqual([["turso", null]]);
    await act(async () => { await h.result.current.updateJob(1, { name: "right" }, "key-1"); });
    expect(h.result.current.jobs.map((j) => j.name)).toEqual(["right"]);
    await act(async () => { await h.result.current.deleteJob(1, "key-1"); });
    expect(h.result.current.jobs).toEqual([]);
  });
});
