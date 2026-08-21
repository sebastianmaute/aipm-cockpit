# Budget Planning Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each budget bucket a per-bucket "Detailed budget planning" toggle that switches between per-Role allocations (detailed, today's behavior) and per-Discipline allocations using a blended grade rate, plus per-bucket rate overrides, unit/tooltip-annotated entry fields, and a Budget section in the Reports view.

**Architecture:** A new pure module `budget-rates.ts` computes the blended discipline rate and resolves per-bucket overrides. `budget-report.ts` is refactored to build a uniform list of rate-bearing rows from either `allocations` (detailed) or `disciplineAllocations` (blended) and apply overrides, leaving all CCI math unchanged. The bucket modal gains the toggle (with a data-loss confirm), discipline rows, and override inputs; the budget panel renders the active table with unit suffixes + tooltips; the Reports view gains a filterable budget section.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, Tailwind, Vitest + React Testing Library.

**Reference spec:** `docs/superpowers/specs/2026-06-01-budget-planning-modes-design.md`

**Conventions for every task:**
- Run a single test file with: `npx vitest run src/app/<file>.test.ts` (or `.test.tsx`).
- Full gate before each commit: `npx vitest run && npx tsc --noEmit && npx eslint .`
- Commit messages: conventional commits, NO `Co-Authored-By` trailer (attribution disabled globally).
- `i18n.de.ts` must use ASCII straight quotes `"` only — never let any tool introduce curly quotes; grep to verify after editing.
- Do NOT edit `eslint.config.mjs` (hook-blocked). Use `Remove-Item` (PowerShell), never `rm -rf`.

---

### Task 1: Data model + `budget-rates.ts` pure module

**Files:**
- Modify: `src/app/types.ts` (after the `BudgetBucket` type, ~line 378)
- Create: `src/app/budget-rates.ts`
- Test: `src/app/budget-rates.test.ts`

- [ ] **Step 1: Add the new model types to `types.ts`**

Add `PLANNING_MODES`/`PlanningMode` and `DisciplineAllocation` immediately before the `export type BudgetBucket = {` block (around line 357):

```ts
export const PLANNING_MODES = ["detailed", "blended"] as const;
/** "detailed" = per-role (discipline×grade) allocations; "blended" = per-discipline
 *  allocations using the mixed average rate of that discipline's grades. */
export type PlanningMode = (typeof PLANNING_MODES)[number];

/** One discipline line within a blended-mode bucket. `resourceIds` feed the PLAN
 *  (their capacity), exactly like BucketAllocation; budget/actual hours are
 *  periodKey → hours maps aligned to the plan. */
export type DisciplineAllocation = {
  disciplineId: number;
  resourceIds: number[];
  budgetHours: Record<string, number>;
  actualHours: Record<string, number>;
};
```

Then add these optional fields inside the `BudgetBucket` type, just before `allocations: BucketAllocation[];`:

```ts
  /** Planning granularity. Absent ⇒ "detailed" (back-compat for existing buckets). */
  planningMode?: PlanningMode;
  /** Per-discipline allocations; consulted only when planningMode === "blended". */
  disciplineAllocations?: DisciplineAllocation[];
  /** Per-bucket rate overrides (plan currency, per hour). When finite and >= 0,
   *  override the role/blended rate for ALL rows in this bucket. */
  rateOverrideInternal?: number;
  rateOverrideExternal?: number;
```

- [ ] **Step 2: Write the failing test `src/app/budget-rates.test.ts`**

```ts
import { describe, expect, test } from "vitest";
import { blendedDisciplineRate, effectiveRates } from "./budget-rates";
import type { Role } from "./types";

const roles: Role[] = [
  { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
  { id: 2, disciplineId: 1, gradeId: 2, internalRate: 140, externalRate: 210 },
  { id: 3, disciplineId: 2, gradeId: 1, internalRate: 80, externalRate: 120 },
];

describe("blendedDisciplineRate", () => {
  test("averages internal and external rates across the discipline's roles", () => {
    expect(blendedDisciplineRate(1, roles)).toEqual({ internal: 120, external: 180 });
  });
  test("single-role discipline returns that role's rates", () => {
    expect(blendedDisciplineRate(2, roles)).toEqual({ internal: 80, external: 120 });
  });
  test("discipline with no roles returns zeros", () => {
    expect(blendedDisciplineRate(99, roles)).toEqual({ internal: 0, external: 0 });
  });
});

describe("effectiveRates", () => {
  const fallback = { internal: 100, external: 150 };
  test("blank overrides fall back", () => {
    expect(effectiveRates({}, fallback)).toEqual(fallback);
  });
  test("a finite >=0 override wins per field", () => {
    expect(effectiveRates({ rateOverrideInternal: 90 }, fallback)).toEqual({ internal: 90, external: 150 });
    expect(effectiveRates({ rateOverrideExternal: 200 }, fallback)).toEqual({ internal: 100, external: 200 });
  });
  test("zero is a valid override", () => {
    expect(effectiveRates({ rateOverrideInternal: 0 }, fallback)).toEqual({ internal: 0, external: 150 });
  });
  test("negative or NaN overrides are ignored", () => {
    expect(effectiveRates({ rateOverrideInternal: -5 }, fallback)).toEqual(fallback);
    expect(effectiveRates({ rateOverrideExternal: NaN }, fallback)).toEqual(fallback);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/app/budget-rates.test.ts`
Expected: FAIL — `budget-rates` module does not exist.

- [ ] **Step 4: Implement `src/app/budget-rates.ts`**

