// §701 — `ready` means "the load for the CURRENT source has settled". A change
// of source (file mode, then Turso once its sealed token is unlocked) reads
// not-ready until that source's load settles, so an unattended digest or runner
// does not go out with the previous source's guides; a refresh superseded by a
// save, or one for a source no longer current, never marks it ready.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { OperatingGuide } from "./operating-guide";
import type { TursoConfig } from "./turso-config";

type Resolve = (list: OperatingGuide[]) => void;
const store = vi.hoisted(() => ({
  holdLocal: false,
  local: [] as Resolve[], // pending local loads, oldest first
  turso: [] as Resolve[], // pending Turso loads, oldest first
  failSave: false,
}));
vi.mock("./operating-guide-store", () => ({
  loadGuides: vi.fn((config: unknown) => {
    if (config !== null) return new Promise<OperatingGuide[]>((r) => { store.turso.push(r); });
    if (!store.holdLocal) return Promise.resolve([]);
    return new Promise<OperatingGuide[]>((r) => { store.local.push(r); });
  }),
  saveGuide: vi.fn(async () => { if (store.failSave) throw new Error("save failed"); }),
  removeGuide: vi.fn(async () => {}),
}));

import { builtinSeeds, useOperatingGuides } from "./use-operating-guides";

const TURSO = { url: "libsql://x.turso.io", authToken: "t" } as unknown as TursoConfig;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const render = (config: TursoConfig | null = null) =>
  renderHook((p: { config: TursoConfig | null }) => useOperatingGuides(p), { initialProps: { config } });

describe("useOperatingGuides ready follows the current source", () => {
  beforeEach(() => {
    store.holdLocal = false;
    store.local = [];
    store.turso = [];
    store.failSave = false;
  });

  it("is not ready until the first load settles", async () => {
    const { result } = render();
    expect(result.current.ready).toBe(false);
    await act(flush);
    expect(result.current.ready).toBe(true);
  });

  it("drops back to not-ready when the source changes, until the new source has loaded", async () => {
    const { result, rerender } = render();
    await act(flush);
    expect(result.current.ready).toBe(true);
    rerender({ config: TURSO });
    expect(result.current.ready).toBe(false); // the local library is not the Turso one
    await act(flush);
    expect(result.current.ready).toBe(false); // the Turso load is still in flight
    await act(async () => { store.turso.shift()?.(builtinSeeds()); await flush(); });
    expect(result.current.ready).toBe(true);
  });

  it("does not count a load of the PREVIOUS source as the current one", async () => {
    store.holdLocal = true;
    const { result, rerender } = render();
    await act(flush); // the local load is still in flight
    rerender({ config: TURSO });
    await act(flush);
    store.holdLocal = false; // let the old refresh run to completion, re-read included
    await act(async () => { store.local.shift()?.([]); await flush(); }); // the OLD load settles late
    expect(result.current.ready).toBe(false);
    await act(async () => { store.turso.shift()?.(builtinSeeds()); await flush(); });
    expect(result.current.ready).toBe(true);
  });

  it("a load of the previous source that settles AFTER the new one does not replace its library", async () => {
    store.holdLocal = true;
    const { result, rerender } = render();
    await act(flush);
    const resolveLocal = store.local.shift();
    rerender({ config: TURSO });
    await act(flush);
    await act(async () => { store.turso.shift()?.(builtinSeeds()); await flush(); }); // the NEW source lands first
    expect(result.current.ready).toBe(true);
    const turso = result.current.guides;
    expect(turso.length).toBeGreaterThan(0);
    store.holdLocal = false;
    await act(async () => { resolveLocal?.([]); await flush(); }); // then the OLD one settles
    expect(result.current.guides).toBe(turso);
    expect(result.current.ready).toBe(true);
  });

  // A save during the first load supersedes it (opSeq): that refresh sets no
  // library, so it must not mark one loaded — only the save's own refresh may.
  it("a first load superseded by a save does not read ready with the library still empty", async () => {
    store.holdLocal = true;
    const { result } = render();
    await act(flush); // first load in flight
    let saving!: Promise<void>;
    act(() => { saving = result.current.update(builtinSeeds()[0]); });
    await act(flush);
    await act(async () => { store.local.shift()?.(builtinSeeds()); await flush(); }); // the superseded load settles
    expect(result.current.ready).toBe(false);
    store.holdLocal = false;
    await act(async () => { while (store.local.length > 0) store.local.shift()!(builtinSeeds()); await flush(); }); // release the held reloads
    await act(async () => { await saving; await flush(); }); // the save's own refresh settles
    expect(result.current.ready).toBe(true);
  });

  // The save's refresh runs saved or not: a failed save during the first load
  // must not leave `ready` false for good (the chat composer waits on it).
  it("still settles ready when a save that superseded the first load fails", async () => {
    store.holdLocal = true;
    store.failSave = true;
    const { result } = render();
    await act(flush);
    let saving!: Promise<void>;
    // The failed save rejects: catch it at once so it is never an unhandled rejection.
    act(() => { saving = result.current.update(builtinSeeds()[0]).catch(() => {}); });
    await act(async () => { store.local.shift()?.(builtinSeeds()); await flush(); });
    store.holdLocal = false;
    await act(async () => { while (store.local.length > 0) store.local.shift()!(builtinSeeds()); await flush(); }); // release the held reloads
    await act(async () => { await saving; await flush(); });
    expect(result.current.ready).toBe(true);
  });
});
