# Dashboard Completion-Trend Sparkline — Design

**Slice #6** of the Dashboard landing-cockpit roadmap (after #4 trend arrows, #5 milestone horizon, #7 coaching CTAs). Version **0.122.0 "Herbert"**.

## Goal

Add a compact "which way is the project moving" sparkline to the Dashboard landing cockpit: a small inline line of **completion % over time** (a burn-up curve), placed directly below the slice-4 KPI strip. Answers the cockpit's "what's the trajectory?" in one glance, above the fold.

## Metric (locked)

**Completion % trend** — burn-up, single unit `0–100%`, rising = good. This is the only series both data sources can produce honestly:

- **Turso snapshots** store `pctComplete` exactly per `SnapshotRecord`.
- **Activity log** can reconstruct done/total over time approximately.

Remaining-hours burndown was rejected: snapshots carry `remainingHours` but it is frequently `null` (no effort data), and the activity log has no hours — the two sources would plot different units. Net-completed-count was rejected: snapshots store no task count, so it would be log-only, contradicting the "both sources" decision.

## Placement (locked)

**Approach A — compact full-width trend card** directly under the KPI tiles. Keeps the clean 3-up KPI grid intact and gives the line enough width to read on narrow screens. (Rejected: a 4th tile inside the `grid grid-cols-3` strip — cramped/unreadable narrow; folding into the lower EVM/burndown section — below the fold, defeats the cockpit purpose.)

The existing `trend-chart.tsx` (`TrendChart`) is a 320×160 **axis** chart used by the Trends panel — not reusable as a sparkline. A new minimal `Sparkline` primitive is introduced.

## Architecture

### Pure engine — `src/app/completion-trend.ts` (i18n-free, no I/O, no clock)

```ts
export interface CompletionPoint {
  label: string;   // short bucket label, e.g. "06-14"
  percent: number; // 0–100, clamped
}

export interface CompletionTrendInput {
  snapshots: readonly SnapshotRecord[];
  activity: readonly ActivityEntry[];
  currentPercent: number; // live model.progress.percent
  today: string;          // YYYY-MM-DD, passed in (no new Date())
}

export function computeCompletionTrend(input: CompletionTrendInput): CompletionPoint[];
```

**Source priority (the "both" rule):**

