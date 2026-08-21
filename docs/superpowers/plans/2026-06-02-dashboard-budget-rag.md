# Dashboard + Budget RAG Enhancements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add RAG status across the budget panel, budget report, and dashboard; a dependency-free twin burn-down chart (hours + €); and dashboard polish (RAG icons, print-static overrides, directory hover, currency symbol, boxed sections).

**Architecture:** Two new pure modules (`budget-health.ts` thresholds, `budget-burndown.ts` per-period series) feed two new pure-render components (`RagBadge`, `BurndownCharts`). `report-table.tsx` primitives gain a `boxed` Section and a `rag` Tile slot. Wiring threads these through the existing dashboard/budget panels. No new persisted state, nav, or migration.

**Tech Stack:** Next.js 16 / React / TypeScript, Vitest 4 + React Testing Library, Tailwind v4 (AIPM palette). Tests run with `npm run test:run`, types with `npx tsc --noEmit`, lint with `npm run lint`.

**Branch:** `feat-budget-rag-burndown` (already created off `main`).

**Conventions:**
- AIPM palette only (no off-palette hex). `healthDot` (`bg-red-500`/`bg-amber-500`/`bg-emerald-500`) is already permitted and used.
- i18n parity: every EN key in `i18n.ts` must have a DE twin in `i18n.de.ts` (tsc enforces). After editing `i18n.de.ts`, verify ASCII straight quotes (the Edit tool can corrupt `"`→`"`).
- Commit per task with the Bash tool using `git commit -F - <<'EOF' … EOF`.

---

### Task 1: `budget-health.ts` — RAG thresholds (pure)

**Files:**
- Create: `src/app/budget-health.ts`
- Test: `src/app/budget-health.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/budget-health.test.ts
import { describe, it, expect } from "vitest";
import {
  ratioHealth, marginHealth, costPerformanceHealth, winLossHealth,
} from "./budget-health";

describe("ratioHealth (over-budget bands: G <90%, A 90-100%, R >100%)", () => {
  it("is null when budget is zero or negative", () => {
    expect(ratioHealth(10, 0)).toBeNull();
    expect(ratioHealth(10, -5)).toBeNull();
  });
  it("is Green below 90%", () => {
    expect(ratioHealth(89, 100)).toBe("G");
  });
  it("is Amber from 90% up to and including 100%", () => {
    expect(ratioHealth(90, 100)).toBe("A");
    expect(ratioHealth(100, 100)).toBe("A");
  });
  it("is Red above 100%", () => {
    expect(ratioHealth(101, 100)).toBe("R");
  });
});

describe("marginHealth (R <0, A 0-15%, G >=15%)", () => {
  it("passes null through", () => { expect(marginHealth(null)).toBeNull(); });
  it("is Red for negative margin", () => { expect(marginHealth(-0.1)).toBe("R"); });
  it("is Amber from 0 up to (not including) 15%", () => {
    expect(marginHealth(0)).toBe("A");
    expect(marginHealth(14.9)).toBe("A");
  });
  it("is Green at 15% and above", () => { expect(marginHealth(15)).toBe("G"); });
});

describe("costPerformanceHealth (percent = budgetCost/cost*100; R <80, A <90, G >=90)", () => {
  it("passes null through", () => { expect(costPerformanceHealth(null)).toBeNull(); });
  it("is Red below 80", () => { expect(costPerformanceHealth(79.9)).toBe("R"); });
  it("is Amber from 80 to <90", () => {
    expect(costPerformanceHealth(80)).toBe("A");
    expect(costPerformanceHealth(89.9)).toBe("A");
  });
  it("is Green at 90 and above", () => { expect(costPerformanceHealth(90)).toBe("G"); });
});

describe("winLossHealth (mirrors consumption ratio)", () => {
  it("is Red when consumed exceeds budget", () => { expect(winLossHealth(110, 100)).toBe("R"); });
  it("is Green when comfortably under", () => { expect(winLossHealth(50, 100)).toBe("G"); });
  it("is null when no budget", () => { expect(winLossHealth(50, 0)).toBeNull(); });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- budget-health`
Expected: FAIL — cannot find module `./budget-health`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/budget-health.ts
// Pure RAG (Red/Amber/Green) thresholds for budget money/hours metrics.
// Single source of truth shared by the budget panel, budget report, and
// dashboard. No React, no I/O.

import type { Health } from "./health";

/** Ratio bands where exceeding budget is bad: Green <90%, Amber 90-100%, Red >100%. */
export const BUDGET_OVER_AMBER = 0.9;
export const BUDGET_OVER_RED = 1.0;
/** Contribution-margin Green threshold (percent). Negative margin is always Red. */
export const MARGIN_GREEN_PCT = 15;
/** Cost-performance index bands as percent (budgetCost/cost*100). Mirrors EVM CPI. */
export const COST_PERF_RED = 80;
export const COST_PERF_AMBER = 90;

/** Over-budget ratio health. Green below 90% of budget, Amber from 90% up to and
 *  including 100%, Red above 100%. null when there is no budget to compare against. */
export function ratioHealth(actual: number, budget: number): Health | null {
  if (!(budget > 0)) return null;
  const r = actual / budget;
  if (r > BUDGET_OVER_RED) return "R";
  if (r >= BUDGET_OVER_AMBER) return "A";
  return "G";
}

/** Contribution-margin health from a percent. Red below 0, Amber 0-15%, Green >=15%. */
export function marginHealth(percent: number | null): Health | null {
  if (percent === null) return null;
  if (percent < 0) return "R";
  if (percent < MARGIN_GREEN_PCT) return "A";
  return "G";
}

/** Cost-performance health from a percent (budgetCost/cost*100). R <80, A <90, G >=90. */
export function costPerformanceHealth(percent: number | null): Health | null {
  if (percent === null) return null;
  if (percent < COST_PERF_RED) return "R";
  if (percent < COST_PERF_AMBER) return "A";
  return "G";
}

