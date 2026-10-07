import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Range } from "@tanstack/react-virtual";
import { useTaskRowWindow, VIRTUALIZE_MIN_ROWS, withPinnedIndex } from "./use-task-row-window";

// jsdom has no layout, so the real virtualizer would compute an empty window.
// The mock returns a FIXED window (rows 10..29 of a 40px grid) and records the
// options it was called with, so these tests pin the hook's arithmetic and its
// threshold, not tanstack's range maths.
const ROW_PX = 40;
const WINDOW_START = 10;
const WINDOW_END = 30; // exclusive
const scrollToIndexSpy = vi.fn();
const measureElementSpy = vi.fn();
interface Opts {
  count: number;
  enabled?: boolean;
  overscan?: number;
  paddingStart?: number;
  initialOffset?: () => number;
  getItemKey?: (i: number) => number;
  rangeExtractor?: (r: Range) => number[];
  initialMeasurementsCache?: unknown[];
}
// What the mock's takeSnapshot returns: the measurements a windowed commit saw.
const snapshot = { value: [] as unknown[] };
let lastOptions: Opts | null = null;

vi.mock("@tanstack/react-virtual", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-virtual")>()),
  useVirtualizer: (opts: Opts) => {
    lastOptions = opts;
    const end = Math.min(WINDOW_END, opts.count);
    const items: { index: number; start: number; end: number; size: number; key: number; lane: number }[] = [];
    for (let i = WINDOW_START; i < end; i++) {
      items.push({ index: i, start: i * ROW_PX, end: (i + 1) * ROW_PX, size: ROW_PX, key: i, lane: 0 });
    }
    return {
      getVirtualItems: () => items,
      getTotalSize: () => opts.count * ROW_PX,
      scrollToIndex: scrollToIndexSpy,
      measureElement: measureElementSpy,
      takeSnapshot: () => snapshot.value,
    };
  },
}));

const idsOf = (count: number) => Array.from({ length: count }, (_, i) => 1000 + i);

function run(count: number) {
  const scrollRef = { current: document.createElement("div") };
  const headRef = { current: null };
  const ids = idsOf(count);
  return renderHook(() => useTaskRowWindow({ ids, scrollRef, headRef, estimateRowPx: ROW_PX })).result.current;
}

beforeEach(() => {
  scrollToIndexSpy.mockReset();
  measureElementSpy.mockReset();
  lastOptions = null;
});

describe("useTaskRowWindow — the threshold", () => {
  test(`is off at exactly ${VIRTUALIZE_MIN_ROWS} rows: every row, no padding`, () => {
    const w = run(VIRTUALIZE_MIN_ROWS);
    expect(w).toMatchObject({ enabled: false, items: [], padBottom: 0 });
    // The virtualizer is told it is off, so it attaches no scroll observer.
    expect(lastOptions?.enabled).toBe(false);
  });

  test(`is on at ${VIRTUALIZE_MIN_ROWS + 1} rows and reports the virtualizer's window`, () => {
    const count = VIRTUALIZE_MIN_ROWS + 1;
    const w = run(count);
    expect(w.enabled).toBe(true);
    expect(w.items.map((it) => it.index)).toEqual(range(WINDOW_START, WINDOW_END));
    // One leading spacer for the skipped rows, none between window rows.
    expect(w.items.map((it) => it.padBefore)).toEqual([WINDOW_START * ROW_PX, ...Array(WINDOW_END - WINDOW_START - 1).fill(0)]);
    expect(w.padBottom).toBe((count - WINDOW_END) * ROW_PX);
    expect(lastOptions).toMatchObject({ enabled: true, overscan: 10, count });
  });
});

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, k) => from + k);
}

