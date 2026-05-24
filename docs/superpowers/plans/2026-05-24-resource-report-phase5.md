# Resource Report Pop-out (Phase 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only resources report — capacity + internal/external cost + margin, with per-period, per-discipline, per-grade, per-combo, and per-resource breakdowns — openable as a pop-out from the Resources tab.

**Architecture:** Report aggregation is a **pure** `resource-report.ts` (`computeResourceReport(...)`), reusing the Phase-3 capacity engine and Phase-4 cost functions — fully unit-tested. `resources-report.tsx` renders that data read-only (Tile/Section/tables, styled like `reports.tsx`), formatting money via `formatCurrency` + `localeFor(lang)`. The pop-out reuses the existing tab-popout machinery: register `"resource-report"` in `POPOUT_TABS`/`TopTab`, render it in `WorkspaceSection` when active, and add a "Report" button to the Resources panel header that calls `openPopoutWindow("resource-report", reuseWindow)`.

**Tech Stack:** TypeScript, React 19, Next.js 16, Vitest (jsdom) + Testing Library. Spec: `docs/superpowers/specs/2026-05-23-resource-utilization-design.md` (Report Pop-out section). Branch: `feat/resource-utilization`.

**Baseline:** 2 pre-existing `tsc` errors in test files (`settings-menu.test.tsx:18`, `use-due-alerts.test.ts:28`) — ignore; add none. `use-holiday-set.test.ts` is an occasional full-run flake — re-run alone if sole failure.

---

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `src/app/resource-report.ts` | Pure `computeResourceReport` aggregation | **New** |
| `src/app/resource-report.test.ts` | Aggregation unit tests | **New** |
| `src/app/resources-report.tsx` | Read-only report panel (tiles + tables) | **New** |
| `src/app/resources-report.test.tsx` | Panel render test | **New** |
| `src/app/broadcast-sync.ts` | Add `"resource-report"` to `POPOUT_TABS` | Modify |
| `src/app/workspace-tab-context.tsx` | Add `"resource-report"` to `TopTab` | Modify |
| `src/app/workspace-section.tsx` | Render report panel in popout; provide `onOpenReport` | Modify |
| `src/app/resources-panel.tsx` | "Report" button in the header (`onOpenReport` prop) | Modify |
| `src/app/resources-panel.test.tsx` | Report-button test | Modify |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | New keys | Modify |

**Commands:** single file `npx vitest run src/app/<file>.test.ts`; full `npm run test:run`; types `npx tsc --noEmit`.

---

## Task 1: Pure report aggregation (`resource-report.ts`)

**Files:** Create `src/app/resource-report.ts`, `src/app/resource-report.test.ts`.

- [ ] **Step 1: Write failing tests** `src/app/resource-report.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { computeResourceReport } from "./resource-report";
import type { Resource, Role, Discipline, Grade, ResourcePlan } from "./types";

const disciplines: Discipline[] = [{ id: 1, name: "Developer" }];
const grades: Grade[] = [{ id: 1, name: "Senior" }];
const roles: Role[] = [{ id: 5, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 }];
const plan: ResourcePlan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month", currency: "EUR" };

describe("computeResourceReport", () => {
  test("totals + breakdowns for one assigned resource (Feb 2026 = 160h @100%)", () => {
    const resources: Resource[] = [
      { id: 1, name: "Sample", roleId: 5, utilizationMode: "percent", utilization: { "2026-02": 100 } },
    ];
    const rep = computeResourceReport(resources, roles, disciplines, grades, plan, [], new Set(), 8);
    expect(rep.totalCapacityHours).toBeCloseTo(160, 6);
    expect(rep.totalInternal).toBeCloseTo(16000, 6);
    expect(rep.totalExternal).toBeCloseTo(32000, 6);
    expect(rep.totalMargin).toBeCloseTo(16000, 6);
    expect(rep.perPeriod).toHaveLength(1);
    expect(rep.perPeriod[0]).toMatchObject({ key: "2026-02" });
    expect(rep.perDiscipline[0]).toMatchObject({ label: "Developer", headcount: 1 });
    expect(rep.perGrade[0]).toMatchObject({ label: "Senior", headcount: 1 });
    expect(rep.perCombo[0]).toMatchObject({ label: "Developer Senior", headcount: 1 });
    expect(rep.perResource[0]).toMatchObject({ name: "Sample", roleLabel: "Developer Senior", hasRole: true, avgUtilization: 100 });
  });

  test("unassigned resource: counted in capacity + per-resource (flagged), excluded from breakdowns and cost", () => {
    const resources: Resource[] = [
      { id: 2, name: "Bob", roleId: null, utilizationMode: "percent", utilization: { "2026-02": 50 } },
    ];
    const rep = computeResourceReport(resources, roles, disciplines, grades, plan, [], new Set(), 8);
    expect(rep.totalCapacityHours).toBeCloseTo(80, 6); // 50% of 160
    expect(rep.totalInternal).toBe(0);
    expect(rep.perDiscipline).toHaveLength(0);
    expect(rep.perResource[0]).toMatchObject({ name: "Bob", hasRole: false });
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run src/app/resource-report.test.ts`.