```ts
import type { BudgetBucket, Role } from "./types";

export type RatePair = { internal: number; external: number };

/** Unweighted mean of the internal/external rates of every Role whose
 *  disciplineId === id. Returns { internal: 0, external: 0 } when the discipline
 *  has no roles. */
export function blendedDisciplineRate(id: number, roles: readonly Role[]): RatePair {
  const matched = roles.filter((r) => r.disciplineId === id);
  if (matched.length === 0) return { internal: 0, external: 0 };
  const sum = matched.reduce(
    (acc, r) => ({ internal: acc.internal + r.internalRate, external: acc.external + r.externalRate }),
    { internal: 0, external: 0 },
  );
  return { internal: sum.internal / matched.length, external: sum.external / matched.length };
}

/** True when a per-bucket override field is usable (a finite number >= 0). */
function usable(v: number | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/** Effective rate for a row: each field uses the bucket override when usable,
 *  otherwise the fallback (role rate or blended discipline rate). */
export function effectiveRates(
  bucket: Pick<BudgetBucket, "rateOverrideInternal" | "rateOverrideExternal">,
  fallback: RatePair,
): RatePair {
  return {
    internal: usable(bucket.rateOverrideInternal) ? bucket.rateOverrideInternal : fallback.internal,
    external: usable(bucket.rateOverrideExternal) ? bucket.rateOverrideExternal : fallback.external,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/app/budget-rates.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Full gate + commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/types.ts src/app/budget-rates.ts src/app/budget-rates.test.ts
git commit -m "feat: add planning-mode model and budget-rates module"
```

---

### Task 2: Blended-mode support in the report engine

**Files:**
- Modify: `src/app/budget-report.ts` (`allocationPlannedHours` ~line 17; `computeBucketReport` ~lines 91-158)
- Test: `src/app/budget-report-blended.test.ts` (create)

- [ ] **Step 1: Write the failing test `src/app/budget-report-blended.test.ts`**

```ts
import { describe, expect, test } from "vitest";
import { computeBucketReport } from "./budget-report";
import type { ResourcePlan, Resource, Role, BudgetBucket } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-01-31", granularity: "month", currency: "EUR" };
// Discipline 1 has two grades: rates avg to internal 120, external 180.
const roles: Role[] = [
  { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
  { id: 2, disciplineId: 1, gradeId: 2, internalRate: 140, externalRate: 210 },
];
const resources: Resource[] = [];
const noHolidays = new Set<string>();

function blendedBucket(): BudgetBucket {
  return {
    id: 1, name: "Blend", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    planningMode: "blended",
    allocations: [],
    disciplineAllocations: [
      { disciplineId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } },
    ],
  };
}

describe("computeBucketReport — blended (discipline-only)", () => {
  test("uses the discipline's blended rate for cost and revenue", () => {
    const rep = computeBucketReport(blendedBucket(), plan, roles, resources, 8, noHolidays);
    expect(rep.budgetHours).toBe(100);
    expect(rep.actualHours).toBe(80);
    expect(rep.cost).toBe(80 * 120);     // blended internal
    expect(rep.revenue).toBe(80 * 180);  // blended external
  });

  test("a per-bucket override replaces both blended rates", () => {
    const b: BudgetBucket = { ...blendedBucket(), rateOverrideInternal: 90, rateOverrideExternal: 200 };
    const rep = computeBucketReport(b, plan, roles, resources, 8, noHolidays);
    expect(rep.cost).toBe(80 * 90);
    expect(rep.revenue).toBe(80 * 200);
  });
});

describe("computeBucketReport — override in detailed mode", () => {
  test("override replaces role rates", () => {
    const b: BudgetBucket = {
      id: 2, name: "Det", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      rateOverrideInternal: 50, rateOverrideExternal: 75,
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } }],
    };
    const rep = computeBucketReport(b, plan, roles, resources, 8, noHolidays);
    expect(rep.cost).toBe(10 * 50);
    expect(rep.revenue).toBe(10 * 75);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/budget-report-blended.test.ts`
Expected: FAIL — blended bucket reports zero cost/revenue (engine ignores `disciplineAllocations` and overrides).

- [ ] **Step 3: Widen `allocationPlannedHours` to accept any row with `resourceIds`**

In `src/app/budget-report.ts`, change the first parameter type of `allocationPlannedHours` from `alloc: BucketAllocation` to:

```ts
  alloc: { resourceIds: readonly number[] },
```

(The function body only reads `alloc.resourceIds`, so this is a safe widening that lets blended rows reuse it.)

- [ ] **Step 4: Add imports and a row-builder, then drive the loop from rows**

At the top of `budget-report.ts`, extend the imports:

```ts
import { blendedDisciplineRate, effectiveRates, type RatePair } from "./budget-rates";
```

Add this helper above `computeBucketReport`:

```ts
type RateRow = {
  rates: RatePair;
  budgetHours: Record<string, number>;
  actualHours: Record<string, number>;
  resourceIds: number[];
};

/** Uniform rate-bearing rows for a bucket: from disciplineAllocations (blended)
 *  or allocations (detailed). Each row's rate honors the per-bucket override. */
function bucketRateRows(bucket: BudgetBucket, roles: readonly Role[]): RateRow[] {
  if (bucket.planningMode === "blended") {
    return (bucket.disciplineAllocations ?? []).map((a) => ({
      rates: effectiveRates(bucket, blendedDisciplineRate(a.disciplineId, roles)),
      budgetHours: a.budgetHours,
      actualHours: a.actualHours,
      resourceIds: a.resourceIds,
    }));
  }
  return bucket.allocations.map((a) => {
    const role = roleFor(a.roleId, roles);
    return {
      rates: effectiveRates(bucket, { internal: role?.internalRate ?? 0, external: role?.externalRate ?? 0 }),
      budgetHours: a.budgetHours,
      actualHours: a.actualHours,
      resourceIds: a.resourceIds,
    };
  });
}
```

In `computeBucketReport`, replace the `for (const alloc of bucket.allocations) { ... }` block (lines ~113-128) with a loop over rows:

```ts
  const rows = bucketRateRows(bucket, roles);
  for (const row of rows) {
    const { internal, external } = row.rates;
    const aBudget = sumPeriodMap(row.budgetHours, keys);
    const aActual = sumPeriodMap(row.actualHours, keys);
    budgetHours += aBudget;
    actualHours += aActual;
    cost += aActual * internal;
    tmRevenue += aActual * external;
    budgetValueExternal += aBudget * external;
    budgetCost += aBudget * internal;
    for (const p of periods) {
      plannedHours += allocationPlannedHours(row, p, periods, resources, workdayHours, holidaySet, plan.granularity, absences);
    }
  }
```

Everything below (fixedPrice, revenue, budgetValue, winLoss, CCI returns) stays exactly as-is.

- [ ] **Step 5: Run both blended and existing budget tests to verify pass**

