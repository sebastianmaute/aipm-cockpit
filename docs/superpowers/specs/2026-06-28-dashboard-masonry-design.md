# Dashboard Masonry Cockpit — Design Spec

**Date:** 2026-06-28
**Slice:** follow-up to the bento layout redesign (MR !145)

## Problem

The bento cockpit wastes vertical space and shows large empty voids on wide
screens. Root cause: fixed two-column grids (`lg:grid-cols-2`) with `items-start`
and wildly uneven card heights cannot pack — short cards leave trapped whitespace
beside tall neighbours.

Confirmed at 1680px:
1. **Hero** (`dashboard-hero.tsx`): 3 short KPI tiles (left) beside the tall
   5-row Top-actions card (right) → ~250px white void under the KPI tiles.
2. **Tier-2 bento**: short Progress card beside the tall Budget+burndown card;
   short Changes beside taller Milestones → voids under the short cards.
3. **Footer**: Status summary · Recent activity · Trends stacked as full-width
   thin bars → wide-screen horizontal emptiness (minor).

## Approach: CSS multicolumn masonry

Use CSS `columns-*` (universal browser support; NOT the experimental
`grid-template-rows: masonry`). Default `column-fill: balance` equalizes column
heights, so cards pack tightly and self-hiding cards merely shorten a column
instead of leaving a hole.

Masonry only fixes voids when **#cards > #columns** — two cards in two columns is
one-per-column (today's bug). So the hero KPI strip + Top-actions MUST join the
same flow as the other short/tall cards. This forces a re-split of the hero and
the registers band.

## Layout map

| Zone | Members | Width |
|------|---------|-------|
| Headline (unchanged) | delta strip · narrative summary · coaching · **Overall RAG band + Adjust-health** | full |
| **Masonry** | KPI tiles · Top actions · RAID · Upcoming&overdue · Progress · Budget+burndown · Milestones · Changes · Sparkline | `columns-1 lg:columns-2 xl:columns-3` |
| Footer (unchanged) | Status-summary `<details>` · Recent-activity `<details>` · Trends | full, stacked |

Masonry card **order** (column-major reading; priority-first so the top of
column 1 carries the most important cards): KPI · Top actions · RAID · Upcoming
· Progress · Budget · Milestones · Changes · Sparkline.

## Mechanism details

- Wrapper: `<div className={`columns-1 lg:columns-2 xl:columns-3 ${dc.sectionGap}`}>`
  — `dc.sectionGap` (`gap-4`/`gap-2`) maps to `column-gap` on a multicol container.
- Each card wrapped in `<div className={`break-inside-avoid ${dc.cardGap}`}>` so
  no card splits across a column boundary and vertical rhythm is preserved.
- **New density key `dc.cardGap`**: comfortable `mb-4`, compact `mb-2` (mirrors
  `sectionGap` magnitudes; vertical card spacing in multicol is item-margin, not
  a `gap`/`space-y`, which multicol ignores). Extend `DensityClasses` type +
  `densityClasses()` + `dashboard-density.test.ts`.

## Component changes

- **`dashboard-hero.tsx`** → shrinks to **Overall RAG band + Adjust-health
  disclosure only** (still owns `OverrideSelect`). Drop the KPI-tiles grid and
  the Top-actions card and their `lg:grid-cols-2` wrapper from this component.
  Props no longer needed by hero: `topActions`, `onOpenAction`, `trends` (the KPI
  strip used `trends`). Keep `lang`, `today`, `model`, `status`, `setStatus`,
  `showBudget`, `showChanges`, `dc`.
- **New `dashboard-sections/dashboard-kpi-strip.tsx`** (`DashboardKpiStrip`): the
  3 KPI tiles (complete % · overdue · open RAID) with trend arrows. Props: `lang`,
  `model`, `trends`, `onNavigate`, `dc`. Extracted verbatim from the current hero
  KPI block. Renders the `Tile` trio inside one boxed card.
- **New `dashboard-sections/dashboard-top-actions.tsx`** (`DashboardTopActions`):
  the ranked Top-actions queue card. Props: `lang`, `topActions`, `onOpenAction`,
  `dc`. Extracted verbatim from the current hero Top-actions block. Self-hides
  (returns `null`) when `!topActions?.length` — so it drops out of the masonry on
  a blank project instead of rendering an empty card.
- **`registers-band.tsx`** → split into two standalone cards consumed directly by
  the panel masonry: `RaidRegisterCard` (top open RAID) and `UpcomingCard`
  (upcoming & overdue). Either export both from the existing file or retire the
  combined `RegistersBand` wrapper. Same props each needs today (`lang`, the
  relevant model slices, `onOpenRaid`/`onOpenTask`, `showRaid`).
- **`dashboard-panel.tsx`** → render the headline zone (hero now = Overall band
  only), then the masonry wrapper containing the 9 cards in priority order, then
  the footer (Status summary, Recent activity, Trends) unchanged.

## Invariants preserved

- Public `DashboardPanelProps` unchanged (~30 caller/test sites untouched).
- `dc.*` density (incl. new `cardGap`) — no literal spacing on cockpit slices.
- AIPM palette tokens only; no new gradients/shadows beyond `--shadow-card`.
- axe: Dashboard ∈ `A11Y_VIEWS`. All moved controls keep their accessible names
  (KPI tile activate-labels, Top-actions Open buttons, RAID/Change row labels).
  Multicol introduces no new interactive controls.
- Print: `break-inside-avoid` on every card improves print pagination; dashboard
  already `print-root`-scoped.
- react-hooks: no new `Date.now()`/effects; any new `useMemo` deps stay scalar.

## Out of scope

- Footer strips stay full-width stacked (Trends' VarianceSummary table needs full
  width — would cram in a 1/3 column). No footer row-packing this slice.
- No engine/data change, no new persisted field, no i18n additions (all moved
  text reuses existing keys).

## Test plan

- `npx tsc --noEmit` clean; `npm run lint` 0 warnings.
- `npm run test:run` green incl. new `dashboard-kpi-strip` / `dashboard-top-actions`
  tests, updated `dashboard-hero` test (Overall-band-only), updated
  `registers-band`/panel tests, `dashboard-density` test (new `cardGap`).
- axe Dashboard gate 3/3 (AIPM light+dark, Mockup light).
- Eye-check at 1680 / 1280 / 900 / 375 px + compact density: confirm KPI void and
  Progress void are gone; columns balanced; no card split mid-column.
