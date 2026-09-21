# Dashboard: measured tile heights, one At-a-glance tile, one status summary

**Status:** approved in conversation 2026-09-21 · **Branch:** `feat/dashboard-adaptive-heights`,
stacked on `fix/load-save-residuals` (see "Branch base" below).

Three changes in one slice, at the user's explicit request:

- **A** — tile heights are measured from their content when the Dashboard opens, instead of being
  constants tuned against one screen.
- **B** — the Progress tile merges into "At a glance", which drops its own duplicate completion cell.
- **C** — the two status-summary surfaces become one, edited inline behind an Edit button.

## Decisions (each made by the user, in this order)

1. **Auto-sizing touches defaults only.** Every open recomputes the height of any tile the user has
   not explicitly resized; a height the user chose is kept. (Rejected: first-open-only, and a fully
   viewport-derived board with no manual resize.)
2. **Provenance is stored, not inferred.** A resize records that the user chose that axis. (Rejected:
   treating "differs from the catalogue default" as user-set — wrong for a user who resizes *to* the
   default, and wrong for everyone the moment a default changes.)
3. **Heights are measured from the DOM**, not tabulated per breakpoint and not derived from content
   facts. Its correctness is pinned by e2e only; the unit suite cannot see it.
4. **Re-measure on mount and on density change only.** Not on viewport resize (reflowing a board while
   the user reads it is hostile), not on content change (caught on the next open).
5. **All three changes ship as one slice.**
6. **B, option (i) with a tooltip:** R/A/G moves as one cell carrying its ✕ out-of-scope marker
   unchanged; the Progress caption is dropped as visible text and survives as a tooltip.
7. **C is inline:** Edit swaps the read-only summary for the editor in place. No modal.

## A — measured heights

### What changes and what does not

**Height adapts; width does not, because width already does.** `w` renders through `W_CLASS` as
`col-span-1 lg:col-span-2 xl:col-span-4`, so a tile is already full-width on a phone and a quarter on a
wide screen. The defect the user described — a layout decided at one resolution — is a HEIGHT defect:
`h` is a row count against a fixed row unit (`auto-rows-[80px]` comfortable, `72px` compact), and every
default was chosen from a measurement at one viewport. The clearest case is `kpi`, pinned at `h:3`
because its cells wrap at half width on a 1280px xl viewport, a cost every wider screen pays too.

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

- **`resizeBlock` is the only writer.** It stamps the axis it changed and no other.
- **This is a shared-engine change.** `arrangement-layout.ts` also serves Reports
  (`report-blocks.ts`, `use-reports-arrangement.ts`). Reports gets the flags and ignores them; it does
  not get measurement.
- **Absent means default, including on every layout written before this change.** Those boards are
  therefore measured once on their first open under this build. That is the intended migration, not a
  side effect: nothing on them was recorded as a user choice.
- **`isArrangementLayout` must accept the flags and `readArrangement` must sanitise them** — junk is
  dropped, never a rejection, matching how `upgrades` is handled. A flag of any value other than `true`
  is dropped rather than rejecting the layout, because rejection resets the board.
- **`reconcile` carries the flags through.** It already rebuilds `{v, board, hidden}` and carries
  `upgrades`; a flag it drops would silently turn a user's choice back into a default.

### ★★ The resize menu must show the RENDERED height

The stored `h` of an unflagged tile is its catalogue default; what the user SEES is the measured value.
If the ⋮ resize menu reports the stored value, a user who opens it on a measured-to-4 tile sees "2" and
choosing 4 looks like a no-op to them while being a real change to the store. The menu's current value
is the rendered height. Choosing it stamps `hSet` at that value — selecting a height explicitly is a
choice even when it matches what is on screen.

★ This breaks `resizeBlock`'s same-reference-on-no-op contract for exactly that case, and it must: the
contract compares against the stored value, and the stored value is not what the user is agreeing to.
The no-op contract still holds when the requested value equals the stored value AND `hSet` is already
set.

### Measurement

A hook owned by `dashboard-panel.tsx` measures once per trigger:

