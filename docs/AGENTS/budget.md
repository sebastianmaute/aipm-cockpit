# Budget — the EUR boundary, earned value, and the Budget panel's cell layer

Owns the budget engine's money: the FX boundary (`fx.ts`) and the rule that the engine treats every
figure as EUR, how the plan's and a bucket's currency are sanitised on load, the budget-follows-plan
mirroring rule the panel and the engine share, bucket earned value (Phase C EVM), the Budget
panel's module map and column arithmetic, and the forecast import (§500).

Does NOT own the dashboard's budget tiles ([`dashboard.md`](dashboard.md)), the `budgetHistory` meta-blob slice
([`activity-log.md`](activity-log.md) "Sibling slice: `budgetHistory`"), the role rate card
([`platform.md`](platform.md) "Rate card = DAY rates"), the six-write-paths rule (`AGENTS.md`), or
the shared table header `SortResizeTh` ([`ui-shell.md`](ui-shell.md)). One fact, one doc.

★★★ **EVERY BUDGET FIGURE IS EUR, AND THERE ARE EXACTLY TWO CONVERSION POINTS.** Role rates and
per-bucket rate overrides are in the PLAN currency (decided §473, 2026-10-02); `bucketRateRows`
divides them by `planCurrencyPerEur` (`fx.ts`) at the one place every money consumer reads them —
report, burndown, rate mix, forecast. `BudgetBucket.fixedPriceAmount` is stored in the BUCKET's
currency and passes through `currencyToEur`. A new money term built from `bucketRateRows` or from
`fixedPriceAmount` is EUR already; converting it again is a second conversion. A term built from
role rates ANY OTHER WAY is plan currency and must divide by `planCurrencyPerEur` itself — the EVM
tiles' blended rate (`budget-report-panel.tsx`) is the one such site today. The Resources views
format rate-derived money in `plan.currency`, which is now correct rather than a contradiction.

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
- ★ **Only a FIXED-PRICE bucket's OWN rate can put it at par.** A T&M bucket's money is hours × role
  rates, which convert from the PLAN currency, so the bucket's own missing rate changes none of its
  figures. ★ A non-EUR plan with no cached rate converts its rates at par instead, and no notice
  counts that today — an EUR plan (every shipped sample) never reaches it.
  `countUnresolvedBuckets` counts fixed-price buckets only, and `BudgetFxRollupNotice` renders that
  count under the EUR project rollup. The report's detail table (`detailRowRateSource` and the
  `currencyLabel` in `BucketDetailTable`) renders an UNRESOLVED T&M row bare for the same reason; a
  T&M row with a resolved rate still gets `bucketCurrencyLabel`'s `(×rate)` suffix. The Budget
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
- ★★ **A NON-EUR PLAN: RATES ARE IN ITS CURRENCY (§473, closed 2026-10-02).** When the plan and a
  fixed-price bucket share one non-EUR currency, `planCurrencyPerEur` reuses the BUCKET's rate
  resolution (its `fxRateOverride` included), so the contract and the cost divide by the same number
  and the margin is the contract-currency margin, converted — it was wrong from 1.0.2 until then.
  Otherwise the plan currency resolves from the cached ECB rate (it has no override of its own).
  A configurable baseline currency is §476.

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

## Forecast import (§500)

A bucket card's "Import forecast" opens `ForecastImportModal`; all logic is `useForecastImport`, and the
engines live in `src/app/budget-import/` (no i18n, no React).

