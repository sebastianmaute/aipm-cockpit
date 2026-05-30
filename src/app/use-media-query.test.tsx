import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMediaQuery } from "./use-media-query";

let listeners: Array<() => void> = [];
let currentMatches = false;

beforeEach(() => {
  listeners = [];
  currentMatches = false;
  // jsdom has no matchMedia — install a controllable mock (mirrors use-theme.test.tsx).
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: currentMatches,
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
});
