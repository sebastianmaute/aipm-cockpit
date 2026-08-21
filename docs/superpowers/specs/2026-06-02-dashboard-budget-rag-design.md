# Dashboard + Budget RAG Enhancements — Design

**Date:** 2026-06-02
**Status:** Approved
**Target version:** 0.47.0

## Goal

Add RAG (Red/Amber/Green) status throughout the budget and dashboard surfaces, a
twin burn-down chart (hours + €), and a set of dashboard polish items (icons,
print behaviour, hover affordance, currency symbol, boxed sections).

## RAG threshold model (approved)

A single pure module owns every threshold so the budget panel, budget report and
dashboard stay consistent.

| Metric | Green | Amber | Red | Null (grey "—") |
|---|---|---|---|---|
| Consumption, Plan (h), Actual (h) — *ratio vs budget* | < 90% | 90–100% | > 100% | budget ≤ 0 |
| Cost performance — *budgetCost ÷ cost index* | ≥ 0.90 | 0.80–0.90 | < 0.80 | cost = 0 / percent null |
| Contribution margin — *percent* | ≥ 15% | 0–15% | < 0% | percent null |
| Win / Loss — *€ headroom* | mirrors consumption | tight | negative € | budget ≤ 0 |

"Ratio vs budget" means `value / budget`: Green below 90%, Amber from 90% up to
and including 100%, Red above 100%. Cost performance reuses the EVM index bands
already in `dashboard.ts` (`EVM_INDEX_RED = 0.8`, `EVM_INDEX_AMBER = 0.9`).
Win/Loss RAG is the consumption RAG of the same scope (the two are inverse), so
no separate threshold is introduced.

## Architecture

### New pure logic (no React, fully unit-tested)

**`src/app/budget-health.ts`**
- `ratioHealth(actual: number, budget: number): Health | null` — over-budget
  bands above; `null` when `budget <= 0`.
- `marginHealth(percent: number | null): Health | null` — R < 0, A < 15, G ≥ 15;
  `null` passes through.
- `costPerformanceHealth(percent: number | null): Health | null` — the percent is
  `budgetCost / cost * 100`; R < 80, A < 90, G ≥ 90; `null` passes through.
- `winLossHealth(consumedValue: number, budgetValue: number): Health | null` —
  delegates to `ratioHealth(consumedValue, budgetValue)`.
- Exported named constants: `BUDGET_OVER_AMBER = 0.9`, `BUDGET_OVER_RED = 1.0`,
  `MARGIN_GREEN_PCT = 15`, `COST_PERF_RED = 80`, `COST_PERF_AMBER = 90`.

**`src/app/budget-burndown.ts`**
- `computeBurndownSeries(buckets, plan, roles, resources, workdayHours, holidaySet, absences, today): BurndownSeries`.
- Walks the plan periods (`generatePeriods` / `bucketActivePeriods`) and sums, per
  period, budgeted vs actual **hours** and **€** across every bucket allocation
  (detailed roles + blended disciplines). € uses **external-rate × hours**
  (revenue basis), consistent across T&M and fixed-price buckets.
- Returns per-period **remaining** arrays:
  - `plannedRemainingHours[i]` = `totalBudgetHours − Σ budgetHours[≤i]`
  - `actualRemainingHours[i]`  = `totalBudgetHours − Σ actualHours[≤i]`, defined
    only up to `todayIndex` (the last period whose start ≤ today); `null` after.
  - same pair for `*Value` (€).
  - `periods: string[]`, `todayIndex: number`, `totalBudgetHours`, `totalBudgetValue`.
- The dashed "planned" line follows the *budget allocation schedule*, not a naïve
  straight line, so it reads as "are we tracking the plan."
- To avoid duplicating rate logic, `budget-report.ts` exports a small per-period
  hours aggregation helper that `budget-burndown.ts` consumes.

### New shared components

**`RagBadge`** — added to `src/app/health.tsx` (new file, re-exporting from or
co-located with `health.ts` rendering). Lettered dot: white R/A/G glyph on the
`healthDot` fill, `bg-slate-300` "—" when `value` is null. Props
`{ value: Health | null; lang: Lang; title?: string }`. Accessible label via
`healthColorName`. One component used on every surface, including print.

**`BurndownCharts`** — `src/app/burndown-chart.tsx`. Dependency-free inline SVG
(no chart library — KISS, no new dependency). Renders the two side-by-side
"remaining" charts (Hours + €). AIPM palette: actual line = `AIPM-green` solid,
planned line = muted/dark-blue dashed, vertical `today` marker, over-budget area
tinted with `AIPM-pink`. No-budget / empty series → muted hint text. Props =
`{ series: BurndownSeries; lang: Lang }`.

