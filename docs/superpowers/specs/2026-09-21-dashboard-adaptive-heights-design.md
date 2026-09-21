# Dashboard: measured tile heights, one At-a-glance tile, one status summary

**Status:** revision 2, 2026-09-21. The first revision was approved, then a read-only reconnaissance of
the code found 17 places where it did not match the tree. This revision corrects all 17 and adds
decision 8, so it replaces the approval of revision 1. See "What revision 2 changed" at the end.

**Branch:** `feat/dashboard-adaptive-heights`, stacked on `fix/load-save-residuals` (see "Branch base").

Three changes in one slice, at the user's explicit request:

- **A**: tile heights are measured from their content when the Dashboard opens, instead of being
  constants tuned against one screen.
- **B**: the Progress tile merges into "At a glance", which ends up with one completion cell, not two.
- **C**: the two status-summary surfaces become one, edited inline behind an Edit button.

## Decisions (each made by the user, in this order)

1. **Auto-sizing touches defaults only.** Every open recomputes the height of any tile the user has
   not explicitly resized; a height the user chose is kept. (Rejected: first-open-only, and a fully
   viewport-derived board with no manual resize.)
2. **Provenance is stored, not inferred.** A resize records that the user chose that axis. (Rejected:
   treating "differs from the catalogue default" as user-set. That is wrong for a user who resizes *to*
   the default, and wrong for everyone the moment a default changes.)
3. **Heights are measured from the DOM**, not tabulated per breakpoint and not derived from content
   facts. Its correctness is pinned by e2e only; the unit suite cannot see it.
4. **Re-measure on mount and on density change only.** Not on viewport resize (reflowing a board while
   the user reads it is hostile), not on content change (caught on the next open).
5. **All three changes ship as one slice.**
6. **B, option (i) with a tooltip:** R/A/G moves as one cell carrying its ✕ out-of-scope marker
   unchanged; the Progress caption is dropped as visible text and survives as a tooltip.
