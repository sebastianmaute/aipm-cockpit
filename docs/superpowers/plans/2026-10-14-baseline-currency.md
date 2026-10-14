# Project Baseline Currency (§476) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project can be run in EUR, USD, GBP or INR: chosen at creation, switchable later with rates converted once and history pinned, and every money figure computed and shown in that currency.

**Architecture:** `plan.currency` becomes the baseline. `fx.ts` resolves every bucket against the baseline through EUR-based ECB cross rates. A pure switch planner converts rates and change cost impacts once and appends a `baselineHistory` entry (a new meta-blob slice). Stored past money (Turso snapshots, `budgetHistory`) is rebased at read time from that history.

**Tech Stack:** Next.js / React / TypeScript, vitest + RTL, Playwright axe.

**Spec:** `docs/superpowers/specs/2026-10-13-pilot-onboarding-design.md`, section "Phase 3 — §476 project baseline currency" (amended 2026-10-14, commit 260f83584). Register: `docs/open-followups.md` §476.

## Global Constraints

- EUR stays the default at creation. `DEFAULT_CURRENCY`, `SUPPORTED_CURRENCIES` (`["EUR", "USD", "GBP", "INR"]`) and the EUR-based `FxRates` table are unchanged; `sanitizeFxRates` keeps rejecting a non-EUR base.
- The switch is blocked until ECB rates were fetched **in this session**; a cached table never enables it.
- The switch is not undoable, not available in a popout, and no AI tool may write `plan.currency`.
- Rates converted at a switch are rounded to 2 decimals (`round2`, as `role-rates.ts`).
- **Behaviour-neutral at EUR:** with base `"EUR"`, no existing test's expected value changes. Test edits in Task 2 are call-site renames and the added `"EUR"` argument only.
- `src/app/task-manager.tsx` is over the size LIMIT (1600); `npm run size:check` fails if it grows by one line. Any edit there goes on an EXISTING line.
- Six write paths for the new slice; the Turso TENANT path is the one a previous meta-blob slice missed.
- i18n: EN and DE key sets identical; edit `i18n.de.ts` only with a node utf8 script anchored on `\r\n`, real umlauts.
- Line endings: `src/app/**` CRLF working tree; `docs/**/*.md`, `AGENTS.md`, `CHANGELOG.md` LF. Check with `git ls-files --eol <file>`.
- Commits: `git commit --only <paths>`, cite §476, no session trailer, no URLs, never `--amend`. `Closes #82` goes only in the PR description.
- Vitest only under the shared lock, targeted files, `--maxWorkers=2`:
  `for i in $(seq 1 120); do [ -d /c/Projects/.vitest-lock ] || break; sleep 5; done; if mkdir /c/Projects/.vitest-lock; then echo 476 > /c/Projects/.vitest-lock/holder; npx vitest run <files> --maxWorkers=2 > "$TMP/v.log" 2>&1; echo "EXIT=$?"; rm -rf /c/Projects/.vitest-lock; else echo LOCK-BUSY; fi; grep -E "Test Files|Tests " "$TMP/v.log"`
- After every task: `npx tsc --noEmit` exit 0 with 0 errors, and `npx eslint --max-warnings=0 <changed files>` exit 0. Never read an exit code through a pipe.

## Review Focus