- **Two routes, one row list.** A file becomes `SheetGrid`s (`readSheetFile`: CSV, or xlsx through
  `extractXlsxGrid`). The HAND route finds the columns (`detectLayout`, editable on the mapping step) and
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
  review I2). Its HOURS column is PRESELECTED as the leftmost one with an hours word (`Hours`, `Stunden`,
  `Aufwand`, `Effort` …), else the LEFTMOST number column; an ID or row-number column (`ID_HEADER`), a year column (`isYearColumn`), a
  column of period-shaped cells (a workbook's serial dates) and a column HEADED by a period (`Jan`, `Jan
  2026`) are never it — `ID | Name | Month | Effort` once imported the IDs (I3), and `Name | Start | Jan
  2026 | Feb 2026` read long with the Start date as the period and January as the hours (I4), where it now
  reads two-period wide. ★★★ **WHERE THAT DOES NOT SETTLE IT, DETECTION ASKS (fix 7, the owner's decision
  of 2026-10-13).** Three rounds of column-guessing rules each imported wrong hours: a rightmost-hours pick
  took `Ist`, `Actual`, `Summe` or `Betrag` over `Plan` (rr6 N1), a rank of month-LABEL cells over full
  dates summed a `Datum` sheet into its `Eintritt` month (rr6 N3), and a header-row stop on the Claude route
  (below) misfired on two-row headers. Both were removed. `detectLayout` reports `ambiguous`
  (`ColumnAmbiguity`, from `ambiguityOf`): the HOURS whenever two or more candidates remain. ★★★ No
  header word settles it (fix 8, the owner's "fail closed" of 2026-10-13): an escape for exactly one
  NAMED hours column, later with a list of actuals words, read `Ist`, then `Iststunden`, `IstStd`,
  `Gebuchte Stunden`, `Spent hours` or `Logged hours` silently, one missed spelling per round (rr6 N1,
  rr7, rr8 N2); both are gone. So `Plan | Stunden`, `Stunden | Ist` and `Name | Monat | Stunden | Kosten`
  ask, and only a sheet with ONE number column (`Name | Monat | Stunden`, `ID | Name | Month | Effort`,
  `Nr | Name | Monat | Aufwand`) is clear; the hours word only preselects. And
  the PERIOD when two or more columns qualify and not exactly one is headed by a period word (`Datum |
  Eintritt`, `Datum | Startmonat` ask; `Start date | Month` does not). The mapping it returns is still the
  default above, but `useForecastImport` then opens on the mapping step with a notice per field naming the
  candidates, and refuses Apply — the button disabled, the reason its accessible description — until each
  field is confirmed: its column chosen within the long layout (an edit of another field does not count,
  and ★★ nor does the layout control — Wide then Long rebuilt the questioned preselection from the
  defaults and once cleared the gate on the way, rr7 I2), the header row chosen in either layout, or
  "These columns are right". ★★ A confirmation belongs to its (layout, field) pair AND the value it
  confirmed (`unconfirmedOf`, fix 9 m-a): a period chosen in Long once also cleared the questioned Wide
  reading, so flipping back to Wide applied it; flipping back now re-arms the open fields, and a
  round-trip that resets a chosen column waits again. Re-detecting asks again. ★★ The Claude route waits too (fix 8): until the columns are confirmed it refuses every claim
  (`columns-unconfirmed`, below). ★★★ A WIDE reading asks for the PERIOD when its data rows hold a
  period column of their own (`wideAmbiguity`, fix 8 round 2): a column outside the header's period
  columns and the person column with ANY period-shaped data cell (`rowPeriodColumns`; fix 9 I-1 — an
  80 % share let one `offen` in the `Monat` column turn the question off), or, beside year-less period
  headers, a year column (`rowYearColumns`, fix 9 OOS-b: `Name | Jahr | Jan | Feb` read Ann's 2027 row
  as 2026), offered with those columns as the candidates. The cost: one date in a notes column asks. A metadata row (`Erstellt | 01.01. | 15.01. | 20.01.`) over a long sheet's `Name |
  Monat | Stunden | Ist` is read as a clear wide header once enough person rows sit under it, and the
  Claude route then accepted Ist-only claims in the metadata row's month (Bob's February as January =
  35), because the hand reading and the header above were the same wrong row; so `Name | Start | Jan
  2026 | Feb 2026` asks too. ★★ Either layout asks for the HEADER ROW when more than one row of the scan
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
  preselected row is unchanged, and the notice names the candidate rows (1-based). In the Wide layout, which has no hours or period select, ONE notice asks to
  check the mapping and confirm (rr8 m2); a header notice is shown beside it. Detection
  scores each candidate header over its first `DETECTION_SAMPLE_ROWS` (200) data rows, blank rows skipped
  and not counted, so a large sheet does not freeze the dialog (M1); `gridToForecastRows` then reads every
  row. The CLAUDE route
  sends the sheet to ONE forced call (`runForecastImportCall`, tool `propose_forecast_rows`, prompt text
  from `sheetToPromptText` over the shared `renderSheetMarkdown`). Both produce the same `ForecastRow` list.
- ★★ **Which period a cell is: ONE module, `period-assign.ts`**, read by the hand route, detection and the
  Claude near-cell check alike, so the three cannot disagree. A single cell is `parsePeriodLabel` (a date is
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
  first-of-month dates stay months; the Claude route's row search reads the column the same way. A
  year-less period cell there takes the row's `ColumnMapping.yearCol` year (a column headed `Jahr` /
  `Year` / `FY` …, or holding only four-digit years), else the default year. That default is ONE value in the hook: it starts at the bucket's start year and
  follows the mapping step's field, and a cleared field means none on both routes. ★★ `detectLayout` runs
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
- **`validateForecastRows` is the one gate for both.** Hours 0..744 rounded to two decimals, a canonical
  period, a non-blank person; same person and period from DIFFERENT sheet rows are summed (a summed row
  carries no `source`; `duplicates` lists the contributors, shown as "Combined rows"). ★★ Rows whose sources
  share ONE sheet row are never summed: they are `collisions`, left out of `ok`, and the plan's
  `same-row-period` blocker holds Apply until the mapping or the sheet is fixed — UNLESS every one sits
  under a DISTINCT date header and the row holds no period cell of its own (`headerDateOf`): date columns finer than the period (bi-weekly,
  semi-monthly) are sub-period columns, summed as before and listed as `subPeriods` under "Combined
  rows" (blocking them made such sheets unimportable). Identical or equivalent labels (`Jan 2026 | Jan
  2026`, `2026-01 | Jan 2026`, one date twice) still block. A source cell backs ONE row
  on either route — a second row citing it is rejected. With `requireSource` (the Claude route only, whose
  rows are UNTRUSTED) a row passes only when its cited cell holds its hours by the sheet's own number rule,
  the cell of that row in the PERSON column names the person, and every period source for the cell agrees (`checkSource`
  in `source-evidence.ts`, below). U is the NEAREST period header above it in its column (`nearestPeriodRowAbove`: a
  row whose run gives that column a period), read as part of that row's run. ★★ The PERSON column is the
  hand reading's where there is one, else the cited row's LEFTMOST non-blank text cell, period-shaped,
  email and number cells skipped (`leftmostTextColumn`, round 5): a person named in ANY cell of the row
  once vouched for the claim, so a `Vertretung` or `Manager` column routed someone else's hours to them,
  and a majority vote over the claims (fix 9) let a reply of one deputy claim win alone. The cost: a
  `Rolle | Name` sheet with no hand reading refuses its people (residue 29). ★★ Text in the grid never
  bounds that search: a placeholder (`-`, `Urlaub`), a unit row (`Std`) or a `Plan | Ist` sub-header
  between the header and the cell is passed over. Round 3 stopped at such a cell, which rejected every valid
  claim beneath it and, through `headerDateOf`, turned sprint-date sub-period columns under a `-` back into
  the same-row blocker. A title row's lone date gives its column no period and is passed over too, so it
  vouches for nothing; so does a run of exactly two dates more than 92 days apart
  (`MAX_TWO_DATE_PERIOD_GAP_DAYS`: `Zeitraum | 01.01.2026 | 31.12.2026` is a range, which round 4 took as a
  long sheet's period header, vouching for December), while two closer dates and three or more stay periods. ★★★ **EVERY PERIOD SOURCE FOR THE CITED CELL MUST AGREE (fix 8, the
  owner's "fail closed" of 2026-10-13).** Eight rounds of evidence rules each let a new wrong-hours case
  through, so no source decides alone and a disagreement is a visible refusal, never a pick
  (`periodNearCell`). The sources: H, the hand route's reading of the cell (`handReadingOf` in
  `hand-reading.ts`: the hand route's own `gridToForecastRows` over the sheet, per cell it READS — ★★★ a
  cited cell on a row it reads but outside those cells, or on a row outside the rows it covers (above the
  header row or from a repeated header on: another stacked block, round 5), is refused `cell-not-read`,
  whatever it holds (fix 8 round 3: a long row's period once covered every cell of the row, so its `Ist`, a
  `Kosten` 40 equal to the Stunden 40, or an ID stood in the row's month)); U, the nearest period header above the cell, read as part of
  its row's run (above); and R, every period cell on the cited row (`rowPeriodCells`, the cited and
  PERSON cells skipped by position; a year-less one takes a year cell on the row before the default year),
  counted ONLY without H — with H, the hand route has already chosen the row's period column. A claim
  stands only when a source exists, all of them name one period and the claim names it. Two that
  disagree refuse it `period-conflict`, right or wrong, and the preview names both by label: "the column
  header says Jan 2027, but the detected or confirmed columns read Jan 2026" (H against U), "the row says … but the
  column header says …" (R against U), "the row names two periods, … and …" (R against R). No source at
  all, or a claim the agreeing sources do not name, is `period-not-near` — with H, `period-conflict`
  naming H's period. ★★ Three rules this replaced each wrote wrong hours: H decided alone (rr7 I1) and
  wrote a stacked 2027 block, two people per block (residue 9), into 2026 (rr8 N1); an exemption for a
  row cell whose column the header row LABELS (`Name | Start | Jan 2026`) let a key/value title row
  (`Erstellt von | Max | 01.03.2026`) vouch for March (rr7 I1, rr8 OOS-1) — removed, do NOT reintroduce it;
  and the row search took ANY row cell naming the claim. Refusing a right claim is the accepted cost: a
  title row's dates over a long sheet's hours column (a quarter `Zeitraum | 01.01.2026 | 31.03.2026`, a
  `von | … | bis | …` pair, three `Erstellt / Stand / Druck` dates) refuse every row whose month they do
  not share, on a clear sheet too, and a `Start` or `Eintritt` date on an unknown sheet's row refuses
  the cells of other months. ★★ WHICH reading is H: with an ambiguous detection the user has not
  confirmed, there is none, and every claim of the sheet is refused `columns-unconfirmed` ("Use Detect
  columns to confirm them, then ask Claude again", one line per refused row); once the user has confirmed
  or edited the mapping, `useForecastImport` passes it (`validateForecastRows`'s `columns`) and H is read
  with THAT mapping and its year, so a user who fixed the columns is not checked against the uncorrected
  detection; a clear detection is H as detected; an unknown one has no H. ★★ "Edited" means a COLUMN field
  differs from the mapping the hand route opened with (`isSameColumns`: layout, header row, person, period,
  hours, year column; fix 9 I-2, round 5): the mapping step's Show preview passes a fresh copy, and a
  reference compare once made an unknown layout's default mapping H on a no-op preview, writing Bob's
  March row as February. The year value alone is no column edit. Readings are cached per grid
  and mapping (or default year). ★★ Two cells of one row in one period are a collision, never a sum,
  unless each sits under a distinct date header (U) AND the row holds no period cell of its own
  (`headerDateOf`, both routes): a row with its own period is a long row. A metadata row (`Erstellt |
  01.01. | 15.01. | 20.01.`) over enough person rows is detected as a clear WIDE header, and a first cut
  of fix 8 that skipped the row check under H summed Stunden + Ist to 75; sprint dates beside a `Start`
  date now collide instead of summing. On a long reading only the hours cell of a row is read, so two
  cited cells of one long row can no longer both stand. ★★ The header-row stop that came before all this (`isHeaderRowFor` — removed, do NOT
  reintroduce it) ended the upward search at a `Name | Monat | Stunden` row; it fired on two-row headers
  (months on row 1, `Name | Std | Std` on row 2) and on placeholder rows, rejecting every right claim and
  letting a date on the row vouch for a wrong month (rr6 N2, N4). Any row above, or a `Start` date on the
  row, once vouched for the wrong period. That is the safety boundary against an
  invented value; the prompt is not. A sheet's per-column style and week shape are computed once
  (`columnFacts`). `findUnreadCells` (`unread-cells.ts`) then lists, as information, the number cells the
  reply did not cite on rows it read, and every row it did not cite at all that holds a number under a
  period header or in a column it cited as hours — a person it skipped entirely is "row 7 (Bob Kay)", read
  from the column the accepted rows name their people in, else the row's first text cell; total
  rows are left out, and a period-shaped cell (a workbook's serial date) is never an unread number. ★★ An email never vouches for the person, and an email the cited row does not hold is
  STRIPPED from the accepted row: the model can write any email beside any name, and matching tries the
  email first, so a model-supplied `bob@…` on Ann's row once routed Ann's hours to Bob (final review).
  A rejected source names its cause (`SourceRejection`), and the preview shows each cause in its own words.
- **`buildForecastImportPlan` diffs against ONE bucket.** Periods are split to the plan's granularity by
  working days (`splitToGranularity`, total kept to the cent). ★★ The in-range set is
  `bucketActivePeriods(bucket, plan)` — the definition the card, the report, the burndown and the forecast
  read. A first cut used `generatePeriods(bucket.startDate, bucket.endDate, granularity)`, which also kept a
  period starting before the bucket or running past the plan: cells no screen shows, written silently
  (caught in review; pinned by the "range" tests). A target cell that a sheet period covers only partly
  is still written but flagged `partial` for the preview; only uncovered WORKING days count (weekends and
  `holidaySet` days are skipped in `hasUncoveredWorkday`). A changed cell on a line shared with people
  the sheet does not list carries their names (`othersOnLine`): the value replaces their share too.
  Matching is by email, then name (also "Last, First"); an archived resource (`active === false`) is never
  matched or offered. Overrides settle only rows whose automatic match failed. Blockers: `follows-plan`
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
  OUTPUT is bounded separately: each returned row costs about 35 output tokens, and the reply's budget
  (`MAX_TOKENS` in `forecast-import-call.ts`) holds a few hundred rows, which a sheet under the cell cap
  can still exceed. A turn that ends on `max_tokens` may carry a cut-off `tool_use` input, so
  `runForecastImportCall` reads the stop reason (`runForcedToolCallWithStop`) and refuses such a reply
  as `Error("too-large")`, never importing part of it. The xlsx reader is bounded per sheet (cells and rows,
  `MAX_XLSX_SHEET_CELLS`), per workbook (`MAX_XLSX_TOTAL_ROWS`, `MAX_XLSX_TOTAL_CELLS`), and reads each
  worksheet path once (`sheetEntries` de-duplicates). Gap rows from a `<row r>` jump share one empty row.
  A CSV is bounded the same way: `readDelimited` stops before the row that would pass
  `MAX_XLSX_SHEET_CELLS` and the grid is `truncated`, which the modal's existing notice shows.
  ★★ These bounds protect the CHAT attachment path too — it is the same reader. The many-sheet wide-cell
  blow-up they close predates §500; the row-gap one came with it (honouring `<row r>` so a cited row
  number matches Excel).

## Open register entries

§473 (a non-EUR plan) · §476 (the
baseline currency is hardcoded EUR) · §551 (the dead snapshot
`currency` column). This list was read off the register on 2026-09-27 and is not gated (§500 removed
on its closure, 2026-10-12). Re-check
it against the headings, since a `budget` search also returns entries about other budgets.
