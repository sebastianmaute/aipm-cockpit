// src/app/use-operating-guides.test.tsx
import { StrictMode } from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useOperatingGuides, builtinSeeds, reconcileBuiltins } from "./use-operating-guides";
import { BUILTIN_GUIDE_ID, BUILTIN_FEATURE_GUIDES } from "./operating-guide-builtin.generated";
import type { OperatingGuide } from "./operating-guide";

const SEED_COUNT = 1 + BUILTIN_FEATURE_GUIDES.length; // leadership + feature guides

describe("builtinSeeds", () => {
  it("returns the leadership guide plus every feature guide, all built-in", () => {
    const seeds = builtinSeeds();
    expect(seeds.length).toBe(SEED_COUNT);
    expect(seeds.every((g) => g.builtIn)).toBe(true);
    expect(seeds.some((g) => g.id === BUILTIN_GUIDE_ID)).toBe(true);
    for (const fg of BUILTIN_FEATURE_GUIDES) {
      const seed = seeds.find((g) => g.id === fg.id);
      expect(seed).toBeDefined();
      // feature guides carry their scope
      expect(seed?.scope).toEqual(fg.scope);
    }
  });
});

describe("reconcileBuiltins", () => {
  it("seeds all built-ins when existing is empty", () => {
    const toSave = reconcileBuiltins([]);
    expect(toSave.length).toBe(SEED_COUNT);
    expect(toSave.every((g) => g.builtIn)).toBe(true);
  });

  it("preserves a disabled built-in's enabled flag while refreshing content/name/scope", () => {
    const seed = builtinSeeds().find((g) => g.id !== BUILTIN_GUIDE_ID);
    if (!seed) throw new Error("expected a feature seed");
    const disabledStale: OperatingGuide = {
      ...seed,
      enabled: false,
      priority: 99,
      name: "stale name",
      content: "stale content",
    };
    const toSave = reconcileBuiltins([disabledStale]);
    const refreshed = toSave.find((g) => g.id === seed.id);
    expect(refreshed).toBeDefined();
    expect(refreshed?.enabled).toBe(false); // toggle preserved
    expect(refreshed?.priority).toBe(99); // priority preserved
    expect(refreshed?.name).toBe(seed.name); // refreshed
    expect(refreshed?.content).toBe(seed.content); // refreshed
    expect(refreshed?.scope).toEqual(seed.scope); // refreshed
  });

  it("does not re-save a built-in whose content/name/scope already match the seed", () => {
    const existing = builtinSeeds().map((g) => ({ ...g, enabled: false }));
    const toSave = reconcileBuiltins(existing);
    expect(toSave.length).toBe(0); // nothing to upsert
  });
});

describe("useOperatingGuides (localStorage backend)", () => {
  beforeEach(() => localStorage.clear());

  it("seeds the built-in guides on first load", async () => {
    const { result } = renderHook(() => useOperatingGuides({ config: null }));
    await waitFor(() => expect(result.current.guides.length).toBe(SEED_COUNT));
    expect(result.current.guides.some((g) => g.id === BUILTIN_GUIDE_ID)).toBe(true);
  });

  it("preserves a built-in's disabled toggle across reloads", async () => {
    const first = renderHook(() => useOperatingGuides({ config: null }));
    await waitFor(() => expect(first.result.current.guides.length).toBe(SEED_COUNT));
    const target = first.result.current.guides.find((g) => g.id === BUILTIN_GUIDE_ID)!;
    await act(async () => {
      await first.result.current.update({ ...target, enabled: false });
    });
    const second = renderHook(() => useOperatingGuides({ config: null }));
    await waitFor(() => expect(second.result.current.guides.length).toBe(SEED_COUNT));
    expect(second.result.current.guides.find((g) => g.id === BUILTIN_GUIDE_ID)?.enabled).toBe(false);
  });

  it("create adds a user guide", async () => {
    const { result } = renderHook(() => useOperatingGuides({ config: null }));
    await waitFor(() => expect(result.current.guides.length).toBe(SEED_COUNT));
    await act(async () => {
      await result.current.create("My Guide", "body");
    });
    expect(result.current.guides.some((g) => g.name === "My Guide" && !g.builtIn)).toBe(true);
  });

  it("remove refuses to delete any built-in", async () => {
    const { result } = renderHook(() => useOperatingGuides({ config: null }));
    await waitFor(() => expect(result.current.guides.length).toBe(SEED_COUNT));
    const featureId = BUILTIN_FEATURE_GUIDES[0].id;
    await act(async () => {
      await result.current.remove(BUILTIN_GUIDE_ID);
      await result.current.remove(featureId);
    });
    expect(result.current.guides.some((g) => g.id === BUILTIN_GUIDE_ID)).toBe(true);
    expect(result.current.guides.some((g) => g.id === featureId)).toBe(true);
  });
});

describe("useOperatingGuides — StrictMode mount re-set (§76)", () => {
  beforeEach(() => localStorage.clear());

  it("still applies the loaded guides after StrictMode's remount", async () => {
    // StrictMode mounts → unmounts → remounts. The mount effect's
    // `mountedRef.current = true` is what makes the flag true again by the time
    // `refresh()`'s promise resolves; with only the cleanup, every setGuides /
    // setReady below it is suppressed for good.
    //
    // Delete `mountedRef.current = true` from use-operating-guides.ts and this
    // test fails: `guides` stays [] and `ready` stays false.
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
    const { result } = renderHook(() => useOperatingGuides({ config: null }), {
      wrapper: StrictMode,
    });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.guides.length).toBe(SEED_COUNT);
  });
});