Run: `npx vitest run src/app/budget-report-blended.test.ts src/app/budget-report-bucket.test.ts src/app/budget-report-project.test.ts src/app/budget-report.test.ts`
Expected: PASS — new blended/override tests pass AND all pre-existing detailed-mode tests still pass (back-compat: buckets without `planningMode` take the `allocations` branch).

- [ ] **Step 6: Full gate + commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/budget-report.ts src/app/budget-report-blended.test.ts
git commit -m "feat: compute blended discipline budgets and per-bucket rate overrides"
```

---

### Task 3: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts` (English map; new budget + reports keys near the existing `budget*` keys ~line 237 and `reports*` keys)
- Modify: `src/app/i18n.de.ts` (matching German keys)

- [ ] **Step 1: Add the English keys to `i18n.ts`**

Insert near the other `budget*` keys (after `budgetFxOverrideInvalid`, ~line 246):

```ts
  budgetDetailedPlanning: "Detailed budget planning",
  budgetDetailedPlanningHint: "On: plan per role (discipline and grade). Off: plan per discipline using the average rate of that discipline's grades.",
  budgetModeDetailed: "Detailed",
  budgetModeBlended: "Blended",
  budgetSwitchToBlendedWarn: "Switching off detailed planning discards the hours entered per role for this bucket. Continue?",
  budgetRateOverrideInternal: "Internal rate override",
  budgetRateOverrideExternal: "External rate override",
  budgetRateOverrideHint: "Overrides the role or blended rate for every line in this bucket. Leave blank to use the computed rate.",
  budgetRateOverrideInvalid: "Rate overrides must be zero or greater.",
  budgetUnitHours: "h",
  budgetUnitPerHour: "EUR/h",
  budgetAddDiscipline: "Add discipline",
  budgetRemoveDiscipline: "Remove discipline",
  budgetNoDisciplinesLeft: "All disciplines are already allocated.",
  budgetBudgetHoursHint: "Budgeted hours for this period.",
  budgetActualHoursHint: "Actual booked hours for this period.",
```

Insert near the other `reports*` keys:

```ts
  reportsBudget: "Budget",
  reportsBudgetAllBuckets: "All buckets",
  reportsBudgetFilterBucket: "Bucket",
  reportsBudgetMinTotal: "Min total budget",
  reportsBudgetTotal: "Total budget",
  reportsBudgetUsed: "Used",
  reportsBudgetFree: "Free",
  reportsBudgetHours: "Budget (h)",
  reportsBudgetBucketCol: "Bucket",
  reportsBudgetPlanHours: "Plan (h)",
  reportsBudgetUsedHours: "Used (h)",
  reportsBudgetBudgetEur: "Budget (EUR)",
  reportsBudgetEmpty: "No budget buckets yet.",
```

- [ ] **Step 2: Add the matching German keys to `i18n.de.ts` (ASCII straight quotes only)**

```ts
  budgetDetailedPlanning: "Detaillierte Budgetplanung",
  budgetDetailedPlanningHint: "An: Planung je Rolle (Disziplin und Stufe). Aus: Planung je Disziplin mit dem Durchschnittssatz der Stufen dieser Disziplin.",
  budgetModeDetailed: "Detailliert",
  budgetModeBlended: "Gemischt",
  budgetSwitchToBlendedWarn: "Beim Abschalten der detaillierten Planung gehen die je Rolle erfassten Stunden dieses Buckets verloren. Fortfahren?",
  budgetRateOverrideInternal: "Interner Satz (Override)",
  budgetRateOverrideExternal: "Externer Satz (Override)",
  budgetRateOverrideHint: "Ueberschreibt den Rollen- oder Mischsatz fuer alle Zeilen dieses Buckets. Leer lassen, um den berechneten Satz zu verwenden.",
  budgetRateOverrideInvalid: "Satz-Overrides muessen null oder groesser sein.",
  budgetUnitHours: "h",
  budgetUnitPerHour: "EUR/h",
  budgetAddDiscipline: "Disziplin hinzufuegen",
  budgetRemoveDiscipline: "Disziplin entfernen",
  budgetNoDisciplinesLeft: "Alle Disziplinen sind bereits zugeordnet.",
  budgetBudgetHoursHint: "Budgetierte Stunden fuer diesen Zeitraum.",
  budgetActualHoursHint: "Tatsaechlich gebuchte Stunden fuer diesen Zeitraum.",
  reportsBudget: "Budget",
  reportsBudgetAllBuckets: "Alle Buckets",
  reportsBudgetFilterBucket: "Bucket",
  reportsBudgetMinTotal: "Min. Gesamtbudget",
  reportsBudgetTotal: "Gesamtbudget",
  reportsBudgetUsed: "Verbraucht",
  reportsBudgetFree: "Frei",
  reportsBudgetHours: "Budget (h)",
  reportsBudgetBucketCol: "Bucket",
  reportsBudgetPlanHours: "Plan (h)",
  reportsBudgetUsedHours: "Verbraucht (h)",
  reportsBudgetBudgetEur: "Budget (EUR)",
  reportsBudgetEmpty: "Noch keine Budget-Buckets.",
```

(German avoids umlauts/embedded quotes deliberately to dodge the known `i18n.de.ts` curly-quote corruption — keep ASCII as written.)

- [ ] **Step 3: Verify no curly quotes were introduced and EN/DE keys match**

