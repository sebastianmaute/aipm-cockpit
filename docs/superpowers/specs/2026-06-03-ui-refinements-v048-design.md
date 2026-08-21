# UI Refinements v0.48.0 — Design

**Date:** 2026-06-03
**Status:** Approved (pending written-spec review)
**Target version:** 0.48.0 "Tchaikovsky" · build 2026-06-03

## Goal

A batch of UI/UX refinements across the dashboard, budget, resources, planning,
calendar, reports and task-editor surfaces. Most items are small, additive, and
reuse existing shared primitives (`RagBadge`, `useColumnResize`,
`useSortableFilter`/`TableFilter`/`SortHeaderButton`, `budget-health.ts`,
`formatCurrency`). No new persisted entity, nav item, or storage migration.

## Pre-work audit (what already shipped in v0.47.0)

Verified directly in code; **left as-is, no work**:

- **#3 (button exists)** Gantt already renders an "Add milestone" button next to
  "Add task" (`gantt.tsx:1123`), wired in `workspace-section.tsx:398`. Only its
  *behaviour* changes here (see workstream J).
- **#5** Resources columns already resize (Directory, Planning, Workload,
  Resource Report all use `useColumnResize`).
- **#6** Workload already renders a resize handle on all six columns.
- **#10** RAID report tables are already fully resizable.
- **#13** Budget Report bucket-detail table already resizes and already carries a
  leading RAG status column (`ratioHealth(consumedValue, budgetValue)`).

## Decisions captured

- **#11** RAID + Budget reports become **default-present** at the bottom of
  Reports (still removable); Resource report stays opt-in via the dropdown.
- **#7** Calendar Custom-view "Today" resets From/To to the **current month**
  (`monthWindow(today)`).
- **#14** Actual-(h) RAG judged **vs Budget hours**: `ratioHealth(actualHours, budgetHours)`.
- **#3** "Add milestone" **opens the milestone create form directly** (parity
  with "Add task"), not just a tab switch.
- **#4** Margin RAG appears in **both** the Planning grid and the Resource Report.
- **#2** **Both** task editors get a bottom-right Cancel + Add/Save row.
- **#18** RAG thresholds legend sits **under the Overall RAG band**.

## RAG thresholds (single source: `budget-health.ts`)

