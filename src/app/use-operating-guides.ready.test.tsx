// §701 review 7 — `ready` means "the library for the CURRENT source has
// loaded". A change of source (file mode, then Turso once its sealed token is
// unlocked) reads not-ready until that source's load settles, so an unattended
// digest or runner does not go out with the previous source's guides.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { OperatingGuide } from "./operating-guide";
import type { TursoConfig } from "./turso-config";

const store = vi.hoisted(() => ({
  pending: null as null | ((list: OperatingGuide[]) => void),
  holdLocal: false,
  pendingLocal: null as null | ((list: OperatingGuide[]) => void),
}));
vi.mock("./operating-guide-store", () => ({
  loadGuides: vi.fn((config: unknown) =>
    config === null
      ? store.holdLocal
        ? new Promise<OperatingGuide[]>((resolve) => { store.pendingLocal = resolve; })
        : Promise.resolve([])
      : new Promise<OperatingGuide[]>((resolve) => { store.pending = resolve; }),
  ),
  saveGuide: vi.fn(async () => {}),
  removeGuide: vi.fn(async () => {}),
}));

import { builtinSeeds, useOperatingGuides } from "./use-operating-guides";

const TURSO = { url: "libsql://x.turso.io", authToken: "t" } as unknown as TursoConfig;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe("useOperatingGuides ready follows the current source", () => {
  beforeEach(() => { store.pending = null; store.holdLocal = false; store.pendingLocal = null; });

  it("is not ready until the first load settles", async () => {
    const { result } = renderHook(() => useOperatingGuides({ config: null }));
    expect(result.current.ready).toBe(false);
    await act(flush);
    expect(result.current.ready).toBe(true);
  });

  it("drops back to not-ready when the source changes, until the new source has loaded", async () => {
    const { result, rerender } = renderHook((p: { config: TursoConfig | null }) => useOperatingGuides(p), {
      initialProps: { config: null as TursoConfig | null },
    });
    await act(flush);
    expect(result.current.ready).toBe(true);

    rerender({ config: TURSO });
    expect(result.current.ready).toBe(false); // the local library is not the Turso one
    await act(flush);
    expect(result.current.ready).toBe(false); // the Turso load is still in flight

    await act(async () => { store.pending?.(builtinSeeds()); await flush(); });
    expect(result.current.ready).toBe(true);
  });

  it("does not count a load of the PREVIOUS source as the current one", async () => {
    store.holdLocal = true;
    const { result, rerender } = renderHook((p: { config: TursoConfig | null }) => useOperatingGuides(p), {
      initialProps: { config: null as TursoConfig | null },
    });
    await act(flush); // the local load is still in flight
    rerender({ config: TURSO });
    await act(flush);
    store.holdLocal = false; // let the old refresh run to completion, re-read included
    await act(async () => { store.pendingLocal?.([]); await flush(); }); // the OLD load settles late
    expect(result.current.ready).toBe(false);
    await act(async () => { store.pending?.(builtinSeeds()); await flush(); });
    expect(result.current.ready).toBe(true);
  });

  it("a load of the previous source that settles AFTER the new one does not replace its library", async () => {
    store.holdLocal = true;
    const { result, rerender } = renderHook((p: { config: TursoConfig | null }) => useOperatingGuides(p), {
      initialProps: { config: null as TursoConfig | null },
    });
    await act(flush);
    const resolveLocal = store.pendingLocal;
    rerender({ config: TURSO });
    await act(flush);
    await act(async () => { store.pending?.(builtinSeeds()); await flush(); }); // the NEW source lands first
    expect(result.current.ready).toBe(true);
    const turso = result.current.guides;
    expect(turso.length).toBeGreaterThan(0);
    store.holdLocal = false;
    await act(async () => { resolveLocal?.([]); await flush(); }); // then the OLD one settles
    expect(result.current.guides).toBe(turso);
    expect(result.current.ready).toBe(true);
  });
});
