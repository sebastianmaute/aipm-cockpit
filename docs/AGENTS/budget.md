# Budget — the baseline currency, earned value, and the Budget panel's cell layer

Owns the budget engine's money: the FX boundary (`fx.ts`) and the rule that the engine computes every
figure in the project's BASELINE currency (`plan.currency`, §476), the baseline switch and its
history, how the plan's and a bucket's currency are sanitised on load, the budget-follows-plan
mirroring rule the panel and the engine share, bucket earned value (Phase C EVM), the Budget
panel's module map and column arithmetic, and the forecast import (§500).

Does NOT own the dashboard's budget tiles ([`dashboard.md`](dashboard.md)), the `budgetHistory` meta-blob slice
([`activity-log.md`](activity-log.md) "Sibling slice: `budgetHistory`"), the role rate card
([`platform.md`](platform.md) "Rate card = DAY rates"), the six-write-paths rule (`AGENTS.md`), or
the shared table header `SortResizeTh` ([`ui-shell.md`](ui-shell.md)). One fact, one doc.

★★★ **EVERY BUDGET FIGURE IS IN THE BASELINE (`plan.currency`), AND THERE IS EXACTLY ONE CONVERSION
POINT INTO IT** (§476, closed 2026-10-14; it replaced the EUR-only engine of §473). Role rates,
per-bucket rate overrides and a change's `costImpact` are STORED in the baseline, so `bucketRateRows`
passes them through unconverted to every money consumer — report, burndown, rate mix, forecast. The
one stored money field in another currency is `BudgetBucket.fixedPriceAmount`, in the BUCKET's
currency, and it passes through `currencyToBase`; the conversion sites are listed in "The FX
boundary" below. A new money term built from `bucketRateRows`, from role rates or from
`fixedPriceAmount` after `currencyToBase` is baseline already; converting it again is a second
conversion. The one conversion OUT is display: `baseToCurrency`, for a bucket card shown in the
bucket's own currency. The EVM tiles' blended rate (`budget-report-panel.tsx`) needs no conversion
any more, and the Resources views, the Budget panel's project row, the report and the dashboard all
format in `plan.currency`.

★★ **THREE BUDGET TYPES, TWO PRICED BY CONTRACT** (§488, 2026-10-02). `BUDGET_TYPES` is
`tm` · `fixed` · `e2e`; ask `isContractPriced(type)` (`types.ts`), never `type === "fixed"`, for
"is this bucket valued from `fixedPriceAmount`" — the amount, its FX conversion, the unresolved-rate
count, the rate-mix exclusion and the win/loss "—" gate all key on it. The two contract types differ
in ONE thing, consumption: `fixed` consumes a capped share of the contract by hours
(`min(price, price × actual / budget)`), `e2e` (end-to-end responsibility: the vendor owns delivery,
so budget hours are an estimate) consumes by COST — actual hours × internal rate, uncapped, so an
overrun reads past 100% and burns the burndown below zero. `computeBucketReport`,
`computeBurndownSeries` and the forecast's AC each branch on `type === "e2e"` for exactly that, and
`budget-burndown.test.ts` pins burndown ⟺ report parity for it. Converting a `fixed` bucket is
switching the type in the modal; the amount is kept. Labels come from `BUDGET_TYPE_LABEL`.

## The FX boundary (`fx.ts`)

- **The rate means units of the bucket's currency per 1 unit of the BASELINE.** `currencyToBase`
  divides by it, `baseToCurrency` multiplies. Both read `resolveRate(bucket, fxRates, base)`, whose
  `base` argument is REQUIRED (pass `plan.currency`), and `resolveRate` and `resolveRateSource` read
  ONE private precedence walk so the two cannot disagree: a bucket in the baseline → 1, source
  `"base"`; otherwise both sides are resolved against EUR, the unit of the cached ECB table — the
  baseline side from the cached rate (EUR itself is 1), the bucket side from a positive
  `fxRateOverride`, else the cached rate (an EUR bucket is 1) — and the rate is the CROSS RATE
  bucket-per-EUR ÷ baseline-per-EUR, with the bucket side's source (`"override"` or `"cached"`); when
  either side has no rate, 1, source `"unresolved"`.
- ★★ **`fxRateOverride` STILL MEANS "UNITS OF THE BUCKET'S CURRENCY PER 1 EUR"**, whatever the
  baseline. Its stored meaning did not change with §476, so a baseline switch never touches it; the
  cross rate divides it by the baseline's own EUR rate at read time. Do not "convert it to the
  baseline" in a switch or a migration.
- ★★ **THE EUR CASE IS DECIDED BEFORE THE OVERRIDE, AT READ TIME.** It used to be decided after, so
  a stale override left on an EUR bucket divided the contract (an 80,000 EUR contract with a stale
  1.1 printed 72,727). Fixed in 1.0.2 by `020ab762b`. The bucket modal now drops the override on
  save when the currency is EUR (§475, closed), but buckets nobody re-saves still carry theirs.
  Only the read-time rule repairs those (`bucketPerEur` in `fx.ts` ignores the override on an EUR
  bucket), so do not "simplify" it away on the grounds that the modal already clears the field.
  ★ The modal also HIDES the field on a bucket in the baseline currency (§476, it resolves to 1, source
  `"base"`), but KEEPS a stored value on save there: it is per EUR and matters again after a switch.
  Render and save read ONE predicate (`fxOverrideShown` in `budget-bucket-modal.tsx`), so a hidden
  field is never VALIDATED either: an invalid value it carries cannot block a save behind an error
  about a field the user cannot see.
- ★★ **`"unresolved"` AND `"base"` BOTH RETURN 1, AND SO CAN A REAL RATE.** Never infer "unresolved"
  from `resolveRate(...) === 1`. Ask `resolveRateSource`. `bucketCurrencyLabel`
  (`budget-currency-label.ts`) is shared by the Budget panel and the Budget report so both
  surfaces decide the `(×rate)` / no-rate marker from the SOURCE (§474, closed).
- ★ **Only a FIXED-PRICE bucket's OWN rate can put it at par.** A T&M bucket's money is hours × role
  rates, which are stored in the baseline, so the bucket's own missing rate changes none of its
  figures. A baseline other than EUR with no cached rate leaves EVERY bucket in another currency
  unresolved (the baseline side of the cross rate is missing), and the count says so.
  `countUnresolvedBuckets` counts fixed-price buckets only, and `BudgetFxRollupNotice` renders that
  count under the baseline project rollup. The report's detail table (`detailRowRateSource` and the
  `currencyLabel` in `BucketDetailTable`) renders an UNRESOLVED T&M row bare for the same reason; a
  T&M row with a resolved rate still gets `bucketCurrencyLabel`'s `(×rate)` suffix. The Budget
  panel's bucket CARD keeps the marker for T&M too, because the card displays through
  `baseToCurrency` at that same rate.
- **The conversion sites.** Every `currencyToBase` call converts `fixedPriceAmount`:
  `computeBucketReport`, `computeBurndownSeries` and the forecast (`budget-forecast.ts`).
  Re-derive rather than trust this list:
  `git grep -n "currencyToBase(" -- src/app ':!*.test.*'`. The one `baseToCurrency` caller is the
  bucket card (`git grep -n "baseToCurrency(" -- src/app ':!*.test.*'`).
- ★★ **`fxRates` IS A REQUIRED LAST PARAMETER** on `computeBucketReport`, `computeSpillover` and
  `computeBudgetReport` (`0221e4bab`), so `tsc` lists every call site. Do not give it a default. A
  caller whose buckets are all in the baseline passes `null`, which is behaviour-preserving because
  `resolveRate` returns 1 there. The budget-variance detector in `insights/detect.ts` passes an
  explicit `null` because it reads hours only. Its comment says to thread a rate first if it ever
  reads a money term.
