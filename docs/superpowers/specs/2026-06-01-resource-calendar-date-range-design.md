# Resource Calendar — date-range controls + today anchoring

**Date:** 2026-06-01
**Status:** Approved (design)
**Area:** Resources › Calendar (`resource-calendar.tsx`, `resources-panel.tsx`)

## Problem

The Resource Calendar is a fixed **30-day grid that starts at today** — today is
the first column, so **no past dates are visible**, and the visible window can't be
changed. Users want to:

1. Choose an arbitrary first/last date (a custom time window).
2. Quickly view a whole **month** or a single **week**.
3. Have the calendar behave like the **Gantt**: show past *and* future dates,
   with **today anchored (scroll-centered) when the calendar opens**.

## Goals

- Replace the fixed 30-days-from-today window with a selectable window.
- Provide a **Month / Week / Custom** control with month/week stepping and a
  Today button; Custom exposes `From` / `To` date pickers.
- Render past dates as well as future dates.
- On open, anchor to today: scroll today's column to the horizontal center
  (Gantt-style), and re-anchor to today every time the calendar is opened.

## Non-goals

- No persistence of the chosen window across sessions — opening always
  re-anchors to today (this is the requested behavior, and keeps the model
  simple).
- No "week N of month" labeling; a week is a plain 7-day ISO week.
- No change to absence/shift editing, cell coloring, or the assignee column.

## UX / Controls

A control row is added **above the calendar grid**, inside `resources-panel.tsx`
for `view === "calendar"`, mirroring the existing Planning control row
(`mb-2 flex flex-wrap items-center gap-2 text-xs`):

- **`SegmentedControl`** with three options: **Month · Week · Custom**
  (`calendarMode: "month" | "week" | "custom"`).
- **◀ (Prev) · period label · ▶ (Next) · Today** cluster:
  - Prev/Next step the **anchor date** by one month (Month mode) or one week
    (Week mode).
  - The period label shows the current span: e.g. `June 2026` (Month) or
    `26 May – 1 Jun 2026` (Week), formatted via the existing locale helpers.
  - **Today** resets the anchor to today (and the grid re-centers today).
  - This cluster is hidden in Custom mode.
- **Custom mode** reveals two `<input type="date">` pickers — **From** / **To** —
  styled exactly like the Planning date inputs
  (`rounded border border-line px-2 py-1.5 text-sm dark:bg-surface`).
- The existing **"Sync with Outlook"** button stays in the shared panel header
  (unchanged); it is not part of this control row.

Buttons (Prev/Next/Today) use the standard secondary-button style
(`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium …`).

## Architecture

### `calendar-window.ts` (new, pure, unit-tested)

A small pure module that owns the window math so it can be tested in isolation
and kept out of the component:

```ts
export type CalendarMode = "month" | "week" | "custom";

/** Max number of days a window may span (perf guard against huge column counts). */
export const MAX_CALENDAR_SPAN_DAYS = 370;

export interface CalendarWindow { startDate: string; endDate: string; } // ISO yyyy-mm-dd

/** Month bounds: 1st … last day of the anchor's month. */
export function monthWindow(anchorIso: string): CalendarWindow;

/** Week bounds: Monday … Sunday of the anchor's week (ISO, Monday-start). */
export function weekWindow(anchorIso: string): CalendarWindow;

/** Custom bounds: [from, to] normalized so start ≤ end, clamped to MAX span. */
export function customWindow(fromIso: string, toIso: string): CalendarWindow;

/** Step an anchor date by ±1 month or ±1 week (used by Prev/Next). */
export function stepAnchor(anchorIso: string, unit: "month" | "week", dir: -1 | 1): string;

/** Resolve the active window from the current control state. */
export function resolveWindow(
  mode: CalendarMode, anchorIso: string, fromIso: string, toIso: string,
): CalendarWindow;
```

