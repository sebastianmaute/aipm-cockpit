# Project Budget Planner — Design

- **Date:** 2026-05-26
- **Status:** Approved (design) — pending implementation plan
- **Author:** brainstormed with the user
- **Example input:** `docs/patterns/Book2.xlsx` ("Budget Overview" sheet)

## 1. Summary

Add a **Project Budget Planner** to the lop-app workspace. It models a single
project-level budget made of named **budget buckets** (PO/contract lines). Each
bucket spans one or more **roles**, draws its **planned hours from the existing
resource utilization/capacity engine**, and tracks **manually entered actuals**
(booked/used hours). Buckets are time-phased across the project duration,
carry a configurable currency (EUR/USD/GBP) backed by ECB exchange rates, can
**spill remaining budget into a successor bucket** when closed, and surface a
three-value **CCI** panel at both bucket and project level.

This mirrors the real consulting controlling sheet in `Book2.xlsx`: budgets
grouped by discipline/role with internal/external rates, buckets keyed by PO
number, a spillover row, Bookings (Used h) vs Budget (Plan h) → Consumption
delta (win/loss), and monthly time-phasing.

## 2. Decisions (locked during brainstorming)

| Topic | Decision |
|-------|----------|
| **CCI** | A panel of **three distinct values**, each shown as amount + percent: (1) Contribution margin (DB), (2) Cost performance (CPI), (3) Consumption/burn. Computed at bucket and project level. |
| **Bucket scope** | A bucket = a **PO/contract line that spans roles**. It holds per-role allocation lines. |
| **Actuals source** | **Plan from resources, actuals entered.** Planned hours derive from resource capacity/utilization; actuals (used h) entered manually per bucket/role/period. Win/loss compares them. |
| **FX rates** | **Server route fetches ECB daily rates (EUR base), cached in the workspace.** Per-bucket manual override wins while present; clearing it falls back to the latest cached/fetched ECB rate. Offline after first fetch. |
| **Budget types** | **T&M = revenue scales with used hours** (external rate); cost = used h × internal rate. **Fixed-price = revenue is the fixed contract amount** regardless of hours; cost = used h × internal rate; win/loss = fixed price − cost. |
| **Spillover** | **Explicit successor link + manual close.** Remaining budget (hours & amount) rolls into the named successor. Each bucket also has **start/end dates**; an approaching end date fires a **reminder** via the existing due-alert/notification system. |
| **Hierarchy** | **One project budget** (this workspace) aggregates all buckets → rolled-up project CCI. **Type lives per bucket.** |
| **Resource→bucket** | **Per-role-line resource lists.** Each bucket role-allocation names the role + the specific resources feeding its plan. |
| **Budget figure** | **Per-period budget hours.** Each role-line carries budgeted hours per period (full monthly/weekly phasing, aligned to the `ResourcePlan` periods). Budget € derived = hours × role external rate (Fixed-price buckets carry one contract amount instead). |

## 3. Architecture & approach

Add **Budget** as a first-class workspace entity, following the established
pattern for resources/roles/absences:

```
new type (types.ts)
  → sanitizer (sanitize.ts)
  → IDB store + CSV/MD/JSON sections + migration (storage.ts)
  → schema bump v5 → v6
  → pure calc engine (budget-report.ts) reusing resource-capacity.ts
  → new top tab + panel (budget-panel.tsx)
  → EN+DE i18n
```

Rejected alternatives:
- **Side-store (IDB/JSON only):** less work but breaks CSV/MD export and the
  local-file round-trip; inconsistent with every other entity.
- **Extend `ResourcePlan`/reports:** too cramped — buckets need their own
  structure (currency, dates, successor, allocations).

Periods reuse the existing `ResourcePlan` granularity (week/month) and
`generatePeriods()`/`displayCapacityHours()` so budget phasing aligns with the
resource planner with no parallel period machinery.

## 4. Data model (`types.ts`)