1. If `snapshots` yields **≥ 2** points → map each `SnapshotRecord.pctComplete` keyed by `capturedAt` (chronological). Exact (Turso path).
2. Else **fall back** to the activity log: anchor at `currentPercent` (= live done/total today) and walk task events backward to recover historical `done`/`total`:
   - reverse-chronological over `activity` filtered to `task.created | task.completed | task.reopened | task.deleted`
   - undo `task.created` → `total -= 1`
   - undo `task.deleted` → `total += 1` (deleted task's done-state unknown → assumed **not done**; documented approximation, same honesty caveat as `newOverdue`)
   - undo `task.completed` → `done -= 1`
   - undo `task.reopened` → `done += 1`
   - bucket by **day**; emit `percent = total > 0 ? round(100 * done / total) : 0` per bucket boundary, chronological
3. If neither path yields ≥ 2 points → `[]` (card hidden).

**Window cap:** keep only the trailing `MAX_POINTS = 12` points so a long history doesn't flood the sparkline. (Engine is otherwise uncapped-honest until the slice.)

**Purity:** `today` + `currentPercent` passed in; no `new Date()` / `Date.now()`. `percent` clamped to `[0, 100]`. Never throws on malformed/fuzzed events (counts floored at 0; bad timestamps skipped).

### Presentational — `src/app/sparkline.tsx`

Tiny pure SVG polyline, no axes/ticks/labels. Fixed `viewBox` (e.g. `0 0 240 40`), `stroke-AIPM-dark-blue` `strokeWidth=2`, `fill=none`. Y range fixed to data min/max with a small pad. Renders nothing for `< 2` points. SVG is `aria-hidden="true"`; the meaning rides the wrapper's `aria-label` set by the card (label-bleed landmine: the glyph/line must never become the accessible name).

```ts
interface SparklineProps { points: readonly CompletionPoint[]; className?: string; }
```

### Card render in `dashboard-panel.tsx`

- Two new **optional** props (back-compat with ~30 existing render sites; default `[]`):
  - `snapshots?: readonly SnapshotRecord[]`
  - `activity?: readonly ActivityEntry[]`
- `currentPercent` = live `model.progress.percent`.
- `useMemo` computes the series; **deps hoisted to scalar locals** (`snapCount`, `activityCount`, `currentPercent`, `today`) per the exhaustive-deps "complex expression in dependency array" fatal-warning landmine.
- Rendered immediately after the KPI strip, gated on `series.length >= 2` (self-hides on blank/new projects — mirrors coaching/horizon no-nag).
- Card: caption "Completion trend" (`dashboardCompletionTrend`), the `<Sparkline>`, current % and point count. Wrapper `aria-label` = `dashboardCompletionTrendAria` interpolated with current %, first %, point count.

### Wiring (upstream)

`workspace-section.tsx` already threads `trends.snapshots` to the Trends panel and `trends.variance` to the Dashboard. Add `snapshots={trends.snapshots}` and `activity={…}` to the Dashboard render. The activity log is the same source the Dashboard's recent-activity section already consumes — thread the existing entries, or `loadActivityLog()` at the wiring layer (no new persistence path; log stays browser-local, out of exports/Turso).

## Gating

No `tursoConfig` guard in the panel. The engine prefers snapshots when present, else the log. On file/IDB backends `snapshots` is `[]`, so the log path runs automatically. Always-on, degrades cleanly. (Turso-gated features rule does not apply: this reads snapshots opportunistically and never *writes* — it works without Turso.)

## a11y

Dashboard is in the axe `A11Y_VIEWS` 12-view gate. The sparkline introduces **no interactive control** (no axe-critical surface). SVG `aria-hidden`; card wrapper carries the full `aria-label`; visible caption is the readable name. No off-palette colors/shadows (only `stroke-AIPM-dark-blue`, brand tokens).

## Versioning

- `version.ts`: `APP_VERSION = "0.122.0"`, `APP_MILESTONE = "Herbert"`, append `"versionHighlightBurndownSparkline"` to `APP_HIGHLIGHT_KEYS`.
- `i18n.ts` + `i18n.de.ts` (EN/DE parity, real umlauts via node utf8 write, 0-based `{0}` placeholders): `versionHighlightBurndownSparkline`, `dashboardCompletionTrend`, `dashboardCompletionTrendAria`, `dashboardCompletionTrendPoints`.
- `CHANGELOG.md` entry, README badge, `package.json` version → 0.122.0.

## Testing

- `completion-trend.test.ts`: snapshot-preferred (≥2 snaps → exact pctComplete series, log ignored); log-fallback reconstruction (created/completed/reopened/deleted walked back from currentPercent); `< 2` points → `[]`; window cap to 12; deleted-task assumed-not-done approximation; total=0 → 0%.
- `completion-trend.property.test.ts`: fuzzed event streams + integer ms timestamps (`fc.integer` ranges mapped to `new Date(ms)`, **never** `fc.date`) → percents always in `[0,100]`, output chronological, never throws.
- `sparkline.test.tsx`: renders a `<polyline>` for ≥2 points; renders nothing for `< 2`.
- `dashboard-panel` test: card appears when series present; hidden when absent; aria-label content.
- `npx tsc --noEmit` (EN/DE key parity), `npm run test:run`, `npm run lint --max-warnings=0`, `next build`, axe Dashboard (`npx playwright test e2e/a11y.spec.ts -g "Dashboard"`).

## Out of scope (future slices)

Density toggle (#8), full click-through parity (#9). No interactivity on the sparkline (no hover tooltip, no click-through) this slice.