Run: `npx tsc --noEmit`
Expected: PASS (if a key exists in one map's type but not the other, tsc fails — confirms parity).
Then grep for stray smart quotes:
Run (PowerShell): `Select-String -Path src/app/i18n.de.ts -Pattern '[“”‘’]'`
Expected: no matches.

- [ ] **Step 4: Run any i18n tests + commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: add i18n strings for budget planning modes and budget report"
```

---

### Task 4: Bucket modal — toggle, discipline rows, override inputs

**Files:**
- Modify: `src/app/budget-bucket-modal.tsx`
- Test: `src/app/budget-bucket-modal.test.tsx`

**Context:** `BudgetBucketModal` holds a `draft` `BudgetBucket` in state and emits it via `onSave`. It already renders role allocations and a "+ Add role" combobox. We add the planning-mode toggle, discipline rows for blended mode, and two override inputs. `SegmentedControl` is already imported. The modal receives `disciplines: readonly Discipline[]`.

- [ ] **Step 1: Write the failing tests (append to `budget-bucket-modal.test.tsx`)**

Add `disciplines` to the test fixture and these tests inside the `describe`:

```ts
const disciplines = [
  { id: 1, name: "Consulting" },
  { id: 2, name: "Development" },
];

test("blended bucket shows discipline rows and can add one", () => {
  const { onSave } = setup({
    disciplines,
    bucket: { ...baseBucket, planningMode: "blended", disciplineAllocations: [] },
  });
  fireEvent.change(screen.getByRole("combobox", { name: /add discipline/i }), {
    target: { value: "2" },
  });
  fireEvent.click(screen.getByRole("button", { name: /\+ add discipline/i }));
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
  const saved = onSave.mock.calls[0][0] as BudgetBucket;
  expect(saved.disciplineAllocations).toEqual([
    { disciplineId: 2, resourceIds: [], budgetHours: {}, actualHours: {} },
  ]);
});

test("turning off detailed planning with entered hours warns and clears them on confirm", () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  const { onSave } = setup({
    disciplines,
    bucket: {
      ...baseBucket,
      planningMode: "detailed",
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: {} }],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: /detailed budget planning/i }));
  expect(confirmSpy).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
  const saved = onSave.mock.calls[0][0] as BudgetBucket;
  expect(saved.planningMode).toBe("blended");
  expect(saved.allocations[0].budgetHours).toEqual({});
  confirmSpy.mockRestore();
});

test("cancelling the warning keeps detailed mode", () => {
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
  const { onSave } = setup({
    disciplines,
    bucket: {
      ...baseBucket,
      planningMode: "detailed",
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: {} }],
    },
  });
  fireEvent.click(screen.getByRole("button", { name: /detailed budget planning/i }));
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
  const saved = onSave.mock.calls[0][0] as BudgetBucket;
  expect(saved.planningMode ?? "detailed").toBe("detailed");
  expect(saved.allocations[0].budgetHours).toEqual({ "2026-01": 40 });
  confirmSpy.mockRestore();
});

test("negative internal rate override blocks save", () => {
  const { onSave } = setup({ disciplines });
  fireEvent.change(screen.getByLabelText(/internal rate override/i), { target: { value: "-1" } });
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByText(/zero or greater/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/budget-bucket-modal.test.tsx`
Expected: FAIL — no toggle/discipline/override controls yet.

- [ ] **Step 3: Add imports and helpers in `budget-bucket-modal.tsx`**

Extend the type import to include `DisciplineAllocation` and `PlanningMode`:

```ts
import {
  BUDGET_TYPES,
  SUPPORTED_CURRENCIES,
  type BudgetBucket,
  type BudgetCurrency,
  type DisciplineAllocation,
  type Discipline,
  type Grade,
  type PlanningMode,
  type Resource,
  type Role,
} from "./types";
```

Add a `disciplineToAdd` state next to `roleToAdd`:

```ts
  const [disciplineToAdd, setDisciplineToAdd] = useState<string>("");
```

Add a helper near the top of the component that detects entered detailed hours:

```ts
  const isBlended = draft.planningMode === "blended";
  const hasDetailedHours = draft.allocations.some(
    (a) => Object.keys(a.budgetHours).length > 0 || Object.keys(a.actualHours).length > 0,
  );

  const togglePlanningMode = () => {
    if (!isBlended) {
      // detailed -> blended: warn + clear entered hours when present.
      if (hasDetailedHours && !window.confirm(t(lang, "budgetSwitchToBlendedWarn"))) return;
      setDraft((d) => ({
        ...d,
        planningMode: "blended" as PlanningMode,
        allocations: d.allocations.map((a) => ({ ...a, budgetHours: {}, actualHours: {} })),
        disciplineAllocations: d.disciplineAllocations ?? [],
      }));
    } else {
      setDraft((d) => ({ ...d, planningMode: "detailed" as PlanningMode }));
    }
  };

  const allocatedDisciplineIds = new Set((draft.disciplineAllocations ?? []).map((a) => a.disciplineId));
  const addableDisciplines = disciplines.filter((x) => !allocatedDisciplineIds.has(x.id));

  const addDiscipline = () => {
    const id = Number(disciplineToAdd);
    if (!id || allocatedDisciplineIds.has(id)) return;
    setDraft((d) => ({
      ...d,
      disciplineAllocations: [
        ...(d.disciplineAllocations ?? []),
        { disciplineId: id, resourceIds: [], budgetHours: {}, actualHours: {} } satisfies DisciplineAllocation,
      ],
    }));
    setDisciplineToAdd("");
  };

  const removeDiscipline = (disciplineId: number) =>
    setDraft((d) => ({
      ...d,
      disciplineAllocations: (d.disciplineAllocations ?? []).filter((a) => a.disciplineId !== disciplineId),
    }));
```

- [ ] **Step 4: Add override validation in `save()`**

Inside `save()`, before the final `onSave(...)`, add:

```ts
    const badOverride = (v: number | undefined) => v != null && (!Number.isFinite(v) || v < 0);
    if (badOverride(draft.rateOverrideInternal) || badOverride(draft.rateOverrideExternal)) {
      return setError(t(lang, "budgetRateOverrideInvalid"));
    }
```

- [ ] **Step 5: Render the toggle, override inputs, and the discipline section**

Add the toggle near the Type control (inside the `grid` of fields), as its own labelled block:

```tsx
          {/* Planning mode toggle */}
          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span>{t(lang, "budgetDetailedPlanning")}</span>
            <button
              type="button"
              onClick={togglePlanningMode}
              aria-pressed={!isBlended}
              title={t(lang, "budgetDetailedPlanningHint")}
              className={`w-fit rounded-md border px-3 py-1.5 text-xs font-medium ${
                !isBlended
                  ? "border-AIPM-dark-blue bg-AIPM-dark-blue text-white"
                  : "border-line bg-surface text-foreground hover:bg-surface-muted"
              }`}
            >
              {t(lang, !isBlended ? "budgetModeDetailed" : "budgetModeBlended")}
            </button>
            <span className="text-xs text-muted-foreground">{t(lang, "budgetDetailedPlanningHint")}</span>
          </div>

          {/* Rate overrides */}
          <label className="flex flex-col gap-1 text-sm">
            <span>{t(lang, "budgetRateOverrideInternal")}</span>
            <div className="flex items-center gap-1">
              <input
                className={inputClass}
                type="number"
                min={0}
                step="0.01"
                aria-label={t(lang, "budgetRateOverrideInternal")}
                title={t(lang, "budgetRateOverrideHint")}
                value={draft.rateOverrideInternal ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, rateOverrideInternal: e.target.value === "" ? undefined : Number(e.target.value) }))
                }
              />
              <span className="text-xs text-muted-foreground">{t(lang, "budgetUnitPerHour")}</span>
            </div>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t(lang, "budgetRateOverrideExternal")}</span>
            <div className="flex items-center gap-1">
              <input
                className={inputClass}
                type="number"
                min={0}
                step="0.01"
                aria-label={t(lang, "budgetRateOverrideExternal")}
                title={t(lang, "budgetRateOverrideHint")}
                value={draft.rateOverrideExternal ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, rateOverrideExternal: e.target.value === "" ? undefined : Number(e.target.value) }))
                }
              />
              <span className="text-xs text-muted-foreground">{t(lang, "budgetUnitPerHour")}</span>
            </div>
          </label>
