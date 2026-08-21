# Budget Planning Modes — Design Spec

**Date:** 2026-06-01
**Status:** Approved (design)
**Target version:** 0.40.0 "Leckie"

## Goal

Let each budget bucket be planned at one of two granularities, switched by a
**"Detailed budget planning"** toggle:

- **Detailed (ON, default):** allocations per **Role** (discipline × grade),
  using role rates. This is today's behavior.
- **Blended (OFF, discipline-only):** allocations per **Discipline**, using a
  *mixed* rate = the unweighted average of the internal and external rates of
  every Role defined in that discipline.

Add per-bucket internal/external **rate overrides**, tooltips + unit suffixes on
entry fields, and a **Budget section in the Reports view** with bucket and
total-budget filters.

## Grounding (Book2.xlsx)

The reference spreadsheet tracks budget **per PO (= bucket)**, split **by
discipline** (Consulting / Development / Business Advisory). Each discipline
carries one blended **External rate/h**; budget € = hours × rate; days = hours /
8. Right-hand tables track actual booked hours and planned hours per PO per
discipline, with a Delta (Over/Under) and Used/Free budget rollups. The blended
discipline-only mode and the reports rollups model this sheet.

## Decisions (from brainstorming)

1. **Toggle scope:** per-bucket (each bucket independently chooses its mode).
2. **Blended rate:** unweighted average of the grade rates within a discipline.
3. **Rate override:** one internal + external pair per bucket, overriding all
   rows in that bucket; blank fields fall back to role/blended rates.
4. **Reports:** a new Budget section in the existing Reports view.
5. **Data-loss behavior:** switching a bucket OFF detailed (→ blended) while its
   detailed rows hold entered hours shows a `window.confirm` warning; on confirm
   the detailed allocations' hour values are **cleared** (not auto-collapsed into
   discipline sums).
6. **"Filter by total budget":** a numeric **minimum total-budget** filter in the
   Reports budget section.

## Data Model (`types.ts`) — additive, back-compatible

```ts
export const PLANNING_MODES = ["detailed", "blended"] as const;
export type PlanningMode = (typeof PLANNING_MODES)[number];

/** Blended (discipline-only) allocation. Same shape as BucketAllocation but
 *  keyed by disciplineId. resourceIds still feed the PLAN (capacity of the
 *  resources in that discipline). */
export type DisciplineAllocation = {
  disciplineId: number;
  resourceIds: number[];
  budgetHours: Record<string, number>;
  actualHours: Record<string, number>;
};
```

`BudgetBucket` gains (all optional → existing buckets behave exactly as before):

```ts
/** "detailed" = per-role allocations (default, back-compat).
 *  "blended"  = per-discipline allocations with mixed grade rates. */
planningMode?: PlanningMode;            // absent ⇒ "detailed"
/** Per-discipline allocations; consulted only when planningMode === "blended". */
disciplineAllocations?: DisciplineAllocation[];
/** Per-bucket rate overrides (plan currency, per hour). When present (finite,
 *  >= 0), override the role/blended rate for ALL rows in this bucket. */
rateOverrideInternal?: number;
rateOverrideExternal?: number;
```

`blankBucket` sets `planningMode: "detailed"`, `disciplineAllocations: []`.

## Rates module (`budget-rates.ts`, new pure module)

```ts
export type RatePair = { internal: number; external: number };

/** Unweighted mean of the internal/external rates of every Role whose
 *  disciplineId === id. Returns { internal: 0, external: 0 } when the
 *  discipline has no roles. */
export function blendedDisciplineRate(id: number, roles: readonly Role[]): RatePair;

/** Effective rate for a row: each field uses the bucket override when it is a
 *  finite number >= 0, otherwise the fallback. Override is applied per-field so
 *  setting only one of the two is honored. */
export function effectiveRates(
  bucket: Pick<BudgetBucket, "rateOverrideInternal" | "rateOverrideExternal">,
  fallback: RatePair,
): RatePair;
```

## Report engine (`budget-report.ts`)

`computeBucketReport` builds a uniform list of rate-bearing rows
`{ rates: RatePair, budgetHours: Record<string,number>, actualHours:
Record<string,number>, resourceIds: number[] }`:

