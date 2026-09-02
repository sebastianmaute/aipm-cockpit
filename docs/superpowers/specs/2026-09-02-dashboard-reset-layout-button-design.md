# Dashboard "Reset layout" — move it into the top control stack and give it an icon

**Date:** 2026-09-02
**Status:** approved, not yet planned
**Scope:** one control's placement, form and icon. No engine change.

## Goal

Make the dashboard's existing "Reset layout" control findable, by moving it from
below the tile grid into the top-right control stack the user already reaches
for, as an icon-only button matching its two neighbours.

## What already exists — this slice adds no capability

The feature is complete below the UI, and the brainstorm's first finding was that
none of it needs building:

- `DEFAULT_LAYOUT` (`dashboard-layout.ts`) — every tile in catalogue order at its
  default size, `hidden: []`.
- `useDashboardLayout().reset()` — commits `DEFAULT_LAYOUT` through the same
  `mutate` path every other layout op uses, and persists it. Covered by
  "reset restores the default and clears hidden" in `use-dashboard-layout.test.tsx`.
- A wired **Reset layout** button in `dashboard-panel.tsx`, `variant="ghost"
  size="xs"`, right-aligned in a `flex justify-end` div immediately ABOVE the
  hidden-tile shelf and BELOW the grid, inside the `{!arrangement.readOnly && …}`
  block.
- The EN string `dashboardResetLayout` = "Reset layout".

★★ **The defect is discoverability alone.** On a full board the control sits past
every tile, in the quietest button style the design system offers. Nothing about
the reset behaviour is being changed.

## Decisions

### 1. Placement — the top-right stack, between Print and Reset size

The dashboard has no conventional toolbar row: `ReportCard` is rendered with
`hideToolbar`, and `PrintButton` + `ResetSizeButton` are a VERTICAL
`flex shrink-0 flex-col gap-2 print:hidden` stack to the right of the delta
strip. Reset layout joins that stack as its middle member.

★ **The order is fixed by the repo's own convention, not by taste.** AGENTS.md
pins the trailing group as `Print · reset-columns · reset-pane-size`. Reset
layout is the reset-columns ANALOGUE — it restores content arrangement, where
reset-size restores the pane box — so it sorts before reset-size:

    Print  →  Reset layout  →  Reset size

The old `flex justify-end` wrapper below the grid is deleted. The shelf does not
move.

### 2. The control — icon-only, `IconButton variant="bordered" size="md"`

Same shape as `ResetSizeButton`: `label` and `title` both
`t(lang, "dashboardResetLayout")`, so the accessible name and the hover tooltip
agree and the glyph carries no meaning on its own.

★ It lives in `task-manager-ui.tsx` as `ResetLayoutButton`, beside `PrintButton`
and `ResetSizeButton`. The three now render as ONE cluster and should be edited
as one; that file is already the home for this family (it also owns
`ResetSizeIcon` and `ResetColWidthsIcon`). The single-consumer YAGNI argument for
inlining it in `dashboard-panel.tsx` was considered and declined on those
grounds.

★ No new i18n key. `dashboardResetLayout` already exists in EN and DE and is
reused verbatim as both name and title.

★★ **Two adjacent reset buttons must not share an accessible name** (WCAG 2.4.6,
which axe cannot see — a name merely existing satisfies it). They do not:
`dashboardResetLayout` is "Reset layout", `tableResetSizeHint` is "Reset back to
the default size."

### 3. Icon — `ResetLayoutIcon` wrapping a NEW barrel export, `RotateCcwSquareIcon`

A thin wrapper mirroring `ResetSizeIcon` (`ArrowsPointingInIcon`) and
`ResetColWidthsIcon` (`ViewColumnsIcon`), both declared in `task-manager-ui.tsx`.

★★★ **CORRECTED 2026-09-02, BEFORE ANY CODE WAS WRITTEN. THE FIRST VERSION OF
THIS SECTION CHOSE `LayoutGridIcon` AND REJECTED `Squares2X2Icon` — THEY ARE THE
SAME PICTURE.** `icons.ts` re-exports lucide glyphs under the OLD HEROICONS
names, so its line `LayoutGridIcon as Squares2X2Icon` means lucide's
`LayoutGridIcon` IS this app's `Squares2X2Icon`. `LayoutGridIcon` is the import
side of an alias and is **not an export at all** — importing it would not
compile. The error came from grepping the barrel for icon-shaped names and
reading a source name as an available export, which is the trap AGENTS.md
already records: *a name there is NOT a claim about what lucide calls that
glyph*. Verify before substituting anything here:
`grep -n "LayoutGridIcon" src/app/icons.ts`.

★★ **EVERY BOARD-SHAPED GLYPH IN THE BARREL IS ALREADY SPOKEN FOR**, which is
why the "depict WHAT resets" rule cannot be satisfied from stock:

