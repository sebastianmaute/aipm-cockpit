"use client";
// src/app/use-task-row-window.ts — which Open Points rows to render (§5).
//
// Above VIRTUALIZE_MIN_ROWS visible rows the table renders only a window of
// rows near the viewport, with spacer rows whose heights stand in for the rows
// it skipped. At or below the threshold the hook reports "off" and the table
// renders exactly as it did before virtualization.
//
// `@tanstack/react-virtual` is headless: it computes the indices and sizes and
// renders nothing, so the table keeps its semantic <table>/<tbody>/<tr>
// markup, its sticky header and its <colgroup> widths.
//
// ★ Called from `TasksTable` (tasks-section-rows.tsx), NOT from the pane
// orchestrator: the virtualizer re-renders its caller on every scroll step
// (synchronously, through flushSync), so the caller must be the table alone.
//
// Coverage-GATED: a .ts file that vitest.config.ts's coverage `exclude` does not
// list, so the global floors count it. Pinned by use-task-row-window.test.tsx.
import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { defaultRangeExtractor, useVirtualizer, type Range, type Rect, type Virtualizer, type VirtualItem } from "@tanstack/react-virtual";

/** The table switches to a row window only ABOVE this many visible rows. */
export const VIRTUALIZE_MIN_ROWS = 200;
/** Rows rendered beyond each edge of the viewport. */
const OVERSCAN_ROWS = 10;
/** A one-line Open Points row (py-3 cells, text-sm). Rows that wrap are
 *  measured once rendered (`measure`), so this only seeds the first window. */
export const TASK_ROW_ESTIMATE_PX = 45;
/** The attribute every task row carries with its task id. */
const ROW_ID_ATTR = "data-deeplink-row";

/** One rendered row: its index in the WHOLE list, and the height of the spacer
 *  row that must precede it (0 when it directly follows the previous one). */
export interface WindowItem {
  index: number;
  padBefore: number;
}

export interface TaskRowWindow {
  enabled: boolean;
  /** The rows to render, in list order. Empty when off (render every row).
   *  Usually one contiguous run; a focused row held outside the run (see
   *  `withPinnedIndex`) adds a second one with its own spacer. */
  items: readonly WindowItem[];
  /** Height of the spacer row below the last rendered row, in px. */
  padBottom: number;
  /** Ref callback for a rendered row; the row must carry `data-index`. */
  measure: (el: HTMLElement | null) => void;
  /** Bring list index `i` into the window, centred. No-op when off. */
  scrollToIndex: (i: number) => void;
}

export interface TaskRowWindowHandle {
  scrollToIndex: (i: number) => void;
}

const noop = () => {};
const OFF: TaskRowWindow = { enabled: false, items: [], padBottom: 0, measure: noop, scrollToIndex: noop };

/** `indexes` (ascending) plus `pinned`, still ascending. A negative `pinned`
 *  means none. Used as the virtualizer's range extractor so a row holding focus
 *  stays mounted when it scrolls out of the window: an inline edit keeps its
 *  draft in the row's state and commits it on blur, and an unmount fires no
 *  blur, so dropping the row would silently discard the edit. */
export function withPinnedIndex(indexes: readonly number[], pinned: number): number[] {
  if (pinned < 0 || indexes.includes(pinned)) return [...indexes];
  return [...indexes, pinned].sort((a, b) => a - b);
}

// ── Printing ────────────────────────────────────────────────────────────────
// A printout must hold EVERY row, so the window switches off while printing.
// Two sources, because neither covers every path alone:
//  - the `print` media query, which flips for an emulated print medium;
//  - `beforeprint`/`afterprint`, which Chromium dispatches for a real print,
//    including one the browser starts (Ctrl+P) rather than `window.print()`.
//    The desktop shell's File → Print… is such a print (docs/AGENTS/desktop.md
//    "Print and the menu"). ★ NOT yet verified on a packaged desktop build —
//    owed, recorded in §5.
// An external-store change outside a React event renders at sync priority,
// flushed in the microtask checkpoint right after the `beforeprint` handler —
// before the print layout is taken.
let printEventActive = false;

