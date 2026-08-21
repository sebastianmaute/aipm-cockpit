# Blended rate poisoning + cost-unknown reason — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a discipline with unpriced grades from producing a diluted internal rate that reads as sound, and give every "cost is unknown" state its own explanatory message instead of leaving a bare dash.

**Architecture:** `blendedDisciplineRate` poisons (returns 0) instead of averaging an unpriced role's 0 into the mean. `BucketReport`/`ProjectReport` swap two booleans (`costIsKnowable`, `ratesAreMissing`) for one discriminated `costUnknownReason` enum plus `unpricedDisciplineIds`; the booleans survive as derived helper functions. One shared presentational component renders the per-reason message on both budget surfaces.

**Tech Stack:** TypeScript, React 19, Vitest 4, Tailwind v4. Pure engine modules are i18n-free; React surfaces translate.

**Spec:** `docs/superpowers/specs/2026-07-21-blended-rate-and-cost-unknown-reason-design.md`

---

## Background for the implementer

You are working in a project-management app. A **budget bucket** is a pot of money/hours. It allocates
work either **detailed** (per role, where a role is discipline × grade) or **blended** (per discipline,
using the average rate of that discipline's grades).

`Role.internalRate` is a required `number`. There is no `undefined`, so **`0` is the only way to
represent "nobody has priced this role"**. The user has confirmed 0 never means a genuinely free role.

Three prior releases (0.195.0, 0.195.1) fixed a family of eight defects that all reduce to: when cost
cannot be computed it comes out `0`, and `revenue − 0` renders as a **100% margin, green**. The panel
claimed perfect profitability precisely when it knew least. Two holes were left open and this plan
closes them.

**Rules that are load-bearing — do not "simplify" them away:**

1. An unrated row carrying **no hours** must NOT blank an otherwise sound figure. Only rows that book
   hours at a zero rate corrupt the totals. (`uncostedWork` in `budget-report.ts` encodes this.)
2. A bucket `rateOverrideInternal` **wins** over the blend. If the user priced the bucket directly, the
   rate card behind it is irrelevant and must not poison anything.
3. The project rollup predicate `some(...) && every(...)` is shipped and correct. Both halves are
   load-bearing. This plan must preserve it **exactly** — only its inputs change from fields to helpers.

**Commit messages carry no attribution trailer** (no `Co-Authored-By`, no `Claude-Session`, no
"Generated with"). Attribution is disabled globally in this repo.

## Commands

```bash
npx vitest run src/app/budget-rates.test.ts       # one file, fast
npx tsc --noEmit                                  # AUTHORITATIVE typecheck — IDE squiggles lie
npm run lint                                      # CI runs --max-warnings=0; an unused import is FATAL
npm run test:run                                  # full vitest suite (~700 files)
```

**`npx tsc --noEmit` is the authority.** The IDE language server shows phantom "Cannot find module"
errors mid-edit that a real `tsc` run (exit 0) contradicts. Trust `tsc`.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/app/budget-rates.ts` | Pure rate resolution: blended discipline mean, per-bucket overrides | Poison the blend; add two predicates |
| `src/app/budget-report.ts` | Pure budget engine: per-bucket and project rollup | Reason enum, `unpricedDisciplineIds`, derived helpers; delete two boolean fields |
| `src/app/budget-cost-notice.tsx` | **NEW.** Shared per-reason message line | Created in Task 5 |
| `src/app/budget-panel.tsx` | Budget view (bucket cards + project card) | Consume helpers + notice component |
| `src/app/budget-report-panel.tsx` | Budget report view (tiles + detail table) | Same, plus a new `disciplines` prop |
| `src/app/reports.tsx` | Embeds the budget report | Thread `disciplines` |
| `src/app/workspace-section.tsx` | Routes the budget-report view | Thread `disciplines` |
| `src/app/dashboard.ts` | `DashboardBurn` model | Carry the reason instead of two flags |
| `src/app/i18n.ts` / `i18n.de.ts` | EN / DE strings | 3 new keys each |

The notice component is a **separate file on purpose**: the same `<p>` would otherwise be duplicated
verbatim across `budget-panel.tsx` (twice) and `budget-report-panel.tsx`, and the jscpd duplication gate
is **blocking in CI**.

---

## Task 1: Poison the blended rate

**Files:**
- Modify: `src/app/budget-rates.ts`
- Test: `src/app/budget-rates.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("blendedDisciplineRate", ...)` block in
`src/app/budget-rates.test.ts` (it currently ends at line 21):

```typescript
  test("an unpriced grade poisons the internal blend instead of diluting it", () => {
    // Averaging 0 in would yield 50 — a rate nobody entered, which passes every
    // downstream guard and reads as sound. Unknowable is the honest answer.
    const mixed: Role[] = [
      { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 2, disciplineId: 1, gradeId: 2, internalRate: 0, externalRate: 210 },
    ];
    expect(blendedDisciplineRate(1, mixed).internal).toBe(0);
  });

  test("the external blend is deliberately unaffected this slice", () => {
    const mixed: Role[] = [
      { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 2, disciplineId: 1, gradeId: 2, internalRate: 0, externalRate: 210 },
    ];
    expect(blendedDisciplineRate(1, mixed).external).toBe(180);
  });

  test("a fully priced discipline still averages", () => {
    expect(blendedDisciplineRate(1, roles).internal).toBe(120);
  });
});

describe("disciplineHasUnpricedGrade", () => {
  test("true when any role of the discipline is unpriced", () => {
    const mixed: Role[] = [
      { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 2, disciplineId: 1, gradeId: 2, internalRate: 0, externalRate: 210 },
    ];
    expect(disciplineHasUnpricedGrade(1, mixed)).toBe(true);
  });

  test("false when every role of the discipline is priced", () => {
    expect(disciplineHasUnpricedGrade(1, roles)).toBe(false);
  });

  test("false for a discipline with NO roles — that is a different problem", () => {
    // An empty discipline has no grade to price, so calling it "unpriced grades"
    // would send the user hunting for something that does not exist. It already
    // rates 0 and falls to the no-rates message.
    expect(disciplineHasUnpricedGrade(99, roles)).toBe(false);
  });
});

