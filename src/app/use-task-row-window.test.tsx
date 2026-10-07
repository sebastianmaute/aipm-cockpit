import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Range } from "@tanstack/react-virtual";
import { StrictMode } from "react";
import { useTaskRowWindow, VIRTUALIZE_MIN_ROWS, withPinnedIndex } from "./use-task-row-window";

// jsdom has no layout, so the real virtualizer would compute an empty window.
// The mock returns a FIXED range (rows 10..29 of a 40px grid), passes it through
// the hook's range extractor as virtual-core does, and records the options it
// was called with, so these tests pin the hook's arithmetic and its threshold,
// not tanstack's range maths. Like virtual-core, row i starts at
// `paddingStart + i * ROW_PX` and the total size includes `paddingStart`.
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
  initialRect?: { width: number; height: number };
}
interface MockItem { index: number; start: number; end: number; size: number; key: number; lane: number }
let lastOptions: Opts | null = null;
// ONE instance across renders, as useVirtualizer's is. `itemSizeCache` is what a
// test says was measured; `measurementsCache` counts its reads, because walking
// it is the O(rows) snapshot that must not run on every windowed commit.
const instance = {
  itemSizeCache: new Map<number, number>(),
  measurementsReads: 0,
  allItems: [] as MockItem[],
  get measurementsCache(): MockItem[] {
    instance.measurementsReads++;
    return instance.allItems;
  },
  getVirtualItems: (): MockItem[] => [],
  getTotalSize: () => 0,
  scrollToIndex: scrollToIndexSpy,
  measureElement: measureElementSpy,
  // virtual-core's own snapshot walks the measurements too; counted the same way.
  takeSnapshot: (): MockItem[] => {
    instance.measurementsReads++;
    return instance.allItems.filter((it) => instance.itemSizeCache.has(it.key));
  },
};

vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
  ...actual,
  useVirtualizer: (opts: Opts) => {
    lastOptions = opts;
    const pad = opts.paddingStart ?? 0;
    const key = (i: number) => opts.getItemKey?.(i) ?? i;
    const at = (i: number): MockItem => ({ index: i, start: pad + i * ROW_PX, end: pad + (i + 1) * ROW_PX, size: ROW_PX, key: key(i), lane: 0 });
    instance.allItems = Array.from({ length: opts.count }, (_, i) => at(i));
    const indexes =
      opts.count > WINDOW_START
        ? (opts.rangeExtractor ?? actual.defaultRangeExtractor)({ startIndex: WINDOW_START, endIndex: Math.min(WINDOW_END, opts.count) - 1, overscan: 0, count: opts.count })
        : [];
    instance.getVirtualItems = () => indexes.map(at);
    instance.getTotalSize = () => pad + opts.count * ROW_PX;
    return instance;
  },
  };
});

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
  instance.itemSizeCache = new Map();
  instance.measurementsReads = 0;
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
    renderWindow(1000);
    instance.itemSizeCache = new Map([[1003, ROW_PX]]); // row 3 (task 1003) was measured
    setPrint(true);
    expect(lastOptions?.enabled).toBe(false);
    instance.itemSizeCache = new Map(); // what virtual-core does once it recomputes as off
    setPrint(false);
    expect(lastOptions?.enabled).toBe(true);
    expect(lastOptions?.initialMeasurementsCache).toEqual([{ index: 3, key: 1003, start: 120, size: ROW_PX, end: 160, lane: 0 }]);
  });

  test("walks the measurements only when the window switches off, not on every windowed commit", () => {
    const setPrint = stubPrintQuery();
    const { rerender } = renderWindow(1000);
    instance.itemSizeCache = new Map([[1003, ROW_PX]]);
    rerender();
    rerender();
    rerender();
    expect(instance.measurementsReads).toBe(0);
    setPrint(true);
    expect(instance.measurementsReads).toBe(1);
  });

  test("with nothing measured, switching off neither walks the measurements nor allocates a snapshot", () => {
    const setPrint = stubPrintQuery();
    renderWindow(1000);
    const before = lastOptions?.initialMeasurementsCache;
    setPrint(true);
    setPrint(false);
    expect(instance.measurementsReads).toBe(0);
    // The same shared empty list, so the setState bails out with no re-render.
    expect(lastOptions?.initialMeasurementsCache).toBe(before);
  });

  test("unmounting a windowed table does not walk the measurements (its setState would be dropped)", () => {
    stubPrintQuery();
    const { unmount } = renderWindow(1000);
    instance.itemSizeCache = new Map([[1003, ROW_PX]]);
    unmount();
    expect(instance.measurementsReads).toBe(0);
  });

  test("StrictMode's simulated unmount on mount does not walk the measurements either", () => {
    stubPrintQuery();
    instance.itemSizeCache = new Map([[1003, ROW_PX]]);
    const scrollRef = { current: document.createElement("div") };
    const ids = idsOf(1000);
    // ★ `wrapper: StrictMode` directly: StrictMode composed inside another wrapper
    // component does not double-invoke on mount (src/app/strictmode.meta.test.tsx).
    const { result } = renderHook(() => useTaskRowWindow({ ids, scrollRef, headRef: { current: null }, estimateRowPx: ROW_PX }), {
      wrapper: StrictMode,
    });
    expect(result.current.enabled).toBe(true);
    expect(instance.measurementsReads).toBe(0);
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

describe("useTaskRowWindow — the box's size survives the window turning back on (§5)", () => {
  // ★★ Switched off, virtual-core forgets the box's size too, and its default
  // (0 × 0) gives the first windowed render an empty range: every row unmounted
  // for a commit, a focused row and its inline-edit draft with them.
  test("initialRect reads the scroll box's live size when the virtualizer asks", () => {
    const box = document.createElement("div");
    renderHook(() => useTaskRowWindow({ ids: idsOf(1000), scrollRef: { current: box }, headRef: { current: null }, estimateRowPx: ROW_PX }));
    Object.defineProperty(box, "offsetHeight", { value: 640, configurable: true });
    Object.defineProperty(box, "offsetWidth", { value: 1200, configurable: true });
    expect(lastOptions?.initialRect?.height).toBe(640);
    expect(lastOptions?.initialRect?.width).toBe(1200);
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
    // Row 0 starts at the header's bottom edge, so the spacers stand in for the
    // skipped rows alone: the header's height is in neither of them.
    expect(result.current.items[0].padBefore).toBe(WINDOW_START * ROW_PX);
    expect(result.current.padBottom).toBe((1000 - WINDOW_END) * ROW_PX);
  });
});

describe("useTaskRowWindow — a focused row stays mounted outside the window (§5)", () => {
  // ★ Every node a test attaches is removed HERE, not at the end of the test
  // body: a failing assertion would otherwise skip the removal and leak a
  // focused input into the next test.
  const attached: Element[] = [];
  const attach = (...nodes: Element[]) => {
    document.body.append(...nodes);
    attached.push(...nodes);
  };
  afterEach(() => {
    attached.splice(0).forEach((n) => n.remove());
  });

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
    attach(box, outside);
    renderHook(() => useTaskRowWindow({ ids: idsOf(1000), scrollRef: { current: box }, headRef: { current: null }, estimateRowPx: ROW_PX }));
    // A window far below row 5: rows 400..419, plus overscan.
    const far: Range = { startIndex: 400, endIndex: 419, overscan: 10, count: 1000 };
    return { input, outside, far };
  }

  test("the range extractor keeps the focused row's index after it scrolls out of range", () => {
    const { input, far } = setup();
    expect(lastOptions!.rangeExtractor!(far)).not.toContain(5);
    act(() => input.focus());
    const indexes = lastOptions!.rangeExtractor!(far);
    expect(indexes[0]).toBe(5);
    expect(indexes.slice(1)).toEqual(range(390, 430));
  });

  test("keeps a row that ALREADY held focus when the list crosses the threshold", () => {
    // An inline edit open at 200 rows (VIRTUALIZE_MIN_ROWS), then a background write
    // pushes the list past the threshold: no focus event fires as the window turns on.
    const box = document.createElement("div");
    const row = document.createElement("div");
    row.setAttribute("data-deeplink-row", "1005"); // the task at index 5
    const input = document.createElement("input");
    row.appendChild(input);
    box.appendChild(row);
    attach(box);
    input.focus();
    const { result, rerender } = renderHook(
      ({ ids }) => useTaskRowWindow({ ids, scrollRef: { current: box }, headRef: { current: null }, estimateRowPx: ROW_PX }),
      { initialProps: { ids: idsOf(VIRTUALIZE_MIN_ROWS) } },
    );
    expect(result.current.enabled).toBe(false);
    rerender({ ids: idsOf(1000) });
    expect(result.current.enabled).toBe(true);
    // Row 5 is outside the mock's window (10..29): it is there because it holds focus.
    expect(result.current.items.map((it) => it.index)).toEqual([5, ...range(WINDOW_START, WINDOW_END)]);
    expect(result.current.items[0].padBefore).toBe(5 * ROW_PX);
    expect(result.current.items[1].padBefore).toBe((WINDOW_START - 6) * ROW_PX);
  });

  test("does not pin a row that was removed while focused (no focusout fires)", () => {
    const { input, far } = setup();
    act(() => input.focus());
    expect(lastOptions!.rangeExtractor!(far)).toContain(5);
    act(() => input.closest("tr")!.remove());
    expect(lastOptions!.rangeExtractor!(far)).not.toContain(5);
  });

  test("does not pin a focused row outside the scroll box", () => {
    const { far } = setup();
    const elsewhere = document.createElement("div");
    elsewhere.setAttribute("data-deeplink-row", "1005");
    const input = document.createElement("input");
    elsewhere.appendChild(input);
    attach(elsewhere);
    act(() => input.focus());
    expect(lastOptions!.rangeExtractor!(far)).not.toContain(5);
  });

  test("drops it once focus leaves the scroll box", () => {
    const { input, outside, far } = setup();
    act(() => input.focus());
    expect(lastOptions!.rangeExtractor!(far)).toContain(5);
    act(() => outside.focus());
    expect(lastOptions!.rangeExtractor!(far)).not.toContain(5);
  });
});