function subscribePrint(onChange: () => void): () => void {
  if (typeof window === "undefined") return noop;
  const mql = typeof window.matchMedia === "function" ? window.matchMedia("print") : null;
  const onBefore = () => {
    printEventActive = true;
    onChange();
  };
  const onAfter = () => {
    printEventActive = false;
    onChange();
  };
  mql?.addEventListener("change", onChange);
  window.addEventListener("beforeprint", onBefore);
  window.addEventListener("afterprint", onAfter);
  return () => {
    mql?.removeEventListener("change", onChange);
    window.removeEventListener("beforeprint", onBefore);
    window.removeEventListener("afterprint", onAfter);
  };
}

function getPrintSnapshot(): boolean {
  if (printEventActive) return true;
  return typeof window.matchMedia === "function" && window.matchMedia("print").matches;
}

const getServerPrintSnapshot = () => false;

/** The list index of the task row holding focus inside `box`, or -1.
 *
 *  Read from `document.activeElement` each time the virtualizer asks for a
 *  range, never tracked through focus events: a listener attached when the
 *  window turns on misses a row that ALREADY holds focus (an inline edit open
 *  at 200 rows when a background write pushes the list past the threshold, or
 *  one held across a print), and an element removed while focused fires no
 *  focusout, which left a stale id pinned.
 *
 *  ★ The virtualizer re-runs its range extractor only when the range, the
 *  count or the extractor itself changes, never on a focus move alone. That is
 *  enough: an element can only take focus while rendered, so a newly focused
 *  row is already in the window, and the next range change (the scroll that
 *  would take it out) asks again. A row that LOST focus stays pinned until
 *  then, which costs one extra row and nothing else. */
function focusedRowIndex(box: HTMLElement | null, ids: readonly number[]): number {
  if (!box || typeof document === "undefined") return -1;
  const active = document.activeElement;
  if (!active || !box.contains(active)) return -1;
  const row = active.closest(`[${ROW_ID_ATTR}]`);
  return row ? ids.indexOf(Number(row.getAttribute(ROW_ID_ATTR))) : -1;
}

/** Every row height the virtualizer has measured, as `initialMeasurementsCache`
 *  takes them. The same walk as virtual-core's `takeSnapshot`, but over the
 *  measurements it already holds: `takeSnapshot` recomputes them first, and in
 *  the commit that switches the window off that recompute is what CLEARS them
 *  (virtual-core 3.17.11, `getMeasurements` with `enabled: false`). */
function measuredRows(virtualizer: Virtualizer<HTMLElement, Element>): VirtualItem[] {
  const out: VirtualItem[] = [];
  if (virtualizer.itemSizeCache.size === 0) return out;
  for (const item of virtualizer.measurementsCache) {
    if (item && virtualizer.itemSizeCache.has(item.key)) {
      out.push({ index: item.index, key: item.key, start: item.start, size: item.size, end: item.end, lane: item.lane });
    }
  }
  return out;
}

/** The height of `headRef` (the table's <thead>), kept current through a
 *  ResizeObserver. Row 0 starts below it, so the virtualizer gets it as
 *  `paddingStart`; without it every offset (the range, `scrollToIndex`'s
 *  centring) is off by a header height. ★ offsetHeight, not a bounding rect:
 *  the header is sticky, so its rect moves with the scroll position. */
function useHeadHeight(headRef: React.RefObject<HTMLElement | null>, enabled: boolean): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const head = headRef.current;
    if (!enabled || !head || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(head.offsetHeight));
    observer.observe(head);
    return () => observer.disconnect();
  }, [headRef, enabled]);
  return enabled ? height : 0;
}