- **Triggers:** mount, and a change of density. Nothing else.
- **What is read:** each rendered tile body's content height — its `scrollHeight`, not its
  `clientHeight`. The body is `min-h-0 flex-1 overflow-auto`, so an over-tall tile's `clientHeight` is
  the box and says nothing about the content.
- **Conversion** is pure and unit-tested:

  ```ts
  /** Rows a tile needs so its body shows `contentPx` without an inner scroll, clamped to the spec. */
  export function rowsForHeight(
    contentPx: number, rowUnitPx: number, gapPx: number, chromePx: number,
    minH: BlockHeight, maxH: BlockHeight,
  ): BlockHeight
  ```

  A tile spanning `n` rows is `n * rowUnitPx + (n - 1) * gapPx` tall, of which `chromePx` is the header.
  The function returns the smallest `n` whose body fits `contentPx`, clamped to `[minH, maxH]`.
  `chromePx` is **measured from the tile header at runtime**, never quoted: `dashboard-tiles.ts` records
  that the old hand-quoted figure (~26px) was 11px wrong and that a chrome restyle moves it.
- **Applied only to tiles with no `hSet`.**
- **Never persisted.** A measured height is a render-time override, like gating. Were it stored it would
  be indistinguishable from a user's choice on the next open and the board would freeze at whatever the
  first screen happened to be. This follows the Dashboard's standing rule that a gate decides what
  RENDERS, never what is STORED (`docs/AGENTS/dashboard.md`) — measurement is the same kind of thing.
- **No `ResizeObserver` on the measured box.** Resizing the thing being observed is how a
  measure→resize→measure loop starts. One pass per trigger.
- **★★ Why one pass is enough, and when it would stop being enough.** A tile's content height depends
  on its WIDTH — text and cells wrap to fit it — and not on its height. Width is set by `W_CLASS` at the
  current breakpoint and does not change when a height is applied. So applying the measured height
  cannot change the measurement, and one pass converges. ★ This rests entirely on width being
  independent of height. Anything that couples them — a tile whose content switches layout on its own
  HEIGHT — breaks the argument and would need the loop guard this design omits. (`grid-flow-row-dense`
  does not: it moves a tile's POSITION, never its `col-span`, so a tile's width is the same wherever it
  lands. The KPI strip's container queries are on WIDTH, so they do not either.)
- **Rendering goes through `H_CLASS`** (`arrangement-grid.tsx`), whose keys cover 1–8. Every tile's
  `[minH, maxH]` sits inside that range, so a clamped measured height always resolves to a literal key.
  ★★★ Never interpolate a `row-span-${h}` class: Tailwind v4 emits no CSS for it and no rendered
  assertion can see the difference.
- **jsdom returns 0 for every rect.** The hook must treat an all-zero measurement as "nothing measured"
  and leave every tile at its stored height, so the unit suite keeps rendering exactly what it renders
  today.

### ★★★ The board will get taller, and that is the point

`docs/AGENTS/dashboard.md` records that at the shipped comfortable/80 density, **6 of 9 rendering tiles
already overflow** into an inner scroll (measured, 1600px, e2e seed: `burn` 507px over, `insights` 239,
`upcoming` 133), and that inner scrolling is this design's normal mode. Measuring to content removes
those inner scrolls up to each tile's `maxH`. So a default board will be noticeably taller than today's,
and tiles already at `maxH` will still scroll. That is the requested behaviour, stated here so it is not
mistaken for a regression in review.

### Catalogue changes forced by A

- **`kpi`** has `minH: 3, maxH: 3` today — its height is fixed, so measurement could not move it.
  Widen to `minH: 2, maxH: 4`. ★ These two VALUES are the controller's choice, not a user decision —
  the user approved widening, not the numbers. `minH: 2` follows the catalogue's own rule that `minH: 1`
  is almost always wrong (37px of chrome leaves a sparkline); `maxH: 4` is one row of headroom over
  today's fixed 3 for the six-cell strip. Revisit if e2e measures a six-cell strip needing more. (The fixed height existed to stop the half-width wrap reaching an inner
  scroll; measurement now does that job, and does it per screen.)
- **Reset layout** clears every `wSet`/`hSet`, so every tile is measured again on the next render.

