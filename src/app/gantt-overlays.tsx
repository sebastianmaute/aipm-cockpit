"use client";

// src/app/gantt-overlays.tsx — two decorative full-height layers the Gantt
// chart paints behind its rows: holiday shading (one tinted column per
// non-working day) and the optional day grid (one dotted rule per day column).
//
// Both take the SAME geometry the day-axis header uses — a day at index `i`
// starts at `nameColWidth + i * DAY_WIDTH_PX`. `dayLeftPx` below is that
// expression, and the panel's `todayOffsetPx` now CALLS it rather than
// re-inlining the arithmetic; `GanttHeader` (gantt-chrome.tsx) still spells it
// out via per-day divs. If either layer ever computes its own origin or column
// width, a grid line stops sitting under its date label, which is the entire
// point of the grid.
//
// Both are inert: `aria-hidden` (the dates are already in the header, the
// absences already in the rows) and `pointer-events-none` so they can never
// intercept a bar drag-edit.

import { addDays, DAY_WIDTH_PX, toISODay } from "./gantt-engine";

/** Left offset, in px, of the day at index `i` — the header's expression.
 *  EXPORTED because the panel's today marker needs the identical number: one
 *  place owns where a day column starts, or a rule stops sitting under its
 *  date label. */
export function dayLeftPx(i: number, nameColWidth: number): number {
  return nameColWidth + i * DAY_WIDTH_PX;
}

export function GanttNonWorkingLayer({
  range,
  holidaySet,
  nameColWidth,
  heightPx,
}: {
  range: { min: Date; days: number };
  holidaySet: ReadonlySet<string>;
  nameColWidth: number;
  heightPx: number;
}) {
  // Cheap bail so a project with no holiday countries configured (the default)
  // doesn't walk the window at all.
  if (holidaySet.size === 0) return null;
  const cells = [];
  for (let i = 0; i < range.days; i += 1) {
    const iso = toISODay(addDays(range.min, i));
    if (!holidaySet.has(iso)) continue;
    cells.push(
      <div
        key={i}
        // No `title`: the element is pointer-events-none, so it can never be
        // hovered and a native tooltip could not render. `data-holiday` carries
        // the date for tests; the day label in the header carries it for users.
        data-holiday={iso}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 z-0 bg-ui-medium-grey/15"
        style={{ left: dayLeftPx(i, nameColWidth), width: DAY_WIDTH_PX, height: heightPx }}
      />,
    );
  }
  return <>{cells}</>;
}

export function GanttGridLayer({
  range,
  nameColWidth,
  heightPx,
}: {
  range: { min: Date; days: number };
  nameColWidth: number;
  heightPx: number;
}) {
  return (
    <>
      {Array.from({ length: range.days }).map((_, i) => (
        <div
          key={i}
          data-grid-line={i}
          aria-hidden="true"
          // A zero-width box whose LEFT border is the rule. A repeating
          // background pattern would be the obvious alternative and is not
          // available — the palette guard bans that whole class of value.
          className="pointer-events-none absolute top-0 z-0 border-l border-dashed border-line"
          style={{ left: dayLeftPx(i, nameColWidth), height: heightPx }}
        />
      ))}
    </>
  );
}