The legend text (workstream B/#18) must match the existing constants verbatim:
`BUDGET_OVER_AMBER = 0.9`, `BUDGET_OVER_RED = 1.0`, `COST_PERF_RED = 80`,
`COST_PERF_AMBER = 90`, `MARGIN_GREEN_PCT = 15`.

> Consumption / hours: Amber ≥90%, Red >100% · Cost performance: Red <0.80,
> Amber <0.90 · Margin: Green ≥15%, Amber 0–15%, Red <0

## Workstreams

### A. Burn-down chart axes (#1 + #12)

`burndown-chart.tsx` — add axis tick labels to the dependency-free SVG:

- New prop `currency: string` (threaded from both call sites; both have
  `plan.currency`).
- **Y-axis ticks:** a few gridline values (e.g. 0, ½·max, max). The € chart
  formats them with `formatCurrency(value, currency, localeFor(lang))`; the hours
  chart uses a compact number + the `h` unit. Labels are right-aligned in the
  left padding band (`PAD_L`), `text-[9px]`/muted, `aria-hidden`.
- **X-axis ticks:** a thinned subset of `series.periods` — always first, the
  `todayIndex` period, and last, plus evenly-spaced interiors only if they don't
  collide — rendered along the baseline. Period keys (e.g. `2026-06`,
  `2026-W23`) are shown as-is (they already read as dates/periods).
- Call sites: `dashboard-panel.tsx` (`<BurndownCharts ... currency={props.plan.currency || "EUR"} />`)
  and `budget-report-panel.tsx` (`currency={plan.currency}`).
- Chart SVG keeps `role="img"`; the new tick text is `aria-hidden` (the chart's
  aria-label already summarises it).

### B. Dashboard polish (#15, #16, #17, #18)

`rag-badge.tsx`, `health.ts`, `dashboard-panel.tsx`, `globals.css`, i18n.

- **#15 Print colors.** Add `[-webkit-print-color-adjust:exact] [print-color-adjust:exact]`
  to the `RagBadge` base class so the `healthDot` background prints (the global
  `@media print` block only strips `bg-surface*`; default browser behaviour drops
  the `bg-*-500` fill, leaving white text on white). The null "—" `bg-slate-300`
  badge is unaffected on screen and prints a light grey.
- **#16 "Overall" text.** Add `export const healthText: Record<Health, string>`
  to `health.ts` — `R: "text-AIPM-pink"`, `A: "text-AIPM-purple"`, `G: "text-AIPM-green"`
  (matches the Reports group-dot palette). In `dashboard-panel.tsx`, wrap the
  trailing `healthColorName(model.overall.effective, lang)` in
  `<span className={model.overall.effective ? healthText[model.overall.effective] : ""}>`.
- **#17 Captions.** A muted `text-xs text-muted-foreground` line under the
  Progress section content and under the Budget-burn section content, explaining
  what the figures mean and how to read the burn-down. Two new i18n keys
  (`dashboardProgressCaption`, `dashboardBurnCaption`). Not `print:hidden` — they
  print.
- **#18 Thresholds legend.** A muted `text-xs text-muted-foreground` line
  immediately under the Overall RAG band (inside the same bordered block, after
  the pill row). One new i18n key `dashboardRagThresholds` carrying the threshold
  text above. Prints.

### C. Resources margin RAG (#4)

Helper (pure, tested): margin percent = `external > 0 ? (margin / external) * 100 : null`.
RAG via the existing `marginHealth(percent)` (`budget-health.ts`).

- **Planning grid** (`resources-panel.tsx`): a `RagBadge` after the margin figure
  in each resource row's margin cell and in the totals (`tfoot`) margin cell.
  `external` per row = `cost.external`; total = `totals.external`.
- **Resource Report** (`resources-report.tsx`): a `RagBadge` after the margin
  figure in the by-period / by-discipline / by-grade / by-resource margin cells
  (wherever a `margin` + `external` pair exists on the row).

### D. Calendar custom "Today" (#7)

`resources-panel.tsx`, custom-mode branch (currently From/To inputs only): add a
Today button (reusing the existing button styling + `calendarToday` i18n key)
that calls `setCalendarFrom(monthWindow(today).startDate)` and
`setCalendarTo(monthWindow(today).endDate)`.

### E. Planning filter + sort (#8)

`resources-panel.tsx` planning view. Columns already resize. Add:

- A `TableFilter` above the grid filtering resource rows by display name
  (placeholder reuses an assignee/name filter key).
- Sortable headers via `SortHeaderButton` + `useSortableFilter` over the resource
  rows for: assignee (name), capacity-days, internal, external, margin. Period
  columns stay unsorted (they're a horizontal time axis, not a sort dimension).
- The totals `tfoot` is computed from the filtered+sorted rows so it always
  reflects what's visible.

### F. Budget sort + filter (#9)

`budget-panel.tsx` role-allocation table (detailed roles + blended disciplines).
Columns already resize. Add per-bucket:

- A `TableFilter` filtering rows by **role/discipline name only** (the request's
  "filtering for role and discipline only").
- Sortable headers via `SortHeaderButton` + `useSortableFilter`: name and the
  row-total hours. Period columns stay unsorted (time axis).
- Row-total RAG and per-cell RAG (already present) are preserved through the
  filter/sort.

### G. Budget Report Actual-(h) RAG (#14)

`budget-report-panel.tsx` `BucketDetailTable`: add a `RagBadge` in the `actualH`
cell — `ratioHealth(r.actualHours, r.budgetHours)`. Cell becomes a flex row
(`justify-end gap-1.5`) so the number stays right-aligned with the badge after
it, matching the existing tile/badge pattern.

### H. Reports default-present (#11)

`workspace-section.tsx`: change the Reports prop to seed a default when the user
has never customised — `extraReports={settings.reports?.extra ?? ["raid-report", "budget-report"]}`.
RAID then Budget render at the bottom out of the box, still removable via the
existing `×`; Resource report remains addable via the dropdown. No change to
`ReportsPanel` itself (its render order already follows `ADDABLE_REPORTS`).

### I. Task editor buttons (#2)

- **Classic** (`task-form-modal.tsx`): drop the `isEditing &&` guard on the
  Cancel button so create mode also shows Cancel; footer stays
  `flex justify-end gap-2` → Cancel + "Add task" bottom-right.
- **Modern** (`task-edit-view.tsx` + `task-manager.tsx`): `TaskEditView` gains an
  optional `footer?: React.ReactNode` slot rendered at the bottom-right inside the
  `<form>` (`mt-… flex justify-end gap-2`). `task-manager.tsx` passes the existing
  `editActions` element (Cancel + submit, already wired via `form={TASK_EDIT_FORM_ID}`).
  The submit button inside the form works without the `form=` attribute too, but
  reusing `editActions` keeps one definition.

### J. Gantt "Add milestone" → create form (#3)

- `milestones-panel.tsx`: add prop `openCreateNonce?: number`. A `useEffect` keyed
  on it calls `openNew()` when it changes to a positive value (guard the initial
  mount so it doesn't auto-open on first render).
- `workspace-section.tsx`: hold `const [milestoneCreateNonce, setMilestoneCreateNonce] = useState(0)`.
  Gantt `onAddMilestone={() => { setActiveTab("milestones"); setMilestoneCreateNonce((n) => n + 1); }}`.
  Pass `openCreateNonce={milestoneCreateNonce}` to `MilestonesPanel`.
- `onEditMilestone` and the dashboard `onOpenMilestone` keep their current
  tab-switch behaviour (out of scope).

## Component boundaries

- `marginPercent` / axis-tick helpers — pure numeric, no React, unit-tested.
- `healthText` — a static lookup, like `healthDot`.
- `RagBadge`, `BurndownCharts` — pure render; `BurndownCharts` gains one prop.
- Filter/sort additions reuse `useSortableFilter` — no new state machinery.
- The milestone nonce is a one-way "trigger an action from parent" signal; the
  panel still owns all milestone state.

## Testing (TDD)

- `budget-health` / margin-percent helper: boundary values (−0.1 / 0 / 14.9 / 15 %),
  null when external ≤ 0.
- `burndown-chart.test.tsx`: renders Y currency ticks (contains the currency
  symbol) and X date labels; hours chart shows `h`; no-budget empty state intact.
- `rag-badge.test.tsx`: base class contains the print-color-adjust utility.
- `dashboard-panel.test.tsx`: thresholds legend + captions render; "Overall" text
  carries the `healthText` colour class; print-only paths unaffected.
- `resources-panel.test.tsx`: planning filter narrows rows, sort reorders, totals
  follow the filtered set; margin badge present; custom-view Today resets the
  window.
- `resources-report.test.tsx`: margin badge present.
- `budget-panel.test.tsx`: role/discipline filter + sort; existing per-cell /
  row-total RAG preserved.
- `budget-report-panel.test.tsx`: Actual-(h) badge present.
- `reports.test.tsx` / `workspace-section`: RAID + Budget present by default;
  removable.
- `task-form-modal.test.tsx`: Cancel shows in create mode.
- `task-edit-view.test.tsx`: footer slot renders; submit still submits the form.
- `milestones-panel.test.tsx`: `openCreateNonce` bump opens the create modal; no
  auto-open on mount.
- i18n EN/DE parity (tsc-enforced) for every new key; ASCII straight quotes
  verified in `i18n.de.ts` after edit.

## i18n keys (EN + DE)

`dashboardProgressCaption`, `dashboardBurnCaption`, `dashboardRagThresholds`,
plus reuse of existing `calendarToday`, name/assignee filter placeholders, and a
new `budgetRoleFilter` placeholder for the budget role/discipline filter.
`versionHighlightUiRefinements` for the version highlight list.

## Out of scope / deferred

- The 5 already-shipped items (#3-button, #5, #6, #10, #13) — no rework.
- No charting dependency; axis ticks stay hand-rolled SVG.
- `onEditMilestone` / dashboard `onOpenMilestone` keep tab-switch behaviour.
- Period columns remain unsorted in Planning and Budget (time axis, not a sort key).