1. **A chain of switches** (EUR → GBP → USD → EUR): a snapshot taken before the first switch must show the product of all three cross rates, and a round trip leaves rates within rounding of the originals, never exactly equal. Pinned in Task 1 and Task 4.
2. **A snapshot captured on the day of a switch**, before and after it: the entry's ISO `at`, not its `from` date, decides which currency it is in. Pinned in Task 1.
3. **A cached-only rate table** (a previous session's fetch, `fetchedAt` yesterday): the picker stays disabled. Pinned in Task 6.
4. **A day-basis role with `workdayHours` ≠ 8**: the day rates are converted and the hourly ones RE-DERIVED, never both converted. Pinned in Task 4.
5. **A bucket left in the old baseline currency with a manual `fxRateOverride`** (EUR → GBP with a USD bucket overridden at 1.10/EUR): after the switch its rate is `1.10 / ecb.GBP`, and an EUR bucket under a GBP base is `1 / ecb.GBP`. Pinned in Task 2.

## Rulings made while planning (deviations from the spec text)

- **`BaselineEntry` gains `at` (ISO timestamp).** Spec shape is `{ from, currency, perPrevious? }`. A snapshot (`capturedAt`) or budget-history entry (`at`) on the switch day cannot be placed by a date alone. `from` stays for display. Cost if wrong: one extra string per entry.
- **`costImpact` on Changes converts at the switch** (owner decision 2026-10-14, during planning): the one stored money figure outside rates and buckets.
- **`budgetHistory`'s `projectBacValue` / `deltaValue` are rebased at read time** like snapshots: they are stored past money the spec's Trends rule did not name.
- **The picker lives in a self-contained `BaselineCurrencyControl` that reads `useWorkspace()`** rather than a task-manager handler: task-manager cannot grow, `BudgetPanel` is not memoised, and the main-window tree is unmounted while `loadPending` (§548), which satisfies the load guard by construction.

---

### Task 1: Baseline history — type, sanitizer, cross rate, rebase

**Files:**
- Create: `src/app/baseline-currency.ts`
- Test: `src/app/baseline-currency.test.ts`

**Interfaces:**
- Produces:
  - `export type BaselineEntry = { from: string; at: string; currency: BudgetCurrency; perPrevious?: number }` — `from` YYYY-MM-DD, `at` ISO ms, `perPrevious` = units of `currency` per 1 unit of the previous baseline (absent on a creation entry).
  - `export function sanitizeBaselineHistory(input: unknown): BaselineEntry[]` — drops entries with a bad date, a non-ISO `at`, a non-`isBudgetCurrency` currency, or a `perPrevious` that is present but not finite and > 0; returns them sorted by `at`.
  - `export function crossRate(fx: FxRates, from: BudgetCurrency, to: BudgetCurrency): number | null` — units of `to` per 1 `from`, via `fx.rates` with EUR = 1; `null` when a non-EUR side is missing or ≤ 0; `1` when `from === to`.
  - `export function rebaseFactor(history: readonly BaselineEntry[], atIso: string): number` — product of `perPrevious` over entries with `at > atIso` that carry one; `1` for empty history.
  - `export function rebaseSnapshots(snaps: readonly SnapshotRecord[], history: readonly BaselineEntry[]): SnapshotRecord[]` — multiplies `remainingCost` and every `series` point's `plannedCost` / `actualCost` (nulls stay null) by `rebaseFactor(history, s.capturedAt)`; returns the SAME array when history is empty.
  - `export function rebaseBudgetHistory(entries: readonly BudgetHistoryEntry[], history: readonly BaselineEntry[]): readonly BudgetHistoryEntry[]` — same for `projectBacValue` and `deltaValue` keyed on `e.at`; same array when history is empty.

- [ ] **Step 1: Write the failing tests** in `baseline-currency.test.ts`:
  - `sanitizeBaselineHistory` keeps `{ from: "2026-10-14", at: "2026-10-14T09:00:00.000Z", currency: "GBP", perPrevious: 0.852 }`, drops one each with `currency: "CHF"`, `perPrevious: 0`, `perPrevious: NaN`, `from: "14.10.2026"`, and returns two valid entries sorted by `at` when given in reverse order; non-array input → `[]`.
  - `crossRate({ base: "EUR", rates: { EUR: 1, GBP: 0.85, USD: 1.1 }, … }, "EUR", "GBP")` → `0.85`; `"GBP", "USD"` → `toBeCloseTo(1.1 / 0.85, 10)`; `"USD", "EUR"` → `toBeCloseTo(1 / 1.1, 10)`; `"GBP", "GBP"` → `1`; with `rates` lacking INR, `"EUR", "INR"` → `null`.
  - `rebaseFactor` over entries EUR→GBP at `T1` (0.85) and GBP→USD at `T2` (1.3): a timestamp before `T1` → `toBeCloseTo(0.85 * 1.3)`; between → `1.3`; after `T2` → `1`; a timestamp ONE MILLISECOND before `T1` vs one ms after (Review Focus 2) → `0.85*1.3` vs `1.3`; a creation entry without `perPrevious` contributes nothing.
  - `rebaseSnapshots`: a snapshot before `T1` with `remainingCost: 1000`, series `{ plannedCost: 200, actualCost: null }` → `850`, `170`, `null`; empty history returns the identical array (`toBe`).
  - `rebaseBudgetHistory`: `projectBacValue: 10000, deltaValue: -500` before `T1` → `8500`, `-425`; hours untouched.

- [ ] **Step 2: Run them** (lock command, file `src/app/baseline-currency.test.ts`). Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/app/baseline-currency.ts`** with the signatures above. i18n-free and DOM-free. Reuse the date check `budget-history.ts`'s sanitizer uses for `date`; `isBudgetCurrency` from `types.ts`.

- [ ] **Step 4: Run them.** Expected: PASS. Then tsc and eslint on both files.

- [ ] **Step 5: Commit** — `git commit --only src/app/baseline-currency.ts src/app/baseline-currency.test.ts -m "feat: baseline-currency history, cross rate and read-time rebase (§476)"`

---

### Task 2: The engine computes in the baseline

**Files:**
- Modify: `src/app/fx.ts`, and every non-test caller of its exports: `budget-bucket-modal.tsx`, `budget-currency-label.ts`, `budget-panel-bucket-card.tsx`, `budget-report-panel.tsx`, `budget-fx-rollup-notice.tsx`, `budget-burndown.ts`, `budget-forecast.ts`, `budget-report.ts`, `budget-rate-mix.ts`, `evm.ts` (comment), `types.ts` (comment), plus `bucketRateRows`' definition (`grep -rn "export function bucketRateRows" src/app`).
- Modify tests that call these functions: `fx.test.ts`, `fx.property.test.ts`, `budget-bucket-modal.test.tsx`, `budget-burndown.test.ts`, `budget-panel.test.tsx`, `budget-report-bucket.test.ts`, `budget-report-panel.test.tsx`, `budget-report-project.test.ts`, `budget-report.test.ts`, `sample-workspace-budget.test.ts`.
- Test: `src/app/fx.base.test.ts` (new)

**Interfaces:**
- Consumes: `crossRate` is NOT used here (fx.ts keeps its own precedence walk; see Step 3).
- Produces (base is REQUIRED — no default, so tsc lists every call site):
  - `export type RateSource = "base" | "override" | "cached" | "unresolved"` (`"eur"` renamed `"base"`; no consumer compares the string today — `grep -rn '"eur"' src/app` hits only the unrelated `ChartUnit`)
  - `resolveRate(bucket, fxRates, base: BudgetCurrency): number` — units of the bucket's currency per 1 base
  - `resolveRateSource(bucket, fxRates, base: BudgetCurrency): RateSource`
  - `countUnresolvedBuckets(buckets, fxRates, base: BudgetCurrency): number`
  - `baseToCurrency(amount, bucket, fxRates, base)` replaces `eurToCurrency`; `currencyToBase(amount, bucket, fxRates, base)` replaces `currencyToEur`
  - `planCurrencyPerEur` is DELETED; `bucketRateRows` loses its divisor parameter (role rates are already in the base).

- [ ] **Step 1: Write the failing tests** in `fx.base.test.ts` (table `rates: { EUR: 1, GBP: 0.85, USD: 1.1 }`):
  - base `"GBP"`: a GBP bucket → `1`, source `"base"`, even with a stale `fxRateOverride: 2`; an EUR bucket → `toBeCloseTo(1 / 0.85)`, source `"cached"`; a USD bucket → `toBeCloseTo(1.1 / 0.85)`; a USD bucket with `fxRateOverride: 1.2` → `toBeCloseTo(1.2 / 0.85)`, source `"override"` (Review Focus 5).
  - base `"GBP"`, `fxRates: null`: an EUR bucket → `1`, source `"unresolved"`; a GBP bucket → `1`, `"base"`.
  - base `"EUR"`: identical results to the pre-change function for EUR/USD/override/unresolved cases (copy the four cases from `fx.test.ts` with the extra argument).
  - `currencyToBase(110, usdBucket, fx, "GBP")` → `toBeCloseTo(110 * 0.85 / 1.1)`; `baseToCurrency` is its inverse.
  - `countUnresolvedBuckets` with base `"GBP"`, no table: a fixed-price EUR bucket counts 1, a fixed-price GBP bucket 0.

- [ ] **Step 2: Run** `fx.base.test.ts`. Expected: FAIL (wrong arity / missing exports — vitest does not typecheck, so expect runtime failures on `currencyToBase is not a function`).

- [ ] **Step 3: Implement.** In `resolveRateInfo(bucket, fxRates, base)`: (1) `bucket.currency === base` → `{ "base", 1 }`; (2) per-EUR of the base = 1 for EUR, else cached `> 0`, else unresolved; (3) per-EUR of the bucket = 1 for an EUR bucket (an override on it stays ignored, as today), else `fxRateOverride > 0` (source `"override"`), else cached (`"cached"`), else unresolved; (4) either side unresolved → `{ "unresolved", 1 }`; else rate = bucket per-EUR ÷ base per-EUR, with source from step 3 (`"cached"` for an EUR bucket). Rewrite the docblocks: the override keeps its stored meaning (units of the bucket currency per 1 EUR). Then thread `plan.currency` through every caller tsc reports; delete `planCurrencyPerEur` and its divisor uses (`budget-report-panel.tsx`'s `blendedRate` division goes too). Update the §473 comments in `types.ts` (`ResourcePlan.currency`) and `evm.ts` to say rates are in the baseline and the engine computes in it.

- [ ] **Step 4: Update the existing tests** by renaming calls and adding `"EUR"` (or `plan.currency` where a fixture plan exists). Change NO expected value. Verify with `git diff -U0 -- 'src/app/*.test.ts' 'src/app/*.test.tsx' | grep -E '^[-+]' | grep -vE 'currencyToBase|currencyToEur|baseToCurrency|eurToCurrency|resolveRate|countUnresolvedBuckets|planCurrencyPerEur|bucketRateRows|^(\+\+\+|---)'` — expected: no output (every changed line is a call-site edit).

- [ ] **Step 5: Run** `fx.base.test.ts` plus every test file listed under Files. Expected: PASS, `Test Files` count equal to the number of files passed. tsc + eslint on changed files.

- [ ] **Step 6: Commit** — `git commit --only <all files above> -m "refactor: the budget engine computes in the project's baseline currency (§476)"`

---

### Task 3: `baselineHistory` across the six write paths

**Files (mirror `budgetHistory` at each site — enumerate with `git grep -n 'budgetHistory\|BudgetHistory' -- 'src/app/*.ts' 'src/app/*.tsx' | grep -v '\.test\.'`):**
- Modify: `workspace.ts` (type field, JSON write, JSON read + `noteIfDropped`), `turso-schema.ts` (decode `decodeMeta("baselineHistory", sanitizeBaselineHistory)`, dirty-marking, meta write), `turso-tenant-schema.ts` (tenant meta write), `csv-codecs-config.ts` + `csv-codecs-decode.ts` (section `CSV_SECTION_BASELINE_HISTORY`, `baselineHistoryToCsv` / `csvToBaselineHistory`), `markdown-codecs-core.ts` + `markdown-codecs-decode.ts` (`baselineHistoryToMarkdown` / `markdownToBaselineHistory`), `idb-layout.ts` + `browser-backend.ts` (KV key, read, write), `workspace-context.tsx` (state + setter), `use-storage-backend.ts` (apply on load, outgoing workspace, slice lists; it is at 1571 lines — stay under 1600), `use-workspace-sync.ts` (broadcast), `workspace-slice-policy.ts` (a row).
- Test: `src/app/baseline-history-persistence.test.ts` (new, modelled on `budget-history-persistence.test.ts`); extend `entity-persistence-registry.test.ts` / `is-workspace-empty.test.ts` only where a budgetHistory row exists there.

**Interfaces:**
- Consumes: `BaselineEntry`, `sanitizeBaselineHistory` (Task 1).
- Produces: `Workspace.baselineHistory?: readonly BaselineEntry[]` (meta key `"baselineHistory"`, written only when non-empty, like `budgetHistory`); `useWorkspace().baselineHistory: readonly BaselineEntry[]` and `setBaselineHistory: Dispatch<SetStateAction<readonly BaselineEntry[]>>`.

- [ ] **Step 1: Write the failing test** `baseline-history-persistence.test.ts`: one fixture workspace with two entries (`{ from: "2026-01-05", at: "2026-01-05T08:00:00.000Z", currency: "GBP" }` and a USD entry with `perPrevious: 1.3`) round-trips byte-equal (`toEqual`) through each of: JSON (`workspaceToJson`/`jsonToWorkspace`), CSV, Markdown, Turso single (statements executed against `node:sqlite` the way `turso-schema.execute.test.ts` does, then decoded), Turso TENANT (same, with a project id), and IndexedDB (the way `budget-history-persistence.test.ts` covers it). One `it` per path, named after the path. Plus: a workspace WITHOUT the slice writes no `baselineHistory` key/section on any path.

- [ ] **Step 2: Run it.** Expected: FAIL on every path.

- [ ] **Step 3: Implement** each site as its `budgetHistory` twin. Slice policy: copy `budgetHistory`'s `counted` decision and write a reason specific to this slice (appended only by a confirmed switch; losing it re-labels old snapshots in the wrong currency).

- [ ] **Step 4: Run** the new test plus `budget-history-persistence.test.ts`, `workspace-slice-policy.test.ts`, `is-workspace-empty.test.ts`, `golden-workspace.test.ts`, `entity-persistence-registry.test.ts`, `turso-schema.test.ts`, `turso-tenant-schema.test.ts`, `browser-backend.test.ts`, `use-storage-backend.test.tsx`. Expected: PASS; golden fixtures unchanged (`git status --short src/app/__fixtures__` empty). `npm run size:check` exit 0.

- [ ] **Step 5: Commit** — `-m "feat: persist the baseline-currency history on all six write paths (§476)"`

---

### Task 4: The switch planner (pure)

**Files:**
- Create: `src/app/baseline-switch.ts`
- Test: `src/app/baseline-switch.test.ts`

**Interfaces:**
- Consumes: `crossRate`, `BaselineEntry` (Task 1); `materializeRoleRates` (`role-rates.ts`).
- Produces:
  - `export type SwitchRow = { kind: "role" | "bucket" | "change"; id: number | string; label: string; field: string; before: number; after: number }` — `label` is the raw entity name (the dialog translates field names, not labels).
  - `export type BaselineSwitchPlan = { from: BudgetCurrency; to: BudgetCurrency; rate: number; fxDate: string; roles: Role[]; buckets: BudgetBucket[]; changes: ChangeItem[]; entry: BaselineEntry; rows: SwitchRow[] }`
  - `export function planBaselineSwitch(input: { from: BudgetCurrency; to: BudgetCurrency; sessionRates: FxRates; roles: readonly Role[]; buckets: readonly BudgetBucket[]; changes: readonly ChangeItem[]; workdayHours: number; roleLabel: (r: Role) => string; nowIso: string }): BaselineSwitchPlan | null` — `null` when `from === to` or `crossRate(sessionRates, from, to)` is `null`.

- [ ] **Step 1: Write the failing tests** (rate EUR→GBP 0.852 via `rates: { GBP: 0.852 }`):
  - hour-basis role `internalRate: 100, externalRate: 140, internalRateDay: 800, externalRateDay: 1120` → `85.2`, `119.28`, `681.6`, `954.24`; a legacy hour role WITHOUT day fields stays without them.
  - day-basis role, `workdayHours: 7.5`, `internalRateDay: 750` → `internalRateDay: 639`, `internalRate: round2(639 / 7.5) = 85.2` — derived from the converted day rate, not `round2(100 * 0.852)` (Review Focus 4).
  - bucket `rateOverrideInternal: 90` → `76.68`; a bucket without overrides is returned unchanged (same object); `fixedPriceAmount` and `fxRateOverride` are never touched.
  - change `costImpact: 5000` → `4260`; a change without `costImpact` unchanged.
  - `rows` lists every changed number once with before/after; `entry` is `{ from: nowIso.slice(0, 10), at: nowIso, currency: "GBP", perPrevious: 0.852 }`; `rate` 0.852, `fxDate` = `sessionRates.date`.
  - `from === to` → `null`; INR target with no INR rate → `null`.
  - round trip EUR→GBP→EUR at the same table leaves `internalRate` within 0.01 of 100 (Review Focus 1).

- [ ] **Step 2: Run.** Expected: FAIL — module not found.
- [ ] **Step 3: Implement** `planBaselineSwitch` (i18n-free). Day-basis roles: convert both day fields, then `materializeRoleRates(role, workdayHours)`.
- [ ] **Step 4: Run.** Expected: PASS. tsc + eslint.
- [ ] **Step 5: Commit** — `-m "feat: plan a baseline-currency switch, converting rates and cost impacts once (§476)"`

---

### Task 5: Display in the baseline, and read-time rebase

**Files:**
- Modify (CHANGE sites from the 29-literal list — `git grep -n '"EUR"' -- 'src/app/*.ts' 'src/app/*.tsx' | grep -v '\.test\.' | grep -v 'src/app/i18n'`): `budget-forecast-cards.tsx:415`, `budget-forecast-facts.tsx:30`, `budget-panel.tsx:112` (new bucket defaults to `plan.currency`) and `:148` (`projCur`), `budget-rate-mix-details.tsx:42`, `budget-rate-mix-text.ts:40,117,132`, `budget-report-panel.tsx:145,210,214`, `dashboard-panel.tsx:352`, `export-forecast-section.ts:68`, `forecast-format.ts:14,22` (`formatMoneyCompact` gains a `currency` parameter; callers in `budget-forecast-link.tsx`), `trends-panel.tsx:125`. Each takes the baseline from the props/context it already has (`plan.currency`).
- KEEP (do not edit; list them in the commit body): `browser-backend.ts:122`, `budget-bucket-modal.tsx:276,513` (the override is per EUR), `ecb.ts:25`, `fx.ts`, `resource-cost.ts:13` (comment), `sanitize-entities.ts:811,822,826`, `types.ts:629,657,734`, `use-portfolio-health.ts:35` (RAG-only fallback plan).
- Rewrite the `★` comments at `dashboard-panel.tsx:345-351`, `budget-panel.tsx:140-147` and `trends-panel.tsx:118-124`: they justify EUR by "the engine converts nothing" (§465), which this task makes false — the figures are in the baseline.
- i18n (`i18n.ts` + `i18n.de.ts`): the 15 EUR/€ strings (`grep -nE 'EUR|€' src/app/i18n.ts | grep -iE 'budget|rate|cost|forecast|burndown|trend'`). `budgetFxOverrideHint` KEEPS "EUR" (the override is per EUR). Labels shown beside a figure take the currency as `{0}` (`budgetUnitPerHour`, `budgetReportColBudgetEur`, `budgetReportColConsumed`, `burndownUnitEur`, `forecastMixChip*`); hints say "in the project currency" (`budgetRateOverrideHint`, `rolesInternalRateHint`, `rolesExternalRateHint`, `rolesInternalRateDayHint`, `rolesExternalRateDayHint`, `budgetReportColWinLossHint`, `changeFieldCostImpactHint`). Key NAMES stay; the persisted `ChartUnit` value `"eur"` stays (a stored setting).
- `chat-tool-defs.ts:105`: `costImpact` description → `"Cost impact, in the project's currency"`.
- Rebase wiring: `use-snapshots.ts` (`UseSnapshotsArgs` gains `baselineHistory: readonly BaselineEntry[]`; `rebaseSnapshots` applied to `snapshots` BEFORE `pickBaseline`/`sorted`/`latest`, lines 327-329) with `use-trend-snapshots.ts` passing it; `budget-forecast-bundle.ts:46` (`summarizeBudgetHistory(rebaseBudgetHistory(input.budgetHistory, input.baselineHistory))`, input gains `baselineHistory`) and its callers; `ai-dashboard-snapshot.ts` (rebase before it reads `recentChanges`).
- Help: `grep -nE 'EUR|€' src/app/help-content*.ts src/app/i18n.ts | grep -i help` — reword any that claims money is always EUR.
- Tests: `budget-forecast-bundle.test.ts`, `use-snapshots` tests (`grep -rl useSnapshots src/app --include=*.test.*`), `forecast-format` tests, plus the files whose rendered text changes.

**Interfaces:**
- Consumes: `rebaseSnapshots`, `rebaseBudgetHistory` (Task 1); `useWorkspace().baselineHistory` (Task 3).
- Produces: `formatMoneyCompact(amount: number, currency: BudgetCurrency, locale: string): string`.

- [ ] **Step 1: Write the failing tests:** a `budget-report-panel` render with `plan.currency: "GBP"` shows `£` and no `€` in the money cells; `formatMoneyCompact(261150, "GBP", "en-GB")` contains `£`; `useSnapshots` with a history entry EUR→GBP 0.85 after a stored snapshot (`remainingCost: 1000`) returns `remainingCost: 850` in `snapshots` AND in `latest`; `computeForecastBundle` with the same history scales `history.baseline.value`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the sweep, comments, i18n (DE via node utf8 script on `\r\n`), and rebase wiring.
- [ ] **Step 4: Run** the new tests and every test file whose expected text includes `€` for a sweep site (`grep -rlE '€|EUR' src/app --include=*.test.tsx --include=*.test.ts` intersected with the touched components). With an EUR plan nothing visible changes, so existing assertions must pass unedited; the `i18n-encoding` test too. tsc + eslint. Re-run the 29-literal grep: the remaining hits are exactly the KEEP list.
- [ ] **Step 5: Commit** — `-m "feat: money is shown in the project's baseline currency; past snapshots and budget history are rebased (§476)"`

---

### Task 6: The switch control in the Budget panel

**Files:**
- Modify: `src/app/use-fx-rates.ts` (expose `sessionRates: FxRates | null`, set only by a successful `refresh` in this mount); `src/app/task-manager.tsx` lines 1125 and 1470 ONLY, on the existing lines (`sessionRates: fxSessionRates` in the destructure; `fxLoading, fxSessionRates,`); `workspace-section-types.ts` (`fxSessionRates?: FxRates | null` beside `fxLoading`); `workspace-section.tsx` (thread it to `BudgetPanel`); `budget-panel.tsx` (prop `fxSessionRates?: FxRates | null`; render `<BaselineCurrencyControl>` immediately before the FX refresh `Button`, not when `isPopout`).
- Create: `src/app/baseline-currency-control.tsx` (picker + hint; reads `useWorkspace()` for `plan`, `roles`, `budgets`, `changes`, `setPlan`, `setRoles`, `setBudgets`, `setChanges`, `setBaselineHistory`), `src/app/baseline-switch-dialog.tsx` (pure presentational: `Modal` + `ModalHeader`, the rows table, Cancel focused on open and first in the footer, confirm `Button` `variant="primary"`).
- i18n keys (EN; DE alongside): `baselineCurrencyLabel` "Project currency", `baselineCurrencyHint` "All money in this project is computed and shown in this currency. Rates for other currencies are ECB reference rates crossed through EUR: fine for project budgeting, not for treasury.", `baselineCurrencyNeedsRates` "Refresh the ECB rates first: the switch converts your rates at today's rate.", `baselineSwitchTitle` "Switch project currency to {0}?", `baselineSwitchRate` "1 {0} = {1} {2} (ECB, {3})", `baselineSwitchPast` "Past months, snapshots and budget history keep their values.", `baselineSwitchNoUndo` "This cannot be undone. To go back, switch the currency again.", `baselineSwitchColItem` "Item", `baselineSwitchColBefore` "Before", `baselineSwitchColAfter` "After", `baselineSwitchConfirm` "Switch to {0}".
- Tests: `src/app/baseline-currency-control.test.tsx`, `src/app/use-fx-rates.test.ts` (extend or create).

**Interfaces:**
- Consumes: `planBaselineSwitch` (Task 4), `useWorkspace()` setters (Task 3), `Select` (`form-controls.tsx`).
- Produces: `BaselineCurrencyControl({ lang, sessionRates, workdayHours }: { lang: Lang; sessionRates: FxRates | null; workdayHours: number })`.

- [ ] **Step 1: Write the failing tests** (`baseline-currency-control.test.tsx`, rendered inside the workspace provider with an EUR plan, one role at 100, `fxRates` CACHED in context):
  - `sessionRates: null` → the select (accessible name "Project currency") is disabled and the `baselineCurrencyNeedsRates` text is shown, although `fxRates` is cached (Review Focus 3).
  - `sessionRates` with GBP 0.852 → choosing GBP opens the dialog naming "Switch project currency to GBP?", a row `100 → 85.2`; Cancel (focused on open) leaves `plan.currency` "EUR" and the role at 100.
  - Confirm → `plan.currency` "GBP", role `internalRate` 85.2, `baselineHistory` has one entry with `perPrevious` 0.852.
  - Escape closes like Cancel.
  - `use-fx-rates`: `sessionRates` is `null` before `refresh`, the fetched table after a successful one, still `null` after a failed one.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The confirm handler calls the five setters with `planBaselineSwitch`'s results and calls no undo `capture*` function. Follow `docs/AGENTS/ui-shell.md` "dismissal" for Escape/Tab.
- [ ] **Step 4: Run** the new tests plus `budget-panel.test.tsx`, `budget-panel-edit.test.tsx`, `budget-panel-setup.test.tsx`, `workspace-section.test.tsx`. Expected: PASS. `npm run size:check` exit 0 (task-manager unchanged in length). tsc + eslint.
- [ ] **Step 5: Commit** — `-m "feat: switch a project's currency from the Budget panel, after a rate refresh (§476)"`

---

### Task 7: Pick the currency at creation

**Files:**
- Modify: `src/app/new-project-workspace.ts` (`NewProjectOpts.currency?: BudgetCurrency`; `buildNewProjectWorkspace` sets `plan.currency` and, when not EUR, `baselineHistory: [{ from: plan.startDate, at: <created ISO>, currency }]`; the `importedWorkspace` branch ignores it), `src/app/create-project-wizard.tsx` (a `Select` labelled `baselineCurrencyLabel` under the step-1 form, default `DEFAULT_CURRENCY`, passed in `handleCreate`; not shown on the import path).
- Test: `new-project-workspace.test.ts`, `create-project-wizard.test.tsx`.

**Interfaces:**
- Consumes: `BaselineEntry` (Task 1). `buildNewProjectWorkspace` gains a clock: `opts.nowIso?: string` (the wizard passes `new Date().toISOString()` from its handler, never at render).

- [ ] **Step 1: Write the failing tests:** `buildNewProjectWorkspace(meta, { currency: "GBP", nowIso })` → `plan.currency` "GBP", one history entry without `perPrevious`; `{}` → EUR, no `baselineHistory`; with `importedWorkspace` the imported plan's currency wins. Wizard: choosing GBP then creating passes `currency: "GBP"` to `onCreate`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both files. Expected: PASS. tsc + eslint.
- [ ] **Step 5: Commit** — `-m "feat: choose the project currency when creating a project (§476)"`

---

### Task 8: Docs, register, changelog, axe

**Files:**
- Modify: `AGENTS.md` ("Budget, FX and the Budget panel" bullet: the engine computes in `plan.currency`, not EUR), `docs/AGENTS/budget.md` (the EUR boundary section → the baseline boundary: `resolveRate`'s base, the per-EUR override, the cross rate, `baselineHistory`, the switch, read-time rebase), `docs/open-followups.md` (§476 CLOSED with a Status citing `git grep -c "planCurrencyPerEur" -- src/app` → 0 and `grep -c "baselineHistory" src/app/turso-tenant-schema.ts` → ≥1; remove its Work item line; banner the record as opened; a dated note on §473 that its "plan currency" is now the baseline; rebuild the index), `CHANGELOG.md` (Unreleased: "A project can be kept in EUR, USD, GBP or INR…"), `docs/desktop-rollout.md` only if its budget section says money is in EUR (`grep -n "EUR\|€" docs/desktop-rollout.md`).
- No code.

- [ ] **Step 1:** Edit the docs. Every count or claim gets its reproduce command beside it.
- [ ] **Step 2:** Run `npm run docs:symbols:check`, `docs:claims:check`, `followups:index:check`, `followups:status:check`, `followups:workitems:check`, `changelog:check`, `dup:check`, `size:check`. Expected: each exit 0.
- [ ] **Step 3:** Axe on the Budget view with the new control: `PORT=3100 npx playwright test e2e/a11y.spec.ts --project=chromium -g "Budget" --workers=1`. Expected: pass.
- [ ] **Step 4: Commit** — `git commit --only AGENTS.md docs/AGENTS/budget.md docs/open-followups.md CHANGELOG.md -m "docs: the budget engine's baseline currency, and §476 closed"`
