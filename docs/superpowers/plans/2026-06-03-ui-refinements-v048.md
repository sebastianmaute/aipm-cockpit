# UI Refinements v0.48.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a batch of additive UI refinements (burn-down axes, dashboard RAG polish, margin/actual-hours RAG, planning/budget filter+sort, calendar Today, default reports, task-editor buttons, gantt milestone create) on top of v0.47.0.

**Architecture:** Every change reuses existing shared primitives — `RagBadge`, `healthDot`/`healthText`, `budget-health.ts`, `useSortableFilter`/`TableFilter`/`SortHeaderButton`, `formatCurrency`, `useColumnResize`. Two tiny pure helpers are added (`marginAmountHealth`, `healthText`). No new persisted entity or storage migration.

**Tech Stack:** Next.js 16 / React / TypeScript, Tailwind v4, Vitest 4. Tests: `npm run test:run`. Types: `npx tsc --noEmit`. Lint: `npm run lint`.

**Branch:** `feat-ui-refinements-v048` (already created off `main`).

**Conventions for every task:**
- Run a single test file with: `npx vitest run src/app/<file>.test.tsx`
- After each task: `npx tsc --noEmit` must be clean before commit.
- i18n: add every new key to BOTH `src/app/i18n.ts` and `src/app/i18n.de.ts` (tsc enforces parity). Use straight ASCII quotes only; after editing `i18n.de.ts`, grep for curly quotes (`rg '[“”]' src/app/i18n.de.ts` must return nothing).
- Commit with the Bash tool using `git commit -F - <<'EOF' … EOF`.
- `Lang` is `"en-US" | "en-GB" | "de"` — never `"en"`.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/app/budget-health.ts` | + `marginAmountHealth(margin, external)` | 1 |
| `src/app/health.ts` | + `healthText` map | 1 |
| `src/app/rag-badge.tsx` | print-color-adjust on badge | 2 |
| `src/app/burndown-chart.tsx` | axis tick labels + `currency` prop | 3 |
| `src/app/dashboard-panel.tsx` | currency to chart; Overall text color; captions; thresholds legend | 3,4 |
| `src/app/budget-report-panel.tsx` | currency to chart; Actual-(h) RAG | 3,10 |
| `src/app/i18n.ts` / `i18n.de.ts` | new keys | 4,8,9,14 |
| `src/app/resources-panel.tsx` | margin RAG; custom Today; planning filter+sort | 5,7,8 |
| `src/app/resources-report.tsx` | margin RAG (ByPeriod) | 6 |
| `src/app/budget-panel.tsx` | role/discipline filter+sort | 9 |
| `src/app/workspace-section.tsx` | default reports; milestone create nonce | 11,13 |
| `src/app/task-form-modal.tsx` | Cancel in create mode | 12 |
| `src/app/task-edit-view.tsx` + `task-manager.tsx` | footer slot | 12 |
| `src/app/milestones-panel.tsx` | `openCreateNonce` | 13 |
| `version.ts`, `package.json`, `CHANGELOG.md`, `README.md`, `docs/CODEMAPS/*` | 0.48.0 bump | 14 |

---

## Task 1: Pure helpers — `marginAmountHealth` + `healthText`

**Files:**
- Modify: `src/app/budget-health.ts`
- Modify: `src/app/health.ts`
- Test: `src/app/budget-health.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/budget-health.test.ts`:

```ts
import { marginAmountHealth } from "./budget-health";

describe("marginAmountHealth", () => {
  it("returns null when external revenue is zero or negative", () => {
    expect(marginAmountHealth(50, 0)).toBeNull();
    expect(marginAmountHealth(50, -10)).toBeNull();
  });
  it("is Green at >=15% margin", () => {
    expect(marginAmountHealth(15, 100)).toBe("G"); // 15%
    expect(marginAmountHealth(30, 100)).toBe("G");
  });
  it("is Amber between 0 and 15%", () => {
    expect(marginAmountHealth(14.9, 100)).toBe("A");
    expect(marginAmountHealth(0, 100)).toBe("A");
  });
  it("is Red below 0", () => {
    expect(marginAmountHealth(-0.1, 100)).toBe("R");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/budget-health.test.ts`
Expected: FAIL — `marginAmountHealth is not a function`.

- [ ] **Step 3: Implement**

Append to `src/app/budget-health.ts` (it already exports `marginHealth`):

```ts
/**
 * Margin RAG from an absolute margin amount + external (revenue) amount.
 * percent = margin / external * 100; null when external <= 0 (no revenue base).
 * Bands match marginHealth: G >= 15, A 0-15, R < 0.
 */
export function marginAmountHealth(margin: number, external: number): Health | null {
  if (!(external > 0)) return null;
  return marginHealth((margin / external) * 100);
}
```

(`Health` and `marginHealth` are already imported/defined in this file. If `Health` is not imported, it is already in scope as the module defines RAG functions — verify the existing import line at the top.)

- [ ] **Step 4: Add `healthText` to `src/app/health.ts`**

Immediately after the existing `healthDot` export (around line 190):

```ts
/**
 * Tailwind text-colour class for a RAG value, brand palette (matches the
 * Reports group dots). Used to tint inline status text, e.g. the dashboard
 * "Overall: Green" label.
 */
export const healthText: Record<Health, string> = {
  R: "text-AIPM-pink",
  A: "text-AIPM-purple",
  G: "text-AIPM-green",
};
```

- [ ] **Step 5: Run tests + types**

Run: `npx vitest run src/app/budget-health.test.ts` → PASS
Run: `npx tsc --noEmit` → clean

- [ ] **Step 6: Commit**

```bash
git add src/app/budget-health.ts src/app/budget-health.test.ts src/app/health.ts
git commit -F - <<'EOF'
feat: add marginAmountHealth helper and healthText map

