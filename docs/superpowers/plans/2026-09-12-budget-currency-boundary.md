# Budget currency boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `computeBucketReport` convert a fixed-price bucket's contract amount into EUR at its single read, so margin, rollups and spillover stop mixing currencies — and give the two quantities called "CPI" different names.

**Architecture:** `BudgetBucket.fixedPriceAmount` keeps its documented meaning (bucket currency, as typed). `computeBucketReport`, `computeSpillover` and `computeBudgetReport` each take a new **required** `fxRates: FxRates | null` parameter, and the engine converts once with `currencyToEur`. Required rather than defaulted, so tsc enumerates the call sites instead of letting two surfaces keep the bug silently. Display converters (`inCur`, `cci`) are NOT touched — they are already correct; only the engine's input was wrong.

**Tech Stack:** TypeScript, React 19, Next 16, vitest 4.1.8 (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-12-budget-currency-boundary-design.md`

## Global Constraints

- **Never `git add -A` / `git add .`** — the untracked `not-in-use.env.local.bak` holds a live credential. Never open, print, stage or delete it. Stage explicit paths; commit with `git commit --only <paths> -F <msgfile>`.
- **Never `--amend`**, never bare `git stash`, never `npm ci`. `git checkout -- <file>` is DENY-BLOCKED; revert via an inverse anchored Edit whose old string is unique in BOTH directions, then prove `git diff --stat -- <file>` prints nothing.
- **Every `src/app/*.ts(x)` and `src/test/*.ts` is CRLF in the working tree** (`i/lf w/crlf`). Use the **Edit tool only**. Never `sed -i` — it silently re-lines the whole file in a way `git diff` hides.
- **Never edit `src/app/i18n.de.ts` with the Edit tool** — it corrupts umlauts and curls double quotes. Patch it with a node utf8 write anchored on `\r\n`, then re-verify the umlauts by reading the bytes back.
- `docs/**` is LF. `src/app/__fixtures__/golden-workspace.{csv,md}` are `-text` pinned — git never converts them.
- **vitest: always `--maxWorkers=1`, foreground, never two runs at once, never backgrounded.** `--reporter=dot` (`--reporter=basic` and `--minWorkers` do not exist in 4.1.8).
- **Never read a gate's exit code through a pipe.** Redirect to a file, `echo "EXIT=$?"` unpiped, then grep the file.
- `npx tsc --noEmit`: read the count of `^src/` lines, never the exit code.
- Run only the test files each task names. No full suite, no coverage, no e2e, no lint, unless a step says so.
- Engines stay i18n-free: no strings in `budget-report.ts`.
- `react-hooks/exhaustive-deps` is FATAL. A new `useMemo` dependency must be a bare local, never `obj.member`.
- Scratch files only under `C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-wt-a/42ea2b8b-c65b-4e7e-ad1b-58c814f2bb82/scratchpad`.
- End every commit message with: the session trailer

### The vacuity trap that governs every test in this plan

Every existing budget fixture uses `currency: "EUR"` and every panel test passes `fxRates: null`. Under either condition `resolveRate` returns **1** and `currencyToEur`/`eurToCurrency` are the **identity function** — so a currency test written with the wrong fixture passes identically before and after the fix. Therefore:

1. Every new currency test asserts **`resolveRate(...) !== 1`** (or an equivalent rate assertion) before asserting anything else.
2. Every new test is **mutation-proved**: revert the `currencyToEur` call to the raw read, confirm which tests go red, restore, confirm green. Report per-file counts, never just the tally.

---

## File Structure

| File | Change |
|---|---|
| `src/app/budget-report.ts` | the conversion; `fxRates` on three functions; 2 docstrings corrected |
| `src/app/budget-panel.tsx` | pass `fxRates`; `projCur` mislabel; CPI key rename; 2 comments corrected |
| `src/app/budget-report-panel.tsx` | pass `fxRates`; 1 comment corrected (its `money` helper becomes correct without change) |
| `src/app/dashboard.ts` | `fxRates` on `DashboardEntities` + `buildDashboardInput` + the `computeBudgetReport` call |
| `src/app/dashboard-panel.tsx` | supply `fxRates` from `useWorkspace()` |
| `src/app/task-manager.tsx` | supply `fxRates` at three call sites |
| `src/app/use-portfolio-health.ts` | supply `ws.fxRates ?? null` |
| `src/app/insights/detect.ts` | explicit `null` at the call, with the reason |
| `src/app/types.ts` | `ResourcePlan.currency` narrows to `BudgetCurrency`; `fixedPriceAmount` docstring |
| `src/app/sanitize-entities.ts` | `sanitizePlan` validates currency against the union |
| `src/app/i18n.ts` / `src/app/i18n.de.ts` | rename 2 keys, fix 3 hint strings |
| `docs/AGENTS/platform.md` | sweep the renamed key (`agents-symbol-check` is blocking) |
| `sample-workspace-small.json` + goldens + generated tiers | the USD bucket |
| `docs/open-followups.md` | close §464, §465 |

New tests go in the existing files (`budget-report-bucket.test.ts`, `budget-report-project.test.ts`, `budget-panel.test.tsx`, `sanitize-budget.test.ts`). **No shared bucket factory exists** — ten local ones do, two both named `tmBucket` with different signatures. Use each file's own idiom; do not import one file's factory into another.

---

### Task 1: The engine boundary

**Files:**
- Modify: `src/app/budget-report.ts`
- Modify: `src/app/budget-panel.tsx`, `src/app/budget-report-panel.tsx`, `src/app/dashboard.ts`, `src/app/dashboard-panel.tsx`, `src/app/task-manager.tsx`, `src/app/use-portfolio-health.ts`, `src/app/insights/detect.ts`
- Test: `src/app/budget-report-bucket.test.ts`

**Interfaces:**
- Produces: `computeBucketReport(bucket, plan, roles, resources, workdayHours, holidaySet, spilloverInHours?, spilloverInValue?, absences?, tasks?, fxRates)` — `fxRates: FxRates | null` is the **last** parameter and is **required**. `computeBudgetReport(buckets, plan, roles, resources, workdayHours, holidaySet, absences?, tasks?, fxRates)` likewise. Task 2 and Task 6 both call these.

- [ ] **Step 1: Write the failing test**

Append to `src/app/budget-report-bucket.test.ts`. Note the file uses `test(...)`, never `it(...)`, and leaves arithmetic unevaluated so the assertion states its own derivation.

```ts
describe("computeBucketReport — a fixed-price bucket in a non-EUR currency", () => {
  const fx: FxRates = { base: "EUR", date: "2026-05-26", fetchedAt: "x", rates: { EUR: 1, USD: 1.1, GBP: 0.85 } };
  const usd: BudgetBucket = {
    id: 1, name: "FX", type: "fixed", currency: "USD", fixedPriceAmount: 10000,
    startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 50 } }],
  };

  test("the fixture actually converts — a rate of 1 would make this whole describe vacuous", () => {
    expect(resolveRate(usd, fx)).toBe(1.1);
  });

  test("revenue is the contract amount in EUR, not the raw bucket-currency number", () => {
    const rep = computeBucketReport(usd, plan, roles, resources, 8, noHolidays, 0, 0, [], [], fx);
    expect(rep.revenue).toBeCloseTo(10000 / 1.1, 5);   // NOT 10000
  });

  test("margin is computed across one unit: EUR revenue minus EUR cost", () => {
    const rep = computeBucketReport(usd, plan, roles, resources, 8, noHolidays, 0, 0, [], [], fx);
    const revenueEur = 10000 / 1.1;
    expect(rep.cost).toBe(50 * 100);                    // EUR by construction (role rates)
    expect(rep.contributionMargin.amount).toBeCloseTo(revenueEur - 50 * 100, 5);
    expect(rep.contributionMargin.percent).toBeCloseTo(((revenueEur - 5000) / revenueEur) * 100, 5);
  });

  test("win/loss is EUR", () => {
    const rep = computeBucketReport(usd, plan, roles, resources, 8, noHolidays, 0, 0, [], [], fx);
    expect(rep.winLossValue).toBeCloseTo(10000 / 1.1 - 50 * 100, 5);
  });

  test("an EUR bucket is unchanged — the conversion is identity at rate 1", () => {
    const eur: BudgetBucket = { ...usd, currency: "EUR" };
    const rep = computeBucketReport(eur, plan, roles, resources, 8, noHolidays, 0, 0, [], [], fx);
    expect(rep.revenue).toBe(10000);
  });
});
```

Add to that file's imports (it currently imports only `computeBucketReport` and four types):

```ts
import { resolveRate } from "./fx";
import type { ResourcePlan, Resource, Role, BudgetBucket, FxRates } from "./types";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/budget-report-bucket.test.ts --maxWorkers=1 --reporter=dot`
Expected: FAIL. `revenue` is 10000 where 9090.909… is expected. The rate-guard test PASSES already (it tests `resolveRate`, not the engine) — that is correct and intended; it is a guard, not a detector.

- [ ] **Step 3: Add the parameter and the conversion**

In `src/app/budget-report.ts`, add to the import block:

```ts
import { currencyToEur } from "./fx";
```

and add `FxRates` to the existing `import type { ... } from "./types"` list.

Change `computeBucketReport`'s signature (currently ending `tasks: readonly Task[] = [],`) to append the required parameter **last**:

```ts
export function computeBucketReport(
  bucket: BudgetBucket,
  plan: ResourcePlan,
  roles: readonly Role[],
  resources: readonly Resource[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
  spilloverInHours = 0,
  spilloverInValue = 0,
  absences: readonly Absence[] = [],
  tasks: readonly Task[] = [],
  fxRates: FxRates | null,
): BucketReport {
```

★ A required parameter after optional ones is legal TypeScript (callers must pass all of them positionally); this is deliberate, so every call site is forced to state its rates rather than inherit a default.

Replace the single read at `:349`:

```ts
  const fixedPrice = bucket.fixedPriceAmount ?? 0;
```

with:

```ts
  // The contract amount is stored in the BUCKET's currency (see
  // BudgetBucket.fixedPriceAmount). Every other money term here is EUR by
  // construction — role rates are EUR — so it is converted once, here, at the
  // engine's only read of the field. Before this existed the fixed branch put a
  // foreign number straight into revenue/budgetValue and the margin subtracted
  // an EUR cost from it (open-followups §465).
  const fixedPrice = currencyToEur(bucket.fixedPriceAmount ?? 0, bucket, fxRates);
```

Correct the two false docstrings. `BucketReport`'s field comment:

```ts
  /** All amounts in EUR. A fixed-price bucket's contract amount is converted
   *  from the bucket currency by `computeBucketReport`; role-rate figures are
   *  EUR already. Converted to the bucket currency only at display.
   *  ★ "EUR" here assumes `plan.currency === "EUR"`, which is what role rates
   *  are denominated in — see ResourcePlan.currency. */
  budgetValue: number;
```

and `computeBucketReport`'s:

```ts
/**
 * Compute a single bucket's report. All money is in EUR: role rates are EUR,
 * and a fixed-price bucket's contract amount is converted from the bucket
 * currency via `currencyToEur` at the one read below.
 * `spilloverInHours`/`spilloverInValue` are the remaining budget rolled in
 * from a closed predecessor; the caller supplies them, already in EUR.
 */
```

- [ ] **Step 4: Thread `fxRates` through `computeSpillover` and `computeBudgetReport`**

`computeSpillover` calls `computeBucketReport` itself, so the carry is only EUR once it too has rates. Change its signature and its call:

```ts
function computeSpillover(
  buckets: readonly BudgetBucket[],
  plan: ResourcePlan,
  roles: readonly Role[],
  resources: readonly Resource[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
  fxRates: FxRates | null,
): { hours: Map<number, number>; value: Map<number, number> } {
```

```ts
    const rep = computeBucketReport(b, plan, roles, resources, workdayHours, holidaySet, 0, 0, [], [], fxRates);
```

★ The predecessor's currency is independent of the successor's, which is exactly why the carry must be EUR before it lands: a closed USD bucket otherwise injects dollars into a T&M successor's own `budgetValue`.

Then `computeBudgetReport`:

```ts
export function computeBudgetReport(
  buckets: readonly BudgetBucket[],
  plan: ResourcePlan,
  roles: readonly Role[],
  resources: readonly Resource[],
  workdayHours: number,
  holidaySet: ReadonlySet<string>,
  absences: readonly Absence[] = [],
  tasks: readonly Task[] = [],
  fxRates: FxRates | null,
): BudgetReport {
  const spill = computeSpillover(buckets, plan, roles, resources, workdayHours, holidaySet, fxRates);
```

and its inner call gains `fxRates` as the 11th argument:

```ts
    computeBucketReport(
      b, plan, roles, resources, workdayHours, holidaySet,
      spill.hours.get(b.id) ?? 0, spill.value.get(b.id) ?? 0, absences, tasks, fxRates,
    ),
```

- [ ] **Step 5: Run the engine test to verify it passes**

Run: `npx vitest run src/app/budget-report-bucket.test.ts --maxWorkers=1 --reporter=dot`
Expected: PASS.

- [ ] **Step 6: Thread the five call sites**

`npx tsc --noEmit` now enumerates them. Fix each:

`src/app/budget-panel.tsx:129-132` — `fxRates` is already a destructured local:

```tsx
  const report = useMemo(
    () => computeBudgetReport(buckets, plan, roles, resources, workdayHours, holidaySet, absences, tasks, fxRates),
    [buckets, plan, roles, resources, workdayHours, holidaySet, absences, tasks, fxRates],
  );
```

`src/app/budget-report-panel.tsx:68-71` — same, and note this call passes no `tasks`:

```tsx
  const report = useMemo(
    () => computeBudgetReport(buckets, plan, roles, resources, workdayHours, holidaySet, absences, [], fxRates),
    [buckets, plan, roles, resources, workdayHours, holidaySet, absences, fxRates],
  );
```

★ It previously relied on `tasks` defaulting; an explicit `[]` is now required because `fxRates` follows it. Preserving the existing behaviour (no tasks ⇒ null earned value here) is deliberate.

`src/app/dashboard.ts` — add the field to `DashboardEntities` (NOT to `DashboardInput`, which is derived):

```ts
  absences: readonly Absence[];
  /** Cached ECB rates, or null. Forwarded to the budget engine so a non-EUR
   *  fixed-price bucket's contract amount converts to EUR before the Budget
   *  RAG reads consumedValue/budgetValue. */
  fxRates: FxRates | null;
  milestones?: readonly Milestone[];
```

forward it in `buildDashboardInput`:

```ts
    absences: e.absences,
    fxRates: e.fxRates,
    milestones: e.milestones ?? [],
```

and pass it at the call (`:374-376`) — mind the argument order, `tasks` is deliberately `[]` here:

```ts
  const project: ProjectReport | null = input.budgets.length > 0
    ? computeBudgetReport(input.budgets, input.plan, input.roles, input.resources, input.workdayHours, holidaySet, input.absences, [], input.fxRates).project
    : null;
```

Add `FxRates` to that file's type imports.

`src/app/dashboard-panel.tsx:90` — add `fxRates` to the existing destructure and to the entities literal:

```tsx
  const { status, setStatus, insights, activityLog: activity, fxRates } = useWorkspace();
```
```tsx
            absences: props.absences,
            fxRates,
```

`src/app/task-manager.tsx` — `fxRates` is already destructured from `useWorkspace()` at `:306`. Add `fxRates,` to the entities literal at **both** `buildDashboardInput` sites (`:614-619` and `:850-859`), add `fxRates` to the second one's dependency array, and pass it at `getBudgetRollup` (`:1917-1933`):

```tsx
    return computeBudgetReport(
      budgets,
      plan,
      roles,
      resources,
      settings.resources.workdayHours,
      holidaySet,
      absences,
      tasks,
      fxRates,
    ).project;
```

`src/app/use-portfolio-health.ts:113-128` — the loaded workspace carries it:

```ts
                absences: ws.absences,
                fxRates: ws.fxRates ?? null,
```

`src/app/insights/detect.ts:150` — this detector reads **only** `b.budgetHours` / `b.actualHours`, so it passes an explicit null rather than growing `InsightInput`:

```ts
  // Hours-only detector: it reads budgetHours/actualHours and no money term, so
  // no FX is needed. Explicit null rather than a threaded rate — stated here so
  // it is a visible decision, not a silent default. If this detector ever reads
  // a money figure, thread fxRates through InsightInput first (§465).
  const report = computeBudgetReport(budgets, plan, roles, resources, BUDGET_WORKDAY_HOURS, holidaySet, [], [], null);
```

- [ ] **Step 7: Update every EXISTING test that calls either engine function**

★★★ This step is the one most likely to be skipped, and skipping it reds CI while every targeted run stays green. **vitest never typechecks**, so an existing test calling `computeBudgetReport(...)` without the new required argument runs fine locally and fails only `npx tsc --noEmit` — which is a blocking CI job. A plan's file list does not enumerate these; the compiler does.

Enumerate them, do not guess:

```bash
npx tsc --noEmit > <scratch>/tsc.log 2>&1; echo "EXIT=$?"; grep -c "^src/" <scratch>/tsc.log; grep "^src/" <scratch>/tsc.log | sed 's/(.*//' | sort -u
```

Expect hits across the budget test files (at least `budget-report.test.ts`, `budget-report-bucket.test.ts`, `budget-report-project.test.ts`, `budget-report-edges.test.ts`, `budget-report-blended.test.ts`, `budget-burndown.test.ts`, `sample-workspace-budget.test.ts`, `insights/detect.test.ts`, `timelog-reapply.test.ts`) — but take the list from the compiler's own output, not from this sentence.

For each, append the new argument. An existing all-EUR call takes `null`, which is honest and behaviour-preserving:

```ts
const rep = computeBucketReport(tmBucket(), plan, roles, resources, 8, noHolidays, 0, 0, [], [], null);
```

★ Do NOT reach for a default parameter to avoid this edit — the required parameter is the whole mechanism by which the compiler enumerates call sites, and defaulting it would silently re-admit the defect at the three production sites Task 1 just fixed.

- [ ] **Step 8: Trace the Trends `remainingCost` KPI**

The spec leaves this as the one undetermined item in the blast radius. Establish whether it derives from the budget report or from hours:

```bash
grep -rn "remainingCost" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
```

If it reads any `BucketReport`/`ProjectReport` money field, it is in the blast radius: say so in the task report, and check whether a Trends snapshot test pins a figure that now moves. If it derives from hours (as `cpi` does, via `model.evm.cpi`), record that it is unaffected and move on. Either way, state the finding — an untraced item must not silently become a closed one.

- [ ] **Step 9: Verify the tree typechecks and the budget suites are green**

Run: `npx tsc --noEmit` — read the count of lines starting `src/`. Expected: 0.
Run: `npx vitest run src/app/budget-report-bucket.test.ts src/app/budget-report.test.ts src/app/budget-report-project.test.ts src/app/budget-report-edges.test.ts src/app/budget-report-blended.test.ts src/app/budget-panel.test.tsx src/app/budget-report-panel.test.tsx src/app/dashboard.test.ts src/app/sample-workspace-budget.test.ts --maxWorkers=1 --reporter=dot`
Expected: all pass, `Test Files 9`. Assert the file count equals the 9 paths passed — a mistyped path mixed with real ones is dropped silently at exit 0.

- [ ] **Step 8: Mutation-prove the conversion**

Revert the conversion to `const fixedPrice = bucket.fixedPriceAmount ?? 0;`, re-run `budget-report-bucket.test.ts`, and record which tests fail and the per-file count. Expected: the three EUR-value tests red, the rate-guard and the EUR-bucket test green. Restore, re-run green, and prove the restore is byte-clean with `git diff --stat -- src/app/budget-report.ts` showing only the intended change.

- [ ] **Step 9: Commit**

```bash
git commit --only src/app/budget-report.ts src/app/budget-report-bucket.test.ts src/app/budget-panel.tsx src/app/budget-report-panel.tsx src/app/dashboard.ts src/app/dashboard-panel.tsx src/app/task-manager.tsx src/app/use-portfolio-health.ts src/app/insights/detect.ts -F <msgfile>
```

Message subject: `fix(budget): convert a fixed-price contract amount to EUR at the engine's one read`

---

### Task 2: Spillover and the cross-currency rollup

**Files:**
- Test: `src/app/budget-report-project.test.ts`

**Interfaces:**
- Consumes: `computeBudgetReport(..., fxRates)` from Task 1.

- [ ] **Step 1: Write the failing tests**

`budget-report-project.test.ts` has its own `bucket(id, extra)` factory — use it. Append:

```ts
describe("computeBudgetReport — currencies do not leak across buckets", () => {
  const fx: FxRates = { base: "EUR", date: "2026-05-26", fetchedAt: "x", rates: { EUR: 1, USD: 1.1, GBP: 0.85 } };

  test("the fixture actually converts", () => {
    expect(fx.rates.USD).toBe(1.1);
  });

  test("a closed USD fixed predecessor spills EUR into its T&M successor", () => {
    const pred = bucket(1, {
      type: "fixed", currency: "USD", fixedPriceAmount: 10000, status: "closed", successorId: 2,
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 50 } }],
    });
    const succ = bucket(2, {
      type: "tm", currency: "EUR",
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 0 } }],
    });
    const rep = computeBudgetReport([pred, succ], plan, roles, resources, 8, new Set<string>(), [], [], fx);
    const successor = rep.buckets.find((b) => b.bucketId === 2)!;
    // The predecessor's remaining budget is (contract − consumed) in EUR.
    // Raw, it would spill 10000 − 5000 = 5000 DOLLARS into a EUR bucket.
    const spilledEur = 10000 / 1.1 - (10000 / 1.1) * 0.5;
    expect(successor.spilloverInValue).toBeCloseTo(spilledEur, 5);
    expect(successor.budgetValue).toBeCloseTo(100 * 150 + spilledEur, 5);
  });

  test("a project mixing USD fixed, GBP fixed and T&M sums one unit", () => {
    const usd = bucket(1, { type: "fixed", currency: "USD", fixedPriceAmount: 11000,
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 0 } }] });
    const gbp = bucket(2, { type: "fixed", currency: "GBP", fixedPriceAmount: 8500,
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 0 } }] });
    const tm = bucket(3, { type: "tm", currency: "EUR",
      allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 10 }, actualHours: { "2026-01": 10 } }] });
    const rep = computeBudgetReport([usd, gbp, tm], plan, roles, resources, 8, new Set<string>(), [], [], fx);
    expect(rep.project.revenue).toBeCloseTo(11000 / 1.1 + 8500 / 0.85 + 10 * 150, 5);
  });
});
```

Add `FxRates` to that file's type imports.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/app/budget-report-project.test.ts --maxWorkers=1 --reporter=dot`
Expected: both behaviour tests FAIL if Task 1 is somehow incomplete; if Task 1 is correct they should PASS on first run. **That is expected and is not a reason to weaken them** — they are regression pins for a path Task 1 fixed by construction, and the spillover case is not covered by Task 1's tests. Record which happened.

- [ ] **Step 3: Mutation-prove them**

Since these may pass immediately, their value rests entirely on the mutant. Revert `computeSpillover`'s `fxRates` argument to a literal `null` (leaving Task 1's conversion in place elsewhere) and re-run: the spillover test must go red while the rollup test stays green. Then revert the conversion itself and confirm both go red. Restore after each; prove byte-clean with `git diff --stat`.

- [ ] **Step 4: Commit**

```bash
git commit --only src/app/budget-report-project.test.ts -F <msgfile>
```

Subject: `test(budget): pin that a closed non-EUR bucket spills EUR into its successor`

---

### Task 3: The project rollup's currency label

**Files:**
- Modify: `src/app/budget-panel.tsx:135`
- Test: `src/app/budget-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
test("labels the project rollup in EUR even when the plan names another currency", () => {
  render(<BudgetPanel {...props} plan={{ ...plan, currency: "USD" }} />);
  const total = screen.getByText(/Project total/i).closest("section")!;
  // The rollup figures are the engine's EUR sums; labelling them with the
  // plan's currency would relabel EUR money as dollars (§465).
  expect(within(total).queryByText(/\$/)).toBeNull();
});
```

★ Verify the file is still CRLF after editing (`git ls-files --eol src/app/budget-panel.test.tsx` must report `w/crlf`).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/budget-panel.test.tsx --maxWorkers=1 --reporter=dot`
Expected: FAIL — the rollup currently renders `$` because `projCur` is `plan.currency`.

- [ ] **Step 3: Fix the label**

★★ This wording is the one that SHIPPED, and it is not the one this step was first
drafted with. The draft called `plan.currency` "free-text", which Task 4 below
falsifies two tasks later by narrowing the field to `BudgetCurrency` — so applying
the draft here writes a comment this same plan then makes stale. The reason the
rollup hardcodes EUR survives the narrowing and has to be stated in terms that do:
the union still admits `USD`/`GBP`, so the field names the plan's BASE currency and
never the unit of an unconverted engine figure. `f32cfb6c` corrected five comments
that had gone stale exactly this way; do not re-apply the draft.

```tsx
  // ★★ The rollup sums the engine's EUR figures and converts NOTHING, so it is
  // EUR regardless of what `plan.currency` says. Narrowing that field to the
  // `BudgetCurrency` union did NOT make it safe to label with: the union still
  // admits `USD`/`GBP`, so it states the plan's base currency, never the unit
  // of an unconverted engine figure. Labelling it
  // `plan.currency` printed EUR money under another currency's symbol
  // (docs/open-followups.md §465). The per-bucket tiles below are the other
  // case and stay as they are: they convert EUR→bucket currency (`inCur` /
  // `cci`) BEFORE labelling, so there the bucket's own currency is correct.
  const projCur = "EUR";
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/budget-panel.test.tsx --maxWorkers=1 --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/budget-panel.tsx src/app/budget-panel.test.tsx -F <msgfile>
```

Subject: `fix(budget): label the project rollup EUR, which is what it sums`

---

### Task 4: Narrow `plan.currency`

**Files:**
- Modify: `src/app/types.ts:568`, `src/app/sanitize-entities.ts:475`
- Test: `src/app/sanitize-budget.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("a plan currency outside the supported union falls back to EUR", () => {
  const plan = sanitizePlan({ startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "CHF" }, "2026-01-01");
  // Role rates are denominated in the plan currency and the budget engine
  // treats them as EUR, so an unsupported currency was a silent mislabel
  // rather than a supported feature (§465).
  expect(plan.currency).toBe("EUR");
});

test("a supported currency survives", () => {
  const plan = sanitizePlan({ startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "USD" }, "2026-01-01");
  expect(plan.currency).toBe("USD");
});
```

Import `sanitizePlan` if the file does not already.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/sanitize-budget.test.ts --maxWorkers=1 --reporter=dot`
Expected: FAIL — `"CHF"` currently survives as a trimmed non-empty string.

- [ ] **Step 3: Narrow the type and the sanitizer**

`src/app/types.ts`:

```ts
  /** Plan base currency. Role rates and per-bucket rate overrides are
   *  denominated in it, and the budget engine treats those as EUR — so the
   *  union is what keeps "all money is EUR" honest rather than aspirational. */
  currency: BudgetCurrency;
```

`src/app/sanitize-entities.ts` in `sanitizePlan`:

```ts
  const currency = isBudgetCurrency(raw.currency) ? raw.currency : fallback.currency;
```

`isBudgetCurrency` is already exported from `types.ts` and already imported by this module for `sanitizeBudgetBucket`; confirm rather than assume.

- [ ] **Step 4: Run the test and the storage round-trips**

Run: `npx vitest run src/app/sanitize-budget.test.ts src/app/storage-budget-csv.test.ts src/app/storage-budget-md.test.ts src/app/storage-budget-json.test.ts src/app/storage-budget-migrate.test.ts --maxWorkers=1 --reporter=dot`
Expected: PASS, `Test Files 5`.
Run: `npx tsc --noEmit` — expected 0 `src/` lines. If `defaultResourcePlan` or any fixture assigns a non-union string, tsc names it; fix those rather than widening the type back.

- [ ] **Step 5: Commit**

```bash
git commit --only src/app/types.ts src/app/sanitize-entities.ts src/app/sanitize-budget.test.ts -F <msgfile>
```

Subject: `fix(budget): make the plan currency a real union, not a free string`

---

### Task 5: Rename the money CPI and fix the two wrong hints

**Files:**
- Modify: `src/app/i18n.ts` (5 lines), `src/app/i18n.de.ts` (5 lines), `src/app/budget-panel.tsx` (2 render sites), `docs/AGENTS/platform.md`
- Test: `src/app/budget-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
test("the budget tile does not call its money ratio CPI", async () => {
  render(<BudgetPanel {...props} />);
  // Two different quantities were both labelled CPI a click apart: this money
  // ratio (earnedValue ÷ cost) and the EVM hours ratio on the Dashboard and
  // the Budget report. CPI stays with EVM (§464).
  expect(screen.queryAllByText(/CPI/)).toHaveLength(0);
  expect(screen.getAllByText(/Cost recovery/).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/budget-panel.test.tsx --maxWorkers=1 --reporter=dot`
Expected: FAIL — the tiles render "Cost performance (CPI)".

- [ ] **Step 3: Rename the keys in EN**

In `src/app/i18n.ts`, with the Edit tool (this file may be edited normally):

```ts
  budgetCciRecovery: "Cost recovery",
```
```ts
  budgetCciBurnHint: "Budgeted cost ÷ cost to date. Above 100% means less has been spent than budgeted so far. This is not an EVM index — see Cost recovery.",
```
```ts
  budgetCciRecoveryHint: "Earned value ÷ actual cost. 100% or above means the work delivered so far is worth at least what was spent on it. Needs linked tasks or a manual % complete on the bucket to compute.",
```
```ts
  budgetReportColWinLossHint: "Fixed-price: revenue minus cost. Time-and-material: budget minus consumed, i.e. remaining budget. In EUR; negative means the bucket runs at a loss.",
```
```ts
  budgetWinLossHint: "Money won or lost versus plan, in the bucket currency.",
```

- [ ] **Step 4: Patch the DE file with a node utf8 write**

**Do NOT use the Edit tool here** — it corrupts umlauts and curls double quotes in this file, and the file is CRLF so anchors must carry `\r\n`. Write a script to the scratchpad and run it:

```js
const fs = require("node:fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const subs = [
  ['  budgetCciCpi: "Kostenleistung (CPI)",\r\n',
   '  budgetCciRecovery: "Kostendeckung",\r\n'],
  ['  budgetCciBurnHint: "Budgetierte Kosten ÷ bisherige Kosten. Über 100 % bedeutet, dass bisher weniger ausgegeben wurde als budgetiert. Dies ist kein EVM-Index — siehe Kostenleistung (CPI).",\r\n',
   '  budgetCciBurnHint: "Budgetierte Kosten ÷ bisherige Kosten. Über 100 % bedeutet, dass bisher weniger ausgegeben wurde als budgetiert. Dies ist kein EVM-Index — siehe Kostendeckung.",\r\n'],
  ['  budgetCciCpiHint: "Erarbeiteter Wert', '  budgetCciRecoveryHint: "Erarbeiteter Wert'],
  ['  budgetReportColWinLossHint: "Differenz zwischen Erlös und Kosten in EUR; negativ bedeutet, dass der Bucket mit Verlust läuft.",\r\n',
   '  budgetReportColWinLossHint: "Festpreis: Erlös minus Kosten. Time-and-Material: Budget minus Verbrauch, also das verbleibende Budget. In EUR; negativ bedeutet, dass der Bucket mit Verlust läuft.",\r\n'],
  ['  budgetWinLossHint: "Stunden über oder unter Plan.",\r\n',
   '  budgetWinLossHint: "Gewinn oder Verlust gegenüber Plan, in der Währung des Budgetpostens.",\r\n'],
];
for (const [from, to] of subs) {
  if (!s.includes(from)) throw new Error("anchor not found: " + from.slice(0, 60));
  if (s.split(from).length !== 2) throw new Error("anchor not unique: " + from.slice(0, 60));
  s = s.replace(from, to);
}
fs.writeFileSync(p, s, "utf8");
console.log("ok");
```

Then verify the umlauts survived and no quote was curled:

```bash
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');console.log('Kostendeckung:',s.includes('Kostendeckung'),'| Waehrung-ascii:',/W(ae|a)hrung/.test(s),'| curly:',/[\u201C\u201D]/.test(s),'| CR count:',(s.match(/\r/g)||[]).length);"
```

Expected: `Kostendeckung: true | curly: false`, a CR count equal to the line count, and the ASCII check must show the real `ä` was used (`Währung`), since `i18n-encoding.test.ts` bans ASCII substitutes.

- [ ] **Step 5: Update the two render sites**

In `src/app/budget-panel.tsx`, at `:381` and `:521`, replace both `"budgetCciCpi"` with `"budgetCciRecovery"` and both `"budgetCciCpiHint"` with `"budgetCciRecoveryHint"`. The surrounding props are unchanged.

- [ ] **Step 6: Sweep the docs**

`agents-symbol-check` fails on a backticked mixed-case name that exists nowhere in `src`. `docs/AGENTS/platform.md` names `budgetCciCpi` and recites its rename history — update the name and extend the history with this rename rather than deleting the old sentence. Confirm no other doc names the key:

```bash
grep -rn "budgetCciCpi" docs AGENTS.md src scripts e2e
```

Expected after the sweep: no hits outside the history sentence's new wording.

- [ ] **Step 7: Run the tests and the gates**

Run: `npx vitest run src/app/budget-panel.test.tsx src/app/i18n-encoding.test.ts src/app/i18n.test.ts --maxWorkers=1 --reporter=dot`
Expected: PASS, `Test Files 3`.
Run: `npx tsc --noEmit` — 0 `src/` lines (this is what enforces EN/DE key parity).
Run: `npm run docs:symbols:check > <scratch>/sym.log 2>&1; echo "EXIT=$?"` — expected `EXIT=0`.

- [ ] **Step 8: Commit**

```bash
git commit --only src/app/i18n.ts src/app/i18n.de.ts src/app/budget-panel.tsx src/app/budget-panel.test.tsx docs/AGENTS/platform.md -F <msgfile>
```

Subject: `fix(budget): give the money ratio its own name, and correct two hints`

---

### Task 6: The sample bucket and the goldens

**Files:**
- Modify: `sample-workspace-small.json`
- Regenerate: `sample-workspace-big.json`, `sample-workspace-huge.json`, `src/app/__fixtures__/golden-workspace.csv`, `src/app/__fixtures__/golden-workspace.md`
- Modify: `src/app/sample-workspace-budget.test.ts`

- [ ] **Step 1: Make bucket #4 a USD contract with a pinned rate**

In `sample-workspace-small.json`, bucket id 4, change `"currency": "EUR"` to `"currency": "USD"` and add `"fxRateOverride": 1.1` beside `"fixedPriceAmount": 80000`.

★ Use `fxRateOverride` rather than a workspace-level `fxRates` block: the override wins in `resolveRate` and needs no network or cache, so the demo, the goldens and e2e are all deterministic. ★ `sanitizeAmount` rounds an override to 2dp, so 1.1 survives exactly; do not pick a rate with more precision.

- [ ] **Step 2: Add a sample assertion that would catch a silent revert**

In `src/app/sample-workspace-budget.test.ts`, extend the bucket-4 test:

```ts
  test("bucket 4 is fixed-price, in USD, with a pinned rate", () => {
    const b = ws.budgets!.find((x) => x.id === 4)!;
    expect(b.type).toBe("fixed");
    expect(b.fixedPriceAmount).toBe(80000);
    // Non-EUR on purpose: the sample is the only fixture that exercises the
    // currency boundary end to end, and a rate of 1 would make it vacuous.
    expect(b.currency).toBe("USD");
    expect(b.fxRateOverride).toBe(1.1);
  });
```

- [ ] **Step 3: Check the existing rollup assertion still holds**

`sample-workspace-budget.test.ts` asserts `rep.project.revenue > 80000`. Bucket 4 now contributes 80000/1.1 ≈ 72727 instead of 80000. Run that file and read the actual figure; if the assertion now fails, do NOT weaken it — report the real number and adjust the threshold with a comment naming the conversion as the cause.

Run: `npx vitest run src/app/sample-workspace-budget.test.ts --maxWorkers=1 --reporter=dot`

- [ ] **Step 4: Regenerate the scaled tiers**

```bash
npx vite-node scripts/generate-sample-workspace.ts
```

- [ ] **Step 5: Regenerate the two goldens — INSIDE vitest, never bare node**

★★★ `jsonToWorkspace` needs a DOM and returns an EMPTY workspace under bare node. Regenerating with `node` or `vite-node` would write byte-perfect fixtures of nothing, and `golden-workspace.test.ts` would then pass against them forever. Regeneration must run in vitest's jsdom environment.

Create a temporary file `src/app/__regen-goldens.test.ts`:

```ts
import { test, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jsonToWorkspace, workspaceToCsv, workspaceToMarkdown } from "./storage";

test("REGEN — delete this file after running", () => {
  const repoRoot = join(import.meta.dirname, "..", "..");
  const ws = jsonToWorkspace(readFileSync(join(repoRoot, "sample-workspace-small.json"), "utf8"));
  // Guard against the empty-workspace trap: a DOM-less decode yields no buckets.
  expect(ws.budgets?.length).toBe(5);
  writeFileSync(join(import.meta.dirname, "__fixtures__", "golden-workspace.csv"), workspaceToCsv(ws), "utf8");
  writeFileSync(join(import.meta.dirname, "__fixtures__", "golden-workspace.md"), workspaceToMarkdown(ws), "utf8");
});
```

Run: `npx vitest run src/app/__regen-goldens.test.ts --maxWorkers=1 --reporter=dot`
Then **delete the file** and confirm it is gone from `git status`.

- [ ] **Step 6: Prove the regeneration changed only what it should**

```bash
git diff --stat -- src/app/__fixtures__/
git diff -- src/app/__fixtures__/ | grep -E "^[+-]" | grep -v "^[+-][+-]"
```

Expected: exactly two changed lines per file — bucket #4's row in each — differing only in the `currency` cell (`EUR`→`USD`) and the `fxRateOverride` cell (empty→`1.1`). **Any other changed line means the storage byte format moved and is a bug, not a regeneration artifact** — stop and report rather than committing.

Then prove git stored the bytes verbatim under the `-text` pin:

```bash
git add src/app/__fixtures__/golden-workspace.csv src/app/__fixtures__/golden-workspace.md
git cat-file blob :src/app/__fixtures__/golden-workspace.csv | cmp - src/app/__fixtures__/golden-workspace.csv && echo "CSV BYTES OK"
git cat-file blob :src/app/__fixtures__/golden-workspace.md  | cmp - src/app/__fixtures__/golden-workspace.md  && echo "MD BYTES OK"
```

- [ ] **Step 7: Run the golden test and the sample suites**

Run: `npx vitest run src/app/golden-workspace.test.ts src/app/sample-workspace-budget.test.ts src/app/sample-workspace.test.ts --maxWorkers=1 --reporter=dot`
Expected: PASS, `Test Files 3`.

- [ ] **Step 8: Check the e2e seed still resolves**

The e2e job reads the sample at module top level, and a broken read fails only in CI.

```bash
npx playwright test --list > <scratch>/pw-list.log 2>&1; echo "EXIT=$?"; tail -3 <scratch>/pw-list.log
```

Expected: `EXIT=0` and a test count. No browsers are needed for `--list`.

- [ ] **Step 9: Commit**

```bash
git commit --only sample-workspace-small.json sample-workspace-big.json sample-workspace-huge.json src/app/__fixtures__/golden-workspace.csv src/app/__fixtures__/golden-workspace.md src/app/sample-workspace-budget.test.ts -F <msgfile>
```

Subject: `test(budget): give the sample a USD contract so the currency path has a fixture`

---

### Task 7: Close §464 and §465

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Rewrite both entries' headings and Status lines**

Mark both `— CLOSED 2026-09-12` in the heading **and** in the index row (the index anchor is a derived slug: a heading ending ` — CLOSED 2026-09-12` slugifies the em dash between spaces to **two** hyphens, so the anchor gains `--closed-2026-09-12`). Give each a Status line carrying an ISO date and a real command — `followups:status:check` accepts only `grep`, `npm run`, `npx` or `node scripts`, so a backticked filename or a `git show` will NOT satisfy it.

Each closure cites: the commit that fixed it, a reproduce command with its expected result, and the test that now pins the behaviour. For §465 the witness is that `currencyToEur` finally has a production caller:

```
grep -rn "currencyToEur(" src/app --include=*.ts | grep -v "\.test\." | grep -v "^src/app/fx.ts"
```

(expected: one hit, in `budget-report.ts`).

★ Record what was NOT fixed, so the next reader is not misled: `insights/detect.ts` passes an explicit `null` because it reads hours only; `rateOverrideInternal`/`rateOverrideExternal` remain documented as "plan currency", a third currency notion this slice did not unify; and `winLossHours` is still rendered nowhere.

- [ ] **Step 2: Run the three doc gates, unpiped**

```bash
npm run followups:index:check > <scratch>/idx.log 2>&1; echo "EXIT=$?"
npm run followups:status:check > <scratch>/st.log 2>&1; echo "EXIT=$?"
npm run docs:claims:check > <scratch>/claims.log 2>&1; echo "EXIT=$?"
```

Expected `EXIT=0` for all three. **Exit 1 is drift; exit 2 is "the gate could not scan"** — they demand opposite responses, so report which you got.

- [ ] **Step 3: Commit**

```bash
git commit --only docs/open-followups.md -F <msgfile>
```

Subject: `docs(followups): close 464 and 465`

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` — 0 lines starting `src/`.
- [ ] One targeted vitest run over every file this plan touched, `--maxWorkers=1`, asserting `Test Files N` equals the number of paths passed.
- [ ] `npx eslint --max-warnings=0 src` — `EXIT=0`, read unpiped. Every warning is fatal in CI.
- [ ] `npm run size:check` — `EXIT=0`.
- [ ] A **whole-branch review** in addition to the per-task reviews. Five threaded call sites across several commits is exactly the shape where a guard lands on one path and not its neighbour, and per-task review structurally cannot see that seam.
- [ ] `git status --short` prints nothing; no mutant survives; `git diff --stat` against the branch point touches only the files this plan names.

Not run locally unless asked: the full suite, `test:shuffle`, coverage, e2e. CI owns those.