## B — Progress merges into At a glance

### The duplicate

Both tiles show completion: At a glance's first cell is `dashboardKpiComplete` (a percentage only);
Progress's first card is `dashboardPercentComplete` with `dashboardCompletedOf` beneath it ("18 of 29").
**At a glance's cell is dropped and Progress's richer card takes its place** — that is the direction the
user specified, and the count is the information the percentage alone lacks.

### The merged tile

At a glance renders, in order:

1. **Complete** — Progress's card, unchanged, including the no-active-scope wording from
   `hasNoActiveScope`, which must be called rather than re-derived.
2. **R / A / G** — Progress's card, unchanged, **including the ✕ out-of-scope marker** shown only when
   `outOfScope > 0`, with its `aria-hidden` glyph and `sr-only` companion.
3. **Overdue**, 4. **Open RAID** — unchanged.
5. **Effort SPI**, 6. **Effort CPI** — unchanged, each shown only when its index is non-null.

**The Progress caption becomes a tooltip.** `dashboardProgressCaption` moves from visible text to the
`hint` of the Complete card, which the `Tile` component already supports and the R/A/G card already uses.

### Cell count

`KpiCellCount` widens from `3 | 4 | 5` to `4 | 5 | 6` — the tile now always carries Complete, R/A/G,
Overdue and Open RAID. `KPI_STRIP_COLS` gets an entry for each, as whole literal class strings.
★ The 4- and 5-cell entries change meaning (they previously described a board WITHOUT R/A/G), so both
are re-derived rather than carried over.

### Removing the Progress tile

- `progress` leaves `DASHBOARD_TILES`.
- **A one-time upgrade id** (same mechanism as `DASHBOARD_BURN_UPGRADE`) removes it from stored layouts'
  `board` and `hidden` lists. `reconcile` alone would also drop an unknown id, but only silently; the
  upgrade records that the removal happened.
- **`DEFAULT_LAYOUT` must carry the new id** alongside `DASHBOARD_BURN_UPGRADE`. A fresh or reset board is
  persisted from it; without the id, its next load would run the upgrade again.

## C — one status summary

- `NarrativeSummary` (read-only, top of the Dashboard) gains an **Edit** button.
- Edit swaps the summary for the existing `NarrativeEditor` **in place**. The editor keeps its
  commit-on-blur, its Save and Clear, and its `seedNonce` behaviour — the nonce is the only thing that
  empties the editor DOM on Clear, and it has already caused a bug once.
- Save or a committed blur returns to the read-only view.
- **The bottom `NarrativeEditor` instance is deleted.**
- The Edit button is a real `<button>` with an accessible name that says what it edits, and focus moves
  into the editor on open and back to the Edit button on close. Read `docs/AGENTS/ui-shell.md`'s
  dismissal section before wiring Escape.

## Testing

**Unit (vitest):**

- `rowsForHeight` — exact at the boundaries (content that exactly fills `n` rows), clamping at both ends,
  and a zero-content input.
- Provenance — `resizeBlock` stamps only the moved axis; `reconcile` carries both flags;
  `readArrangement` drops a non-`true` flag without rejecting the layout; Reset clears them.
- The resize menu reports the rendered height, and choosing it stamps `hSet`.
- The jsdom no-op — with every rect 0, every tile renders at its stored height.
- The upgrade — removes `progress` from `board` and from `hidden`, is recorded, runs once, and is carried
  by `DEFAULT_LAYOUT`.
- The merged tile — each of 4, 5 and 6 cells renders the right cells in the right order; the ✕ appears
  only when `outOfScope > 0`; the Complete card carries the caption as its hint.
- C — Edit opens the editor in place, Save returns to the summary, the bottom instance is gone.

**e2e (Playwright), the only witness for A:**

- A tile with no `hSet` renders at its measured height and its body has no inner scroll unless it is at
  `maxH`.
- An explicitly resized tile keeps its height across a reload.
- A density change re-measures.
- Every assertion that depends on a measured height reads a measured value from the page, never a
  number written into the spec — the measured-in-Chromium figures in this repo's docstrings have been
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
