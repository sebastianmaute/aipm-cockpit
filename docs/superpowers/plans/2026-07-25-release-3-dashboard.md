# Release 3 — Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three R3 dashboard slices — an overdue-resource action that lands on Open Points filtered to that person, a burn-down whose x-axis follows the budget buckets' successor chain (with a warning when they aren't chained), and a rich-text status narrative.

**Architecture:** Three independent slices. 3.1 adds one arm to the `ActionCta` union plus a surface-level executor; 3.2 adds a pure chain resolver and an optional period-slice to the existing burn-down engine, consumed by both burn-down surfaces; 3.3 swaps the narrative textarea for the existing lean `RichTextEditor` with sink-only sanitisation. No new persisted `Workspace` field, no six-write-path chore, no golden-fixture regeneration.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4 (`ui-*` tokens only), vitest + @testing-library/react, Playwright + axe for the a11y gate.

**Spec:** `docs/superpowers/specs/2026-07-25-r3-dashboard-design.md`

**Standing rules for every task**
- Use the existing design-system primitive. Do NOT hand-roll a control, banner, button, field or popover — if none fits, STOP and ask.
- `npx tsc --noEmit` after editing ANY test file (vitest never typechecks).
- `npm run lint` is `--max-warnings=0`: an unused import or var is FATAL.
- Never edit `i18n.de.ts` with the Edit tool (it corrupts umlauts and the file is CRLF) — use the node script given in Task 6.

---

## Task 1: Pure bucket-chain resolver

**Files:**
- Create: `src/app/budget-bucket-chain.ts`
- Test: `src/app/budget-bucket-chain.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/budget-bucket-chain.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveBucketChain } from "./budget-bucket-chain";
import type { BudgetBucket } from "./types";

const bucket = (over: Partial<BudgetBucket> & { id: number }): BudgetBucket => ({
  name: `B${over.id}`,
  type: "tm",
  currency: "EUR",
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  status: "open",
  allocations: [],
  ...over,
});

describe("resolveBucketChain", () => {
  it("spans a single bucket", () => {
    const r = resolveBucketChain([bucket({ id: 1, startDate: "2026-02-01", endDate: "2026-04-30" })]);
    expect(r).toEqual({ kind: "chain", start: "2026-02-01", end: "2026-04-30", order: [1] });
  });

  it("spans a two-bucket chain from the first start to the last end", () => {
    const r = resolveBucketChain([
      bucket({ id: 1, startDate: "2026-01-01", endDate: "2026-03-31", successorId: 2 }),
      bucket({ id: 2, startDate: "2026-04-01", endDate: "2026-06-30" }),
    ]);
    expect(r).toEqual({ kind: "chain", start: "2026-01-01", end: "2026-06-30", order: [1, 2] });
  });

  it("uses min start / max end, not walk order", () => {
    const r = resolveBucketChain([
      bucket({ id: 1, startDate: "2026-05-01", endDate: "2026-06-30", successorId: 2 }),
      bucket({ id: 2, startDate: "2026-01-01", endDate: "2026-02-28" }),
    ]);
    expect(r).toMatchObject({ kind: "chain", start: "2026-01-01", end: "2026-06-30" });
  });

  it("reports multiple roots with their names", () => {
    const r = resolveBucketChain([bucket({ id: 1, name: "Phase 1" }), bucket({ id: 2, name: "Phase 2" })]);
    expect(r).toEqual({
      kind: "broken",
      reason: "multiple-roots",
      offenders: [{ id: 1, name: "Phase 1" }, { id: 2, name: "Phase 2" }],
    });
  });

  it("reports a bucket unreachable from the root", () => {
    const r = resolveBucketChain([
      bucket({ id: 1, successorId: 2 }),
      bucket({ id: 2, successorId: 1 }),
      bucket({ id: 3, name: "Orphan" }),
    ]);
    // 1 and 2 point at each other, so 3 is the only root; 1 and 2 are unreached.
    expect(r).toMatchObject({ kind: "broken", reason: "unreachable" });
    expect((r as { offenders: { id: number }[] }).offenders.map((o) => o.id)).toEqual([1, 2]);
  });

  it("reports a cycle when every bucket is someone's successor", () => {
    const r = resolveBucketChain([bucket({ id: 1, successorId: 2 }), bucket({ id: 2, successorId: 1 })]);
    expect(r).toMatchObject({ kind: "broken", reason: "cycle" });
  });

  it("refuses to trim when any bucket has no dates", () => {
    const r = resolveBucketChain([
      bucket({ id: 1, successorId: 2 }),
      bucket({ id: 2, name: "Undated", startDate: "", endDate: "" }),
    ]);
    expect(r).toEqual({ kind: "broken", reason: "missing-dates", offenders: [{ id: 2, name: "Undated" }] });
  });

  it("treats a self-reference and a dangling successor as the end of the walk", () => {
    expect(resolveBucketChain([bucket({ id: 1, successorId: 1 })])).toMatchObject({ kind: "chain", order: [1] });
    expect(resolveBucketChain([bucket({ id: 1, successorId: 99 })])).toMatchObject({ kind: "chain", order: [1] });
  });

  it("returns broken for an empty list", () => {
    expect(resolveBucketChain([])).toEqual({ kind: "broken", reason: "unreachable", offenders: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/budget-bucket-chain.test.ts`
Expected: FAIL — `Failed to resolve import "./budget-bucket-chain"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/budget-bucket-chain.ts`:

```ts
// src/app/budget-bucket-chain.ts
//
// Pure, i18n-free resolution of the budget buckets' `successorId` chain. Feeds
// the burn-down x-axis so it spans the real budget window instead of the whole
// resource-plan range — and, when the buckets are NOT one chain, says so instead
// of silently drawing a misleading span.
//
// No React, no I/O, no clock read. `successorId`'s only other consumer,
// computeSpillover (budget-report.ts), is a single-hop CLOSED-bucket transfer and
// is deliberately untouched: a chain of open buckets is still a chain.
import type { BudgetBucket } from "./types";

export type BucketRef = { id: number; name: string };

export type BucketChainBreak = "multiple-roots" | "cycle" | "unreachable" | "missing-dates";

export type BucketChain =
  | { kind: "chain"; start: string; end: string; order: readonly number[] }
  | { kind: "broken"; reason: BucketChainBreak; offenders: readonly BucketRef[] };

const ref = (b: BudgetBucket): BucketRef => ({ id: b.id, name: b.name });

/** Resolve the buckets into one connected successor chain, or explain why not. */
export function resolveBucketChain(buckets: readonly BudgetBucket[]): BucketChain {
  if (buckets.length === 0) return { kind: "broken", reason: "unreachable", offenders: [] };

  // ★ Load-bearing guard: a bucket without both dates claims EVERY plan period
  // (bucketActivePeriods, budget-report.ts:21), so a trimmed axis would drop
  // hours the report still counts. Refuse to trim rather than under-report.
  const undated = buckets.filter((b) => !b.startDate || !b.endDate);
  if (undated.length > 0) return { kind: "broken", reason: "missing-dates", offenders: undated.map(ref) };

  const byId = new Map(buckets.map((b) => [b.id, b] as const));
  const isSuccessor = new Set<number>();
  for (const b of buckets) {
    const s = b.successorId;
    if (s != null && s !== b.id && byId.has(s)) isSuccessor.add(s);
  }

  const roots = buckets.filter((b) => !isSuccessor.has(b.id));
  // No root at all means every bucket is someone's successor — only possible
  // when the links close a loop.
  if (roots.length === 0) return { kind: "broken", reason: "cycle", offenders: buckets.map(ref) };
  if (roots.length > 1) return { kind: "broken", reason: "multiple-roots", offenders: roots.map(ref) };

  const walked: BudgetBucket[] = [];
  const seen = new Set<number>();
  let cur: BudgetBucket | undefined = roots[0];
  while (cur) {
    if (seen.has(cur.id)) return { kind: "broken", reason: "cycle", offenders: walked.map(ref) };
    seen.add(cur.id);
    walked.push(cur);
    const next = cur.successorId;
    // A self-reference or a dangling id ends the walk, mirroring computeSpillover's
    // tolerance; anything left unreached surfaces as "unreachable" below.
    cur = next != null && next !== cur.id ? byId.get(next) : undefined;
  }

  const missed = buckets.filter((b) => !seen.has(b.id));
  if (missed.length > 0) return { kind: "broken", reason: "unreachable", offenders: missed.map(ref) };

  let start = walked[0].startDate;
  let end = walked[0].endDate;
  for (const b of walked) {
    if (b.startDate < start) start = b.startDate;
    if (b.endDate > end) end = b.endDate;
  }
  return { kind: "chain", start, end, order: walked.map((b) => b.id) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/budget-bucket-chain.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0 for both.

- [ ] **Step 6: Commit**

```bash
git add src/app/budget-bucket-chain.ts src/app/budget-bucket-chain.test.ts
git commit -F - <<'EOF'
feat(budget): pure successor-chain resolver for the burn-down span

