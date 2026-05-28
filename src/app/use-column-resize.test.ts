import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useColumnResize } from "./use-column-resize";

const KEY = (id: string) => `lop-app:col-widths:${id}`;

const DEFAULTS = { a: 100, b: 200 } as const;

describe("useColumnResize", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns defaults when localStorage is empty", () => {
    const { result } = renderHook(() => useColumnResize("t1", DEFAULTS));
    expect(result.current.colWidths).toEqual(DEFAULTS);
  });

  it("merges persisted widths over defaults (extras ignored, missing filled)", async () => {
    localStorage.setItem(KEY("t1"), JSON.stringify({ a: 333, x: 999 }));
    const { result } = renderHook(() => useColumnResize("t1", DEFAULTS));
    await act(async () => {});
    expect(result.current.colWidths.a).toBe(333);
    expect(result.current.colWidths.b).toBe(200);
  });

  it("resize updates state and clamps to 40 px min", () => {
    const { result } = renderHook(() => useColumnResize("t1", DEFAULTS));
    const ev = { clientX: 100, preventDefault: () => {} } as unknown as React.MouseEvent;
    act(() => {
      result.current.startColResize("a", ev);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 50 }));
    });
    expect(result.current.colWidths.a).toBe(50);
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: -200 }));
    });
    expect(result.current.colWidths.a).toBe(40);
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
  });

  it("reset replaces state with defaults and removes the namespaced key", async () => {
    localStorage.setItem(KEY("t1"), JSON.stringify({ a: 999 }));
    const { result } = renderHook(() => useColumnResize("t1", DEFAULTS));
    await act(async () => {});
    act(() => {
      result.current.resetColWidths();
    });
    expect(result.current.colWidths).toEqual(DEFAULTS);
    expect(localStorage.getItem(KEY("t1"))).toBeNull();
  });

  it("two different tableIds use independent storage keys", async () => {
    localStorage.setItem(KEY("a1"), JSON.stringify({ a: 111 }));
    localStorage.setItem(KEY("a2"), JSON.stringify({ a: 222 }));
    const r1 = renderHook(() => useColumnResize("a1", DEFAULTS));
    const r2 = renderHook(() => useColumnResize("a2", DEFAULTS));
    await act(async () => {});
    expect(r1.result.current.colWidths.a).toBe(111);
    expect(r2.result.current.colWidths.a).toBe(222);
  });

  it("persists colWidths to the namespaced key after 250 ms debounce", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useColumnResize("t1", DEFAULTS));
    await act(async () => { vi.runAllTimers(); });
    localStorage.removeItem(KEY("t1"));

    const ev = { clientX: 100, preventDefault: () => {} } as unknown as React.MouseEvent;
    act(() => {
      result.current.startColResize("a", ev);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 200 }));
    });
    expect(localStorage.getItem(KEY("t1"))).toBeNull();

    act(() => { vi.advanceTimersByTime(250); });
    const stored = JSON.parse(localStorage.getItem(KEY("t1")) ?? "{}") as Record<string, number>;
    expect(stored.a).toBe(200);
  });
});
