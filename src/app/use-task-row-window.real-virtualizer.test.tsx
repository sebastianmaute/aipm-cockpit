import { describe, test, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Virtualizer, defaultRangeExtractor, elementScroll, observeElementOffset, observeElementRect } from "@tanstack/react-virtual";
import { liveBoxRect, measuredRows, useTaskRowWindow, type TaskRowWindow } from "./use-task-row-window";

// ★★ NO MOCK in this file. use-task-row-window.test.tsx mocks `useVirtualizer`,
// so it cannot see the virtual-core behaviour the §5 draft-loss fix leans on,
// none of it documented API:
//  - switched off, the virtualizer CLEARS `itemSizeCache`/`measurementsCache`,
//    and does so in its own layout effect (`_willUpdate` → `getMeasurements`
//    with `enabled: false`), i.e. AFTER the hook's layout-effect cleanup reads
//    them;
//  - switched back on, its private `getSize()` falls back to `initialRect` until its
//    observer reports, so the first windowed range comes from the hook's live
//    box size.
// It imports through `@tanstack/react-virtual`, which re-exports virtual-core, so it
// runs the same module instance as the hook. It runs in CI's unit job; the PERF-gated
// probe (e2e/perf-task-table.spec.ts), the only real-browser check, does not, so run
// that by hand on any `@tanstack/*` version change.

const ROW_PX = 45;
const COUNT = 1000;
const idsOf = (count: number) => Array.from({ length: count }, (_, i) => 1000 + i);
const boxes: HTMLElement[] = [];

afterEach(() => {
  boxes.splice(0).forEach((b) => b.remove());
});

/** A scroll box with a layout jsdom does not have: a fixed size and a writable scrollTop. */
function makeBox(height = 600): HTMLDivElement {
  const box = document.createElement("div");
  Object.defineProperty(box, "offsetHeight", { value: height, configurable: true });
  Object.defineProperty(box, "offsetWidth", { value: 800, configurable: true });
  Object.defineProperty(box, "scrollTop", { value: 0, configurable: true, writable: true });
  document.body.append(box);
  boxes.push(box);
  return box;
}

/** The options `useTaskRowWindow` hands `useVirtualizer` (which adds the three
 *  element observers below), minus `enabled`. */
function hookOptions(box: HTMLElement) {
  const ids = idsOf(COUNT);
  const scrollRef = { current: box };
  return {
    count: COUNT,
    getScrollElement: () => box,
    estimateSize: () => ROW_PX,
    overscan: 10,
    getItemKey: (i: number) => ids[i] ?? i,
    rangeExtractor: defaultRangeExtractor,
    paddingStart: 0,
    initialRect: liveBoxRect(scrollRef),
    initialOffset: () => box.scrollTop,
    initialMeasurementsCache: [],
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
  };
}