All date math uses UTC (consistent with the existing calendar/`generatePeriods`
code) to avoid timezone drift. Invalid/empty inputs return a safe fallback
(today's month) rather than throwing.

### `resources-panel.tsx`

- New state for the calendar view: `calendarMode` (default `"month"`),
  `calendarAnchor` (default `today`), `calendarFrom` / `calendarTo`
  (default to the current month bounds; seeded the first time Custom is used).
- Compute `{ startDate, endDate } = resolveWindow(mode, anchor, from, to)` and
  pass them to `<ResourceCalendar startDate={…} endDate={…} … />`.
- Render the control row described above (Month/Week/Custom + nav / pickers).
- Because the calendar window is local UI state (like Planning's
  `viewGranularity`), it lives in the panel; nothing is persisted.

### `resource-calendar.tsx`

- **Props:** add `startDate: string` and `endDate: string`; drop the internal
  `CALENDAR_DAYS` constant.
- **Day generation:** build the `CalendarDay[]` by iterating from `startDate`
  through `endDate` inclusive (instead of `today + i` for 30). Per-day metadata
  (`isWeekend`, `isHoliday`, `isToday`, `monthLabel` on month change) is
  unchanged. If the window is invalid or empty, render no day columns (existing
  empty-guard pattern).
- **Today anchoring:** add a `scrollRef` on the scroll container and a
  `useLayoutEffect` that, when `today` ∈ `[startDate, endDate]`, scrolls so the
  today column is horizontally centered. It runs on mount and whenever
  `startDate`/`endDate` change. Implementation mirrors the Gantt's
  scroll-to-today effect (compute the today column's offset, set
  `scrollLeft = todayOffset − viewportWidth / 2`, clamped ≥ 0). When today is
  outside the window, no auto-scroll (the window's start shows first).
- Everything else (absence lookup map, cell coloring, click-to-add/edit, sticky
  assignee column, `TABLE_HEAD_CLASS` header, month-label row) is unchanged.

## Data flow

```
resources-panel (calendarMode, anchor, from, to)
    │  resolveWindow(...)
    ▼
{ startDate, endDate }  ──►  <ResourceCalendar startDate endDate today … />
                                   │  generate day columns over [start,end]
                                   │  useLayoutEffect → center today on open/window change
                                   ▼
                              horizontally-scrollable grid (past ← today → future)
```

## Edge cases

- **Empty/invalid dates:** `resolveWindow` falls back to the current month;
  `ResourceCalendar` renders zero columns if `start`/`end` are unparseable.
- **Custom From > To:** normalized (swapped) so the window is always valid.
- **Huge custom span:** clamped to `MAX_CALENDAR_SPAN_DAYS` (≈ a year) to bound
  column count / DOM size; the clamp is silent but documented.
- **Today outside window** (e.g. viewing a past month): no auto-centering; the
  window renders from its start. Today simply isn't highlighted.
- **Week-start:** Monday (ISO). Weekends (Sat/Sun) keep their muted tint.

## i18n (EN + DE)

- Reuse: `resourcesGranularityMonth`, `resourcesGranularityWeek`.
- New keys: `calendarModeCustom`, `calendarPrev`, `calendarNext`,
  `calendarToday`, `calendarFrom`, `calendarTo` (+ German equivalents).

## Testing

- **`calendar-window.test.ts`** (pure): month bounds (incl. month-length and
  year boundaries), week bounds (Monday-start, week spanning month/year
  boundary), custom normalization (swap, clamp to max span), `stepAnchor`
  (±month/±week across boundaries), `resolveWindow` dispatch, invalid-input
  fallback.
- **`resource-calendar.test.tsx`**: a window spanning before→after today renders
  day columns for past *and* future dates (today column present and marked); a
  past-only window renders without a today column; column count matches the
  window length.
- **Anchoring:** assert the centering effect computes/sets `scrollLeft` for an
  in-window today (jsdom has no layout, so assert via the computed offset/ref
  logic rather than real pixel scroll).
- Existing calendar tests continue to pass with the new `startDate`/`endDate`
  props supplied.

## Out of scope / future

- Persisting the last-used mode/window.
- Density/zoom (cell width) controls.
- A month-grid (calendar-page) layout — this remains the row-per-assignee
  timeline grid.