```ts
export type BudgetType = "tm" | "fixed";              // time-&-material | fixed-price
export const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP"] as const;
export type BudgetCurrency = (typeof SUPPORTED_CURRENCIES)[number];
export type BucketStatus = "open" | "closed";

// One role line in a bucket: a role, the resources feeding its plan,
// per-period budgeted hours, and per-period actual (booked) hours.
export type BucketAllocation = {
  roleId: number;                          // FK -> Role (supplies internal/external rate)
  resourceIds: number[];                   // resources whose capacity = this line's PLAN
  budgetHours: Record<string, number>;     // periodKey -> budgeted hours (per-period)
  actualHours: Record<string, number>;     // periodKey -> booked/used hours
};

export type BudgetBucket = {
  id: number;
  name: string;
  poNumber?: string;
  type: BudgetType;
  currency: BudgetCurrency;
  fixedPriceAmount?: number;               // bucket currency; only when type === "fixed"
  startDate: string;                       // YYYY-MM-DD
  endDate: string;                         // YYYY-MM-DD; drives reminders + active periods
  successorId?: number | null;             // receives remaining budget on close
  status: BucketStatus;
  closedDate?: string;
  fxRateOverride?: number;                  // EUR -> currency units; wins while present
  allocations: BucketAllocation[];
  localModifiedAt?: string;
};

// Cached ECB reference rates (EUR base), one per workspace.
export type FxRates = {
  base: "EUR";
  date: string;                            // ECB publication date (YYYY-MM-DD)
  fetchedAt: string;                       // ISO timestamp of the fetch
  rates: Record<string, number>;           // currency -> units per 1 EUR (e.g. USD: 1.08)
};
```

`Workspace` gains:

```ts
budgets: BudgetBucket[];
fxRates: FxRates | null;
```

Role rates (`internalRate`/`externalRate`) are stored in the **plan base
currency (EUR)**. Bucket amounts are presented in the **bucket currency**;
the project rollup converts every bucket back to EUR.

## 5. Calculation engine (`budget-report.ts`, pure)

For each bucket, for each allocation, for each period in
`[bucket.startDate, bucket.endDate] ∩ plan periods`:

- **Planned hours** = Σ over `resourceIds` of `displayCapacityHours(...)`
  (existing engine), priced at the allocation's `Role` rates.
- **Budget hours** = `allocation.budgetHours[periodKey]` (entered).
- **Actual hours** = `allocation.actualHours[periodKey]` (entered).
- **Cost (internal)** = internalRate × hours.
- **Revenue (external)**:
  - **T&M:** externalRate × actual hours.
  - **Fixed-price:** the bucket's `fixedPriceAmount` (recognized at the
    **bucket** level, not per actual hour). Per-role contribution margin is
    therefore only meaningful for T&M buckets; for Fixed-price buckets margin
    is reported at bucket/project level only (per-role rows still show
    hours/cost, with revenue shown as "—").

All € figures are computed in EUR from role rates, then converted to the
bucket currency for display (§7). The project rollup aggregates in EUR.

**Budget value basis** (used for the € amount of budget vs. consumed): T&M uses
`externalRate × budget hours`; Fixed-price uses `fixedPriceAmount`. "Consumed"
value uses `externalRate × actual hours` (T&M) or recognized
`fixedPriceAmount` proportionally (Fixed-price).

### 5.1 CCI panel — three distinct values

Each value is reported as **amount + percent**, at bucket and project level:

1. **Contribution margin (DB):** `amount = revenue − cost`; `% = amount ÷ revenue`.
2. **Cost performance (CPI):** `amount = budgetCost − actualCost`;
   `% = budgetCost ÷ actualCost` (budgetCost = internalRate × budget hours;
   actualCost = internalRate × actual hours).
3. **Consumption / burn:** `amount = budgetValue − consumedValue (remaining)`;
   `% = consumedValue ÷ budgetValue` (using the budget value basis defined
   below). Also reported in hours: `% = actual hours ÷ budget hours`.

Division guards: when a denominator is 0, the percent is reported as `null`
(rendered as "—"), never `Infinity`/`NaN`.

### 5.2 Win/loss

`winLossHours = Σ(budgetHours − actualHours)` and the € equivalent,
**cumulative-to-date** across the duration. Positive = under budget (win),
negative = overrun (loss).

## 6. Spillover & lifecycle

- A bucket is closed **manually** (sets `status="closed"`, `closedDate`).
- On close, its **remaining budget** (`budget − actual`, in hours and €) rolls
  into `successorId`'s available budget.