resolveBucketChain walks the buckets' successorId links and returns either the
chain's date span or the reason it is not one chain (multiple roots, cycle,
unreachable bucket, missing dates). A bucket without both dates claims every
plan period, so an undated bucket blocks trimming rather than dropping hours.
EOF
```

---

## Task 2: Optional span slice in `computeBurndownSeries`

**Files:**
- Modify: `src/app/budget-burndown.ts:34-46`
- Test: `src/app/budget-burndown.test.ts` (existing — append)

- [ ] **Step 1: Write the failing test**

Append to `src/app/budget-burndown.test.ts`, reusing that file's existing module-level `plan` (Jan–Mar 2026, monthly), `roles` and `bucket()` helpers:

```ts
describe("computeBurndownSeries span", () => {
  // One bucket living entirely inside February, so a February span is a
  // strictly narrower window than the Jan–Mar plan.
  const febOnly = [
    bucket({
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      allocations: [{
        roleId: 1, resourceIds: [],
        budgetHours: { "2026-02": 100 },
        actualHours: { "2026-02": 40 },
      }],
    } as unknown as Partial<BudgetBucket>),
  ];

  it("slices the plan periods to the span without changing the totals", () => {
    const full = computeBurndownSeries(febOnly, plan, roles, [], 8, new Set<string>(), [], "2026-02-15");
    const sliced = computeBurndownSeries(febOnly, plan, roles, [], 8, new Set<string>(), [], "2026-02-15",
      { start: "2026-02-01", end: "2026-02-28" });
    expect(full.periods).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(sliced.periods).toEqual(["2026-02"]);
    expect(sliced.totalBudgetHours).toBe(full.totalBudgetHours);
    expect(sliced.totalBudgetValue).toBe(full.totalBudgetValue);
  });

  it("is identical to the un-sliced call when no span is given", () => {
    const a = computeBurndownSeries(febOnly, plan, roles, [], 8, new Set<string>(), [], "2026-02-15");
    const b = computeBurndownSeries(febOnly, plan, roles, [], 8, new Set<string>(), [], "2026-02-15", undefined);
    expect(b).toEqual(a);
  });

  it("falls back to the full plan range when the span selects no period", () => {
    const r = computeBurndownSeries(febOnly, plan, roles, [], 8, new Set<string>(), [], "2026-02-15",
      { start: "2099-01-01", end: "2099-12-31" });
    expect(r.periods).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/budget-burndown.test.ts`
Expected: FAIL — TS/runtime error on the 9th argument (`Expected 8 arguments, but got 9`).

- [ ] **Step 3: Write the implementation**

In `src/app/budget-burndown.ts`, add the parameter to the signature (after `today`):

```ts
  today: string,
  /** Optional x-axis window. The plan periods are SLICED to it — never
   *  re-generated from these dates, because every bucket contribution is looked
   *  up by the plan-derived period key (bucketActivePeriods). Re-generating
   *  could produce keys that no longer match and silently drop hours. */
  span?: { start: string; end: string },
): BurndownSeries {
```

Replace the first line of the body:

```ts
  const allPeriods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
  const sliced = span
    ? allPeriods.filter((p) => p.start >= span.start && p.start <= span.end)
    : allPeriods;
  // A span that selects nothing (e.g. buckets dated outside the plan) would make
  // an empty chart; fall back to the full range rather than render nothing.
  const periods = sliced.length > 0 ? sliced : allPeriods;
  const n = periods.length;
```

Everything below is unchanged: `indexByKey` is built from `periods`, and the existing `if (i === undefined) continue;` already skips a bucket period outside the window.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/budget-burndown.test.ts`
Expected: PASS — the pre-existing tests in the file still pass unchanged.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/budget-burndown.ts src/app/budget-burndown.test.ts
git commit -F - <<'EOF'
feat(budget): optional span slice on computeBurndownSeries

The plan periods are sliced to the span, never re-generated from it, so the
period keys still match bucketActivePeriods and no bucket's hours can fall
outside the axis. Omitting the span reproduces today's output exactly.
EOF
```

---

## Task 3: Expose the chain on `DashboardModel` and use the span

**Files:**
- Modify: `src/app/dashboard.ts:190-213` (type), `src/app/dashboard.ts:312-318` (burndown), and the returned object literal (`burndown,` line ~340)
- Modify: `src/app/budget-report-panel.tsx:74-77`
- Test: `src/app/dashboard.test.ts` (existing — append)

- [ ] **Step 1: Write the failing test**

Add these tests INSIDE the existing `describe("computeDashboard", …)` block in `src/app/dashboard.test.ts` (line ~165), so they use that block's `baseInput` helper — its plan is `2026-01-01 … 2026-12-31`, monthly, i.e. 12 periods:

```ts
  // Two buckets covering Mar–Jun of a Jan–Dec plan, so a chained span is a
  // strictly narrower window than the plan range.
  const bucketA = {
    id: 1, name: "Phase 1", type: "tm", currency: "EUR",
    startDate: "2026-03-01", endDate: "2026-04-30", status: "open", allocations: [],
  } as unknown as BudgetBucket;
  const bucketB = {
    id: 2, name: "Phase 2", type: "tm", currency: "EUR",
    startDate: "2026-05-01", endDate: "2026-06-30", status: "open", allocations: [],
  } as unknown as BudgetBucket;

  it("has no bucket chain when there are no budgets", () => {
    expect(computeDashboard(baseInput()).bucketChain).toBeNull();
  });

  it("trims the burn-down to a connected successor chain", () => {
    const budgets = [{ ...bucketA, successorId: 2 }, bucketB];
    const m = computeDashboard(baseInput({ budgets }));
    expect(m.bucketChain).toMatchObject({ kind: "chain", start: "2026-03-01", end: "2026-06-30" });
    expect(m.burndown?.periods).toEqual(["2026-03", "2026-04", "2026-05", "2026-06"]);
  });

  it("keeps the plan range and reports the break when the buckets are unchained", () => {
    const m = computeDashboard(baseInput({ budgets: [bucketA, bucketB] }));
    expect(m.bucketChain).toMatchObject({ kind: "broken", reason: "multiple-roots" });
    expect(m.burndown?.periods).toHaveLength(12);
  });
```

Add `BudgetBucket` to the `import type { … } from "./types"` line at the top of the file if it is not already there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/dashboard.test.ts`
Expected: FAIL — `Property 'bucketChain' does not exist on type 'DashboardModel'`.

- [ ] **Step 3: Write the implementation**

In `src/app/dashboard.ts`, add the import:

```ts
import { resolveBucketChain, type BucketChain } from "./budget-bucket-chain";
```

Add the field to `DashboardModel`, directly under `burndown`:

```ts
  burndown: BurndownSeries | null;
  /** The buckets' successor-chain resolution — drives the burn-down x-axis span
   *  and the "not one chain" warning. Null when there are no budgets. */
  bucketChain: BucketChain | null;
```

Replace the `burndown` computation:

```ts
  const bucketChain: BucketChain | null = input.budgets.length > 0 ? resolveBucketChain(input.budgets) : null;
  const burndown: BurndownSeries | null =
    input.budgets.length > 0
      ? computeBurndownSeries(
          input.budgets, input.plan, input.roles, input.resources,
          input.workdayHours, holidaySet, input.absences, today,
          bucketChain?.kind === "chain" ? { start: bucketChain.start, end: bucketChain.end } : undefined,
        )
      : null;
```

Add `bucketChain,` to the returned object literal, next to `burndown,`.

- [ ] **Step 4: Wire the budget-report panel**

In `src/app/budget-report-panel.tsx`, add the import and replace the `burndown` memo:

```tsx
import { resolveBucketChain } from "./budget-bucket-chain";
```

```tsx
  const bucketChain = useMemo(() => resolveBucketChain(buckets), [buckets]);
  const burndown = useMemo(
    () => computeBurndownSeries(
      buckets, plan, roles, resources, workdayHours, holidaySet, absences, today,
      bucketChain.kind === "chain" ? { start: bucketChain.start, end: bucketChain.end } : undefined,
    ),
    [buckets, plan, roles, resources, workdayHours, holidaySet, absences, today, bucketChain],
  );
```

- [ ] **Step 5: Run the tests + typecheck**

Run: `npx vitest run src/app/dashboard.test.ts src/app/budget-report-panel.test.tsx && npx tsc --noEmit`
Expected: PASS, exit 0. (`snapshot.test` constructs a `DashboardModel` through an `as unknown as` cast, so the new required field does not break it.)

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard.ts src/app/dashboard.test.ts src/app/budget-report-panel.tsx
git commit -F - <<'EOF'
feat(dashboard): burn-down x-axis follows the bucket successor chain

computeDashboard resolves the chain once and exposes it as
DashboardModel.bucketChain, passing the span to computeBurndownSeries only when
the buckets form one connected chain. The budget report resolves its own.
EOF
```

---

## Task 4: Chain-warning i18n strings (EN)

**Files:**
- Modify: `src/app/i18n.ts:559` (after `burndownBudgetRemaining`)

- [ ] **Step 1: Add the four EN keys**

Insert directly after the `burndownBudgetRemaining: "Budget remaining",` line:

```ts
  burndownChainMultipleRoots: "Burn-down covers the whole plan period: these budget buckets are not linked into one chain ({0}). Set each bucket's successor to chain them.",
  burndownChainUnreachable: "Burn-down covers the whole plan period: these budget buckets are not reachable from the first one ({0}). Set each bucket's successor to chain them.",
  burndownChainCycle: "Burn-down covers the whole plan period: the buckets' successor links form a loop ({0}).",
  burndownChainMissingDates: "Burn-down covers the whole plan period: these budget buckets have no start or end date ({0}).",
```

- [ ] **Step 2: Verify the typecheck fails on missing DE parity**

Run: `npx tsc --noEmit`
Expected: FAIL — `i18n.de.ts` is missing the four keys (this is the parity gate doing its job; Task 5 fixes it).

- [ ] **Step 3: Do NOT commit yet** — the tree does not typecheck until Task 5 lands. Continue.

---

## Task 5: Chain-warning i18n strings (DE, via node)

**Files:**
- Modify: `src/app/i18n.de.ts:565` (after `burndownBudgetRemaining`)

- [ ] **Step 1: Patch the file with a node utf8 write**

★ The Edit tool corrupts umlauts and curls quotes in this CRLF file. Run this instead (from the repo root):

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  burndownBudgetRemaining: \"Verbleibendes Budget\",\r\n";
if (!s.includes(anchor)) { console.error("anchor not found"); process.exit(1); }
const add =
  "  burndownChainMultipleRoots: \"Burn-down umfasst den gesamten Planzeitraum: Diese Buckets sind nicht zu einer Kette verknüpft ({0}). Setze bei jedem Bucket den Nachfolger.\",\r\n" +
  "  burndownChainUnreachable: \"Burn-down umfasst den gesamten Planzeitraum: Diese Buckets sind vom ersten Bucket aus nicht erreichbar ({0}). Setze bei jedem Bucket den Nachfolger.\",\r\n" +
  "  burndownChainCycle: \"Burn-down umfasst den gesamten Planzeitraum: Die Nachfolger-Verknüpfungen der Buckets bilden einen Kreis ({0}).\",\r\n" +
  "  burndownChainMissingDates: \"Burn-down umfasst den gesamten Planzeitraum: Diese Buckets haben kein Start- oder Enddatum ({0}).\",\r\n";
fs.writeFileSync(p, s.replace(anchor, anchor + add), "utf8");
console.log("ok");
'
```

- [ ] **Step 2: Verify the umlauts landed as real characters**

Run: `node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8'); console.log(s.includes('verknüpft'), s.includes('Verknüpfungen'), s.includes('fuer'))"`
Expected: `true true false`

- [ ] **Step 3: Typecheck + run the i18n guard**

Run: `npx tsc --noEmit && npx vitest run src/app/i18n-encoding.test.ts`
Expected: exit 0, PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat(i18n): burn-down chain warning strings (EN + DE)
EOF
```

---

## Task 6: `BurndownChainWarning` component

**Files:**
- Create: `src/app/budget-chain-warning.tsx`
- Test: `src/app/budget-chain-warning.test.tsx`

This is a thin composition over the shared `Banner` primitive — no new control. Do not hand-roll a box.

- [ ] **Step 1: Write the failing test**

Create `src/app/budget-chain-warning.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BurndownChainWarning } from "./budget-chain-warning";

describe("BurndownChainWarning", () => {
  it("renders nothing for a resolved chain", () => {
    const { container } = render(
      <BurndownChainWarning lang="en-US" chain={{ kind: "chain", start: "2026-01-01", end: "2026-03-31", order: [1] }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the chain is null", () => {
    const { container } = render(<BurndownChainWarning lang="en-US" chain={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("names the offending buckets for multiple roots", () => {
    render(
      <BurndownChainWarning
        lang="en-US"
        chain={{ kind: "broken", reason: "multiple-roots", offenders: [{ id: 1, name: "Phase 1" }, { id: 2, name: "Phase 2" }] }}
      />,
    );
    expect(screen.getByText(/not linked into one chain \(Phase 1, Phase 2\)/)).toBeInTheDocument();
  });

  it("uses the reason-specific copy for a cycle", () => {
    render(
      <BurndownChainWarning
        lang="en-US"
        chain={{ kind: "broken", reason: "cycle", offenders: [{ id: 1, name: "A" }] }}
      />,
    );
    expect(screen.getByText(/form a loop \(A\)/)).toBeInTheDocument();
  });

  it("renders nothing when there are no offenders (empty workspace)", () => {
    const { container } = render(
      <BurndownChainWarning lang="en-US" chain={{ kind: "broken", reason: "unreachable", offenders: [] }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/budget-chain-warning.test.tsx`
Expected: FAIL — cannot resolve `./budget-chain-warning`.

- [ ] **Step 3: Write the implementation**

Create `src/app/budget-chain-warning.tsx`:

```tsx
"use client";

// Explains why the burn-down x-axis covers the whole plan period instead of the
// budget window. Presentational: the offending bucket names travel on the
// BucketChain itself, so this needs no bucket list.
import { Banner } from "./banner";
import { type Lang, type TranslationKey, t } from "./i18n";
import type { BucketChain, BucketChainBreak } from "./budget-bucket-chain";

const REASON_KEY: Record<BucketChainBreak, TranslationKey> = {
  "multiple-roots": "burndownChainMultipleRoots",
  unreachable: "burndownChainUnreachable",
  cycle: "burndownChainCycle",
  "missing-dates": "burndownChainMissingDates",
};

export function BurndownChainWarning({ lang, chain }: { lang: Lang; chain: BucketChain | null }) {
  if (!chain || chain.kind !== "broken" || chain.offenders.length === 0) return null;
  const names = chain.offenders.map((o) => o.name).join(", ");
  // role="none": this is a static explanation of the chart below it, not a live
  // update — a role="status" banner would re-announce on every view mount.
  return (
    <Banner severity="warn" role="none" className="mb-2 print:hidden">
      {t(lang, REASON_KEY[chain.reason], names)}
    </Banner>
  );
}
```

- [ ] **Step 4: Run the tests + typecheck**

Run: `npx vitest run src/app/budget-chain-warning.test.tsx && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/budget-chain-warning.tsx src/app/budget-chain-warning.test.tsx
git commit -F - <<'EOF'
feat(budget): BurndownChainWarning banner naming the unchained buckets
EOF
```

---

## Task 7: Mount the warning on both burn-down surfaces

**Files:**
- Modify: `src/app/dashboard-panel.tsx` (import + the `model.burndown` block at ~line 427)
- Modify: `src/app/budget-report-panel.tsx` (import + the `budgetBurndownTitle` section at ~line 147)
- Test: `src/app/dashboard-panel.test.tsx`, `src/app/budget-report-panel.test.tsx` (existing — append)

- [ ] **Step 1: Write the failing tests**

Append a new describe to `src/app/dashboard-panel.test.tsx`, reusing that file's module-level `plan` and `wrapper`:

```tsx
describe("DashboardPanel burn-down chain warning", () => {
  const chainProps = {
    lang: "en-US" as const,
    tasks: [], raid: [], plan, roles: [], resources: [], absences: [],
    holidaySet: new Set<string>(), workdayHours: 8, today: "2026-06-02",
  };
  const bucketA = {
    id: 1, name: "Phase 1", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: {} }],
  } as unknown as BudgetBucket;
  const bucketB = { ...bucketA, id: 2, name: "Phase 2" };

  it("warns when the budget buckets are not one successor chain", () => {
    render(<DashboardPanel {...chainProps} budgets={[bucketA, bucketB]} />, { wrapper });
    expect(screen.getByText(/not linked into one chain/)).toBeInTheDocument();
  });

  it("does not warn when the buckets form one chain", () => {
    render(<DashboardPanel {...chainProps} budgets={[{ ...bucketA, successorId: 2 }, bucketB]} />, { wrapper });
    expect(screen.queryByText(/not linked into one chain/)).toBeNull();
  });
});
```

★ The dashboard burn-down card only renders when the budget module is on (`showBudget` zeroes `budgets` otherwise). If these tests find no warning at all, copy the `features` / module props from that file's existing budget-tile tests.

Append to `src/app/budget-report-panel.test.tsx`, reusing its `renderPanel` helper and module-level `buckets` (three buckets, none chained):

```tsx
describe("BudgetReportPanel burn-down chain warning", () => {
  it("warns when the buckets are not one successor chain", () => {
    renderPanel();
    expect(screen.getByText(/not linked into one chain/)).toBeInTheDocument();
  });

  it("does not warn once the buckets are chained", () => {
    renderPanel({
      buckets: [
        { ...buckets[0], successorId: 2 },
        { ...buckets[1], successorId: 3 },
        buckets[2],
      ],
    });
    expect(screen.queryByText(/not linked into one chain/)).toBeNull();
  });
});
```

★ That shared `buckets` fixture is unchained, so the warning now renders in EVERY `renderPanel()` test in the file. Check for any exact-text or container-snapshot assertion that this new node breaks.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/dashboard-panel.test.tsx src/app/budget-report-panel.test.tsx`
Expected: FAIL — `Unable to find an element with the text: /not linked into one chain/`.

- [ ] **Step 3: Mount it in the dashboard panel**

Add the import to `src/app/dashboard-panel.tsx`:

```tsx
import { BurndownChainWarning } from "./budget-chain-warning";
```

Replace the burndown block:

```tsx
                {model.burndown ? (
                  <div className="mt-3">
                    <BurndownChainWarning lang={lang} chain={model.bucketChain} />
                    <BurndownCharts series={model.burndown} lang={lang} currency={props.plan.currency || "EUR"} />
                  </div>
                ) : null}
```

- [ ] **Step 4: Mount it in the budget report panel**

Add the import to `src/app/budget-report-panel.tsx`:

```tsx
import { BurndownChainWarning } from "./budget-chain-warning";
```

Replace the section body:

```tsx
      <Section title={t(lang, "budgetBurndownTitle")}>
        <BurndownChainWarning lang={lang} chain={bucketChain} />
        <BurndownCharts series={burndown} lang={lang} currency={plan.currency || "EUR"} />
        <p className="mt-2 text-xs text-muted-foreground">{t(lang, "dashboardBurnCaption")}</p>
      </Section>
```

- [ ] **Step 5: Run the tests + typecheck + lint**

Run: `npx vitest run src/app/dashboard-panel.test.tsx src/app/budget-report-panel.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS, exit 0, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard-panel.tsx src/app/budget-report-panel.tsx src/app/dashboard-panel.test.tsx src/app/budget-report-panel.test.tsx
git commit -F - <<'EOF'
feat(dashboard): show the chain warning above both burn-down charts
EOF
```

---

## Task 8: New `open-tasks-for` CTA arm (engine side)

**Files:**
- Modify: `src/app/next-actions/types.ts:22-25`
- Modify: `src/app/next-actions/providers/workload.ts:30`
- Modify: `src/app/next-actions/group.ts:26-28`
- Modify: `src/app/action-chips.tsx:13-15`
- Test: `src/app/next-actions/providers/workload.test.ts`, `src/app/next-actions/group.test.ts`, `src/app/next-actions/action-cta.test.ts` (existing — append)

★ No consumer of `cta` is an exhaustive switch — every one is an `a.cta.kind === "open"` guard, so **tsc will not flag anything here**. The sites below are the complete `grep -rn "cta\.kind" src/app` list.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/next-actions/providers/workload.test.ts`, inside the existing `describe("workloadProvider", …)` (it already has an `input(workloadAlerts)` helper):

```ts
  it("routes an overload alert to the person's tasks, not the workload view", () => {
    const a = workloadProvider.provide(input([{ resourceId: 2, resourceName: "Bo", reason: "overload", value: 4 }]));
    expect(a[0].cta).toEqual({ kind: "open-tasks-for", resourceId: 2, resourceName: "Bo" });
  });

  it("leaves an over-allocated alert on the workload view", () => {
    const a = workloadProvider.provide(input([{ resourceId: 1, resourceName: "Aria", reason: "over-allocated", value: 135 }]));
    expect(a[0].cta).toEqual({ kind: "open", view: "workload", id: 1 });
  });
```

Append to `src/app/next-actions/group.test.ts`, inside the existing `describe("groupNextActions", …)` (its `mk` helper only builds RAID open-CTAs, so build these two inline):

```ts
  it("keeps both workload signals for one resource in a single group", () => {
    const workloadAction = (id: string, score: number, cta: SuggestedAction["cta"]): SuggestedAction => ({
      id, source: "workload",
      title: { key: "actionWorkloadTitle", params: ["Bo"] },
      why: { key: "actionWorkloadWhyOverload", params: [4] },
      score, tier: "now", cta,
    });
    const groups = groupNextActions([
      workloadAction("workload:7:overload", 90, { kind: "open-tasks-for", resourceId: 7, resourceName: "Bo" }),
      workloadAction("workload:7:over-allocated", 40, { kind: "open", view: "workload", id: 7 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("workload:7");
    expect(groups[0].primary.id).toBe("workload:7:overload");
    expect(groups[0].extra.map((x) => x.id)).toEqual(["workload:7:over-allocated"]);
  });
```

Append to `src/app/next-actions/action-cta.test.ts` (it imports `pickPrimaryCta` / `overflowCtas` and defines the `ALL` caps constant):

```ts
describe("open-tasks-for CTA", () => {
  const tasksFor: SuggestedAction = {
    id: "workload:7:overload", source: "workload",
    title: { key: "actionWorkloadTitle", params: ["Bo"] },
    why: { key: "actionWorkloadWhyOverload", params: [4] },
    score: 10, tier: "now",
    cta: { kind: "open-tasks-for", resourceId: 7, resourceName: "Bo" },
  };

  it("keeps the plain Open verb", () => {
    expect(pickPrimaryCta(tasksFor, ALL)).toBe("open");
  });

  it("never attaches the task verbs — there is no task id on this row", () => {
    // markDone is the only task verb that can reach the overflow; the popover
    // verbs (assign / clearBlocker / reschedule) would show up as the primary.
    expect(overflowCtas(tasksFor, ALL)).not.toContain("markDone");
  });
});
```

Append to `src/app/action-chips.test.tsx` — if that file does not exist, create it with this single describe:

```tsx
import { describe, it, expect } from "vitest";
import { chipsForView } from "./action-chips";
import type { SuggestedAction } from "./next-actions/types";

describe("chipsForView", () => {
  const tasksFor: SuggestedAction = {
    id: "workload:7:overload", source: "workload",
    title: { key: "actionWorkloadTitle", params: ["Bo"] },
    why: { key: "actionWorkloadWhyOverload", params: [4] },
    score: 10, tier: "now",
    cta: { kind: "open-tasks-for", resourceId: 7, resourceName: "Bo" },
  };

  it("surfaces an open-tasks-for action on the Open Points strip only", () => {
    expect(chipsForView([tasksFor], "open-points")).toEqual([tasksFor]);
    expect(chipsForView([tasksFor], "workload")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/next-actions src/app/action-chips.test.tsx`
Expected: FAIL on each new test.

- [ ] **Step 3: Add the union arm**

In `src/app/next-actions/types.ts`:

```ts
/** A serializable description of the primary action — the surface executes it. */
export type ActionCta =
  | { kind: "open"; view: AppView; id: string | number } // deep-link to the entity
  // Open the task list filtered to one person's at-risk work. Deliberately NOT
  // an `open` arm with a sentinel id: `onPoints(a)` would then be true and would
  // attach the task-specific verbs (mark-done / reschedule / clear-blocker),
  // which all do Number(cta.id) and have no task to act on here.
  | { kind: "open-tasks-for"; resourceId: number; resourceName: string }
  | { kind: "snooze"; actionId: string };
```

- [ ] **Step 4: Emit it from the workload provider**

In `src/app/next-actions/providers/workload.ts`, replace the `cta:` line inside the returned object:

```ts
        cta:
          al.reason === "overload"
            ? { kind: "open-tasks-for", resourceId: al.resourceId, resourceName: al.resourceName }
            : { kind: "open", view: "workload", id: al.resourceId },
```

- [ ] **Step 5: Preserve the group key**

In `src/app/next-actions/group.ts`, replace `groupKey`:

```ts
function groupKey(a: SuggestedAction): string {
  if (a.cta.kind === "open") return `${a.cta.view}:${a.cta.id}`;
  // Both workload signals for one resource keep the PRE-EXISTING `workload:<id>`
  // key so an overload + over-allocated pair still collapses into ONE row. A
  // fall-through to `a.id` here would silently split them.
  if (a.cta.kind === "open-tasks-for") return `workload:${a.cta.resourceId}`;
  return a.id;
}
```

- [ ] **Step 6: Keep the chip visible**

In `src/app/action-chips.tsx`, replace `chipsForView`:

```ts
/** Open-CTA actions targeting `view` (used by the data-view strip + report cards). */
export function chipsForView(actions: readonly SuggestedAction[], view: AppView): SuggestedAction[] {
  return actions.filter((a) =>
    a.cta.kind === "open"
      ? a.cta.view === view
      : a.cta.kind === "open-tasks-for" && view === "open-points",
  );
}
```

- [ ] **Step 7: Run the tests + typecheck + lint**

Run: `npx vitest run src/app/next-actions src/app/action-chips.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS, exit 0, exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/app/next-actions src/app/action-chips.tsx src/app/action-chips.test.tsx
git commit -F - <<'EOF'
feat(actions): open-tasks-for CTA on the workload overload signal

A separate cta kind, not an `open` arm with a sentinel id: the sentinel would
make onPoints() true and attach mark-done / reschedule / clear-blocker to a row
with no task. group.ts keeps the workload:<id> key so a resource's overload and
over-allocated signals still render as one row, and chipsForView surfaces the
new arm on the Open Points strip.
EOF
```

---

## Task 9: Surface executor for the new CTA

**Files:**
- Create: `src/app/action-cta-exec.ts`
- Test: `src/app/action-cta-exec.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/action-cta-exec.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { executeActionCta } from "./action-cta-exec";

const deps = () => ({
  requestOpen: vi.fn(),
  resetFilters: vi.fn(),
  setAssigneeFilter: vi.fn(),
  setHealthFilter: vi.fn(),
  setActiveTab: vi.fn(),
});

describe("executeActionCta", () => {
  it("deep-links an open CTA", () => {
    const d = deps();
    executeActionCta({ kind: "open", view: "milestones", id: 4 }, d);
    expect(d.requestOpen).toHaveBeenCalledWith("milestones", 4);
    expect(d.resetFilters).not.toHaveBeenCalled();
  });

  it("resets the filters BEFORE applying the person filter", () => {
    const d = deps();
    executeActionCta({ kind: "open-tasks-for", resourceId: 7, resourceName: "Alice Anders" }, d);
    expect(d.resetFilters).toHaveBeenCalledTimes(1);
    expect(d.setAssigneeFilter).toHaveBeenCalledWith("Alice Anders");
    expect(d.setHealthFilter).toHaveBeenCalledWith("red");
    expect(d.setActiveTab).toHaveBeenCalledWith("open-points");
    // Order matters: a reset AFTER the set would wipe the filter we just applied.
    expect(d.resetFilters.mock.invocationCallOrder[0]).toBeLessThan(
      d.setAssigneeFilter.mock.invocationCallOrder[0],
    );
  });

  it("does not deep-link for open-tasks-for (no entity id to open)", () => {
    const d = deps();
    executeActionCta({ kind: "open-tasks-for", resourceId: 7, resourceName: "Alice" }, d);
    expect(d.requestOpen).not.toHaveBeenCalled();
  });

  it("ignores a snooze CTA", () => {
    const d = deps();
    executeActionCta({ kind: "snooze", actionId: "x" }, d);
    expect(d.requestOpen).not.toHaveBeenCalled();
    expect(d.setActiveTab).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/action-cta-exec.test.ts`
Expected: FAIL — cannot resolve `./action-cta-exec`.

- [ ] **Step 3: Write the implementation**

Create `src/app/action-cta-exec.ts`:

```ts
// src/app/action-cta-exec.ts
//
// Executes a SuggestedAction's primary CTA against the live surface. Lives
// OUTSIDE next-actions/ on purpose: the engine stays pure and serializable, and
// this is the one place that turns a CTA into navigation + filter state.
import type { ActionCta } from "./next-actions/types";
import type { AppView } from "./nav-config";
import type { HealthFilter } from "./health";

export interface ActionCtaExecDeps {
  requestOpen: (view: AppView, id: number) => void;
  resetFilters: () => void;
  setAssigneeFilter: (value: string) => void;
  setHealthFilter: (value: HealthFilter) => void;
  setActiveTab: (view: AppView) => void;
}

export function executeActionCta(cta: ActionCta, deps: ActionCtaExecDeps): void {
  if (cta.kind === "open") {
    deps.requestOpen(cta.view, Number(cta.id));
    return;
  }
  if (cta.kind === "open-tasks-for") {
    // Reset FIRST: a stale search/group/label filter would otherwise intersect
    // the new one to zero rows and the deep-link would look broken.
    deps.resetFilters();
    deps.setAssigneeFilter(cta.resourceName);
    // "red" is the existing needs-attention filter (overdue OR blocked OR a
    // manual R override) — the closest standing filter to "their overdue work".
    deps.setHealthFilter("red");
    // No requestOpen / hash write: there is no entity id to deep-link, and
    // requestOpen would push #open-points/<id>. Mirrors requestChat.
    deps.setActiveTab("open-points");
  }
}
```

- [ ] **Step 4: Run the tests + typecheck**

Run: `npx vitest run src/app/action-cta-exec.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/action-cta-exec.ts src/app/action-cta-exec.test.ts
git commit -F - <<'EOF'
feat(actions): executeActionCta — one place that turns a CTA into navigation

Reset-then-apply ordering is pinned by a test: resetting after setting the
assignee filter would wipe the filter the deep-link exists to apply.
EOF
```

---

## Task 10: Wire the executor into task-manager and the notifications hook

**Files:**
- Modify: `src/app/task-manager.tsx:246` (filters destructure), `:952-956` (`openAction`), `:988-994` (`useActionNotifications` call)
- Modify: `src/app/use-action-notifications.ts:12-18, 46-53, 90, 98-106`
- Test: `src/app/use-action-notifications.test.ts` (existing — modify)

- [ ] **Step 1: Update the notifications test to the new prop**

In `src/app/use-action-notifications.test.tsx` (note the `.tsx` extension), rename the mocked prop in `baseArgs()`:

```tsx
const baseArgs = () => ({
  enabled: true,
  isPopout: false,
  lang: "en-US" as const,
  onOpenAction: vi.fn(),
  openActionCenter: vi.fn(),
});
```

…and update the click assertion in the "fires a single notification…" test:

```tsx
    notifInstances[0].onclick?.();
    expect(args.onOpenAction).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
```

(The old line was `expect(args.requestOpen).toHaveBeenCalledWith("milestones", 1);`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/use-action-notifications.test.ts`
Expected: FAIL — `args.onOpenAction` is undefined / the hook still calls `requestOpen`.

- [ ] **Step 3: Change the hook's contract**

In `src/app/use-action-notifications.ts`:

```ts
interface UseActionNotificationsArgs {
  actions: readonly SuggestedAction[];
  enabled: boolean;
  isPopout: boolean;
  lang: Lang;
  /** Runs the action's primary CTA. Takes the whole action (not view+id) so the
   *  notification click and the row's Open button share ONE implementation —
   *  a `cta.kind === "open"` guard here would silently do nothing for any other
   *  arm, and tsc would not flag it. */
  onOpenAction: (action: SuggestedAction) => void;
  openActionCenter: () => void;
}
```

```ts
export function useActionNotifications({
  actions,
  enabled,
  isPopout,
  lang,
  onOpenAction,
  openActionCenter,
}: UseActionNotificationsArgs): void {
```

```ts
  const cbRef = useRef({ lang, onOpenAction, openActionCenter });
```

…and the mirror-effect assignment below it:

```ts
    cbRef.current = { lang, onOpenAction, openActionCenter };
```

Inside the notification click handler:

```ts
        const { lang: l, onOpenAction: open, openActionCenter: center } = cbRef.current;
```

```ts
            n.onclick = () => {
              window.focus();
              open(a);
              n.close();
            };
```

Remove the now-unused `AppView` import if nothing else in the file uses it (lint is `--max-warnings=0`).

- [ ] **Step 4: Wire task-manager**

In `src/app/task-manager.tsx`, widen the filters destructure at line 246:

```tsx
  const { setRaidFilterTaskId, resetFilters, setAssigneeFilter, setHealthFilter } = useFilters();
```

Add the import:

```tsx
import { executeActionCta } from "./action-cta-exec";
```

Replace `openAction`:

```tsx
  const openAction = useCallback(
    (a: SuggestedAction) => {
      executeActionCta(a.cta, { requestOpen, resetFilters, setAssigneeFilter, setHealthFilter, setActiveTab });
    },
    [requestOpen, resetFilters, setAssigneeFilter, setHealthFilter, setActiveTab],
  );
```

Update the `useActionNotifications` call:

```tsx
  useActionNotifications({
    actions: nextActions,
    enabled: effectiveNotifications.desktopUrgent.enabled,
    isPopout,
    lang,
    onOpenAction: openAction,
    openActionCenter,
  });
```

★ `openAction` is declared ABOVE the `useActionNotifications` call today — keep that order.

- [ ] **Step 5: Run the tests + typecheck + lint**

Run: `npx vitest run src/app/use-action-notifications.test.ts src/app/task-manager.characterization.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS, exit 0, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/task-manager.tsx src/app/use-action-notifications.ts src/app/use-action-notifications.test.ts
git commit -F - <<'EOF'
feat(actions): overdue-resource action opens Open Points filtered to that person

task-manager's openAction and the desktop-notification click now share
executeActionCta, so a new CTA arm can never work in one place and no-op in the
other.
EOF
```

---

## Task 11: Pure narrative HTML helpers

**Files:**
- Create: `src/app/narrative-html.ts`
- Test: `src/app/narrative-html.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/narrative-html.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { narrativeToHtml, normalizeNarrativeHtml, isNarrativeEmpty } from "./narrative-html";

describe("narrativeToHtml", () => {
  it("wraps and escapes a legacy plain-text narrative", () => {
    expect(narrativeToHtml("All on track & green")).toBe("<p>All on track &amp; green</p>");
  });

  it("passes rich-text HTML through untouched", () => {
    expect(narrativeToHtml("<p>Already <strong>rich</strong></p>")).toBe("<p>Already <strong>rich</strong></p>");
  });

  it("returns empty string for undefined / blank", () => {
    expect(narrativeToHtml(undefined)).toBe("");
    expect(narrativeToHtml("   ")).toBe("");
  });
});

describe("normalizeNarrativeHtml", () => {
  it("collapses newlines so the markdown round-trip cannot truncate", () => {
    expect(normalizeNarrativeHtml("<p>a</p>\n<p>b</p>")).toBe("<p>a</p> <p>b</p>");
    expect(normalizeNarrativeHtml("<p>a</p>\r\n<p>b</p>")).toBe("<p>a</p> <p>b</p>");
  });

  it("trims", () => {
    expect(normalizeNarrativeHtml("  <p>a</p>  ")).toBe("<p>a</p>");
  });
});

describe("isNarrativeEmpty", () => {
  it("treats the editor's empty paragraph as empty", () => {
    expect(isNarrativeEmpty("<p></p>")).toBe(true);
    expect(isNarrativeEmpty("<p><br></p>")).toBe(true);
    expect(isNarrativeEmpty("<p>&nbsp;</p>")).toBe(true);
  });

  it("is false when there is visible text", () => {
    expect(isNarrativeEmpty("<p>x</p>")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/narrative-html.test.ts`
Expected: FAIL — cannot resolve `./narrative-html`.

- [ ] **Step 3: Write the implementation**

Create `src/app/narrative-html.ts`:

```ts
// src/app/narrative-html.ts
//
// Pure helpers for the dashboard status narrative, which became rich text in R3.
// A legacy plain-text narrative is upgraded on READ and never rewritten on disk
// until the user saves, so an untouched project's stored bytes are unchanged.
//
// ★ No DOMPurify call here and none in sanitizeProjectStatus: sanitisation is a
// SINK concern (sanitizeNoteHtml at the render site). DOMPurify has no DOM under
// bare node, where the codecs run in the sample/fixture scripts — the known
// jsonToWorkspace-returns-empty landmine.
import { plainToHtml } from "./sanitize-html";

const BLOCK_START = /^\s*<(p|ul|ol|h[1-6]|blockquote|div)\b/i;

/** Stored narrative -> HTML. A legacy plain-text value is escaped and wrapped. */
export function narrativeToHtml(stored: string | undefined): string {
  const s = (stored ?? "").trim();
  if (!s) return "";
  return BLOCK_START.test(s) ? s : plainToHtml(s);
}

/** Editor HTML -> the value to store. Newlines collapse to spaces: the markdown
 *  backend writes the narrative as ONE `- narrative: <value>` line and decodes it
 *  with a single-line regex (markdown-codecs-core.ts), so an embedded newline
 *  would silently truncate the narrative on a round-trip. */
export function normalizeNarrativeHtml(html: string): string {
  return html.replace(/[\r\n]+/g, " ").trim();
}

/** True when the HTML carries no visible text — e.g. the editor's empty `<p></p>`. */
export function isNarrativeEmpty(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim() === "";
}
```

- [ ] **Step 4: Run the tests + typecheck**

Run: `npx vitest run src/app/narrative-html.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0. If `plainToHtml` escapes differently than the test expects (check `src/app/sanitize-html.ts:45`), fix the TEST to match the real helper — do not change `plainToHtml`.

- [ ] **Step 5: Commit**

```bash
git add src/app/narrative-html.ts src/app/narrative-html.test.ts
git commit -F - <<'EOF'
feat(dashboard): pure narrative HTML helpers (legacy upgrade, newline guard)
EOF
```

---

## Task 11b: Shared `RichTextView` primitive

**Files:**
- Create: `src/app/rich-text-view.tsx`
- Modify: `src/app/notes-window.tsx:47-54`
- Test: `src/app/rich-text-view.test.tsx`

Extracts the private `NoteBody` so the note log and the dashboard narrative share ONE sanitized-HTML sink. Behaviour-preserving for notes: the same classes, the same `sanitizeNoteHtml` call, the same DOM.

- [ ] **Step 1: Write the failing test**

Create `src/app/rich-text-view.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RichTextView } from "./rich-text-view";

describe("RichTextView", () => {
  it("renders sanitized markup, not escaped source", () => {
    const { container } = render(<RichTextView html="<p>Ship <strong>R3</strong></p>" />);
    expect(container.querySelector("strong")?.textContent).toBe("R3");
  });

  it("strips a script tag at the sink", () => {
    const { container } = render(<RichTextView html="<p>ok</p><script>alert(1)</script>" />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("ok");
  });

  it("appends a caller className to the prose classes", () => {
    const { container } = render(<RichTextView html="<p>x</p>" className="mt-2" />);
    expect((container.firstChild as HTMLElement).className).toContain("mt-2");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/rich-text-view.test.tsx`
Expected: FAIL — cannot resolve `./rich-text-view`.

- [ ] **Step 3: Create the primitive**

Create `src/app/rich-text-view.tsx`:

```tsx
"use client";

// The app's shared read-only rich-text sink. Every place that renders stored
// HTML re-sanitises HERE (defence in depth, mirroring comm-send-preview and
// meeting-report) — so an attacker-crafted workspace can never reach the DOM
// even if a load path regresses. sanitizeNoteHtml is idempotent on clean html.
//
// Extracted from notes-window.tsx's NoteBody so the note log and the dashboard
// status narrative share one sink and one prose class string.
import { sanitizeNoteHtml } from "./sanitize-html";

const PROSE_CLASS =
  "text-sm text-foreground [&_a]:text-ui-dark-blue [&_a]:underline [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc";

export function RichTextView({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={className ? `${PROSE_CLASS} ${className}` : PROSE_CLASS}
      dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(html) }}
    />
  );
}
```

- [ ] **Step 4: Point `notes-window.tsx` at it**

Delete the local `NoteBody` function (lines ~47-54) and its now-unused `sanitizeNoteHtml` import if nothing else in the file uses it (lint is `--max-warnings=0`). Add:

```tsx
import { RichTextView } from "./rich-text-view";
```

Replace every `<NoteBody html={…} />` usage with `<RichTextView html={…} />`.

- [ ] **Step 5: Run the tests + typecheck + lint**

Run: `npx vitest run src/app/rich-text-view.test.tsx src/app/notes-window.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS (notes-window's existing assertions are unchanged — same DOM), exit 0, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/rich-text-view.tsx src/app/rich-text-view.test.tsx src/app/notes-window.tsx
git commit -F - <<'EOF'
refactor(ui): extract RichTextView, the shared sanitized rich-text sink

notes-window's private NoteBody becomes a shared primitive so the dashboard
status narrative renders stored HTML through the same sanitiser and the same
prose classes instead of a second copy of both.
EOF
```

---

## Task 12: Rich-text narrative editor + summary

**Files:**
- Modify: `src/app/dashboard-sections/dashboard-narrative.tsx` (whole file)
- Test: `src/app/dashboard-sections/dashboard-narrative.test.tsx` (existing — rewrite the editor block)

★ Uses the shared `RichTextEditor variant="lean"` primitive. Do not hand-roll a toolbar or a contenteditable.

★ The summary renders through the shared `RichTextView` primitive created in Task 11b. Do not duplicate `NoteBody`'s class string.

- [ ] **Step 1: Update the tests**

In `src/app/dashboard-sections/dashboard-narrative.test.tsx`:

Add the ProseMirror jsdom stubs at the top (mirrors `notes-window.test.tsx`):

```tsx
import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
});
```

Replace the `NarrativeSummary` block with:

```tsx
describe("NarrativeSummary", () => {
  it("renders a legacy plain-text narrative + updated date", () => {
    render(
      <NarrativeSummary
        lang="en-US"
        status={{ narrative: "All on track", narrativeUpdatedAt: "2026-06-20T10:00:00.000Z" }}
      />,
    );
    expect(screen.getByText("All on track")).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it("renders stored rich text as markup, not as escaped source", () => {
    const { container } = render(
      <NarrativeSummary lang="en-US" status={{ narrative: "<p>Ship <strong>R3</strong></p>" }} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("R3");
  });

  it("strips a script tag at the render sink", () => {
    const { container } = render(
      <NarrativeSummary lang="en-US" status={{ narrative: "<p>ok</p><script>alert(1)</script>" }} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("ok");
  });

  it("renders nothing when the narrative is empty or blank markup", () => {
    expect(render(<NarrativeSummary lang="en-US" status={{}} />).container.firstChild).toBeNull();
    expect(
      render(<NarrativeSummary lang="en-US" status={{ narrative: "<p></p>" }} />).container.firstChild,
    ).toBeNull();
  });
});
```

Replace the `NarrativeEditor` block with (the autogrow test is DELETED — there is no textarea to measure):

```tsx
describe("NarrativeEditor", () => {
  it("renders the editor inside a foldable details with the Status summary label", () => {
    render(<EditorHost />);
    expect(screen.getByText("Status summary").closest("details")).not.toBeNull();
  });

  it("mounts the lean rich-text editor with an accessible name", async () => {
    const user = userEvent.setup();
    render(<EditorHost />);
    await user.click(screen.getByText("Status summary"));
    expect(await screen.findByLabelText(t("en-US", "dashboardNarrativePlaceholder"))).toBeTruthy();
    expect(screen.getByRole("button", { name: /bold/i })).toBeTruthy();
  });

  it("seeds the editor with the stored narrative, upgrading legacy plain text", async () => {
    const user = userEvent.setup();
    render(<EditorHost initial="Legacy plain note" />);
    await user.click(screen.getByText("Status summary"));
    const surface = await screen.findByLabelText(t("en-US", "dashboardNarrativePlaceholder"));
    expect(surface.textContent).toContain("Legacy plain note");
  });

  it("Clear is disabled when the narrative is already empty", () => {
    render(<EditorHost />);
    expect(screen.getByRole("button", { name: /clear/i })).toBeDisabled();
  });

  it("Clear empties a stored narrative", async () => {
    const user = userEvent.setup();
    render(<EditorHost initial="<p>Something</p>" />);
    await user.click(screen.getByText("Status summary"));
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.getByRole("button", { name: /clear/i })).toBeDisabled();
  });

  it("re-seeds the draft when status.narrative changes externally (workspace reload)", async () => {
    const user = userEvent.setup();
    render(<EditorHost externalNarrative="<p>External status from reload</p>" />);
    await user.click(screen.getByText("Status summary"));
    await user.click(screen.getByRole("button", { name: /external reload/i }));
    const surface = await screen.findByLabelText(t("en-US", "dashboardNarrativePlaceholder"));
    expect(surface.textContent).toContain("External status from reload");
  });
});
```

Add `import { t } from "../i18n";` at the top of the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/dashboard-sections/dashboard-narrative.test.tsx`
Expected: FAIL — no element labelled with the narrative label / no Bold button.

- [ ] **Step 3: Write the implementation**

Rewrite `src/app/dashboard-sections/dashboard-narrative.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { type Lang, t } from "../i18n";
import { FOCUS_RING } from "../interaction-styles";
import { Button } from "../button";
import { Card } from "../card";
import { RichTextEditor } from "../rich-text-editor";
import { RichTextView } from "../rich-text-view";
import { isNarrativeEmpty, narrativeToHtml, normalizeNarrativeHtml } from "../narrative-html";
import type { ProjectStatus } from "../types";

/** Read-only exec-summary of the saved status narrative (Tier 0). Renders null
 *  when empty so a blank project shows nothing up top. Rich text since R3 — the
 *  HTML is re-sanitised at this SINK (defence in depth, mirroring NoteBody), so
 *  a regressed load path can never put markup in the DOM. */
export function NarrativeSummary({ lang, status }: { lang: Lang; status: ProjectStatus }) {
  const html = narrativeToHtml(status.narrative);
  if (!html || isNarrativeEmpty(html)) return null;
  return (
    <Card boxed className="p-3">
      <RichTextView html={html} />
      {status.narrativeUpdatedAt ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t(lang, "dashboardNarrativeUpdated", status.narrativeUpdatedAt.slice(0, 10))}
        </p>
      ) : null}
    </Card>
  );
}

/** Folded status-summary editor (Tier 3). Owns the draft + the render-time
 *  reconcile that re-seeds it when an external workspace reload changes
 *  status.narrative (NOT a useEffect — set-state-in-effect is banned). */
export function NarrativeEditor({
  lang, status, setStatus,
}: {
  lang: Lang;
  status: ProjectStatus;
  setStatus: Dispatch<SetStateAction<ProjectStatus>>;
}) {
  const storedHtml = narrativeToHtml(status.narrative);
  const [prevStoredNarrative, setPrevStoredNarrative] = useState(storedHtml);
  const [draftNarrative, setDraftNarrative] = useState(storedHtml);

  if (storedHtml !== prevStoredNarrative) {
    setPrevStoredNarrative(storedHtml);
    setDraftNarrative(storedHtml);
  }

  // What a commit would store: blank markup collapses to "", so clearing the
  // editor stores an empty narrative rather than an empty <p>.
  const nextValue = isNarrativeEmpty(draftNarrative) ? "" : normalizeNarrativeHtml(draftNarrative);
  const unchanged = nextValue === storedHtml;

  const commitNarrative = () => {
    if (unchanged) return;
    setStatus((s) => ({ ...s, narrative: nextValue, narrativeUpdatedAt: new Date().toISOString() }));
  };

  const clearNarrative = () => {
    setDraftNarrative("");
    if (storedHtml !== "") {
      setStatus((s) => ({ ...s, narrative: "", narrativeUpdatedAt: new Date().toISOString() }));
    }
  };

  return (
    <details className="rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-card)] print:hidden">
      <summary className={`cursor-pointer text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey ${FOCUS_RING}`}>
        {t(lang, "dashboardStatusSummary")}
      </summary>
      <div className="mt-2">
        <RichTextEditor
          variant="lean"
          lang={lang}
          label={t(lang, "dashboardNarrativePlaceholder")}
          value={draftNarrative}
          onChange={setDraftNarrative}
          onCommit={commitNarrative}
        />
        <div className="mt-2 flex justify-end gap-2 print:hidden">
          <Button variant="primary" size="sm" onClick={commitNarrative} disabled={unchanged}>
            {t(lang, "dashboardStatusSave")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={clearNarrative}
            onMouseDown={(e) => e.preventDefault()}
            disabled={storedHtml === "" && isNarrativeEmpty(draftNarrative)}
          >
            {t(lang, "dashboardStatusClear")}
          </Button>
        </div>
      </div>
    </details>
  );
}
```

No `commitOnEnter` — Enter must split paragraphs in a multi-paragraph status.

- [ ] **Step 4: Run the tests + typecheck + lint**

Run: `npx vitest run src/app/dashboard-sections/dashboard-narrative.test.tsx src/app/dashboard-panel.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS, exit 0, exit 0. If `dashboard-panel.test.tsx` now fails to mount the editor, add the same ProseMirror stubs there.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard-sections/dashboard-narrative.tsx src/app/dashboard-sections/dashboard-narrative.test.tsx
git commit -F - <<'EOF'
feat(dashboard): rich-text status narrative (lean editor + sanitized sink)

Same persisted field: legacy plain text is upgraded on read and only rewritten
when the user saves. Newlines are collapsed on commit because the markdown
backend stores the narrative on one line and would truncate it otherwise.
EOF
```

---

## Task 13: Full gate run

**Files:** none (verification only)

- [ ] **Step 1: Unit suite**

Run: `npm run test:run`
Expected: PASS. A lone `timelog-panel` async flake under load is a known CI-load artefact — re-run that file in isolation before investigating.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0, exit 0.

- [ ] **Step 3: Duplication + size ratchets**

Run: `npm run dup:check && npm run size:check`
Expected: exit 0. If `dup:check` flags the narrative summary markup, that is the Task 12 open question resurfacing — extract the shared view rather than baselining the clone.

- [ ] **Step 4: axe gate on a FRESH isolated server**

Run in one terminal: `PORT=3100 npm run dev`
Then: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` and again with `-g "Budget"` and `-g "Open Points"`.
Stop with: `PORT=3100 npm run stop`
Expected: PASS. Never reuse a long-running `:3000` dev server for this.

- [ ] **Step 5: Eye-verify the three slices**

- Dashboard with two unchained buckets → warning banner above the burn-down; chain them → banner gone and the axis narrows.
- A resource with 3+ overdue tasks → the action's Open lands on Open Points with their name in the assignee filter and Health = red.
- Status summary → bold/list formatting survives a reload and renders formatted in the read-only card.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -F - <<'EOF'
chore(gates): green the R3 quality gates
EOF
```

---

## Task 14: Release

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `package.json`

- [ ] **Step 1: Pick an unused codename**

Run: `grep -in "<candidate>" CHANGELOG.md`
Expected: no match. Codenames are science-fiction authors and must be unique per block.

- [ ] **Step 2: Bump the version + milestone**

Edit `src/app/version.ts`: `APP_VERSION` → `0.200.0`, milestone → the chosen codename. Align `package.json` `version` to the same value.

- [ ] **Step 3: Add the highlight keys**

Add a `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` plus its EN string in `i18n.ts` and its DE string via the node script from Task 5 (same anchor technique, different anchor line).

- [ ] **Step 4: Write the CHANGELOG entry**

Cover the three slices: the overdue action's new destination, the burn-down chain span + warning, and the rich-text status narrative.

- [ ] **Step 5: Re-run the gates**

Run: `npx tsc --noEmit && npm run lint && npm run test:run`
Expected: exit 0 / exit 0 / PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -F - <<'EOF'
chore(release): 0.200.0 "<codename>"
EOF
```

- [ ] **Step 7: STOP**

Do not push, open an MR, or merge. Those happen only on the user's explicit "release" instruction.
