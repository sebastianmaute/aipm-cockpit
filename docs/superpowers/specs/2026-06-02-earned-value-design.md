# Earned Value (SPI/CPI) — Design

**Date:** 2026-06-02
**Status:** Approved design (pre-implementation)
**Roadmap position:** Feature #3 of 3 — Health Dashboard ✅ → Milestones ✅ → **Earned Value (SPI/CPI)**. Final roadmap item.

## Goal

Add task-effort-based Earned Value Management: PV / EV / AC and the derived
SPI / CPI / SV / CV, computed from existing task data (`originalEstimateMinutes`,
`timeSpentMinutes`, `completedDate`, `dueDate`). Surfaced on the dashboard's
budget-burn band (at-a-glance) and in the Budget Report (full table). Purely
derived — no new persisted state.

## Why task-effort-based (not budget-cost-based)

EVM needs an independent "work performed" measure. The budget engine has no
progress signal (its `actualHours`/`consumedValue` measure *spend*, not *earned*),
so a budget-based EV collapses toward AC and CPI becomes meaningless. Tasks DO
have a progress signal: `completedDate` (binary completion). So EVM is built from
tasks. The budget report's existing `costPerformance`/`consumption` already serve
the cost-vs-budget need; this feature adds the distinct earned-value view.

There is **no baseline snapshot** in the app; the current task estimates and due
dates serve as the schedule/cost basis. Acceptable for progress tracking.

## Definitions (the math)

A task **participates** in EVM iff `originalEstimateMinutes` is set and `> 0`.
Tasks without an estimate are excluded from PV/EV/AC; `coverage` reports how many
participate so the UI can flag low coverage. All values computed in **hours**
(minutes / 60).

- **PV** (Planned Value) = Σ `originalEstimateMinutes` of participating tasks with `dueDate <= today`. *(What was planned to be done by now. Future-due tasks excluded.)*
- **EV** (Earned Value) = Σ `originalEstimateMinutes` of participating tasks with `completedDate` set and `completedDate <= today`. *(Budgeted effort of completed work — earned when done, even if completed early or late.)*
- **AC** (Actual Cost) = Σ `timeSpentMinutes` of participating tasks (0 when absent). *(All effort expended on estimated work to date.)*
- **SPI** = `pv > 0 ? ev / pv : null`
- **CPI** = `ac > 0 ? ev / ac : null`
- **SV** = `ev - pv` (hours) — always defined.
- **CV** = `ev - ac` (hours) — always defined.

**Money overlay:** each absolute (PV/EV/AC/SV/CV) × a project blended internal
rate (€/h). SPI/CPI are ratios, so the rate cancels — money only rescales the
absolutes. `money` is `null` when there are no roles / the rate is 0.

**Worked example (validates the engine):** today 2026-06-15; tasks T1(est 40h, due Jun01, done May30, spent 45h), T2(24h, Jun10, done Jun12, 20h), T3(16h, Jun12, open, 10h), T4(40h, Jun30, open, 0h) → PV 80, EV 64, AC 75 → SPI 0.80, CPI 0.85, SV −16, CV −11.

## Architecture

### `evm.ts` (new, pure logic — testable core)
```ts
export type EvmMetrics = {
  pv: number; ev: number; ac: number;          // hours
  spi: number | null; cpi: number | null;
  sv: number; cv: number;                       // hours
  money: { pv: number; ev: number; ac: number; sv: number; cv: number } | null;
  coverage: { withEstimate: number; total: number };
};

export function computeEvm(
  tasks: readonly Task[],
  todayISO: string,
  opts?: { blendedRate?: number },
): EvmMetrics;

/** Mean internal rate across roles; 0 when there are no roles (→ no € overlay). */
export function projectBlendedInternalRate(roles: readonly Role[]): number;
```
No React, no I/O. Imports `Task`/`Role` from `./types`.

