# Dashboard layout rework — design

**Status:** approved 2026-09-17. Spec C of three brainstormed together; A is
`2026-09-17-burndown-chart-hover-readout-design.md`, B is
`2026-09-17-forecast-switch-and-budget-report-row-design.md`. C ships last: it hosts the chart A
and B change.

## Goal

The dashboard's first screen answers three questions without scrolling: what changed since I last
looked, what the one thing to do now is, and how the project is doing overall. The budget chart
becomes big enough to read, and the numbers that crowded it move to where they belong.

## Today (verified 2026-09-17)

- `dashboard-panel.tsx` renders, in order: a row holding `DashboardDeltaStrip` beside the vertical
  control stack (`PrintButton`, `ResetLayoutButton` gated on `!arrangement.readOnly`,
  `ResetSizeButton`), then `NarrativeSummary`, `DashboardCoachingCard`, `DashboardTipCard`,
  `DigestCardConnected`, `DashboardHero` (the Overall-RAG band plus the Adjust-health disclosure),
  then `DashboardGrid` with the arrangeable tiles, then `DashboardShelf` (hidden-tile tray) gated
  on `!arrangement.readOnly`.
- Everything above the grid is fixed and full width; only the grid holds arrangeable tiles.
- `DASHBOARD_TILES` (`dashboard-tiles.ts`) holds 11 tiles. `TileSpan` is an alias of the engine's
  `BlockSpan`, a closed `1 | 2 | 3 | 4` union shared with the Reports arrangement.
  `burn` is `w:1 h:3 minW:1 maxW:2 minH:3 maxH:4`; `completionTrend` is
  `w:2 h:1 minW:2 maxW:4 minH:1 maxH:2`.
- `W_CLASS` / `H_CLASS` (`arrangement-grid.tsx`) are whole literal Tailwind strings per span, rows
  1–4 only. The row unit is density-gated: `auto-rows-[80px]` comfortable, `[72px]` compact
  (`dashboard-density.ts`).
- The Budget burn tile body (`dashboard-tile-bodies.tsx`) renders the forecast headline, a Spent
  tile, an hours tile, the FX rollup notice, Effort SPI and Effort CPI tiles, and then the compact
  `BurndownChartPanel`.
- `ActionHeroCard` (`action-hero-card.tsx`) is used by `actions-panel.tsx` only; the dashboard does
  not import it. `ActionsPanel` threads one shared handler/config bundle to both `ActionRow` and
  `ActionHeroCard`.
- Stored layouts carry no version. `reconcile(catalogue, stored, fallback)` structurally unions the
  stored board with the live catalogue on every load: unknown ids drop, new catalogue tiles are
  appended to the board. Storage is per-device, per-project localStorage
  (`arrangement-store.ts`); write failures are swallowed.
- Effort SPI and Effort CPI drive real decisions from the computed model, not from the tile:
  `evmIndexHealth(evm.spi)` is worst-of'd into the Schedule RAG and `evmIndexHealth(evm.cpi)` into
  the Budget RAG (`dashboard.ts`); `next-actions/providers/schedule.ts` gates and severity-scores an
  action on SPI against user-configurable thresholds; `next-actions/trends.ts` `spiTrend` halves a
  static penalty in two providers. None of that reads the tile's DOM.

## Decisions

1. **Row 1:** "Since you last looked" takes the free width, the weekly status digest sits beside it
   at about one third, and the control stack stays on the far right. When the digest self-hides,
   the delta strip takes the whole width. The row stacks below `lg`.
2. **The hidden-tiles control becomes a badge button** in the control stack, directly under Reset
   size, the same size as it, showing the count and no words. Its accessible name states the count
   in words ("3 hidden tiles"), which contains the visible number. It toggles the tray, which now
   renders directly under row 1 instead of under the grid. It is not rendered when the count is 0,
   except while a tile is being dragged — it remains the drag-to-hide drop target, so during a drag
   it shows regardless. Never rendered in a popout (`arrangement.readOnly`).
