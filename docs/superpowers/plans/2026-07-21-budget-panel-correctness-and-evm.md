# Budget Panel Correctness + Earned Value Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix nine defects and mislabellings in the Budget panel found by inspecting a live screenshot, then add a genuine EVM Cost Performance Index card backed by bucket→task links.

**Architecture:** Three phases. **A** and **B** are pure-engine + presentational corrections with no new persisted state — they ship together as a correctness batch. **C** adds two persisted `BudgetBucket` fields and a new CCI card, and ships as its own feature slice with its own version bump. All RAG logic stays in the pure i18n-free `budget-health.ts`; all money/hours math stays in the pure `budget-report.ts`; `budget-panel.tsx` and `budget-report-panel.tsx` remain presentational consumers.

**Tech Stack:** TypeScript, React 19, forked Next.js 16, Tailwind v4, Vitest 4, Playwright.

**Origin of findings:** see the investigation in the session that produced this plan. Two root causes were reproduced against the real engine:
1. `computeBucketReport` accumulates `budgetHours` as a per-row subtotal and `plannedHours` as a flat running sum. With `budgetFollowsPlan` on and every row resourced these are the *same sum*, but the differing association order makes them differ by ~1 ULP; `ratioHealth`'s strict `>` then renders an exactly-on-budget bucket Red. Verified: `budgetHours 225.91519999999999868` vs `plannedHours 225.91520000000002710`, ratio `1.0000000000000002`.
2. `cost` and `budgetCost` both derive from `internalRate`. When roles carry no internal rate, `role?.internalRate ?? 0` silently yields 0 → `cost = 0` → contribution margin reports **100% Green** and cost performance reports `—`. The panel claims perfect profitability precisely because it cannot compute cost.

---

## Decisions already taken (do not relitigate)

| # | Finding | Decision |
|---|---|---|
| 1 | Plan badge Red at exactly-on-budget | Add float tolerance |
| 2 | Exact hit is never Green; badge is a self-comparison when mirroring | Suppress when mirroring **and** make an exact hit Green |
| 3 | No CPI | Root cause is missing internal rates; surface it |
| 4 | Margin 100% Green is a false positive | Show unknown, not perfect, plus a notice |
| 5 | "Cost performance" is BAC/AC, not EV/AC | Relabel the existing tile **and** add a real EV/AC card beside it |
| 6 | "Plan" means two different things | Rename the grid cell label to "Budget" |
| 7 | Raw float in cell | Round for display |
| 8 | Consumption shows remaining € under a consumed % | Show the consumed amount |
| 9 | Zero actual scores Green | Make it period-aware |

**Interpretation applied to #2 (important):** of the 13 `ratioHealth` call sites, 11 model *consumption* (consumed vs budget, actual vs budget, per-cell actual vs plan) where 100% correctly stays Amber — making those Green would announce "you have spent your entire budget: Green". Only two sites are plan-vs-budget (`budget-panel.tsx:458`, `budget-report-panel.tsx:98`). Exact-hit-Green is therefore implemented as a **separate function applied to those two sites only**. `ratioHealth`'s bands are not changed.

**Assumptions applied to C:** bucket completion is **count-based** over linked tasks (finished ÷ linked), not weighted by estimate; a manual `percentComplete` wins whenever set; neither present → the CPI card renders `—`.

---

## File Structure

**Phase A + B**

| File | Responsibility | Change |
|---|---|---|
| `src/app/budget-health.ts` | Pure RAG thresholds | Add `RATIO_EPSILON`, `planVsBudgetHealth`, `cellHealth`; tolerance in `ratioHealth` |
| `src/app/budget-health.test.ts` | Threshold guards | New cases per function |
| `src/app/budget-report.ts` | Pure money/hours engine | `consumption.amount` → consumed; add `budgetMirrorsPlan`, `hasInternalRates` |
| `src/app/budget-report.test.ts` | Engine guards | New cases |
| `src/app/budget-panel.tsx` | Budget panel | Cell label/rounding/period-aware RAG, plan badge, tiles, no-rates notice |
| `src/app/budget-report-panel.tsx` | Budget report view | Plan tile health, consumption amount |
| `src/app/i18n.ts` / `i18n.de.ts` | EN/DE strings | Relabels + new notice strings |

**Phase C (adds to the above)**

