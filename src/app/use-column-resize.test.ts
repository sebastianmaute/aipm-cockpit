import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useColumnResize } from "./use-column-resize";

const KEY = (id: string) => `aipm-cockpit:col-widths:${id}`;

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

  it("persists sizedWidths to the namespaced key after 250 ms debounce", async () => {
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
    const stored = JSON.parse(localStorage.getItem(KEY("t1")) ?? "{}") as { widths?: Record<string, number> };
    expect(stored.widths?.a).toBe(200);
  });

  it("persists a v2 payload holding only dragged keys", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useColumnResize("t2", DEFAULTS));

    const ev = { clientX: 100, preventDefault: () => {} } as unknown as React.MouseEvent;
    act(() => { result.current.startColResize("a", ev); });
    act(() => { window.dispatchEvent(new MouseEvent("mousemove", { clientX: 180 })); });
    act(() => { window.dispatchEvent(new MouseEvent("mouseup")); });
    act(() => { vi.advanceTimersByTime(300); });

    const raw = JSON.parse(localStorage.getItem(KEY("t2")) as string) as { v?: number; widths?: Record<string, number> };
    expect(raw.v).toBe(2);
    // Only "a" was dragged. "b" must NOT be written, or a future change to its
    // default would be permanently masked for this user.
    expect(Object.keys(raw.widths ?? {})).toEqual(["a"]);
    expect(raw.widths?.a).toBe(180);
  });

  it("exposes sizedWidths as the raw user-set map, with colWidths still merged", async () => {
    localStorage.setItem(KEY("t3"), JSON.stringify({ v: 2, widths: { a: 333 } }));
    const { result } = renderHook(() => useColumnResize("t3", DEFAULTS));
    await act(async () => {});

    expect(result.current.sizedWidths).toEqual({ a: 333 });
    expect(result.current.sizedWidths.b).toBeUndefined();
    // Unchanged public contract: colWidths is still every key, defaults filled.
    expect(result.current.colWidths).toEqual({ a: 333, b: 200 });
  });

  it("still reads a v1 bare-object payload (other tables keep their widths)", async () => {
    localStorage.setItem(KEY("t4"), JSON.stringify({ a: 333, x: 999 }));
    const { result } = renderHook(() => useColumnResize("t4", DEFAULTS));
    await act(async () => {});
    expect(result.current.colWidths.a).toBe(333);
    expect(result.current.colWidths.b).toBe(200);
    // A v1 blob cannot distinguish dragged from default, so every key it holds
    // counts as user-set. That is the conservative direction: it preserves the
    // user's widths rather than silently discarding them.
    expect(result.current.sizedWidths.a).toBe(333);
  });

  // ★ The payload is NOT durably removed: the debounced effect re-runs on the
  //   state change and writes `{v:2,widths:{}}` back 250ms later. Asserting only
  //   the null would pin a transient state. Both are checked here, so the test
  //   describes what actually happens rather than the first 249ms of it.
  it("reset empties sizedWidths, and the payload returns empty rather than absent", async () => {
    vi.useFakeTimers();
    localStorage.setItem(KEY("t5"), JSON.stringify({ v: 2, widths: { a: 333 } }));
    const { result } = renderHook(() => useColumnResize("t5", DEFAULTS));
    await act(async () => {});
    act(() => { result.current.resetColWidths(); });

    expect(result.current.sizedWidths).toEqual({});
    expect(result.current.colWidths).toEqual(DEFAULTS);
    expect(localStorage.getItem(KEY("t5"))).toBeNull();

    act(() => { vi.advanceTimersByTime(250); });
    expect(JSON.parse(localStorage.getItem(KEY("t5")) as string)).toEqual({ v: 2, widths: {} });
  });

  // ★★ A non-numeric or nonsensical stored width now costs more than a weird
  //    column: it reaches `colWidthStyle`, is emitted as an inline `width`, the
  //    browser discards the invalid value, and that column falls back to AUTO —
  //    a SECOND auto column, which defeats the single-flex-column invariant the
  //    Open Points geometry rests on. It also turns `tableMinWidthPx`'s running
  //    sum into a string. Neither is visible in jsdom.
  it.each([
    ["a string", "220"],
    ["null", null],
    ["a nested object", { px: 220 }],
    ["NaN-by-JSON (absent number)", undefined],
    ["zero", 0],
    ["a negative", -40],
  ] as const)("drops %s from the stored widths", async (_label, bad) => {
    localStorage.setItem(KEY("t7"), JSON.stringify({ v: 2, widths: { a: bad, b: 150 } }));
    const { result } = renderHook(() => useColumnResize("t7", DEFAULTS));
    await act(async () => {});

    expect(result.current.sizedWidths.a).toBeUndefined();
    // The good sibling survives — this drops the bad ENTRY, not the payload.
    expect(result.current.sizedWidths.b).toBe(150);
    expect(result.current.colWidths.a).toBe(DEFAULTS.a);
  });

  // ★ An unrecognised version must NOT fall through to the v1 branch: a future
  //   `{v:3,widths:{…}}` spread verbatim would put a numeric `v` and an
  //   object-valued `widths` into a Record<TId, number>, and on into colWidths.
  it.each([3, "2", null] as const)("treats an unrecognised version (%o) as no user widths", async (v) => {
    localStorage.setItem(KEY("t6"), JSON.stringify({ v, widths: { a: 333 } }));
    const { result } = renderHook(() => useColumnResize("t6", DEFAULTS));
    await act(async () => {});

    expect(result.current.sizedWidths).toEqual({});
    expect(result.current.colWidths).toEqual(DEFAULTS);
  });
});