describe("useTaskRowWindow — scrollToIndex and measure", () => {
  test("scrollToIndex centres the row through the virtualizer when on", () => {
    run(1000).scrollToIndex(899);
    expect(scrollToIndexSpy).toHaveBeenCalledWith(899, { align: "center" });
  });

  test("scrollToIndex is a no-op when off (the row is already in the DOM)", () => {
    run(50).scrollToIndex(10);
    expect(scrollToIndexSpy).not.toHaveBeenCalled();
  });

  test("measure forwards to the virtualizer's measureElement when on, and not when off", () => {
    const el = document.createElement("tr");
    run(1000).measure(el);
    expect(measureElementSpy).toHaveBeenCalledWith(el);
    measureElementSpy.mockReset();
    run(50).measure(el);
    expect(measureElementSpy).not.toHaveBeenCalled();
  });
});

describe("useTaskRowWindow — printing renders every row (§5)", () => {
  // jsdom has no matchMedia; stub one whose "print" query can flip and notify.
  function stubPrintQuery() {
    const listeners = new Set<() => void>();
    const printMql = {
      matches: false,
      media: "print",
      addEventListener: (_type: string, l: () => void) => listeners.add(l),
      removeEventListener: (_type: string, l: () => void) => listeners.delete(l),
    };
    const otherMql = { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
    vi.stubGlobal("matchMedia", (q: string) => (q === "print" ? printMql : otherMql));
    return (matches: boolean) => {
      printMql.matches = matches;
      act(() => listeners.forEach((l) => l()));
    };
  }

  function renderWindow(count: number) {
    const scrollRef = { current: document.createElement("div") };
    const headRef = { current: null };
    const ids = idsOf(count);
    return renderHook(() => useTaskRowWindow({ ids, scrollRef, headRef, estimateRowPx: ROW_PX }));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("disables the window while the print media query matches", () => {
    const setPrint = stubPrintQuery();
    const { result } = renderWindow(1000);
    expect(result.current.enabled).toBe(true);
    setPrint(true);
    expect(result.current).toMatchObject({ enabled: false, items: [], padBottom: 0 });
    // The virtualizer is switched off too, not merely ignored.
    expect(lastOptions?.enabled).toBe(false);
    setPrint(false);
    expect(result.current.enabled).toBe(true);
    expect(result.current.items[0].index).toBe(WINDOW_START);
  });

  test("disables the window between beforeprint and afterprint (the Electron print path)", () => {
    stubPrintQuery();
    const { result } = renderWindow(1000);
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(result.current).toMatchObject({ enabled: false, items: [] });
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(result.current.enabled).toBe(true);
  });

  test("turns back on with the heights it measured before the print, not with none", () => {
    // ★ A virtualizer switched off clears its measurements; this hands them back
    // as initialMeasurementsCache so the same scroll offset maps to the same row.
    const setPrint = stubPrintQuery();
    const heights = [{ index: 3, key: 1003, start: 120, size: 90, end: 210, lane: 0 }];
    snapshot.value = heights;
    try {
      renderWindow(1000);
      setPrint(true);
      expect(lastOptions?.enabled).toBe(false);
      snapshot.value = []; // nothing measured while off must not overwrite them
      setPrint(false);
      expect(lastOptions?.enabled).toBe(true);
      expect(lastOptions?.initialMeasurementsCache).toBe(heights);
    } finally {
      snapshot.value = [];
    }
  });

  test("is already off when it mounts during a print", () => {
    const setPrint = stubPrintQuery();
    setPrint(true);
    expect(renderWindow(1000).result.current.enabled).toBe(false);
  });
});

describe("useTaskRowWindow — the scroll offset survives the window turning back on (§5)", () => {
  // ★ While off, virtual-core nulls its scroll offset; when it turns back on it
  // scrolls the box to `initialOffset()`. The default is 0, which jumped the
  // table to the top after every print. The e2e probe pins the jump itself.
  test("initialOffset reads the scroll box's live scrollTop", () => {
    const box = document.createElement("div");
    const scrollRef = { current: box };
    renderHook(() => useTaskRowWindow({ ids: idsOf(1000), scrollRef, headRef: { current: null }, estimateRowPx: ROW_PX }));
    Object.defineProperty(box, "scrollTop", { value: 4321, configurable: true });
    expect(lastOptions?.initialOffset?.()).toBe(4321);
  });
});

describe("useTaskRowWindow — measurements follow the task, not the index (§5)", () => {
  test("getItemKey maps a list index to that row's task id", () => {
    run(1000);
    expect(lastOptions?.getItemKey?.(0)).toBe(1000);
    expect(lastOptions?.getItemKey?.(999)).toBe(1999);
  });
});

describe("useTaskRowWindow — the header height is the virtualizer's paddingStart (§5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("passes the measured <thead> height, and spacers start below it", () => {
    let fire: (() => void) | null = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          fire = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    const head = document.createElement("thead");
    Object.defineProperty(head, "offsetHeight", { value: 52, configurable: true });
    const { result } = renderHook(() =>
      useTaskRowWindow({ ids: idsOf(1000), scrollRef: { current: document.createElement("div") }, headRef: { current: head }, estimateRowPx: ROW_PX }),
    );
    expect(lastOptions?.paddingStart).toBe(0);
    act(() => fire!());
    expect(lastOptions?.paddingStart).toBe(52);
    // The mock's items start at WINDOW_START * ROW_PX regardless, so the leading
    // spacer is measured from the header's bottom edge, not from 0.
    expect(result.current.items[0].padBefore).toBe(WINDOW_START * ROW_PX - 52);
  });
});