7. **C is inline:** Edit swaps the read-only summary for the editor in place. No modal.
8. **The two completion cells merge.** The merged cell keeps the count, the gradient bar and the trend
   arrow. (Rejected: keeping only Progress's card, which would have removed the completion bar and the
   Dashboard's only completion-trend display.)

## A: measured heights

### What changes and what does not

**Height adapts. Width does not need to, because it already does.** `w` renders through `W_CLASS` as
`col-span-1 lg:col-span-2 xl:col-span-4`, so a tile is already full width on a phone and a quarter of
the board on a wide screen. The defect the user described, a layout decided at one resolution, is a
height defect. `h` is a row count against a fixed row unit, and every default was chosen from a
measurement at one viewport. The clearest case is `kpi`, fixed at `h:3` because its cells wrap at half
width on a 1280px xl viewport. Every wider screen pays that cost too.

### Provenance on the stored layout

`PlacedBlock<Id>` in `arrangement-layout.ts` gains two optional flags:

```ts
export interface PlacedBlock<Id extends string> {
  id: Id;
  w: BlockWidth;
  h: BlockHeight;
  /** Set by `resizeBlock` when the USER chose this axis. Absent = the value is a default. */
  wSet?: true;
  hSet?: true;
}
```

- **`resizeBlock` is the only writer.** It stamps the axis it was asked to set, and no other.
- **This is a shared-engine change.** `arrangement-layout.ts` also serves Reports (`report-blocks.ts`,
  `use-reports-arrangement.ts`). Reports gets the flags and ignores them; it does not get measurement.
- **Absent means default, including on every layout written before this change.** Those boards are
  measured on their first open under this build. That is the intended migration: nothing on them was
  recorded as a user choice.

### `reconcile` must be REWRITTEN to carry the flags, and it becomes the sanitiser

`reconcile` rebuilds every block as a literal `{ id, w, h }`. So today it drops unknown keys, which is
also the only thing that strips junk from a stored block: `isArrangementLayout` accepts extra keys, and
`withSanitizedUpgrades` touches only the layout-level `upgrades` list. Carrying the flags means
rewriting that literal. Rewriting it naively (a spread) would remove the accidental sanitiser.

So the rewritten literal keeps a flag **only when its value is exactly `true`**:

```ts
{
  id, w, h,
  ...(stored.wSet === true ? { wSet: true } : {}),
  ...(stored.hSet === true ? { hSet: true } : {}),
}
```

A flag survives the per-axis clamp: a user's chosen height that the clamp moves is still a user
choice, so `hSet` stays. `isArrangementLayout` needs no change, because it already ignores extra keys.

### The no-op contract changes, and two tests invert

The engine header says the four mutators return the same object reference on a no-op. For
`resizeBlock` that stops being true in one case, and the case is deliberate:

- **Choosing a value on an axis with no flag stamps the flag and returns a new object, even when the
  value equals the stored one.** Selecting a height is a choice. The resize control (`SegmentedControl`)
  fires `onChange` on a click of the already-selected option, so that click does reach `resizeBlock`.
- **Same value, axis already flagged, is still a no-op** that returns the same reference.

Two tests assert the old contract on an unflagged block and invert: `arrangement-layout.test.ts`
"returns the same object when a resize changes nothing", and `dashboard-layout.test.ts` "returns the
same object when the value does not change". Each is rewritten to test the no-op on a FLAGGED block,
and each gains a sibling asserting that the unflagged case stamps and returns a new object.
`dashboard-layout.test.ts` "sets one axis without touching the other" does an exact
`toEqual({ id, w, h })` and must include the stamped flag. The engine header's no-op sentence is
reworded to state the exception.

### ★★ Every reader of the tile's height must read the RENDERED height

The stored `h` of an unflagged tile is its catalogue default. What the user sees is the measured value.
The panel reads the stored height in three places:

1. the tile's rendered height,
2. the resize menu's current value,
3. the resize announcement spoken after a change.

All three must read the rendered (measured, or stored if flagged) height. If the menu reported the
stored value, a user looking at a tile measured to 4 would see "2", and choosing 4 would look like a
no-op to them while being a real change to the store. If the announcement read it, a width change on a
measured tile would announce the wrong height.

### Measurement

A hook owned by `dashboard-panel.tsx` measures once per trigger.

- **Triggers:** mount, and a change of density. Nothing else. Density reaches the panel as a prop.
  ★ A width change (the ⋮ menu) or a breakpoint change (resizing the window) is NOT a trigger, by the
  user's choice of mount and density only. Content height depends on width, so a tile widened or
  narrowed this way keeps its measured height until the next open, and may scroll inside itself
  until then. (The implementation also re-measures when the set of rendered tiles or a tile's `hSet`
  flag changes, which is what makes Reset re-measure; neither is a width change.)
- **What is measured: the height of the body's CONTENT, never the body's `scrollHeight`.** The body is
  `min-h-0 flex-1 overflow-auto`. When content fits, its `scrollHeight` equals the box height, so a
  `scrollHeight` reading can grow a tile but never shrink it below the height it was rendered at. The
  measured value is the **vertical extent of the body's element children** (the last child's
  `getBoundingClientRect().bottom` minus the first child's `.top`) plus the body's computed vertical
  padding. That reading does not depend on the box height, so it can shrink a tile as well as grow it.
- **★★ No wrapper is added around the body's children to measure them, and adding one would be a
  regression.** The body renders `{children}` directly. A wrapper of automatic height would make every
  child styled `h-full` resolve against an auto height and collapse. The children-extent reading
  needs no wrapper, so rendering is unchanged. A child that fills the box (`h-full` against the body)
  would measure as the box and so keep the height it has, which is the honest outcome for content
  with no natural height. ★★ No current Dashboard tile body has such a child. The `h-full` that
  appears inside tile bodies (for example `Tile`'s hint wrapper in `report-table.tsx`) resolves
  against its own cell, not against the body. Re-check before relying on this: grep `h-full` in the
  components `dashboard-tile-bodies.tsx` imports. ★★ The charts do NOT fill their tile. This spec
  first said they did, and it was false for `burn`: `BurndownChart` renders an `<svg className="w-full">`
  with a `viewBox`, so its height follows its WIDTH. `burn` therefore has a natural height and
  measures to it: well under its tall catalogue default on the e2e seed, which `e2e/dashboard-grid.spec.ts`
  "a tile measured shorter than its default renders shorter" reads off the page. That is the design
  working, not a regression. (Revision 2 as first written said "the content
  element" and listed a `content` data attribute. No such element exists, and creating one would
  cause the collapse described here.)
- **Measurement runs in a `requestAnimationFrame` callback scheduled from an effect**, following
  `tour-overlay.tsx`. A synchronous `setState` in an effect body trips `react-hooks/set-state-in-effect`,
  which is fatal in this repo. The rAF callback also lets the freshly rendered board lay out before any
  rect is read. Content that finishes loading after that frame (a lazily loaded body) is caught on the
  next open, which decision 4 already accepts.
- **Nothing is quoted; everything is read.** Row unit and gap exist in the code only as Tailwind class
  strings (`auto-rows-[80px]`, `gap-4`), and `gap-4` is rem-based, so a literal 16 would assume a 16px
  root. Both are read from the grid element's computed style (`gridAutoRows`, `rowGap`). The non-body
  height of a tile (header plus section borders) is read as the section's height minus the body's
  `clientHeight`. The spec's first revision left out the 2px section border; reading the difference
  makes that class of omission impossible. `dashboard-tiles.ts` records that a hand-quoted chrome
  figure was once 11px wrong.
- **Conversion** is pure and unit-tested:

  ```ts
  /** Rows a tile needs so its body shows `contentPx` without an inner scroll, clamped to the spec. */
  export function rowsForHeight(
    contentPx: number, rowUnitPx: number, gapPx: number, nonBodyPx: number,
    minH: BlockHeight, maxH: BlockHeight,
  ): BlockHeight
  ```

  A tile spanning `n` rows is `n * rowUnitPx + (n - 1) * gapPx` tall, of which `nonBodyPx` is not body.
  The function returns the smallest `n` whose body fits `contentPx`, clamped to `[minH, maxH]`.
- **Measurement targets are marked with data attributes on the shared tile.** The header and body are
  anonymous `div`s today, and the grid takes no ref. The hook finds them through `data-*` attributes
  added to `arrangement-tile.tsx` (section and body; the header is not needed, because the non-body
  height is read as section minus body) and `arrangement-grid.tsx` (grid).
  Those components are shared with Reports, where the attributes are inert.
- **Applied only to tiles with no `hSet`.**
- **Never persisted.** A measured height is a render-time override, like gating. If it were stored it
  would be indistinguishable from a user's choice on the next open, and the board would freeze at
  whatever the first screen happened to be. This follows the Dashboard's standing rule that a gate
  decides what RENDERS, never what is STORED (`docs/AGENTS/dashboard.md`).
- **No `ResizeObserver` on the measured box.** Resizing the thing being observed is how a
  measure-resize-measure loop starts. One pass per trigger.
- **★★ Why one pass is enough, and when it would stop being enough.** A tile's content height depends
  on its WIDTH (text and cells wrap to fit it), not on its height. Width is set by `W_CLASS` at the
  current breakpoint and does not change when a height is applied. So applying the measured height
  cannot change the measurement, and one pass converges. This rests entirely on width being
  independent of height. A tile whose content switches layout on its own HEIGHT would break the
  argument and would need the loop guard this design leaves out. (`grid-flow-row-dense` does not break
  it: it moves a tile's POSITION, never its `col-span`. The KPI strip's container queries are on WIDTH,
  so they do not break it either.)
- **Rendering goes through `H_CLASS`** (`arrangement-grid.tsx`), whose keys cover 1–8. Every tile's
  `[minH, maxH]` sits inside that range, so a clamped measured height always resolves to a literal key.
  ★★★ Never interpolate a `row-span-${h}` class: Tailwind v4 emits no CSS for it, and no rendered
  assertion can see the difference.
- **jsdom returns 0 for every rect.** The hook treats an all-zero reading as "nothing measured" and
  leaves every tile at its stored height, so the unit suite renders exactly what it renders today.

### ★★★ The board will get taller, and that is the point

`docs/AGENTS/dashboard.md` records that at the shipped comfortable density, 6 of 9 rendering tiles
overflowed into an inner scroll (1600px, e2e seed: `burn` 507px over, `insights` 239, `upcoming` 133).
That figure predates this change and the sample master's effort data, so it is an order of magnitude,
not a prediction. Measuring to content removes those inner scrolls up to each tile's `maxH`, so a
default board will be noticeably taller than today's, and a tile already at `maxH` will still scroll.
That is the requested behaviour. It is written down so it is not mistaken for a regression in review.

### `kpi`'s height becomes adjustable

`kpi` has `minH: 3, maxH: 3` today, so its height is fixed and measurement could not move it. It widens
to `minH: 2, maxH: 4`. ★ These two VALUES are the controller's choice, not a user decision: the user
approved widening, not the numbers. `minH: 2` follows the catalogue's own rule that `minH: 1` is almost
always wrong (header and borders leave room for a sparkline and nothing else). `maxH: 4` gives one row
of headroom over today's fixed 3 for the six-cell strip. Revisit if e2e measures a six-cell strip that
needs more.

The fixed height is asserted in several places that change with it: the `kpi` paragraph in
`dashboard-tiles.ts`'s docstring, a matching note in `arrangement-block-menu.tsx`,
`dashboard-grid.test.tsx` "renders no height chooser for the KPI tile" (which inverts, because a
chooser now renders), the `kpi` height assertions in `dashboard-layout.test.ts`, and the dense-packing
comment in `e2e/dashboard-grid.spec.ts`. The §585 upgrade maps a stored `kpi` `h: 2` to 3; that stays
harmless, because those layouts carry no `hSet` and are measured anyway.

### Reset layout

Reset writes `DEFAULT_LAYOUT` by reference. That layout carries no flags, so Reset already clears every
choice and every tile is measured again. No change is needed.

## B: Progress merges into At a glance

### The merged completion cell (decision 8)

At a glance's completion cell and Progress's first card both show completion. The merged cell **is At
a glance's existing Complete cell, extended**, not Progress's card with parts moved into it:

- **Kept exactly as today:** its label ("Complete"), its activate label ("Complete – Open the tasks
  list"), the gradient bar (`KpiGradientBar`), the trend arrow (`TrendArrow` for `trends.complete`,
  the only place the landing-page completion trend renders), and its no-active-scope behaviour,
  including suppressing its tooltip in that state. The tests pinning each of these keep passing.
- **Gained from Progress:** the count, the value `dashboardCompletedOf` renders ("18 of 29").
- **The Progress caption splits between the two cells it describes.** `dashboardProgressCaption` is
  two sentences. The first is about COMPLETION ("completed tasks vs tasks in scope, cancelled work out
  of both"). The second is about the R/A/G SPLIT ("delivered work counts Green, cancelled work is
  counted separately"). Putting both in the Complete tooltip would describe the wrong cell. So
  `Tile.hint`, which takes a single string, carries:
  - on **Complete**, a new key `dashboardCompleteHint`: `dashboardKpiCompleteHint` plus the caption's
    first sentence. Still suppressed in the no-active-scope state.
  - on **R / A / G**, a new key `dashboardRagSplitHint`: the caption's second sentence.
  Both are added to `i18n.ts` and `i18n.de.ts`. The German for both is taken verbatim from the two
  existing keys, so nothing is newly translated.
- ★ This also corrects the R/A/G tooltip. Its current `dashboardRagHint` says "health counts across
  your project areas", but the card counts TASKS by health (`model.progress.counts`). The caption's
  sentence is the accurate description. `dashboardRagHint` is removed if nothing else references it.

Progress's own completion card is dropped, which removes the duplicate.

### The merged tile's cells

At a glance renders, in order:

1. **Complete**, the merged cell above.
2. **R / A / G**, Progress's card, **including the ✕ out-of-scope marker** shown only when
   `outOfScope > 0`, with its `aria-hidden` glyph and `sr-only` companion. Its tooltip becomes
   `dashboardRagSplitHint` (above). Everything else on the card is unchanged.
3. **Overdue**, then 4. **Open RAID**, both unchanged.
5. **Effort SPI**, then 6. **Effort CPI**, each shown only when its index is non-null, unchanged.

The no-active-scope wording comes from `hasNoActiveScope(progress)`, which is called, never re-derived.

### Cell count

`KpiCellCount` changes from `3 | 4 | 5` to `4 | 5 | 6`, because the tile now always carries Complete,
R/A/G, Overdue and Open RAID. `KPI_STRIP_COLS` gets an entry for each, as whole literal class strings.
★ The 4- and 5-cell entries change meaning (they previously described a strip WITHOUT R/A/G), so both
are re-derived, not carried over.

### Removing the Progress tile

`progress` leaves `DASHBOARD_TILES`. Stored layouts that mention it need a one-time removal, and **the
existing upgrade mechanism cannot take a second step as it stands.** The burn upgrade is one
hand-written function that returns early when its own id is already recorded, and the hook accepts a
single `upgrade` function. A progress-removal step placed after that early return would be skipped for
every user already upgraded, which is exactly the population that needs it.

So the upgrade is restructured into **an ordered list of steps, each gated on its own id and each run
independently**:

```ts
interface LayoutUpgradeStep {
  id: string;
  /** Returns the SAME object when there is nothing to change. */
  apply: (layout: DashboardLayout) => DashboardLayout;
}
```

- The burn step is the existing function, moved into the list, with behaviour unchanged.
- The progress step removes `progress` from both `board` and `hidden`.
- **The progress step records its id only when it removed something.** A layout without `progress`
  returns the same object, records nothing, and is not written. That keeps the pinned test
  `use-dashboard-layout.test.tsx` "never runs again: a burn the user moved back keeps its place", which
  asserts byte-identical storage for a layout with no progress tile. Re-running the step on such a
  layout is free: it finds nothing and changes nothing.
- **`DEFAULT_LAYOUT` does NOT need the progress id.** After `progress` leaves the catalogue, a fresh or
  reset board never contains it, so the step is a no-op on it. (The first revision required the id on
  `DEFAULT_LAYOUT`; with a record-only-on-removal step, that requirement goes away.)

### The test tile that replaces Progress

About 20 panel and layout tests, `e2e/seed-content.spec.ts`, and the dense-packing test in
`e2e/dashboard-grid.spec.ts` use Progress as their always-present tile. They move to **`upcoming`**:
`gate: ALWAYS`, `minH: 2`, `maxH: 4`.

★★ `upcoming` is itself measured under A, so a test that expects it at a fixed height would depend on
measurement. Each such test **resizes it explicitly first**, which stamps `hSet` and makes its height a
recorded choice, stable by construction. `e2e/dashboard-grid.spec.ts`'s exact-height check on
`upcoming` and its KPI-strip loop (which assumes 5 and 4 cells, now 6 and 5) are updated to match.

## C: one status summary

### The summary area always renders

`NarrativeSummary` returns `null` when the narrative is empty, and two tests pin that. With the bottom
editor deleted, a self-hiding summary would leave no way to write a first narrative, or a new one after
Clear: `NarrativeEditor` is the only UI writer of `status.narrative`. So:

- **The summary area always renders.** With a narrative it shows the narrative and an **Edit status
  summary** button. When empty it shows an **Add status summary** button. Two new i18n keys, in
  `i18n.ts` and `i18n.de.ts`.
- The two tests pinning `null` when empty invert: they assert the Add button instead.

### Editing

- Edit or Add swaps the summary for the existing `NarrativeEditor` **in place**.
- **The editor keeps its commit-on-blur, its Save and Clear, and its `seedNonce` behaviour unchanged.**
  The nonce is the only thing that empties the editor DOM on Clear, and it has caused a bug once.
- **★★ The editor returns to read-only on Save, or when focus leaves the WHOLE editor region, and on
  nothing else.** The commit-on-blur wrapper uses React's `onBlur`, which is `focusout` and bubbles, so
  it also fires when focus moves from the text to the editor's own toolbar. `dashboard-narrative.tsx`
  records that this once meant a toolbar mousedown committed and replaced the editor before the click,
  so no format command ever ran, and the test "applies Bold to the selection instead of losing the
  click to a remount" pins it. Closing on that same blur would reintroduce the defect one level up. The
  close rule reads the event's `relatedTarget`: focus moving to anything inside the editor wrapper
  keeps it open. `commitNarrative` returns early when nothing changed, so "a blur" and "a committed
  blur" are different events, and the close rule keys on focus leaving, not on a commit.
- **Focus moves into the editor on open, and back to the Edit button on close.** `RichTextEditor` has no
  `autoFocus` prop, its imperative handle exposes only `appendText`, and it is loaded through
  `next/dynamic` with a skeleton fallback first. So it gains a focus capability (a `focus()` method on
  the handle), and the open path waits for the editor to mount before calling it.
- `NarrativeEditor` gains an `onDone` callback, which is how it signals "return to read-only".
- **The bottom `NarrativeEditor` instance is deleted.**
- **No Edit or Add button in a read-only popout.** The editor is not popout-gated today (only
  `print:hidden`). Every arrangement control is guarded by `!arrangement.readOnly`, and a popout is
  documented as read-only, so the buttons carry the same guard.
- Read `docs/AGENTS/ui-shell.md`'s dismissal section before wiring Escape.

## Testing

**Unit (vitest):**

- `rowsForHeight`: exact at the boundaries (content that exactly fills `n` rows), clamping at both
  ends, a zero-content input, and a case that SHRINKS a tile below its current height.
- Provenance: `resizeBlock` stamps only the axis it set; choosing the current value on an unflagged axis
  stamps and returns a new object; the same value on a flagged axis returns the same reference;
  `reconcile` carries a `true` flag, drops a non-`true` one, and keeps `hSet` through a clamp; Reset
  clears them.
- The three height readers (rendered height, menu value, announcement) all read the rendered height.
- The jsdom no-op: with every rect 0, every tile renders at its stored height.
- The upgrade steps: the progress step removes `progress` from `board` and from `hidden` and records
  its id; on a layout without `progress` it returns the same object and records nothing; an
  already-burn-upgraded layout still gets the progress removal; the burn step's existing tests are
  unchanged.
- The merged tile: 4, 5 and 6 cells each render the right cells in the right order; the Complete cell
  keeps its bar and trend arrow and gains the count; its combined tooltip is suppressed in the
  no-active-scope state; the ✕ appears only when `outOfScope > 0`.
- C: the Add button renders when the narrative is empty; Edit and Add open the editor in place; Save
  returns to the summary; focus moving to the toolbar keeps the editor open (the Bold test still
  passes); focus leaving the region closes it; no Edit or Add button when read-only; the bottom
  instance is gone.

**e2e (Playwright), the only witness for A:**

- A tile with no `hSet` renders at its measured height, and its body has no inner scroll unless it is at
  `maxH`.
- A tile measured SHORTER than its default renders shorter (this catches a `scrollHeight`-style
  measurement that can only grow).
- An explicitly resized tile keeps its height across a reload.
- A density change re-measures.
- Every assertion that depends on a measured height reads a measured value from the page, never a
  number written into the spec. The measured-in-Chromium figures in this repo's docstrings have been
  wrong before.

## Branch base

Stacked on `fix/load-save-residuals`, not on `origin/main`. That branch authored effort onto the sample
master so the demo shows SPI and CPI, which is what makes a six-cell At a glance reachable in the demo
and in the e2e seed. If `fix/load-save-residuals` changes before it merges, this branch rebases onto it.

## Out of scope

- Measuring width.
- Re-measuring on viewport resize or on content change.
- Measurement on Reports.
- Changing the row unit or the density model.

## What revision 2 changed

Revision 1 was approved before a read-only reconnaissance compared it with the code. That pass found 17
mismatches, and they were not small. Revision 1 would have measured with `scrollHeight` (which can
only grow a tile), left out the section border, assumed numeric row units that do not exist, placed a
second upgrade after an early return that skips it, deleted the only way to write a first narrative,
and closed the editor when its own toolbar took focus. Decision 8 was added because revision 1 quietly
dropped the Dashboard's only completion-trend display. Every decision the user made in revision 1
stands; what changed is how they are carried out.
