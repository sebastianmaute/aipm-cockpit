# Budget Report View — Design Spec

**Date:** 2026-06-01
**Status:** Approved (design)
**Target version:** 0.41.0 "Okorafor"

## Goal

Add a dedicated, read-only **Budget Report** as a sub-menu under the **Budget**
nav item (mirroring `raid` → `raid-report`). It surfaces the current budget
calculations across **all** buckets — role rates, blended discipline rates,
per-bucket overrides, FX, spillover, planned hours — as a printable
`ReportCard` with a project-level rollup and a sortable per-bucket detail table.
The budget block added to the task Reports view in v0.40.0 is removed and folded
(expanded) into this dedicated report.

## Decisions (from brainstorming)

1. **Placement:** `budget-report` is a child of the `budget` nav item.
2. **Dedup:** remove the v0.40.0 budget section from the task Reports view; this
   new report is the single home for budget reporting.
3. **Content:** full — project CCI rollup PLUS a per-bucket detail table with
   every factor.
4. **Currency:** all monetary values shown in **EUR** (the engine's native base)
   for comparability; each bucket's own currency and FX rate appear as
   informational columns (not per-row converted).

## Architecture

No engine change. `computeBudgetReport(buckets, plan, roles, resources,
workdayHours, holidaySet, absences)` already returns `{ project: ProjectReport,
buckets: BucketReport[] }` with all figures in EUR. The new panel renders that.

`BucketReport` carries `bucketId, name, currency, type, status, budgetHours,
plannedHours, actualHours, budgetValue, consumedValue, revenue, cost,
winLossHours, winLossValue, spilloverInHours, spilloverInValue,
contributionMargin, costPerformance, consumption`. It does NOT carry
`planningMode` or the FX rate, so the panel also receives `buckets` (to look up
`planningMode` per row via a `bucketById` map) and `fxRates` (to display the
×rate via `resolveRate(bucket, fxRates)` from `./fx`).

## New file: `src/app/budget-report-panel.tsx`

Modelled on `raid-report-panel.tsx`. A `ReportCard` (resizable via
`useResizable("lop-app:budget-report-size")`, reset-cols, printable) containing:

**Project rollup** — a tile grid from `report.project`:
- Budget h, Plan h, Actual h (counts)
- Revenue, Cost (EUR via `formatCurrency(x, "EUR", locale)`)
- Three CCI tiles: Contribution margin, Cost performance (CPI), Consumption —
  each showing amount (EUR) + percent (or "—" when percent is null).

**Per-bucket detail table** — sortable/filterable/resizable via the shared
`report-table` primitives (`useSortableFilter`, `SortHeaderButton`,
`TableFilter`) and `useColumnResize`, headed with `TABLE_HEAD_CLASS`. Columns:
`Bucket · Mode · Type · Status · Currency (×rate) · Budget h · Plan h ·
Actual h · Budget € · Consumed € · Margin % · Win/Loss €`. One row per bucket
(open AND closed). Spillover shown as a sub-note/indicator on rows where
`spilloverInHours !== 0`. Text filter matches bucket name; default sort by
budget € desc.

Empty state ("No budget buckets yet.") when `buckets.length === 0`.

Reuse the exported `Section` from `raid-report-panel.tsx`; define a small local
`Tile` (label + string value), matching the RAID panel's pattern. `lang`-aware
locale: `de → "de-DE"`, `en-GB → "en-GB"`, else `"en-US"`.

Props: `{ lang, buckets, plan, roles, resources, absences, holidaySet,
workdayHours, fxRates }`.

## Navigation wiring

- **`src/app/nav-config.ts`:** add `"budget-report"` to the `AppView` union; give
  the `budget` nav item `children: [{ view: "budget-report" }]`; add
  `LABEL_KEYS["budget-report"] = "budgetReportTitle"`. `subTabsFor("budget")`
  then returns `[{ view: "budget-report" }]` automatically (classic sub-tab row),
  and `allNavViews()` includes it.
- **`src/app/nav-icons.tsx`:** `ICON_PATHS` is `Record<AppView, string>` (total) —
  add a `"budget-report"` entry. Use the document/report glyph (same path as
  `raid-report`/`reports`).
- **`src/app/workspace-tab-context.tsx`:** add `"budget-report"` to the `TopTab`
  union.
- **`src/app/workspace-section.tsx`:** add a dynamic import for `BudgetReportPanel`
  (mirroring the `RaidReportPanel` dynamic import), and a render block:
  ```tsx
  {activeTab === "budget-report" && (
    <div id="panel-budget-report" role="tabpanel" className={panelScrollClass}>
      <BudgetReportPanel
        lang={lang}
        buckets={budgets}
        plan={plan}
        roles={roles}
        resources={resources}
        absences={absences}
        holidaySet={holidaySet}
        workdayHours={settings.resources.workdayHours}
        fxRates={fxRates}
      />
    </div>
  )}
  ```
  (`panelScrollClass`, `budgets`, `plan`, `roles`, `resources`, `absences`,
  `holidaySet`, `settings`, `fxRates` are all already in scope.)

## Remove the v0.40.0 Reports → Budget section

- **`src/app/reports.tsx`:** delete the `BudgetSection` component and its render
  in `ReportsPanel`; revert `ReportsPanel` to task-only props (drop `buckets`,
  `plan`, `roles`, `resources`, `absences`, `workdayHours` from the prop type and
  destructure); remove the now-unused imports (`computeBudgetReport`,
  `formatCurrency`, and the budget-only types).
- **`src/app/workspace-section.tsx`:** drop the budget props from the
  `<ReportsPanel>` call (back to `tasks`/`today`/`holidaySet`/`lang`).
- **`src/app/reports.test.tsx`:** remove the budget-section tests, fixtures, and
  the `budgetRowNames`/`fireEvent` additions; keep the task-report tests.

## i18n (EN + DE) — ASCII straight quotes only in `i18n.de.ts`

The v0.40.0 `reportsBudget*` keys are **replaced** by `budgetReport*` keys.
Remove the now-unused `reportsBudget*` keys from BOTH maps. Add (reusing existing
`budget*`/`budgetCci*`/`budgetType*` keys wherever they already cover a label):

- `budgetReportTitle` — "Budget Report" / "Budgetbericht"
- `budgetReportEmpty` — "No budget buckets yet." / "Noch keine Budget-Buckets."
- `budgetReportProjectTotal` — "Project total" / "Projektsumme"
- `budgetReportByBucket` — "By bucket" / "Nach Bucket"
- `budgetReportColMode` — "Mode" / "Modus"
- `budgetReportColStatus` — "Status" / "Status"
- `budgetReportStatusOpen` — "Open" / "Offen"
- `budgetReportStatusClosed` — "Closed" / "Geschlossen"
- `budgetReportRevenue` — "Revenue" / "Umsatz"
- `budgetReportCost` — "Cost" / "Kosten"
- `budgetReportColBudgetEur` — "Budget (EUR)" / "Budget (EUR)"
- `budgetReportColConsumed` — "Consumed (EUR)" / "Verbraucht (EUR)"
- `budgetReportColMargin` — "Margin %" / "Marge %"
- `budgetReportColWinLoss` — "Win/Loss" / "Gewinn/Verlust"
- `budgetReportFilterBucket` — "Filter buckets" / "Buckets filtern"

Reused existing keys: `budgetCurrency` (currency column header),
`budgetBudgetHours`, `budgetPlanHours`, `budgetActualHours`, `budgetCciMargin`,
`budgetCciCpi`, `budgetCciConsumption`, `budgetType`, `budgetTypeTm`,
`budgetTypeFixed`, `budgetModeDetailed`, `budgetModeBlended`. Status cells render
`budgetReportStatusOpen` / `budgetReportStatusClosed`.

German strings: keep the `"` string delimiters ASCII straight quotes; proper
umlauts (ä/ö/ü/ß) inside the value are fine and expected. Verify with a
curly-quote grep after editing, per the known `i18n.de.ts` caveat.

## Version & docs

- `version.ts`: `APP_VERSION = "0.41.0"`, `APP_BUILD_DATE = "2026-06-01"`,
  `APP_MILESTONE = "Okorafor"`; prepend a release-notes comment block; append a
  highlight key `versionHighlightBudgetReport` to `APP_HIGHLIGHT_KEYS` (+ EN/DE
  strings).
- `CHANGELOG.md`: 0.41.0 "Okorafor" entry (Added: dedicated Budget Report under
  Budget; Changed: budget reporting moved out of the task Reports view).
- `README.md`: version line → `v0.41.0 "Okorafor"`.
- `docs/CODEMAPS/*`: stamps bumped to `0.41.0`.

## Testing

- **`budget-report-panel.test.tsx`:** with a fixture of one detailed + one
  blended bucket and known rates, assert the project rollup tiles show the
  expected aggregate (e.g. revenue/cost/margin), per-bucket rows render with the
  correct Mode (Detailed/Blended) and Type, the bucket name filter narrows rows,
  a column sort reorders rows, and the empty state shows with no buckets.
- **`nav-config.test.ts`:** `subTabsFor("budget")` returns
  `[{ view: "budget-report" }]`; `allNavViews()` includes `budget-report`;
  `navLabelKey("budget-report") === "budgetReportTitle"`.
- **`reports.test.tsx`:** budget tests removed; task-report tests stay green.
- Existing `budget-report.ts` engine tests are untouched (reused as-is).

## File structure

**New:** `src/app/budget-report-panel.tsx`, `src/app/budget-report-panel.test.tsx`.
**Modified:** `nav-config.ts` (+ `nav-config.test.ts`), `nav-icons.tsx`,
`workspace-tab-context.tsx`, `workspace-section.tsx`, `reports.tsx`
(+ `reports.test.tsx`), `i18n.ts`, `i18n.de.ts`, `version.ts`, `CHANGELOG.md`,
`README.md`, `docs/CODEMAPS/*`.

## Out of scope (YAGNI)

- Per-bucket-currency conversion in the report (EUR-normalized by decision 4).
- Editing from the report (the Budget panel remains the editor).
- CSV/PDF export of the report (printing via `ReportCard` is sufficient).
- Any change to the budget engine, model, or persistence.
