import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion, REDUCED_MOTION_QUERY, smoothScrollBehavior } from "./reduced-motion";

function stubMatchMedia(reduce: boolean) {
  const matchMedia = vi.fn((query: string) => ({ matches: reduce && query === REDUCED_MOTION_QUERY }));
  vi.stubGlobal("matchMedia", matchMedia);
  return matchMedia;
}

describe("reduced-motion (open-followups §332)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scrolls smoothly when the user has not asked for reduced motion", () => {
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(smoothScrollBehavior()).toBe("smooth");
  });

  it("jumps instantly under prefers-reduced-motion: reduce", () => {
    const mm = stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(smoothScrollBehavior()).toBe("auto");
    expect(mm).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
  });

  it("reads the preference at call time, not once at load", () => {
    stubMatchMedia(false);
    expect(smoothScrollBehavior()).toBe("smooth");
    stubMatchMedia(true);
    expect(smoothScrollBehavior()).toBe("auto");
  });

  it("falls back to smooth where matchMedia does not exist", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
    expect(smoothScrollBehavior()).toBe("smooth");
  });
});