describe("hasInternalOverride", () => {
  test("true for a finite rate >= 0", () => {
    expect(hasInternalOverride({ rateOverrideInternal: 90 })).toBe(true);
    expect(hasInternalOverride({ rateOverrideInternal: 0 })).toBe(true);
  });

  test("false when absent or invalid", () => {
    expect(hasInternalOverride({})).toBe(false);
    expect(hasInternalOverride({ rateOverrideInternal: -5 })).toBe(false);
    expect(hasInternalOverride({ rateOverrideInternal: NaN })).toBe(false);
  });
```

Note the `});` in the middle: the first three tests close the existing
`describe("blendedDisciplineRate")` block, then two new `describe` blocks open. The final
`describe("hasInternalOverride")` block is closed by the file's existing trailing `});`
placement — verify the braces balance after pasting; `npx tsc --noEmit` will catch it if not.

Update the import on line 2 of the same file:

```typescript
import {
  blendedDisciplineRate,
  disciplineHasUnpricedGrade,
  effectiveRates,
  hasInternalOverride,
} from "./budget-rates";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/budget-rates.test.ts`

Expected: FAIL. `disciplineHasUnpricedGrade` and `hasInternalOverride` do not exist (import
error), and the poison test would report `50`.

- [ ] **Step 3: Implement**

In `src/app/budget-rates.ts`, replace the body of `blendedDisciplineRate` (lines 5-16) and add the two
predicates:

```typescript
/** Unweighted mean of the internal/external rates of every Role whose
 *  disciplineId === id. Returns { internal: 0, external: 0 } when the discipline
 *  has no roles.
 *
 *  ★★ An UNPRICED grade poisons the internal blend rather than being averaged in
 *  as a 0. `Role.internalRate` is a required number, so 0 is the only
 *  representation of "nobody has priced this" — it never means a free role.
 *  Averaging it produced a rate nobody entered (100 + unpriced ⇒ 50) that passed
 *  every downstream guard, so the panel presented a diluted cost as sound. A
 *  plausible wrong number is worse than a blank one. */
export function blendedDisciplineRate(id: number, roles: readonly Role[]): RatePair {
  const matched = roles.filter((r) => r.disciplineId === id);
  if (matched.length === 0) return { internal: 0, external: 0 };
  const sum = matched.reduce(
    (acc, r) => ({ internal: acc.internal + r.internalRate, external: acc.external + r.externalRate }),
    { internal: 0, external: 0 },
  );
  return {
    internal: matched.some((r) => r.internalRate <= 0) ? 0 : sum.internal / matched.length,
    // The external mean has the SAME dilution defect (an unpriced role drags it
    // down and understates T&M revenue), left untouched on purpose: gating it
    // cascades into revenue, consumption and T&M win/loss, which are ungated by
    // design because they are knowable without a rate card. That is its own
    // design decision, tracked separately — not an oversight.
    external: sum.external / matched.length,
  };
}

/** True when the discipline has roles and at least one is unpriced. A discipline
 *  with NO roles is false: it has no grade to price, so that guidance would send
 *  the user after something that does not exist. */
export function disciplineHasUnpricedGrade(id: number, roles: readonly Role[]): boolean {
  const matched = roles.filter((r) => r.disciplineId === id);
  return matched.length > 0 && matched.some((r) => r.internalRate <= 0);
}
```

Then, immediately after the existing private `usable` helper (lines 18-21), add:

```typescript
/** True when the bucket prices itself directly, making the rate card behind it
 *  irrelevant — an override wins over the blend, so it must also suppress the
 *  unpriced-grade poison. */