| File | Responsibility | Change |
|---|---|---|
| `src/app/types.ts` | Entity shapes | `BudgetBucket.taskIds?`, `.percentComplete?` |
| `src/app/sanitize-entities.ts` | Single validator | Validate both new fields in `sanitizeBudgetBucket` |
| `src/app/csv-codecs-core.ts` | CSV + Turso columns | Extend `BUDGETS_CSV_COLUMNS` + `budgetFieldToString` |
| `src/app/markdown-codecs-core.ts` | MD columns | Extend `BUDGETS_MD_COLUMNS` |
| `src/app/budget-earned-value.ts` | **NEW** — pure EV engine | `bucketPercentComplete`, `earnedValueFor` |
| `src/app/budget-bucket-modal.tsx` | Bucket editor | Task-link picker + manual % field |
| `src/app/__fixtures__/golden-*` | Byte-stable fixtures | Regenerate (legitimate new columns) |
| `sample-workspace-small.md` / `.csv` | Curated sample | Append the two columns |

---

## Test fixtures

Named fixtures referenced by the tests below (`bucketWithHours`, `fixedBucket75of275`, `bucket40pct`, `renderPanelWithMirroredBucket`, `renderPanelWithRatelessRoles`, …) are **not new inventions** — each test file already carries an equivalent. Build each one by cloning the nearest existing fixture in that file and changing only the field under test, so a failure points at the change rather than at fixture drift. Where a fixture must produce float noise, use a product such as `0.06 * 176` rather than a literal — a hand-typed `10.5599` does not reproduce the bug (verified: it compares equal and the assertion passes for the wrong reason).

## Phase A — engine correctness (no new persisted state)

### Task A1: Float tolerance in `ratioHealth`