Pure RAG foundations for v0.48.0 margin badges and colorized
dashboard status text.
EOF
```

---

## Task 2: Print-safe RAG badge (#15)

**Files:**
- Modify: `src/app/rag-badge.tsx`
- Test: `src/app/rag-badge.test.tsx`

Why: the dashboard prints with backgrounds stripped, so the `bg-*-500` dot
vanishes and only the white letter remains (invisible on white). Adding
`print-color-adjust: exact` to the badge forces the colour to print.

- [ ] **Step 1: Write the failing test**

Add to `src/app/rag-badge.test.tsx`:

```tsx
it("carries print-color-adjust so the dot colour survives printing", () => {
  const { getByText } = render(<RagBadge value="R" lang="en-US" />);
  const badge = getByText("R");
  expect(badge.className).toContain("[print-color-adjust:exact]");
  expect(badge.className).toContain("[-webkit-print-color-adjust:exact]");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/rag-badge.test.tsx`
Expected: FAIL — className does not contain the utility.

- [ ] **Step 3: Implement**

In `src/app/rag-badge.tsx`, change the `base` constant (line 16):

```tsx
  const base = "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white [-webkit-print-color-adjust:exact] [print-color-adjust:exact]";
```

- [ ] **Step 4: Run tests + types**

Run: `npx vitest run src/app/rag-badge.test.tsx` → PASS
Run: `npx tsc --noEmit` → clean

- [ ] **Step 5: Commit**

```bash
git add src/app/rag-badge.tsx src/app/rag-badge.test.tsx
git commit -F - <<'EOF'
fix: keep RAG badge colour when printing

Add print-color-adjust:exact to the badge so the R/A/G dot
background prints instead of dropping to white-on-white.
EOF
```

---

## Task 3: Burn-down chart axes — currency + dates (#1, #12)

**Files:**
- Modify: `src/app/burndown-chart.tsx`
- Modify: `src/app/dashboard-panel.tsx:216`
- Modify: `src/app/budget-report-panel.tsx` (the `<BurndownCharts ... />` call)
- Test: `src/app/burndown-chart.test.tsx`

Approach: `BurndownCharts` gains a `currency: string` prop. The internal
`Chart` gains `unit: "hours" | "currency"`, `currency`, `locale`, and renders
Y-axis tick labels (0, ½·max, max) and X-axis period labels (first / today /
last). Uses `formatCurrency` for the € chart, a compact number + "h" for hours.

- [ ] **Step 1: Write the failing test**

Add to `src/app/burndown-chart.test.tsx` (reuse the existing test's series builder; if none, inline one):

```tsx
import { render } from "@testing-library/react";
import { BurndownCharts } from "./burndown-chart";
import type { BurndownSeries } from "./budget-burndown";

const SERIES: BurndownSeries = {
  periods: ["2026-01", "2026-02", "2026-03"],
  plannedRemainingHours: [100, 50, 0],
  actualRemainingHours: [100, 60, null],
  plannedRemainingValue: [10000, 5000, 0],
  actualRemainingValue: [10000, 6000, null],
  todayIndex: 1,
  totalBudgetHours: 100,
  totalBudgetValue: 10000,
};

it("labels the hours axis with the max value and a period date", () => {
  const { getAllByText, getByText } = render(
    <BurndownCharts series={SERIES} lang="en-US" currency="EUR" />,
  );
  // Y max tick for the hours chart
  expect(getAllByText("100").length).toBeGreaterThan(0);
  // X period labels (first + last appear on both charts)
  expect(getAllByText("2026-01").length).toBeGreaterThan(0);
  expect(getAllByText("2026-03").length).toBeGreaterThan(0);
  // Currency chart shows a EUR-formatted max tick (contains a digit grouping)
  expect(getByText((s) => /10[.,  ]?000/.test(s) || s.includes("10,000") || s.includes("10.000"))).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/burndown-chart.test.tsx`
Expected: FAIL — tick labels not rendered and/or `currency` prop missing.

- [ ] **Step 3: Implement the chart changes**

Rewrite `src/app/burndown-chart.tsx` as follows (keeps the existing geometry +
legend, adds ticks + `currency`):

```tsx
import { type Lang, t, localeFor } from "./i18n";
import { formatCurrency } from "./resource-cost";
import type { BurndownSeries } from "./budget-burndown";

const W = 320, H = 160, PAD_L = 52, PAD_R = 12, PAD_T = 12, PAD_B = 28;
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

/** Distinct X-tick indices: first, today (if valid), last. */
function xTickIndices(n: number, todayIndex: number): number[] {
  if (n <= 0) return [];
  const set = new Set<number>([0, n - 1]);
  if (todayIndex >= 0 && todayIndex < n) set.add(todayIndex);
  return [...set].sort((a, b) => a - b);
}

function Chart({
  caption, planned, actual, max, todayIndex, n, over, periods, unit, currency, locale,
}: {
  caption: string;
  planned: readonly number[];
  actual: readonly (number | null)[];
  max: number;
  todayIndex: number;
  n: number;
  over: boolean;
  periods: readonly string[];
  unit: "hours" | "currency";
  currency: string;
  locale: string;
}) {
  const baseY = PAD_T + PLOT_H;
  const todayX = todayIndex >= 0 ? xAt(todayIndex, n) : null;
  const fmt = (v: number) =>
    unit === "currency"
      ? formatCurrency(v, currency, locale)
      : `${Math.round(v)}h`;
  const yTicks = [0, max / 2, max];
  const xTicks = xTickIndices(n, todayIndex);
  return (
    <div className="min-w-[240px] flex-1">
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{caption}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={caption}>
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={baseY} className="stroke-line" strokeWidth={1} />
        <line x1={PAD_L} y1={baseY} x2={W - PAD_R} y2={baseY} className="stroke-line" strokeWidth={1} />
        {yTicks.map((v, i) => (
          <text
            key={i}
            x={PAD_L - 4}
            y={yAt(v, max) + 3}
            textAnchor="end"
            className="fill-muted-foreground text-[8px] tabular-nums"
            aria-hidden="true"
          >
            {fmt(v)}
          </text>
        ))}
        {xTicks.map((idx) => (
          <text
            key={idx}
            x={xAt(idx, n)}
            y={baseY + 12}
            textAnchor={idx === 0 ? "start" : idx === n - 1 ? "end" : "middle"}
            className="fill-muted-foreground text-[8px] tabular-nums"
            aria-hidden="true"
          >
            {periods[idx]}
          </text>
        ))}
        <polyline points={points(planned, max, n)} fill="none" className="stroke-muted-foreground" strokeWidth={2} strokeDasharray="5 4" />
        <polyline points={points(actual, max, n)} fill="none" className={over ? "stroke-AIPM-pink" : "stroke-AIPM-green"} strokeWidth={2.5} />
        {todayX !== null && (
          <line x1={todayX} y1={PAD_T} x2={todayX} y2={baseY} className="stroke-AIPM-dark-blue" strokeWidth={1} strokeDasharray="3 3" />
        )}
      </svg>
    </div>
  );
}

/** Twin burn-down (remaining) charts: hours + currency. Dashed = planned
 *  glide-path, solid = actual remaining (pink when over budget). Axis ticks:
 *  hours/currency on Y, period dates on X. Dependency-free SVG. */
export function BurndownCharts({ series, lang, currency }: { series: BurndownSeries; lang: Lang; currency: string }) {
  if (series.totalBudgetHours <= 0 && series.totalBudgetValue <= 0) {
    return <p className="text-sm text-muted-foreground">{t(lang, "dashboardNoBudget")}</p>;
  }
  const n = series.periods.length;
  const locale = localeFor(lang);
  const lastActualH = [...series.actualRemainingHours].reverse().find((v) => v !== null) ?? null;
  const lastActualV = [...series.actualRemainingValue].reverse().find((v) => v !== null) ?? null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4">
        <Chart caption={t(lang, "burndownHoursRemaining")} planned={series.plannedRemainingHours} actual={series.actualRemainingHours} max={series.totalBudgetHours} todayIndex={series.todayIndex} n={n} over={lastActualH !== null && lastActualH < 0} periods={series.periods} unit="hours" currency={currency} locale={locale} />
        <Chart caption={t(lang, "burndownBudgetRemaining")} planned={series.plannedRemainingValue} actual={series.actualRemainingValue} max={series.totalBudgetValue} todayIndex={series.todayIndex} n={n} over={lastActualV !== null && lastActualV < 0} periods={series.periods} unit="currency" currency={currency} locale={locale} />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" className="stroke-muted-foreground" strokeWidth={2} strokeDasharray="5 4" /></svg>
          {t(lang, "burndownPlanned")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" className="stroke-AIPM-green" strokeWidth={2.5} /></svg>
          {t(lang, "burndownActual")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="6" height="14" aria-hidden="true"><line x1="3" y1="0" x2="3" y2="14" className="stroke-AIPM-dark-blue" strokeWidth={1} strokeDasharray="3 3" /></svg>
          {t(lang, "burndownToday")}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update both call sites**

`src/app/dashboard-panel.tsx` line ~216:

```tsx
                <BurndownCharts series={model.burndown} lang={lang} currency={props.plan.currency || "EUR"} />
```

`src/app/budget-report-panel.tsx` (the existing `<BurndownCharts series={burndown} lang={lang} />`):

```tsx
                <BurndownCharts series={burndown} lang={lang} currency={plan.currency} />
```

- [ ] **Step 5: Run tests + types**

Run: `npx vitest run src/app/burndown-chart.test.tsx` → PASS
Run: `npx tsc --noEmit` → clean (the `currency` prop is now required at both call sites)
Run: `npx vitest run src/app/dashboard-panel.test.tsx src/app/budget-report-panel.test.tsx` → PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/burndown-chart.tsx src/app/burndown-chart.test.tsx src/app/dashboard-panel.tsx src/app/budget-report-panel.tsx
git commit -F - <<'EOF'
feat: add currency + date axes to burn-down charts

Y-axis ticks (currency for the budget chart, hours for the hours
chart) and X-axis period-date ticks. Thread plan.currency from the
dashboard and budget report call sites.
EOF
```

---

## Task 4: Dashboard — Overall text colour, captions, thresholds legend (#16, #17, #18)

**Files:**
- Modify: `src/app/dashboard-panel.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/dashboard-panel.test.tsx`

- [ ] **Step 1: Add i18n keys (EN then DE)**

In `src/app/i18n.ts` add (place near the other `dashboard*` keys):

```ts
  dashboardRagThresholds: "Consumption / hours: Amber ≥ 90%, Red > 100% · Cost performance: Red < 0.80, Amber < 0.90 · Margin: Green ≥ 15%, Amber 0–15%, Red < 0",
  dashboardProgressCaption: "Tasks completed vs total, with the Red / Amber / Green health split of open work.",
  dashboardBurnCaption: "Budget and hours consumed vs available. The burn-down shows remaining budget against the planned glide-path — the actual line above the dashed line means you are behind plan.",
```

In `src/app/i18n.de.ts` add the matching keys (straight ASCII quotes only):

```ts
  dashboardRagThresholds: "Verbrauch / Stunden: Gelb ≥ 90%, Rot > 100% · Kostenleistung: Rot < 0,80, Gelb < 0,90 · Marge: Grün ≥ 15%, Gelb 0–15%, Rot < 0",
  dashboardProgressCaption: "Abgeschlossene vs. gesamte Aufgaben, mit der Rot/Gelb/Grün-Aufteilung der offenen Arbeit.",
  dashboardBurnCaption: "Verbrauchtes Budget und Stunden gegenüber dem Verfügbaren. Das Burn-down zeigt das verbleibende Budget gegen den geplanten Verlauf — die Ist-Linie über der gestrichelten Linie bedeutet Rückstand zum Plan.",
```

- [ ] **Step 2: Write the failing test**

Add to `src/app/dashboard-panel.test.tsx` (reuse the existing render helper / props in that file; the dashboard is rendered with budgets so burn shows):

```tsx
it("colourises the Overall status text and shows captions + thresholds", () => {
  renderDashboard(); // existing helper in this file
  // #18 thresholds legend
  expect(screen.getByText(/Amber ≥ 90%/)).toBeInTheDocument();
  // #17 captions
  expect(screen.getByText(/Tasks completed vs total/)).toBeInTheDocument();
  expect(screen.getByText(/burn-down shows remaining budget/)).toBeInTheDocument();
  // #16 Overall trailing text carries a brand colour class
  const overall = screen.getByText(/^(Green|Amber|Red)$/);
  expect(overall.className).toMatch(/text-AIPM-(green|purple|pink)/);
});
```

If the existing test file does not have a `renderDashboard` helper, copy the
render call used by the other tests in that file verbatim into this test.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/app/dashboard-panel.test.tsx`
Expected: FAIL — legend/captions absent; Overall text not wrapped in a colour span.

- [ ] **Step 4: Implement in `src/app/dashboard-panel.tsx`**

(a) Add `healthText` to the health import (line 10):

```tsx
import { healthColorName, healthText, type Health } from "./health";
```

(b) Overall band — replace the heading line (125) and add the legend after the
report-date span. Replace the block from line 123–161 so it reads:

```tsx
          <div className="flex items-center gap-2 text-2xl font-bold">
            <RagBadge value={model.overall.effective} lang={lang} />
            {t(lang, "dashboardOverall")}:{" "}
            <span className={model.overall.effective ? healthText[model.overall.effective] : ""}>
              {healthColorName(model.overall.effective, lang)}
            </span>
          </div>
```

(c) Add the thresholds legend as the last child inside the Overall band's
bordered `<div>` (i.e. immediately before its closing `</div>` that currently
ends after the report-date span):

```tsx
          <p className="basis-full text-xs text-muted-foreground">
            {t(lang, "dashboardRagThresholds")}
          </p>
```

(d) Progress caption — inside the Progress `<Section>`, after the tiles `<div>`:

```tsx
            <p className="mt-2 text-xs text-muted-foreground">{t(lang, "dashboardProgressCaption")}</p>
```

(e) Budget-burn caption — inside the Budget-burn `<Section>`, after the
`{model.burndown ? … : null}` block (last child of that Section):

```tsx
            <p className="mt-2 text-xs text-muted-foreground">{t(lang, "dashboardBurnCaption")}</p>
```

- [ ] **Step 5: Verify DE parity / no curly quotes**

Run: `npx tsc --noEmit` → clean (proves EN/DE key parity)
Run: `rg "[“”‘’]" src/app/i18n.de.ts` → no output

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/app/dashboard-panel.test.tsx` → PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard-panel.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/dashboard-panel.test.tsx
git commit -F - <<'EOF'
feat: dashboard RAG legend, captions, colorized Overall text

Colorize the Overall status word via healthText; add explanatory
captions under Progress and Budget burn; add a RAG thresholds
legend under the Overall band. EN + DE.
EOF
```

---

## Task 5: Margin RAG in the Planning grid (#4a)

**Files:**
- Modify: `src/app/resources-panel.tsx`
- Test: `src/app/resources-panel.test.tsx`

The Planning grid renders a per-row margin cell (`resources-panel.tsx:449`) and a
totals margin cell (`:463`). Add a `RagBadge` after each, using
`marginAmountHealth(margin, external)`.

- [ ] **Step 1: Write the failing test**

Add to `src/app/resources-panel.test.tsx` (reuse the existing planning-view render
helper/props; ensure at least one resource with a role that has external rate so
margin > 0):

```tsx
it("shows a margin RAG badge in the planning grid", () => {
  renderPlanning(); // existing helper rendering view="planning"
  // marginAmountHealth -> "G" badge letter present in the margin column
  expect(screen.getAllByText(/^[RAG]$/).length).toBeGreaterThan(0);
});
```

If no helper exists, render `<ResourcesPanel {...baseProps} view="planning" />`
copying `baseProps` from the existing test in the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/resources-panel.test.tsx`
Expected: FAIL — no RAG letter in planning grid.

- [ ] **Step 3: Implement**

(a) Add imports at the top of `src/app/resources-panel.tsx`:

```tsx
import { RagBadge } from "./rag-badge";
import { marginAmountHealth } from "./budget-health";
```

(b) Per-row margin cell — replace line 449:

```tsx
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          {formatCurrency(cost.margin, plan.currency, loc)}
                          <RagBadge value={marginAmountHealth(cost.margin, cost.external)} lang={lang} title={t(lang, "resourcesMargin")} />
                        </span>
                      </td>
```

(c) Totals margin cell — replace line 463:

```tsx
                        <td className="px-3 py-2 text-right tabular-nums">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            {formatCurrency(totals.margin, plan.currency, loc)}
                            <RagBadge value={marginAmountHealth(totals.margin, totals.external)} lang={lang} title={t(lang, "resourcesMargin")} />
                          </span>
                        </td>
```

(d) The totals accumulator (line ~392-393) tracks `internal/external/margin`
already — confirm `totals.external` exists; it does (`totals.external += cost.external`).

- [ ] **Step 4: Run tests + types**

Run: `npx vitest run src/app/resources-panel.test.tsx` → PASS
Run: `npx tsc --noEmit` → clean

- [ ] **Step 5: Commit**

```bash
git add src/app/resources-panel.tsx src/app/resources-panel.test.tsx
git commit -F - <<'EOF'
feat: margin RAG badge in the resources planning grid

Per-row and totals margin cells get a RagBadge via
marginAmountHealth (G >=15%, A 0-15%, R <0).
EOF
```

---

## Task 6: Margin RAG in the Resource Report (#4b)

**Files:**
- Modify: `src/app/resources-report.tsx`
- Test: `src/app/resources-report.test.tsx`

Margin appears only in the `ByPeriodTable` (`resources-report.tsx:246`). Row `p`
has `.margin` and `.external`.

- [ ] **Step 1: Write the failing test**

Add to `src/app/resources-report.test.tsx` (reuse the existing render helper):

```tsx
it("shows a margin RAG badge in the by-period table", () => {
  renderResourceReport(); // existing helper
  expect(screen.getAllByText(/^[RAG]$/).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/resources-report.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

(a) Add imports at the top of `src/app/resources-report.tsx`:

```tsx
import { RagBadge } from "./rag-badge";
import { marginAmountHealth } from "./budget-health";
```

(b) Replace the margin cell at line 246:

```tsx
                <td className="px-3 py-2 text-right tabular-nums">
                  <span className="inline-flex items-center justify-end gap-1.5">
                    {money(p.margin)}
                    <RagBadge value={marginAmountHealth(p.margin, p.external)} lang={lang} title={t(lang, "resourcesMargin")} />
                  </span>
                </td>
```

- [ ] **Step 4: Run tests + types**

Run: `npx vitest run src/app/resources-report.test.tsx` → PASS
Run: `npx tsc --noEmit` → clean

- [ ] **Step 5: Commit**

```bash
git add src/app/resources-report.tsx src/app/resources-report.test.tsx
git commit -F - <<'EOF'
feat: margin RAG badge in the resource report by-period table
EOF
```

---

## Task 7: Calendar Custom-view "Today" button (#7)

**Files:**
- Modify: `src/app/resources-panel.tsx` (custom-mode branch, ~594-617)
- Test: `src/app/resources-panel.test.tsx`

The custom branch renders From/To inputs only. Add a Today button that resets
the window to `monthWindow(today)`. `monthWindow` is already imported.

- [ ] **Step 1: Write the failing test**

Add to `src/app/resources-panel.test.tsx`:

```tsx
it("custom calendar view has a Today button that resets to the current month", () => {
  // render calendar view, switch to custom mode
  render(<ResourcesPanel {...baseProps} view="calendar" today="2026-06-15" />);
  fireEvent.click(screen.getByRole("button", { name: /custom/i }));
  const todayBtn = screen.getByRole("button", { name: /today|heute/i });
  fireEvent.click(todayBtn);
  // From input is set to the first of June 2026
  const from = screen.getByLabelText(/from|von/i) as HTMLInputElement;
  expect(from.value).toBe("2026-06-01");
});
```

Adjust the segmented-control selector to match how the existing tests click the
"custom" option (it may be a button with the localized "Custom" label).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/resources-panel.test.tsx`
Expected: FAIL — no Today button in custom mode.

- [ ] **Step 3: Implement**

In the `{calendarMode === "custom" && (` block of `src/app/resources-panel.tsx`,
add a Today button after the From/To labels, inside the same flex `<div>`:

```tsx
                <button
                  type="button"
                  aria-label={t(lang, "calendarToday")}
                  title={t(lang, "calendarToday")}
                  onClick={() => {
                    const w = monthWindow(today);
                    setCalendarFrom(w.startDate);
                    setCalendarTo(w.endDate);
                  }}
                  className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
                >
                  {t(lang, "calendarToday")}
                </button>
```

- [ ] **Step 4: Run tests + types**

Run: `npx vitest run src/app/resources-panel.test.tsx` → PASS
Run: `npx tsc --noEmit` → clean

- [ ] **Step 5: Commit**

```bash
git add src/app/resources-panel.tsx src/app/resources-panel.test.tsx
git commit -F - <<'EOF'
feat: Today button in the calendar custom view

Resets the custom From/To window to the month containing today.
EOF
```

---

## Task 8: Planning filter + sort (#8)

**Files:**
- Modify: `src/app/resources-panel.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (filter placeholder)
- Test: `src/app/resources-panel.test.tsx`

Columns already resize. Add a name filter + sortable headers (assignee /
capacity-days / internal / external / margin) over the resource rows using
`useSortableFilter`. Period columns stay unsorted. The totals row recomputes
from the visible (filtered+sorted) rows.

- [ ] **Step 1: Add i18n placeholder key**

`src/app/i18n.ts`:

```ts
  planningFilterResource: "Filter resources…",
```

`src/app/i18n.de.ts`:

```ts
  planningFilterResource: "Ressourcen filtern…",
```

Then extend the `TableFilter` `placeholderKey` union in
`src/app/report-table.tsx:76` to include `"planningFilterResource"` and the new
`budgetRoleFilter` (used in Task 9) so the prop type accepts them:

```tsx
  placeholderKey: "reportsFilterAssignee" | "reportsFilterGroup" | "reportsFilterLabel" | "raidReportFilterOwner" | "raidReportFilterDetail" | "budgetReportFilterBucket" | "planningFilterResource" | "budgetRoleFilter";
```

- [ ] **Step 2: Write the failing test**

Add to `src/app/resources-panel.test.tsx`:

```tsx
it("planning grid filters resources by name", () => {
  render(<ResourcesPanel {...baseProps} view="planning" />); // baseProps has >=2 named resources
  const input = screen.getByPlaceholderText(/filter resources/i);
  fireEvent.change(input, { target: { value: baseProps.resources[0].firstName } });
  // only the matching resource row remains
  expect(screen.queryByText(new RegExp(baseProps.resources[1].lastName))).not.toBeInTheDocument();
});
```

Adapt the field names to the actual `Resource` shape (`resourceDisplayName(r)`).

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/app/resources-panel.test.tsx`
Expected: FAIL — no filter input in planning grid.

- [ ] **Step 4: Implement**

(a) Add imports:

```tsx
import { useSortableFilter, TableFilter, SortHeaderButton, type SortDir } from "./report-table";
import { useCallback } from "react";
```

(Merge `useCallback` into the existing `react` import; do not duplicate.)

(b) Inside `ResourcesPanelInner`, near the other planning state, add:

```tsx
  const [planFilter, setPlanFilter] = useState("");
  const [planSort, setPlanSort] = useState<{ key: PlanSortKey; dir: SortDir }>({ key: "assignee", dir: "asc" });
```

with this type near the top of the file (after `PlanningCol`):

```tsx
type PlanSortKey = "assignee" | "capacityDays" | "internalCost" | "externalCost" | "margin";
```

(c) In the `view === "planning"` IIFE, the row data is currently mapped inline
from `resources`. Refactor: first build a typed row array carrying the computed
totals, then run it through `useSortableFilter`. Replace the inner
`resources.map((r) => { … })` totals loop with a precomputed array. Concretely,
above the `<table>` add:

```tsx
            const planRows = resources.map((r) => {
              const resAbs = absencesForResource(absences, r);
              const totalHours = periods.reduce((sum, p) =>
                sum + displayCapacityHours(p, canonicalPeriods, r, resAbs, workdayHours, holidaySet, plan.granularity, viewGranularity), 0);
              const role = roles.find((x) => x.id === r.roleId);
              const cost = periodCost(totalHours, role);
              return { resource: r, name: resourceDisplayName(r), totalHours, cost, capacityDays: totalHours / workdayHours, internalCost: cost.internal, externalCost: cost.external, margin: cost.margin };
            });
            const getPlanValue = (row: typeof planRows[number], k: PlanSortKey): string | number =>
              k === "assignee" ? row.name : k === "capacityDays" ? row.capacityDays : k === "internalCost" ? row.internalCost : k === "externalCost" ? row.externalCost : row.margin;
            const { sorted: planSorted, click: planClick } = useSortableFilter(planRows, planSort, setPlanSort, planFilter, getPlanValue);
            const totals = planSorted.reduce((acc, row) => ({
              days: acc.days + row.capacityDays,
              internal: acc.internal + row.internalCost,
              external: acc.external + row.externalCost,
              margin: acc.margin + row.margin,
            }), { days: 0, internal: 0, external: 0, margin: 0 });
```

NOTE: `useSortableFilter` is a hook — it must be called unconditionally at the
top of the component, not inside the `view === "planning"` IIFE. Move the
`planRows`/`getPlanValue`/`useSortableFilter` computation OUT of the IIFE to the
component body, guarded so it only does work when needed (it is cheap). The
cleanest approach: compute `planRows` with `useMemo` keyed on
`[resources, periods, …]` in the body and call `useSortableFilter` in the body;
then the IIFE just renders `planSorted`. Verify hook order stays stable across
renders (planning vs other views) — the hook must run on every render regardless
of `view`.

(d) Add a `TableFilter` above the `<table>` (inside the planning fragment, before
the controls row or just above the table wrapper):

```tsx
            <TableFilter lang={lang} value={planFilter} onChange={setPlanFilter} placeholderKey="planningFilterResource" />
```

(e) Wrap the assignee + capacity/internal/external/margin header labels in
`SortHeaderButton`, e.g. the assignee `<th>`:

```tsx
                    <SortHeaderButton label={t(lang, "assignee")} active={planSort.key === "assignee" && planSort.dir !== "off"} dir={planSort.dir} onClick={() => planClick("assignee")} />
                    <ColumnResizeHandle col="assignee" onMouseDown={planningStartResize} />
```

and likewise `capacityDays`→`planClick("capacityDays")`, `internalCost`,
`externalCost`, `margin`. Period `<th>`s stay as plain `{p.key}`.

(f) Replace `resources.map(...)` in the `<tbody>` with `planSorted.map((row) => { const r = row.resource; const cost = row.cost; … })`, reusing `row.totalHours`/`cost` instead of recomputing.

- [ ] **Step 5: Run tests + types**

Run: `npx vitest run src/app/resources-panel.test.tsx` → PASS
Run: `npx tsc --noEmit` → clean
Run: `rg "[“”‘’]" src/app/i18n.de.ts` → no output

- [ ] **Step 6: Commit**

```bash
git add src/app/resources-panel.tsx src/app/report-table.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/resources-panel.test.tsx
git commit -F - <<'EOF'
feat: filter + sort in the resources planning grid

Name filter and sortable cost/margin/capacity headers via the
shared useSortableFilter. Totals follow the visible rows.
EOF
```

---

## Task 9: Budget role/discipline filter + sort (#9)

**Files:**
- Modify: `src/app/budget-panel.tsx`
- Test: `src/app/budget-panel.test.tsx`

Columns already resize. Add a panel-level name filter + sort applied to each
bucket's allocation rows (detailed = roles, blended = disciplines). Filter
matches the role/discipline name only. Sort by name or row-total hours. Period
columns stay unsorted. Per-cell + row-total RAG (already present) are preserved.

- [ ] **Step 1: Write the failing test**

Add to `src/app/budget-panel.test.tsx` (reuse the existing render helper; ensure a
bucket with >=2 named role allocations):

```tsx
it("filters the bucket role table by role name", () => {
  renderBudget(); // existing helper
  const input = screen.getByPlaceholderText(/filter role|rolle.*filtern/i);
  fireEvent.change(input, { target: { value: "Developer" } });
  expect(screen.queryByText("Designer")).not.toBeInTheDocument();
});
```

Use role names that actually exist in the test fixtures.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/budget-panel.test.tsx`
Expected: FAIL — no filter input.

- [ ] **Step 3: Add i18n key**

`src/app/i18n.ts`:

```ts
  budgetRoleFilter: "Filter role / discipline…",
```

`src/app/i18n.de.ts`:

```ts
  budgetRoleFilter: "Rolle / Disziplin filtern…",
```

(The `TableFilter` union already includes `"budgetRoleFilter"` from Task 8.)

- [ ] **Step 4: Implement**

(a) Imports in `src/app/budget-panel.tsx`:

```tsx
import { TableFilter, SortHeaderButton, type SortDir } from "./report-table";
```

(b) Panel-level state (near the existing panel state):

```tsx
  const [roleFilter, setRoleFilter] = useState("");
  const [roleSort, setRoleSort] = useState<{ key: "name" | "total"; dir: SortDir }>({ key: "name", dir: "off" });
```

(c) A pure helper near the top of the file to order/filter allocations by their
resolved display name + total hours. Add:

```tsx
function filterSortAllocations<T extends { budgetHours: Record<string, number>; actualHours: Record<string, number> }>(
  allocs: readonly T[],
  nameOf: (a: T) => string,
  totalOf: (a: T) => number,
  filter: string,
  sort: { key: "name" | "total"; dir: SortDir },
): T[] {
  const q = filter.trim().toLowerCase();
  let rows = q ? allocs.filter((a) => nameOf(a).toLowerCase().includes(q)) : allocs.slice();
  if (sort.dir !== "off") {
    rows = rows.slice().sort((a, b) => {
      const c = sort.key === "name" ? nameOf(a).localeCompare(nameOf(b)) : totalOf(a) - totalOf(b);
      return sort.dir === "desc" ? -c : c;
    });
  }
  return rows;
}
```

(d) Render a `TableFilter` once, just above the per-bucket list (so a single
filter governs all buckets), e.g. near the budget panel toolbar/body top:

```tsx
        <TableFilter lang={lang} value={roleFilter} onChange={setRoleFilter} placeholderKey="budgetRoleFilter" />
```

(e) Wrap the role/discipline header (line 348) in a `SortHeaderButton`:

```tsx
                        <SortHeaderButton
                          label={t(lang, isBlended ? "budgetDiscipline" : "budgetRole")}
                          active={roleSort.key === "name" && roleSort.dir !== "off"}
                          dir={roleSort.dir}
                          onClick={() => setRoleSort((s) => s.key === "name" ? { key: "name", dir: s.dir === "asc" ? "desc" : s.dir === "desc" ? "off" : "asc" } : { key: "name", dir: "asc" })}
                        />
                        <ColumnResizeHandle col="role" onMouseDown={startResize} />
```

(f) Replace `bucket.allocations.map((a) => {…})` (line 364) with a filtered+sorted
list. Above the `<tbody>` render compute:

```tsx
                    const detailedRows = filterSortAllocations(
                      bucket.allocations,
                      (a) => roleLabel(roles.find((r) => r.id === a.roleId), props.disciplines, props.grades) || `#${a.roleId}`,
                      (a) => sumPeriods(a.actualHours, periods),
                      roleFilter, roleSort,
                    );
```

and map `detailedRows` instead. Do the same for the blended branch (line 388)
with a `blendedRows` built from `bucket.disciplineAllocations ?? []`, `nameOf =
(a) => props.disciplines.find((d) => d.id === a.disciplineId)?.name || '#'+a.disciplineId`,
`totalOf = (a) => sumPeriods(a.actualHours, periods)`.

NOTE: these computations are inside the per-bucket `.map` render (not hooks), so
they can stay inline — no hook-order concern.

- [ ] **Step 5: Run tests + types**

Run: `npx vitest run src/app/budget-panel.test.tsx` → PASS
Run: `npx tsc --noEmit` → clean
Run: `rg "[“”‘’]" src/app/i18n.de.ts` → no output

- [ ] **Step 6: Commit**

```bash
git add src/app/budget-panel.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/budget-panel.test.tsx
git commit -F - <<'EOF'
feat: filter + sort budget bucket role/discipline rows

A single name filter (role/discipline only) and a sortable
name/total header across each bucket's allocation table; per-cell
and row-total RAG preserved.
EOF
```

---

## Task 10: Budget Report Actual-(h) RAG (#14)

**Files:**
- Modify: `src/app/budget-report-panel.tsx:266`
- Test: `src/app/budget-report-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/app/budget-report-panel.test.tsx`:

```tsx
it("shows a RAG badge on the Actual (h) cell judged vs budget hours", () => {
  renderBudgetReport(); // existing helper, with >=1 bucket where actual > budget hours
  // leading status badge already exists; assert there are now >=2 badge letters per row
  const reds = screen.getAllByText("R");
  expect(reds.length).toBeGreaterThanOrEqual(2);
});
```

Pick fixture values so a bucket is over budget on hours (actual > budget) to
yield an "R" both in the leading status column and the new Actual-(h) cell.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/budget-report-panel.test.tsx`
Expected: FAIL — only one badge per row.

- [ ] **Step 3: Implement**

`ratioHealth` is already imported. Replace the actual-hours cell at line 266:

```tsx
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className="inline-flex items-center justify-end gap-1.5">
                      {r.actualHours.toFixed(0)}
                      <RagBadge value={ratioHealth(r.actualHours, r.budgetHours)} lang={lang} title={t(lang, "budgetActualHours")} />
                    </span>
                  </td>
```

- [ ] **Step 4: Run tests + types**

Run: `npx vitest run src/app/budget-report-panel.test.tsx` → PASS
Run: `npx tsc --noEmit` → clean

- [ ] **Step 5: Commit**

```bash
git add src/app/budget-report-panel.tsx src/app/budget-report-panel.test.tsx
git commit -F - <<'EOF'
feat: RAG badge on budget report Actual (h) vs budget hours
EOF
```

---

## Task 11: Reports default-present RAID + Budget (#11)

**Files:**
- Modify: `src/app/workspace-section.tsx:375`
- Test: `src/app/workspace-section.test.tsx` (or `reports.test.tsx`)

When `settings.reports.extra` is unset, default to `["raid-report", "budget-report"]`
so both render at the bottom of Reports out of the box, still removable.

- [ ] **Step 1: Write the failing test**

Add a test where `settings.reports` is undefined and assert the RAID + Budget
report sections render in the Reports view. In `src/app/reports.test.tsx`:

```tsx
it("renders RAID and Budget reports by default when extra is unset", () => {
  render(<ReportsPanel {...baseProps} extraReports={["raid-report", "budget-report"]} />);
  expect(screen.getByText(/raid report/i)).toBeInTheDocument();
  expect(screen.getByText(/budget report/i)).toBeInTheDocument();
});
```

(This locks the ReportsPanel render contract; the default seeding is verified in
the workspace-section test below.)

In `src/app/workspace-section.test.tsx` add (if a render helper exists):

```tsx
it("seeds raid + budget reports when settings.reports is unset", () => {
  renderWorkspace({ settings: settingsWithout("reports") }); // adapt to helper
  // navigate to Reports tab, then:
  expect(screen.getByText(/raid report/i)).toBeInTheDocument();
});
```

If no such helper exists, keep only the `reports.test.tsx` assertion and verify
the default in code review.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/reports.test.tsx`
Expected: FAIL if the default isn't wired (or PASS for the explicit-prop test —
then the failing part is the workspace default).

- [ ] **Step 3: Implement**

In `src/app/workspace-section.tsx` line 375:

```tsx
              extraReports={settings.reports?.extra ?? ["raid-report", "budget-report"]}
```

- [ ] **Step 4: Run tests + types**

Run: `npx vitest run src/app/reports.test.tsx src/app/workspace-section.test.tsx` → PASS
Run: `npx tsc --noEmit` → clean

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace-section.tsx src/app/reports.test.tsx src/app/workspace-section.test.tsx
git commit -F - <<'EOF'
feat: show RAID + Budget reports by default in the Reports view

Seed settings.reports.extra default to raid + budget; still
removable. Resource report stays opt-in.
EOF
```

---

## Task 12: Task editor Cancel + Add/Save buttons (#2)

**Files:**
- Modify: `src/app/task-form-modal.tsx:108`
- Modify: `src/app/task-edit-view.tsx`
- Modify: `src/app/task-manager.tsx` (pass footer)
- Test: `src/app/task-form-modal.test.tsx`, `src/app/task-edit-view.test.tsx`

- [ ] **Step 1: Write the failing tests**

`src/app/task-form-modal.test.tsx`:

```tsx
it("shows Cancel in create mode too", () => {
  render(<TaskFormModal {...createModeProps} />); // isEditing=false
  expect(screen.getByRole("button", { name: /cancel|abbrechen/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /add task|aufgabe hinzuf/i })).toBeInTheDocument();
});
```

`src/app/task-edit-view.test.tsx`:

```tsx
it("renders a footer slot at the bottom of the form", () => {
  render(<TaskEditView {...baseProps} onSubmit={() => {}} footer={<button type="button">FOOTER-CANCEL</button>} />);
  expect(screen.getByText("FOOTER-CANCEL")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/task-form-modal.test.tsx src/app/task-edit-view.test.tsx`
Expected: FAIL — no Cancel in create mode; `footer` prop unknown.

- [ ] **Step 3: Implement classic modal**

`src/app/task-form-modal.tsx` — drop the `isEditing &&` guard (lines 108-116) so
Cancel always shows:

```tsx
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted dark:border-line dark:bg-surface dark:text-foreground dark:hover:bg-surface-muted"
            >
              {t(lang, "cancel")}
            </button>
            <button
              type="submit"
              className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue focus:ring-offset-2"
            >
              {isEditing ? t(lang, "updateTask") : t(lang, "addTask")}
            </button>
          </div>
```

Confirm `onCancel` is always passed by the parent in create mode (it is — the
modal's `onCancel` closes the modal). If `onCancel` is optional, guard with
`onClick={() => onCancel?.()}`.

- [ ] **Step 4: Implement modern editor footer slot**

`src/app/task-edit-view.tsx`:

```tsx
export interface TaskEditViewProps extends TaskFormFieldsProps {
  lang: Lang;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  footer?: React.ReactNode;
}

export function TaskEditView({ onSubmit, footer, ...fieldProps }: TaskEditViewProps) {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <section className="rounded-lg border border-line bg-surface">
        <form id={TASK_EDIT_FORM_ID} onSubmit={onSubmit} className="space-y-6 p-6">
          <TaskFormFields {...fieldProps} />
          {footer && <div className="flex justify-end gap-2 border-t border-line pt-4">{footer}</div>}
        </form>
      </section>
    </div>
  );
}
```

(Add `import type React from "react";` at the top if not already present.)

- [ ] **Step 5: Pass the footer from task-manager**

`src/app/task-manager.tsx` — the `editViewEl` (line 758) currently renders
`<TaskEditView … />` and `editActions` is rendered in the top bar. Pass the same
buttons as a footer:

```tsx
    <TaskEditView
      lang={lang}
      ...
      footer={editActions}
    />
```

`editActions` already contains a Cancel button (`type="button"` → `handleCancelEdit`)
and a submit button bound via `form={TASK_EDIT_FORM_ID}`, so it submits the form
even though it now also renders inside the form. No behaviour change beyond the
new bottom-right placement.

- [ ] **Step 6: Run tests + types**

Run: `npx vitest run src/app/task-form-modal.test.tsx src/app/task-edit-view.test.tsx src/app/task-manager.shell.test.tsx` → PASS
Run: `npx tsc --noEmit` → clean

- [ ] **Step 7: Commit**

```bash
git add src/app/task-form-modal.tsx src/app/task-edit-view.tsx src/app/task-manager.tsx src/app/task-form-modal.test.tsx src/app/task-edit-view.test.tsx
git commit -F - <<'EOF'
feat: Cancel + Add/Save buttons bottom-right in both task editors

Classic modal shows Cancel in create mode; modern full-page editor
gains a bottom-right footer reusing the existing Cancel + submit.
EOF
```

---

## Task 13: Gantt "Add milestone" opens the create form (#3)

**Files:**
- Modify: `src/app/milestones-panel.tsx`
- Modify: `src/app/workspace-section.tsx:387-400` + state
- Test: `src/app/milestones-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/app/milestones-panel.test.tsx`:

```tsx
it("opens the create modal when openCreateNonce increments, not on mount", () => {
  const { rerender } = render(<MilestonesPanel {...baseProps} openCreateNonce={0} />);
  // no create modal on mount
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  rerender(<MilestonesPanel {...baseProps} openCreateNonce={1} />);
  // create modal now open (a Milestone edit modal / dialog appears)
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
```

Adjust the open-modal assertion to however `MilestoneEditModal` is detectable in
existing tests (e.g. a heading or a name input).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/milestones-panel.test.tsx`
Expected: FAIL — `openCreateNonce` prop unknown / no effect.

- [ ] **Step 3: Implement `MilestonesPanel`**

(a) Extend the props (line 36-46):

```tsx
export function MilestonesPanel({
  lang,
  today,
  holidaySet,
  logActivity,
  openCreateNonce,
}: {
  lang: Lang;
  today: string;
  holidaySet: ReadonlySet<string>;
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
  openCreateNonce?: number;
}) {
```

(b) Add an effect after `openNew` is defined (and import `useEffect`):

```tsx
  const prevNonceRef = useRef(openCreateNonce ?? 0);
  useEffect(() => {
    const next = openCreateNonce ?? 0;
    if (next !== prevNonceRef.current) {
      prevNonceRef.current = next;
      if (next > 0) openNew();
    }
  }, [openCreateNonce]);
```

(`useRef` is already imported; add `useEffect` to the `react` import on line 3.)

- [ ] **Step 4: Wire `workspace-section.tsx`**

(a) Add state near the other workspace state:

```tsx
  const [milestoneCreateNonce, setMilestoneCreateNonce] = useState(0);
```

(b) Gantt `onAddMilestone` (line 398):

```tsx
              onAddMilestone={() => { setActiveTab("milestones"); setMilestoneCreateNonce((n) => n + 1); }}
```

(c) Pass the nonce to `MilestonesPanel` wherever it is rendered (search for
`<MilestonesPanel`):

```tsx
            <MilestonesPanel lang={lang} today={today} holidaySet={holidaySet} logActivity={logActivity} openCreateNonce={milestoneCreateNonce} />
```

(match the existing prop spread; only add `openCreateNonce={milestoneCreateNonce}`).

- [ ] **Step 5: Run tests + types**

Run: `npx vitest run src/app/milestones-panel.test.tsx src/app/workspace-section.test.tsx` → PASS
Run: `npx tsc --noEmit` → clean

- [ ] **Step 6: Commit**

```bash
git add src/app/milestones-panel.tsx src/app/workspace-section.tsx src/app/milestones-panel.test.tsx
git commit -F - <<'EOF'
feat: Gantt "Add milestone" opens the create form directly

A one-way openCreateNonce signal from workspace-section opens the
milestone create modal on the Milestones tab (parity with Add task).
EOF
```

---

## Task 14: Version + docs bump to 0.48.0 "Tchaikovsky"

**Files:**
- Modify: `src/app/version.ts`
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `docs/CODEMAPS/frontend.md`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (`versionHighlightUiRefinements`)
- Test: existing version test if present (`src/app/version*.test.ts`)

- [ ] **Step 1: Add the highlight i18n key**

`src/app/i18n.ts`:

```ts
  versionHighlightUiRefinements: "Burn-down axes, dashboard RAG legend, margin/actual RAG, planning & budget filtering, default reports",
```

`src/app/i18n.de.ts`:

```ts
  versionHighlightUiRefinements: "Burn-down-Achsen, Dashboard-RAG-Legende, Margen-/Ist-RAG, Planungs- & Budgetfilter, Standardberichte",
```

- [ ] **Step 2: Update `src/app/version.ts`**

Set `APP_VERSION = "0.48.0"`, `APP_MILESTONE = "Tchaikovsky"`,
`APP_BUILD_DATE = "2026-06-03"`, prepend a `0.48.0` comment block matching the
existing format, and append `"versionHighlightUiRefinements"` to
`APP_HIGHLIGHT_KEYS`.

- [ ] **Step 3: Update `package.json`** — `"version": "0.48.0"`.

- [ ] **Step 4: Update `CHANGELOG.md`** — add a `## [0.48.0] — 2026-06-03 "Tchaikovsky"`
section listing the items from this plan (axes, dashboard legend/captions/colour,
print fix, margin RAG, actual-h RAG, planning & budget filter/sort, calendar
Today, default reports, task-editor buttons, gantt milestone create).

- [ ] **Step 5: Update `README.md`** version line and `docs/CODEMAPS/frontend.md`
stamp + note the `marginAmountHealth`/`healthText` additions and the burndown
axis props.

- [ ] **Step 6: Run the full suite + types + lint**

Run: `npm run test:run` → all green
Run: `npx tsc --noEmit` → clean
Run: `npm run lint` → clean
Run: `rg "[“”‘’]" src/app/i18n.de.ts` → no output

- [ ] **Step 7: Commit**

```bash
git add src/app/version.ts package.json CHANGELOG.md README.md docs/CODEMAPS/frontend.md src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
chore: release v0.48.0 "Tchaikovsky" — UI refinements batch
EOF
```

---

## Final verification (after all tasks)

- [ ] `npm run test:run` — full suite green
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run lint` — clean
- [ ] `rg "[“”‘’]" src/app/i18n.de.ts` — no curly quotes
- [ ] Dispatch a final holistic code review over the whole branch diff.
- [ ] Use superpowers:finishing-a-development-branch.

## Spec coverage check

| Spec item | Task |
|---|---|
| #1/#12 burn-down axes | 3 |
| #15 print colours | 2 |
| #16 Overall text colour | 4 |
| #17 captions | 4 |
| #18 thresholds legend | 4 |
| #4 margin RAG (planning + report) | 5, 6 |
| #7 calendar Today | 7 |
| #8 planning filter+sort | 8 |
| #9 budget filter+sort | 9 |
| #14 actual-h RAG | 10 |
| #11 default reports | 11 |
| #2 task editor buttons | 12 |
| #3 gantt milestone create | 13 |
| version/docs | 14 |
| helpers (`marginAmountHealth`, `healthText`) | 1 |