- [ ] **Step 3: Implement** `src/app/resource-report.ts`:

```ts
import { generatePeriods, displayCapacityHours, absencesForResource } from "./resource-capacity";
import { periodCost, type CostBreakdown } from "./resource-cost";
import { roleLabel } from "./resource-foundation";
import type { Absence, Discipline, Grade, Resource, ResourcePlan, Role } from "./types";

export type ReportGroupRow = { key: string; label: string; headcount: number; capacityHours: number; internal: number; external: number };
export type ReportPeriodRow = { key: string; capacityHours: number; internal: number; external: number; margin: number };
export type ReportResourceRow = {
  id: number; name: string; roleLabel: string; hasRole: boolean;
  avgUtilization: number; capacityHours: number; internal: number; external: number;
};
export type ResourceReport = {
  totalCapacityHours: number;
  totalInternal: number;
  totalExternal: number;
  totalMargin: number;
  perPeriod: ReportPeriodRow[];
  perDiscipline: ReportGroupRow[];
  perGrade: ReportGroupRow[];
  perCombo: ReportGroupRow[];
  perResource: ReportResourceRow[];
};

function bump(map: Map<number, ReportGroupRow>, key: number, label: string, hours: number, cost: CostBreakdown) {
  let row = map.get(key);
  if (!row) {
    row = { key: String(key), label, headcount: 0, capacityHours: 0, internal: 0, external: 0 };
    map.set(key, row);
  }
  row.headcount += 1;
  row.capacityHours += hours;
  row.internal += cost.internal;
  row.external += cost.external;
}

export function computeResourceReport(
  resources: readonly Resource[],
  roles: readonly Role[],
  disciplines: readonly Discipline[],
  grades: readonly Grade[],
  plan: ResourcePlan,
  absences: readonly Absence[],
  holidaySet: ReadonlySet<string>,
  workdayHours: number,
): ResourceReport {
  const periods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
  const perPeriod: ReportPeriodRow[] = periods.map((p) => ({ key: p.key, capacityHours: 0, internal: 0, external: 0, margin: 0 }));
  const perPeriodIdx = new Map(periods.map((p, i) => [p.key, i]));
  const discMap = new Map<number, ReportGroupRow>();
  const gradeMap = new Map<number, ReportGroupRow>();
  const comboMap = new Map<number, ReportGroupRow>();
  const perResource: ReportResourceRow[] = [];
  let totalCapacityHours = 0;
  let totalInternal = 0;
  let totalExternal = 0;

  for (const r of resources) {
    const resAbs = absencesForResource(absences, r);
    const role = roles.find((x) => x.id === r.roleId);
    let resHours = 0;
    let utilSum = 0;
    for (const p of periods) {
      const capH = displayCapacityHours(p, periods, r, resAbs, workdayHours, holidaySet, plan.granularity, plan.granularity);
      resHours += capH;
      utilSum += r.utilization[p.key] ?? 0;
      const cost = periodCost(capH, role);
      const idx = perPeriodIdx.get(p.key)!;
      perPeriod[idx].capacityHours += capH;
      perPeriod[idx].internal += cost.internal;
      perPeriod[idx].external += cost.external;
      perPeriod[idx].margin += cost.margin;
    }
    const resCost = periodCost(resHours, role);
    totalCapacityHours += resHours;
    totalInternal += resCost.internal;
    totalExternal += resCost.external;
    perResource.push({
      id: r.id,
      name: r.name,
      roleLabel: roleLabel(role, disciplines, grades),
      hasRole: !!role,
      avgUtilization: periods.length ? utilSum / periods.length : 0,
      capacityHours: resHours,
      internal: resCost.internal,
      external: resCost.external,
    });
    if (role) {
      bump(discMap, role.disciplineId, disciplines.find((d) => d.id === role.disciplineId)?.name ?? "?", resHours, resCost);
      bump(gradeMap, role.gradeId, grades.find((g) => g.id === role.gradeId)?.name ?? "?", resHours, resCost);
      bump(comboMap, role.id, roleLabel(role, disciplines, grades), resHours, resCost);
    }
  }

  const byLabel = (a: ReportGroupRow, b: ReportGroupRow) => a.label.localeCompare(b.label);
  return {
    totalCapacityHours,
    totalInternal,
    totalExternal,
    totalMargin: totalExternal - totalInternal,
    perPeriod,
    perDiscipline: Array.from(discMap.values()).sort(byLabel),
    perGrade: Array.from(gradeMap.values()).sort(byLabel),
    perCombo: Array.from(comboMap.values()).sort(byLabel),
    perResource,
  };
}
```

