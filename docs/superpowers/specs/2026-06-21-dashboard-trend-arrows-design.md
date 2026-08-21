# Dashboard trend arrows (0.121.0) — design

Slice 4 of the Dashboard landing cockpit. Each headline KPI shows a direction
arrow (↑/↓/→) + signed delta versus the user's **last visit**, reusing slice-1's
per-project `landing-state` snapshot. Same time-window as the "since you last
looked" delta strip → one consistent narrative.

## Scope

Three KPIs get arrows (the "scan-first" set a PM reads first):

| Metric    | Source                                   | higherIsBetter |
|-----------|------------------------------------------|----------------|
| complete  | `model.progress.percent`                 | true           |
| overdue   | `model.overdue.length`                   | false          |
| openRaid  | open RAID count (terminal excluded)      | false          |

Approach **A**: a compact 3-tile **KPI strip** below the delta strip / coaching
card. It is the single home for all three arrows. The existing Progress section
keeps its completed-of-total + R/A/G detail (different framing). Approach B
(inline arrows on scattered surfaces) rejected — overdue/RAID have no headline
count to attach to.

## Architecture

### Pure engine — `dashboard-trends.ts` (i18n-free, the testable unit)

```ts
export type MetricKey = "complete" | "overdue" | "openRaid";
export type MetricSnapshot = Partial<Record<MetricKey, number>>;
export type MetricTrend = {
  value: number;
  delta: number | null;        // null ⇒ no prior (first visit / pre-metrics state)
  direction: "up" | "down" | "flat";
  improved: boolean | null;    // null when delta null; flat ⇒ false
};
const HIGHER_IS_BETTER: Record<MetricKey, boolean> =
  { complete: true, overdue: false, openRaid: false };

export function computeMetricTrends(
  prior: MetricSnapshot | undefined,
  current: Record<MetricKey, number>,
): Record<MetricKey, MetricTrend>;
```

- `delta = current - prior` (null when prior value undefined).
- `direction`: `delta>0 → "up"`, `<0 → "down"`, else `"flat"`.
- `improved = delta===0 ? false : (HIGHER_IS_BETTER ? delta>0 : delta<0)`; null when delta null.
- No `Date`/`Math.random`. Pure.

### `LandingState` extension — `dashboard-delta.ts`

Add `metrics?: MetricSnapshot;` (import `MetricSnapshot` from `dashboard-trends`;
one-way dep dashboard-delta → dashboard-trends, no cycle). Backward-compatible:
old persisted states (no `metrics`) → `computeMetricTrends(undefined, …)` → all
`improved: null` → strip renders no arrows until the next advance writes one.

### `landing-state.ts`

`isLandingState` guard accepts an optional `metrics` object (reject non-object).
No new key, no new write path — same single `lop-app:landing-state` localStorage
map, out of exports/Turso, cleared by `clearAppConfig`.

### `use-landing-delta.ts`

Add `currentMetrics: Record<MetricKey, number>` to args. Compute trends in the
SAME lazy `useState` mount-capture (reads `prior.metrics` before advancing). The
debounced 4s advance writes `metrics: currentMetrics` alongside `lastVisitAt`/
`rag` — one snapshot lifecycle, popout read-only (no advance). Return
`{ delta, trends }` (call site updated).

### Presentational — `trend-arrow.tsx`

`<TrendArrow trend metricLabel lang withSeconds?/>` (no withSeconds — drop).
`<TrendArrow trend metricLabel lang/>`:
- Renders `null` when `trend.improved === null` (first visit / no prior).
- Glyph ↑/↓/→ + signed delta (`+3` / `−2`, use real minus `−`).
- Color: improved → `text-AIPM-green-strong`; worsened → `text-AIPM-pink-strong`;
  flat → `text-muted-foreground` (palette tokens only).
- a11y: wrapper carries full `aria-label` (`dashboardTrendUp`/`Down`/`Flat`
  template, e.g. "Overdue down 2 since last visit"); the bare glyph is
  `aria-hidden` so it never bleeds a useless name (RagBadge-in-button landmine
  class). Dashboard is in axe `A11Y_VIEWS`.

### `dashboard.ts`

Add `openRaidCount: number` to `DashboardModel` = `raid.filter(r =>
!isTerminalStatus(r.status, r.category)).length` (engine + tile agree; `topRaid`
is capped at 5 so can't be the trend source).

### `report-table.tsx`

`Tile` gains optional `trend?: React.ReactNode` rendered under the value row.

### Wiring — `dashboard-panel.tsx` + `workspace-section.tsx`

- `dashboard-panel`: build `currentMetrics = { complete: model.progress.percent,
  overdue: model.overdue.length, openRaid: model.openRaidCount }`; pass to
  `useLandingDelta`; consume `{ delta, trends }`. Render a KPI strip (3 `Tile`s
  with `trend` slots) below the coaching card. Gated like the strip
  (projectId/non-popout already handled by the hook).
- `workspace-section`: no change beyond existing `projectId`/`isPopout` props.

## Testing

- `dashboard-trends.test.ts` — direction + improved per metric; null prior;
  flat ⇒ improved false; overdue/openRaid inverted semantics.
- `dashboard-trends.property.test.ts` — improved ⟺ direction agrees with
  HIGHER_IS_BETTER; delta sign matches direction; ~100 runs. Use
  `fc.integer`-derived numbers (no `fc.date`).
- `trend-arrow.test.tsx` — null on first visit; label text; color class; minus glyph.
- `landing-state` parse test — accepts/round-trips a state with `metrics`; ignores garbage metrics.
- i18n EN+DE: `dashboardTrendUp`/`dashboardTrendDown`/`dashboardTrendFlat`
  (aria templates, 0-based `{0}` metric / `{1}` count), `dashboardKpiStrip` label,
  `versionHighlightTrendArrows`.

## Release chores

`version.ts` (0.121.0 + codename + build date + append `versionHighlightTrendArrows`
to `APP_HIGHLIGHT_KEYS`), `CHANGELOG.md`, `README.md` badge, `package.json`.

## Non-goals

No Turso, no time-series history (that's the burndown-sparkline slice). No new
backend write path. No change to RAG flip rendering (slice 1 owns that).
