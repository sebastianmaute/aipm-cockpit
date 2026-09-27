# Budget — the EUR boundary, earned value, and the Budget panel's cell layer

Owns the budget engine's money: the FX boundary (`fx.ts`) and the rule that every figure the engine
produces is EUR, how the plan's and a bucket's currency are sanitised on load, the budget-follows-plan
mirroring rule the panel and the engine share, bucket earned value (Phase C EVM), and the Budget
panel's module map and column arithmetic.

Does NOT own the dashboard's budget tiles and FX rollup caption
([`dashboard.md`](dashboard.md)), the `budgetHistory` meta-blob slice
([`activity-log.md`](activity-log.md) "Sibling slice: `budgetHistory`"), the role rate card
([`platform.md`](platform.md) "Rate card = DAY rates"), the six-write-paths rule (`AGENTS.md`), or
the shared table header `SortResizeTh` ([`ui-shell.md`](ui-shell.md)). One fact, one doc.

★★★ **EVERY FIGURE THE BUDGET ENGINE PRODUCES IS EUR, AND EXACTLY ONE STORED FIELD IS NOT.** Role
rates are EUR by construction and are converted nowhere. `BudgetBucket.fixedPriceAmount` is stored
in the BUCKET's currency and is the one figure that passes through `currencyToEur`. A new money term
is EUR unless it reads that field; converting anything else is a second conversion.

## The FX boundary (`fx.ts`)

- **The rate means units of the bucket's currency per 1 EUR.** `currencyToEur` divides by it,
  `eurToCurrency` multiplies. Both read `resolveRate`, and `resolveRate` and `resolveRateSource`
  read ONE private precedence walk so the two cannot disagree: EUR bucket → 1; a positive
  `fxRateOverride`; a positive cached ECB rate; else 1, reported as source `"unresolved"`.
- ★★ **THE EUR CASE IS DECIDED BEFORE THE OVERRIDE, AT READ TIME.** It used to be decided after, so
  a stale override left on an EUR bucket divided the contract (an 80,000 EUR contract with a stale
  1.1 printed 72,727). Fixed in 1.0.2 by `020ab762b`. The bucket modal now drops the override on
  save when the currency is EUR (§475, closed), but buckets nobody re-saves still carry theirs.
  Only the read-time rule repairs those, so do not "simplify" it away on the grounds that the modal
  already clears the field.
- ★★ **`"unresolved"` AND `"eur"` BOTH RETURN 1, AND SO CAN A REAL RATE.** Never infer "unresolved"
  from `resolveRate(...) === 1`. Ask `resolveRateSource`. `bucketCurrencyLabel`
  (`budget-currency-label.ts`) is shared by the Budget panel and the Budget report so both
  surfaces decide the `(×rate)` / no-rate marker from the SOURCE (§474, closed).
- ★ **Only a FIXED-PRICE bucket can be summed at par.** A T&M bucket's money is hours × EUR role
  rates and is never converted, so a missing rate changes none of its figures.
  `countUnresolvedBuckets` counts fixed-price buckets only, and `BudgetFxRollupNotice` renders that
  count under the EUR project rollup. The report's detail table (`detailRowRateSource` and the
  `currencyLabel` in `BucketDetailTable`) renders a T&M row bare for the same reason. The Budget
  panel's bucket CARD keeps the marker for T&M too, because the card displays through
  `eurToCurrency` at that same rate.
- **The conversion sites.** Every `currencyToEur` call converts `fixedPriceAmount`:
  `computeBucketReport`, `computeBurndownSeries` and the forecast (`budget-forecast.ts`).
  Re-derive rather than trust this list:
  `git grep -n "currencyToEur(" -- src/app ':!*.test.*'`.
- ★★ **`fxRates` IS A REQUIRED LAST PARAMETER** on `computeBucketReport`, `computeSpillover` and
  `computeBudgetReport` (`0221e4bab`), so `tsc` lists every call site. Do not give it a default. An
  all-EUR caller passes `null`, which is behaviour-preserving because `resolveRate` returns 1 there.
  The budget-variance detector in `insights/detect.ts` passes an explicit `null` because it
  reads hours only. Its comment says to thread a rate first if it ever reads a money term.
- **Display.** The Budget panel's project row and the Budget report format in EUR (`projCur` and
  the report's `money` helper are the literal `"EUR"`). A bucket card converts the engine's EUR
  outward with `eurToCurrency` for display in the bucket's own currency. Trends labels
  `remainingCost` as EUR at the reader, because snapshots no longer carry a currency (§469, closed).
  The dead `currency` column still sits in existing Turso `snapshot` tables. Dropping it is §551.

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
- ★ `displayHours` (`budget-panel-totals.tsx`) rounds READ-ONLY (mirrored) hours to 2 decimals for
  DISPLAY only. The stored and aggregated values keep their float noise. Editable cells are not
  rounded, because rounding while the user types fights the input.

## Currency on the plan, and the load paths