### Modified files

| File | Change |
|---|---|
| `report-table.tsx` | `Section` gains a `boxed?: boolean` variant (`rounded-lg border border-line bg-surface p-4`). `Tile` gains optional `rag?: Health \| null` rendering a trailing `RagBadge`. |
| `dashboard.ts` | `DashboardModel` gains `burndown: BurndownSeries \| null` (computed when `input.budgets.length > 0`). No threshold changes here. |
| `dashboard-panel.tsx` | (5) `RagBadge` on Overall/Schedule/Budget/Scope pills. (6) Print: each override `<select>` gets `print:hidden`; a print-only `value + RagBadge` shown with `hidden print:inline-flex`. (7) Budget-burn tiles use `formatCurrency(value, plan.currency \|\| "EUR", locale)`. (8) Render `BurndownCharts` in the Budget-burn area when `model.burndown`. (9) Box the Recent-activity section. |
| `dashboard-sections/registers-band.tsx` | (4) Clickable RAID/task/milestone links use the directory hover classes instead of `hover:underline`. (9) Top RAID / Upcoming&Overdue / Milestones sections use the `boxed` Section variant. |
| `budget-panel.tsx` | (1) `RagBadge` on plan-h, actual-h, win/loss (breakdown grid) and the three CCI cards (margin, cost-perf, consumption). (2) `HoursCell` fields relabelled **"Plan" / "Actual"**; per-cell RAG (`ratioHealth(actualPeriod, budgetPeriod)`) behind the Actual field; **row-total RAG** (`ratioHealth(Σactual, Σbudget)`) in a leading cell before the role/discipline name. |
| `budget-report-panel.tsx` | (3) RAG badges on the project-total tiles (consumption/margin/cost-perf via the new helpers) and a leading RAG column on the bucket detail table. (8) Render `BurndownCharts` (shared component; same series logic). |
| `i18n.ts` / `i18n.de.ts` | New keys: cell labels Plan/Actual, chart titles + axis/legend ("planned", "actual", "remaining", "budget cap", "hours remaining", "budget remaining"), RAG aria, and a `versionHighlightBudgetRag` key. ASCII straight quotes verified in the DE file after edit. |
| `version.ts`, `CHANGELOG.md`, `README.md`, help, `docs/CODEMAPS/*`, `package.json` | Version bump to 0.47.0 with a new SF-author codename; document `budget-health.ts`, `budget-burndown.ts`, `RagBadge`, `BurndownCharts`. |

## Component boundaries

- `budget-health.ts` — input: numbers; output: `Health | null`. No I/O, no React.
- `budget-burndown.ts` — input: workspace slices; output: plain numeric series.
- `RagBadge` — input: a `Health | null`; output: one inline element. Pure render.
- `BurndownCharts` — input: a `BurndownSeries`; output: SVG. Pure render.

Each can be understood and tested without reading the others' internals.

## Testing (TDD)

- `budget-health.test.ts` — every band incl. boundary values (89.9/90/100/100.1%,
  0.79/0.80/0.89/0.90 index, −0.1/0/14.9/15% margin) and the null/zero-budget cases.
- `budget-burndown.test.ts` — cumulative correctness, today split (actual null
  after `todayIndex`), no-budget empty series, blended + detailed mix, € basis.
- `health.test.ts` (or `rag-badge.test.tsx`) — `RagBadge` renders letter + colour
  per value and "—" for null with the right aria label.
- `burndown-chart.test.tsx` — renders two charts, today marker, empty-state hint.
- `dashboard.test.ts` — `burndown` present when budgets exist, null otherwise.
- `budget-panel.test.tsx` — bucket RAGs, cell labels, per-cell + row-total RAG.
- `budget-report-panel.test.tsx` — project-tile RAGs, detail RAG column, charts.

## Out of scope / deferred

- No charting dependency added.
- Fixed-price € burn uses the revenue (external-rate × hours) basis like T&M; an
  exact proportional fixed-price consumption curve is not modelled in v1.
- No new persisted entity, nav item, or storage migration — everything is derived.

## Decisions captured

- Over-budget bands: Amber ≥ 90%, Red > 100%.
- Cost performance: Red < 0.80, Amber < 0.90.
- Contribution margin: Green ≥ 15%, Amber 0–15%, Red < 0.
- RAG icon: lettered colour dot (R/A/G), grayscale-/print-safe.
- Burn-down shape: remaining (burn-DOWN), twin charts hours + €, planned line
  follows budget allocation.
- Roles table: per-cell RAG **and** a row-total RAG before the role.
- Burn-down placement: both dashboard and Budget Report (shared component).
