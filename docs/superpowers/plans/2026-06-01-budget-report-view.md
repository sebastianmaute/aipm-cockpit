# Budget Report View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only **Budget Report** as a `budget-report` sub-menu under the Budget nav item — a printable `ReportCard` with a project-level CCI rollup and a sortable per-bucket detail table — and remove the v0.40.0 budget block from the task Reports view.

**Architecture:** No engine change. A new `budget-report-panel.tsx` renders the existing `computeBudgetReport(...)` output (all figures EUR; each bucket's mode + FX looked up from `buckets`/`fxRates`). Nav wiring mirrors `raid` → `raid-report` exactly. The task Reports view reverts to task-only.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, Tailwind, Vitest + React Testing Library.

**Reference spec:** `docs/superpowers/specs/2026-06-01-budget-report-view-design.md`

**Conventions for every task:**
- Single-file test run: `npx vitest run src/app/<file>.test.tsx`
- Full gate before each commit: `npx vitest run && npx tsc --noEmit && npx eslint .`
- Commit messages: conventional commits, NO `Co-Authored-By` trailer (attribution disabled globally).
- `i18n.de.ts`: keep the `"` string delimiters ASCII straight quotes (proper umlauts ä/ö/ü/ß inside values are fine); grep `'[“”‘’]'` after editing to confirm no delimiter was curled.
- Do NOT edit `eslint.config.mjs` (hook-blocked). Use PowerShell `Remove-Item`, never `rm -rf`.
- Task order is chosen so `tsc`/`eslint`/tests stay green at every commit.

---

### Task 1: i18n keys for the Budget Report

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

These keys are added now (used by the panel in Task 2). The old `reportsBudget*` keys stay until Task 4 (still used by `reports.tsx`). Both maps must stay in key-parity (tsc enforces it).

- [ ] **Step 1: Add the English keys to `src/app/i18n.ts`** (near the other `budget*` keys)

```ts
  budgetReportTitle: "Budget Report",
  budgetReportEmpty: "No budget buckets yet.",
  budgetReportProjectTotal: "Project total",
  budgetReportByBucket: "By bucket",
  budgetReportColMode: "Mode",
  budgetReportColStatus: "Status",
  budgetReportStatusOpen: "Open",
  budgetReportStatusClosed: "Closed",
  budgetReportRevenue: "Revenue",
  budgetReportCost: "Cost",
  budgetReportColBudgetEur: "Budget (EUR)",
  budgetReportColConsumed: "Consumed (EUR)",
  budgetReportColMargin: "Margin %",
  budgetReportColWinLoss: "Win/Loss",
  budgetReportFilterBucket: "Filter buckets",
```

- [ ] **Step 2: Add the matching German keys to `src/app/i18n.de.ts`** (ASCII `"` delimiters; proper umlauts inside)

```ts
  budgetReportTitle: "Budgetbericht",
  budgetReportEmpty: "Noch keine Budget-Buckets.",
  budgetReportProjectTotal: "Projektsumme",
  budgetReportByBucket: "Nach Bucket",
  budgetReportColMode: "Modus",
  budgetReportColStatus: "Status",
  budgetReportStatusOpen: "Offen",
  budgetReportStatusClosed: "Geschlossen",
  budgetReportRevenue: "Umsatz",
  budgetReportCost: "Kosten",
  budgetReportColBudgetEur: "Budget (EUR)",
  budgetReportColConsumed: "Verbraucht (EUR)",
  budgetReportColMargin: "Marge %",
  budgetReportColWinLoss: "Gewinn/Verlust",
  budgetReportFilterBucket: "Buckets filtern",
```

- [ ] **Step 3: Verify parity + no curly quotes**

Run: `npx tsc --noEmit` (parity: a key in one map but not the other fails here) — expect exit 0.
Run (PowerShell): `Select-String -Path src/app/i18n.de.ts -Pattern '[“”‘’]'` — confirm none of the matches are on the lines you just added.

- [ ] **Step 4: Full gate + commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: add i18n strings for the budget report view"
```

---

### Task 2: `budget-report-panel.tsx` (the read-only report)

**Files:**
- Create: `src/app/budget-report-panel.tsx`
- Test: `src/app/budget-report-panel.test.tsx`

**Context:** Built like `raid-report-panel.tsx`. `computeBudgetReport(buckets, plan, roles, resources, workdayHours, holidaySet, absences)` returns `{ project: ProjectReport, buckets: BucketReport[] }` (all EUR). `BucketReport` has `bucketId, name, currency, type, status, budgetHours, plannedHours, actualHours, budgetValue, consumedValue, revenue, cost, winLossValue, spilloverInHours, contributionMargin, costPerformance, consumption` (the CCI fields are `CciValue = { amount: number; percent: number | null }`). `BucketReport` does NOT carry `planningMode` or FX, so the panel maps `bucketById` for mode and uses `resolveRate(bucket, fxRates)` (from `./fx`) for the ×rate. `Section` is exported from `./raid-report-panel`. `ReportCard`/`useSortableFilter`/`SortHeaderButton`/`TableFilter`/`type SortDir` from `./report-table`. `formatCurrency` from `./resource-cost`.

- [ ] **Step 1: Write the failing test `src/app/budget-report-panel.test.tsx`**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BudgetReportPanel } from "./budget-report-panel";
import type { BudgetBucket, ResourcePlan, Role } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-01-31", granularity: "month", currency: "EUR" };
// Discipline 1 grades average to internal 120 / external 180.
const roles: Role[] = [
  { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
  { id: 2, disciplineId: 1, gradeId: 2, internalRate: 140, externalRate: 210 },
];
const buckets: BudgetBucket[] = [
  { id: 1, name: "Alpha", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    planningMode: "blended", allocations: [],
    disciplineAllocations: [{ disciplineId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } }] },
  { id: 2, name: "Beta", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "closed",
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 50 }, actualHours: { "2026-01": 50 } }] },
];

function renderPanel(over: Partial<React.ComponentProps<typeof BudgetReportPanel>> = {}) {
  return render(
    <BudgetReportPanel
      lang="en-US"
      buckets={buckets}
      plan={plan}
      roles={roles}
      resources={[]}
      absences={[]}
      holidaySet={new Set<string>()}
      workdayHours={8}
      fxRates={null}
      {...over}
    />,
  );
}

describe("BudgetReportPanel", () => {
  it("shows the project rollup (revenue + cost in EUR)", () => {
    renderPanel();
    // revenue = 80*180 + 50*150 = 21900 ; cost = 80*120 + 50*100 = 14600
    expect(screen.getByText(/€?21,900|21\.900/)).toBeInTheDocument();
    expect(screen.getByText(/€?14,600|14\.600/)).toBeInTheDocument();
  });

  it("lists a row per bucket with its planning mode", () => {
    renderPanel();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Blended")).toBeInTheDocument();
    expect(screen.getByText("Detailed")).toBeInTheDocument();
  });

  it("filters the bucket table by name", async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = screen.getByPlaceholderText(/filter buckets/i);
    await user.type(input, "alpha");
    const tbody = document.querySelector("table tbody") as HTMLElement;
    const names = Array.from(tbody.querySelectorAll("tr")).map((tr) => (tr.querySelector("td") as HTMLElement)?.textContent ?? "");
    expect(names).toContain("Alpha");
    expect(names).not.toContain("Beta");
  });

  it("shows the empty state when there are no buckets", () => {
    renderPanel({ buckets: [] });
    expect(screen.getByText(/no budget buckets yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/budget-report-panel.test.tsx`
Expected: FAIL — `budget-report-panel` module does not exist.

- [ ] **Step 3: Implement `src/app/budget-report-panel.tsx`**

```tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { ColumnResizeHandle } from "./task-manager-ui";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import {
  ReportCard,
  TableFilter,
  SortHeaderButton,
  useSortableFilter,
  type SortDir,
} from "./report-table";
import { Section } from "./raid-report-panel";
import { computeBudgetReport, type BucketReport, type CciValue } from "./budget-report";
import { formatCurrency } from "./resource-cost";
import { resolveRate } from "./fx";
import type { Absence, BudgetBucket, FxRates, ResourcePlan, Resource, Role } from "./types";

const DETAIL_COL_WIDTHS = {
  bucket: 160, mode: 90, type: 80, status: 80, currency: 110,
  budgetH: 80, planH: 80, actualH: 80, budgetEur: 110, consumedEur: 120, margin: 90, winLoss: 110,
} as const;
type DetailCol = keyof typeof DETAIL_COL_WIDTHS;

type DetailSortKey =
  | "name" | "mode" | "type" | "status" | "currency"
  | "budgetH" | "planH" | "actualH" | "budgetEur" | "consumedEur" | "margin" | "winLoss";

interface Props {
  lang: Lang;
  buckets: BudgetBucket[];
  plan: ResourcePlan;
  roles: Role[];
  resources: Resource[];
  absences: Absence[];
  holidaySet: Set<string>;
  workdayHours: number;
  fxRates: FxRates | null;
}

function localeFor(lang: Lang): string {
  return lang === "de" ? "de-DE" : lang === "en-GB" ? "en-GB" : "en-US";
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey tabular-nums">{value}</p>
    </div>
  );
}

export function BudgetReportPanel({
  lang, buckets, plan, roles, resources, absences, holidaySet, workdayHours, fxRates,
}: Props) {
  const report = useMemo(
    () => computeBudgetReport(buckets, plan, roles, resources, workdayHours, holidaySet, absences),
    [buckets, plan, roles, resources, workdayHours, holidaySet, absences],
  );
  const bucketById = useMemo(() => new Map(buckets.map((b) => [b.id, b])), [buckets]);
  const { ref, reset } = useResizable("lop-app:budget-report-size");
  const detail = useColumnResize<DetailCol>("budgetReportDetail", DETAIL_COL_WIDTHS);

  if (buckets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted-foreground">
        {t(lang, "budgetReportEmpty")}
      </div>
    );
  }

  const locale = localeFor(lang);
  const money = (n: number) => formatCurrency(n, "EUR", locale);
  const pct = (v: CciValue) => (v.percent == null ? "—" : `${v.percent.toFixed(1)}%`);
  const proj = report.project;

  return (
    <ReportCard
      lang={lang}
      sizeRef={ref}
      onResetSize={reset}
      onResetCols={detail.resetColWidths}
      title={t(lang, "budgetReportTitle")}
    >
      <Section title={t(lang, "budgetReportProjectTotal")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label={t(lang, "budgetBudgetHours")} value={proj.budgetHours.toFixed(0)} />
          <Tile label={t(lang, "budgetPlanHours")} value={proj.plannedHours.toFixed(0)} />
          <Tile label={t(lang, "budgetActualHours")} value={proj.actualHours.toFixed(0)} />
          <Tile label={t(lang, "budgetReportRevenue")} value={money(proj.revenue)} />
          <Tile label={t(lang, "budgetReportCost")} value={money(proj.cost)} />
          <Tile label={t(lang, "budgetCciMargin")} value={`${money(proj.contributionMargin.amount)} (${pct(proj.contributionMargin)})`} />
          <Tile label={t(lang, "budgetCciCpi")} value={`${money(proj.costPerformance.amount)} (${pct(proj.costPerformance)})`} />
          <Tile label={t(lang, "budgetCciConsumption")} value={`${money(proj.consumption.amount)} (${pct(proj.consumption)})`} />
        </div>
      </Section>

      <BucketDetailTable
        lang={lang}
        rows={report.buckets}
        bucketById={bucketById}
        fxRates={fxRates}
        colResize={detail}
        money={money}
      />
    </ReportCard>
  );
}

type DetailResizable = ReturnType<typeof useColumnResize<DetailCol>>;

function BucketDetailTable({
  lang, rows, bucketById, fxRates, colResize, money,
}: {
  lang: Lang;
  rows: BucketReport[];
  bucketById: Map<number, BudgetBucket>;
  fxRates: FxRates | null;
  colResize: DetailResizable;
  money: (n: number) => string;
}) {
  const [sort, setSort] = useState<{ key: DetailSortKey; dir: SortDir }>({ key: "budgetEur", dir: "desc" });
  const [filter, setFilter] = useState("");

  const mapped = useMemo(
    () =>
      rows.map((r) => {
        const b = bucketById.get(r.bucketId);
        const blended = b?.planningMode === "blended";
        const rate = b ? resolveRate(b, fxRates) : 1;
        return {
          ...r,
          modeLabel: t(lang, blended ? "budgetModeBlended" : "budgetModeDetailed"),
          typeLabel: t(lang, r.type === "fixed" ? "budgetTypeFixed" : "budgetTypeTm"),
          statusLabel: t(lang, r.status === "closed" ? "budgetReportStatusClosed" : "budgetReportStatusOpen"),
          currencyLabel: rate !== 1 ? `${r.currency} (×${rate})` : r.currency,
          marginPct: r.contributionMargin.percent,
        };
      }),
    [rows, bucketById, fxRates, lang],
  );

  const getValue = useCallback((r: typeof mapped[number], k: DetailSortKey): string | number => {
    switch (k) {
      case "name": return r.name;
      case "mode": return r.modeLabel;
      case "type": return r.typeLabel;
      case "status": return r.statusLabel;
      case "currency": return r.currency;
      case "budgetH": return r.budgetHours;
      case "planH": return r.plannedHours;
      case "actualH": return r.actualHours;
      case "budgetEur": return r.budgetValue;
      case "consumedEur": return r.consumedValue;
      case "margin": return r.marginPct ?? Number.NEGATIVE_INFINITY;
      case "winLoss": return r.winLossValue;
    }
  }, []);

  const { sorted, click } = useSortableFilter(mapped, sort, setSort, filter, getValue);
  const w = colResize.colWidths;
  const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  const cols: { key: DetailSortKey; col: DetailCol; label: string; align: "left" | "right" }[] = [
    { key: "name", col: "bucket", label: t(lang, "budgetReportByBucket"), align: "left" },
    { key: "mode", col: "mode", label: t(lang, "budgetReportColMode"), align: "left" },
    { key: "type", col: "type", label: t(lang, "budgetType"), align: "left" },
    { key: "status", col: "status", label: t(lang, "budgetReportColStatus"), align: "left" },
    { key: "currency", col: "currency", label: t(lang, "budgetCurrency"), align: "left" },
    { key: "budgetH", col: "budgetH", label: t(lang, "budgetBudgetHours"), align: "right" },
    { key: "planH", col: "planH", label: t(lang, "budgetPlanHours"), align: "right" },
    { key: "actualH", col: "actualH", label: t(lang, "budgetActualHours"), align: "right" },
    { key: "budgetEur", col: "budgetEur", label: t(lang, "budgetReportColBudgetEur"), align: "right" },
    { key: "consumedEur", col: "consumedEur", label: t(lang, "budgetReportColConsumed"), align: "right" },
    { key: "margin", col: "margin", label: t(lang, "budgetReportColMargin"), align: "right" },
    { key: "winLoss", col: "winLoss", label: t(lang, "budgetReportColWinLoss"), align: "right" },
  ];

  return (
    <Section title={t(lang, "budgetReportByBucket")}>
      <TableFilter lang={lang} value={filter} onChange={setFilter} placeholderKey="budgetReportFilterBucket" />
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.col}
                  className={`relative px-3 py-2 font-medium ${c.align === "right" ? "text-right" : ""}`}
                  style={{ width: w[c.col], minWidth: w[c.col] }}
                >
                  <SortHeaderButton
                    label={c.label}
                    active={sort.key === c.key && sort.dir !== "off"}
                    dir={sort.dir}
                    onClick={() => click(c.key)}
                  />
                  <ColumnResizeHandle col={c.col} onMouseDown={sr} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.length === 0 && filter !== "" ? (
              <tr>
                <td colSpan={cols.length} className="px-3 py-3 text-center text-xs text-muted-foreground">
                  {t(lang, "reportsNoMatches")}
                </td>
              </tr>
            ) : (
              sorted.map((r) => (
                <tr key={r.bucketId}>
                  <td className="px-3 py-2 font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">{r.name}</td>
                  <td className="px-3 py-2">{r.modeLabel}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.typeLabel}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.statusLabel}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.currencyLabel}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.budgetHours.toFixed(0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.plannedHours.toFixed(0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.actualHours.toFixed(0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.budgetValue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.consumedValue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.marginPct == null ? "—" : `${r.marginPct.toFixed(1)}%`}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.winLossValue < 0 ? "text-AIPM-pink font-medium" : ""}`}>{money(r.winLossValue)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
```

If `resolveRate` or `CciValue`/`BucketReport` are not exported as referenced, read `./fx` and `./budget-report` and adjust the import to the actual exported names (do not change behavior). `budget-panel.tsx` already imports `resolveRate` from `./fx` and `BucketReport`/`CciValue` from `./budget-report` — mirror those imports exactly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/budget-report-panel.test.tsx`
Expected: PASS (4 tests). If the money regex doesn't match the actual format, read the rendered text and fix the TEST regex (not the component).

- [ ] **Step 5: Full gate + commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/budget-report-panel.tsx src/app/budget-report-panel.test.tsx
git commit -m "feat: add read-only budget report panel"
```

---

### Task 3: Wire `budget-report` into navigation

**Files:**
- Modify: `src/app/nav-config.ts`
- Modify: `src/app/nav-config.test.ts`
- Modify: `src/app/nav-icons.tsx`
- Modify: `src/app/workspace-tab-context.tsx`
- Modify: `src/app/workspace-section.tsx`

- [ ] **Step 1: Add the nav-config test assertions (`src/app/nav-config.test.ts`)**

Add (inside the existing describe, or a new one — match the file's style):

```ts
import { subTabsFor, allNavViews, navLabelKey } from "./nav-config";

it("exposes budget-report as a child of budget", () => {
  expect(subTabsFor("budget")).toEqual([{ view: "budget-report" }]);
  expect(subTabsFor("budget-report")).toEqual([{ view: "budget-report" }]);
  expect(allNavViews()).toContain("budget-report");
  expect(navLabelKey("budget-report")).toBe("budgetReportTitle");
});
```

(If `subTabsFor`/`allNavViews`/`navLabelKey` are already imported at the top of the test file, don't duplicate the import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/nav-config.test.ts`
Expected: FAIL — `budget-report` is not a nav view yet (and tsc within the test will complain it's not an `AppView`).

- [ ] **Step 3: Implement nav-config changes (`src/app/nav-config.ts`)**

Add `"budget-report"` to the `AppView` union (after `"budget"`):
```ts
  | "budget"
  | "budget-report"
```
Give the `budget` nav item a child (in `NAV_GROUPS`, the `navGroupPlan` group):
```ts
      { view: "budget", children: [{ view: "budget-report" }] },
```
Add the label mapping in `LABEL_KEYS`:
```ts
  budget: "tabBudget",
  "budget-report": "budgetReportTitle",
```

- [ ] **Step 4: Add the nav icon (`src/app/nav-icons.tsx`)**

`ICON_PATHS` is `Record<AppView, string>` (total) — add an entry (reuse the document/report glyph, same `d` as `raid-report`):
```ts
  "budget-report": "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
```

- [ ] **Step 5: Add to the `TopTab` union (`src/app/workspace-tab-context.tsx`)**

Append `| "budget-report"` to the `TopTab` type (the union on line ~6):
```ts
export type TopTab = "chat" | "reports" | "gantt" | "raid" | "resources" | "directory" | "workload" | "calendar" | "planning" | "manage-roles" | "activity" | "raid-report" | "budget" | "budget-report";
```

- [ ] **Step 6: Render the panel (`src/app/workspace-section.tsx`)**

Add a dynamic import next to the `RaidReportPanel` one (~line 45):
```tsx
const BudgetReportPanel = dynamic(
  () => import("./budget-report-panel").then((m) => m.BudgetReportPanel),
  { ssr: false },
);
```
Add a render block right after the `activeTab === "budget"` block (after its closing `)}`):
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
(`panelScrollClass`, `budgets`, `plan`, `roles`, `resources`, `absences`, `holidaySet`, `settings`, `fxRates`, `lang` are all already in scope at this point in the component — confirm by reading the surrounding blocks.)

- [ ] **Step 7: Run nav test + full gate, then commit**

Run: `npx vitest run src/app/nav-config.test.ts` — expect PASS.
```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/nav-config.ts src/app/nav-config.test.ts src/app/nav-icons.tsx src/app/workspace-tab-context.tsx src/app/workspace-section.tsx
git commit -m "feat: add budget-report sub-menu under budget"
```

---

### Task 4: Remove the v0.40.0 budget section from the task Reports view

**Files:**
- Modify: `src/app/reports.tsx`
- Modify: `src/app/reports.test.tsx`
- Modify: `src/app/workspace-section.tsx`
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

**Context:** `reports.tsx` currently has a `BudgetSection` component, renders it inside `ReportsPanel` (guarded by `plan && buckets.length > 0`), and `ReportsPanel` takes optional budget props. Remove all of that; revert to task-only.

- [ ] **Step 1: Update `reports.test.tsx` first (remove budget tests)**

Delete the `describe("ReportsPanel — budget section", ...)` block and the budget fixtures/helpers it added (`budgetPlan`, `budgetRoles`, `budgetBuckets`, `renderWithBudget`, `budgetRowNames`, and the `BudgetBucket`/`ResourcePlan`/`Role`/`Resource` type import if now unused). If `fireEvent` was added solely for those tests and is now unused, drop it from the `@testing-library/react` import. Keep all task-report tests.

- [ ] **Step 2: Run the reports test to verify it still parses/passes the task tests**

Run: `npx vitest run src/app/reports.test.tsx`
Expected: PASS (task-report tests only; no budget tests).

- [ ] **Step 3: Remove `BudgetSection` from `reports.tsx`**

- Delete the entire `function BudgetSection({...}) { ... }` component.
- Delete the `{plan && buckets.length > 0 && ( <BudgetSection ... /> )}` block from `ReportsPanel`'s returned JSX.
- Revert `ReportsPanel`'s signature to task-only:
```ts
export function ReportsPanel({
  tasks, today, holidaySet, lang,
}: {
  tasks: Task[];
  today: string;
  holidaySet: Set<string>;
  lang: Lang;
}) {
```
- Remove the now-unused imports: `computeBudgetReport` (from `./budget-report`), `formatCurrency` (from `./resource-cost`), and the budget-only types (`Absence`, `BudgetBucket`, `Discipline`, `Grade`, `Resource`, `ResourcePlan`, `Role`) — keep `Priority`, `PRIORITIES`, `Task`. Leave `useState`/`useMemo`/`useCallback` (still used by the task tables).

- [ ] **Step 4: Revert the `<ReportsPanel>` call (`src/app/workspace-section.tsx`)**

Change the call back to task-only props:
```tsx
            <ReportsPanel
              tasks={tasks}
              today={today}
              holidaySet={holidaySet}
              lang={lang}
            />
```

- [ ] **Step 5: Remove the now-unused `reportsBudget*` i18n keys**

These keys were only used by the deleted `BudgetSection`. Grep to confirm no remaining references in `.ts/.tsx` (outside the i18n maps): `reportsBudget`. Then remove these keys from BOTH `src/app/i18n.ts` and `src/app/i18n.de.ts`:
`reportsBudget`, `reportsBudgetAllBuckets`, `reportsBudgetFilterBucket`, `reportsBudgetMinTotal`, `reportsBudgetTotal`, `reportsBudgetUsed`, `reportsBudgetFree`, `reportsBudgetHours`, `reportsBudgetBucketCol`, `reportsBudgetPlanHours`, `reportsBudgetUsedHours`, `reportsBudgetBudgetEur`.
(Remove exactly the keys that exist — grep `reportsBudget` in each map to get the precise list; `reportsBudgetEmpty` was already removed in v0.40.x and won't be present.)

- [ ] **Step 6: Verify + commit**

Run (PowerShell): `Select-String -Path src/app/i18n.de.ts -Pattern '[“”‘’]'` — confirm no delimiter regressions.
```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/reports.tsx src/app/reports.test.tsx src/app/workspace-section.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "refactor: move budget reporting out of the task reports view"
```

Expected gate: green. tsc confirms EN/DE parity after the key removals and that no code references the removed keys (`t()` is typed against `TranslationKey`).

---

### Task 5: Version 0.41.0 "Okorafor" + docs

**Files:**
- Modify: `src/app/version.ts`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (one highlight key each)
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `docs/CODEMAPS/*.md`

- [ ] **Step 1: Bump `version.ts`**

Set `APP_VERSION = "0.41.0"`, `APP_BUILD_DATE = "2026-06-01"`, `APP_MILESTONE = "Okorafor"`. Prepend a release-notes comment block above the current top block:
```ts
// 0.41.0 "Okorafor" adds a dedicated Budget Report. A new "Budget Report"
// sub-menu under Budget (mirroring RAID -> RAID Report) shows the current
// budget calculations across all buckets — role rates, blended discipline
// rates, per-bucket overrides, FX, and spillover — as a printable report with a
// project-level CCI rollup and a sortable per-bucket detail table (all figures
// in EUR). The budget block added to the task Reports view in 0.40.0 is removed
// and folded into this dedicated report. No budget-engine change.
```
Append `"versionHighlightBudgetReport"` to the end of the `APP_HIGHLIGHT_KEYS` array.

- [ ] **Step 2: Highlight strings**

`src/app/i18n.ts`:
```ts
  versionHighlightBudgetReport: "A dedicated Budget Report (under Budget) shows current budget calculations across all buckets, rates, and factors.",
```
`src/app/i18n.de.ts`:
```ts
  versionHighlightBudgetReport: "Ein eigener Budgetbericht (unter Budget) zeigt die aktuellen Budgetberechnungen ueber alle Buckets, Saetze und Faktoren.",
```

- [ ] **Step 3: CHANGELOG entry (prepend, matching the file's heading style)**

```markdown
## [0.41.0] — 2026-06-01 "Okorafor"

### Added
- **Budget Report:** a dedicated, read-only report under Budget -> Budget Report. Shows the project-level CCI rollup (contribution margin, cost performance, consumption) and a sortable per-bucket detail table (mode, type, status, currency/FX, budget/plan/actual hours, budget/consumed EUR, margin, win/loss) across all buckets. Printable via the report card.

### Changed
- Budget reporting moved out of the task Reports view (added in 0.40.0) into the dedicated Budget Report.
```

- [ ] **Step 4: README + CODEMAPS stamps**

- `README.md`: version line → `v0.41.0 "Okorafor"`.
- `docs/CODEMAPS/*.md`: bump the version stamp upper bound to `0.41.0` (grep `0.40.0`/`0.29.0` to find the exact stamp text, then bump only the upper bound, preserving the descriptive suffix). Apply to all 5 files.

- [ ] **Step 5: Verify + commit**

Run (PowerShell): `Select-String -Path src/app/i18n.de.ts -Pattern '[“”‘’]'` — confirm clean.
```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md README.md docs/CODEMAPS
git commit -m "chore: release v0.41.0 -- budget report view"
```

---

## Final verification (after all tasks)

- [ ] `npx vitest run` — whole suite green.
- [ ] `npx tsc --noEmit` — no type errors.
- [ ] `npx eslint .` — clean.
- [ ] Manual smoke: sidebar Budget now has a Budget Report child; it shows the project rollup + per-bucket table; sort/filter work; the task Reports view no longer shows a budget block; classic layout sub-tab row under Budget shows Budget Report.
- [ ] Dispatch a final code-reviewer over the whole branch.