/** Win/Loss health mirrors the consumption ratio (the two are inverse). */
export function winLossHealth(consumedValue: number, budgetValue: number): Health | null {
  return ratioHealth(consumedValue, budgetValue);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- budget-health`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/app/budget-health.ts src/app/budget-health.test.ts
git commit -F - <<'EOF'
feat: add budget-health RAG threshold helpers

Pure module mapping consumption/hours ratios, margin %, cost-performance
index, and win/loss to Red/Amber/Green. Single source of truth for the
budget panel, budget report, and dashboard.
EOF
```

---

### Task 2: `budget-burndown.ts` — per-period remaining series (pure)

**Files:**
- Modify: `src/app/budget-report.ts` (export `bucketRateRows`)
- Create: `src/app/budget-burndown.ts`
- Test: `src/app/budget-burndown.test.ts`

**Context:** `bucketRateRows(bucket, roles)` already exists privately in `budget-report.ts` (around line 96). It returns `{ rates: { internal, external }, budgetHours, actualHours, resourceIds }[]` for both detailed (per-role) and blended (per-discipline) buckets. The burn-down only needs the per-period `budgetHours`/`actualHours` maps and the `external` rate (€ basis = external-rate × hours). `Period` is `{ key: string; start: string; end: string }` from `resource-capacity.ts`; `generatePeriods(startDate, endDate, granularity)` returns the ordered plan periods.

- [ ] **Step 1: Export `bucketRateRows`**

In `src/app/budget-report.ts`, change the declaration (line ~96) from:

```ts
function bucketRateRows(bucket: BudgetBucket, roles: readonly Role[]): RateRow[] {
```

to:

```ts
export function bucketRateRows(bucket: BudgetBucket, roles: readonly Role[]): RateRow[] {
```

Also export the row type so the burn-down can name it — change `type RateRow = {` (line ~87) to `export type RateRow = {`.

- [ ] **Step 2: Write the failing test**

```ts
// src/app/budget-burndown.test.ts
import { describe, it, expect } from "vitest";
import { computeBurndownSeries } from "./budget-burndown";
import type { BudgetBucket, ResourcePlan, Role } from "./types";

const plan: ResourcePlan = {
  startDate: "2026-01-01", endDate: "2026-03-31",
  granularity: "month", currency: "EUR", rows: [],
} as unknown as ResourcePlan;

const roles: Role[] = [
  { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 },
] as unknown as Role[];

function bucket(over: Partial<BudgetBucket> = {}): BudgetBucket {
  return {
    id: 1, name: "B1", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-03-31", status: "open",
    allocations: [{
      roleId: 1, resourceIds: [],
      budgetHours: { "2026-01": 100, "2026-02": 100, "2026-03": 100 },
      actualHours: { "2026-01": 120, "2026-02": 90 },
    }],
    ...over,
  } as unknown as BudgetBucket;
}

describe("computeBurndownSeries", () => {
  it("returns an empty series when there are no buckets", () => {
    const s = computeBurndownSeries([], plan, roles, "2026-02-15");
    expect(s.periods).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(s.totalBudgetHours).toBe(0);
    expect(s.actualRemainingHours.every((v) => v === null)).toBe(false); // see below
  });

  it("computes planned remaining hours descending to zero", () => {
    const s = computeBurndownSeries([bucket()], plan, roles, "2026-02-15");
    expect(s.totalBudgetHours).toBe(300);
    expect(s.plannedRemainingHours).toEqual([200, 100, 0]);
  });

  it("computes actual remaining only up to today's period, null after", () => {
    const s = computeBurndownSeries([bucket()], plan, roles, "2026-02-15");
    expect(s.todayIndex).toBe(1); // 2026-02 starts 2026-02-01 <= 2026-02-15
    // remaining = 300 - cumulative actual: [300-120, 300-210, null]
    expect(s.actualRemainingHours).toEqual([180, 90, null]);
  });

  it("computes € on the external-rate basis", () => {
    const s = computeBurndownSeries([bucket()], plan, roles, "2026-02-15");
    // budget €: 300h * 200 = 60000; planned remaining [40000, 20000, 0]
    expect(s.totalBudgetValue).toBe(60000);
    expect(s.plannedRemainingValue).toEqual([40000, 20000, 0]);
    // actual €: cumulative [120*200, 210*200] -> remaining [60000-24000, 60000-42000, null]
    expect(s.actualRemainingValue).toEqual([36000, 18000, null]);
  });
});
```

> Note: delete the dangling `expect(...actualRemainingHours...)` assertion line in the first test before running — it is a placeholder reminder that an all-null series is valid when there are no budget hours. Replace that test body with: `expect(s.actualRemainingHours).toEqual([0, 0, null]);` after confirming `todayIndex` for "2026-02-15" is 1 and no budget means remaining stays at 0.

Corrected first test body:

```ts
  it("returns a zeroed series when there are no buckets", () => {
    const s = computeBurndownSeries([], plan, roles, "2026-02-15");
    expect(s.periods).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(s.totalBudgetHours).toBe(0);
    expect(s.plannedRemainingHours).toEqual([0, 0, 0]);
    expect(s.actualRemainingHours).toEqual([0, 0, null]);
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:run -- budget-burndown`
Expected: FAIL — cannot find module `./budget-burndown`.

- [ ] **Step 4: Write the implementation**

```ts
// src/app/budget-burndown.ts
// Pure per-period burn-down series for the dashboard + budget report charts.
// Reads budgeted vs actual hours (and € on the external-rate basis) across all
// buckets, returns "remaining" arrays that descend over the plan periods.
// No React, no I/O.

import { generatePeriods } from "./resource-capacity";
import { bucketRateRows } from "./budget-report";
import type { BudgetBucket, ResourcePlan, Role } from "./types";

export type BurndownSeries = {
  periods: string[];
  /** totalBudget - cumulative budgeted, per period (the planned glide-path). */
  plannedRemainingHours: number[];
  plannedRemainingValue: number[];
  /** totalBudget - cumulative actual, defined only up to todayIndex; null after. */
  actualRemainingHours: (number | null)[];
  actualRemainingValue: (number | null)[];
  /** Index of the last period whose start is on or before `today`; -1 if all future. */
  todayIndex: number;
  totalBudgetHours: number;
  totalBudgetValue: number;
};

export function computeBurndownSeries(
  buckets: readonly BudgetBucket[],
  plan: ResourcePlan,
  roles: readonly Role[],
  today: string,
): BurndownSeries {
  const periods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
  const n = periods.length;
  const budgetH = new Array<number>(n).fill(0);
  const actualH = new Array<number>(n).fill(0);
  const budgetV = new Array<number>(n).fill(0);
  const actualV = new Array<number>(n).fill(0);

  for (const b of buckets) {
    const rows = bucketRateRows(b, roles);
    periods.forEach((p, i) => {
      for (const row of rows) {
        const bh = row.budgetHours[p.key] ?? 0;
        const ah = row.actualHours[p.key] ?? 0;
        budgetH[i] += bh;
        actualH[i] += ah;
        budgetV[i] += bh * row.rates.external;
        actualV[i] += ah * row.rates.external;
      }
    });
  }

  const totalBudgetHours = budgetH.reduce((a, v) => a + v, 0);
  const totalBudgetValue = budgetV.reduce((a, v) => a + v, 0);

  let todayIndex = -1;
  for (let i = 0; i < n; i++) if (periods[i].start <= today) todayIndex = i;

  const plannedRemainingHours: number[] = [];
  const plannedRemainingValue: number[] = [];
  const actualRemainingHours: (number | null)[] = [];
  const actualRemainingValue: (number | null)[] = [];
  let cumBH = 0, cumBV = 0, cumAH = 0, cumAV = 0;
  for (let i = 0; i < n; i++) {
    cumBH += budgetH[i]; cumBV += budgetV[i];
    cumAH += actualH[i]; cumAV += actualV[i];
    plannedRemainingHours.push(totalBudgetHours - cumBH);
    plannedRemainingValue.push(totalBudgetValue - cumBV);
    const inPast = i <= todayIndex;
    actualRemainingHours.push(inPast ? totalBudgetHours - cumAH : null);
    actualRemainingValue.push(inPast ? totalBudgetValue - cumAV : null);
  }

  return {
    periods: periods.map((p) => p.key),
    plannedRemainingHours, plannedRemainingValue,
    actualRemainingHours, actualRemainingValue,
    todayIndex, totalBudgetHours, totalBudgetValue,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:run -- budget-burndown budget-report`
Expected: PASS. (Run `budget-report` too to confirm the export change broke nothing.)

- [ ] **Step 6: Commit**

```bash
git add src/app/budget-burndown.ts src/app/budget-burndown.test.ts src/app/budget-report.ts
git commit -F - <<'EOF'
feat: add budget-burndown per-period remaining series

Pure computeBurndownSeries walks the plan periods and returns planned vs
actual remaining hours and € (external-rate basis), with actual defined
only up to today. Exports bucketRateRows from budget-report for reuse.
EOF
```

---

### Task 3: New i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

**Context:** `i18n.ts` is the EN map; `i18n.de.ts` mirrors it. tsc fails the build if a key is missing from either. Add the same ten keys to both. The `budgetActualHours`/`budgetBudgetHours` keys already exist (around line 219).

- [ ] **Step 1: Add EN keys**

In `src/app/i18n.ts`, add near the other `budget*` keys (after `budgetActualHoursHint`, ~line 265):

```ts
  budgetCellPlan: "Plan",
  budgetCellActual: "Actual",
  budgetRoleStatus: "Status",
  budgetBurndownTitle: "Burn-down",
  burndownHoursRemaining: "Hours remaining",
  burndownBudgetRemaining: "Budget remaining",
  burndownPlanned: "Planned",
  burndownActual: "Actual",
  burndownToday: "today",
```

And add the highlight key next to `versionHighlightEvmRag` (~line 1056):

```ts
  versionHighlightBudgetRag: "Budget & dashboard RAG status + burn-down charts",
```

- [ ] **Step 2: Add DE keys**

In `src/app/i18n.de.ts`, add the matching keys in the same positions:

```ts
  budgetCellPlan: "Plan",
  budgetCellActual: "Ist",
  budgetRoleStatus: "Status",
  budgetBurndownTitle: "Burn-down",
  burndownHoursRemaining: "Verbleibende Stunden",
  burndownBudgetRemaining: "Verbleibendes Budget",
  burndownPlanned: "Geplant",
  burndownActual: "Ist",
  burndownToday: "heute",
```

```ts
  versionHighlightBudgetRag: "Budget-/Dashboard-RAG-Status + Burn-down-Diagramme",
```

- [ ] **Step 3: Verify quotes + types**

Run: `npx tsc --noEmit`
Expected: PASS (no missing-key errors). Then grep the DE file to confirm no curly quotes were introduced:

Run: `npm run test:run -- i18n` (if an i18n parity test exists) — Expected: PASS.

Manually confirm the ten DE lines use straight ASCII `"`.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: add i18n keys for budget RAG labels and burn-down charts

EN + DE: Plan/Actual cell labels, role status, burn-down titles/axes,
and the 0.47.0 highlight key.
EOF
```

---

### Task 4: `RagBadge` component

**Files:**
- Create: `src/app/rag-badge.tsx`
- Test: `src/app/rag-badge.test.tsx`

**Context:** A standalone file (not `health.tsx` — that would clash with `health.ts` on import resolution). Reuses `healthDot` and `healthColorName` from `health.ts`. The lettered-dot style: white R/A/G glyph on the RAG fill, grey "–" when null.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/rag-badge.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RagBadge } from "./rag-badge";

describe("RagBadge", () => {
  it("renders the letter and a colour fill for a value", () => {
    render(<RagBadge value="R" lang="en" />);
    const el = screen.getByText("R");
    expect(el.className).toContain("bg-red-500");
    expect(el.getAttribute("aria-label")).toBe("Red");
  });
  it("renders a grey dash with an em-dash label when null", () => {
    render(<RagBadge value={null} lang="en" />);
    const el = screen.getByLabelText("—");
    expect(el.className).toContain("bg-slate-300");
  });
  it("uses a custom title when provided", () => {
    render(<RagBadge value="G" lang="en" title="Consumption: Green" />);
    expect(screen.getByText("G").getAttribute("aria-label")).toBe("Consumption: Green");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- rag-badge`
Expected: FAIL — cannot find module `./rag-badge`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/app/rag-badge.tsx
import { healthColorName, healthDot, type Health } from "./health";
import { type Lang } from "./i18n";

const LETTER: Record<Health, string> = { R: "R", A: "A", G: "G" };

/** Lettered RAG dot: white R/A/G glyph on the health colour, grey "–" when null.
 *  Grayscale-/print-safe (the letter survives loss of colour). Used on the
 *  dashboard pills, budget metrics, the roles table, and in print. */
export function RagBadge({
  value, lang, title,
}: {
  value: Health | null;
  lang: Lang;
  title?: string;
}) {
  const name = value ? healthColorName(value, lang) : "—";
  const label = title ?? name;
  const base = "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white";
  if (!value) {
    return <span aria-label={label} title={label} className={`${base} bg-slate-300`}>–</span>;
  }
  return <span aria-label={label} title={label} className={`${base} ${healthDot[value]}`}>{LETTER[value]}</span>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- rag-badge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/rag-badge.tsx src/app/rag-badge.test.tsx
git commit -F - <<'EOF'
feat: add shared RagBadge (lettered RAG dot)

White R/A/G glyph on the health colour, grey dash when null. One
print-/grayscale-safe component reused across budget and dashboard.
EOF
```

---

### Task 5: `BurndownCharts` component

**Files:**
- Create: `src/app/burndown-chart.tsx`
- Test: `src/app/burndown-chart.test.tsx`

**Context:** Dependency-free inline SVG (no chart library). Renders two side-by-side "remaining" charts (Hours + €). Planned line = muted dashed; actual line = `AIPM-green`, turning `AIPM-pink` when over budget (final actual remaining < 0). Vertical `today` marker. Uses `BurndownSeries` from Task 2 and `formatCurrency` for the € axis caption. Tailwind v4 generates `stroke-AIPM-green`/`stroke-AIPM-pink`/`stroke-muted-foreground` stroke utilities for the registered palette colours.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/burndown-chart.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BurndownCharts } from "./burndown-chart";
import type { BurndownSeries } from "./budget-burndown";

const series: BurndownSeries = {
  periods: ["2026-01", "2026-02", "2026-03"],
  plannedRemainingHours: [200, 100, 0],
  plannedRemainingValue: [40000, 20000, 0],
  actualRemainingHours: [180, 90, null],
  actualRemainingValue: [36000, 18000, null],
  todayIndex: 1,
  totalBudgetHours: 300,
  totalBudgetValue: 60000,
};

describe("BurndownCharts", () => {
  it("renders both chart captions", () => {
    render(<BurndownCharts series={series} lang="en" />);
    expect(screen.getByText("Hours remaining")).toBeTruthy();
    expect(screen.getByText("Budget remaining")).toBeTruthy();
  });
  it("renders two svg elements", () => {
    const { container } = render(<BurndownCharts series={series} lang="en" />);
    expect(container.querySelectorAll("svg").length).toBe(2);
  });
  it("shows the no-data hint when total budget is zero", () => {
    const empty: BurndownSeries = {
      ...series, totalBudgetHours: 0, totalBudgetValue: 0,
      plannedRemainingHours: [0, 0, 0], plannedRemainingValue: [0, 0, 0],
      actualRemainingHours: [0, 0, null], actualRemainingValue: [0, 0, null],
    };
    render(<BurndownCharts series={empty} lang="en" />);
    expect(screen.getByText("No budget set")).toBeTruthy();
  });
});
```

> The "No budget set" text is the existing `dashboardNoBudget` EN string. If its value differs, assert with that exact value.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- burndown-chart`
Expected: FAIL — cannot find module `./burndown-chart`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/app/burndown-chart.tsx
import { type Lang, t } from "./i18n";
import { formatCurrency } from "./resource-cost";
import type { BurndownSeries } from "./budget-burndown";

const W = 320, H = 160, PAD_L = 36, PAD_R = 12, PAD_T = 12, PAD_B = 28;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

function xAt(i: number, n: number): number {
  if (n <= 1) return PAD_L;
  return PAD_L + (i * PLOT_W) / (n - 1);
}
function yAt(v: number, max: number): number {
  if (max <= 0) return PAD_T + PLOT_H;
  const clamped = Math.max(0, v);
  return PAD_T + (1 - clamped / max) * PLOT_H;
}

function points(vals: readonly (number | null)[], max: number, n: number): string {
  return vals
    .map((v, i) => (v === null ? null : `${xAt(i, n).toFixed(1)},${yAt(v, max).toFixed(1)}`))
    .filter((p): p is string => p !== null)
    .join(" ");
}

function Chart({
  caption, planned, actual, max, todayIndex, n, over,
}: {
  caption: string;
  planned: number[];
  actual: (number | null)[];
  max: number;
  todayIndex: number;
  n: number;
  over: boolean;
}) {
  const baseY = PAD_T + PLOT_H;
  const todayX = todayIndex >= 0 ? xAt(todayIndex, n) : null;
  return (
    <div className="flex-1 min-w-[220px]">
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{caption}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={caption}>
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={baseY} className="stroke-line" strokeWidth={1} />
        <line x1={PAD_L} y1={baseY} x2={W - PAD_R} y2={baseY} className="stroke-line" strokeWidth={1} />
        <polyline
          points={points(planned, max, n)}
          fill="none"
          className="stroke-muted-foreground"
          strokeWidth={2}
          strokeDasharray="5 4"
        />
        <polyline
          points={points(actual, max, n)}
          fill="none"
          className={over ? "stroke-AIPM-pink" : "stroke-AIPM-green"}
          strokeWidth={2.5}
        />
        {todayX !== null && (
          <line x1={todayX} y1={PAD_T} x2={todayX} y2={baseY} className="stroke-AIPM-dark-blue" strokeWidth={1} strokeDasharray="3 3" />
        )}
      </svg>
    </div>
  );
}

/** Twin burn-down (remaining) charts: hours + €. Dashed = planned glide-path,
 *  solid = actual remaining (pink when over budget). */
export function BurndownCharts({ series, lang }: { series: BurndownSeries; lang: Lang }) {
  if (series.totalBudgetHours <= 0 && series.totalBudgetValue <= 0) {
    return <p className="text-sm text-muted-foreground">{t(lang, "dashboardNoBudget")}</p>;
  }
  const n = series.periods.length;
  const lastActualH = [...series.actualRemainingHours].reverse().find((v) => v !== null) ?? null;
  const lastActualV = [...series.actualRemainingValue].reverse().find((v) => v !== null) ?? null;
  return (
    <div className="flex flex-wrap gap-4">
      <Chart
        caption={t(lang, "burndownHoursRemaining")}
        planned={series.plannedRemainingHours}
        actual={series.actualRemainingHours}
        max={series.totalBudgetHours}
        todayIndex={series.todayIndex}
        n={n}
        over={lastActualH !== null && lastActualH < 0}
      />
      <Chart
        caption={t(lang, "burndownBudgetRemaining")}
        planned={series.plannedRemainingValue}
        actual={series.actualRemainingValue}
        max={series.totalBudgetValue}
        todayIndex={series.todayIndex}
        n={n}
        over={lastActualV !== null && lastActualV < 0}
      />
    </div>
  );
}
```

> `formatCurrency` is imported for parity with the budget surfaces but the axis labels are intentionally minimal in v1; if lint flags it as unused, drop the import. Keep the component focused on the two polylines + today marker.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- burndown-chart`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/burndown-chart.tsx src/app/burndown-chart.test.tsx
git commit -F - <<'EOF'
feat: add BurndownCharts (dependency-free SVG)

Twin remaining-burn-down charts (hours + EUR): dashed planned glide-path,
solid actual line (pink when over budget), today marker. No chart library.
EOF
```

---

### Task 6: `report-table.tsx` — boxed Section + Tile RAG slot

**Files:**
- Modify: `src/app/report-table.tsx` (`Section` ~136, `Tile` ~127)
- Test: `src/app/report-table.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/report-table.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { Section, Tile } from "./report-table";

describe("Section boxed variant", () => {
  it("adds the outline box classes when boxed", () => {
    const { container } = render(<Section title="T" boxed>x</Section>);
    expect(container.firstChild).toBeTruthy();
    expect((container.firstChild as HTMLElement).className).toContain("border-line");
  });
  it("has no box by default", () => {
    const { container } = render(<Section title="T">x</Section>);
    expect((container.firstChild as HTMLElement).className).not.toContain("border-line");
  });
});

describe("Tile rag slot", () => {
  it("renders the rag node when provided", () => {
    render(<Tile label="L" value="V" rag={<span>RAGBADGE</span>} />);
    expect(screen.getByText("RAGBADGE")).toBeTruthy();
  });
});
```

> If `report-table.test.tsx` lacks `describe`/`it` imports from vitest, add them at the top.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- report-table`
Expected: FAIL — `Section` has no `boxed` prop / `Tile` has no `rag` prop (or assertion fails).

- [ ] **Step 3: Write the implementation**

Replace the `Tile` function (lines ~127-134) with:

```tsx
export function Tile({ label, value, rag }: { label: string; value: string; rag?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-center justify-between gap-1.5 text-xl font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey tabular-nums">
        <span>{value}</span>
        {rag}
      </p>
    </div>
  );
}
```

Replace the `Section` function (lines ~136-143) with:

```tsx
export function Section({
  title, children, boxed = false,
}: {
  title: string;
  children: React.ReactNode;
  boxed?: boolean;
}) {
  const body = (
    <>
      <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{title}</h3>
      {children}
    </>
  );
  return boxed ? (
    <div className="rounded-lg border border-line bg-surface p-4">{body}</div>
  ) : (
    <div>{body}</div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- report-table`
Expected: PASS. Then `npx tsc --noEmit` — Expected: PASS (existing `Tile` callers unaffected; `rag` is optional).

- [ ] **Step 5: Commit**

```bash
git add src/app/report-table.tsx src/app/report-table.test.tsx
git commit -F - <<'EOF'
feat: add boxed Section variant and Tile RAG slot

Section gains an optional boxed outline (matching the dashboard Overall
band); Tile gains an optional trailing rag node.
EOF
```

---

### Task 7: `dashboard.ts` — burndown in the model

**Files:**
- Modify: `src/app/dashboard.ts`
- Test: `src/app/dashboard.test.ts`

**Context:** `computeDashboard` already receives `budgets`, `plan`, `roles`, `today`. Add a `burndown` field computed via `computeBurndownSeries` when budgets exist, else `null`.

- [ ] **Step 1: Write the failing test**

Add to `src/app/dashboard.test.ts` (it already has `task`, `raid`, `today`, `holidays` helpers; build a minimal `DashboardInput`). Add near the other `computeDashboard` tests:

```ts
import { computeBurndownSeries } from "./budget-burndown"; // add to imports

function baseInput(over: Partial<DashboardInput> = {}): DashboardInput {
  return {
    tasks: [], raid: [], budgets: [],
    plan: { startDate: "2026-01-01", endDate: "2026-03-31", granularity: "month", currency: "EUR", rows: [] } as unknown as DashboardInput["plan"],
    roles: [], resources: [], absences: [],
    workdayHours: 8, holidaySet: holidays,
    status: {}, activity: [], today, milestones: [],
    ...over,
  };
}

describe("computeDashboard burndown", () => {
  it("is null when there are no budgets", () => {
    expect(computeDashboard(baseInput()).burndown).toBeNull();
  });
  it("is a series when budgets exist", () => {
    const budgets = [{
      id: 1, name: "B", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-03-31", status: "open",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: {} }],
    }] as unknown as DashboardInput["budgets"];
    const roles = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 }] as unknown as DashboardInput["roles"];
    const model = computeDashboard(baseInput({ budgets, roles }));
    expect(model.burndown).not.toBeNull();
    expect(model.burndown!.totalBudgetHours).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- dashboard`
Expected: FAIL — `burndown` is not on `DashboardModel`.

- [ ] **Step 3: Write the implementation**

In `src/app/dashboard.ts`:

Add the import near the other imports (top of file):

```ts
import { computeBurndownSeries, type BurndownSeries } from "./budget-burndown";
```

Add to the `DashboardModel` type (after `burn: DashboardBurn | null;`, ~line 188):

```ts
  burndown: BurndownSeries | null;
```

In `computeDashboard`, after the `burn` constant is built (~line 256), add:

```ts
  const burndown: BurndownSeries | null =
    input.budgets.length > 0
      ? computeBurndownSeries(input.budgets, input.plan, input.roles, today)
      : null;
```

Add `burndown,` to the returned object (next to `burn,`, ~line 266).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- dashboard`
Expected: PASS. Then `npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard.ts src/app/dashboard.test.ts
git commit -F - <<'EOF'
feat: add burndown series to the dashboard model

computeDashboard now derives a BurndownSeries when budgets exist (null
otherwise), so the chart data is covered by dashboard tests.
EOF
```

---

### Task 8: `registers-band.tsx` — directory hover + boxed sections

**Files:**
- Modify: `src/app/dashboard-sections/registers-band.tsx`
- Test: `src/app/dashboard-panel.test.tsx` (covers the band via the panel) — add a focused assertion

**Context:** Item 4 (hover) + item 9 (box Top RAID / Upcoming&Overdue / Milestones). The directory hover classes are `rounded-md border border-transparent px-2 py-0.5 hover:border-AIPM-dark-blue hover:bg-surface-muted` (with `font-medium text-foreground` on the directory; keep text style minimal here). Replace the three `className="text-left hover:underline"` buttons and box the three Sections.

- [ ] **Step 1: Write the implementation (UI-only; verify via existing + new render test)**

In `registers-band.tsx`:

1. Define a shared hover class constant at the top of the file (after imports):

```ts
const LINK_CLASS =
  "rounded-md border border-transparent px-2 py-0.5 text-left text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted";
```

2. Replace each of the three `className="text-left hover:underline"` occurrences (the RAID button, the overdue task button, the due-soon task button, and the milestone button) with `className={LINK_CLASS}`.

3. Add `boxed` to the three Sections: change `<Section title={t(lang, "dashboardTopRaid")}>` → `<Section title={t(lang, "dashboardTopRaid")} boxed>`, the same for `dashboardUpcoming`, and `dashboardMilestones`.

- [ ] **Step 2: Add a render assertion**

Append to `src/app/dashboard-panel.test.tsx` (it already renders the dashboard with a workspace provider; reuse its existing harness). Add an assertion that a clickable RAID link carries the hover class. If the existing test file renders `RegistersBand` indirectly, add a direct test instead:

```tsx
import { render, screen } from "@testing-library/react";
import { RegistersBand } from "./dashboard-sections/registers-band";

describe("RegistersBand link styling", () => {
  it("uses the directory hover affordance, not underline", () => {
    render(
      <RegistersBand
        lang="en"
        topRaid={[{ id: 1, category: "R", title: "risk", status: "Open", linkedTaskIds: [], raisedDate: "2026-01-01", causedByRaidIds: [] } as never]}
        overdue={[]} dueSoon={[]}
        overdueMilestones={[]} atRiskMilestones={[]} dueSoonMilestones={[]}
        onOpenRaid={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: /risk/ });
    expect(btn.className).toContain("hover:bg-surface-muted");
    expect(btn.className).not.toContain("hover:underline");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm run test:run -- dashboard-panel registers`
Expected: PASS. Then `npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard-sections/registers-band.tsx src/app/dashboard-panel.test.tsx
git commit -F - <<'EOF'
feat: box dashboard register sections and use directory hover

Top RAID / Upcoming & Overdue / Milestones get the Overall-style outline;
clickable links adopt the resources-directory hover affordance.
EOF
```

---

### Task 9: `dashboard-panel.tsx` — RAG icons, print overrides, currency, charts, boxed activity

**Files:**
- Modify: `src/app/dashboard-panel.tsx`
- Test: `src/app/dashboard-panel.test.tsx`

**Context:** Implements items 5 (RAG icons on pills), 6 (print shows value + icon, hides select), 7 (currency symbol on burn tiles), 8 (render `BurndownCharts`), 9 (box Recent activity). `props.plan` carries `currency`; reuse the `localeFor` pattern from `budget-panel.tsx`.

- [ ] **Step 1: Add imports**

At the top of `dashboard-panel.tsx`, add:

```ts
import { formatCurrency } from "./resource-cost";
import { RagBadge } from "./rag-badge";
import { BurndownCharts } from "./burndown-chart";
```

Add a locale helper near the top (mirror budget-panel):

```ts
function localeFor(lang: Lang): string {
  return lang === "de" ? "de-DE" : lang === "en-GB" ? "en-GB" : "en-US";
}
```

- [ ] **Step 2: RAG icons + print on the override controls**

Replace `OverrideSelect` (lines ~31-55) with a version that always shows a `RagBadge` for the effective value, hides the `<select>` in print, and shows a print-only value name:

```tsx
function OverrideSelect({
  lang, label, value, computed, effective, onChange,
}: {
  lang: Lang;
  label: string;
  value: "R" | "A" | "G" | undefined;
  computed: Health | null;
  effective: Health | null;
  onChange: (v: "R" | "A" | "G" | undefined) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm">
      <RagBadge value={effective} lang={lang} title={`${label}: ${effective ? healthColorName(effective, lang) : "—"}`} />
      <span className="font-medium">{label}</span>
      <select
        className="rounded border border-line bg-surface px-1.5 py-0.5 text-sm print:hidden"
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || undefined) as "R" | "A" | "G" | undefined)}
      >
        <option value="">{computed ? t(lang, "dashboardComputedHint", healthColorName(computed, lang)) : t(lang, "dashboardScopeUnset")}</option>
        <option value="R">{healthColorName("R", lang)}</option>
        <option value="A">{healthColorName("A", lang)}</option>
        <option value="G">{healthColorName("G", lang)}</option>
      </select>
      <span className="hidden text-muted-foreground print:inline">
        {effective ? healthColorName(effective, lang) : "—"}
      </span>
    </label>
  );
}
```

Then pass `effective` at each call site (lines ~115-142):

```tsx
          <OverrideSelect lang={lang} label={t(lang, "dashboardOverall")} value={status.ragOverride} computed={model.overall.computed} effective={model.overall.effective} onChange={(v) => setStatus((s) => ({ ...s, ragOverride: v }))} />
          <OverrideSelect lang={lang} label={t(lang, "dashboardSubSchedule")} value={status.scheduleOverride} computed={model.schedule.computed} effective={model.schedule.effective} onChange={(v) => setStatus((s) => ({ ...s, scheduleOverride: v }))} />
          <OverrideSelect lang={lang} label={t(lang, "dashboardSubBudget")} value={status.budgetOverride} computed={model.budget.computed} effective={model.budget.effective} onChange={(v) => setStatus((s) => ({ ...s, budgetOverride: v }))} />
          <OverrideSelect lang={lang} label={t(lang, "dashboardSubScope")} value={status.scopeOverride} computed={null} effective={model.scope.effective} onChange={(v) => setStatus((s) => ({ ...s, scopeOverride: v }))} />
```

Add a badge to the big Overall heading (line ~112-114):

```tsx
          <div className="flex items-center gap-2 text-2xl font-bold">
            <RagBadge value={model.overall.effective} lang={lang} />
            {t(lang, "dashboardOverall")}: {healthColorName(model.overall.effective, lang)}
          </div>
```

- [ ] **Step 3: Currency on the burn tiles + the charts**

Add a `money` helper inside `DashboardPanel` (after `const { lang, today, ... } = props;`):

```tsx
  const locale = localeFor(lang);
  const money = (n: number) => formatCurrency(n, props.plan.currency || "EUR", locale);
```

Replace the budget-burn `Section` body (lines ~175-198). Keep the SPI/CPI tiles; change the burn tiles to use `money`, and append the charts:

```tsx
          <Section title={t(lang, "dashboardBudgetBurn")}>
            {model.burn ? (
              <div className="flex flex-wrap gap-2">
                <Tile label={t(lang, "dashboardSubBudget")} value={`${money(model.burn.consumedValue)} / ${money(model.burn.budgetValue)}`} />
                <Tile label="h" value={`${Math.round(model.burn.actualHours)} / ${Math.round(model.burn.budgetHours)}`} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t(lang, "dashboardNoBudget")}</p>
            )}
            {model.evm.coverage.withEstimate > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Tile label={t(lang, "evmSpi")} value={model.evm.spi != null ? model.evm.spi.toFixed(2) : "—"} />
                <Tile label={t(lang, "evmCpi")} value={model.evm.cpi != null ? model.evm.cpi.toFixed(2) : "—"} />
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{t(lang, "evmNoEstimates")}</p>
            )}
            {model.burndown ? (
              <div className="mt-3">
                <BurndownCharts series={model.burndown} lang={lang} />
              </div>
            ) : null}
          </Section>
```

- [ ] **Step 4: Box the Recent activity section**

Change `<Section title={t(lang, "dashboardRecentActivity")}>` (line ~216) to `<Section title={t(lang, "dashboardRecentActivity")} boxed>`.

- [ ] **Step 5: Add a panel test**

Append to `src/app/dashboard-panel.test.tsx` an assertion that the budget pill shows a RAG badge and that the burn tile shows a currency symbol. Reuse the file's existing render harness (workspace provider). Minimal addition:

```tsx
// inside the existing describe with the dashboard render harness:
it("shows a lettered RAG badge on the Overall pill", () => {
  // render via the existing helper that mounts <DashboardPanel .../>
  // then:
  // expect(screen.getAllByText(/^[RAG]$/).length).toBeGreaterThan(0);
});
```

> Use the file's existing mount helper. If none exists, render `<DashboardPanel>` wrapped in the `WorkspaceProvider` used elsewhere in the test file, pass `plan={{ currency: "EUR", ... }}`, and assert `screen.getAllByText(/^[RAG]$/).length > 0`.

- [ ] **Step 6: Run tests**

Run: `npm run test:run -- dashboard-panel`
Expected: PASS. Then `npx tsc --noEmit` and `npm run lint` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard-panel.tsx src/app/dashboard-panel.test.tsx
git commit -F - <<'EOF'
feat: dashboard RAG icons, print-static overrides, currency, burn-down

Override pills show a lettered RAG badge (and a static value in print, with
the select hidden); budget-burn tiles show the currency symbol; the twin
burn-down charts render below the burn band; Recent activity is boxed.
EOF
```

---

### Task 10: `budget-panel.tsx` — bucket metric RAGs + cell labels + per-cell/row RAG

**Files:**
- Modify: `src/app/budget-panel.tsx`
- Test: `src/app/budget-panel.test.tsx`

**Context:** Implements items 1 + 2. The bucket card breakdown grid (lines ~316-321) shows Budget/Plan/Actual hours + Win/Loss; the three `Cci` cards (lines ~327-331) show margin/cost-perf/consumption. `BucketReport` (`br`) carries `budgetHours`, `plannedHours`, `actualHours`, `winLossValue`, `consumedValue`, `budgetValue`, `contributionMargin`, `costPerformance`, `consumption` (each CCI = `{ amount, percent }`).

- [ ] **Step 1: Add imports**

```ts
import { RagBadge } from "./rag-badge";
import { ratioHealth, marginHealth, costPerformanceHealth, winLossHealth } from "./budget-health";
```

- [ ] **Step 2: RAG on the breakdown grid + CCI cards**

Add a `rag` slot to the breakdown grid cells (plan-h vs budget, actual-h vs budget, win/loss). Replace the grid (lines ~316-321) with:

```tsx
              <div className="grid grid-cols-4 gap-2 text-sm">
                <div><div className="text-xs text-muted-foreground">{t(lang, "budgetBudgetHours")}</div>{br.budgetHours.toFixed(0)}</div>
                <div>
                  <div className="text-xs text-muted-foreground">{t(lang, "budgetPlanHours")}</div>
                  <span className="inline-flex items-center gap-1.5">{br.plannedHours.toFixed(0)}<RagBadge value={ratioHealth(br.plannedHours, br.budgetHours)} lang={lang} title={t(lang, "budgetPlanHours")} /></span>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t(lang, "budgetActualHours")}</div>
                  <span className="inline-flex items-center gap-1.5">{br.actualHours.toFixed(0)}<RagBadge value={ratioHealth(br.actualHours, br.budgetHours)} lang={lang} title={t(lang, "budgetActualHours")} /></span>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t(lang, "budgetWinLoss")}</div>
                  <span className="inline-flex items-center gap-1.5">{inCur(br.winLossValue)}<RagBadge value={winLossHealth(br.consumedValue, br.budgetValue)} lang={lang} title={t(lang, "budgetWinLoss")} /></span>
                </div>
              </div>
```

Extend the `Cci` component (lines ~84-94) to accept and render an optional `rag`:

```tsx
function Cci({ label, value, currency, locale, rag }: { label: string; value: CciValue; currency: string; locale: string; rag?: Health | null }) {
  const pct = value.percent == null ? "—" : `${value.percent.toFixed(1)}%`;
  const tone = value.amount >= 0 ? "text-AIPM-green" : "text-AIPM-pink";
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {rag !== undefined ? <RagBadge value={rag} lang={ragLang} title={label} /> : null}
      </div>
      <div className={`text-lg font-semibold ${tone}`}>{formatCurrency(value.amount, currency, locale)}</div>
      <div className="text-xs text-muted-foreground">{pct}</div>
    </div>
  );
}
```

> `Cci` has no `lang` in scope. Add `lang: Lang` to its props and thread it (the component is defined at module scope). Update both `Cci` call sites (project total ~258-260 and per-bucket ~328-330) to pass `lang={lang}` and the `rag`:
> - Project: margin `rag={marginHealth(report.project.contributionMargin.percent)}`, cpi `rag={costPerformanceHealth(report.project.costPerformance.percent)}`, consumption `rag={ratioHealth(report.project.consumedValue, report.project.budgetValue)}`.
> - Per bucket (use the EUR-converted `cci(...)` only for amounts; RAG uses the percent/raw EUR which are FX-independent ratios): margin `rag={marginHealth(br.contributionMargin.percent)}`, cpi `rag={costPerformanceHealth(br.costPerformance.percent)}`, consumption `rag={ratioHealth(br.consumedValue, br.budgetValue)}`.

Add `import type { Health } from "./health";` and ensure `Lang` is imported (it is, via i18n).

- [ ] **Step 3: Cell labels + per-cell RAG + row-total RAG**

Rework `HoursCell` (lines ~22-60) to label the two fields and show a per-cell RAG behind the Actual field:

```tsx
function HoursCell({
  ariaPrefix, budget, actual, onBudget, onActual, budgetHint, actualHint, lang,
}: {
  ariaPrefix: string;
  budget: number | undefined;
  actual: number | undefined;
  onBudget: (v: number) => void;
  onActual: (v: number) => void;
  budgetHint: string;
  actualHint: string;
  lang: Lang;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <span className="w-10 text-[10px] text-muted-foreground">{t(lang, "budgetCellPlan")}</span>
        <input aria-label={`budget-${ariaPrefix}`} title={budgetHint} type="number" value={budget ?? ""} onChange={(e) => onBudget(Number(e.target.value) || 0)} className="w-16 rounded border border-line bg-surface px-1 text-right" />
      </div>
      <div className="flex items-center gap-1">
        <span className="w-10 text-[10px] text-muted-foreground">{t(lang, "budgetCellActual")}</span>
        <input aria-label={`actual-${ariaPrefix}`} title={actualHint} type="number" value={actual ?? ""} onChange={(e) => onActual(Number(e.target.value) || 0)} className="w-16 rounded border border-line bg-surface-muted px-1 text-right" />
        <RagBadge value={ratioHealth(actual ?? 0, budget ?? 0)} lang={lang} />
      </div>
    </div>
  );
}
```

Pass `lang={lang}` at both `HoursCell` call sites (detailed ~361 and blended ~381) and drop the now-unused `hLabel` prop.

Add a leading row-total RAG cell before the role/discipline name. For the detailed rows (lines ~356-358), change the row to add a leading `<td>`:

```tsx
                    {!isBlended && bucket.allocations.map((a) => {
                      const totBudget = periods.reduce((s, p) => s + (a.budgetHours[p.key] ?? 0), 0);
                      const totActual = periods.reduce((s, p) => s + (a.actualHours[p.key] ?? 0), 0);
                      return (
                      <tr key={a.roleId} className="border-t border-line">
                        <td className="px-1 py-1"><RagBadge value={ratioHealth(totActual, totBudget)} lang={lang} title={t(lang, "budgetRoleStatus")} /></td>
                        <td className="px-2 py-1">{roleLabel(roles.find((r) => r.id === a.roleId), props.disciplines, props.grades) || `#${a.roleId}`}</td>
                        {periods.map((p) => (
                          <td key={p.key} className="px-1 py-1">
                            <HoursCell ariaPrefix={`${bucket.id}-${a.roleId}-${p.key}`} budget={a.budgetHours[p.key]} actual={a.actualHours[p.key]} onBudget={(v) => setCell(bucket.id, a.roleId, p.key, "budgetHours", v)} onActual={(v) => setCell(bucket.id, a.roleId, p.key, "actualHours", v)} budgetHint={t(lang, "budgetBudgetHoursHint")} actualHint={t(lang, "budgetActualHoursHint")} lang={lang} />
                          </td>
                        ))}
                      </tr>
                      );
                    })}
```

Apply the same pattern to the blended rows (lines ~375-393), using `a.disciplineId` and `disciplineAllocations`.

Add a leading header cell to the table head (after `<tr>` at line ~335), before the role/discipline `<th>`:

```tsx
                      <th className="px-1 py-1 text-left font-medium" style={{ width: 28, minWidth: 28 }}>{t(lang, "budgetRoleStatus")}</th>
```

- [ ] **Step 4: Add/extend tests**

Append to `src/app/budget-panel.test.tsx` assertions: the per-bucket grid shows a RAG badge for plan/actual/win-loss, and a role row shows the leading status badge. Use the file's existing render harness; if it renders a bucket with allocations, assert:

```tsx
// after rendering a bucket with budget 100 / actual 120 in a period:
expect(screen.getAllByText("R").length).toBeGreaterThan(0); // over-budget cell + row badge
```

> Match the harness already in `budget-panel.test.tsx`. If it lacks a bucket-with-allocations fixture, add one with `budgetHours: { "<periodKey>": 100 }`, `actualHours: { "<periodKey>": 120 }` so the cell RAG is Red.

- [ ] **Step 5: Run tests**

Run: `npm run test:run -- budget-panel`
Expected: PASS. Then `npx tsc --noEmit` and `npm run lint` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/budget-panel.tsx src/app/budget-panel.test.tsx
git commit -F - <<'EOF'
feat: budget panel RAG status on bucket metrics and role grid

RAG badges on plan-h, actual-h, win/loss, and the three CCI cards; the
allocation grid labels Plan/Actual, shows a per-cell RAG behind Actual,
and a row-total RAG before each role/discipline.
EOF
```

---

### Task 11: `budget-report-panel.tsx` — project-tile RAGs, detail RAG column, charts

**Files:**
- Modify: `src/app/budget-report-panel.tsx`
- Test: `src/app/budget-report-panel.test.tsx`

**Context:** Implements item 3 + the Budget-Report half of item 8. The project-total tiles are at lines ~84-95; the bucket detail table at `BucketDetailTable` (lines ~144-269). Uses `Tile`'s new `rag` slot and the same burndown component.

- [ ] **Step 1: Add imports**

```ts
import { RagBadge } from "./rag-badge";
import { ratioHealth, marginHealth, costPerformanceHealth, winLossHealth } from "./budget-health";
import { computeBurndownSeries } from "./budget-burndown";
import { BurndownCharts } from "./burndown-chart";
```

- [ ] **Step 2: RAG on the project-total tiles**

Replace the margin/cpi/consumption tiles (lines ~91-93) so each passes a `rag`:

```tsx
          <Tile label={t(lang, "budgetCciMargin")} value={`${money(proj.contributionMargin.amount)} (${pct(proj.contributionMargin)})`} rag={<RagBadge value={marginHealth(proj.contributionMargin.percent)} lang={lang} title={t(lang, "budgetCciMargin")} />} />
          <Tile label={t(lang, "budgetCciCpi")} value={`${money(proj.costPerformance.amount)} (${pct(proj.costPerformance)})`} rag={<RagBadge value={costPerformanceHealth(proj.costPerformance.percent)} lang={lang} title={t(lang, "budgetCciCpi")} />} />
          <Tile label={t(lang, "budgetCciConsumption")} value={`${money(proj.consumption.amount)} (${pct(proj.consumption)})`} rag={<RagBadge value={ratioHealth(proj.consumedValue, proj.budgetValue)} lang={lang} title={t(lang, "budgetCciConsumption")} />} />
```

- [ ] **Step 3: Burn-down section**

Compute the series (after the existing `evm` useMemo, ~line 64):

```tsx
  const burndown = useMemo(
    () => computeBurndownSeries(buckets, plan, roles, today),
    [buckets, plan, roles, today],
  );
```

Add a section to `content` (after the EVM `Section`, before `<BucketDetailTable …>`):

```tsx
      <Section title={t(lang, "budgetBurndownTitle")}>
        <BurndownCharts series={burndown} lang={lang} />
      </Section>
```

> `buckets.length === 0` returns the empty state before `content`, so the chart only renders when buckets exist (and `BurndownCharts` self-guards on zero budget).

- [ ] **Step 4: RAG column in the detail table**

In `BucketDetailTable`, add a leading status column. Add a header cell before the first `cols` header `<th>` (in the `<tr>` at line ~221):

```tsx
              <th className="px-2 py-2 text-left font-medium" style={{ width: 32, minWidth: 32 }}>{t(lang, "budgetRoleStatus")}</th>
```

Add a leading cell in the body row (line ~248, the `<tr key={r.bucketId}>`), as the first `<td>`:

```tsx
                  <td className="px-2 py-2"><RagBadge value={ratioHealth(r.consumedValue, r.budgetValue)} lang={lang} title={t(lang, "budgetRoleStatus")} /></td>
```

Update the empty-row `colSpan` (line ~242) from `cols.length` to `cols.length + 1`.

`BucketDetailTable` needs `lang` — it already receives `lang`. Import `RagBadge` and `ratioHealth` are added at file top (Step 1).

- [ ] **Step 5: Add tests**

Append to `src/app/budget-report-panel.test.tsx`: render with a bucket and assert the burn-down captions appear and the detail table has a status cell. Reuse the file's harness:

```tsx
expect(screen.getByText("Burn-down")).toBeTruthy();
expect(screen.getByText("Hours remaining")).toBeTruthy();
```

- [ ] **Step 6: Run tests**

Run: `npm run test:run -- budget-report-panel`
Expected: PASS. Then `npx tsc --noEmit` and `npm run lint` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/budget-report-panel.tsx src/app/budget-report-panel.test.tsx
git commit -F - <<'EOF'
feat: budget report RAG status and burn-down section

RAG badges on the project CCI tiles, a leading status column on the
bucket detail table, and the twin burn-down charts.
EOF
```

---

### Task 12: Version bump + docs

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `src/app/help-menu.tsx` (one highlight line, optional)
- Modify: `docs/CODEMAPS/data.md`, `docs/CODEMAPS/frontend.md`

**Context:** Version 0.46.0 → **0.47.0**, codename **"Reynolds"** (Alastair Reynolds; new SF-author name, not previously used). Follow the existing `version.ts` comment-block + `APP_HIGHLIGHT_KEYS` convention; `versionHighlightBudgetRag` was added in Task 3.

- [ ] **Step 1: `version.ts`**

- Add a new top comment block above the `0.46.0` block:

```ts
// 0.47.0 "Reynolds" adds RAG status across the budget surfaces and dashboard,
// plus a burn-down chart. A new pure budget-health.ts maps consumption / plan-
// and actual-hours (Amber >=90%, Red >100% of budget), cost performance (the
// EVM 0.8/0.9 index bands), and contribution margin (Green >=15%, Red <0) to
// Red/Amber/Green. budget-burndown.ts derives per-period remaining hours and
// EUR; a dependency-free SVG BurndownCharts renders twin remaining charts on
// the dashboard and in the Budget Report. The dashboard pills gain lettered
// RAG badges (and print as a static value + badge instead of dropdowns), the
// budget-burn tiles show the currency symbol, the register/activity sections
// are boxed, and clickable links use the directory hover. The budget panel
// shows RAG on every bucket metric, labels the Plan/Actual grid cells, and
// adds a per-cell and per-role RAG; the Budget Report gains RAG tiles and a
// status column.
```

- Change `APP_VERSION` to `"0.47.0"`, update `APP_BUILD_DATE` comment to `// 0.47.0 budget+dashboard RAG + burn-down`, and `APP_MILESTONE` to `"Reynolds"`.

- [ ] **Step 2: `package.json`** — change `"version": "0.46.0"` to `"0.47.0"`.

- [ ] **Step 3: `CHANGELOG.md`** — add at the top:

```markdown
## [0.47.0] — 2026-06-02 "Reynolds"

### Added
- RAG status across the budget panel (bucket metrics + per-cell and per-role
  status in the allocation grid), the Budget Report (CCI tiles + status column),
  and the dashboard pills — a shared lettered RAG badge.
- Twin burn-down charts (hours + €) on the dashboard and in the Budget Report,
  rendered as dependency-free SVG.

### Changed
- Dashboard prints the status overrides as a static value + RAG badge instead of
  dropdowns; budget-burn tiles show the currency symbol; the Top RAID / Upcoming
  & Overdue / Milestones / Recent activity sections are boxed; clickable links
  use the resources-directory hover affordance.
```

- [ ] **Step 4: `README.md`** — update the version line to `v0.47.0 "Reynolds"` and add a phrase mentioning budget/dashboard RAG + burn-down to the relevant feature bullet.

- [ ] **Step 5: `help-menu.tsx`** (optional) — if there is a highlights list, add one line referencing the RAG/burn-down feature using `versionHighlightBudgetRag`. Skip if no natural slot.

- [ ] **Step 6: Codemaps** — in `docs/CODEMAPS/data.md` and `docs/CODEMAPS/frontend.md`, bump the version stamp to include `0.47.0` and add one-line entries for `budget-health.ts`, `budget-burndown.ts`, `rag-badge.tsx`, and `burndown-chart.tsx`.

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run test:run`
Expected: PASS (full suite green).

- [ ] **Step 8: Commit**

```bash
git add src/app/version.ts package.json CHANGELOG.md README.md src/app/help-menu.tsx docs/CODEMAPS/data.md docs/CODEMAPS/frontend.md
git commit -F - <<'EOF'
chore: release v0.47.0 "Reynolds" — budget/dashboard RAG + burn-down

Version bump, changelog, README, codemaps, and version.ts highlight for the
RAG-status + burn-down feature.
EOF
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run lint` — clean
- [ ] `npm run test:run` — all green, coverage gate (70%) holds
- [ ] Confirm `i18n.de.ts` has no curly-quote corruption (grep for `"` / `"`)
- [ ] Use `superpowers:finishing-a-development-branch` to merge `feat-budget-rag-burndown` and push.

## Self-review notes (plan vs spec)

- Spec items 1–9 each map to a task: 1→T10, 2→T10, 3→T11, 4→T8, 5→T9, 6→T9, 7→T9, 8→T9+T11 (shared T5 component), 9→T8+T9.
- Pure logic (budget-health T1, budget-burndown T2) precedes the components (T4, T5) and wiring (T7–T11) that depend on them.
- `RagBadge` lives in `rag-badge.tsx` (not `health.tsx`) to avoid a `.ts`/`.tsx` module-resolution clash — a deliberate deviation from the spec's wording, same behaviour.
- The € burn-down basis is external-rate × hours (spec "Decisions captured").
- Type names are consistent across tasks: `BurndownSeries`, `RagBadge`, `ratioHealth`/`marginHealth`/`costPerformanceHealth`/`winLossHealth`, `Section boxed`, `Tile rag`.