describe("virtual-core as useTaskRowWindow drives it (§5, no mock)", () => {
  test("switched off, the measurements survive until the virtualizer's own layout effect, then are cleared", () => {
    const box = makeBox();
    const base = hookOptions(box);
    const v = new Virtualizer<HTMLElement, Element>({ ...base, enabled: true });
    v._willUpdate(); // useVirtualizer's layout effect, on mount
    v.getVirtualItems(); // the windowed render
    v.resizeItem(3, 100);
    v.resizeItem(4, 120);
    v.getVirtualItems(); // the next windowed render
    // The render that switches the window off: useVirtualizer calls setOptions.
    v.setOptions({ ...base, enabled: false });
    // ← the hook's layout-effect CLEANUP runs here, before any layout effect.
    const snapshot = measuredRows(v);
    expect(snapshot.map((it) => [it.key, it.size])).toEqual([
      [1003, 100],
      [1004, 120],
    ]);
    // useVirtualizer's layout effect: recomputes as off, which clears both caches.
    v._willUpdate();
    expect(v.itemSizeCache.size).toBe(0);
    expect(v.measurementsCache).toHaveLength(0);
    // So a snapshot read after it would hand back nothing.
    expect(measuredRows(v)).toEqual([]);
  });

  test("switched back on, the first range comes from the live box size and keeps the measured heights", () => {
    const box = makeBox();
    const base = hookOptions(box);
    const v = new Virtualizer<HTMLElement, Element>({ ...base, enabled: true });
    v._willUpdate();
    v.getVirtualItems();
    v.resizeItem(3, 100);
    v.setOptions({ ...base, enabled: false });
    const snapshot = measuredRows(v);
    v._willUpdate();
    expect(v.scrollRect).toBeNull(); // off: the box size is forgotten
    // The box changed size while the window was off.
    Object.defineProperty(box, "offsetHeight", { value: 500, configurable: true });
    v.setOptions({ ...base, enabled: true, initialMeasurementsCache: snapshot });
    // The first windowed render, before `_willUpdate` attaches the rect observer.
    const first = v.getVirtualItems();
    // `getSize()` (private) fell back to initialRect and stored it as scrollRect.
    expect(v.scrollRect?.height).toBe(500);
    expect(first.length).toBeGreaterThan(0);
    expect(first[0].index).toBe(0);
    expect(v.itemSizeCache.get(1003)).toBe(100);
    expect(v.measurementsCache[4].start).toBe(3 * ROW_PX + 100);
  });

  test("control: with virtual-core's default initialRect that first range is EMPTY", () => {
    // Proves the test above can tell the two apart.
    // An undefined option takes virtual-core's default, here { width: 0, height: 0 }.
    const v = new Virtualizer<HTMLElement, Element>({ ...hookOptions(makeBox()), initialRect: undefined, enabled: true });
    expect(v.getVirtualItems()).toEqual([]);
  });

  test("measuredRows reports the measured size, not a stale estimate in measurementsCache", () => {
    const box = makeBox();
    const v = new Virtualizer<HTMLElement, Element>({ ...hookOptions(box), enabled: true });
    v._willUpdate();
    v.getVirtualItems();
    // Measured after the last recompute: measurementsCache still says ROW_PX.
    v.resizeItem(2, 90);
    expect(v.measurementsCache[2].size).toBe(ROW_PX);
    expect(measuredRows(v)).toEqual([{ index: 2, key: 1002, start: 2 * ROW_PX, size: 90, end: 2 * ROW_PX + 90, lane: 0 }]);
  });

  test("measuredRows hands back one shared empty list when nothing was measured", () => {
    const a = new Virtualizer<HTMLElement, Element>({ ...hookOptions(makeBox()), enabled: true });
    const b = new Virtualizer<HTMLElement, Element>({ ...hookOptions(makeBox()), enabled: false });
    a.getVirtualItems();
    expect(measuredRows(a)).toHaveLength(0);
    expect(measuredRows(a)).toBe(measuredRows(b));
  });
});

describe("useTaskRowWindow over the real virtualizer (§5, no mock)", () => {
  test("a threshold round trip (above 200, below, above again) keeps the measured heights and renders rows on its first windowed commit", () => {
    const box = makeBox();
    const scrollRef = { current: box };
    const headRef = { current: null };
    const renders: TaskRowWindow[] = [];
    const { result, rerender } = renderHook(
      ({ ids }) => {
        const w = useTaskRowWindow({ ids, scrollRef, headRef, estimateRowPx: ROW_PX });
        renders.push(w);
        return w;
      },
      { initialProps: { ids: idsOf(COUNT) } },
    );
    expect(result.current.enabled).toBe(true);
    // Rows 0..4 render 100px tall, against the 45px estimate.
    act(() => {
      for (let i = 0; i < 5; i++) {
        const tr = document.createElement("tr");
        tr.setAttribute("data-index", String(i));
        Object.defineProperty(tr, "offsetHeight", { value: 100, configurable: true });
        result.current.measure(tr);
      }
    });
    // The reader scrolls well below them, then the list dips under the threshold
    // (the same off/on cycle a print takes) and comes back.
    box.scrollTop = 5000;
    rerender({ ids: idsOf(150) });
    expect(result.current.enabled).toBe(false);
    const mark = renders.length;
    rerender({ ids: idsOf(COUNT) });
    const firstOn = renders[mark];
    expect(firstOn.enabled).toBe(true);
    // Not an empty range: the rows (and a focused draft among them) stay mounted.
    expect(firstOn.items.length).toBeGreaterThan(0);
    // The spacer above the window counts rows 0..4 at their measured 100px; with
    // the measurements lost it would be index × 45.
    const { index, padBefore } = result.current.items[0];
    expect(index).toBeGreaterThan(5);
    expect(padBefore).toBe(5 * 100 + (index - 5) * ROW_PX);
  });
});
