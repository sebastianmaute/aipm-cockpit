# Resource Cost Layer (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn capacity into money — compute internal/external cost and margin from a resource's role rates × capacity hours, and surface per-resource totals plus a grand-total footer in the Planning grid.

**Architecture:** A new **pure** `resource-cost.ts` provides `periodCost(capacityHours, role)` and a currency formatter; it depends only on types. The Planning grid in `resources-panel.tsx` already computes capacity per resource (Phase 3) — Phase 4 sums hours, looks up the resource's `Role` (already a prop), multiplies by rates, and renders internal/external/margin columns + a footer total, formatted with `plan.currency` and the panel's existing `localeFor(lang)`. No new handlers, no persistence, no wiring changes.

**Tech Stack:** TypeScript, React 19, Next.js 16, Vitest (jsdom) + Testing Library. Spec: `docs/superpowers/specs/2026-05-23-resource-utilization-design.md` (Cost Model section). Branch: `feat/resource-utilization`.

**Baseline:** 2 pre-existing `tsc` errors in test files (`settings-menu.test.tsx:18`, `use-due-alerts.test.ts:28`) — ignore; add none. `use-holiday-set.test.ts` is an occasional full-run flake — re-run alone if it's the sole failure.

---

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `src/app/resource-cost.ts` | Pure `periodCost` + `formatCurrency` | **New** |
| `src/app/resource-cost.test.ts` | Unit tests | **New** |
| `src/app/resources-panel.tsx` | Cost columns + footer total in the Planning grid | Modify |
| `src/app/resources-panel.test.tsx` | Grid cost test | Modify |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | New keys | Modify |

**Commands:** single file `npx vitest run src/app/<file>.test.ts`; full `npm run test:run`; types `npx tsc --noEmit`.

---

## Task 1: Pure cost module (`resource-cost.ts`)

**Files:** Create `src/app/resource-cost.ts`, `src/app/resource-cost.test.ts`.

- [ ] **Step 1: Write failing tests** `src/app/resource-cost.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { periodCost, formatCurrency } from "./resource-cost";
import type { Role } from "./types";

const role: Role = { id: 1, disciplineId: 1, gradeId: 1, internalRate: 142, externalRate: 200 };

describe("periodCost", () => {
  test("internal/external = hours × rate; margin = external − internal", () => {
    // Andre's 110.2h (Excel golden) at 142/200 per hour:
    expect(periodCost(110.2, role)).toEqual({
      internal: 110.2 * 142,   // 15648.4
      external: 110.2 * 200,   // 22040
      margin: 110.2 * 200 - 110.2 * 142, // 6391.6
    });
  });

  test("no role → all zero", () => {
    expect(periodCost(160, undefined)).toEqual({ internal: 0, external: 0, margin: 0 });
  });

  test("zero capacity → all zero", () => {
    expect(periodCost(0, role)).toEqual({ internal: 0, external: 0, margin: 0 });
  });
});

describe("formatCurrency", () => {
  test("formats with the given currency + locale (no fraction digits)", () => {
    expect(formatCurrency(16000, "USD", "en-US")).toBe("$16,000");
  });

  test("falls back to '<rounded> <currency>' on an invalid currency code", () => {
    // a non-ISO currency code makes Intl throw → fallback path
    expect(formatCurrency(1234.6, "NOTACURRENCY", "en-US")).toBe("1235 NOTACURRENCY");
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run src/app/resource-cost.test.ts` (module not found).

- [ ] **Step 3: Implement** `src/app/resource-cost.ts`:

```ts
import type { Role } from "./types";

export type CostBreakdown = { internal: number; external: number; margin: number };

/** Cost for a given capacity (hours) under a role's rates. No role → all zero. */
export function periodCost(capacityHours: number, role: Role | undefined): CostBreakdown {
  if (!role) return { internal: 0, external: 0, margin: 0 };
  const internal = capacityHours * role.internalRate;
  const external = capacityHours * role.externalRate;
  return { internal, external, margin: external - internal };
}

/** Format an amount as currency. Falls back to "<rounded> <code>" if Intl rejects the code. */
export function formatCurrency(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
}
```

> Note: `Intl.NumberFormat` throws `RangeError` for an invalid `currency` code (e.g. `"NOTACURRENCY"`), which the `catch` turns into the `"1235 NOTACURRENCY"` fallback. Node's full-ICU build formats `16000`/USD/en-US as `"$16,000"`.