- `ResourcePlan.currency` is narrowed to `BudgetCurrency` (`SUPPORTED_CURRENCIES`: EUR, USD and GBP
  today; `grep -n "SUPPORTED_CURRENCIES = " src/app/types.ts`). INR is requested in §477.
- ★★ **THE INDEXEDDB LOAD PATH IS THE ONE PATH THAT DOES NOT RUN `sanitizePlan`**, and it coerces
  the CURRENCY ONLY (`isBudgetCurrency`, else `"EUR"`, in `browser-backend.ts`). Do not "complete
  the pattern" by calling `sanitizePlan` there. It would also clamp `granularity`, replace the date
  window on an unparseable date, swap reversed dates, and drop an explicit
  `budgetFollowsPlan: false`. The comment beside the coercion records which of the four the suite
  pins (two). That gap is open as §470.
- ★★★ **A NON-EUR PLAN IS UNSUPPORTED, AND ONE CASE GOT WORSE IN 1.0.2.** Nothing decides what
  currency a role rate is in. When the plan and a fixed-price bucket share one non-EUR currency, the
  contract and the rates are already in one unit, so the engine's conversion is unwarranted and the
  margin is wrong. The Resources surfaces still label money with `plan.currency`
  (`resources-report.tsx`, `resources-panel-rows.tsx`). Open as §473. A configurable baseline currency is §476.

## Budget follows plan

- `effectiveBudgetHours` (`budget-report.ts`) is the rule: when `plan.budgetFollowsPlan` is on AND
  the allocation has resources, a period's budget hours are the live planned capacity, otherwise the
  stored `budgetHours` entry. The panel's `cellBudget`, the report, the burn-down and the rate-mix
  signal all call it. Re-derive the callers with
  `git grep -n "effectiveBudgetHours(" -- src/app ':!*.test.*'`.
- ★ Mirrored cells are read-only in the panel, and their values carry float noise. That is why
  `displayHours` rounds them for display.

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
  `costPerformanceIndexHealth` (`budget-health.ts`) bands the 0-1 ratio at the same thresholds as
  the percent-flavoured `costPerformanceHealth`, divided by 100 (`COST_PERF_RED`/`COST_PERF_AMBER`),
  so the two scales never collide.
- ★★ **THE PROJECT ROLLUP IS ALL-OR-NOTHING.** `projectEarnedValue` and
  `projectCostPerformanceIndex` are `null` unless every bucket with a budgeted cost above zero has a
  known `earnedValue`. A bucket with no budgeted cost is exempt. One unscored bucket blanks the
  rollup rather than summing a partial figure, which is the same stance as `costIsKnowable`.
- **The tile.** The Budget panel's "Internal cost index" tile (`budgetCciInternalCostIndex`, the
  third of four `Cci` tiles in each row; `grep -n "<Cci label" src/app/budget-panel.tsx`) renders
  "—" whenever `costPerformanceIndex` is `null`.
- ★★ **THAT KEY HAS BEEN RENAMED THREE TIMES.** The name budgetCciCpi was first freed when the old
  BAC/AC tile became "Cost burn"/`budgetCciBurn`, then claimed by this EV/AC tile, which left two
  different quantities labelled CPI a click apart: this MONEY ratio and the EVM HOURS ratio
  `evmCpi`. The second rename (§464) made this tile "Cost recovery"/budgetCciRecovery. The third,
  in the forecast-figures MR
  (`docs/superpowers/specs/2026-09-14-budget-forecast-union-design.md` §11 "Three indices, one
  word"), introduced a price-based CPI/SPI pair on the forecast cards, so a bare "CPI"/"SPI" now
  means THAT index. This tile became "Internal cost index", and the hours ratio (keys `evmCpi` and
  `evmSpi`, unchanged) is rendered "Effort CPI"/"Effort SPI". ★ The dead spellings budgetCciCpi,
  budgetCciCpiHint, budgetCciRecovery and budgetCciRecoveryHint are deliberately un-backticked here:
  all four were renamed out of the codebase, and `docs:symbols:check` fails on a backticked
  mixed-case name that exists nowhere.
- The bucket editor's task-link field reuses the shared `TaskLinkPicker`, so do not hand-roll one.
  Clearing the manual % writes `undefined`, not `0`, mirroring the rate-override clear.

## Budget panel module map (gantt pattern)

`budget-panel.tsx` is the orchestrator (state, derivation, the bucket cards, the CCI tiles). The
bucket table's CELL layer is the presentational leaf `budget-panel-totals.tsx`: `HoursCell`/`HoursTd`
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
  label is `sr-only`. A `w-full` table spreads LEFTOVER width across every column, pinned ones
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

## Open register entries

§470 (the IndexedDB plan path sanitises only the currency) · §473 (a non-EUR plan) · §476 (the
baseline currency is hardcoded EUR) · §477 (only three currencies; INR wanted) · §545 (the AI
dashboard snapshot and the exports carry no budget forecast figures) · §551 (the dead snapshot
`currency` column). This list was read off the register on 2026-09-27 and is not gated. Re-check
it against the headings, since a `budget` search also returns entries about other budgets.