- Spillover is **computed in the report layer** (closed bucket's remainder
  surfaces as `spilloverIn` on the successor's figures); stored bucket data is
  not mutated. This keeps the model clean and reversible (reopen → spillover
  disappears).
- Cycle guard: a successor chain must not form a cycle; rejected at the UI
  boundary and ignored defensively in the report.
- **Reminders:** each bucket's `endDate` feeds the existing
  `due-dates.ts` / `use-due-alerts` pipeline so an approaching end date fires a
  notification (snooze-able like task reminders).

## 7. Currency / ECB

- New **`/api/ecb` route** (mirrors `src/app/api/jira`): server-side fetch of
  the ECB daily reference XML
  (`https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`), parsed to
  EUR-base rates `{ date, rates }`, with sane cache headers and error handling.
- The client caches the result into `workspace.fxRates`.
- **Rate resolution per bucket** (`fx.ts`):
  `bucket.fxRateOverride` (non-empty) → `fxRates.rates[currency]` → `EUR = 1`.
  Clearing the override falls back to cache. Fully offline after first fetch.
- `convert(amountEur, currency, bucket, fxRates)` returns the amount in the
  bucket currency; the inverse normalizes bucket amounts back to EUR for the
  project rollup.

## 8. Persistence (`storage.ts`, `sanitize.ts`)

- `sanitizeBudgetBucket()` + `sanitizeFxRates()` in `sanitize.ts`
  (validate enums, clamp negatives where appropriate, drop dangling
  `roleId`/`resourceIds`/`successorId` defensively).
- New IDB object store **`budgets`** (keyPath `id`); `fx-rates` stored under a
  **KV key** (like `resource-plan`).
- CSV section **`# BUDGETS`** and Markdown section **`# Budgets`**; period maps
  encoded with the existing `encodePeriodMap` helper; allocations encoded as a
  nested/escaped sub-format (round-trips through CSV/MD/JSON).
- JSON envelope gains `budgets` and `fxRates`.
- **Schema bump v5 → v6** with an idempotent migration: absent `budgets` → `[]`,
  absent `fxRates` → `null`. `IDB_VERSION` bump adds the `budgets` store in
  `onupgradeneeded`.
- Touch points: `broadcast-sync.ts` (cross-tab), `use-storage-backend.ts`
  (load/save wiring), export menu (`export.ts` / `export-menu.tsx`).

## 9. UI

- New `TopTab` value **`"budget"`** (in `workspace-tab-context.tsx`) + a tab in
  the header.
- **`budget-panel.tsx`:**
  - Bucket list with create/edit/delete; bucket editor for name, PO number,
    type (T&M/Fixed), currency + FX field, start/end dates, successor picker,
    close/reopen action.
  - Per-bucket **allocation grid**: role rows × period columns, each cell
    showing budget / plan / actual hours (budget & actual editable, plan
    read-only from resources). Role line names its resources.
  - **CCI cards** (3 values × amount/%), win/loss, and the project-level rollup.
- EN + DE i18n strings (`i18n.ts`, `i18n.de.ts`).

## 10. Testing (Vitest, ≥80% coverage)

- Calc engine: CCI ×3 (incl. zero-denominator guards), T&M vs Fixed revenue,
  win/loss cumulative, spillover into successor, FX resolution precedence,
  period intersection with bucket start/end.
- Sanitizer: enum/over-range/dangling-FK handling.
- Storage round-trip: CSV ↔ MD ↔ JSON ↔ IDB for budgets + fxRates; v5→v6
  migration idempotency.
- `/api/ecb`: XML parse + error fallbacks (mocked fetch).
- Panel: render + edit interactions for the allocation grid and CCI cards.

## 11. Phasing (for the implementation plan)

1. **Model + persistence + calc engine** — types, sanitizer, storage (all
   formats), migration v6, `budget-report.ts` with CCI/win-loss/T&M-fixed/
   per-period budget/plan-from-resources/actuals. Unit tested.
2. **FX / ECB** — `/api/ecb` route, `fx.ts` resolution (manual override +
   cache), currency display + EUR project rollup.
3. **Spillover + reminders + UI** — successor close/spillover, bucket
   end-date reminders, `budget-panel.tsx`, tab wiring, i18n, panel tests.

## 12. Out of scope (YAGNI)

- Multiple named project budgets (single project budget only).
- Importing `Book2.xlsx` directly (it is a design reference, not an import
  target).
- Historical FX time series / per-period FX (one cached rate table per
  workspace; per-bucket override only).
- Currencies beyond EUR/USD/GBP.