```

Wrap the existing **role allocations** block so it renders only in detailed mode: change its container to `{!isBlended && ( <div className="flex flex-col gap-2 text-sm sm:col-span-2"> ... existing role UI ... </div> )}`.

Add the **discipline allocations** block (blended mode), modelled on the role block:

```tsx
          {isBlended && (
            <div className="flex flex-col gap-2 text-sm sm:col-span-2">
              <span className="font-medium">{t(lang, "budgetModeBlended")}</span>
              {(draft.disciplineAllocations ?? []).map((a) => (
                <div key={a.disciplineId} className="rounded-md border border-line p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {disciplines.find((x) => x.id === a.disciplineId)?.name ?? `#${a.disciplineId}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeDiscipline(a.disciplineId)}
                      className="rounded-md border border-transparent px-2 py-0.5 text-xs text-muted-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted"
                    >
                      {t(lang, "budgetRemoveDiscipline")}
                    </button>
                  </div>
                  {resources.length > 0 && (
                    <div className="mt-1">
                      <div className="text-xs text-muted-foreground">{t(lang, "budgetResources")}</div>
                      <div className="flex flex-wrap gap-2">
                        {resources.map((r) => (
                          <label key={r.id} className="flex items-center gap-1 text-xs">
                            <input
                              type="checkbox"
                              checked={a.resourceIds.includes(r.id)}
                              onChange={() =>
                                setDraft((d) => ({
                                  ...d,
                                  disciplineAllocations: (d.disciplineAllocations ?? []).map((x) =>
                                    x.disciplineId !== a.disciplineId
                                      ? x
                                      : {
                                          ...x,
                                          resourceIds: x.resourceIds.includes(r.id)
                                            ? x.resourceIds.filter((rid) => rid !== r.id)
                                            : [...x.resourceIds, r.id],
                                        },
                                  ),
                                }))
                              }
                            />
                            {resourceDisplayName(r)}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-2">
                <select
                  className={`${inputClass} flex-1`}
                  value={disciplineToAdd}
                  onChange={(e) => setDisciplineToAdd(e.target.value)}
                  disabled={addableDisciplines.length === 0}
                  aria-label={t(lang, "budgetAddDiscipline")}
                >
                  <option value="">{addableDisciplines.length === 0 ? t(lang, "budgetNoDisciplinesLeft") : "—"}</option>
                  {addableDisciplines.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addDiscipline}
                  disabled={disciplineToAdd === ""}
                  className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 disabled:opacity-50"
                >
                  + {t(lang, "budgetAddDiscipline")}
                </button>
              </div>
            </div>
          )}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/app/budget-bucket-modal.test.tsx`
Expected: PASS (existing + 4 new tests).

- [ ] **Step 7: Full gate + commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/budget-bucket-modal.tsx src/app/budget-bucket-modal.test.tsx
git commit -m "feat: planning-mode toggle, discipline rows, and rate overrides in bucket modal"
```

---

### Task 5: Budget panel — render active table with units + tooltips

**Files:**
- Modify: `src/app/budget-panel.tsx`
- Test: `src/app/budget-panel-edit.test.tsx`

**Context:** The panel maps `report.buckets` to cards; each card renders a `<table>` over `bucket.allocations`. We add a discipline-mode table, a `setDisciplineCell` updater, unit suffixes + tooltips on the hour inputs, and a mode badge. `bucketActivePeriods`, `roleLabel`, `TABLE_HEAD_CLASS` already imported.

- [ ] **Step 1: Write the failing test (append to `budget-panel-edit.test.tsx`)**

Add a test that a blended bucket renders a discipline row and edits a discipline cell. Use the existing test's prop builder; add `disciplines` with `{ id: 1, name: "Consulting" }` and a blended bucket:

```ts
test("blended bucket renders discipline rows and edits a discipline cell", () => {
  const onChangeBuckets = vi.fn();
  const blended: BudgetBucket = {
    id: 1, name: "Blend", type: "tm", currency: "EUR",
    startDate: plan.startDate, endDate: plan.endDate, status: "open",
    planningMode: "blended", allocations: [],
    disciplineAllocations: [{ disciplineId: 1, resourceIds: [], budgetHours: {}, actualHours: {} }],
  };
  render(<BudgetPanel {...props} buckets={[blended]} disciplines={[{ id: 1, name: "Consulting" }]} onChangeBuckets={onChangeBuckets} />);
  const input = screen.getByLabelText("budget-1-d1-2026-01");
  fireEvent.change(input, { target: { value: "50" } });
  const saved = onChangeBuckets.mock.calls[0][0] as BudgetBucket[];
  expect(saved[0].disciplineAllocations![0].budgetHours["2026-01"]).toBe(50);
});
```

(Adjust the `2026-01` period key to match the test plan's granularity/period; if the existing fixture uses a different first period key, use that key in both the `getByLabelText` and the assertion.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/budget-panel-edit.test.tsx`
Expected: FAIL — blended buckets render no discipline rows / no `budget-1-d1-...` input.

- [ ] **Step 3: Add a `setDisciplineCell` updater**

In `budget-panel.tsx`, next to `setCell`, add:

```ts
  const setDisciplineCell = (
    bucketId: number, disciplineId: number, periodKey: string,
    field: "budgetHours" | "actualHours", value: number,
  ) => {
    props.onChangeBuckets(
      buckets.map((b) => {
        if (b.id !== bucketId) return b;
        const disciplineAllocations = (b.disciplineAllocations ?? []).map((a) =>
          a.disciplineId === disciplineId ? { ...a, [field]: { ...a[field], [periodKey]: value } } : a,
        );
        return { ...b, disciplineAllocations, localModifiedAt: stamp() };
      }),
    );
  };
```

- [ ] **Step 4: Render a discipline table when blended, and add a units/tooltip cell helper**

Add a small inline component near the top of the file (module scope, after `BUDGET_COL_WIDTHS`) to keep the hour-input markup DRY across both tables:

```tsx
function HoursCell({
  ariaPrefix, budget, actual, onBudget, onActual, hLabel, budgetHint, actualHint,
}: {
  ariaPrefix: string;
  budget: number | undefined;
  actual: number | undefined;
  onBudget: (v: number) => void;
  onActual: (v: number) => void;
  hLabel: string;
  budgetHint: string;
  actualHint: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <input
          aria-label={`budget-${ariaPrefix}`}
          title={budgetHint}
          type="number"
          value={budget ?? ""}
          onChange={(e) => onBudget(Number(e.target.value) || 0)}
          className="w-16 rounded border border-line bg-surface px-1 text-right"
        />
        <span className="text-[10px] text-muted-foreground">{hLabel}</span>
      </div>
      <div className="flex items-center gap-1">
        <input
          aria-label={`actual-${ariaPrefix}`}
          title={actualHint}
          type="number"
          value={actual ?? ""}
          onChange={(e) => onActual(Number(e.target.value) || 0)}
          className="w-16 rounded border border-line bg-surface-muted px-1 text-right"
        />
        <span className="text-[10px] text-muted-foreground">{hLabel}</span>
      </div>
    </div>
  );
}
```

In the card body, replace the existing `<tbody>` rows with a branch on mode. Detailed mode keeps role rows but uses `HoursCell`; blended mode maps `bucket.disciplineAllocations`. Define `const isBlended = bucket.planningMode === "blended";` inside the `report.buckets.map` callback, then:

```tsx
                  <tbody>
                    {!isBlended && bucket.allocations.map((a) => (
                      <tr key={a.roleId} className="border-t border-line">
                        <td className="px-2 py-1">{roleLabel(roles.find((r) => r.id === a.roleId), props.disciplines, props.grades) || `#${a.roleId}`}</td>
                        {bucketActivePeriods(bucket, plan).map((p) => (
                          <td key={p.key} className="px-1 py-1">
                            <HoursCell
                              ariaPrefix={`${bucket.id}-${a.roleId}-${p.key}`}
                              budget={a.budgetHours[p.key]}
                              actual={a.actualHours[p.key]}
                              onBudget={(v) => setCell(bucket.id, a.roleId, p.key, "budgetHours", v)}
                              onActual={(v) => setCell(bucket.id, a.roleId, p.key, "actualHours", v)}
                              hLabel={t(lang, "budgetUnitHours")}
                              budgetHint={t(lang, "budgetBudgetHoursHint")}
                              actualHint={t(lang, "budgetActualHoursHint")}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                    {isBlended && (bucket.disciplineAllocations ?? []).map((a) => (
                      <tr key={a.disciplineId} className="border-t border-line">
                        <td className="px-2 py-1">{props.disciplines.find((d) => d.id === a.disciplineId)?.name || `#${a.disciplineId}`}</td>
                        {bucketActivePeriods(bucket, plan).map((p) => (
                          <td key={p.key} className="px-1 py-1">
                            <HoursCell
                              ariaPrefix={`${bucket.id}-d${a.disciplineId}-${p.key}`}
                              budget={a.budgetHours[p.key]}
                              actual={a.actualHours[p.key]}
                              onBudget={(v) => setDisciplineCell(bucket.id, a.disciplineId, p.key, "budgetHours", v)}
                              onActual={(v) => setDisciplineCell(bucket.id, a.disciplineId, p.key, "actualHours", v)}
                              hLabel={t(lang, "budgetUnitHours")}
                              budgetHint={t(lang, "budgetBudgetHoursHint")}
                              actualHint={t(lang, "budgetActualHoursHint")}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
```

Also add a mode badge into the card header type line (where it shows type · currency, ~line 253): append `{" · "}{t(lang, isBlended ? "budgetModeBlended" : "budgetModeDetailed")}`.

The "Role" header cell label should switch to the discipline header in blended mode — change the role `<th>` label to `{t(lang, isBlended ? "budgetModeBlended" : "budgetRole")}` (keep it simple; the column lists disciplines in blended mode).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/app/budget-panel-edit.test.tsx src/app/budget-panel.test.tsx`
Expected: PASS — blended discipline cell edits propagate; detailed tests still pass (aria labels `budget-<id>-<roleId>-<key>` unchanged).

- [ ] **Step 6: Full gate + commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/budget-panel.tsx src/app/budget-panel-edit.test.tsx
git commit -m "feat: render blended discipline table with unit suffixes and tooltips in budget panel"
```

---

### Task 6: Reports view — Budget section with filters

**Files:**
- Modify: `src/app/reports.tsx`
- Modify: `src/app/workspace-section.tsx` (the `<ReportsPanel ... />` call ~line 352)
- Test: `src/app/reports.test.tsx`

**Context:** `ReportsPanel` currently takes `{ tasks, today, holidaySet, lang }`. We extend its props with budget data and render a new Budget `<Section>`. At the call site, `buckets`, `plan`, `roles`, `disciplines`, `grades`, `resources`, `absences`, `holidaySet`, `settings`, `fxRates` are all in scope.

- [ ] **Step 1: Write the failing test (append to `reports.test.tsx`)**

```ts
import type { BudgetBucket, ResourcePlan, Role, Resource } from "./types";

const budgetPlan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-01-31", granularity: "month", currency: "EUR" };
const budgetRoles: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
const budgetBuckets: BudgetBucket[] = [
  { id: 1, name: "Alpha", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 40 } }] },
  { id: 2, name: "Beta", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 0 } }] },
];

function renderWithBudget(extra = {}) {
  return render(
    <ReportsPanel
      tasks={[{ id: 1, taskName: "T", assignee: "A", priority: "Low", status: "green" } as never]}
      today="2026-01-15"
      holidaySet={new Set<string>()}
      lang="en-US"
      buckets={budgetBuckets}
      plan={budgetPlan}
      roles={budgetRoles}
      disciplines={[{ id: 1, name: "Consulting" }]}
      grades={[{ id: 1, name: "Junior" }]}
      resources={[] as Resource[]}
      absences={[]}
      workdayHours={8}
      {...extra}
    />,
  );
}

test("budget section shows a row per bucket and a total rollup", () => {
  renderWithBudget();
  expect(screen.getByText("Alpha")).toBeInTheDocument();
  expect(screen.getByText("Beta")).toBeInTheDocument();
  // total budget = 100*150 + 10*150 = 16500
  expect(screen.getByText(/16,500|16.500/)).toBeInTheDocument();
});

test("min total-budget filter drops small buckets", () => {
  renderWithBudget();
  fireEvent.change(screen.getByLabelText(/min total budget/i), { target: { value: "5000" } });
  expect(screen.getByText("Alpha")).toBeInTheDocument();   // 15000 >= 5000
  expect(screen.queryByText("Beta")).not.toBeInTheDocument(); // 1500 < 5000
});
```

(If `reports.test.tsx` lacks `fireEvent`, add it to the `@testing-library/react` import.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/reports.test.tsx`
Expected: FAIL — `ReportsPanel` doesn't accept budget props / renders no budget section.

- [ ] **Step 3: Extend imports and props in `reports.tsx`**

Add two new imports at the top (leave the existing `import { type Priority, PRIORITIES, type Task } from "./types";` line untouched):

```ts
import { computeBudgetReport } from "./budget-report";
import { formatCurrency } from "./resource-cost";
```

Add the extra budget types to the EXISTING `./types` import line so it reads:

```ts
import {
  type Absence, type BudgetBucket, type Discipline, type Grade,
  type Priority, PRIORITIES, type Resource, type ResourcePlan, type Role, type Task,
} from "./types";
```

(`PRIORITIES` is a runtime value, so it must NOT be inside an `import type`; the other names are types.)

Extend the `ReportsPanel` signature:

```ts
export function ReportsPanel({
  tasks, today, holidaySet, lang,
  buckets = [], plan, roles = [], disciplines = [], grades = [],
  resources = [], absences = [], workdayHours = 8,
}: {
  tasks: Task[];
  today: string;
  holidaySet: Set<string>;
  lang: Lang;
  buckets?: BudgetBucket[];
  plan?: ResourcePlan;
  roles?: Role[];
  disciplines?: Discipline[];
  grades?: Grade[];
  resources?: Resource[];
  absences?: Absence[];
  workdayHours?: number;
}) {
```

- [ ] **Step 4: Compute the budget report and render the Budget section**

Add state + memo near the other `useState` hooks (BEFORE the `stats.total === 0` early return, so hook order is stable):

```ts
  const [budgetBucketFilter, setBudgetBucketFilter] = useState<string>("");
  const [budgetMinTotal, setBudgetMinTotal] = useState<string>("");
  const budgetRows = useMemo(() => {
    if (!plan || buckets.length === 0) return [];
    const rep = computeBudgetReport(buckets, plan, roles, resources, workdayHours, holidaySet, absences);
    return rep.buckets;
  }, [buckets, plan, roles, resources, workdayHours, holidaySet, absences]);
```

Render the section as the LAST child inside the `<ReportCard>` (after "By Label"). Note: the budget section must render even when there are tasks; if you want it visible with zero tasks too, that is a future enhancement — keep it inside the existing return:

```tsx
      {plan && budgetRows.length > 0 && (() => {
        const min = budgetMinTotal === "" ? 0 : Number(budgetMinTotal) || 0;
        const filtered = budgetRows.filter(
          (r) => (budgetBucketFilter === "" || String(r.bucketId) === budgetBucketFilter) && r.budgetValue >= min,
        );
        const sum = (sel: (r: typeof filtered[number]) => number) => filtered.reduce((a, r) => a + sel(r), 0);
        const totalBudget = sum((r) => r.budgetValue);
        const totalUsed = sum((r) => r.consumedValue);
        const totalFree = totalBudget - totalUsed;
        const totalHours = sum((r) => r.budgetHours);
        return (
          <Section title={t(lang, "reportsBudget")}>
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">{t(lang, "reportsBudgetFilterBucket")}</span>
                <select
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs"
                  value={budgetBucketFilter}
                  onChange={(e) => setBudgetBucketFilter(e.target.value)}
                  aria-label={t(lang, "reportsBudgetFilterBucket")}
                >
                  <option value="">{t(lang, "reportsBudgetAllBuckets")}</option>
                  {budgetRows.map((r) => (
                    <option key={r.bucketId} value={r.bucketId}>{r.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">{t(lang, "reportsBudgetMinTotal")}</span>
                <input
                  type="number"
                  min={0}
                  className="w-32 rounded-md border border-line bg-surface px-2 py-1.5 text-xs"
                  value={budgetMinTotal}
                  onChange={(e) => setBudgetMinTotal(e.target.value)}
                  aria-label={t(lang, "reportsBudgetMinTotal")}
                />
              </label>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label={t(lang, "reportsBudgetTotal")} value={formatCurrency(totalBudget, "EUR", lang === "de" ? "de-DE" : "en-US")} />
              <Tile label={t(lang, "reportsBudgetUsed")} value={formatCurrency(totalUsed, "EUR", lang === "de" ? "de-DE" : "en-US")} />
              <Tile label={t(lang, "reportsBudgetFree")} value={formatCurrency(totalFree, "EUR", lang === "de" ? "de-DE" : "en-US")} />
              <Tile label={t(lang, "reportsBudgetHours")} value={totalHours.toFixed(0)} />
            </div>
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="min-w-full text-left text-xs">
                <thead className={TABLE_HEAD_CLASS}>
                  <tr>
                    <th className="px-3 py-2">{t(lang, "reportsBudgetBucketCol")}</th>
                    <th className="px-3 py-2 text-right">{t(lang, "reportsBudgetHours")}</th>
                    <th className="px-3 py-2 text-right">{t(lang, "reportsBudgetBudgetEur")}</th>
                    <th className="px-3 py-2 text-right">{t(lang, "reportsBudgetUsedHours")}</th>
                    <th className="px-3 py-2 text-right">{t(lang, "reportsBudgetPlanHours")}</th>
                    <th className="px-3 py-2 text-right">{t(lang, "reportsBudgetFree")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-3 text-center text-muted-foreground">{t(lang, "reportsNoMatches")}</td></tr>
                  ) : filtered.map((r) => (
                    <tr key={r.bucketId}>
                      <td className="px-3 py-2 font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">{r.name}</td>
                      <td className="px-3 py-2 text-right">{r.budgetHours.toFixed(0)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(r.budgetValue, "EUR", lang === "de" ? "de-DE" : "en-US")}</td>
                      <td className="px-3 py-2 text-right">{r.actualHours.toFixed(0)}</td>
                      <td className="px-3 py-2 text-right">{r.plannedHours.toFixed(0)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(r.budgetValue - r.consumedValue, "EUR", lang === "de" ? "de-DE" : "en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        );
      })()}
```

- [ ] **Step 5: Wire the props at the call site `workspace-section.tsx`**

Replace the `<ReportsPanel ... />` (line ~352) with:

```tsx
            <ReportsPanel
              tasks={tasks}
              today={today}
              holidaySet={holidaySet}
              lang={lang}
              buckets={budgets}
              plan={plan}
              roles={roles}
              disciplines={disciplines}
              grades={grades}
              resources={resources}
              absences={absences}
              workdayHours={settings.resources.workdayHours}
            />
```

(Confirm the bucket variable name in scope is `budgets` — the `ExportMenu` at `action-menus.tsx:34` passes `budgets={budgets}`; match that. If the workspace prop is named differently, use that name.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/app/reports.test.tsx`
Expected: PASS — budget rows render, total rollup shows, min-total filter drops Beta.

- [ ] **Step 7: Full gate + commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/reports.tsx src/app/workspace-section.tsx src/app/reports.test.tsx
git commit -m "feat: add filterable budget section to the reports view"
```

---

### Task 7: Version, changelog, and docs

**Files:**
- Modify: `src/app/version.ts`
- Modify: `src/app/i18n.ts` + `src/app/i18n.de.ts` (one highlight string each)
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `docs/CODEMAPS/*.md` (version stamps)

- [ ] **Step 1: Bump version + milestone in `version.ts`**

Set `APP_VERSION = "0.40.0"`, `APP_BUILD_DATE = "2026-06-01"`, `APP_MILESTONE = "Leckie"`. Prepend a release-notes comment block above the existing `0.39.0` block:

```ts
// 0.40.0 "Leckie" adds per-bucket budget planning modes. A "Detailed budget
// planning" toggle switches a bucket between per-role allocations (detailed,
// the prior behavior) and per-discipline allocations that use the average
// (blended) rate of that discipline's grades. Buckets gain optional internal/
// external rate overrides (applied to every line). Entry fields show a unit
// suffix and tooltip; switching off detailed planning warns before discarding
// per-role hours. The Reports view gains a Budget section filterable by bucket
// and by minimum total budget, with total/used/free rollups. New pure module
// `budget-rates.ts`. ~27 new EN+DE strings; no new dependencies.
```

Append `"versionHighlightBudgetModes"` to the `APP_HIGHLIGHT_KEYS` array (after `versionHighlightConsistency`).

- [ ] **Step 2: Add the highlight strings**

`i18n.ts`:
```ts
  versionHighlightBudgetModes: "Plan budgets per discipline (blended rate) or per role, with per-bucket rate overrides and a filterable budget report.",
```
`i18n.de.ts` (ASCII only):
```ts
  versionHighlightBudgetModes: "Budgets je Disziplin (Mischsatz) oder je Rolle planen, mit Satz-Overrides je Bucket und einem filterbaren Budgetbericht.",
```

- [ ] **Step 3: Add the CHANGELOG entry**

Prepend to `CHANGELOG.md`:

```markdown
## 0.40.0 "Leckie" — 2026-06-01

### Added
- **Budget planning modes:** each bucket has a "Detailed budget planning" toggle. On = plan per role (discipline × grade); off = plan per discipline using the blended average rate of that discipline's grades.
- **Per-bucket rate overrides:** optional internal/external rates that override the role/blended rate for every line in the bucket.
- **Reports → Budget section:** filter by bucket and by minimum total budget, with total / used / free / hours rollups and a per-bucket table.

### Changed
- Budget entry fields now show a unit suffix (`h`) and explanatory tooltips. Switching a bucket off detailed planning warns before discarding the per-role hours.
```

- [ ] **Step 4: Bump README + CODEMAPS stamps**

- `README.md`: change the version line to `v0.40.0 "Leckie"`.
- For each `docs/CODEMAPS/*.md`, update the version-range stamp suffix from `0.38.6` (or whatever the current upper bound is) to `0.40.0`. Use Grep to find the stamp lines first: search `0.38.6` and `0.39.0` under `docs/CODEMAPS/`.

- [ ] **Step 5: Verify + commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md README.md docs/CODEMAPS
git commit -m "chore: release v0.40.0 -- budget planning modes"
```

---

## Final verification (after all tasks)

- [ ] `npx vitest run` — entire suite green.
- [ ] `npx tsc --noEmit` — no type errors.
- [ ] `npx eslint .` — clean.
- [ ] Manual smoke (dev server, Playwright or browser): create a bucket, toggle off detailed planning (confirm the warning), add a discipline row, enter hours (see the `h` suffix + tooltip), set a rate override, open Reports → Budget, filter by bucket and by min total. Restore `sample-workspace.md` if the dev server mutated it before committing.
- [ ] Dispatch the final code-reviewer over the whole branch.