describe("useTaskRowWindow — a focused row stays mounted outside the window (§5)", () => {
  test("withPinnedIndex adds the pinned index in order, and leaves the range alone otherwise", () => {
    expect(withPinnedIndex([10, 11, 12], 3)).toEqual([3, 10, 11, 12]);
    expect(withPinnedIndex([10, 11, 12], 40)).toEqual([10, 11, 12, 40]);
    expect(withPinnedIndex([10, 11, 12], 11)).toEqual([10, 11, 12]);
    expect(withPinnedIndex([10, 11, 12], -1)).toEqual([10, 11, 12]);
  });

  function setup() {
    const box = document.createElement("div");
    const outside = document.createElement("button");
    const table = document.createElement("table");
    const tbody = document.createElement("tbody");
    const row = document.createElement("tr");
    row.setAttribute("data-deeplink-row", "1005"); // the task at index 5
    const td = document.createElement("td");
    const input = document.createElement("input");
    td.appendChild(input);
    row.appendChild(td);
    tbody.appendChild(row);
    table.appendChild(tbody);
    box.appendChild(table);
    document.body.append(box, outside);
    renderHook(() => useTaskRowWindow({ ids: idsOf(1000), scrollRef: { current: box }, headRef: { current: null }, estimateRowPx: ROW_PX }));
    // A window far below row 5: rows 400..419, plus overscan.
    const far: Range = { startIndex: 400, endIndex: 419, overscan: 10, count: 1000 };
    const cleanup = () => {
      box.remove();
      outside.remove();
    };
    return { input, outside, far, cleanup };
  }

  test("the range extractor keeps the focused row's index after it scrolls out of range", () => {
    const { input, far, cleanup } = setup();
    expect(lastOptions!.rangeExtractor!(far)).not.toContain(5);
    act(() => input.focus());
    const indexes = lastOptions!.rangeExtractor!(far);
    expect(indexes[0]).toBe(5);
    expect(indexes.slice(1)).toEqual(range(390, 430));
    cleanup();
  });

  test("drops it once focus leaves the scroll box", () => {
    const { input, outside, far, cleanup } = setup();
    act(() => input.focus());
    expect(lastOptions!.rangeExtractor!(far)).toContain(5);
    act(() => outside.focus());
    expect(lastOptions!.rangeExtractor!(far)).not.toContain(5);
    cleanup();
  });
});