> `periodCost(resHours, role)` over the summed hours equals the sum of per-period costs (rate is constant), so per-resource and per-period totals reconcile.

- [ ] **Step 4: Run → PASS.** `npx vitest run src/app/resource-report.test.ts`.

- [ ] **Step 5: Commit.**
```bash
git add src/app/resource-report.ts src/app/resource-report.test.ts
git commit -m "feat(report): pure resource report aggregation"
```

---

## Task 2: Report panel (`resources-report.tsx`)

**Files:** Create `src/app/resources-report.tsx`, `src/app/resources-report.test.tsx`; Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: i18n** — add to BOTH dicts:

| key | en | de |
|-----|----|----|
| `resourcesReportTitle` | `"Resource report"` | `"Ressourcen-Bericht"` |
| `resourcesReportTotalCapacity` | `"Total capacity"` | `"Gesamtkapazität"` |
| `resourcesReportByPeriod` | `"By period"` | `"Nach Periode"` |
| `resourcesReportByDiscipline` | `"By discipline"` | `"Nach Disziplin"` |
| `resourcesReportByGrade` | `"By grade"` | `"Nach Stufe"` |
| `resourcesReportByCombo` | `"By role"` | `"Nach Rolle"` |
| `resourcesReportByResource` | `"By resource"` | `"Nach Ressource"` |
| `resourcesReportHeadcount` | `"People"` | `"Personen"` |
| `resourcesReportAvgUtil` | `"Avg util."` | `"Ø Auslastung"` |
| `resourcesReportEmpty` | `"No resources to report."` | `"Keine Ressourcen für den Bericht."` |
| `resourcesRole` | `"Role"` | `"Rolle"` |