- [ ] **Step 4: Run → PASS.** `npx vitest run src/app/resource-cost.test.ts`.

- [ ] **Step 5: Commit.**
```bash
git add src/app/resource-cost.ts src/app/resource-cost.test.ts
git commit -m "feat(cost): pure periodCost + currency formatter"
```

---

## Task 2: Cost columns + footer total in the Planning grid

**Files:** Modify `src/app/resources-panel.tsx`, `src/app/resources-panel.test.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`.

The Planning grid (`view === "planning"`) currently renders, per resource row: name + per-period utilization inputs + a `Capacity (days)` total. This adds three trailing columns — Internal / External / Margin — per row, and a footer row of grand totals.

- [ ] **Step 1: i18n** — add to BOTH `i18n.ts` and `i18n.de.ts`:

| key | en | de |
|-----|----|----|
| `resourcesInternalCost` | `"Internal"` | `"Intern"` |
| `resourcesExternalCost` | `"External"` | `"Extern"` |
| `resourcesMargin` | `"Margin"` | `"Marge"` |
| `resourcesTotal` | `"Total"` | `"Summe"` |

- [ ] **Step 2: Failing test** — append to `src/app/resources-panel.test.tsx`:

```tsx
test("planning view shows internal cost from the resource's role rate", () => {
  const roles = [{ id: 5, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 0 }];
  const resources = [{ id: 1, name: "Sample", roleId: 5, utilizationMode: "percent" as const, utilization: { "2026-02": 100 } }];
  const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "USD" };
  render(<ResourcesPanel {...baseProps} lang="en-US" resources={resources} roles={roles} plan={plan}
    workdayHours={8} holidaySet={new Set()}
    onSetUtilization={() => {}} onSetUtilizationMode={() => {}} onSetAbsenceOverride={() => {}}
    onSetPlanWindow={() => {}} onSetPlanGranularity={() => {}} />);
  fireEvent.click(screen.getByRole("radio", { name: "Planning" }));
  // Feb 2026 = 20 workdays × 8h = 160h; 100% util; internal = 160 × 100 = $16,000
  expect(screen.getByText("$16,000")).toBeInTheDocument();
});
```

> `baseProps` already carries `lang`; pass `lang="en-US"` and `holidaySet={new Set()}` explicitly here so the figure is deterministic. (If `baseProps` already sets these to compatible values, the explicit props simply reaffirm them.)

- [ ] **Step 3: Run → FAIL.** `npx vitest run src/app/resources-panel.test.tsx` (no `$16,000` yet).

- [ ] **Step 4: Implement** in `resources-panel.tsx`.

Add the import:
```ts
import { periodCost, formatCurrency } from "./resource-cost";
```
`localeFor(lang)` already exists in this file; `roles` and `plan` are already `Props`.

In the planning grid's `<thead>` row, after the `resourcesCapacityDays` header, add three headers:
```tsx
<th className="px-2 py-1.5 text-right">{t(lang, "resourcesInternalCost")}</th>
<th className="px-2 py-1.5 text-right">{t(lang, "resourcesExternalCost")}</th>
<th className="px-2 py-1.5 text-right">{t(lang, "resourcesMargin")}</th>
```

Replace the planning grid's `<tbody>…</tbody>` block with this IIFE that returns the `<tbody>` + a `<tfoot>` (the surrounding `<table>` and `<thead>` stay):