export function useTaskRowWindow(opts: {
  /** The visible task ids, in list order. Their count drives the threshold. */
  ids: readonly number[];
  scrollRef: React.RefObject<HTMLElement | null>;
  /** The table's <thead>; row 0 starts at its bottom edge. */
  headRef: React.RefObject<HTMLElement | null>;
  estimateRowPx: number;
}): TaskRowWindow {
  const { ids, scrollRef, headRef, estimateRowPx } = opts;
  const count = ids.length;
  const printing = useSyncExternalStore(subscribePrint, getPrintSnapshot, getServerPrintSnapshot);
  const enabled = count > VIRTUALIZE_MIN_ROWS && !printing;
  const headPx = useHeadHeight(headRef, enabled);
  // ★ Keyed by task id, not index, so a sort or an insert moves each measured
  // height with its task instead of handing it to whatever row lands there.
  const getItemKey = useCallback((i: number) => ids[i] ?? i, [ids]);
  // Every row height measured before the window last switched off. ★ A
  // virtualizer switched off CLEARS its measurements, so without this a print or
  // a dip under the threshold would bring it back estimating every row at
  // `estimateRowPx`: the same scroll offset would then map to a different row
  // and the reader would land tens of rows away (measured: row 427 → 520 at
  // 1008 tasks, with rows 72–115 px tall against the 45 px estimate).
  // Taken once, as the window switches off (the layout effect below), not on
  // every windowed commit: the walk is O(rows), and a scroll step commits.
  const [measured, setMeasured] = useState<VirtualItem[]>([]);
  const rangeExtractor = useCallback(
    (range: Range) => withPinnedIndex(defaultRangeExtractor(range), focusedRowIndex(scrollRef.current, ids)),
    [ids, scrollRef],
  );
  // ★★ The box's LIVE size, read when the virtualizer turns on. Switched off, it
  // forgets the box's size as well as its offset, and the default (0 × 0) gives
  // the first windowed render an EMPTY range: every row unmounted for one
  // commit, re-created the next. A focused row, and the inline-edit draft in
  // its state, went with them, whatever the range extractor pinned. Getters, so
  // the box is read only when virtual-core asks: `getSize` before it has
  // observed a rect, i.e. inside `getVirtualItems` on the first windowed
  // render, which is the moment the live size is wanted. offsetWidth/
  // offsetHeight, as virtual-core's own observer reads it.
  const initialRect = useMemo<Rect>(
    () => ({
      get width() {
        return scrollRef.current?.offsetWidth ?? 0;
      },
      get height() {
        return scrollRef.current?.offsetHeight ?? 0;
      },
    }),
    [scrollRef],
  );
  // ★ Called unconditionally (rules of hooks); `enabled: false` makes it attach
  // no scroll or resize observer, so the plain path pays nothing for it.
  // eslint-disable-next-line react-hooks/incompatible-library -- the window is re-read every render; the one value handed to a memoized child (`measureElement`) is a stable instance field.
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowPx,
    overscan: OVERSCAN_ROWS,
    enabled,
    getItemKey,
    rangeExtractor,
    paddingStart: headPx,
    initialRect,
    // ★★ While off, the virtualizer forgets its scroll offset; when it turns
    // back on (after a print, or when the list grows past the threshold) it
    // scrolls the box to `initialOffset`. The default is 0, which jumped the
    // table to the top every time. Reading the box's live offset keeps it put.
    initialOffset: () => scrollRef.current?.scrollTop ?? 0,
    // Read only when the virtualizer starts with no measurements: on mount, and
    // when it turns back on. Keyed by task id (`getItemKey`), so a height
    // follows its task even if the list changed while the window was off.
    initialMeasurementsCache: measured,
  });
  // ★ The CLEANUP of a windowed commit's effect, which runs when `enabled`
  // turns false (and on unmount). Within a commit React runs the layout-effect
  // cleanups before any layout effect, so this reads the measurements before virtual-core's own
  // effect recomputes them as off and clears them.
  useLayoutEffect(() => {
    if (!enabled) return;
    return () => setMeasured(measuredRows(virtualizer));
  }, [enabled, virtualizer]);

  if (!enabled) return OFF;
  // ★ `measureElement` is an instance field, so it keeps one identity across
  // renders; passing it straight through keeps the memoized TaskRow bailing.
  const measure = virtualizer.measureElement;
  const scrollToIndex = (i: number) => virtualizer.scrollToIndex(i, { align: "center" });
  const virtualItems = virtualizer.getVirtualItems();
  const total = virtualizer.getTotalSize();
  const items: WindowItem[] = [];
  let edge = headPx;
  for (const item of virtualItems) {
    items.push({ index: item.index, padBefore: Math.max(0, item.start - edge) });
    edge = item.end;
  }
  return { enabled: true, items, padBottom: Math.max(0, total - edge), measure, scrollToIndex };
}