(`resourcesInternalCost`, `resourcesExternalCost`, `resourcesMargin`, `resourcesCapacityDays`, `resourcesUnassignedRole`, `assignee` already exist — reuse them. Use the new `resourcesRole` for the per-resource table's role column to avoid depending on an uncertain `role` key.)

- [ ] **Step 2: Failing test** `src/app/resources-report.test.tsx`:

```tsx
import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResourcesReportPanel } from "./resources-report";
import type { Resource, Role, Discipline, Grade, ResourcePlan } from "./types";

const disciplines: Discipline[] = [{ id: 1, name: "Developer" }];
const grades: Grade[] = [{ id: 1, name: "Senior" }];
const roles: Role[] = [{ id: 5, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 }];
const plan: ResourcePlan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month", currency: "USD" };
const resources: Resource[] = [{ id: 1, name: "Sample", roleId: 5, utilizationMode: "percent", utilization: { "2026-02": 100 } }];

test("renders total internal cost and the resource row", () => {
  render(
    <ResourcesReportPanel lang="en-US" resources={resources} roles={roles}
      disciplines={disciplines} grades={grades} plan={plan} absences={[]}
      holidaySet={new Set()} workdayHours={8} />,
  );
  // total internal = 160h × $100 = $16,000
  expect(screen.getAllByText("$16,000").length).toBeGreaterThan(0);
  expect(screen.getByText("Sample")).toBeInTheDocument();
  expect(screen.getByText("Developer Senior")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run → FAIL.** `npx vitest run src/app/resources-report.test.tsx`.

- [ ] **Step 4: Implement** `src/app/resources-report.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { type Lang, t } from "./i18n";
import { computeResourceReport, type ReportGroupRow } from "./resource-report";
import { formatCurrency } from "./resource-cost";
import type { Absence, Discipline, Grade, Resource, ResourcePlan, Role } from "./types";

interface Props {
  lang: Lang;
  resources: readonly Resource[];
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  plan: ResourcePlan;
  absences: readonly Absence[];
  holidaySet: ReadonlySet<string>;
  workdayHours: number;
}

function localeFor(lang: Lang): string {
  if (lang === "de") return "de-DE";
  if (lang === "en-GB") return "en-GB";
  return "en-US";
}

export function ResourcesReportPanel({
  lang, resources, roles, disciplines, grades, plan, absences, holidaySet, workdayHours,
}: Props) {
  const rep = useMemo(
    () => computeResourceReport(resources, roles, disciplines, grades, plan, absences, holidaySet, workdayHours),
    [resources, roles, disciplines, grades, plan, absences, holidaySet, workdayHours],
  );
  const loc = localeFor(lang);
  const money = (n: number) => formatCurrency(n, plan.currency, loc);
  const days = (h: number) => (h / workdayHours).toFixed(1);

  if (resources.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-AIPM-light-grey p-10 text-center text-sm text-AIPM-medium-grey dark:border-zinc-800">
        {t(lang, "resourcesReportEmpty")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">{t(lang, "resourcesReportTitle")}</h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={t(lang, "resourcesReportTotalCapacity")} value={`${days(rep.totalCapacityHours)} d`} />
        <Tile label={t(lang, "resourcesInternalCost")} value={money(rep.totalInternal)} />
        <Tile label={t(lang, "resourcesExternalCost")} value={money(rep.totalExternal)} />
        <Tile label={t(lang, "resourcesMargin")} value={money(rep.totalMargin)} />
      </div>

      <Section title={t(lang, "resourcesReportByPeriod")}>
        <Table head={[t(lang, "resourcesReportByPeriod"), t(lang, "resourcesCapacityDays"), t(lang, "resourcesInternalCost"), t(lang, "resourcesExternalCost"), t(lang, "resourcesMargin")]}>
          {rep.perPeriod.map((p) => (
            <tr key={p.key}>
              <Td>{p.key}</Td><TdR>{days(p.capacityHours)}</TdR><TdR>{money(p.internal)}</TdR><TdR>{money(p.external)}</TdR><TdR>{money(p.margin)}</TdR>
            </tr>
          ))}
        </Table>
      </Section>

      <GroupSection title={t(lang, "resourcesReportByDiscipline")} rows={rep.perDiscipline} lang={lang} days={days} money={money} />
      <GroupSection title={t(lang, "resourcesReportByGrade")} rows={rep.perGrade} lang={lang} days={days} money={money} />
      <GroupSection title={t(lang, "resourcesReportByCombo")} rows={rep.perCombo} lang={lang} days={days} money={money} />

      <Section title={t(lang, "resourcesReportByResource")}>
        <Table head={[t(lang, "assignee"), t(lang, "resourcesRole"), t(lang, "resourcesReportAvgUtil"), t(lang, "resourcesCapacityDays"), t(lang, "resourcesInternalCost"), t(lang, "resourcesExternalCost")]}>
          {rep.perResource.map((r) => (
            <tr key={r.id}>
              <Td>{r.name}</Td>
              <Td>{r.hasRole ? r.roleLabel : <span className="italic text-AIPM-medium-grey">{t(lang, "resourcesUnassignedRole")}</span>}</Td>
              <TdR>{r.avgUtilization.toFixed(0)}</TdR>
              <TdR>{days(r.capacityHours)}</TdR>
              <TdR>{money(r.internal)}</TdR>
              <TdR>{money(r.external)}</TdR>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}

function GroupSection({ title, rows, lang, days, money }: {
  title: string; rows: ReportGroupRow[]; lang: Lang; days: (h: number) => string; money: (n: number) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <Section title={title}>
      <Table head={[title, t(lang, "resourcesReportHeadcount"), t(lang, "resourcesCapacityDays"), t(lang, "resourcesInternalCost"), t(lang, "resourcesExternalCost")]}>
        {rows.map((row) => (
          <tr key={row.key}>
            <Td>{row.label}</Td><TdR>{row.headcount}</TdR><TdR>{days(row.capacityHours)}</TdR><TdR>{money(row.internal)}</TdR><TdR>{money(row.external)}</TdR>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-AIPM-light-grey bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs uppercase tracking-wide text-AIPM-medium-grey">{label}</p>
      <p className="mt-1 text-xl font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey tabular-nums">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{title}</h3>
      {children}
    </div>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-AIPM-light-grey dark:border-zinc-800">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-AIPM-light-grey/50 uppercase tracking-wide text-AIPM-dark-grey dark:bg-zinc-900 dark:text-AIPM-medium-grey">
          <tr>{head.map((h, i) => <th key={i} className={`px-3 py-2 ${i === 0 ? "" : "text-right"}`}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-AIPM-light-grey dark:divide-zinc-800">{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">{children}</td>;
}
function TdR({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 text-right tabular-nums">{children}</td>;
}
```

> Uses existing i18n keys `assignee`, `resourcesCapacityDays`, `resourcesInternalCost`, `resourcesExternalCost`, `resourcesMargin`, `resourcesUnassignedRole` (Phases 1–4) plus the new `resourcesRole` + report keys from Step 1.

- [ ] **Step 5: Run → PASS.** `npx vitest run src/app/resources-report.test.tsx` + `npx tsc --noEmit` (only 2 known errors).

- [ ] **Step 6: Commit.**
```bash
git add src/app/resources-report.tsx src/app/resources-report.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(report): read-only resources report panel"
```

---

## Task 3: Pop-out wiring + "Report" button

**Files:** Modify `src/app/broadcast-sync.ts`, `src/app/workspace-tab-context.tsx`, `src/app/workspace-section.tsx`, `src/app/resources-panel.tsx`, `src/app/resources-panel.test.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`.

- [ ] **Step 1: i18n** — add `resourcesOpenReport` to both dicts (en `"Report"` / de `"Bericht"`).

- [ ] **Step 2: Register the popout target.**
- `broadcast-sync.ts`: add `"resource-report"` to the `POPOUT_TABS` array (after `"activity"`). This makes `readPopoutTabFromUrl()` accept `?popout=resource-report` and `openPopoutWindow("resource-report", …)` type-check.
- `workspace-tab-context.tsx`: add `"resource-report"` to the `TopTab` union so `activeTab` can hold it.

- [ ] **Step 3: Render the report panel in `workspace-section.tsx`.**
- Add a dynamic import next to the others: `const ResourcesReportPanel = dynamic(() => import("./resources-report").then((m) => m.ResourcesReportPanel), { ssr: false });`
- Destructure `roles, disciplines, grades, plan` from `useWorkspace()` (some already destructured for Phase 2/3 — add any missing) and use `settings` from `useSettings()` (already in scope).
- Render the panel when active (it only ever activates via the popout URL, so no tab-strip button needed):
  ```tsx
  {activeTab === "resource-report" && (
    <div id="panel-resource-report" role="tabpanel" className="min-h-0 flex-1 overflow-y-auto pt-4">
      <ResourcesReportPanel
        lang={lang} resources={resources} roles={roles} disciplines={disciplines}
        grades={grades} plan={plan} absences={absences} holidaySet={holidaySet}
        workdayHours={settings.resources.workdayHours} />
    </div>
  )}
  ```
- Provide the open-report callback to the Resources panel: pass `onOpenReport={() => openPopoutWindow("resource-report", settings.popout.reuseWindow)}` to `<ResourcesPanel … />` (`openPopoutWindow` is already imported in this file).

- [ ] **Step 4: "Report" button in `resources-panel.tsx`.**
Add `onOpenReport: () => void;` to `Props`; destructure it. In `renderHeader`, add a button next to "Manage roles":
```tsx
<button type="button" onClick={onOpenReport}
  className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800">
  {t(lang, "resourcesOpenReport")}
</button>
```

- [ ] **Step 5: Tests.**
- Add `onOpenReport: () => {}` to `resources-panel.test.tsx` `baseProps`, and a test:
```tsx
test("clicking Report calls onOpenReport", () => {
  const onOpenReport = vi.fn();
  render(<ResourcesPanel {...baseProps} resources={[]} onOpenReport={onOpenReport} />);
  fireEvent.click(screen.getByRole("button", { name: "Report" }));
  expect(onOpenReport).toHaveBeenCalled();
});
```
- No new required prop was added to `WorkspaceSectionProps` (the report callback is built inside `workspace-section`, not passed in), so `workspace-section.test.tsx` is unaffected — but run the full suite to confirm.

- [ ] **Step 6: Verify + commit.** `npx vitest run src/app/resources-panel.test.tsx` + `npx tsc --noEmit` (only 2 known errors) + `npm run test:run` (green).
```bash
git add src/app/broadcast-sync.ts src/app/workspace-tab-context.tsx src/app/workspace-section.tsx src/app/resources-panel.tsx src/app/resources-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(report): pop-out wiring + Report button"
```

---

## Final Verification

- [ ] `npm run test:run` — green (re-run `use-holiday-set.test.ts` alone if it's the sole failure).
- [ ] `npx tsc --noEmit` — only the 2 known pre-existing errors.
- [ ] Coverage: `npm run test:coverage` — `resource-report.ts` ≥ 80%.
- [ ] Smoke (`npm run dev`): Resources → "Report" opens a pop-out window showing summary tiles, per-period and per-discipline/grade/combo tables, and a per-resource table; figures match the Planning grid; editing utilization in the main window updates the pop-out live (BroadcastChannel sync of resources/roles); unassigned resources are flagged and excluded from the breakdowns.

---

## Self-Review

**Spec coverage (Phase 5 / Report Pop-out):** summary tiles (capacity days, internal, external, margin) ✓ (T2); per-period table ✓ (T1/T2); per-discipline / per-grade / per-combo breakdowns with headcount + capacity + cost ✓ (T1/T2); per-resource table (role, avg utilization, capacity, internal/external; unassigned flagged) ✓ (T1/T2); honors `plan.currency` ✓ (T2 `formatCurrency`); honors week/month granularity ✓ (T1 via `generatePeriods(plan.granularity)`); new `"resource-report"` popout target + `WorkspaceSection` render + Resources-tab "Report" button ✓ (T3). Live cross-window updates come free via the Phase-1 `useBroadcastSync` of `resources`/`roles` already wired in `use-storage-backend.ts`.

**Type consistency:** `computeResourceReport(resources, roles, disciplines, grades, plan, absences, holidaySet, workdayHours)` signature is identical in T1 (impl), its test, and the T2 panel call. `ReportGroupRow`/`ReportPeriodRow`/`ReportResourceRow`/`ResourceReport` shapes are used consistently between module and panel. `"resource-report"` is added to BOTH `POPOUT_TABS` (broadcast-sync) and `TopTab` (workspace-tab-context) so `activeTab === "resource-report"` type-checks.

**Placeholder scan:** none — full code provided. The panel test asserts a deterministic figure ($16,000 internal for 160h × $100). T2 adds its own `resourcesRole` key rather than depending on an uncertain pre-existing `role` key; all other reused keys (`assignee`, `resourcesCapacityDays`, cost keys, `resourcesUnassignedRole`) were added in Phases 1–4.

**Scope (YAGNI):** report is read-only (no editing); breakdowns exclude unassigned resources (no role → no discipline/grade/combo) while still counting their capacity in totals + per-resource — matches the spec's "unassigned-role resources flagged." No tab-strip button for the report (panel-launched only), avoiding a redundant top-level tab. The report reflects whatever canonical granularity the plan is set to (consistent with the Phase-3 grid).