- **detailed:** one row per `allocations` entry; fallback rate = role rates
  (`internalRate`/`externalRate`, 0 when role missing).
- **blended:** one row per `disciplineAllocations` entry; fallback rate =
  `blendedDisciplineRate(disciplineId, roles)`.

Each row's rate = `effectiveRates(bucket, fallbackRate)` so a per-bucket override
wins in **both** modes. The existing accumulation (budgetHours, actualHours,
cost = actual × internal, tmRevenue = actual × external, budgetValueExternal =
budget × external, budgetCost = budget × internal, plannedHours via
`allocationPlannedHours`) runs unchanged over this row list. Fixed-price logic,
spillover, and the project rollup are untouched.

`bucketActivePeriods` is unchanged (it reads only `startDate`/`endDate`).

## UI — Budget bucket modal (`budget-bucket-modal.tsx`)

- **Toggle:** a "Detailed budget planning" toggle button bound to
  `draft.planningMode` (on ⇒ "detailed", off ⇒ "blended"). Label
  `budgetDetailedPlanning`, tooltip `budgetDetailedPlanningHint`.
- **Switch guard:** when turning the toggle OFF and any detailed allocation has a
  non-empty `budgetHours`/`actualHours` value, `window.confirm`
  (`budgetSwitchToBlendedWarn`); on cancel the toggle stays ON. On confirm: set
  `planningMode = "blended"` and reset every detailed allocation's `budgetHours`
  and `actualHours` to `{}` (role rows preserved, values lost). Switching back ON
  does not restore values.
- **Blended rows:** in blended mode the role add/remove UI is replaced by a
  discipline add/remove UI (dropdown of disciplines not yet allocated +
  `budgetAddDiscipline`; per-row `budgetRemoveDiscipline`). Resource checkboxes
  reused per discipline row. Keys: `budgetAddDiscipline`,
  `budgetRemoveDiscipline`, `budgetNoDisciplinesLeft`.
- **Rate overrides:** two number inputs — internal and external — each with a
  trailing `€/h` unit suffix (`budgetUnitPerHour`) and tooltip
  (`budgetRateOverrideHint`). Labels `budgetRateOverrideInternal`,
  `budgetRateOverrideExternal`. Blank ⇒ `undefined`. Validation in `save()`:
  reject when present and (`!Number.isFinite` or `< 0`) with
  `budgetRateOverrideInvalid`.

## UI — Budget panel (`budget-panel.tsx`)

- The per-bucket card renders the **role table** (detailed) or **discipline
  table** (blended), driven by `bucket.planningMode`.
- A `setDisciplineCell` mirror of `setCell` updates `disciplineAllocations`.
- Every hours input gains a trailing unit suffix `h` (`budgetUnitHours`) and a
  `title` tooltip: `budgetBudgetHoursHint` for the budget input,
  `budgetActualHoursHint` for the actual input.
- A small mode badge on the card header
  (`budgetModeDetailed` / `budgetModeBlended`).

## UI — Reports view Budget section (`reports.tsx`, `workspace-section.tsx`)

`workspace-section.tsx` passes budget data into `ReportsPanel` (mirroring the
sibling `ResourcesReportPanel`): `buckets`, `plan`, `roles`, `disciplines`,
`grades`, `resources`, `absences`, `holidaySet`, `workdayHours`, `fxRates`.

New `<Section title={reportsBudget}>`:

- **Bucket filter** dropdown: All buckets (`reportsBudgetAllBuckets`) or one
  specific bucket.
- **Min total-budget** numeric input (`reportsBudgetMinTotal`): keeps only
  buckets whose total budget € ≥ the entered value (blank ⇒ no minimum).
- **Rollup tiles** reflecting the active filter: Total Budget €
  (`reportsBudgetTotal`), Used € (`reportsBudgetUsed`), Free €
  (`reportsBudgetFree`), Budget h (`reportsBudgetHours`).
- **Per-bucket table** on the shared `report-table` primitives (`ReportCard`
  context not needed; reuse `useSortableFilter`, `SortHeaderButton`,
  `TableFilter`, `TABLE_HEAD_CLASS`): columns Bucket · Budget h · Budget € ·
  Used h · Plan h · Free €. Sortable; the existing text `TableFilter` filters by
  bucket name.

