// src/app/use-operating-guides.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useOperatingGuides } from "./use-operating-guides";
import { BUILTIN_GUIDE_ID } from "./operating-guide-builtin.generated";

describe("useOperatingGuides (localStorage backend)", () => {
  beforeEach(() => localStorage.clear());

  it("seeds the built-in guide on first load", async () => {
    const { result } = renderHook(() => useOperatingGuides({ config: null }));
    await waitFor(() => expect(result.current.guides.length).toBeGreaterThan(0));
    expect(result.current.guides.some((g) => g.id === BUILTIN_GUIDE_ID)).toBe(true);
  });

  it("does not re-seed once seeded (built-in edits persist)", async () => {
    const first = renderHook(() => useOperatingGuides({ config: null }));
    await waitFor(() => expect(first.result.current.guides.length).toBe(1));
    await act(async () => {
      await first.result.current.update({ ...first.result.current.guides[0], enabled: false });
    });
    const second = renderHook(() => useOperatingGuides({ config: null }));
    await waitFor(() => expect(second.result.current.guides.length).toBe(1));
    expect(second.result.current.guides[0].enabled).toBe(false);
  });

  it("create adds a user guide", async () => {
    const { result } = renderHook(() => useOperatingGuides({ config: null }));
    await waitFor(() => expect(result.current.guides.length).toBe(1));
    await act(async () => {
      await result.current.create("My Guide", "body");
    });
    expect(result.current.guides.some((g) => g.name === "My Guide" && !g.builtIn)).toBe(true);
  });

  it("remove refuses to delete the built-in", async () => {
    const { result } = renderHook(() => useOperatingGuides({ config: null }));
    await waitFor(() => expect(result.current.guides.length).toBe(1));
    await act(async () => {
      await result.current.remove(BUILTIN_GUIDE_ID);
    });
    expect(result.current.guides.some((g) => g.id === BUILTIN_GUIDE_ID)).toBe(true);
  });
});