export function hasInternalOverride(
  bucket: Pick<BudgetBucket, "rateOverrideInternal">,
): boolean {
  return usable(bucket.rateOverrideInternal);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/budget-rates.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Verify nothing else regressed**

Run: `npx vitest run src/app/budget-report.test.ts src/app/budget-report-blended.test.ts src/app/budget-panel.test.tsx`

Expected: PASS. The blended fixture in `budget-report-blended.test.ts` prices both its grades
(internalRate 100 and 140), and the mixed-rate fixtures in `budget-report.test.ts` use **detailed**
mode (`roleId` allocations), so neither goes through the changed code path. If anything fails, stop and
report — it means a fixture does exercise a partly-priced discipline and the expectation needs a
deliberate decision, not a silent edit.

- [ ] **Step 6: Mutation-check the new tests**

Temporarily revert the `matched.some(...)` guard to the plain `sum.internal / matched.length` and re-run
`npx vitest run src/app/budget-rates.test.ts`. Expected: the poison test FAILS. Restore the guard.
This proves the test exercises the fix rather than passing for an unrelated reason — two tests in the
previous round passed *before* their fix existed.

- [ ] **Step 7: Commit**

```bash
git add src/app/budget-rates.ts src/app/budget-rates.test.ts
git commit -m "fix(budget): an unpriced grade poisons the blended rate instead of diluting it

Averaging an unpriced role's 0 into the discipline mean produced a rate
nobody entered (100 + unpriced yields 50). It passed hasRatedRow and
uncostedWork, so costIsKnowable stayed true and no notice fired: a bucket
staffed entirely by the unpriced grade was costed at a diluted rate and
presented as sound.

internalRate is a required number, so 0 is the only representation of
unpriced and never means a free role. The external mean has the same
defect and is deliberately left for its own slice."
```

---

## Task 2: Add `costUnknownReason` to the bucket report

Adds the new field **alongside** the existing booleans so the tree keeps compiling and every consumer
keeps working. Task 7 removes the booleans once all consumers have migrated.

**Files:**
- Modify: `src/app/budget-report.ts`
- Test: `src/app/budget-report.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/budget-report.test.ts`:

```typescript
describe("computeBucketReport — costUnknownReason", () => {
  const plan: ResourcePlan = {
    startDate: "2026-01-01", endDate: "2026-01-31", granularity: "month", currency: "EUR",
  };
  const noHolidays = new Set<string>();
  const ratedRoles: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
  const partlyPricedRoles: Role[] = [
    { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
    { id: 2, disciplineId: 1, gradeId: 2, internalRate: 0, externalRate: 210 },
  ];

  function tmBucket(over: Partial<BudgetBucket> = {}): BudgetBucket {
    return {
      id: 1, name: "b", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } }],
      ...over,
    };
  }

  function blendedBucket(over: Partial<BudgetBucket> = {}): BudgetBucket {
    return {
      id: 1, name: "b", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      planningMode: "blended",
      allocations: [],
      disciplineAllocations: [
        { disciplineId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } },
      ],
      ...over,
    };
  }

  test("a fully costable bucket has no reason", () => {
    const rep = computeBucketReport(tmBucket(), plan, ratedRoles, [], 8, noHolidays);
    expect(rep.costUnknownReason).toBeNull();
    expect(rep.unpricedDisciplineIds).toEqual([]);
  });

  test("an empty bucket is no-rows", () => {
    const rep = computeBucketReport(tmBucket({ allocations: [] }), plan, ratedRoles, [], 8, noHolidays);
    expect(rep.costUnknownReason).toBe("no-rows");
  });

  test("rows with no rate at all are no-rates", () => {
    const rateless: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 150 }];
    const rep = computeBucketReport(tmBucket(), plan, rateless, [], 8, noHolidays);
    expect(rep.costUnknownReason).toBe("no-rates");
  });

  test("hours booked at a zero rate beside a rated row are unrated-hours", () => {
    const b = tmBucket({
      allocations: [
        { roleId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } },
        { roleId: 2, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: { "2026-01": 40 } },
      ],
    });
    const roles: Role[] = [
      { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
      { id: 2, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 150 },
    ];
    const rep = computeBucketReport(b, plan, roles, [], 8, noHolidays);
    expect(rep.costUnknownReason).toBe("unrated-hours");
  });

  test("a blended bucket on a partly priced discipline is unpriced-blend and names it", () => {
    const rep = computeBucketReport(blendedBucket(), plan, partlyPricedRoles, [], 8, noHolidays);
    expect(rep.costUnknownReason).toBe("unpriced-blend");
    expect(rep.unpricedDisciplineIds).toEqual([1]);
  });

  test("a bucket internal override beats the poison — the rate card behind it is irrelevant", () => {
    const rep = computeBucketReport(
      blendedBucket({ rateOverrideInternal: 90 }), plan, partlyPricedRoles, [], 8, noHolidays,
    );
    expect(rep.costUnknownReason).toBeNull();
    expect(rep.unpricedDisciplineIds).toEqual([]);
    expect(rep.cost).toBe(10 * 90);
  });

  test("a ZERO override suppresses the naming variant but still reports unrated work", () => {
    // Parity trap. `effectiveRates` treats a 0 override as usable, so the rate
    // resolves to 0 whatever the rate card holds. Gating the poison on `> 0`
    // would name disciplines the override has already overruled — telling the
    // user to fix something that cannot change the outcome. The generic
    // unrated-hours message is the honest one here.
    const rep = computeBucketReport(
      blendedBucket({ rateOverrideInternal: 0 }), plan, partlyPricedRoles, [], 8, noHolidays,
    );
    expect(rep.costUnknownReason).toBe("unrated-hours");
    expect(rep.unpricedDisciplineIds).toEqual([]);
  });

  test("a poisoned discipline carrying NO hours does not blank a sound figure", () => {
    // The shipped rule: an unrated row with no hours contributes nothing to cost,
    // so it must not blank the bucket. The poison inherits that rule.
    const b: BudgetBucket = {
      id: 1, name: "b", type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      planningMode: "blended",
      allocations: [],
      disciplineAllocations: [
        { disciplineId: 2, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } },
        { disciplineId: 1, resourceIds: [], budgetHours: {}, actualHours: {} },
      ],
    };
    const roles: Role[] = [
      ...partlyPricedRoles,
      { id: 3, disciplineId: 2, gradeId: 1, internalRate: 80, externalRate: 120 },
    ];
    const rep = computeBucketReport(b, plan, roles, [], 8, noHolidays);
    expect(rep.costUnknownReason).toBeNull();
    expect(rep.unpricedDisciplineIds).toEqual([]);
  });

  test("the derived helpers agree with the reason", () => {
    const ok = computeBucketReport(tmBucket(), plan, ratedRoles, [], 8, noHolidays);
    const empty = computeBucketReport(tmBucket({ allocations: [] }), plan, ratedRoles, [], 8, noHolidays);
    expect(costIsKnowable(ok)).toBe(true);
    expect(ratesMissing(ok)).toBe(false);
    expect(costIsKnowable(empty)).toBe(false);
    // An empty bucket has no roles to rate, so the rate card is NOT the problem.
    expect(ratesMissing(empty)).toBe(false);
  });
});
```

Add `costIsKnowable` and `ratesMissing` to the existing `budget-report` import at the top of the test
file, and make sure `Role`, `BudgetBucket` and `ResourcePlan` are imported from `./types` (check the
existing imports first — several are already there; do not add a duplicate import statement, and do not
leave an unused one, because CI lint runs `--max-warnings=0` and an unused import is FATAL).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/budget-report.test.ts -t "costUnknownReason"`
Expected: FAIL — `costUnknownReason`, `unpricedDisciplineIds`, `costIsKnowable` and `ratesMissing` do
not exist.

- [ ] **Step 3: Implement the type and the row plumbing**

In `src/app/budget-report.ts`, update the import on line 8:

```typescript
import {
  blendedDisciplineRate,
  disciplineHasUnpricedGrade,
  effectiveRates,
  hasInternalOverride,
  type RatePair,
} from "./budget-rates";
```

Add the reason type and the two helpers near the top of the file, directly above `export type
BucketReport` (which begins around line 90):

```typescript
/**
 * Why a bucket's or project's internal-cost figures (cost, margin, burn) have no
 * sound basis. `null` means they do.
 *
 * ONE field rather than a pair of booleans because there are FOUR distinct
 * states and each needs its own message. Two booleans encoded three states and
 * left the surface to INFER which message applied — that inference is what put
 * "set them on the rate card" on a bucket that has no roles at all.
 */
export type CostUnknownReason =
  /** No allocations at all — nothing to cost, and no rate card to fix. */
  | "no-rows"
  /** Rows exist but not one carries an internal rate. */
  | "no-rates"
  /** Some row books hours at a zero rate: those hours land in cost as 0, so the
   *  figure is not unknown but WRONG. */
  | "unrated-hours"
  /** A blended row's discipline has unpriced grades, so its mean is unknowable.
   *  A refinement of `unrated-hours` that can name the disciplines to fix. */
  | "unpriced-blend";

/** The cost figures have a sound basis. */
export function costIsKnowable(r: { costUnknownReason: CostUnknownReason | null }): boolean {
  return r.costUnknownReason === null;
}

/** A rate really is missing, so pointing the user at the rate card is right
 *  guidance. Every reason but `no-rows`, which has no roles to rate. */
export function ratesMissing(r: { costUnknownReason: CostUnknownReason | null }): boolean {
  return r.costUnknownReason !== null && r.costUnknownReason !== "no-rows";
}
```

Extend `RateRow` (currently lines 133-138):

```typescript
export type RateRow = {
  rates: RatePair;
  budgetHours: Record<string, number>;
  actualHours: Record<string, number>;
  resourceIds: readonly number[];
  /** Set ONLY on a blended row whose discipline has unpriced grades and whose
   *  bucket does not override the internal rate. Drives the named message. */
  unpricedBlendDisciplineId?: number;
};
```

Replace the blended branch of `bucketRateRows` (currently lines 143-150):

```typescript
  if (bucket.planningMode === "blended") {
    // An internal override wins over the blend, so it also clears the poison:
    // a bucket that overrides does not care what the rate card holds.
    //
    // ★★ Parity with `effectiveRates` is load-bearing. It treats a 0 override as
    // usable, so gating this on `> 0` instead would diverge: the bucket would be
    // told to price disciplines its own override has already overruled. A 0
    // override resolves to a 0 rate and is caught below as unrated work, which
    // is the honest signal — only the discipline-NAMING variant is suppressed,
    // and suppressing it there is correct because naming them would misdirect.
    const overridden = hasInternalOverride(bucket);
    return (bucket.disciplineAllocations ?? []).map((a) => ({
      rates: effectiveRates(bucket, blendedDisciplineRate(a.disciplineId, roles)),
      budgetHours: a.budgetHours,
      actualHours: a.actualHours,
      resourceIds: a.resourceIds,
      unpricedBlendDisciplineId:
        !overridden && disciplineHasUnpricedGrade(a.disciplineId, roles) ? a.disciplineId : undefined,
    }));
  }
```

- [ ] **Step 4: Implement the reason derivation**

In `computeBucketReport`, add the collector beside the existing `uncostedWork` flag. Replace the
declaration and the loop body's flag line (currently line 224 and line 233):

```typescript
  let uncostedWork = false;
  // Disciplines whose poisoned blend actually carries hours. Gated on hours by
  // the SAME rule as `uncostedWork`: a row with no hours contributes nothing to
  // cost, so it must not blank an otherwise sound figure.
  const unpricedDisciplineIds: number[] = [];
```

and, inside the `for (const row of rows)` loop, replace line 233:

```typescript
    if (internal <= 0 && (aActual !== 0 || aBudget !== 0)) {
      uncostedWork = true;
      if (row.unpricedBlendDisciplineId != null) unpricedDisciplineIds.push(row.unpricedBlendDisciplineId);
    }
```

Then, directly after the existing `costIsKnowable` / `ratesAreMissing` consts (lines 242-245), add:

```typescript
  // Order is a derivation order of mutually exclusive checks, not a ranking.
  // `unpriced-blend` MUST precede `no-rates`: a poisoned blend also makes its row
  // unrated, so testing `no-rates` first would mean the better, discipline-naming
  // message is never reached.
  const costUnknownReason: CostUnknownReason | null =
    rows.length === 0 ? "no-rows"
    : unpricedDisciplineIds.length > 0 ? "unpriced-blend"
    : !hasRatedRow ? "no-rates"
    : uncostedWork ? "unrated-hours"
    : null;
```

Add both to the returned object (after `ratesAreMissing,` on line 292):

```typescript
    costUnknownReason,
    unpricedDisciplineIds,
```

And to the `BucketReport` type, after `ratesAreMissing: boolean;` (line 125):

```typescript
  /** Why the cost figures are unknowable, or null when they are sound. Single
   *  source for which message a surface renders. */
  costUnknownReason: CostUnknownReason | null;
  /** Disciplines with unpriced grades that carry hours here. Non-empty only when
   *  the reason is "unpriced-blend"; surfaces resolve the names. */
  unpricedDisciplineIds: number[];
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/budget-report.test.ts`
Expected: PASS, including every pre-existing test — the booleans are untouched this task.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Mutation-check**

Swap the `unpricedDisciplineIds.length > 0` and `!hasRatedRow` arms of the ternary and re-run
`npx vitest run src/app/budget-report.test.ts`. Expected: the `unpriced-blend` test FAILS (it would
report `no-rates`). Restore the order. This proves the ordering comment is enforced by a test rather
than by hope.

- [ ] **Step 8: Commit**

```bash
git add src/app/budget-report.ts src/app/budget-report.test.ts
git commit -m "feat(budget): carry WHY cost is unknown, not just whether

Two booleans encoded three states and left each surface to infer which
message applied. That inference is what printed 'set them on the rate
card' on a bucket with no roles at all.

costUnknownReason names the state; unpricedDisciplineIds lets the blended
case point at the disciplines to fix. The poison inherits the shipped
no-hours rule: a row booking nothing cannot blank a sound figure.

The old booleans stay for now so every consumer keeps compiling."
```

---

## Task 3: Project rollup reason

**Files:**
- Modify: `src/app/budget-report.ts`
- Test: `src/app/budget-report.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/budget-report.test.ts`:

```typescript
describe("computeBudgetReport — project costUnknownReason", () => {
  const plan: ResourcePlan = {
    startDate: "2026-01-01", endDate: "2026-01-31", granularity: "month", currency: "EUR",
  };
  const noHolidays = new Set<string>();
  const roles: Role[] = [
    { id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
    { id: 2, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 150 },
  ];

  function bucket(id: number, roleId: number): BudgetBucket {
    return {
      id, name: `b${id}`, type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      allocations: [{ roleId, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } }],
    };
  }

  test("a costable project has no reason", () => {
    const rep = computeBudgetReport([bucket(1, 1)], plan, roles, [], 8, noHolidays);
    expect(rep.project.costUnknownReason).toBeNull();
  });

  test("a project with no buckets is no-rows", () => {
    const rep = computeBudgetReport([], plan, roles, [], 8, noHolidays);
    expect(rep.project.costUnknownReason).toBe("no-rows");
  });

  test("the reason comes from the failing bucket, not the healthy one", () => {
    const rep = computeBudgetReport([bucket(1, 1), bucket(2, 2)], plan, roles, [], 8, noHolidays);
    expect(rep.project.costUnknownReason).toBe("unrated-hours");
  });

  test("hours costed at zero outrank an empty bucket — severity, not derivation order", () => {
    const empty: BudgetBucket = { ...bucket(3, 1), allocations: [] };
    const rep = computeBudgetReport([bucket(1, 2), empty], plan, roles, [], 8, noHolidays);
    // The empty bucket contributes nothing; the corrupted total is what the PM
    // needs told. Surfacing "no allocations yet" here would be backwards.
    expect(rep.project.costUnknownReason).toBe("unrated-hours");
  });

  test("costIsKnowable and the reason never disagree", () => {
    const rep = computeBudgetReport([bucket(1, 1), bucket(2, 2)], plan, roles, [], 8, noHolidays);
    expect(rep.project.costIsKnowable).toBe(costIsKnowable(rep.project));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/budget-report.test.ts -t "project costUnknownReason"`
Expected: FAIL — `project.costUnknownReason` is `undefined`.

- [ ] **Step 3: Implement**

In `src/app/budget-report.ts`, add to the `ProjectReport` type after `ratesAreMissing: boolean;`
(line 320):

```typescript
  /** Why the project's cost figures are unknowable, or null when they are sound.
   *  Always agrees with `costIsKnowable` — pinned by a test. */
  costUnknownReason: CostUnknownReason | null;
  /** Union of the failing buckets' unpriced disciplines, deduped. */
  unpricedDisciplineIds: number[];
```

Add this module-level constant directly above `export function computeBudgetReport` (line 355):

```typescript
/**
 * Project reason precedence, by SEVERITY OF DISTORTION — deliberately NOT the
 * bucket-level derivation order, which is a sequence of mutually exclusive
 * checks and carries no ranking. Real hours costed at zero actively corrupt the
 * total, so they outrank a missing rate card, which outranks a bucket that
 * simply has nothing in it.
 */
const REASON_SEVERITY: readonly CostUnknownReason[] = [
  "unrated-hours", "unpriced-blend", "no-rates", "no-rows",
];
```

Inside `computeBudgetReport`, immediately before the `const project: ProjectReport = {` literal
(line 382), insert:

```typescript
  // The shipped rollup predicate, unchanged — only its inputs moved from fields
  // to helpers. Both halves stay load-bearing; see the comment on the field.
  const projectCostIsKnowable =
    reports.some((b) => costIsKnowable(b)) &&
    reports.every((b) => costIsKnowable(b) || (b.revenue === 0 && !ratesMissing(b)));
  // Buckets that actually break the rollup. When NOTHING is costable the `some`
  // half fails while `every` passes, so that set is empty — fall back to every
  // non-costable bucket, or the project would report a null reason while
  // declaring itself unknowable.
  const breaking = reports.filter((b) => !costIsKnowable(b) && !(b.revenue === 0 && !ratesMissing(b)));
  const blamed = projectCostIsKnowable
    ? []
    : breaking.length > 0 ? breaking : reports.filter((b) => !costIsKnowable(b));
  const projectReason: CostUnknownReason | null = projectCostIsKnowable
    ? null
    // A project with no buckets has no blamed bucket to read a reason from, and
    // "nothing here" is exactly right for it.
    : REASON_SEVERITY.find((rsn) => blamed.some((b) => b.costUnknownReason === rsn)) ?? "no-rows";
```

Then replace the `costIsKnowable:` entry in the `project` literal (lines 423-425) with a reference to
the pre-computed value, and add the two new fields after `ratesAreMissing` (line 428):

```typescript
    costIsKnowable: projectCostIsKnowable,
    ratesAreMissing: reports.some((b) => b.ratesAreMissing),
    costUnknownReason: projectReason,
    unpricedDisciplineIds: [...new Set(blamed.flatMap((b) => b.unpricedDisciplineIds))],
```

Keep the entire existing comment block above `costIsKnowable` in place — it documents why both halves
of the predicate are load-bearing and is the most valuable text in the file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/budget-report.test.ts`
Expected: PASS, including the pre-existing rollup tests — the predicate is byte-identical in behaviour.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/budget-report.ts src/app/budget-report.test.ts
git commit -m "feat(budget): project rollup carries a reason too

Its precedence is severity of distortion, NOT the bucket-level derivation
order: hours costed at zero corrupt the total and outrank a bucket that
merely has nothing in it. Reusing the derivation order would have surfaced
'no allocations yet' over a wrong number.

The shipped some/every predicate is unchanged — only its inputs moved from
fields to helpers."
```

---

## Task 4: i18n strings

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

Three new keys. `npx tsc --noEmit` enforces EN/DE key parity, so both files must gain all three.

- [ ] **Step 1: Add the EN strings**

In `src/app/i18n.ts`, directly after the `budgetNoInternalRates` line (line 2747), add:

```typescript
  budgetNoAllocations: "No allocations yet, so cost, margin and burn cannot be calculated. Add a role or discipline line.",
  budgetUnratedHours: "Some hours are booked against roles with no internal rate, so cost, margin and burn would be understated. Set the missing rates on the rate card under Resources → Roles.",
  budgetUnpricedBlend: "Blended rates cannot be calculated — grades with no internal rate in: {0}. Set them on the rate card under Resources → Roles.",
```

`{0}` is this codebase's 0-based positional placeholder; `t(lang, key, a, b)` fills `{0}`/`{1}`. The
phrasing avoids "has/have" on purpose so one string covers a single discipline and several.

- [ ] **Step 2: Add the DE strings via a node UTF-8 write**

**Do NOT use the Edit tool on `i18n.de.ts`.** It corrupts umlauts and curls double quotes, and the file
is CRLF so an anchor written with `\n` silently matches nothing and no-ops. Write this script to
`scripts/tmp-de-i18n.mjs`, run it, then delete it:

```javascript
import { readFileSync, writeFileSync } from "node:fs";

const path = "src/app/i18n.de.ts";
const src = readFileSync(path, "utf8");

const anchor = "  budgetNoInternalRates: \"Für die Rollen dieses Budgetblocks sind keine internen Sätze hinterlegt, daher können Kosten, Marge und Kostenverbrauch nicht berechnet werden. Sie werden in der Ratecard unter Ressourcen → Rollen gepflegt.\",\r\n";

if (!src.includes(anchor)) {
  throw new Error("anchor not found — check CRLF line endings and exact text");
}

const added =
  anchor +
  "  budgetNoAllocations: \"Noch keine Zuordnungen vorhanden, daher können Kosten, Marge und Kostenverbrauch nicht berechnet werden. Fügen Sie eine Rollen- oder Disziplinzeile hinzu.\",\r\n" +
  "  budgetUnratedHours: \"Es sind Stunden auf Rollen ohne internen Satz gebucht, daher wären Kosten, Marge und Kostenverbrauch zu niedrig. Pflegen Sie die fehlenden Sätze in der Ratecard unter Ressourcen → Rollen.\",\r\n" +
  "  budgetUnpricedBlend: \"Mischsätze können nicht berechnet werden — Stufen ohne internen Satz in: {0}. Pflegen Sie sie in der Ratecard unter Ressourcen → Rollen.\",\r\n";

writeFileSync(path, src.replace(anchor, added), "utf8");
console.log("ok");
```

Run: `node scripts/tmp-de-i18n.mjs` — expected output `ok`. It **throws** rather than silently doing
nothing if the anchor misses. Then: `rm scripts/tmp-de-i18n.mjs`

- [ ] **Step 3: Verify the umlauts survived**

Run: `npx vitest run src/app/i18n-encoding.test.ts`

Expected: PASS. That suite BANS ASCII substitutions (`fuer`, `druecken`) and requires real German
umlauts. Then eyeball the three new lines:

Run: `grep -n "budgetNoAllocations\|budgetUnratedHours\|budgetUnpricedBlend" src/app/i18n.de.ts`

Expected: `Fügen`, `wären`, `Sätze`, `Mischsätze`, `können` all render as proper umlauts, and the
quotes are straight `"` not curled `"`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. A missing key in either file fails here — that is the parity gate.

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n(budget): a message for each cost-unknown reason

An empty bucket showed a bare dash with no explanation, because the only
message available said to go fix a rate card it has no roles for."
```

---

## Task 5: Shared notice component

One component, not duplicated JSX: the same `<p>` would otherwise appear three times across two files,
and the jscpd duplication gate is **blocking in CI**.

**Files:**
- Create: `src/app/budget-cost-notice.tsx`
- Test: `src/app/budget-cost-notice.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/budget-cost-notice.test.tsx`:

```tsx
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { CostUnknownNotice } from "./budget-cost-notice";

describe("CostUnknownNotice", () => {
  test("renders nothing when cost is knowable", () => {
    const { container } = render(
      <CostUnknownNotice lang="en-US" reason={null} disciplineNames={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("an empty bucket is told it has no allocations, NOT to fix a rate card", () => {
    render(<CostUnknownNotice lang="en-US" reason="no-rows" disciplineNames={[]} />);
    expect(screen.getByText(/no allocations yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/rate card/i)).not.toBeInTheDocument();
  });

  test("no-rates points at the rate card", () => {
    render(<CostUnknownNotice lang="en-US" reason="no-rates" disciplineNames={[]} />);
    expect(screen.getByText(/no internal rates are set/i)).toBeInTheDocument();
  });

  test("unrated-hours says the figures would be understated", () => {
    render(<CostUnknownNotice lang="en-US" reason="unrated-hours" disciplineNames={[]} />);
    expect(screen.getByText(/understated/i)).toBeInTheDocument();
  });

  test("unpriced-blend names the disciplines", () => {
    render(
      <CostUnknownNotice lang="en-US" reason="unpriced-blend" disciplineNames={["Design", "QA"]} />,
    );
    expect(screen.getByText(/Design, QA/)).toBeInTheDocument();
  });

  test("unpriced-blend with no resolvable names falls back to the rate-card message", () => {
    // Naming nothing would print a dangling "in: ." — the generic message is
    // still true and still actionable.
    render(<CostUnknownNotice lang="en-US" reason="unpriced-blend" disciplineNames={[]} />);
    expect(screen.getByText(/no internal rates are set/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/budget-cost-notice.test.tsx`
Expected: FAIL — cannot resolve `./budget-cost-notice`.

- [ ] **Step 3: Implement**

Create `src/app/budget-cost-notice.tsx`:

```tsx
"use client";

import { type Lang, t } from "./i18n";
import type { CostUnknownReason } from "./budget-report";

/** One message per reason. An exhaustive Record so tsc forces a message for any
 *  reason added later — the surface must never be left to infer one, which is
 *  how "set them on the rate card" ended up on a bucket with no roles. */
const REASON_KEY: Record<CostUnknownReason, Parameters<typeof t>[1]> = {
  "no-rows": "budgetNoAllocations",
  "no-rates": "budgetNoInternalRates",
  "unrated-hours": "budgetUnratedHours",
  "unpriced-blend": "budgetUnpricedBlend",
};

/**
 * The muted line under a budget card explaining why cost, margin and burn are
 * dashes. Renders nothing when they are sound.
 *
 * Muted guidance, NOT a warning banner: an empty bucket is a normal early state
 * and must not nag.
 */
export function CostUnknownNotice({
  lang, reason, disciplineNames,
}: {
  lang: Lang;
  reason: CostUnknownReason | null;
  /** Resolved names for `unpricedDisciplineIds`; ignored for other reasons. */
  disciplineNames: readonly string[];
}) {
  if (reason === null) return null;
  // The named variant needs names. With none resolvable it would print a
  // dangling "in: ." — the generic rate-card message is still true.
  const named = reason === "unpriced-blend" && disciplineNames.length > 0;
  const text = named
    ? t(lang, "budgetUnpricedBlend", disciplineNames.join(", "))
    : t(lang, REASON_KEY[reason === "unpriced-blend" ? "no-rates" : reason]);
  return <p className="mt-2 text-xs text-muted-foreground">{text}</p>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/budget-cost-notice.test.tsx`
Expected: PASS, all six tests.

- [ ] **Step 5: Mutation-check**

Change the `no-rows` entry of `REASON_KEY` to `"budgetNoInternalRates"` and re-run. Expected: the
"NOT to fix a rate card" test FAILS. Restore. That test is the original defect and must be able to
catch its return.

- [ ] **Step 6: Commit**

```bash
git add src/app/budget-cost-notice.tsx src/app/budget-cost-notice.test.tsx
git commit -m "feat(budget): shared per-reason cost-unknown notice

One component rather than the same paragraph in three places — the
duplication gate is blocking, and a shared message cannot drift between
the two budget surfaces the way two copies would."
```

---

## Task 6: Migrate the surfaces

**Files:**
- Modify: `src/app/budget-panel.tsx:407-415`, `:494`, `:504-514`
- Modify: `src/app/budget-report-panel.tsx:41-60`, `:93`, `:117-121`, `:192-217`
- Modify: `src/app/reports.tsx:272`
- Modify: `src/app/workspace-section.tsx:706-720`
- Modify: `src/app/dashboard.ts:180-189`, `:305-311`
- Test: `src/app/budget-panel.test.tsx`, `src/app/budget-report-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Two changes to `src/app/budget-panel.test.tsx`.

**(a)** The file already has a test at line ~145, `"a bucket with no allocations yet does NOT claim its
rate card is missing"`, which asserts the *absence* of the wrong message. Add the positive half to it —
the whole point of this work is that the dash now explains itself. Its last line is currently:

```tsx
    expect(screen.queryByText(/no internal rates/i)).not.toBeInTheDocument();
  });
```

Make it:

```tsx
    expect(screen.queryByText(/no internal rates/i)).not.toBeInTheDocument();
    // ...and it IS told what the actual problem is. Absence of the wrong
    // message was only half the fix: a bare dash explained nothing.
    expect(screen.getAllByText(/no allocations yet/i).length).toBeGreaterThan(0);
  });
```

`getAllByText` because both the bucket card and the project rollup render the line — a bare
`getByText` throws on the second match rather than failing the claim being made (the convention the
file already follows at line ~139).

**(b)** Append a new describe block at the end of the file, using the module-level `props`, `plan` and
`buckets` fixtures it already defines:

```tsx
describe("BudgetPanel — blended bucket on a partly priced discipline", () => {
  // Discipline 1 has a priced grade and an unpriced one. Averaging the 0 in
  // yielded 50 — a rate nobody entered, presented as sound.
  const partlyPricedRoles: Role[] = [
    { id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
    { id: 4, disciplineId: 1, gradeId: 2, internalRate: 0, externalRate: 210 },
  ];
  const blendedBuckets: BudgetBucket[] = [{
    id: 1, name: "PAM", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-06-30", status: "open",
    planningMode: "blended",
    allocations: [],
    disciplineAllocations: [
      { disciplineId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 80 } },
    ],
  }];

  test("names the discipline to price instead of costing at a diluted rate", () => {
    render(
      <BudgetPanel
        {...props}
        buckets={blendedBuckets}
        roles={partlyPricedRoles}
        disciplines={[{ id: 1, name: "Design" }]}
      />,
    );
    expect(screen.getAllByText(/Design/).length).toBeGreaterThan(0);
    // 80h × the diluted 50 would be a cost of 4,000 presented as real.
    expect(screen.queryAllByText("100.0%")).toHaveLength(0);
  });

  test("a bucket rate override beats the poison and costs normally", () => {
    render(
      <BudgetPanel
        {...props}
        buckets={[{ ...blendedBuckets[0], rateOverrideInternal: 90 }]}
        roles={partlyPricedRoles}
        disciplines={[{ id: 1, name: "Design" }]}
      />,
    );
    expect(screen.queryByText(/grades with no internal rate/i)).not.toBeInTheDocument();
  });
});
```

`Discipline` is `{ id: number; name: string; localModifiedAt?: string }`, so the inline literals above
typecheck as-is.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/budget-panel.test.tsx -t "cost-unknown messages"`
Expected: FAIL — the empty bucket currently renders no message at all.

- [ ] **Step 3: Migrate `budget-panel.tsx`**

Add to the `budget-report` import at the top of the file:

```typescript
import { costIsKnowable } from "./budget-report";
```

(keep the existing named imports from that module; add to them rather than writing a second import
statement.) And:

```typescript
import { CostUnknownNotice } from "./budget-cost-notice";
```

Add this helper inside the component, above the `return`, so both card levels resolve names the same
way:

```typescript
  const disciplineNamesFor = (ids: readonly number[]) =>
    ids.map((id) => props.disciplines.find((d) => d.id === id)?.name).filter((n): n is string => !!n);
```

Replace the project notice (lines 411-415):

```tsx
        <CostUnknownNotice
          lang={lang}
          reason={report.project.costUnknownReason}
          disciplineNames={disciplineNamesFor(report.project.unpricedDisciplineIds)}
        />
```

Replace the bucket notice (lines 510-514):

```tsx
              <CostUnknownNotice
                lang={lang}
                reason={br.costUnknownReason}
                disciplineNames={disciplineNamesFor(br.unpricedDisciplineIds)}
              />
```

Replace the four `!report.project.costIsKnowable` / `!br.costIsKnowable` reads with the helper —
lines 407, 408, 494, 504, 505:

- line 407: `unknown={!costIsKnowable(report.project)}`
- line 408: `unknown={!costIsKnowable(report.project)}`
- line 494: `{!costIsKnowable(br) && br.type === "fixed" ? "—" : (`
- line 504: `unknown={!costIsKnowable(br)}`
- line 505: `unknown={!costIsKnowable(br)}`

- [ ] **Step 4: Migrate `budget-report-panel.tsx`**

Add `disciplines` to the `Props` interface (after `roles`, line 44):

```typescript
  disciplines: readonly Discipline[];
```

Add `Discipline` to the `./types` import on line 21, add `disciplines` to the destructured parameter
list on line 58-61, and add these imports:

```typescript
import { computeBudgetReport, costIsKnowable, type BucketReport, type CciValue } from "./budget-report";
import { CostUnknownNotice } from "./budget-cost-notice";
```

Replace line 93:

```typescript
  const costUnknown = !costIsKnowable(proj);
```

Replace the project notice (lines 117-121):

```tsx
        <CostUnknownNotice
          lang={lang}
          reason={proj.costUnknownReason}
          disciplineNames={proj.unpricedDisciplineIds
            .map((id) => disciplines.find((d) => d.id === id)?.name)
            .filter((n): n is string => !!n)}
        />
```

In `BucketDetailTable`'s `mapped` memo, replace lines 210 and 213:

```typescript
          marginPct: costIsKnowable(r) ? r.contributionMargin.percent : null,
          winLossUnknown: !costIsKnowable(r) && r.type === "fixed",
```

- [ ] **Step 5: Thread `disciplines` from both call sites**

`src/app/reports.tsx` line 272 — add `disciplines={disciplines}` to the `<BudgetReportPanel>` props.
The variable is already destructured at line 57.

`src/app/workspace-section.tsx` line 706 — add `disciplines={disciplines}` to the `<BudgetReportPanel>`
props. The variable is already destructured from `useWorkspace()` at line 218.

- [ ] **Step 6: Migrate `dashboard.ts`**

Replace the two fields in `DashboardBurn` (lines 187-188) with:

```typescript
  costUnknownReason: CostUnknownReason | null;
```

Keep the whole existing comment block above them — it explains why the flag travels with the data.
Add `CostUnknownReason` to the `./budget-report` import at the top of the file.

Replace line 310 in the `burn` literal:

```typescript
        costUnknownReason: project.costUnknownReason,
```

Update `src/app/dashboard.test.ts` lines 34-35 to match:

```typescript
    costUnknownReason: null,
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npx vitest run src/app/budget-panel.test.tsx src/app/budget-report-panel.test.tsx src/app/dashboard.test.ts
npx tsc --noEmit
npm run lint
```

Expected: all PASS, `tsc` exit 0, lint clean. Lint runs `--max-warnings=0` in CI, so a now-unused
import is a build failure — check that nothing was orphaned.

- [ ] **Step 8: Commit**

```bash
git add src/app/budget-panel.tsx src/app/budget-report-panel.tsx src/app/reports.tsx src/app/workspace-section.tsx src/app/dashboard.ts src/app/dashboard.test.ts src/app/budget-panel.test.tsx
git commit -m "feat(budget): surfaces render the reason, and stop inferring it

An empty bucket showed a bare dash with nothing to explain it, because the
only message available told the user to fix a rate card it has no roles
for. Each state now carries its own line, and a poisoned blend names the
disciplines to price."
```

---

## Task 7: Delete the two booleans

Now that every consumer reads the helpers, the fields go. This is what makes the reason the single
source of truth rather than a third thing that can drift from the other two.

**Files:**
- Modify: `src/app/budget-report.ts`
- Test: `src/app/budget-report.test.ts`

- [ ] **Step 1: Delete the fields**

In `src/app/budget-report.ts`:

- Remove `costIsKnowable: boolean;` and `ratesAreMissing: boolean;` plus their doc comments from
  `BucketReport` (lines 116-125) and from `ProjectReport` (lines 312-320). Keep the surrounding
  comment prose about the rollup by moving it onto `costUnknownReason` where it still applies.
- Remove the `const costIsKnowable = ...` and `const ratesAreMissing = ...` locals in
  `computeBucketReport` (lines 242-245) — note the local `costIsKnowable` const would otherwise
  **shadow the exported helper of the same name**, so this deletion is required, not cosmetic.
- Remove `costIsKnowable,` and `ratesAreMissing,` from the bucket return object (lines 291-292).
- Remove `costIsKnowable: projectCostIsKnowable,` and `ratesAreMissing: ...` from the project literal.
- Keep `hasRatedRow` and `uncostedWork` — the reason derivation still uses both.

- [ ] **Step 2: Run the typecheck to find every remaining consumer**

Run: `npx tsc --noEmit`

Expected: errors listing every site still reading the removed fields — that list IS the work. Fix each
by calling `costIsKnowable(x)` / `ratesMissing(x)`. Expect hits in `budget-report.test.ts` (the
pre-existing assertions from the 0.195.x work) and possibly `budget-panel.test.tsx`.

Rewrite each test assertion mechanically:

```typescript
// before
expect(report.buckets[0].costIsKnowable).toBe(false);
expect(report.buckets[0].ratesAreMissing).toBe(true);
// after
expect(costIsKnowable(report.buckets[0])).toBe(false);
expect(ratesMissing(report.buckets[0])).toBe(true);
```

**Do not weaken an assertion to make it pass.** Every one of these encodes a shipped defect. If one
genuinely cannot hold any more, stop and report which and why — reversing an expectation is sometimes
right, but it is never right silently.

- [ ] **Step 3: Verify the full suite**

```bash
npx tsc --noEmit
npm run test:run
npm run lint
```

Expected: `tsc` exit 0, all tests pass, lint clean.

If `chat-panel.test.tsx` reports one or two failures under full-suite load but passes in isolation, that
is a known PBKDF2/WebCrypto worker-starvation flake, not a regression — confirm by re-running that file
alone before dismissing it.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(budget): the reason is the single source of truth

costIsKnowable and ratesAreMissing become derived helpers. Two booleans
plus an enum would be three places to keep in agreement, and the pair
drifting from the message is the shape that caused this family of defects.

The local costIsKnowable const also shadowed the exported helper, so this
removal was required rather than cosmetic."
```

---

## Task 8: Extend the combinatorial invariant

The 0.195.1 work added an enumeration over bucket KINDS because five rounds of hand-picked scenarios
kept missing the next case. A new kind exists now, so it joins the enumeration.

**Files:**
- Modify: `src/app/budget-report.test.ts:473-535`

- [ ] **Step 1: Add the kind and the invariant**

In the existing `describe("computeBudgetReport — project cost-knowability invariant", ...)` block, add
a partly-priced discipline to the roles and a blended bucket kind. Add to the fixtures at the top of
that describe (near lines 474-475):

```typescript
  const blendRoles: Role[] = [
    { id: 3, disciplineId: 9, gradeId: 1, internalRate: 100, externalRate: 150 },
    { id: 4, disciplineId: 9, gradeId: 2, internalRate: 0, externalRate: 210 },
  ];
```

Add to the `kinds` object:

```typescript
    partlyPricedBlend: (id: number): BudgetBucket => ({
      id, name: `blend-${id}`, type: "tm", currency: "EUR",
      startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
      planningMode: "blended",
      allocations: [],
      disciplineAllocations: [
        { disciplineId: 9, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } },
      ],
    }),
```

Line 506 of the same file currently reads `const roles = [...rated, ...rateless];`. Change it to:

```typescript
  const roles = [...rated, ...rateless, ...blendRoles];
```

`blendRoles` uses `disciplineId: 9` and ids 3/4 precisely so it cannot collide with the existing
`rated` (id 1, discipline 1) and `rateless` (id 2, discipline 1) fixtures — the detailed-mode kinds
allocate by `roleId` and must keep behaving exactly as before.

Add this invariant inside the per-combination test body, beside the existing poisoned-bucket check:

```typescript
      // The project's verdict must follow from its BUCKETS' reasons. Expressed
      // over the output rather than over the rollup expression, matching this
      // block's existing style, so it stays a real check if that expression is
      // rewritten.
      //
      // ★ NOT `costIsKnowable(project) === (project.costUnknownReason === null)`
      // — the helper is DEFINED as that comparison, so it asserts x === x and
      // survives any mutation. Vacuous.
      const expected =
        report.buckets.some((b) => b.costUnknownReason === null) &&
        report.buckets.every((b) => b.costUnknownReason === null || (b.revenue === 0 && !ratesMissing(b)));
      expect(costIsKnowable(report.project)).toBe(expected);
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/app/budget-report.test.ts`

Expected: PASS for every combination. The enumeration is `names` singly plus every ordered pair, so
adding one kind adds a meaningful number of cases. **If any combination fails, that is a real finding —
report it rather than adjusting the invariant.** Reverting the rollup rule made 8 combinations fail
last time, one of which no hand-written test covered.

- [ ] **Step 3: Mutation-check the invariant**

In `computeBudgetReport`, temporarily change `projectCostIsKnowable` to always evaluate `true`. Re-run
`npx vitest run src/app/budget-report.test.ts`.

Expected: FAILURES on the combinations containing an uncostable revenue-bearing bucket — both the new
agreement invariant and the pre-existing poisoned-bucket check (which is gated on the project claiming
knowability, so a mutation that always claims it opens that gate). Restore.

If **nothing** fails, stop: the invariant is vacuous and needs rewriting before this task is done.

- [ ] **Step 4: Full gate and commit**

```bash
npx tsc --noEmit
npm run lint
npm run test:run
npm run dup:check
npm run size:check
```

Expected: all pass. `dup:check` matters here — the notice component exists specifically to keep the
three message sites from becoming clones.

```bash
git add src/app/budget-report.test.ts
git commit -m "test(budget): the new blended kind joins the combinatorial invariant

Hand-picked scenarios missed the next case for five rounds; the kind
enumeration is what caught the rollup contamination. A partly-priced
blended bucket is a new kind, so it belongs in the enumeration, and the
reason/flag agreement is now asserted for every bucket in every
combination."
```

---

## Verification before calling this done

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm run lint` clean (CI uses `--max-warnings=0`)
- [ ] `npm run test:run` green
- [ ] `npm run dup:check` and `npm run size:check` pass
- [ ] `grep -rn "ratesAreMissing\|\.costIsKnowable" src/app --include=*.ts --include=*.tsx` returns only
      the helper definitions and helper CALLS — no surviving field reads
- [ ] Umlauts intact: `grep -n "budgetUnpricedBlend" src/app/i18n.de.ts` shows real `ä`/`ö`/`ü`
- [ ] `git status` clean, no `scripts/tmp-de-i18n.mjs` left behind

## Release checklist (only on the user's explicit "release")

Not part of implementation. When the user says "release":
bump `src/app/version.ts` (APP_VERSION + milestone, codename unused in `CHANGELOG.md`), add a CHANGELOG
entry, append any new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` with EN+DE strings, then
push → MR → poll pipeline → **merge only on green**.

## Out of scope

- **External-rate blend dilution.** Same defect on the other axis; gating it cascades into revenue,
  consumption and T&M win/loss, which are ungated by design. Its own slice.
- **Phase C** (real EV/AC Cost Performance Index) — plan already at
  `docs/superpowers/plans/2026-07-21-budget-panel-correctness-and-evm.md`, tasks C1–C6.
