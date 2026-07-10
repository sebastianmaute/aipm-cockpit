import { describe, expect, test, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { clampOffset, useDraggable } from "./use-draggable";

describe("clampOffset", () => {
  // viewport 1000x800; panel rect at left=300 top=100 w=400 h=500.
  const vp = { w: 1000, h: 800 };
  const rect = { left: 300, top: 100, width: 400, height: 500 };

  test("passes through an offset that keeps the panel on-screen", () => {
    expect(clampOffset({ x: 50, y: 50 }, rect, vp)).toEqual({ x: 50, y: 50 });
  });

  test("clamps leftward drag so the panel's right edge keeps a margin on screen", () => {
    const out = clampOffset({ x: -10000, y: 0 }, rect, vp);
    expect(rect.left + out.x).toBeLessThan(0); // moved left
    expect(rect.left + rect.width + out.x).toBeGreaterThanOrEqual(24); // still grabbable
  });

  test("clamps upward drag so the header stays at least a margin below the top edge", () => {
    const out = clampOffset({ x: 0, y: -10000 }, rect, vp);
    expect(rect.top + out.y).toBeGreaterThanOrEqual(24);
  });

  test("clamps downward drag so the header stays above the bottom edge", () => {
    const out = clampOffset({ x: 0, y: 10000 }, rect, vp);
    expect(rect.top + out.y).toBeLessThanOrEqual(vp.h - 24);
  });
});

describe("useDraggable persistence (storageKey)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("initializes the offset from a valid persisted value", () => {
    window.localStorage.setItem("k", JSON.stringify({ x: 12, y: 34 }));
    const { result } = renderHook(() => useDraggable(true, "k"));
    expect(result.current.offset).toEqual({ x: 12, y: 34 });
  });

  test("falls back to {0,0} for missing or garbage storage", () => {
    window.localStorage.setItem("bad", "not json");
    const { result } = renderHook(() => useDraggable(true, "bad"));
    expect(result.current.offset).toEqual({ x: 0, y: 0 });
  });

  test("reset recenters and clears the persisted entry", () => {
    window.localStorage.setItem("k", JSON.stringify({ x: 5, y: 5 }));
    const { result } = renderHook(() => useDraggable(true, "k"));
    act(() => result.current.reset());
    expect(result.current.offset).toEqual({ x: 0, y: 0 });
    expect(window.localStorage.getItem("k")).toBeNull();
  });

  test("without a storageKey the offset stays {0,0} and nothing persists", () => {
    const { result } = renderHook(() => useDraggable(true));
    expect(result.current.offset).toEqual({ x: 0, y: 0 });
    act(() => result.current.reset());
    expect(result.current.offset).toEqual({ x: 0, y: 0 });
    expect(window.localStorage.length).toBe(0);
  });
});