```tsx
{(() => {
  const loc = localeFor(lang);
  const totals = { days: 0, internal: 0, external: 0, margin: 0 };
  const rowsJsx = resources.map((r) => {
    const resAbs = absencesForResource(absences, r);
    const totalHours = periods.reduce((sum, p) =>
      sum + displayCapacityHours(p, periods, r, resAbs, workdayHours, holidaySet, plan.granularity, plan.granularity), 0);
    const role = roles.find((x) => x.id === r.roleId);
    const cost = periodCost(totalHours, role);
    totals.days += totalHours / workdayHours;
    totals.internal += cost.internal;
    totals.external += cost.external;
    totals.margin += cost.margin;
    return (
      <tr key={r.id}>
        <td className="px-2 py-1 font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">{r.name}</td>
        {periods.map((p) => (
          <td key={p.key} className="px-1 py-1 text-right">
            <input type="number" min={0} step={r.utilizationMode === "percent" ? 5 : 1}
              aria-label={`Utilization for ${r.name} in ${p.key}`}
              value={r.utilization[p.key] ?? ""}
              onChange={(e) => onSetUtilization(r.id, p.key, Number(e.target.value) || 0)}
              className="w-16 rounded border border-zinc-300 px-1 py-0.5 text-right tabular-nums dark:border-zinc-700 dark:bg-zinc-900" />
          </td>
        ))}
        <td className="px-2 py-1 text-right tabular-nums font-medium">{(totalHours / workdayHours).toFixed(1)}</td>
        <td className="px-2 py-1 text-right tabular-nums">{formatCurrency(cost.internal, plan.currency, loc)}</td>
        <td className="px-2 py-1 text-right tabular-nums">{formatCurrency(cost.external, plan.currency, loc)}</td>
        <td className="px-2 py-1 text-right tabular-nums">{formatCurrency(cost.margin, plan.currency, loc)}</td>
      </tr>
    );
  });
  return (
    <>
      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{rowsJsx}</tbody>
      <tfoot className="border-t border-zinc-300 dark:border-zinc-700">
        <tr className="font-semibold">
          <td className="px-2 py-1.5">{t(lang, "resourcesTotal")}</td>
          <td className="px-1 py-1.5" colSpan={periods.length} />
          <td className="px-2 py-1.5 text-right tabular-nums">{totals.days.toFixed(1)}</td>
          <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(totals.internal, plan.currency, loc)}</td>
          <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(totals.external, plan.currency, loc)}</td>
          <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(totals.margin, plan.currency, loc)}</td>
        </tr>
      </tfoot>
    </>
  );
})()}
```

Keep everything else (the date controls, the `<thead>` cells, the capacity-days column) intact.

- [ ] **Step 5: Run → PASS.** `npx vitest run src/app/resources-panel.test.tsx` + `npx tsc --noEmit` (only 2 known errors) + `npm run test:run` (green).

- [ ] **Step 6: Commit.**
```bash
git add src/app/resources-panel.tsx src/app/resources-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(cost): internal/external/margin columns + total in planning grid"
```

---

## Final Verification

- [ ] `npm run test:run` — green (re-run `use-holiday-set.test.ts` alone if it's the sole failure).
- [ ] `npx tsc --noEmit` — only the 2 known pre-existing errors.
- [ ] Coverage: `npm run test:coverage` — `resource-cost.ts` ≥ 80%.
- [ ] Smoke (`npm run dev`): Resources → Planning. Assign a resource a role (Phase 2) with non-zero rates; the row shows internal/external cost and margin in `plan.currency`; the footer totals sum across resources; an unassigned-role resource shows zero cost; changing utilization updates costs live.

---

## Self-Review

**Spec coverage (Phase 4 / Cost Model):** `internalCost = capacityHours × role.internalRate`, `externalCost = capacityHours × role.externalRate`, `margin = external − internal` ✓ (T1 `periodCost`); unassigned role contributes zero ✓ (T1); currency via `Intl.NumberFormat(locale, { currency })` with `plan.currency` ✓ (T1 `formatCurrency`, T2 wiring); per-resource totals + grand-total footer in the grid ✓ (T2). Per-discipline/grade/combo cost breakdowns are explicitly the **Phase 5 report**, not Phase 4 — not in scope here.

**Type consistency:** `periodCost(capacityHours: number, role: Role | undefined): CostBreakdown` and `formatCurrency(amount, currency, locale)` are used with identical signatures in T1 and T2. T2 reuses Phase-3 `displayCapacityHours`/`absencesForResource` and existing `localeFor`/`roles`/`plan` — no new props or handlers.

**Placeholder scan:** none — all code is complete. The grid test uses a deterministic figure (Feb 2026 = 20 workdays × 8h × 100% × $100 = $16,000) and `externalRate: 0` so `$16,000` is the unambiguous internal-cost cell.

**Scope (YAGNI):** Phase 4 adds only row + grand totals (the spec's "per-row/column totals" for the grid). Per-period column cost totals and the discipline/grade/combo rollups live in the Phase-5 report, not here. No memoization added (the grid's per-render cost math is the same order as Phase 3's capacity math — fine for realistic N; revisit only if profiling shows otherwise).