| Export | Real lucide glyph | Already means |
|---|---|---|
| `Squares2X2Icon` | `LayoutGrid` | the Dashboard NAV icon |
| `ViewColumnsIcon` | `Columns3` | reset-columns, the sibling reset |
| `TableCellsIcon` | `Table` | the RACI nav icon |
| `RectangleStackIcon` | `GalleryVerticalEnd` | the templates menu |
| `ArrowUturnLeftIcon` | `Undo2` | the app's real UNDO control |

★★★ `ArrowUturnLeftIcon` IS THE MOST DANGEROUS OF THOSE and must not be
borrowed: the app has a genuine undo, reset is NOT undoable, and wearing the
undo arrow would promise recovery that does not exist.

**The decision: add ONE new glyph to the barrel** — `RotateCcwSquare` from
lucide-react 1.31.0 (verified present; `displayName` is exactly
`"RotateCcwSquare"`), exported as `RotateCcwSquareIcon`. A square carrying a
counter-clockwise arrow depicts the board AND the restore, and collides with
nothing. `Grid2x2` and `LayoutDashboard` were considered and rejected: both read
as near-identical to the nav's `LayoutGrid`, which re-creates the Gantt
two-indistinguishable-glyphs hazard against the sidebar instead of against the
neighbouring button.

★★ **ADDING A BARREL EXPORT IS A THREE-PLACE EDIT, ratchet by design.**
`icons.test.ts` holds an `EXPECTED` map (app name → lucide `displayName`), a
key-set equality test, and a deliberately redundant `exports 69 icons` COUNT
whose comment says to bump the literal only on purpose. So: barrel line,
`EXPECTED` row, and 69 → 70. Its ★★★ "maps no two app names onto the same
glyph" test is what makes the collision analysis above enforceable rather than
prose — `RotateCcwSquare` is not a target of any existing row.

### 4. The read-only guard — the one real trap

The button is currently INSIDE `{!arrangement.readOnly && …}`. The top stack has
NO such gate (only `print:hidden`). Moving the button without carrying the
condition with it hands every popout a working reset on a surface that is
read-only by design — no grip, no ⋮ menu, no shelf.

The new button therefore needs its own `!arrangement.readOnly` guard at its new
site.

## Testing

### The existing popout test goes VACUOUS on this change and must be corrected

`dashboard-panel.test.tsx`'s "renders no grip, menu, shelf or reset in a popout
(read-only)" asserts the ABSENCE of the layout reset by querying for its VISIBLE
TEXT.

★★★ An icon-only button renders NO text node, so after this change that
assertion passes whether the button is guarded or not — it stops pinning the
guard at exactly the commit that introduces the trap, and reads as coverage while
providing none. It must query the accessible NAME instead
(`queryByRole("button", { name: … })`).

Verify the correction is load-bearing by mutation: drop the
`!arrangement.readOnly` guard at the new site and confirm this test goes red.
Record the result as `N failed / M passed`, where N+M is the file's RUNTIME test
count.

### New coverage

1. **Renders on an arrangeable panel** — the button is present by accessible name
   when not read-only.
2. **Order within the stack** — Print → Reset layout → Reset size, asserted with
   `expectButtonOrder` from `src/test/toolbar-order.ts`. ★ Use the shared helper,
   never a hand-rolled `findIndex`: `buttonIndex` THROWS when a key matches zero
   or several buttons, where a `findIndex` silently takes the first and lets an
   ordering assertion pass against the wrong control.
3. **Clicking it resets** — after hiding a tile from the ⋮ menu, clicking Reset
   layout brings it back. This pins the wiring at the NEW call site; the hook's
   own reset is already covered in `use-dashboard-layout.test.tsx` and is not
   re-tested here.

### Gates

`npx tsc --noEmit` (exits 2 on diagnostics, not 1), `npx eslint src`, and the
touched vitest files. No i18n key is added, so EN/DE parity is unaffected.
`dashboard-panel.tsx` is 623 lines with no `file-sizes.json` baseline, so the
ratchet has room.

## Out of scope — deliberately

- **No confirmation step.** Offered during the brainstorm and declined. One click
  still discards the tile arrangement AND every hidden-tile choice, with no undo,
  and moving the control into the top cluster makes it easier to hit by accident
  than it is today. Recorded here as an accepted, understood risk, not an
  oversight.
- **Reset layout still does not touch pane size.** That remains `resetSize` from
  `useResizable("aipm-cockpit:dashboard-size")`, its own button in the same stack.
- **`DEFAULT_LAYOUT`, `reset()` and the store are untouched.**

## Files

| File | Change |
|---|---|
| `src/app/icons.ts` | add one export: `RotateCcwSquare as RotateCcwSquareIcon` |
| `src/app/icons.test.ts` | add the `EXPECTED` row and bump the count 69 → 70 |
| `src/app/task-manager-ui.tsx` | add `ResetLayoutIcon` + `ResetLayoutButton` beside their siblings |
| `src/app/dashboard-panel.tsx` | render it in the top stack under `!arrangement.readOnly`; delete the old ghost button and its wrapper |
| `src/app/dashboard-panel.test.tsx` | de-vacuum the popout assertion; add the three tests above |
