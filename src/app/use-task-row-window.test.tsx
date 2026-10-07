import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTaskRowWindow, VIRTUALIZE_MIN_ROWS } from "./use-task-row-window";

// jsdom has no layout, so the real virtualizer would compute an empty window.
// The mock returns a FIXED window (rows 10..29 of a 40px grid) and records the
// options it was called with, so these tests pin the hook's arithmetic and its
// threshold, not tanstack's range maths.
const ROW_PX = 40;
const WINDOW_START = 10;
const WINDOW_END = 30; // exclusive
const scrollToIndexSpy = vi.fn();
const measureElementSpy = vi.fn();
let lastOptions: { count: number; enabled?: boolean; overscan?: number } | null = null;

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; enabled?: boolean; overscan?: number }) => {
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
    };
  },
}));

function run(count: number) {
  const scrollRef = { current: document.createElement("div") };
  return renderHook(() => useTaskRowWindow({ count, scrollRef, estimateRowPx: ROW_PX })).result.current;
}

beforeEach(() => {
  scrollToIndexSpy.mockReset();
  measureElementSpy.mockReset();
  lastOptions = null;
});

describe("useTaskRowWindow — the threshold", () => {
  test(`is off at exactly ${VIRTUALIZE_MIN_ROWS} rows: every row, no padding`, () => {
    const w = run(VIRTUALIZE_MIN_ROWS);
    expect(w).toMatchObject({ enabled: false, start: 0, end: VIRTUALIZE_MIN_ROWS, padTop: 0, padBottom: 0 });
    // The virtualizer is told it is off, so it attaches no scroll observer.
    expect(lastOptions?.enabled).toBe(false);
  });

  test(`is on at ${VIRTUALIZE_MIN_ROWS + 1} rows and reports the virtualizer's window`, () => {
    const count = VIRTUALIZE_MIN_ROWS + 1;
    const w = run(count);
    expect(w).toMatchObject({
      enabled: true,
      start: WINDOW_START,
      end: WINDOW_END,
      padTop: WINDOW_START * ROW_PX,
      padBottom: (count - WINDOW_END) * ROW_PX,
    });
    expect(lastOptions).toMatchObject({ enabled: true, overscan: 10, count });
  });
});

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
