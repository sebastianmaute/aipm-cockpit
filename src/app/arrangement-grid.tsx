"use client";
import type { ReactNode } from "react";
import type { BlockSpan } from "./arrangement-layout";

/**
 * ★★★ THESE MUST STAY WHOLE LITERAL STRINGS. Tailwind v4 builds its stylesheet
 * by scanning source for class-name candidates, so an interpolated
 * `col-span-${w}` emits NO CSS — the block would silently render one column wide
 * with nothing in any test able to see it, because jsdom has no layout.
 *
 * ★ The WIDTH table carries the entire responsive clamp, which is why the
 * narrow-screen behaviour needs no JavaScript: no width measurement, no
 * ResizeObserver. Height does not clamp — a tall block stays tall.
 *
 * ★★ THE SOURCE FORM IS THE ONLY THING WORTH GUARDING, AND THE GUARD IS
 * FILE-SCOPED — `arrangement-grid.test.tsx` reads THIS file back and scans the
 * two table bodies, because a runtime assertion reads the PRODUCED string and
 * `col-span-1 lg:col-span-${2}` produces a byte-identical one. When these tables
 * move again, the scan has to move with them or it silently protects nothing.
 * That is not hypothetical: the scan that used to guard them was pinned to
 * `dashboard-grid.tsx`'s path and could not follow them here.
 */
export const W_CLASS: Record<BlockSpan, string> = {
  1: "col-span-1",
  2: "col-span-1 lg:col-span-2",
  3: "col-span-1 lg:col-span-2 xl:col-span-3",
  4: "col-span-1 lg:col-span-2 xl:col-span-4",
};

export const H_CLASS: Record<BlockSpan, string> = {
  1: "row-span-1",
  2: "row-span-2",
  3: "row-span-3",
  4: "row-span-4",
};

/**
 * The arrangeable block grid, shared by every surface that binds the
 * arrangement engine.
 *
 * ★★ ORDER IS THE WHOLE PLACEMENT MODEL — `grid-flow-row-dense` resolves an
 * ordered list of spans into cells, so there are no coordinates to store, and
 * the column count changes with the breakpoint without any of it needing to
 * know. That also means a drop indicator drawn on one block's EDGE would
 * routinely point at a slot the block does not land in (dense backfill
 * re-places everything after the move) — consumers render the reorder hook's
 * `previewOrder` instead.
 *
 * ★★ THE FOUR-COLUMN GRID IS BAKED IN HERE AND IN `BlockSpan`, and the two must
 * move together. `xl:grid-cols-4` below is the same assumption `BlockSpan`'s
 * `1|2|3|4` closed union encodes (`arrangement-layout.ts` says so at its head),
 * and `W_CLASS` above spells the clamp for exactly those four. A surface wanting
 * six columns changes all three at once; treat it as one cost, not a local one.
 *
 * ★ Row height and gap are INJECTED, never literal here. The Dashboard's come
 * from its density classes — a literal `gap-*` would ignore compact mode — and
 * Reports, which has no concept of density, passes its own fixed pair. That
 * split is the whole reason this is a parameter.
 *
 * ★★★ THIS RENDERS **NO SCROLLER OF ITS OWN**, and re-adding one is the defect
 * it used to have. It wrapped the grid in `min-h-0 overflow-y-auto` and handed
 * that div to `useListReorderDnd` as the drag `scrollRef` — but the wrapper is a
 * block-level child of a plain block, so it sizes to its content,
 * `scrollHeight === clientHeight`, and `useDragAutoscroll`'s `scrollTop +=`
 * could never move it. Dragging a block toward the bottom of a long board did
 * nothing. The real scroller is the enclosing `ReportCard`'s own `contentRef`
 * (that prop's docstring says so, and `reports.tsx` wires it the same way), so
 * the panel passes ONE ref to both the card and the hook. Nesting a second
 * scroller here would not merely be redundant — it would take the drag
 * autoscroll back to the element that cannot scroll.
 */
export function ArrangementGrid({
  rowClass,
  gapClass,
  testId,
  children,
}: {
  rowClass: string;
  gapClass: string;
  /** The surface's own `data-testid`, so each board is addressable on its own. */
  testId: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className={`grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 grid-flow-row-dense ${rowClass} ${gapClass}`}
    >
      {children}
    </div>
  );
}
