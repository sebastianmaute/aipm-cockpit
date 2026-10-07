# List virtualization, first list: the Open Points task table (§5)

**Status:** design, for owner review. Register entry §5 (#87). Batch 17.

## Goal

Keep the Open Points task table responsive on large projects by rendering only the rows near the
viewport, without breaking the four shipped features §5 names: print, the deep-link row flash,
column resize and the axe scan.

## What is measured today, and what is not

- No list in the app is virtualized and no virtualization package is installed.
- The largest sample is `sample-workspace-huge.json`: **140 tasks**, 130 RAID items, 14 activity
  entries (`node -e` over the three samples, 2026-10-07). The activity log is capped at 500
  entries (§510), so it is never large.
- **Nobody has measured a slow table.** §5 was filed from an audit row ("every filtered row is in
  the DOM"), not from a profile. Building virtualization against an unmeasured cost risks adding
  four collisions to fix a problem that does not exist at realistic sizes.

So the work starts with a measurement, and the measurement decides whether the build goes ahead.

## Phase 0: measure (always built)

An opt-in Playwright probe, `e2e/perf-task-table.spec.ts`, off unless `PERF=1` (same pattern as the
eye-verify kits, so CI skips it):

- Seeds a workspace scaled with the existing `scaleWorkspace(ws, factor)` to **500, 1000 and 2000
  tasks**, by replacing the seed before `gotoApp`.
- For each size, records three numbers on Chromium, three runs each, median reported:
  1. time from opening Open Points to the last row painted;
  2. time for one inline status change to commit and repaint;
  3. time for one keystroke in the table's search box to repaint the filtered list.
- Writes the numbers to `eye-verify-output/perf/task-table.json` (git-ignored) and prints a table.

**Decision rule.** Phase 1 is built only if, at **1000 tasks**, any of the three medians exceeds
**200 ms** (the point where a click stops feeling instant). If none does, the probe and its
numbers are committed, §5 is updated with the measurement and narrowed to "not needed below N
rows", and Phase 1 is not built. The threshold and the result go in the register either way.

## Phase 1: virtualize the task table (built only if Phase 0 says so)

### Library

`@tanstack/react-virtual` 3.14.13, exact-pinned like the other framework-coupled packages.
It is headless (it computes which indices to render and the spacer sizes, and renders nothing
itself), so the table keeps its `<table>`/`<tbody>`/`<tr>` markup, its sticky header, its
`<colgroup>` widths and every existing row component. React 19 is in its peer range.
`react-window` 2 was the alternative; it owns the scroll container's markup, which does not fit a
semantic table, so it is rejected.

### Shape

- `tasks-section-rows.tsx` renders `visibleRows.slice(start, end)` between two spacer rows
  (`<tr aria-hidden="true">` with one cell of the computed height). Row components are
  unchanged.
- The scroll element is the table's existing scroll container; rows use an estimated height with
  `measureElement`, because rows grow with wrapped titles and badges.
- **Threshold:** virtualization switches on only above `VIRTUALIZE_MIN_ROWS = 200` visible rows.
  Below that the table renders exactly as today. Every seeded e2e spec, the axe gate and the
  visual baselines run at 14 rows, so none of them changes, and nearly every real project stays
  on the current path.
- The table gets `aria-rowcount` (header plus all visible rows) and each rendered row
  `aria-rowindex`, so a screen reader announces the true size.

### The four collisions

1. **Print.** A `matchMedia("print")` listener plus `beforeprint`/`afterprint` sets a flag that
   renders every row while printing. The Electron shell prints through the same browser print
   path (`docs/AGENTS/desktop.md`), so it is covered too. Test: a unit test fires the media
   change and asserts all rows render.
2. **Deep-link row flash.** `useDeepLinkRowFlash` scrolls to a row by querying
   `data-deeplink-row`, which is a silent no-op for a row outside the window. The hook gains an
   optional `scrollToId` callback; the table passes one that calls the virtualizer's
   `scrollToIndex(index, { align: "center" })` first, and the existing flash then finds the row.
   The other six panels that use the hook pass nothing and are unchanged. Test: a deep link to row
   900 of 1000 renders and flashes that row.
3. **Column resize.** Widths live on `<colgroup>`, which virtualization does not touch. The only
   risk is a spacer row narrowing the table; the spacer cell spans every column (`colSpan`). Test:
   resize with virtualization on, widths persist.
4. **Axe scan.** Unchanged at seed size (below the threshold). One extra axe check runs the
   1000-row seed with virtualization on, to prove the spacer rows and `aria-rowcount` raise no
   violation.

### Known trade-offs (accepted, written into the register)

- The browser's find-in-page cannot see rows outside the window. The table's own search box is
  the supported path, and the threshold keeps typical projects unaffected.
- Tab order skips from the last rendered row to whatever follows the table. Overscan of 10 rows
  softens it; full keyboard traversal of a virtualized table is out of scope.

### Out of scope

The Kanban board, Gantt and the activity log. Each has its own collision set (drag and drop, the
SVG dependency layer, print-root), and the activity log never exceeds 500 entries. Each gets its
own decision after this one ships and is measured.

## Testing summary

- Phase 0: the opt-in probe itself, run locally on port 3150.
- Phase 1: unit tests in `tasks-section-rows.test.tsx` for the threshold switch, the spacer
  heights, `aria-rowcount`/`aria-rowindex`, print rendering all rows and the deep-link
  `scrollToId` path, each mutation-tested; the opt-in probe re-run to show the before/after
  numbers; one axe check at 1000 rows.

## Register

§5 is updated with the Phase 0 numbers whatever they show. If Phase 1 ships, §5 narrows to the
remaining three lists and records the accepted trade-offs above.