3. **Row 2:** the Next-Actions hero card on the left, the Overall status card on the right, equal
   height, stacking below `lg`. With no Now/Soon action the hero is absent and Overall status takes
   the whole row.
4. **The hero is the same `ActionHeroCard`**, fed the same grouped next-actions data and the same
   handler bundle `ActionsPanel` passes it. In a popout it renders without handlers, as that panel
   already does for read-only surfaces.
5. **The Top actions tile keeps showing the hero's action** — no de-duplication. (Explicit
   decision; the alternative was considered and rejected.)
6. **Order after row 2:** status narrative → first-open coaching → tip of the day (unchanged) →
   grid.
7. **Budget burn becomes chart-only** and 2 wide × 8 tall by default, resizable 1–4 wide and 4–8
   tall, and it is first in `DEFAULT_LAYOUT`. Its body renders the compact `BurndownChartPanel`
   alone — the forecast headline, Spent, hours, the FX rollup notice and the two index tiles all
   leave the tile.
8. **Effort SPI and Effort CPI move into the KPI tile**, keeping their existing labels
   (`evmSpi`/`evmCpi`) and hint texts (`evmSpiHint`/`evmCpiHint`). They are the only figures on the
   dashboard that explain a Schedule or Budget badge that has gone amber on the index alone, so
   they stay on the dashboard rather than being dropped. No computation changes.
9. **Completion trend** becomes `h:2 minH:2 maxH:4`.
10. **Heights 5–8 exist for the Dashboard only.** The span union widens for HEIGHT, with `H_CLASS`
    gaining literal `row-span-5` … `row-span-8` entries; the Reports arrangement keeps a maximum
    height of 4 through its own catalogue's `maxH`, not through the type. Widths stay 1–4.
11. **Saved layouts get a one-time upgrade.** A version stamp is added to the stored shape. On the
    first load after release, per device and project: Budget burn moves to the front of the board
    and takes 2×8 unless the user has hidden it (a hidden tile stays hidden, and restoring it then
    gives it the new catalogue default); Completion trend's height is clamped into 2–4. Every other
    tile keeps its saved order, size and hidden state. The upgrade then stamps the current version
    and never runs again.

## Layout

```
row 1  [ since you last looked            ][ weekly digest ][ Print        ]
                                                            [ Reset layout ]
                                                            [ Reset size   ]
                                                            [ 3            ]
tray   [ hidden tiles: Trends ↺  Changes ↺ ]            (only while open)
row 2  [ next-action hero                 ][ overall status (A)            ]
       [ status narrative ]
       [ coaching (first open) ]
       [ tip of the day ]
grid   [ budget burn 2×8 (chart only) ][ kpi 4×2 incl. Effort SPI/CPI ]
       [ … remaining tiles, user order … ]
```

## Components

