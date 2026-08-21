# Sample Budget Data — Design Spec

**Date:** 2026-06-02
**Status:** Approved (design)

## Goal

Replace the single empty `Bucket 1` in `sample-workspace.md`'s **Budgets**
section with five buckets that exercise the full budget feature set added this
release line (detailed vs blended planning, per-bucket rate overrides,
fixed-price, closed-with-successor spillover), so the Budget panel and the
Budget Report — including the embedded Budget Report in the composable Reports
view — show meaningful data.

## Scope

- Only the **Budgets** table changes. Every other section of
  `sample-workspace.md` (Tasks, RAID, Absences, Shifts, Disciplines, Grades,
  Roles, Resources, Plan) stays byte-identical.
- The composable-reports selection (`settings.reports.extra`) is localStorage
  settings, NOT part of the workspace file — out of scope here.
- All buckets are EUR (the sample has no `fxRates` table; rate behavior is
  demonstrated via blended rates + per-bucket overrides, not FX).

## Reference data (already in `sample-workspace.md`)

- **Plan:** 2026-04-01 → 2026-07-31, monthly, EUR → period keys `2026-04`,
  `2026-05`, `2026-06`, `2026-07`.
- **Disciplines:** 1 Developer, 2 Business Analyst, 3 Consultant, 4 Project Manager.
- **Roles:** 1 (Dev/Senior 95/145), 2 (Dev/Lead 110/165), 3 (BA/Consultant 80/120),
  4 (PM/Senior 100/150), 5 (Dev/Consultant 75/110), 6 (Consultant/Lead 115/170).
- **Resources:** 1 Sample→role 1, 2 Fictional→role 2, 3 Aria→role 3, 4 Invented→role 4,
  5 David→role 5.

## The five buckets (replace the current `budgets` array)

Authored as `BudgetBucket` objects. `order` is 0-based in listed order.

```ts
const budgets: BudgetBucket[] = [
  // 1) Detailed T&M — per-role allocations with budget + actual hours.
  {
    id: 1, name: "Identity Platform – T&M", poNumber: "4400125303",
    type: "tm", currency: "EUR", startDate: "2026-04-01", endDate: "2026-07-31",
    status: "open", order: 0, planningMode: "detailed",
    allocations: [
      { roleId: 1, resourceIds: [1], budgetHours: { "2026-04": 120, "2026-05": 120, "2026-06": 80, "2026-07": 60 }, actualHours: { "2026-04": 118, "2026-05": 130, "2026-06": 44 } },
      { roleId: 3, resourceIds: [3], budgetHours: { "2026-04": 60, "2026-05": 80, "2026-06": 70, "2026-07": 40 }, actualHours: { "2026-04": 55, "2026-05": 78 } },
      { roleId: 4, resourceIds: [4], budgetHours: { "2026-04": 40, "2026-05": 40, "2026-06": 40, "2026-07": 30 }, actualHours: { "2026-04": 42, "2026-05": 38 } },
    ],
  },
  // 2) Blended (discipline-only) — discipline allocations, avg grade rate.
  {
    id: 2, name: "Advisory Retainer (blended)", poNumber: "4400141354",
    type: "tm", currency: "EUR", startDate: "2026-04-01", endDate: "2026-07-31",
    status: "open", order: 1, planningMode: "blended", allocations: [],
    disciplineAllocations: [
      { disciplineId: 3, resourceIds: [5], budgetHours: { "2026-04": 80, "2026-05": 80, "2026-06": 60 }, actualHours: { "2026-04": 75, "2026-05": 82 } },
      { disciplineId: 1, resourceIds: [2], budgetHours: { "2026-04": 40, "2026-05": 40 }, actualHours: { "2026-04": 38, "2026-05": 36 } },
    ],
  },
  // 3) Rate override — per-bucket internal/external rates applied to all lines.
  {
    id: 3, name: "Capped SOW (rate override)", poNumber: "4400087177",
    type: "tm", currency: "EUR", startDate: "2026-04-01", endDate: "2026-07-31",
    status: "open", order: 2, planningMode: "detailed",
    rateOverrideInternal: 90, rateOverrideExternal: 200,
    allocations: [
      { roleId: 2, resourceIds: [2], budgetHours: { "2026-04": 50, "2026-05": 50, "2026-06": 50 }, actualHours: { "2026-04": 48, "2026-05": 52 } },
    ],
  },
  // 4) Fixed-price — contract amount, with role allocations for burn tracking.
  {
    id: 4, name: "Data Migration (fixed price)", poNumber: "4400098499",
    type: "fixed", currency: "EUR", fixedPriceAmount: 80000,
    startDate: "2026-04-01", endDate: "2026-07-31", status: "open", order: 3,
    planningMode: "detailed",
    allocations: [
      { roleId: 1, resourceIds: [1], budgetHours: { "2026-04": 60, "2026-05": 60 }, actualHours: { "2026-04": 62, "2026-05": 58 } },
      { roleId: 5, resourceIds: [5], budgetHours: { "2026-04": 40 }, actualHours: { "2026-04": 40 } },
    ],
  },
  // 5) Closed with successor — remaining budget spills into bucket 1.
  {
    id: 5, name: "Discovery Phase (closed)", poNumber: "4400053230",
    type: "tm", currency: "EUR", startDate: "2026-04-01", endDate: "2026-04-30",
    status: "closed", closedDate: "2026-04-30", successorId: 1, order: 4,
    planningMode: "detailed",
    allocations: [
      { roleId: 3, resourceIds: [3], budgetHours: { "2026-04": 50 }, actualHours: { "2026-04": 30 } },
    ],
  },
];
```

