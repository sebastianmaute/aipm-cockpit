"use client";
import type { ReactNode, RefObject } from "react";
import type { DensityClasses } from "./dashboard-density";
import type { TileSpan } from "./dashboard-tiles";

/**
 * ★★★ THESE MUST STAY WHOLE LITERAL STRINGS. Tailwind v4 builds its stylesheet
 * by scanning source for class-name candidates, so an interpolated
 * `col-span-${w}` emits NO CSS — the tile would silently render one column wide
 * with nothing in any test able to see it, because jsdom has no layout.
 *
 * ★ The WIDTH table carries the entire responsive clamp, which is why the
 * narrow-screen behaviour needs no JavaScript: no width measurement, no
 * ResizeObserver. Height does not clamp — a tall tile stays tall.
 */
export const W_CLASS: Record<TileSpan, string> = {
  1: "col-span-1",
  2: "col-span-1 lg:col-span-2",
  3: "col-span-1 lg:col-span-2 xl:col-span-3",
  4: "col-span-1 lg:col-span-2 xl:col-span-4",
};

export const H_CLASS: Record<TileSpan, string> = {
  1: "row-span-1",
  2: "row-span-2",
  3: "row-span-3",
  4: "row-span-4",
};

/**
 * The arrangeable Dashboard tile grid.
 *
 * ★★ ORDER IS THE WHOLE PLACEMENT MODEL — `grid-flow-row-dense` resolves an
 * ordered list of spans into cells, so there are no coordinates to store, and
 * the column count changes with the breakpoint without any of it needing to
 * know. That also means a drop indicator drawn on one tile's EDGE would
 * routinely point at a slot the tile does not land in (dense backfill
 * re-places everything after the move) — consumers render the reorder hook's
 * `previewOrder` instead.
 *
 * ★ Spacing comes from the density classes, never from a literal `gap-*`: a
 * literal would ignore compact mode.
 */
export function DashboardGrid({
  dc,
  scrollRef,
  children,
}: {
  dc: DensityClasses;
  scrollRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return (
    <div ref={scrollRef} className="min-h-0 overflow-y-auto">
      <div
        data-testid="dashboard-grid"
        className={`grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 grid-flow-row-dense ${dc.tileRow} ${dc.sectionGap}`}
      >
        {children}
      </div>
    </div>
  );
}
