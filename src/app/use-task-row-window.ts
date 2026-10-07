"use client";
// src/app/use-task-row-window.ts — which Open Points rows to render (§5).
//
// Above VIRTUALIZE_MIN_ROWS visible rows the table renders only a window of
// rows near the viewport, between two spacer rows whose heights stand in for
// the rows it skipped. At or below the threshold the hook reports "every row,
// no padding" and the table renders exactly as it did before virtualization.
//
// `@tanstack/react-virtual` is headless: it computes the indices and sizes and
// renders nothing, so the table keeps its semantic <table>/<tbody>/<tr>
// markup, its sticky header and its <colgroup> widths.
import type React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/** The table switches to a row window only ABOVE this many visible rows. */
export const VIRTUALIZE_MIN_ROWS = 200;
/** Rows rendered beyond each edge of the viewport. */
const OVERSCAN_ROWS = 10;
/** A one-line Open Points row (py-3 cells, text-sm). Rows that wrap are
 *  measured once rendered (`measure`), so this only seeds the first window. */
export const TASK_ROW_ESTIMATE_PX = 45;

export interface TaskRowWindow {
  enabled: boolean;
  /** First rendered index in `visibleRows` (inclusive). */
  start: number;
  /** Last rendered index in `visibleRows` (exclusive). */
  end: number;
  /** Height of the spacer row above the window, in px. */
  padTop: number;
  /** Height of the spacer row below the window, in px. */
  padBottom: number;
  /** Ref callback for a rendered row; the row must carry `data-index`. */
  measure: (el: HTMLElement | null) => void;
  /** Bring list index `i` into the window, centred. No-op when off. */
  scrollToIndex: (i: number) => void;
}

const noop = () => {};

export function useTaskRowWindow(opts: {
  count: number;
  scrollRef: React.RefObject<HTMLElement | null>;
  estimateRowPx: number;
}): TaskRowWindow {
  const { count, scrollRef, estimateRowPx } = opts;
  const enabled = count > VIRTUALIZE_MIN_ROWS;
  // ★ Called unconditionally (rules of hooks); `enabled: false` makes it attach
  // no scroll or resize observer, so the plain path pays nothing for it.
  // eslint-disable-next-line react-hooks/incompatible-library -- the window is re-read every render; the one value handed to a memoized child (`measureElement`) is a stable instance field.
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowPx,
    overscan: OVERSCAN_ROWS,
    enabled,
  });

  if (!enabled) {
    return { enabled: false, start: 0, end: count, padTop: 0, padBottom: 0, measure: noop, scrollToIndex: noop };
  }
  // ★ `measureElement` is an instance field, so it keeps one identity across
  // renders; passing it straight through keeps the memoized TaskRow bailing.
  const measure = virtualizer.measureElement;
  const scrollToIndex = (i: number) => virtualizer.scrollToIndex(i, { align: "center" });
  const items = virtualizer.getVirtualItems();
  const total = virtualizer.getTotalSize();
  if (items.length === 0) {
    return { enabled: true, start: 0, end: 0, padTop: 0, padBottom: total, measure, scrollToIndex };
  }
  const first = items[0];
  const last = items[items.length - 1];
  return {
    enabled: true,
    start: first.index,
    end: last.index + 1,
    padTop: first.start,
    padBottom: Math.max(0, total - last.end),
    measure,
    scrollToIndex,
  };
}