### Dashboard (`dashboard.ts` + `dashboard-panel.tsx` + `dashboard-sections`)
- `computeDashboard` computes `evm = computeEvm(input.tasks, today, { blendedRate: projectBlendedInternalRate(input.roles) })`.
- `DashboardModel` gains `evm: EvmMetrics`. **Independent of budgets** — EVM renders even when no budget is configured.
- The budget-burn `Section` renders **SPI / CPI** (and **SV / CV**) tiles alongside the existing budget tiles. When `coverage.withEstimate === 0`, show a "no task estimates" note instead of the EVM tiles. **No RAG change** (informational in v1).

### Budget Report (`budget-report-panel.tsx`)
- Add an **Earned Value section**: PV / EV / AC and SPI / CPI / SV / CV in **hours and €**, plus a coverage line ("N of M tasks have estimates").
- `BudgetReportPanel` gains a `tasks` prop (it currently doesn't receive tasks); the blended rate is derived from its existing `roles` prop. The `workspace-section.tsx` mount passes `tasks`.

### No new entity / nav / persistence
EVM is purely derived from existing `tasks` + `roles`. No `Workspace` field, no
`sanitize`/storage/migration, no Turso change, no nav view.

### i18n
New keys (EN `i18n.ts` + DE `i18n.de.ts`, straight ASCII `"` delimiters) for:
PV/EV/AC labels, SPI/CPI/SV/CV labels, the Earned Value section title, the burn-band
EVM labels, the "no estimates" note, the coverage line, and the hours/€ unit hints.

## Error handling & edge cases

- Empty workspace / no participating tasks → PV=EV=AC=0, SPI=CPI=`null`, money=`null`, coverage `{0, total}`; UI shows the "no estimates" state. No divide-by-zero (null guards on SPI/CPI).
- Task with `timeSpentMinutes` but no estimate → excluded entirely (does not inflate AC), keeping CPI honest.
- Completed task with a future `dueDate` → contributes to EV (earned) but not PV (not yet scheduled) — correctly shows ahead-of-schedule (SPI > 1).
- No roles → `projectBlendedInternalRate` returns 0 → `money: null` → UI shows hours only.

## Testing

- **`evm.test.ts`** (primary, AAA): the worked example (PV 80 / EV 64 / AC 75 → SPI 0.80 / CPI 0.85 / SV −16 / CV −11); null-divisor (no PV → SPI null; no AC → CPI null); coverage count; money overlay (absolutes scale by rate, SPI/CPI unchanged); future-due excluded from PV; completed-early still earns EV; no-estimate task excluded from all three; `projectBlendedInternalRate` (mean; 0 for no roles).
- **`dashboard.test.ts`** extended: `baseInput` gains nothing new (tasks/roles already present); assert `model.evm` is populated and reflects task estimates; assert it's present even with `budgets: []`.
- **Budget-report-panel / dashboard-panel** smoke: render the EVM section/tiles without crashing (and the no-estimates state).
- No storage/persistence tests (nothing persisted).

## Out of scope (v1 / deferred)

- **Fold EVM thresholds into the dashboard RAGs** (CPI→Budget Amber/Red, SPI→Schedule) — explicitly deferred per the design discussion; **REMIND the user about this when EVM ships / next iteration.** Informational-only in v1 to avoid double-counting (low SPI correlates with overdue tasks already driving Schedule) and keep each RAG explainable.
- Time-phased EVM / earned-value S-curve over time (needs historical snapshots the app doesn't keep — snapshots were deferred earlier in the roadmap).
- Per-task rates / partial (non-binary) task progress.
- Budget-bucket-based EV (blocked by the missing independent progress measure).

## Assumptions (defaults — flag if wrong)

- Participation gate: `originalEstimateMinutes > 0`.
- Blended rate = arithmetic mean of role `internalRate`s (cost basis); 0 when no roles.
- EV counts a completed task's full estimate regardless of its due date (binary completion; no partial credit).
- AC counts time spent on participating tasks only.
- Hours = minutes / 60, rounded only at display.

## Dependency / branching

Builds on #1 (dashboard burn band) and the Budget Report, both now in local `main`.
The implementation branch (`feat-earned-value`) branches cleanly off `main` — no
stacking this time.