Notes: ids are unique; `successorId: 1` references an existing bucket; closed
bucket 5 has budget (50h) > actual (30h) so it spills remaining budget into
bucket 1; bucket 3's override (90/200) overrides role 2's 110/165 for every line;
bucket 2's blended rates derive from the Developer/Consultant role averages.

## Authoring method

The `Allocations` / `DisciplineAllocations` markdown cells use the
`roleId;resourceIds(.);budgetHours;actualHours` (`~`-joined) codec whose period
maps use `|` — which collides with the markdown table delimiter and is escaped
by the MD layer. Hand-writing those cells is error-prone, so:

1. Read `sample-workspace.md` and locate the Budgets section (the `# Budgets`
   header, its header + separator rows, and the single data row), bounded below
   by the `## Plan` line.
2. Build the five `BudgetBucket` objects above and serialize each to a markdown
   table row using the app's **own** budget row serializer — the same
   `BUDGETS_CSV_COLUMNS` order + `budgetFieldToString` cell encoder that
   `workspaceToMarkdown` uses (which applies the correct pipe-escaping) — via a
   throwaway vitest/node script that imports from `./storage`/`./sanitize`. Do
   NOT hand-encode the allocation cells.
3. Replace ONLY the single existing data row with the five generated rows; leave
   the `# Budgets` header, the column-header row, the separator row, and every
   other section unchanged.

The exact column order is the existing header:
`ID | Name | PO | Type | Currency | FixedPrice | Start | End | SuccessorId |
Status | Closed | FxOverride | Allocations | LocalModified | Order |
PlanningMode | DisciplineAllocations | RateOverrideInternal | RateOverrideExternal`.

## Verification

- **Round-trip test** (`sample-workspace-budget.test.ts` or similar, or a check
  step): read the updated `sample-workspace.md`, run `markdownToWorkspace`, and
  assert: 5 budgets parsed; bucket 1 has 3 role allocations with the expected
  budget/actual hours; bucket 2 is `planningMode==="blended"` with 2 discipline
  allocations; bucket 3 has `rateOverrideInternal===90`/`rateOverrideExternal===200`;
  bucket 4 is `type==="fixed"` with `fixedPriceAmount===80000`; bucket 5 is
  `status==="closed"` with `successorId===1`. Then run `computeBudgetReport` over
  the parsed workspace and assert the project rollup has non-zero
  budgetHours/actualHours/revenue/cost.
- **App smoke:** with the dev server running, the Budget panel shows the five
  buckets (detailed tables, the blended discipline table, the override, the
  fixed-price CCI), and Reports → Budget Report renders the per-bucket detail
  table with non-zero figures.
- Full gate (`vitest`/`tsc`/`eslint`) green; the regenerated rows must parse
  without breaking the existing markdown round-trip tests.

## Out of scope (YAGNI)

- Regenerating the entire file via `workspaceToMarkdown` (would reformat every
  section — we splice only the Budgets rows).
- A USD/FX bucket (no `fxRates` in the sample).
- Seeding `settings.reports.extra` (localStorage, not the workspace file).
- Any code change to the app (this is seed-data only, plus a verification test).
