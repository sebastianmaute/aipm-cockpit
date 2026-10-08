"use client";
// src/app/use-gantt-row-window.ts — which Gantt rows to render (§5).
//
// Above VIRTUALIZE_MIN_ROWS rows the chart renders only a window of rows near
// the viewport, with spacers whose heights stand in for the rows it skipped. At
// or below the threshold the hook reports "off" and the chart renders exactly
// as it did before. Owner-approved design, 2026-10-08 (register §5).
//
// Simpler than the task table's window (use-task-row-window.ts), whose helpers
// it reuses: every Gantt row is exactly ROW_HEIGHT_PX tall, so nothing is
// measured and every spacer is a whole number of rows. The overlays (dependency
// arrows, grid, holiday shading, today line) already draw from row INDEXES over
// the full height, so they need nothing from the window.
//
// ★ Kept mounted outside the window: the row holding focus (read from
//   `document.activeElement` each time the range is asked for, the table's
//   rule) and the rows named in `pinnedKeys` — the row being dragged to
//   reorder and the row whose bar is being moved or resized. An HTML5 drag
//   whose source unmounts never fires dragend, and the bar drag previews on
//   its row.
//
// Coverage-GATED, pinned by use-gantt-row-window.test.tsx over the REAL
// virtualizer (no mock).
import type React from "react";
import { useCallback, useMemo } from "react";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { usePrinting } from "./use-printing";
import { liveBoxRect, VIRTUALIZE_MIN_ROWS, withPinnedIndex, type WindowItem } from "./use-task-row-window";
import { HEADER_HEIGHT_PX, ROW_HEIGHT_PX } from "./gantt-engine";

/** Rows rendered beyond each edge of the viewport. */
const OVERSCAN_ROWS = 10;
/** The attribute every Gantt row carries with its row key (`ganttRowKey`). */
export const GANTT_ROW_ATTR = "data-gantt-row";

export interface GanttRowWindow {
  enabled: boolean;
  /** The rows to render, in list order, each with the spacer height before it.
   *  Empty when off (render every row). */
  items: readonly WindowItem[];
  /** Height of the spacer below the last rendered row, in px. */
  padBottom: number;
}

const OFF: GanttRowWindow = { enabled: false, items: [], padBottom: 0 };

/** The list index of the row holding focus inside `box`, or -1. */
function focusedRowIndex(box: HTMLElement | null, keys: readonly string[]): number {
  if (!box || typeof document === "undefined") return -1;
  const active = document.activeElement;
  if (!active || !box.contains(active)) return -1;
  const row = active.closest(`[${GANTT_ROW_ATTR}]`);
  return row ? keys.indexOf(row.getAttribute(GANTT_ROW_ATTR) ?? "") : -1;
}

export function useGanttRowWindow(opts: {
  /** Every row's key (`ganttRowKey`), in render order. Their count drives the threshold. */
  keys: readonly string[];
  /** The chart's scroll box; row 0 starts HEADER_HEIGHT_PX below its top. */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Rows that must stay mounted whatever the scroll position (drags). */
  pinnedKeys: readonly string[];
}): GanttRowWindow {
  const { keys, scrollRef, pinnedKeys } = opts;
  const count = keys.length;
  const printing = usePrinting();
  const enabled = count > VIRTUALIZE_MIN_ROWS && !printing;
  const getItemKey = useCallback((i: number) => keys[i] ?? i, [keys]);
  const pinnedIndexes = useMemo(
    () => pinnedKeys.map((k) => keys.indexOf(k)).filter((i) => i >= 0),
    [keys, pinnedKeys],
  );
  const rangeExtractor = useCallback(
    (range: Range) =>
      [...pinnedIndexes, focusedRowIndex(scrollRef.current, keys)].reduce(
        (indexes, pinned) => withPinnedIndex(indexes, pinned),
        defaultRangeExtractor(range),
      ),
    [keys, pinnedIndexes, scrollRef],
  );
  // The box's LIVE size and offset when the window turns on — see the same
  // two options in use-task-row-window.ts for why the defaults (0 × 0, offset 0)
  // would empty the first range and jump the chart to the top.
  const initialRect = useMemo(() => liveBoxRect(scrollRef), [scrollRef]);
  // eslint-disable-next-line react-hooks/incompatible-library -- the window is re-read every render and nothing from the virtualizer is handed to a memoized child.
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: OVERSCAN_ROWS,
    enabled,
    getItemKey,
    rangeExtractor,
    paddingStart: HEADER_HEIGHT_PX,
    initialRect,
    initialOffset: () => scrollRef.current?.scrollTop ?? 0,
  });
  if (!enabled) return OFF;
  // Every row is ROW_HEIGHT_PX, so each spacer is the skipped rows times that.
  const items: WindowItem[] = [];
  let next = 0;
  for (const item of virtualizer.getVirtualItems()) {
    items.push({ index: item.index, padBefore: (item.index - next) * ROW_HEIGHT_PX });
    next = item.index + 1;
  }
  return { enabled: true, items, padBottom: (count - next) * ROW_HEIGHT_PX };
}