**Files:**
- Modify: `src/app/budget-health.ts:18-24`
- Test: `src/app/budget-health.test.ts` (after the "is Red above 100%" case, ~line 20)

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("ratioHealth ...")` block:

```ts
  // budgetHours and plannedHours are the SAME sum accumulated in different
  // association orders (budget-report.ts: a per-row subtotal vs a flat running
  // sum), so two mathematically equal totals can differ by a few ULP. A strict
  // `>` then reports a 6e-14 h overrun as Red on a bucket that is exactly on
  // budget — these are the real values computeBudgetReport produced.
  it("treats a float-noise overrun as on-budget, not Red", () => {
    expect(ratioHealth(225.91520000000002710, 225.91519999999999868)).not.toBe("R");
  });
  it("still reports a genuine hair-over-budget as Red", () => {
    expect(ratioHealth(225.93, 225.915)).toBe("R");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/budget-health.test.ts`
Expected: FAIL — `AssertionError: expected 'R' not to be 'R'` on the float-noise case. The hair-over case passes already (it must keep passing).

- [ ] **Step 3: Add the tolerance**

Replace `ratioHealth` in `src/app/budget-health.ts`:

```ts
/** Relative tolerance for the band comparisons. `budgetHours` and
 *  `plannedHours` are the same sum accumulated in different association orders
 *  (budget-report.ts sums a per-row subtotal for one and a flat running total
 *  for the other), so two mathematically equal figures differ by a few ULP.
 *  Without this a 6e-14 h difference paints an exactly-on-budget bucket Red.
 *  1e-9 sits orders of magnitude above double noise and far below any real
 *  overrun. */
export const RATIO_EPSILON = 1e-9;

export function ratioHealth(actual: number, budget: number): Health | null {
  if (!(budget > 0)) return null;
  const r = actual / budget;
  if (r > BUDGET_OVER_RED * (1 + RATIO_EPSILON)) return "R";
  if (r >= BUDGET_OVER_AMBER * (1 - RATIO_EPSILON)) return "A";
  return "G";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/budget-health.test.ts`
Expected: PASS, all cases — including the pre-existing `ratioHealth(100, 100) === "A"`, which must be unchanged.

- [ ] **Step 5: Mutation-check the new guard**

Temporarily revert `ratioHealth` to the strict `r > BUDGET_OVER_RED`, re-run, confirm the float-noise case fails again, then restore. A guard that survives its own mutation proves nothing.

- [ ] **Step 6: Commit**

```bash
git add src/app/budget-health.ts src/app/budget-health.test.ts
git commit -m "fix(budget): tolerate float noise in the over-budget RAG bands"
```

---

### Task A2: Plan-vs-budget health + suppress the self-comparison badge

**Files:**
- Modify: `src/app/budget-health.ts` (new export), `src/app/budget-report.ts` (new report field), `src/app/budget-panel.tsx:458`, `src/app/budget-report-panel.tsx:98`
- Test: `src/app/budget-health.test.ts`, `src/app/budget-report.test.ts`, `src/app/budget-panel.test.tsx`

- [ ] **Step 1: Write the failing health test**

```ts
describe("planVsBudgetHealth (planning at or under budget is on target)", () => {
  it("is null when there is no budget to compare against", () => {
    expect(planVsBudgetHealth(10, 0)).toBeNull();
  });
  it("is Green when the plan exactly hits the budget", () => {
    expect(planVsBudgetHealth(275, 275)).toBe("G");
  });
  it("is Green when the plan is under budget", () => {
    expect(planVsBudgetHealth(200, 275)).toBe("G");
  });
  it("is Red when the plan exceeds the budget", () => {
    expect(planVsBudgetHealth(276, 275)).toBe("R");
  });
  it("ignores float noise", () => {
    expect(planVsBudgetHealth(225.91520000000002710, 225.91519999999999868)).toBe("G");
  });
});
```

Add `planVsBudgetHealth` to the import at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/budget-health.test.ts`
Expected: FAIL — `planVsBudgetHealth is not a function`.

- [ ] **Step 3: Implement**

Append to `src/app/budget-health.ts`:

```ts
/**
 * Plan-vs-budget adherence: planning AT or UNDER budget is on target (Green),
 * over budget is Red.
 *
 * Deliberately NOT `ratioHealth`. That function models CONSUMPTION, where
 * reaching 100% means the budget is fully spent and must stay Amber. Here 100%
 * means the plan exactly matches the budget, which is the goal — so the two
 * cannot share bands. Do not "simplify" this into ratioHealth.
 */
export function planVsBudgetHealth(planned: number, budget: number): Health | null {
  if (!(budget > 0)) return null;
  return planned / budget > BUDGET_OVER_RED * (1 + RATIO_EPSILON) ? "R" : "G";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/budget-health.test.ts` → PASS.

- [ ] **Step 5: Write the failing engine test for `budgetMirrorsPlan`**

In `src/app/budget-report.test.ts`, inside the existing `budgetFollowsPlan` describe block:

```ts
  test("reports budgetMirrorsPlan when follow-plan is on and every row is resourced", () => {
    const report = computeBudgetReport(
      [resourcedStaleBucket], { ...plan, budgetFollowsPlan: true }, roles, resources, 8, noHolidays,
    );
    expect(report.buckets[0].budgetMirrorsPlan).toBe(true);
  });

  test("does NOT report budgetMirrorsPlan when follow-plan is off", () => {
    const report = computeBudgetReport(
      [resourcedStaleBucket], { ...plan, budgetFollowsPlan: false }, roles, resources, 8, noHolidays,
    );
    expect(report.buckets[0].budgetMirrorsPlan).toBe(false);
  });

  test("does NOT report budgetMirrorsPlan when a row has no resources", () => {
    const mixed: BudgetBucket = {
      ...resourcedStaleBucket,
      allocations: [
        ...resourcedStaleBucket.allocations,
        { roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: {} },
      ],
    };
    const report = computeBudgetReport(
      [mixed], { ...plan, budgetFollowsPlan: true }, roles, resources, 8, noHolidays,
    );
    expect(report.buckets[0].budgetMirrorsPlan).toBe(false);
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/app/budget-report.test.ts`
Expected: FAIL — `expected undefined to be true`.

- [ ] **Step 7: Implement in the engine**

In `src/app/budget-report.ts`, add to the `BucketReport` type:

```ts
  /** True when this bucket's budget hours ARE its planned hours (follow-plan on
   *  and every row resourced). The Plan-vs-Budget badge is then a comparison of
   *  a number with itself and carries no information — surfaces do not render it. */
  budgetMirrorsPlan: boolean;
```

In `computeBucketReport`, after `const rows = bucketRateRows(bucket, roles);`:

```ts
  const budgetMirrorsPlan =
    budgetFollowsPlan && rows.length > 0 && rows.every((r) => r.resourceIds.length > 0);
```

Add `budgetMirrorsPlan,` to the returned object. Add the same field to `ProjectReport`, computed in `computeBudgetReport`'s project rollup as:

```ts
    budgetMirrorsPlan: reports.length > 0 && reports.every((b) => b.budgetMirrorsPlan),
```

(Use the local variable name the rollup already has for the per-bucket reports.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/app/budget-report.test.ts` → PASS.

- [ ] **Step 9: Write the failing panel test**

In `src/app/budget-panel.test.tsx`:

```ts
  test("hides the Plan badge when the budget is mirroring the plan", () => {
    // follow-plan on + resourced row => budget IS plan; a RAG on that comparison
    // can only ever read Amber (equal) or Red (float noise), so it is suppressed.
    renderPanelWithMirroredBucket();
    expect(screen.queryByTitle("Plan (h)")).not.toBeInTheDocument();
  });

  test("shows the Plan badge when budget and plan are independent", () => {
    renderPanelWithFollowPlanOff();
    expect(screen.getByTitle("Plan (h)")).toBeInTheDocument();
  });
```

Build the two render helpers from the fixtures already used in that file; `title` on `RagBadge` is `t(lang, "budgetPlanHours")`.

- [ ] **Step 10: Run test to verify it fails, then wire the panel**

`src/app/budget-panel.tsx:458` — swap `ratioHealth` for `planVsBudgetHealth` and gate the badge:

```tsx
{br.plannedHours.toFixed(0)}
{!br.budgetMirrorsPlan && (
  <RagBadge value={planVsBudgetHealth(br.plannedHours, br.budgetHours)} lang={lang} title={t(lang, "budgetPlanHours")} />
)}
```

`src/app/budget-report-panel.tsx:98` — same swap, gated on `proj.budgetMirrorsPlan`.

Update the `budget-health` import in both files.

- [ ] **Step 11: Verify + commit**

```bash
npx vitest run src/app/budget-health.test.ts src/app/budget-report.test.ts src/app/budget-panel.test.tsx src/app/budget-report-panel.test.tsx
npx tsc --noEmit
git add -A src/app
git commit -m "fix(budget): plan-vs-budget RAG scores an exact hit green and hides the self-comparison"
```

---

### Task A3: Consumption tile shows the consumed amount

**Files:**
- Modify: `src/app/budget-report.ts:225` and `:312`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/budget-report.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  test("consumption.amount is the consumed value, matching its own percent", () => {
    // A fixed-price bucket: 33,760 price, 75 of 275 hours booked => 27.3% consumed.
    // The tile renders percent and amount together, so the amount must be what
    // was consumed (9,206), not what remains (24,554).
    const report = computeBudgetReport([fixedBucket75of275], plan, roles, resources, 8, noHolidays);
    const c = report.buckets[0].consumption;
    expect(c.percent).toBeCloseTo(27.27, 1);
    expect(c.amount).toBeCloseTo(9205.94, 1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — receives `24554.06` (the remaining amount).

- [ ] **Step 3: Implement**

`src/app/budget-report.ts` — both the bucket (line ~225) and project (line ~312) returns:

```ts
    // The tile prints this amount directly beneath `percent`, so it must be the
    // SAME quantity — consumed, not remaining. Remaining is already carried by
    // win/loss.
    consumption: { amount: consumedValue, percent: consumptionPercent },
```

- [ ] **Step 4: Update the hint strings**

`i18n.ts`: `budgetCciConsumptionHint: "Budget consumed so far. Percent is of the total budget."`
`i18n.de.ts`: the German equivalent — **write via a node utf8 script, never the Edit tool** (the file is CRLF and the Edit tool corrupts umlauts and curls quotes). Real umlauts only.

- [ ] **Step 5: Verify + commit**

```bash
npx vitest run src/app/budget-report.test.ts
npx tsc --noEmit   # enforces EN/DE key parity
git commit -am "fix(budget): consumption tile shows the consumed amount, not the remainder"
```

---

### Task A4: Round derived hours for display

**Files:**
- Modify: `src/app/budget-panel.tsx:56-107` (`HoursCell`)
- Test: `src/app/budget-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
  test("a mirrored plan cell renders rounded hours, not the raw float", () => {
    // 0.06 * 176 === 10.559999999999999; the narrow input truncates that
    // mid-number ("10.5599…"), which reads as a wrong value.
    renderPanelWithMirroredHours(0.06 * 176);
    expect(screen.getByLabelText("budget-1-1-2026-09")).toHaveValue(10.56);
  });
```

- [ ] **Step 2: Run test to verify it fails** — receives `10.559999999999999`.

- [ ] **Step 3: Implement**

Add above `HoursCell` in `src/app/budget-panel.tsx`:

```ts
/** Mirrored plan hours are derived (utilization x capacity) and carry float
 *  noise such as 10.559999999999999, which the narrow input then truncates
 *  mid-number. Rounded for DISPLAY only — the stored and aggregated values are
 *  untouched. Editable cells are left alone: rounding a field while the user
 *  types fights the input. */
function displayHours(v: number | undefined, readOnly: boolean | undefined): number | "" {
  if (v === undefined || !Number.isFinite(v)) return "";
  return readOnly ? Math.round(v * 100) / 100 : v;
}
```

In the budget `<input>`: `value={displayHours(budget, readOnly)}`.

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/app/budget-panel.test.tsx
git commit -am "fix(budget): round mirrored plan hours for display"
```

---

### Task A5: Rename the grid cell label "Plan" → "Budget"

The cell writes `budgetHours` and its own tooltip already reads "Budgeted hours for this period", while the bucket header's "Plan (h)" is a different quantity. One word, two meanings, same view.

**Files:**
- Modify: `src/app/i18n.ts:541`, `src/app/i18n.de.ts`, `src/app/budget-panel.tsx:80`
- Test: `src/app/budget-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
  test("the per-period cell labels its budget input Budget, not Plan", () => {
    renderPanel();
    const cell = screen.getByLabelText("budget-1-1-2026-07").closest("div");
    expect(cell).toHaveTextContent("Budget");
  });
```

- [ ] **Step 2: Run to verify it fails**, then rename the key `budgetCellPlan` → `budgetCellBudget` with EN `"Budget"` and DE `"Budget"`, update the single usage at `budget-panel.tsx:80`, and grep for other references:

```bash
grep -rn "budgetCellPlan" src/ e2e/
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run src/app/budget-panel.test.tsx && npx tsc --noEmit
git commit -am "fix(budget): the per-period cell labels its own field Budget, not Plan"
```

---

### Task A6: Relabel the BAC/AC tile honestly

Current hint claims "Cost Performance Index = earned ÷ actual"; the implementation is `budgetCost / cost` — total budgeted cost over cost-to-date, with no %-complete term. Early in a project it reads ~3.7 and scores Green purely because little has been spent.

**Files:**
- Modify: `src/app/i18n.ts:491,2744`, `src/app/i18n.de.ts`, `src/app/budget-panel.tsx:471`, `src/app/budget-report-panel.tsx`

- [ ] **Step 1: Rename the key and strings**

`budgetCciCpi` → `budgetCciBurn`, EN `"Cost burn"`; hint `budgetCciBurnHint`: `"Budgeted cost ÷ cost to date. Above 100% means less has been spent than budgeted so far. This is not an EVM index — see Cost performance (CPI)."` DE equivalents via the node utf8 script.

This frees the name `budgetCciCpi` for the real EV/AC card in Task C5.

- [ ] **Step 2: Update the two call sites and the RAG-threshold legend**

`dashboardRagThresholds` (`i18n.ts:2061`) mentions "Cost performance" — update to "Cost burn".

- [ ] **Step 3: Verify + commit**

```bash
npx tsc --noEmit && npm run test:run
git commit -am "fix(budget): name the burn ratio what it is, freeing CPI for a real EVM index"
```

---

### Task A7: Period-aware zero-actual cell RAG

A cell with 0 booked against a real plan currently scores Green — correct for a future period, misleading for one that has closed.

**Files:**
- Modify: `src/app/budget-health.ts`, `src/app/budget-panel.tsx` (`HoursCell`, `HoursTd`, both row maps)
- Test: `src/app/budget-health.test.ts`, `src/app/budget-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
describe("cellHealth (period-aware)", () => {
  it("is null when there is nothing planned", () => {
    expect(cellHealth(0, 0, "2026-07-31", "2026-08-15")).toBeNull();
  });
  it("is Green for an untouched FUTURE period", () => {
    expect(cellHealth(0, 30, "2026-09-30", "2026-08-15")).toBe("G");
  });
  it("is Amber when a CLOSED period booked nothing against a real plan", () => {
    expect(cellHealth(0, 30, "2026-07-31", "2026-08-15")).toBe("A");
  });
  it("otherwise defers to the consumption bands", () => {
    expect(cellHealth(31, 30, "2026-07-31", "2026-08-15")).toBe("R");
    expect(cellHealth(10, 30, "2026-07-31", "2026-08-15")).toBe("G");
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then implement:

```ts
/** Per-period cell health. Identical to `ratioHealth` except that a CLOSED
 *  period which booked nothing against a real plan is Amber rather than Green:
 *  zero delivery in a period that has ended is not health, it is a signal.
 *  Dates are ISO `YYYY-MM-DD`, so lexical comparison is chronological. */
export function cellHealth(
  actual: number, budget: number, periodEnd: string, today: string,
): Health | null {
  if (!(budget > 0)) return null;
  if (actual === 0 && periodEnd < today) return "A";
  return ratioHealth(actual, budget);
}
```

- [ ] **Step 3: Thread `today` + `periodEnd` through the panel**

`HoursCell` and `HoursTd` take `periodEnd: string` and `today: string`; the badge at `budget-panel.tsx:104` becomes `cellHealth(actual ?? 0, budget ?? 0, periodEnd, today)`. Both the `detailedRows` and `blendedRows` maps pass `periodEnd={p.end}` and `today={props.today}` — `today` is already a `BudgetPanelProps` field.

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/app/budget-health.test.ts src/app/budget-panel.test.tsx && npx tsc --noEmit
git commit -am "feat(budget): a closed period with nothing booked no longer scores green"
```

---

## Phase B — surface missing internal rates

### Task B1: Engine reports whether cost is knowable

**Files:**
- Modify: `src/app/budget-report.ts`
- Test: `src/app/budget-report.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  test("flags a bucket whose roles carry no internal rate", () => {
    const rateless = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 0 }];
    const report = computeBudgetReport([bucketWithHours], plan, rateless, resources, 8, noHolidays);
    // cost === 0 here only because the rate card is empty — NOT because the work
    // was free. Surfaces must not read that as a 100% margin.
    expect(report.buckets[0].hasInternalRates).toBe(false);
  });

  test("does not flag a bucket with a real internal rate", () => {
    const rated = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
    const report = computeBudgetReport([bucketWithHours], plan, rated, resources, 8, noHolidays);
    expect(report.buckets[0].hasInternalRates).toBe(true);
  });
```

- [ ] **Step 2: Run to verify it fails**, then implement.

Add `hasInternalRates: boolean` to `BucketReport` and `ProjectReport`. In `computeBucketReport`, alongside the existing row loop:

```ts
  // `role?.internalRate ?? 0` and a 0 bucket override are indistinguishable from
  // a genuinely free resource, and both collapse cost to 0 — which then reads as
  // a perfect margin. Track whether ANY row could actually be costed.
  const hasInternalRates = rows.some((r) => r.rates.internal > 0);
```

Project rollup: `hasInternalRates: reports.some((b) => b.hasInternalRates)`.

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run src/app/budget-report.test.ts
git commit -am "feat(budget): report whether a bucket's cost is knowable at all"
```

---

### Task B2: Render unknown instead of perfect, with a notice

**Files:**
- Modify: `src/app/budget-panel.tsx` (bucket + project tiles, new notice), `src/app/budget-report-panel.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/budget-panel.test.tsx`

Gate only the **internal-cost-derived** figures. A T&M bucket's win/loss is `budgetValue - consumedValue` (external rates) and stays valid without internal rates; a **fixed-price** bucket's win/loss is `revenue - cost` and does not.

- [ ] **Step 1: Write the failing tests**

```ts
  test("a bucket with no internal rates shows margin as unknown, not 100%", () => {
    renderPanelWithRatelessRoles();
    expect(screen.queryByText("100.0%")).not.toBeInTheDocument();
    expect(screen.getByText(/no internal rates/i)).toBeInTheDocument();
  });

  test("a fixed-price bucket with no internal rates shows win/loss as unknown", () => {
    renderPanelWithRatelessRoles();
    expect(screen.queryByText("€33,760")).not.toBeInTheDocument();
  });

  test("a bucket WITH internal rates is unaffected", () => {
    renderPanelWithRatedRoles();
    expect(screen.queryByText(/no internal rates/i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify they fail**, then implement.

In the bucket body, when `!br.hasInternalRates`:
- Contribution margin tile → `value={{ amount: NaN, percent: null }}`-equivalent unknown rendering and `rag={null}`. Prefer an explicit `unknown` prop on `Cci` over sentinel numbers.
- Cost burn tile → unknown + `rag={null}`.
- Win/loss (fixed-price buckets only) → unknown + `rag={null}`.
- Render a notice beneath the tile row:

```tsx
{!br.hasInternalRates && (
  <p className="mt-2 text-xs text-muted-foreground">
    {t(lang, "budgetNoInternalRates")}
  </p>
)}
```

New strings, EN:
- `budgetNoInternalRates`: `"No internal rates are set for this bucket's roles, so cost, margin and burn cannot be calculated. Set them on the rate card under Resources → Roles."`

DE via the node utf8 script.

Apply the same gating to the project tiles in `budget-panel.tsx` (~line 384) and `budget-report-panel.tsx`.

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run src/app/budget-panel.test.tsx src/app/budget-report-panel.test.tsx && npx tsc --noEmit
git commit -am "fix(budget): report unknown cost instead of a perfect margin when rates are missing"
```

---

### Task B3: Phase A+B release gates and docs

- [ ] **Step 1: Full gates**

```bash
npx tsc --noEmit
npm run lint
npm run test:run
npm run size:check
npm run dup:check
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Budget"
```

Budget is an axe-scanned view; the new notice must carry no unlabeled controls.

- [ ] **Step 2: Docs + version**

Bump `src/app/version.ts` (patch or minor per the change set), add a `CHANGELOG.md` entry, append any new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` with EN+DE strings, and update `lib/app-feature-guide.md` for the Budget view, then regenerate:

```bash
npx vite-node scripts/gen-operating-guide.mjs   # or `npm run build` prebuild
```

- [ ] **Step 3: Commit**

```bash
git commit -am "chore(release): budget correctness batch"
```

---

## Phase C — real EV/AC Cost Performance Index

> Ships separately from A+B. Adds two persisted `BudgetBucket` columns, so it carries the full "new column on an existing entity" chore.

### Task C1: Types + sanitizer

**Files:**
- Modify: `src/app/types.ts:599-628`, `src/app/sanitize-entities.ts:557`
- Test: `src/app/sanitize-budget.test.ts`

- [ ] **Step 1: Write the failing sanitizer tests**

```ts
  it("keeps a valid task link list and drops junk ids", () => {
    const b = sanitizeBudgetBucket({ ...base, taskIds: [3, "4", 0, -1, "x", 3] })!;
    expect(b.taskIds).toEqual([3, 4]);
  });
  it("clamps percentComplete into 0..100", () => {
    expect(sanitizeBudgetBucket({ ...base, percentComplete: 150 })!.percentComplete).toBe(100);
    expect(sanitizeBudgetBucket({ ...base, percentComplete: -5 })!.percentComplete).toBe(0);
  });
  it("omits percentComplete when absent, so existing buckets stay byte-identical", () => {
    expect("percentComplete" in sanitizeBudgetBucket(base)!).toBe(false);
  });
```

- [ ] **Step 2: Run to verify they fail**, then add to `types.ts`:

```ts
  /** Tasks whose completion drives this bucket's earned value. Empty/absent =>
   *  no derived progress. */
  taskIds?: number[];
  /** Manual completion override (0-100). WINS over the linked-task derivation
   *  whenever set — a PM's assessment beats a task count. */
  percentComplete?: number;
```

Implement in `sanitizeBudgetBucket` using the existing `sanitizeIdList` helper, emitting both fields **sparsely** (absent when not supplied) so buckets that predate this stay byte-identical and the golden fixtures only move for the new columns.

- [ ] **Step 3: Verify + commit**

---

### Task C2: Persistence across all six write paths

**Files:**
- Modify: `src/app/csv-codecs-core.ts:158,580`, `src/app/markdown-codecs-core.ts:157`
- Regenerate: `src/app/__fixtures__/golden-*`
- Modify: `sample-workspace-small.md`, `sample-workspace-small.csv`
- Test: `src/app/storage-serialization.test.ts`, `src/app/entity-persistence-registry.test.ts`

- [ ] **Step 1: Write the failing round-trip test**

```ts
  test("bucket task links and manual percent survive a CSV and Markdown round-trip", () => {
    const ws = { ...baseWorkspace, budgets: [{ ...bucket, taskIds: [3, 4], percentComplete: 40 }] };
    expect(csvToWorkspace(workspaceToCsv(ws)).budgets[0].taskIds).toEqual([3, 4]);
    expect(markdownToWorkspace(workspaceToMarkdown(ws)).budgets[0].percentComplete).toBe(40);
  });
```

- [ ] **Step 2: Run to verify it fails**, then extend `BUDGETS_CSV_COLUMNS` with `"taskIds", "percentComplete"`, add the encode arms to `budgetFieldToString` (`taskIds` joined with `;`, matching the existing id-list convention), and add the matching `BUDGETS_MD_COLUMNS` entries. Decode rides `sanitizeBudgetBucket`, so no separate decoder arm is needed — but the sanitizer must accept the **string** forms the codecs produce.

- [ ] **Step 3: Regenerate fixtures and sample data**

```bash
npx vite-node scripts/generate-sample-workspace.ts
# then regenerate __fixtures__/golden-* via the serializers
npx vitest run src/app/golden-workspace.test.ts
```

This is a legitimate format change (new columns) — regeneration is expected, and the diff must be confined to the Budgets section.

- [ ] **Step 4: Confirm Turso self-heal**

Turso single + tenant DDL derive from `BUDGETS_CSV_COLUMNS`; `turso-migrate.ts` PRAGMA-diffs and `ALTER ADD COLUMN`s inside the write lock. Add a case to the migrate test for the two new columns.

- [ ] **Step 5: Verify + commit**

```bash
npm run test:run && npx tsc --noEmit
git commit -am "feat(budget): persist bucket task links and manual completion"
```

---

### Task C3: Pure earned-value engine

**Files:**
- Create: `src/app/budget-earned-value.ts`, `src/app/budget-earned-value.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("bucketPercentComplete", () => {
  it("is null with neither a manual value nor links", () => {
    expect(bucketPercentComplete({ taskIds: [] }, [])).toBeNull();
  });
  it("derives from the share of finished linked tasks", () => {
    const tasks = [
      { id: 1, status: "Done" }, { id: 2, status: "To Do" },
      { id: 3, status: "Cancelled" }, { id: 4, status: "In Progress" },
    ];
    // Done + Cancelled are both finished => 2 of 4.
    expect(bucketPercentComplete({ taskIds: [1, 2, 3, 4] }, tasks)).toBe(50);
  });
  it("lets a manual value win over the derivation", () => {
    const tasks = [{ id: 1, status: "Done" }];
    expect(bucketPercentComplete({ taskIds: [1], percentComplete: 20 }, tasks)).toBe(20);
  });
  it("is null when every link is dangling", () => {
    expect(bucketPercentComplete({ taskIds: [99] }, [{ id: 1, status: "Done" }])).toBeNull();
  });
});

describe("earnedValueFor", () => {
  it("is null when progress is unknown", () => {
    expect(earnedValueFor(1000, null)).toBeNull();
  });
  it("is the budgeted cost scaled by progress", () => {
    expect(earnedValueFor(1000, 40)).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify they fail**, then implement — pure, i18n-free, no clock, reusing `isTaskFinished` from `./task-status`.

- [ ] **Step 3: Verify + commit**

---

### Task C4: Bucket modal — link tasks and set a manual percent

**Files:**
- Modify: `src/app/budget-bucket-modal.tsx`
- Test: `src/app/budget-bucket-modal.test.tsx`

- [ ] **Step 1: Write the failing tests** for (a) linking a task writes `taskIds`, (b) typing a percent writes `percentComplete`, (c) clearing the percent writes `undefined` — mirroring the existing rate-override handling (`e.target.value === "" ? undefined : Number(...)`), which is what keeps a cleared field from silently becoming a meaningful `0`.

- [ ] **Step 2: Implement.** Reuse an existing picker primitive rather than hand-rolling one — check `use-task-picker-options.ts` / the change + RAID task pickers first. Every control needs an accessible name; the modal is reachable from an axe-scanned view.

- [ ] **Step 3: Verify + commit**

---

### Task C5: The EV/AC card

**Files:**
- Modify: `src/app/budget-report.ts` (accept `tasks`, expose `earnedValue` + `costPerformanceIndex`), `src/app/budget-panel.tsx:469-473`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/budget-report.test.ts`, `src/app/budget-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
  test("CPI is earned value over actual cost", () => {
    // 1000 budgeted cost, 40% complete => EV 400; 500 spent => CPI 0.8
    const report = computeBudgetReport([bucket40pct], plan, roles, resources, 8, noHolidays, 0, 0, [], tasks);
    expect(report.buckets[0].costPerformanceIndex).toBeCloseTo(0.8, 3);
  });
  test("CPI is null when progress is unknown", () => {
    const report = computeBudgetReport([bucketNoProgress], plan, roles, resources, 8, noHolidays, 0, 0, [], []);
    expect(report.buckets[0].costPerformanceIndex).toBeNull();
  });
  test("CPI is null when cost is unknown", () => {
    // No internal rates => AC is 0 => the index is undefined, not infinite.
    expect(ratelessReport.buckets[0].costPerformanceIndex).toBeNull();
  });
```

- [ ] **Step 2: Run to verify they fail**, then implement. `tasks` joins as a trailing optional parameter (default `[]`) so the existing call sites stay valid; thread the workspace tasks from `budget-panel.tsx`'s `report` memo.

- [ ] **Step 3: Render the card** beside Cost burn, reclaiming the `budgetCciCpi` key freed in Task A6, with `rag={costPerformanceHealth(...)}` and an unknown state when `costPerformanceIndex === null`. The tile row becomes four across — verify the responsive grid still collapses correctly at ~375px (bare `grid-cols-3`/`-4` overflows narrow viewports).

- [ ] **Step 4: Verify + commit**

---

### Task C6: Phase C release

- [ ] **Step 1: Full gates** — as Task B3, plus `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Budget"` for the new card and modal controls.
- [ ] **Step 2: Docs** — `version.ts` (minor: new persisted fields + new feature), `CHANGELOG.md`, `APP_HIGHLIGHT_KEYS` + EN/DE, `AGENTS.md` (a new persisted column and the `budget-earned-value.ts` engine both belong in the architecture pointers), `lib/app-feature-guide.md` + regenerate, `docs/CODEMAPS/*`.
- [ ] **Step 3: Code review** — run a superpowers code review before the release chain, per standing practice.

---

## Risks and watch-items

1. **`ratioHealth` blast radius.** 13 call sites across four panels. Task A1 changes *behaviour at the boundary* for all of them. The existing `ratioHealth(100, 100) === "A"` case must keep passing; if any other suite moves, investigate rather than update the expectation.
2. **Byte-stable serializers.** `golden-workspace.test` pins exact CSV/Markdown bytes. In Phase C the diff must be confined to the Budgets section; anything else means an unintended format change.
3. **DE i18n.** Every DE string in this plan goes in via a node utf8 write with `\r\n` anchors — never the Edit tool. Re-grep to confirm real umlauts afterwards.
4. **Sparse emission.** Both new `BudgetBucket` fields must be emitted sparsely, or every existing bucket's serialization changes and the golden diff explodes beyond the new columns.
5. **`hasInternalRates` vs a deliberate zero rate.** A genuinely free internal resource is indistinguishable from an unset rate. The notice is worded as guidance, not an error, for that reason.
6. **Scope creep into `resources-panel.tsx`.** That file is already at 865 lines and over its ratchet baseline. Nothing in this plan should add to it.