- **Display.** The Budget panel's project row and the Budget report format in the baseline
  (`projCur` in `budget-panel.tsx` and the report's `money` helper both read `plan.currency`). A
  bucket card converts the engine's baseline figures outward with `baseToCurrency` for display in the
  bucket's own currency. The dashboard model carries `currency` (`plan.currency`), and the
  assistant's dashboard snapshot puts it at the top level (`ai-dashboard-snapshot.ts`) so the model
  is told which unit every money figure is in. Trends labels `remainingCost` in the baseline at the
  reader, because snapshots carry no currency (§469, closed) — they are rebased first (below). The
  dead `currency` column still sits in existing Turso `snapshot` tables. Dropping it is §551.

## The baseline currency and its history (§476)

- **Chosen at creation.** The create-project wizard (`create-project-wizard.tsx`) offers the
  currency; `new-project-workspace.ts` sets `plan.currency` and, for a currency other than the
  default, stamps a CREATION entry (no `perPrevious`) in `baselineHistory`. An imported workspace's
  own plan currency wins over the wizard's choice.
- **Switched from the Budget panel.** `BaselineCurrencyControl` (`baseline-currency-control.tsx`)
  sits in the Budget panel's toolbar, never in a popout (`!isPopout`). ★★ It is DISABLED until a
  rate refresh succeeds in THIS session: it reads `useFxRates().sessionRates`, never the cached
  `workspace.fxRates`, because the switch converts every stored rate once at today's rate and a
  months-old cached table must not drive it. Choosing a currency opens `BaselineSwitchDialog`
  (`baseline-switch-dialog.tsx`), which lists every converted value; only Confirm writes.
- **`planBaselineSwitch` (`baseline-switch.ts`) is the pure planner.** It multiplies every stored
  baseline money rate ONCE by the cross rate (`crossRate` in `baseline-currency.ts`: units of the new
  baseline per 1 unit of the old, via the EUR table), rounded to 2 decimals — the four role rates
  (day-based roles re-materialised), the two bucket rate overrides and every change's `costImpact`.
  ★ A day-basis role missing one day field (the sanitizer allows it) keeps that side's CONVERTED hourly
  rate and gets no invented day rate, where `materializeRoleRates` alone would zero it. The rule is
  `materializeDayBasisRole` (`role-rates.ts`), shared with both restore paths below.
  ★ An HOUR-basis role's hourly rate is authoritative: `convertRole` converts the hourly rates and
  RE-DERIVES any stored day field from them (`materializeRoleRates`), so the day rate never drifts a
  cent from the one the roles editor shows, and the dialog's day row shows that derived value. A day
  field the role does not carry stays absent. The restore chain calls `convertRole` per step, so it
  follows the same rule.
  The history entry's `from` is the PROJECT day (`today`, i.e. `clock.today` through `BudgetPanel`),
  never `nowIso.slice(0, 10)`, the UTC day; `at` stays the ISO instant.
  ★★ It NEVER touches `fixedPriceAmount` (stored in the bucket's currency) or `fxRateOverride`
  (per EUR, above). Confirm re-plans from LIVE state and writes through five setters (`setRoles`,
  `setBudgets`, `setChanges`, `setPlan`, `setBaselineHistory`). ★★ The three record setters are
  FUNCTIONAL and convert `prev` at the plan's rate (`convertRole` / `convertBucket` / `convertChange`),
  so a record another writer queued in the same tick is converted, not overwritten; one history append.
  ★★ Confirm first decides against the LIVE currency, not the one its render planned from: a probe
  `setPlan` updater (returns `p` unchanged, so StrictMode's double invoke is harmless) runs under
  `flushSync`, after every update queued before it, and records whether `p.currency` is still the
  plan's `from`. If a peer tab's switch landed in the same tick, nothing is converted, appended or
  logged — otherwise the money would be converted twice.
  A pending choice that stops being a switch (a peer tab made it) is dropped by a render-time
  reconcile, so the dialog cannot reappear on its own later.
- ★★ **THE SWITCH IS NOT UNDOABLE.** It captures no undo entry; the dialog says so, and switching
  back is the way back (at that day's rate, so a round trip need not restore the old figures exactly).
  ★★ It also RETIRES every undo/redo entry captured before it, in this tab and in any peer tab its
  sync reaches: their images hold old-currency amounts. Mechanism: [`undo.md`](undo.md) "Gates on the stack"
  (`useDenominationEpoch`).
- ★★ **Money drafted before a switch is never written after it.** Two places hold old-currency amounts
  the switch cannot reach:
  - **An open bucket or change editor.** `BudgetBucketModal` and `ChangeEditModal` capture the
    denomination key (`denominationKey`: currency plus history length, the same key the undo epoch
    counts) when they MOUNT, which is when they open, through `useDenominationMovedSinceOpen`
    (`use-denomination-epoch.ts`). If a peer tab's switch reaches this tab while the editor is open,
    Save writes nothing and toasts `guardDenominationChanged` (through `reportSilentFailure`, like
    the `editVanished` guard); the user closes the editor and edits again. The check lives in the
    modals because the save hooks (`commitBuckets`, `handleSaveChange`) have no notion of when an
    editor opened.
  - **A stored AI insight recommendation.** `recommendationPredatesSwitch` (`insights/insight.ts`)
    is true when a proposed call carries a money argument (`REC_MONEY_ARGS`, today only
    `costImpact`, found at any depth of the call's input) and a switch was made after the
    recommendation was generated. ★ "After" is the HISTORY, not the day: the stored
    recommendation is stamped with `baselineHistory.length` and `baselineHistoryDigest` as they
    were when its prompt was built (`historyLength` and `historyDigest`, carried on the
    generators' prompt-time snapshot, `RecommendSnapshot`, and stamped in
    `useInsightRecommendations`' store callback). A longer history at apply means a switch since.
    A SHORTER one, or an equal length with a different digest (an import that dropped one entry
    and added another), means the history was replaced, so the currency the amounts were written
    in is unknown, and it is refused too. The digest hashes each entry's `at`, currency and
    `perPrevious` in SORTED order: a switch appends in memory, but a reload orders the history by
    `at`, so the same entries arrive in either order and must read as the same history. A
    length-only stamp (an earlier build of this feature) keeps the length rule alone.
    `generatedAt` is only a day, so comparing it would refuse a recommendation regenerated on the
    day of a switch for the rest of that day. A recommendation with no stamp (an older build) is
    refused once the history holds any switch entry (one with `perPrevious`; the creation entry
    is not one). Both stamps are persisted (`sanitizeInsights` keeps a non-negative integer and a
    16-character hex digest) and count as material changes in
    `insightsMateriallyEqual`. `insight-money-args.test.ts` makes every number argument of an
    allowed tool either a money argument or one named in its explicit non-money list, nested
    object properties and array items at any depth included, so a new one must be classified.
    `confirmInsightRecommendation` then refuses the WHOLE apply: nothing is written, the insight
    stays `proposed`, and the toast (`insightRecommendationCurrencyChanged`) says the currency
    HISTORY changed (not necessarily the currency) and asks for a new recommendation.
    Calls without money arguments apply as before.
- **The switch is LOGGED** (owner requirement): Confirm writes ONE `plan.currencySwitched` activity entry, actor
  `"user"`, args `[from, to, rate, ECB date]` (rate rounded by `roundRate` to 6 decimals). The stored
  args never change; the activity PANEL formats the rate and the date in the viewer's locale at render
  (`activityMessage` with `{ display: true }`, `ACTIVITY_ARG_DISPLAY` in `activity-message.ts`, a
  per-kind hook no other kind uses). The audit download and the AI prompt omit the option and keep the
  stored ISO date and raw rate. The
  completion trend does not read it (pinned in `completion-trend.test.ts`, "§476").
- **`baselineHistory` (`Workspace.baselineHistory`, entries `BaselineEntry`: `from`, `at`,
  `currency`, `perPrevious?`).** Every switch appends one entry whose `perPrevious` is the cross rate
  it used. It is a meta-blob slice on all six write paths
  (`grep -c "baselineHistory" src/app/turso-tenant-schema.ts` → 3) and, like `budgetHistory`, is
  absent from the version capture, so a restore never REPLACES it ([`activity-log.md`](activity-log.md)).
  ★★★ **A VERSION RESTORE NEVER CHANGES `plan.currency`, AND CONVERTS THE MONEY IT RESTORES** (pre-merge
  ruling, superseding an earlier design that appended a "switch back" entry: restore is per record and per
  field, so restoring the plan record alone re-labelled new-currency rates, and a per-field rate restore
  wrote old-currency values with nothing appended). `prepareRestoredVersion` (`baseline-switch.ts`) runs on
  the parsed VERSION before the diff and the merge (`useVersionHistory.restore`'s `prepareVersion`, wired in
  `use-version-history-wiring.ts` with the LIVE history, currency and workday hours): it pins the plan's
  currency, and converts the planner's money fields (`ROLE_FIELDS`, `BUCKET_FIELDS`, `costImpact`) through
  every later switch IN ORDER (`laterSwitchRates`), round2 and a day-basis re-derive at EACH step — exactly
  what the successive switches did, so a value untouched since the version comes back to the cent (one
  compound `rebaseFactor` rounded once drifts by 0.01 after two switches). No later switch → no money
  converted; an unknown capture time converts nothing. Either way a day-basis role's hourly rates are
  re-derived at the CURRENT workday hours, so a compare against now shows no hourly row for an unchanged
  day rate. ★★ A per-field restore takes a day-basis role's day and hourly rate as a PAIR (`applyRestore`,
  `DAY_RATE_PAIRS` in `version-restore.ts`, re-materialised at the `workdayHours` the wiring passes). Never `fixedPriceAmount` or `fxRateOverride`. A restore
  appends no history entry and logs no currency row. ★ A compare against NOW runs the same
  conversion (`loadDiff`), so its rows, the selections built from them and the values written agree, and
  no currency row appears; a version-to-version compare stays RAW (no single denomination). A capture
  time missing from the loaded list applies no switch rates (no money is converted), still re-derives
  day-basis roles' hourly rates at the current workday hours, and logs `version.captureTimeUnknown`.
  ★ `sanitizeBaselineHistory` drops a `perPrevious` outside [1e-4, 1e4]: one absurd entry would push
  `rebaseFactor` to Infinity or 0 for every earlier record.
- ★★★ **STORED HISTORY IS NEVER REWRITTEN; IT IS REBASED AT READ TIME.** Snapshots and
  `budgetHistory` entries stay in the currency they were captured in. `rebaseFactor` multiplies the
  `perPrevious` of every switch LATER than a record's timestamp, and `rebaseSnapshots` and
  `rebaseBudgetHistory` (both defined in `baseline-currency.ts`) apply it before any reader sees the
  record; they are CALLED FROM `use-snapshots.ts` and `budget-forecast-bundle.ts` respectively. A new reader of either must go through those two call sites, never the raw
  slice: `git grep -n "rebaseSnapshots(\|rebaseBudgetHistory(" -- src/app ':!*.test.*'`.
  ★ `buildDemoSnapshots` computes from TODAY's rates but stamps a past `capturedAt`, so it divides each
  record's money by `rebaseFactor(baselineHistory, capturedAt)` (`scaleSnapshotMoney`): stored in the
  currency in force at capture, the read-time rebase brings it back instead of converting it twice.
  ★ The ordering is by WALL CLOCK across devices: `rebaseFactor` and `laterSwitchRates` compare the
  switching device's `entry.at` with a record's `capturedAt`, which another device's clock stamped. A
  capture made just after a switch on a device whose clock runs behind sorts before the switch and is
  converted twice. Inherent to timestamps from different clocks, and accepted.
- ★ **Two rate tables.** The switch converts role, bucket-override and change money at the SESSION ECB
  rates (`useFxRates().sessionRates`), while the budget engine converts a bucket in another currency at
  the CACHED `workspace.fxRates`, which may be older. The refresh that fills the session table also
  caches it (`useFxRates`' `onLoaded`), so the two usually match; a load or a peer tab's synced state
  can still put an older cached table beside a switch made at today's rates, and then a converted rate
  and an engine-converted bucket disagree slightly until the next refresh.

## Where the rates come from, and rounding

- `useFxRates` fetches `/api/ecb` on demand and passes the table through `sanitizeFxRates` before
  the caller caches it on the workspace. The JSON, CSV, Markdown and Turso load paths use
  `sanitizeLoadedFxRates`, which keeps a stored snapshot whose date is not a calendar date
  (`git grep -n "sanitizeLoadedFxRates(" -- src ':!*.test.*'`). ★ The IndexedDB path is not among
  them: `browser-backend.ts` assigns its stored table verbatim.
- ★ Both sanitizers reject any table whose `base` is not `"EUR"`. They pin `EUR = 1` at its position
  in `SUPPORTED_CURRENCIES`, so a table decodes byte-stably through a JSON round trip (§576,
  closed). They also ROUND every other rate to 6 decimals. A bucket's `fxRateOverride` is rounded
  separately, to 4 decimals, by the bucket sanitizer in `sanitize-entities.ts`.
- ★ `displayHours` (`budget-panel-totals.tsx`) rounds READ-ONLY hours to 2 decimals for DISPLAY
  only. Three cases reach it: a mirrored budget cell, an actual cell locked because its hours come
  from TimeLog, and every `TotalsTd` figure. The stored and aggregated values keep their float
  noise. Editable cells are not rounded, because rounding while the user types fights the input.
  Re-derive the cases with `grep -n "displayHours(" src/app/budget-panel-totals.tsx`.

## Currency on the plan, and the load paths

- `ResourcePlan.currency` is narrowed to `BudgetCurrency` (`SUPPORTED_CURRENCIES`: EUR, USD, GBP and
  INR today; `grep -n "SUPPORTED_CURRENCIES = " src/app/types.ts`).
- ★★ **THE INDEXEDDB LOAD PATH IS THE ONE PATH THAT DOES NOT RUN `sanitizePlan`**, and it coerces
  a stored plan instead (in `browser-backend.ts`; `isBudgetCurrency` gates the
  currency). Do not "complete the pattern" by calling `sanitizePlan` there. It would also swap
  reversed dates and drop an explicit `budgetFollowsPlan: false`. Instead the exported `coerceStoredPlan` (§470, closed
  2026-10-02) coerces FIELD-WISE: `currency` (else `"EUR"`), an out-of-union `granularity` (else
  `"month"`) and a start or end date that does not parse (each replaced ALONE by the default's —
  which can itself produce a reversed window, left unswapped like any stored one). The suite pins
  each shape with its own fixture.
- ★★ **THE PLAN CURRENCY IS THE BASELINE (§473 closed 2026-10-02, §476 closed 2026-10-14).** §473
  decided that rates are in the plan's currency and converted them to EUR; §476 made that currency
  the unit the engine computes in, so rates are no longer converted at all. A fixed-price bucket in
  the baseline is at par by definition (source `"base"`), so its contract and its cost share one unit
  and the margin is the contract-currency margin — the case §473 had to fix by reusing the bucket's
  rate resolution, a helper that is now removed.

## Budget follows plan

- `effectiveBudgetHours` (`budget-report.ts`) is the rule: when `plan.budgetFollowsPlan` is on AND
  the allocation has resources, a period's budget hours are the live planned capacity, otherwise the
  stored `budgetHours` entry. The panel's `cellBudget`, the report, the burn-down, the rate-mix
  signal and the budget-variance detector (`insights/detect.ts`) call it. Re-derive the callers with
  `git grep -n "effectiveBudgetHours(" -- src/app ':!*.test.*'`.
- ★ Mirrored cells are read-only in the panel (`readOnly={mirror}`), and their values carry float
  noise. That is one reason `displayHours` rounds read-only cells for display.

## Budget bucket earned value (Phase C EVM, ★)

- **Fields.** `BudgetBucket` carries `taskIds?: number[]` (tasks whose completion drives the bucket's
  derived progress) and `percentComplete?: number` (a manual 0-100 override that WINS over the
  derivation whenever set, including 0). Both are in `BUDGETS_CSV_COLUMNS` (so CSV and both Turso
  layouts, with `turso-migrate.ts` self-healing existing DBs) and `BUDGETS_MD_COLUMNS`.
  `budgetFieldToString` writes an empty cell when either is unset.
- **Engine.** Pure i18n-free `budget-earned-value.ts`. `bucketPercentComplete(bucket, tasks)`
  returns the manual value first. Otherwise it returns the share of `taskIds` that are
  `isTaskFinished` (Done or Cancelled) among the ids still present in `tasks`. With neither source
  resolving it returns 100 for a `status: "closed"` bucket (its work is over, and a null there would
  withhold the WHOLE project's earned value) and `null` for any other bucket, so it never guesses
  for an open one. `earnedValueFor(budgetedCost, pct)` returns budgetedCost × pct/100, or `null`
  when `pct` is `null`.
- `budget-report.ts` folds `earnedValue` and `costPerformanceIndex` (earned value ÷ actual cost,
  guarded on `cost > 0`) into both `BucketReport` and the project rollup.
  `costPerformanceIndexHealth` (`budget-health.ts`) bands the raw ratio (1 = on budget; it can
  exceed 1) as R < 0.8, A < 0.9, G >= 0.9. Those are the percent-flavoured `costPerformanceHealth`
  thresholds (`COST_PERF_RED` = 80, `COST_PERF_AMBER` = 90) divided by 100, so the two scales never
  collide.
- ★★ **THE PROJECT ROLLUP IS ALL-OR-NOTHING.** `projectEarnedValue` and
  `projectCostPerformanceIndex` are `null` unless at least one bucket has a budgeted cost above zero
  AND every such bucket has a known `earnedValue`. A bucket with no budgeted cost is exempt. One unscored bucket blanks the
  rollup rather than summing a partial figure, which is the same stance as `costIsKnowable`.
- **The tile.** The Budget panel's "Internal cost index" tile (`budgetCciInternalCostIndex`, the
  third of four `Cci` tiles in each row; `grep -n "<Cci label" src/app/budget-panel.tsx src/app/budget-panel-bucket-card.tsx`
  lists the project row and the per-bucket row) renders
  "—" whenever `costPerformanceIndex` is `null`.
- ★★ **THAT KEY HAS BEEN RENAMED THREE TIMES.** The name budgetCciCpi was first freed when the old
  BAC/AC tile became "Cost burn"/`budgetCciBurn`, then claimed by this EV/AC tile, which left two
  different quantities labelled CPI a click apart: this MONEY ratio and the EVM HOURS ratio
  `evmCpi`. The second rename (§464) made this tile "Cost recovery"/budgetCciRecovery. The third,
  in the forecast-figures MR
  (`docs/superpowers/specs/2026-09-14-budget-forecast-union-design.md` §11 "Three indices, one
  word"), introduced a price-based CPI/SPI pair on the forecast cards, so a bare "CPI"/"SPI" now
  means THAT index. This tile became "Internal cost index", and the hours ratio (keys `evmCpi` and
  `evmSpi`, unchanged) is rendered "Effort CPI"/"Effort SPI" on the Dashboard (the KPI strip, and the
  variance summary through `variance-format.ts`), the Budget report and Trends (the keys there are
  `trendKpiCpi`/`trendKpiSpi`;
  `git grep -ln "evmCpi\|trendKpiCpi" -- src ':!*.test.*'`). ★ The dead spellings budgetCciCpi,
  budgetCciCpiHint, budgetCciRecovery and budgetCciRecoveryHint are deliberately un-backticked here:
  all four were renamed out of the codebase, and `docs:symbols:check` fails on a backticked
  mixed-case name that exists nowhere.
- The bucket editor's task-link field reuses the shared `TaskLinkPicker`, so do not hand-roll one.
  Clearing the manual % writes `undefined`, not `0`, mirroring the rate-override clear.

## Budget panel module map (gantt pattern)

`budget-panel.tsx` is the orchestrator: state, derivation, the project-total CCI tiles, and the list
of bucket cards. Each card is `BudgetBucketCard` (`budget-panel-bucket-card.tsx`, the `*-rows` half of
the split, §274): pure presentational, every value it reads arrives as a prop. ★★ The two token maps
(`bucketTokens`, and `roleTokens` from `useDetailedRoleRows`) stay built in the panel, which holds the
list, and are passed down: a card cannot make its own name unique (§262). The tile component `Cci` and
the manual-percent editor `ManualPercentCell` live in the leaf `budget-panel-cards.tsx`. The bucket table's CELL layer is the presentational leaf `budget-panel-totals.tsx`: `HoursCell`/`HoursTd`
(the editable period cells), `TotalsTd` (the fixed Total column's cells and every cell of a bucket
total row), `BucketRowLeadCells` (the three PINNED leading cells: RAG dot · label · Total),
`BucketTotalRow`, `RowDot`, and the pure `bucketBudgetGrid` arithmetic. It was split out to keep
the orchestrator under the size ratchet, which was 800 at the time. The per-person sub-rows live in
`budget-panel-people-rows.tsx`.

- ★★ **The three leading columns are PINNED by arithmetic.** The role column is at `DOT_COL_PX` and
  Total at `DOT_COL_PX` + the LIVE role width, because the role column is user-resizable and a
  hardcoded offset drifts the moment it is dragged. That arithmetic holds only while every column to
  a pinned one's LEFT renders exactly as wide as it declares, and TWO independent mechanisms break
  that. `table-layout: auto` lets CONTENT push a column past its declared width, so the dot header's
  label is `sr-only` and the role cells are clamped (`BucketRowLeadCells` gives the role `<td>`
  `truncate` plus `width` and `maxWidth` equal to the role width; without it a long discipline name
  grows the cell and the pinned Total sits on top of the label). A `w-full` table spreads LEFTOVER width across every column, pinned ones
  included, so the table is `w-max`. ★ The `w-max` cost is real and deliberate: a short plan no
  longer stretches to fill the pane. ★ jsdom has no layout, so nothing in the unit suite can see any
  of this. The tests pin the class and offset plumbing only, and the geometry was measured in
  Chromium.
- ★★ The total row's separating rule rides `cellClass` onto the CELLS, never the `<tr>`. §68
  (closed) records why a `<tr>` border in these tables has never painted.
- ★★★ **`bucketBudgetGrid` MAKES THE TWO AXES AGREE STRUCTURALLY (§71, closed).** It evaluates the
  caller's `cellBudget` ONCE per (row, period) into one grid, and the cell, the row total and the
  column totals all reduce that grid. It replaced a helper, bucketColumnTotals (deliberately
  un-backticked: it was removed), that took `cellBudget` as an accessor and kept the axes in step
  only by convention. `cellBudget` is still the compute function, so budget-follows-plan mirroring
  is honoured. It is fed the FILTERED rows, so the totals follow the role filter (§70, closed).
  ★ It THROWS on a row it was not built from rather than summing it as 0, since a silent 0 is a
  plausible wrong money figure. That path is unreachable from today's one call site.
- ★★ **A ROLE CELL IS TWO LINES AND A PERSON SUB-ROW IS ONE**, so they can only line up
  horizontally, and that alignment is arithmetic. `HOURS_LINE_UNITS` (exported from
  `budget-panel-totals.tsx`) is the `w-14` label + `gap-1` + `w-16` value box counted in Tailwind
  SPACING UNITS (14+1+16=31), i.e. where the box's right edge lands from the cell's content-box
  left. `HoursFigure` (`budget-panel-people-rows.tsx`) right-aligns a block of exactly that width
  (`HOURS_LINE_REM`), so the person figures share the role's value-box column. They used to carry
  `text-right` on the `<td>`, which anchored them to the far edge of a much wider period column.
- ★★ `text-right` must therefore be ABSENT from the cell and PRESENT on the block. Leaving it on both
  renders identically for a figure that happens to fill the block and drifts for one that does not,
  which is a fixture-dependent failure that survives a test suite.
- ★★★ **UNITS, NOT PIXELS, and a `pr-1` matching the box's `px-1`.** Both were review findings
  against a first cut that used a px constant and no padding, and each broke the alignment alone. A
  px block tracks the rem-based `w-14`/`w-16` only at a 16px root font size. A block that is merely
  the same WIDTH puts its digits one unit right of every role figure, because the value box's own
  `px-1` stops its digits short. That was a visible ~4px stagger: the boxes lined up and the numbers
  did not, and the numbers are what a reader compares. (`DOT_COL_PX` and `TOTAL_COL_PX` are genuinely
  px and predate this. The sticky-column arithmetic they drive already assumes a 16px root.)
- ★ The bordered `HoursCell` inputs still stop 1px short of the read-only `TotalsTd` spans, since
  `border` is px. That is pre-existing, between the role rows' own two spellings, and not closable
  from the person row.
- ★ The Total column lines up by derivation, not luck: `TOTAL_COL_PX` is this width plus the cell's
  `px-3` (124+24=148), as the docstring on `TOTAL_COL_PX` says. Cite the SYMBOL when referring to
  it. Two consecutive revisions of this bullet got that docstring wrong (once calling the alignment a
  coincidence, once quoting an unmeasured line distance).
- ★★ **What the tests pin.** jsdom cannot compare the two edges, so `budget-panel-people-rows.test.tsx`
  ties `HOURS_LINE_UNITS` to the classes in BOTH role cells. `budget-panel-totals.tsx` spells the three
  widths FOUR times, twice in `TotalsTd` and twice in `HoursCell` (the editable inputs the period
  columns align against). A first cut covered `TotalsTd` only, so changing `HoursCell`'s `w-14` broke
  every person period figure with the suite green. Re-check the four with
  `grep -n 'className=.*w-14' src/app/budget-panel-totals.tsx` (a bare `w-14` grep also hits the
comments).

## The forecast in exports (§545)

- **A DERIVED export section.** `budgetForecast` is an `ExportSectionKey` with no `Workspace` slice behind
  it: `buildExportSections` takes an optional `ExportExtras` argument whose `budgetForecast` is the dashboard
  model's `forecastBundle`, and `export-forecast-section.ts` turns it into field/value rows. Without extras
  the section is skipped, which is why the CSV / Markdown / JSON workspace formats never carry it.
- **Who supplies it.** `task-manager.tsx` passes `dashboardModel.forecastBundle`, or null with the budget
  module off, to its own export handler and, through `buildShellChrome`, to BOTH header mounts of
  `ExportMenu` (`AppHeader` and the modern top bar). A new export entry point that omits it exports no
  forecast, silently.
- **Documents embed it too.** `DATA_SECTION_KEYS` is every export key, so a `dataSection` block, the block
  editor and the `create_document` tool enum accept `budgetForecast`. The renderers (`renderDocumentHtml`,
  `renderDocumentDocx`, `renderDocumentPptx`) and `downloadDocument` take the same `ExportExtras` as an
  optional trailing argument and pass it to `resolveDataSection`. The document leaves read it from
  `ExportExtrasProvider` (`export-extras-context.tsx`), which `WorkspaceSection` provides from the
  `exportForecast` that `task-manager.tsx` puts in `workspaceProps`: the preview, the history row's
  preview, the Documents pane's downloads and the chat document card. ★★ A NEW leaf that renders or
  downloads a document must call `useExportExtras()` and pass the result on. The argument is optional,
  so a leaf that forgets it compiles and renders the block as nothing, with no error. The block also
  renders nothing with the budget module off or no forecast. Popouts DO show it: their `legacyTree`
  renders `WorkspaceSection`, which provides it.
- ★ A new derived section goes into `DERIVED_EXPORT_SECTION_KEYS`; `SLICE_EXPORT_SECTION_KEYS` is every key
  minus those, and `export-workspace.test.ts` fails if a key is in neither list, because it is not a slice.

## The simulated cost range sits beside the calculated pace (§502 part 3)

★★ The calculated "at current pace" forecast is unchanged by the simulation. It still drives the Budget health dot
(`paceVacHealth`), the forecast gap and the export pace leg; the simulated cost at finish (`ForecastBundle.sim`)
sits beside it on the pace card, the burn charts, the tile and the Forecast view, and nothing downstream of those
three reads it. A change that makes a health figure read `sim` changes what a held-back, opt-in estimate does to a
colour users act on. Detail: [`forecast.md`](forecast.md) "Budget simulation — part 3".

## Forecast import (§500)

A bucket card's "Import forecast" opens `ForecastImportModal`; all logic is `useForecastImport`, and the
engines live in `src/app/budget-import/` (no i18n, no React).

- **Two routes, one reader.** A file becomes `SheetGrid`s (`readSheetFile`: CSV, or xlsx through
  `extractXlsxGrid`; a 1904-system workbook, `isDate1904Workbook`, has its serial-shaped cells moved to the 1900
  system, final review 3 M7, residue 41). The HAND route finds the columns (`detectLayout`, editable on the mapping step) and
  reads them with `gridToForecastRows`, deciding the decimal style once over all hours columns
  (`detectDecimalStyle`), never per cell; in German style a dot is only a thousands mark in groups of
  three, so a stray `2.5` is reported, not read as 25. ★★ A workbook is exempt from that guess
  (`SheetGrid.numbers` is "dot" for xlsx/xlsm): Excel stores every number cell with a dot, so those cells
  read with a dot and never vote — one `2.625` once flipped a whole column and read `7.5` as 75. Any
  column, wide or long and at any position, that holds numbers in most person rows but is neither read,
  mapped nor headed as a total (`isTotalHeader`: the total words plus `Q1`–`Q4`, `H1`/`H2`, `FY`/`GJ`),
  an employee number (`PersNr`, `ID` …) or a year column (`isYearColumn`) comes back as an `IgnoredColumn`
  and is listed under "Not imported" (a period-shaped cell, such as a workbook's serial date, never counts
  as a number there), and so does a count of data rows ABOVE the header row (`rowsAboveHeader`: a stacked
  year block above the detected header). A row counts only when it holds a number under one of the header's
  period columns with a period header of its own above it (on a long sheet: an hours number beside a period
  cell), so a metadata row (`Stand | 46296`, `Version | 3`, `Projekt | 4711`) is not reported. The person column is a mostly-text
  column headed Name / Mitarbeiter / Person / Resource …, else the first mostly-text one. ★★ A long
  sheet's PERIOD column is ranked (`periodRank`) by its header WORDS alone: a period word as a whole word of
  the header (`isPeriodWordHeader`: `Month`, `Monat`, `Period`, `Zeitraum`, `Week`, `KW` …; `Startmonat`
  holds none) first, then a `Date` / `Datum` header, then a real date over a bare serial; ties keep the
  leftmost. `Start date` once tied with `Month` and won, summing every row into the start month (final
  review I2). Its HOURS column is PRESELECTED by `preselectHours`: a header matching `HOURS_HEADER_RE`
  first, then the higher share, then the leftmost (round 9 I-D, below). The person is settled first, so
  a text column holding one number can still be the person, and as an hours candidate it loses the
  preselection to any hours-word or share-passing column; an ID or row-number column (`ID_HEADER`), a year column (`isYearColumn`), a
  column of period-shaped cells (a workbook's serial dates) and a column HEADED by a period (`Jan`, `Jan
  2026`) are never it — `ID | Name | Month | Effort` once imported the IDs (I3), and `Name | Start | Jan
  2026 | Feb 2026` read long with the Start date as the period and January as the hours (I4), where it now
  reads two-period wide. ★★★ **WHERE THAT DOES NOT SETTLE IT, DETECTION ASKS (fix 7, the owner's decision
  of 2026-10-13).** Three rounds of column-guessing rules each imported wrong hours: a rightmost-hours pick
  took `Ist`, `Actual`, `Summe` or `Betrag` over `Plan` (rr6 N1), a rank of month-LABEL cells over full
  dates summed a `Datum` sheet into its `Eintritt` month (rr6 N3), and a header-row stop in the removed
  Claude claim checker misfired on two-row headers. All were removed. `detectLayout` reports `ambiguous`
  (`ColumnAmbiguity`, from `ambiguityOf`): the HOURS whenever two or more candidates remain. ★★★ No
  header word settles it (fix 8, the owner's "fail closed" of 2026-10-13): an escape for exactly one
  NAMED hours column, later with a list of actuals words, read `Ist`, then `Iststunden`, `IstStd`,
  `Gebuchte Stunden`, `Spent hours` or `Logged hours` silently, one missed spelling per round (rr6 N1,
  rr7, rr8 N2); both are gone. So `Plan | Stunden`, `Stunden | Ist` and `Name | Monat | Stunden | Kosten`
  ask, and only a sheet with ONE column holding numbers (`Name | Monat | Stunden`, `ID | Name | Month |
  Effort`, `Nr | Name | Monat | Aufwand`) is clear. ★★★ A column is an
  hours candidate when it holds ONE number, and a period candidate when it holds ONE period (round 7
  I-B): a share once let two `-` in `Stunden` leave `Ist` the only candidate (the actuals imported), and
  an `offen` in `Monat` leave `Erfasst am` the only period. Whether a row is a header at all, and its
  score, still need a column passing the 80 % share (`COLUMN_SHARE`); the PRESELECTION does not (round 8
  m-1): the hours rank by an hours word (`HOURS_HEADER_RE`, `preselectHours`) first, then share, then the
  leftmost (round 9 I-D: the leftmost alone took `Ist`, `Tage`, `FTE`, a numeric `Team` or a one-number
  notes column over `Stunden`, and "These columns are right" imported it; `Forecast | Ist-Stunden` now
  preselects `Ist-Stunden`, residue 27), and the period ranks by header word (`periodRank`) first, then
  share, then the leftmost. And
  the PERIOD when two or more columns qualify and not exactly one is headed by a period word, that one
  preselected and passing the share (`Datum |
  Eintritt`, `Datum | Startmonat` ask; `Start date | Month` does not). The mapping it returns is still the
  default above, but `useForecastImport` then opens on the mapping step with a notice per field naming the
  candidates, and refuses Apply — the button disabled, the reason its accessible description — until each
  field is confirmed: its column chosen within the long layout (an edit of another field does not count,
  and ★★ nor does the layout control — Wide then Long rebuilt the questioned preselection from the
  defaults and once cleared the gate on the way, rr7 I2), the header row chosen in either layout, or
  "These columns are right". ★★ A confirmation belongs to its (layout, field) pair AND the value it
  confirmed (`unconfirmedOf`, fix 9 m-a): a period chosen in Long once also cleared the questioned Wide
  reading, so flipping back to Wide applied it; flipping back now re-arms the open fields, and a
  round-trip that resets a chosen column waits again. Re-detecting asks again. ★★ Claude's mapping waits too,
  for an explicit press (the Claude route, below). ★★★ A WIDE reading asks for the PERIOD when its data rows hold a
  period column of their own (`wideAmbiguity`, fix 8 round 2): a column outside the header's period
  columns and the person column with ANY period-shaped data cell (`rowPeriodColumns`; fix 9 I-1 — an
  80 % share let one `offen` in the `Monat` column turn the question off), or, beside year-less period
  headers, a year column (`rowYearColumns`, fix 9 OOS-b: `Name | Jahr | Jan | Feb` read Ann's 2027 row
  as 2026), offered with those columns as the candidates. The cost: one date in a notes column asks,
  and in a WORKBOOK every integer that reads as a serial date (5-digit numbers such as a `PersNr`, a
  postal code or a cost centre) is period-shaped, so such a column outside the months asks too. A metadata row (`Erstellt | 01.01. | 15.01. | 20.01.`) over a long sheet's `Name |
  Monat | Stunden | Ist` is read as a clear wide header once enough person rows sit under it, and Ist-only
  cells were once accepted in the metadata row's month (Bob's February as January = 35); so `Name |
  Start | Jan 2026 | Feb 2026` asks too. ★★ Either layout asks for the HEADER ROW when more than one row of the scan
  range reads as a header for it (`headerAmbiguity`, `{ field: "header", candidates: [rows] }`, fix 9
  OOS-c): stacked long blocks (`Name | Monat | Forecast` over `Name | Monat | Ist`, which imported the Ist
  block) and stacked wide year blocks (residue 9). ★★★ A REPEATED HEADER (`repeatedHeaderRows`, round 5)
  is a row that holds no number in the hours or period columns and repeats the header's person label, or
  reads as a header of the mapping's shape under any label (round 6, `readsAsHeader`): a person header
  word in the person column (`PERSON_HEADER_RE`), two or more period labels in a wide reading's period
  columns, or, long, an hours word in the hours column or a period word in the period column (`header-words.ts`;
  a header word holds no digit, so `2 Wochen Urlaub` or `Elternzeit (3 Monate)` is no header, and nor are
  `Urlaub`, `-` or `n/a`). The rows right beside the header row are a two-row header (`Name | Std | Std`
  under the months), never a repeated one. Detection adds every one, above or below, to the header question whatever the
  block sizes (a one-row block too), and the hand reading STOPS before the first one below the header row
  (`readingEnd`; the preview counts the rows below it, `rowsBelowRepeatedHeader`), so header row 1 reads
  the Forecast block only and the later header the Ist block only; a second block under `Mitarbeiter` (below
  `Name`) ends the reading too. Only a second header of unrelated words matches none of this (residue 28). The
  preselected row is unchanged, except that a candidate with no data row before the next candidate (an
  empty first block) is skipped (`skipEmptyBlocks`, round 7 C1), and the notice names the candidate rows
  (1-based). ★★ Either layout asks about the ROWS (`differingRows` in `row-differences.ts`, `{ field:
  "rows", candidates: [columns], samples }`, round 9 I-W) when two or more data rows of one person (on a
  long sheet, of one period) differ in a TEXT column the mapping does not read: `Name | Art | Jan 2026`
  with a Plan and an Ist row once imported 50 + 43 = 93 on both routes, unasked. The notice names the
  columns and the first such person's values; only "These columns are right" accepts the sum (no select
  confirms it, `confirmsField`), and the confirmation is bound to the header row, person and period
  column(s). Rows that differ in no such column stay "Combined rows"; the cost is a task description per
  row (residue 32). In the Wide layout, which has no hours or period select, ONE notice names the candidate
  columns by letter and header and asks to check the mapping and confirm (rr8 m2, round 7); a header notice and a
  rows notice are shown beside it. Detection
  scores each candidate header over its first `DETECTION_SAMPLE_ROWS` (200) data rows, blank rows skipped
  and not counted, so a large sheet does not freeze the dialog (M1); `gridToForecastRows` then reads every
  row. Both routes read the sheet with this one reader; they differ only in who sets the mapping.
- ★★★ **Excel's merged cells, a second sheet and `N/YYYY` weeks ask too (final review 3, 2026-10-13).**
  Excel keeps a merged cell's text in its top-left cell only, and both shapes once went straight to the
  preview. A WIDE reading asks for the period when a column holding a number has a BLANK header among
  its period columns or in the blank-headed columns right after them (`blankHeadedNumberColumns`, I1: a
  month header merged over `Ist | Plan`, `Actual | Forecast` or `€ | Std` read the left sub-column as
  the month), and when the header's `N/YYYY` run goes past 12 (`pastTwelveNumberColumns`, M4: `01/2026
  … 14/2026` numbers weeks and read 01–12 as months). Either layout asks about a row with NO person but a
  number in a read column below a person row (`continuationRows` in `row-differences.ts`, `{ field:
  "continuation", candidates: [rows], samples }`, I2: `Ann Lee | Ist` over `(blank) | Plan` read Ann's Ist
  row and dropped the Plan row). ★★ The person is NEVER carried down: an unlabelled total row at the
  bottom would then be summed into the last person; it asks instead. A row with no person holding a total
  label in any cell, a row whose person cell is a total label, and a spacer with no number do not ask;
  confirmed, such rows are not read, as before. ★★ Only the PERSON cell makes a person row, as in the reader
  and `differingRows` (final review 4, I1): an any-cell total check skipped `Ann Lee | Gesamt`, so the Ist and
  Plan rows below it asked nothing and her Gesamt was written. Detection's row sample (`isTotalRow` in
  `layout-detect.ts`, which runs before the person column is known) drops a row only when its FIRST non-blank
  cell is a total label, so a sheet of `Gesamt / Ist / Plan` groups keeps `Name` as the person column. All three
  sit in `wideAmbiguity` / `withMappingQuestions`, so `questionsFor` asks them of a Claude mapping too, and
  only "These columns are right" confirms the continuation (`confirmsField`). A workbook with two or more
  sheets that detect a layout asks which one (`{ field: "sheet", candidates: [sheets] }`, M1, owner
  decision 2026-10-13): the hook's own question (`sheetCandidates` / `sheetConfirmed`, never a mapping's),
  prepended to `ambiguous`, so the same gate holds Apply on either route; choosing a sheet or the press
  confirms it, and Detect columns and Ask Claude ask it again. The press moves the focus to Show preview,
  since it unmounts its own notice (M5). ★ The I1 and M4 reasons travel on the period question
  (`blankHeaded`, `pastTwelve`, and `alsoUnsure` when another reason asks too), so each has a notice of its
  own saying what the press reads, and the generic Wide notice ("Check the mapping, then confirm", with no
  period control to check) shows only for the other reasons (rr14 N1). ★★ The LONG twin (final review 4,
  I2): a blank-headed column holding a number is an hours candidate (`numericColumns`, `any` only), so
  `Name | Monat | Stunden | (blank)` over `Ist | Plan` or `€ | Std` asks for the hours on either route; it
  never scores a header row (`strong`) and a labelled column is preselected before it (`preselectHours`).
  Residue (36)–(39).
- ★★ **Which period a cell is: ONE module, `period-assign.ts`**, read by the reader and detection alike, so
  the two cannot disagree. A single cell is `parsePeriodLabel` (a date is
  its month). A WIDE header row is read as a RUN (`assignRunPeriods` / `assignRunDetailed`): a cell that
  names its year sets a running year; a year-less month or week takes it (starting at the default year)
  and moves it on at the turn of a year — a step BACK of at least half a year (6 months, 26 weeks),
  months and weeks compared by their place in the year — so `Dez | Jan`, a fiscal `Jul … Jun` and
  `KW52 | KW01` roll into the next year (week 53 checked in the year it lands in) while a backwards
  `Dez | Nov | Okt` stays in one year (rolling at every backward step once spread it over four years);
  year-less cells BEFORE the first labelled one count back from it, always back in time — left of the
  first label is earlier (`Nov | Dez | Jan 2027` is Nov and Dez 2026, `Mai | Jan 2027` is May 2026,
  `KW52 | Jan 2027` is 2026-W52; the half-year rule once kept `Mai` in 2027 and is for reading forwards
  only) — so only a run with no label at all uses the default year; a header's ONE date or serial cell
  (`31.12.2025`, a project number `40100`) is no period and anchors nothing, and beside month or week
  labels no date or serial anchors their year however many there are (`40100 | 40200 | Jan` once read
  Jan as 2010): dates anchor only an all-date run; and a run of dates a whole number of weeks apart, the closest
  exactly seven days, is read as ISO weeks. Before this, Monday-date headers collapsed into months and a
  two-year `Jan … Dez Jan … Dez` summed 2027 into 2026 (final review). A LONG sheet's rows are never read
  as a run (they repeat Jan…Dec per person), but its period column gets the same week rule over its
  DISTINCT dates, sorted (`isWeekSpacedColumn`), so a long sheet of Monday dates is weekly while
  first-of-month dates stay months. A
  year-less period cell there takes the row's `ColumnMapping.yearCol` year (a column headed `Jahr` /
  `Year` / `FY` …, or holding only four-digit years), else the default year. That default is ONE value in the hook: it starts at the bucket's start year and
  follows the mapping step's field, and a cleared field means none on both routes (a Claude mapping that
  names no year takes it). ★★ `detectLayout` runs
  its passes in a FIXED order and takes the first that finds a layout: wide (3+ periods) without the
  default year, wide with it, long without it, two-period wide without it, then long and two-period wide
  with it. Both neighbouring orders shipped a bug: long WITH the year early let a `Start` column of month
  names become the period column of a correct wide sheet (fix wave 1), and every year-less pass first
  read a year-less wide sheet with any date column (`Start`, `Eintritt`) as long, its hours in the
  date's month (fix wave 2). ★★ Long without the year stays AHEAD of two-period wide: in a WORKBOOK a
  long sheet's data row of two serial dates (`Von | Bis`, or a month column stored as dates beside
  another date column) reads as a two-period header, and `wideFromHeader` counts the serials below it as
  numbers, so moving both two-period passes first in round 4 read such sheets wide, their dates as
  hours (re-review 4). `Name | Start | Jan | Feb` (two year-less months beside a date column), which that
  order once read long, reaches two-period wide because a long reading never takes a period-headed hours
  column. When a period took its year from the default,
  `assumedYear` makes the preview say so, with a link to the year field.
- **The CLAUDE route proposes the MAPPING, never a value (owner decision 2026-10-13).** "Ask Claude"
  sends the sheet to ONE forced call (`runForecastImportCall`, tool `propose_forecast_mapping`, prompt text
  from `sheetToPromptText` over the shared `renderSheetMarkdown`: column letters and 1-based row numbers).
  The tool returns the layout, the header row (as its row number), the person column and optional email
  and rate columns as LETTERS; wide `periodCols`, long `period` and `hours` with an optional `yearCol`; an
  optional `year` for year-less labels; and `notes`. The system prompt says to name where the fields are,
  never values, to choose the planned or forecast hours and never actuals (Ist, booked, gebucht), and to
  map the forecast block of a sheet with several and say so. `claudeMappingOf` (`claude-mapping.ts`) turns
  the input into a 0-based `ColumnMapping` or refuses it, never repairing or guessing: a letter that is
  not one or lies past the sheet's width, a header row outside the sheet, two fields (or two period
  columns) on one column, a missing field the layout needs, an empty `periodCols`, a field of the other
  layout, a year that is no whole year in `parseYearCell`'s range, or any other type. A refusal is
  `Error("bad-mapping")` and its own message ("Set the columns by hand"); every error keeps the hand
  route. ★★★ The mapping then goes through the HAND READER: it opens the mapping step as the draft, with
  Claude's notes in a notice, and the rows are `gridToForecastRows` with it, so every question,
  confirmation and refusal above applies. ★★★ **Apply waits for an explicit "These columns are right"**
  (`confirmColumns`) on any layout, with or without a question: `claudeUnconfirmed` holds Apply (the
  button disabled with its own reason, and `apply()` refusing `forecastImportConfirmClaudeFirst`) until the
  press, and an edit of a field is no press. The press records the mapping it confirmed
  (`claudeConfirmed`, compared by VALUE with `isSameMapping`, the year and period columns included), so
  an edit after it asks for it again, and one press confirms every open question of that mapping. ★★ The
  questions are asked of the mapping IN EFFECT, Claude's or the user's edit of it, through `questionsFor`
  (`layout-detect.ts`): a long mapping's hours and period candidates, the mapped column always among them
  (`longQuestions`); a wide mapping's row period or row year column (`wideAmbiguity`); the header row
  when another row of the scan range reads as a header of the layout or repeats it; and one person's
  differing rows. ★★ Two questions only a mapping that is not detection's can raise (final review 2):
  a long mapping that leaves out the sheet's year column while its period cells name no year asks for
  the period, the year column among the candidates (`withLeftOutYear`, I1: `Name | Jahr | Monat |
  Stunden` without `Jahr` summed Ann's 2027 into 2026); a wide mapping that leaves out period-headed
  columns holding numbers asks for the period, those columns among the candidates
  (`leftOutPeriodColumns`, M1: Claude's choice of the Ist block of a `Plan | Ist` sheet, the month
  headers repeated over a sub-header row). The mapping step and every question notice name columns
  by letter and header (`D: Jan 2026`), and such a column is listed as left out by the mapping (`IgnoredColumn.isPeriodHeader`), never
  as "its header is not a period". An edit of the person, email or rate column keeps a wide mapping's
  period columns; a layout, header-row or year change rebuilds them from the header (M2). The converter
  reads an empty optional field (`""`, `[]`) as absent and still refuses an empty required one (M3). Detection's own mapping asks the same through it (pinned against `detectLayout`).
  Claude naming `Ist` on `Name | Monat | Stunden | Ist` is therefore shown, named in the hours question,
  and written only after the press. Detect columns leaves the mapping for detection's own. An edit keeps
  the route (`setMapping` no longer resets it), and the mapping step previews Claude's mapping as it stands,
  where a draft rebuild would take every period header of a wide sheet. ★★ The cell-claim checker that
  came before (Claude returning rows, each citing its cell, checked against every period source of the
  cell) was REMOVED after nine fail-closed rounds each moved the hole: do NOT reintroduce it. The accepted
  cost: a sheet no mapping describes — several tables on one sheet, an unrecognised second header — cannot
  be imported by either route; split the sheet first.
- **`validateForecastRows` is the one gate.** Every row it sees was read from a cell of the sheet by
  `gridToForecastRows`, on either route. Hours 0..744 rounded to two decimals, a canonical period, a
  non-blank person; same person and period from DIFFERENT sheet rows are summed (a summed row carries no
  `source`; `duplicates` lists the contributors, shown as "Combined rows"). ★★ Rows whose sources share
  ONE sheet row are never summed: they are `collisions`, left out of `ok`, and the plan's
  `same-row-period` blocker holds Apply until the mapping or the sheet is fixed — UNLESS every one sits
  under a DISTINCT date header and the row holds no period cell of its own (`headerDateOf` in
  `source-cells.ts`): date columns finer than the period (bi-weekly, semi-monthly) are sub-period columns,
  summed and listed as `subPeriods` under "Combined rows" (blocking them made such sheets unimportable).
  Identical or equivalent labels (`Jan 2026 | Jan 2026`, `2026-01 | Jan 2026`, one date twice) still
  block. The date header is the NEAREST period header above the cell in its column
  (`nearestPeriodRowAbove`), and text in the grid never bounds that search: a placeholder (`-`,
  `Urlaub`) above a sprint column once turned its sub-periods back into the same-row blocker (round 3). A
  row with its own period cell is a long row, so its cells collide: a metadata row (`Erstellt | 01.01. |
  15.01. | 20.01.`) detected as a wide header over `Stunden | Ist` once summed the two to 75, and sprint
  dates beside a `Start` date collide instead of summing.
- **`buildForecastImportPlan` diffs against ONE bucket.** Periods are split to the plan's granularity by
  working days (`splitToGranularity`, total kept to the cent). ★★ The in-range set is
  `bucketActivePeriods(bucket, plan)` — the definition the card, the report, the burndown and the forecast
  read. A first cut used `generatePeriods(bucket.startDate, bucket.endDate, granularity)`, which also kept a
  period starting before the bucket or running past the plan: cells no screen shows, written silently
  (caught in review; pinned by the "range" tests). A target cell that a sheet period covers only partly
  is still written but flagged `partial` for the preview; only uncovered WORKING days count (weekends and
  `holidaySet` days are skipped in `hasUncoveredWorkday`). A changed cell on a line shared with people
  the sheet does not list FOR THAT PERIOD carries their names (`othersOnLine`, per period since final
  review 3 M2: a member listed for January but blank for April lost their April share unnamed): the value
  replaces their share too. Matching is by email, then name (also "Last, First"); an archived resource
  (`active === false`) is never matched or offered. Overrides settle only rows whose automatic match
  failed. ★★ ROUTING (`routeOf`, final review 3 M3, owner decision 2026-10-13): a matched person goes to
  the ONE line of the bucket's planning mode that already lists them, whatever its role, and a sheet rate is
  checked against that line's role; on several such lines they are unresolved (`several-lines`, a reason of
  its own; the picker may name another resource, or Skip); on none, to their role's line (blended: its
  discipline), as the spec first said. Such a person's resource is recorded (`unmatchedIds`), and a changed
  cell of a line they sit on names them apart (`unmatchedOnLine`, "in the sheet, not matched"), never under
  `othersOnLine` (rr14 M3a); so does every candidate of an `ambiguous` or `no-role` person (final review 4,
  M2). The picker row shows the reason of the plan computed WITH the overrides once a resource is picked, so a
  pick that lands on a resource on several lines says so (`forecastImportPickSeveralLines`, final review 4
  M1); `unresolvedPeople` itself is still computed without them. Routing by role alone once created a Dev line beside Ann's Senior
  line and counted her January twice. Residue (40). Blockers: `follows-plan`
  (budget follows plan is on), `closed`, `same-row-period` (a validator collision), `nothing-to-apply`.
- **`applyForecastImport` is the only writer**, and it writes only budget hours and allocation
  membership (a missing allocation is created with empty actuals) — never rates, the plan, other
  buckets, stored actual hours or resources. It does not read
  `blockers`; the caller must not call it while any exist. ★★ `apply()` RE-PLANS FROM LIVE STATE: it looks
  the bucket up by id in the current `buckets`, refuses if it is gone, closed or follows the plan, rebuilds
  the plan and refuses on any blocker, then commits through ONE `onChangeBuckets` call — `commitBuckets`,
  so one undo entry and one `budget.updated` log. Applying the plan the preview opened with would keep live
  actuals and stored cells, so only a change to the periods the bucket owns tells the two apart (the
  "a cell the live bucket no longer owns" test).
- **Size bounds.** The Claude route refuses before any request over `MAX_CLAUDE_IMPORT_CELLS` non-blank
  cells or `MAX_CLAUDE_IMPORT_CHARS` of prompt text — both bound the INPUT, its context and its cost. The
  OUTPUT is a mapping, so the reply's budget (`MAX_TOKENS` in `forecast-import-call.ts`) is small. A turn
  that ends on `max_tokens` may carry a cut-off `tool_use` input, so `runForecastImportCall` reads the
  stop reason (`runForcedToolCallWithStop`) and refuses such a reply as `Error("too-large")`, never
  using part of it. The xlsx reader is bounded per sheet (cells and rows,
  `MAX_XLSX_SHEET_CELLS`), per workbook (`MAX_XLSX_TOTAL_ROWS`, `MAX_XLSX_TOTAL_CELLS`), and reads each
  worksheet path once (`sheetEntries` de-duplicates). Gap rows from a `<row r>` jump share one empty row.
  A CSV is bounded the same way: `readDelimited` stops before the row that would pass
  `MAX_XLSX_SHEET_CELLS` and the grid is `truncated`, which the modal's existing notice shows.
  ★★ These bounds protect the CHAT attachment path too — it is the same reader. The many-sheet wide-cell
  blow-up they close predates §500; the row-gap one came with it (honouring `<row r>` so a row number
  in the prompt matches Excel).

## Open register entries

§551 (the dead snapshot `currency` column). This list was read off the register on 2026-09-27 and is
not gated (§500 removed on its closure, 2026-10-12; §473, closed 2026-10-02, and §476, closed
2026-10-14, removed on 2026-10-14). Re-check
it against the headings, since a `budget` search also returns entries about other budgets.