Budget figures come from `computeBudgetReport(...)`; amounts are EUR (project
base), formatted with `formatCurrency`. Empty state when no buckets exist
(`reportsBudgetEmpty`).

## i18n (`i18n.ts` + `i18n.de.ts`) — ASCII straight quotes only

New keys (EN / DE):

- `budgetDetailedPlanning` — "Detailed budget planning" / "Detaillierte Budgetplanung"
- `budgetDetailedPlanningHint` — explains detailed = per role/grade, off = per discipline (blended rate)
- `budgetModeDetailed` / `budgetModeBlended` — "Detailed" / "Blended" badges
- `budgetSwitchToBlendedWarn` — warns entered detailed hours will be lost
- `budgetRateOverrideInternal` / `budgetRateOverrideExternal` — labels
- `budgetRateOverrideHint` — "Overrides role/blended rates for this bucket"
- `budgetRateOverrideInvalid` — validation message
- `budgetUnitHours` — "h"
- `budgetUnitPerHour` — "€/h"
- `budgetAddDiscipline` / `budgetRemoveDiscipline` / `budgetNoDisciplinesLeft`
- `budgetBudgetHoursHint` / `budgetActualHoursHint` — field tooltips
- `reportsBudget` — section title "Budget"
- `reportsBudgetAllBuckets`, `reportsBudgetFilterBucket`, `reportsBudgetMinTotal`
- `reportsBudgetTotal`, `reportsBudgetUsed`, `reportsBudgetFree`, `reportsBudgetHours`
- `reportsBudgetBucketCol`, `reportsBudgetPlanHours`, `reportsBudgetUsedHours`,
  `reportsBudgetBudgetEur`, `reportsBudgetEmpty`

German strings must contain no embedded `"` (avoid the curly-quote corruption);
verify ASCII delimiters after editing.

## Version & docs

- `version.ts`: `APP_VERSION = "0.40.0"`, `APP_MILESTONE = "Leckie"`; prepend a
  release-notes comment block; add a highlight key (e.g.
  `versionHighlightBudgetModes`) to `APP_HIGHLIGHT_KEYS` with EN/DE strings.
- `CHANGELOG.md`: 0.40.0 entry.
- `README.md` version line → `v0.40.0 "Leckie"`.
- `docs/CODEMAPS/*` stamps bumped to include 0.40.0.

## Testing

- **`budget-rates.test.ts`:** `blendedDisciplineRate` averages grade rates;
  returns {0,0} for a discipline with no roles; `effectiveRates` applies override
  per-field, falls back when blank, ignores negative/NaN overrides.
- **`budget-report` blended tests:** a blended bucket computes budget/used/CCI
  from blended discipline rates; a per-bucket override replaces both rates in
  detailed and blended modes; an absent `planningMode` still behaves as detailed
  (back-compat).
- **`budget-bucket-modal` tests:** toggle renders discipline rows in blended
  mode; turning OFF with entered detailed hours triggers `window.confirm` and
  clears hours on confirm / keeps mode on cancel; override inputs validate.
- **`reports` budget-section tests:** rollup tiles reflect the bucket filter and
  min-total filter; empty state with no buckets.
- Existing detailed-mode budget tests must continue to pass unchanged.

## File structure

**New:** `src/app/budget-rates.ts`, `src/app/budget-rates.test.ts`, blended
report test (extend `budget-report-bucket.test.ts` or add
`budget-report-blended.test.ts`).

**Modified:** `types.ts`, `budget-report.ts`, `budget-panel.tsx`,
`budget-bucket-modal.tsx`, `reports.tsx`, `workspace-section.tsx`, `i18n.ts`,
`i18n.de.ts`, `version.ts`, `CHANGELOG.md`, `README.md`, `docs/CODEMAPS/*`.

## Out of scope (YAGNI)

- Weighted (by-hours) blending — explicitly rejected in favor of unweighted mean.
- Auto-collapsing detailed values into discipline sums on switch — values are
  discarded by design.
- Per-discipline-row rate overrides — single per-bucket pair only.
- PDF export of the budget report.