| File | Change |
|---|---|
| `dashboard-panel.tsx` | Row 1 gains the digest column and the badge; the tray moves under row 1; row 2 is new and mounts `ActionHeroCard` beside `DashboardHero`; the order below row 2 is narrative → coaching → tip → grid. The `!arrangement.readOnly` guard stays at each control's own site. |
| `dashboard-hidden-badge.tsx` (new) | The count badge button: same box as `ResetSizeButton`, count-only label, accessible name with the count, drop target during a drag, absent at 0 unless dragging. |
| `dashboard-shelf.tsx` | The tray splits from its toggle: the badge owns the toggle, the tray renders where the panel places it, and the `aria-controls` target stays mounted. Focus after Restore returns to the badge. |
| `dashboard-tiles.ts` | `burn` → `w:2 h:8 minW:1 maxW:4 minH:4 maxH:8`, first in the catalogue order; `completionTrend` → `h:2 minH:2 maxH:4`. |
| `arrangement-layout.ts` / `arrangement-grid.tsx` | Height span union widened to 8; `H_CLASS` gains four literal classes. Width union untouched. Reports' catalogue caps its own heights at 4. |
| `arrangement-store.ts` + `use-arrangement.ts` | The stored shape gains a version; the read path runs the upgrade before `reconcile`. `reconcile`'s existing identity behaviour is not touched (it always returns a fresh object — nothing may build a persist-skip on reference equality). |
| `dashboard-layout-upgrade.ts` (new, pure) | `upgradeDashboardLayout(stored): Layout` — the one-time migration of decision 11, version-stamped and idempotent. |
| `dashboard-tile-bodies.tsx` | Burn body reduced to the compact chart; Effort SPI/CPI tiles move into the KPI body with their hints. |
| `dashboard.ts` / `task-manager.tsx` / `workspace-section.tsx` | Thread the grouped next-actions data and the handler bundle the hero needs into the dashboard, mirroring how `ActionsPanel` receives them. No new computation: the same grouped actions the Top actions tile already uses. |
| `i18n.ts` / `i18n.de.ts` | The badge's accessible name (with count placeholder `{0}`) and any new row headings. DE edited only via a Node UTF-8 write against `\r\n` anchors. |
| `docs/AGENTS/dashboard.md` | Updated for the new fixed rows, the badge/tray split, the height range, the version stamp and the burn tile's contents. |

## Accessibility

- The badge is a real button with a name stating the count; the number alone is the visible text and
  is contained in that name (WCAG 2.5.3).
- The tray stays always-mounted and `hidden`-toggled so the `aria-controls` target exists.
- Row 2's two cards are equal height via the row's stretch alignment, not by a hard-coded pixel
  height, so a long hero does not clip.
- The hero's CTAs keep the accessible names they have on the Next Actions page; two identical names
  on one screen (hero and Top actions tile, which keep the same action) must stay distinguishable —
  the tile's rows already carry row-unique tokens, and a unit test pins that the hero's and the
  tile's controls do not collide.
- A `RagBadge` next to clickable text keeps its `aria-hidden` wrapper where the text already says
  the state.
- Axe cannot see duplicate accessible names, colour-only state or label-in-name, so those three are
  pinned by unit tests.

## Testing

- `dashboard-layout-upgrade.test.ts`: runs once and stamps the version; burn moved to front at 2×8;
  a hidden burn stays hidden; completion trend clamped from 1 and from 4; every other tile's order,
  size and hidden state preserved; a second run is a no-op; a stored blob already at the version is
  untouched; junk input falls back to the default layout.
- Span tests: heights 5–8 emit real classes (a literal-class assertion, since an interpolated class
  emits no CSS), and the Reports catalogue still refuses heights above 4.
- `dashboard-panel.test.tsx`: row 1 with and without the digest; the badge's count, name, absence at
  0, presence while dragging, absence in a popout; the tray renders under row 1 and focus returns to
  the badge after Restore; row 2 with and without a hero; the hero absent → status full width; the
  Top actions tile still lists the hero's action; the control stack's order stays
  Print · Reset layout · Reset size · badge, asserted with the shared `src/test/toolbar-order.ts`
  helper and `contiguous: true`.
- `dashboard-tile-bodies.test.tsx`: burn body has no headline/Spent/hours/FX/index figures and does
  hold the chart; the KPI body holds Effort SPI and Effort CPI with their hints.
- A test pinning that removing the figures changed no health input: the Schedule and Budget RAG
  values for a fixture with a bad SPI/CPI are the same before and after.
- `e2e/dashboard-grid.spec.ts` extended for an 8-row tile's computed height at the 80px row unit.
- Axe scan of the dashboard.
- The `dashboard-visual` baseline is expected to change and is refreshed deliberately, with the new
  capture eyeballed before commit.

## Out of scope

- Any change to next-actions scoring, grouping or the providers.
- Any change to EVM, forecast or health computation.
- The Reports arrangement's own layout.
- The tip, coaching and narrative cards' contents.
