import { renderHook, render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMediaQuery } from "./use-media-query";

let listeners: Array<() => void> = [];
let currentMatches = false;

beforeEach(() => {
  listeners = [];
  currentMatches = false;
  // jsdom has no matchMedia — install a controllable mock (mirrors use-theme.test.tsx).
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    // A real MediaQueryList.matches is live, not a snapshot — use a getter so it
    // reflects the controllable `currentMatches` at read time.
    get matches() {
      return currentMatches;
    },
    media: query,
    addEventListener: (_: string, cb: () => void) => listeners.push(cb),
    removeEventListener: (_: string, cb: () => void) => {
      listeners = listeners.filter((l) => l !== cb);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
});

describe("useMediaQuery", () => {
  it("returns the live match state after mount", () => {
    currentMatches = true;
    const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"));
    expect(result.current).toBe(true);
  });

  it("reacts when the media query changes", () => {
    const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"));
    expect(result.current).toBe(false);
    act(() => {
      currentMatches = true;
      listeners.forEach((l) => l());
    });
    expect(result.current).toBe(true);
  });

  it("reports the match on the very first render (no false→true flash)", () => {
    // A flash happens when the hook returns the SSR default (false) on the
    // first paint and only corrects after an effect. Record every render-phase
    // value: a flash-free hook reads the live value synchronously, so the first
    // recorded value is already correct.
    currentMatches = true;
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useMediaQuery("(max-width: 1023px)"));
      return null;
    }
    render(<Probe />);
    expect(seen[0]).toBe(true);
  });
});
