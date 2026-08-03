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
    // `thInTable` attaches its <table> to document.body so getComputedStyle can
    // resolve the layout mode. Without this they accumulate across the file, and
    // the moment this helper is reused in a suite that queries document-wide for
    // a <th> it becomes cross-test pollution.
    document.body.innerHTML = "";
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

  // ★★ The flex column renders AUTO — far wider than its declared default — so
  //    seeding the drag from the default snapped it narrow on the first
  //    mousemove before it tracked the pointer. jsdom reports every rect as 0,
  //    which is exactly the fallback path, so the measurement has to be stubbed
  //    or this can only ever exercise the old behaviour.
  /** A `<th>` with a stubbed rect, inside a table of the given layout mode. */
  function thInTable(layout: "fixed" | "auto", renderedWidth: number) {
    const table = document.createElement("table");
    table.style.tableLayout = layout;
    const th = document.createElement("th");
    th.getBoundingClientRect = () => ({ width: renderedWidth }) as DOMRect;
    const handle = document.createElement("span");
    th.appendChild(handle);
    table.appendChild(th);
    document.body.appendChild(table);
    return handle;
  }

  it("seeds the drag from the rendered width under table-layout: fixed", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useColumnResize("t8", DEFAULTS));
    const handle = thInTable("fixed", 640);

    const ev = { clientX: 100, preventDefault: () => {}, currentTarget: handle } as unknown as React.MouseEvent;
    act(() => { result.current.startColResize("a", ev); });
    act(() => { window.dispatchEvent(new MouseEvent("mousemove", { clientX: 150 })); });

    // 640 rendered + 50 moved. Seeding from DEFAULTS.a would give 250 — the
    // column would jump narrow before it started tracking the pointer.
    expect(result.current.sizedWidths.a).toBe(690);
  });

  // ★★★ THE SEED IS A RENDERED WIDTH BUT IT IS STORED AS A DECLARED ONE, and
  //     those agree only under `table-layout: fixed`. Measured in Chromium: an
  //     auto-layout column declared 100px whose content wants more renders at
  //     207, so seeding 207 and dragging LEFT 30 stores 177 — and the column
  //     then renders 297. The gesture meaning "narrower" made it WIDER, on all
  //     37 tables this hook serves that are NOT Open Points. Hence: measure only
  //     under fixed layout, else fall back to the declared width.
  it("ignores the rendered width under table-layout: auto, so a leftward drag narrows", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useColumnResize("t10", DEFAULTS));
    // Rendered far wider than the 100px default — the regression case.
    const handle = thInTable("auto", 640);

    const ev = { clientX: 100, preventDefault: () => {}, currentTarget: handle } as unknown as React.MouseEvent;
    act(() => { result.current.startColResize("a", ev); });
    act(() => { window.dispatchEvent(new MouseEvent("mousemove", { clientX: 70 })); });

    // Declared 100 − 30 dragged = 70. Seeding from the rendered 640 would store
    // 610 — SIX times what the user dragged to, and wider than where it started.
    expect(result.current.sizedWidths.a).toBe(70);
  });

  it("falls back to the declared width when there is no <th> to measure", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useColumnResize("t9", DEFAULTS));

    const orphan = document.createElement("span"); // no <th> ancestor
    const ev = { clientX: 100, preventDefault: () => {}, currentTarget: orphan } as unknown as React.MouseEvent;
    act(() => { result.current.startColResize("a", ev); });
    act(() => { window.dispatchEvent(new MouseEvent("mousemove", { clientX: 150 })); });

    expect(result.current.sizedWidths.a).toBe(DEFAULTS.a + 50);
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
    // ★ NOT included: `undefined`. JSON.stringify DROPS an undefined value, so
    //   the key never reaches the payload and the case would pass with
    //   `usableWidths` deleted entirely — vacuous.
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
