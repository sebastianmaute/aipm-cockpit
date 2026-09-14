# Budget forecast union — design

**Date:** 2026-09-14
**Status:** approved in brainstorming, awaiting written-spec review
**Register:** §499 (GitLab #38), §501 (#40), §504 (#44), §169 (#169)
**Follow-up to file:** AI summary and exports carry none of the forecast figures (new register entry + work item, see §9)

## 1. Problem

The demo stakeholders asked for explicit executive budget figures (budget, actuals, forecast to complete,
estimate at completion, variance at completion), for consistent Earned Value Management (EVM) wording including
charts, and for the forecast to follow the internal AIPM Project Burndown standard.

Today:

- `computeBudgetReport` surfaces budget, actuals and variance, but nothing computes ETC, EAC or VAC (§499).
- Three different "CPI" numbers exist under inconsistent names: the task-effort CPI from `computeEvm`, the
  bucket internal-cost EV ÷ cost labelled "Cost recovery", and none on contract price (§501).
- The burn-down draws no forecast line (§504).
- TimeLog actuals lose their booking dates: `aggregateActuals` folds each booking into a week or month period key
  at fetch time, and `actualHours` maps only accept period keys. A burn rate over "the last 4 weeks" is therefore
  impossible on a monthly plan, and a granularity change between fetch and Apply files hours under keys the
  report never reads (§169).

### Reference: the AIPM Project Burndown standard

Read from the Confluence article "The Project Burndown Dashboard" and the repository
`example-group/public-collab/project-burndown-dashboard` (`backend/kpis.py`, `backend/routes/scenarios.py`,
`frontend/js/forecast.js`, `docs/features.md`):

- Budget is the contract value in EUR; actuals are booked TimeLog amounts.
- Burn rate = spend over the last 4 weeks (`BURN_RATE_LOOKBACK_WEEKS = 4`) ÷ working days.
- "Forecast (Simple)" line: today's remaining budget minus the burn rate per day until it reaches zero.
- Summary: depletion date, days until depletion, € per day, and "Budget runs out N weeks before project end" /
  "lasts N weeks beyond" / "well aligned" (±7 days).
- Scenario forecasts (phases × roles × rate × FTE) exist there; they are §502 and out of scope here.
- No EV, CPI, EAC, ETC or Monte Carlo.

The register's §504 status claims the article URL was supplied truncated. That is false; the URL opens and the
short link `https://wiki.example.com/wiki/x/LgBwfAE` resolves to it. §504 is corrected in this slice.

## 2. Decision summary

Chosen design: **union**. One set of facts, two named forecasts shown side by side, one chart carrying both
forecasts, and a switch that changes only the chart orientation. Two mockups were compared first (pace-only vs
EVM-on-price, then switch-between-methods vs union); the union won because every viewer sees the same figures,
the disagreement between the two forecasts is visible and meaningful, and both the AIPM burn-down look and the
EVM S-curve are available.

| Decision | Ruling |
|---|---|
| Money basis | Contract price (`budgetValue`, `consumedValue`), matching the AIPM standard |
| Forecast shown as the headline and used for the budget RAG | Current pace |
| Gap line turns into a warning at | EAC difference ≥ 10% of BAC |
| Index names | **CPI** = price basis (new); **Internal cost index** = today's "Cost recovery"; **Effort CPI** / **Effort SPI** = today's task-effort indices |
| Default chart orientation | Burn-down, remembered per device |
| Budget view (planning tab) | Terminology renames plus one forecast link line; no forecast cards |
| TimeLog booking dates | Kept, as day keys in the existing `actualHours` map |
| AI summary and exports | Out of scope; new register entry and work item |

## 3. Scope and delivery

In scope: §499, §501 (terminology and S-curve), §504 (forecast line), §169 (closes as a side effect of dated
actuals). Next slice: §500 (spreadsheet import). Deferred: §502 (Monte Carlo and scenarios), §503 and §488 (need
reproductions).

Three MRs, each shippable on its own:

1. **MR 1 — dated actuals.** Storage key rule, TimeLog Apply, one reader helper, read-only TimeLog cells. No new
   visible figures; §169 closes.
2. **MR 2 — figures.** Forecast engine, Budget report facts and forecast cards, gap line, tooltips, renames, Budget
   view link line, dashboard tile headline and RAG source.
3. **MR 3 — chart.** Both forecast lines on one chart, run-out marker, EV point, Burn-down/Cumulative switch on the
   Budget report and the dashboard tile.

## 4. MR 1 — dated actuals

### 4.1 Key rule

`BucketAllocation.actualHours` and `DisciplineAllocation.actualHours` accept ISO day keys `YYYY-MM-DD` in addition
to month keys `YYYY-MM` and week keys `YYYY-Www`.

- Widen the key rule used by `encodePeriodMap`, `decodePeriodMap` and `coercePeriodMap` in
  `sanitize-entities.ts` (today `PERIOD_KEY_RE`). A key the rule rejects is dropped silently on every backend, so
  this is the load-bearing change.
- `budgetHours` maps keep the period-only rule: planned hours stay per period.
- `HOURS_MAP_MAX` (1000, a per-key value clamp) applies unchanged.
- The bucket rides the existing `budget_buckets` spec (`ENTITY_SPECS`, `BUDGETS_CSV_COLUMNS`), so no column, table
  or meta blob is added. All six write paths carry the new keys once the codec accepts them.

### 4.2 TimeLog Apply

- `aggregateActuals` aggregates per bucket, per resource, per **day** (`it.date`), no longer per period key. The
  granularity argument is removed from the fetch-time aggregation; periods are derived at read time. This removes
  the stale-key path of §169.
- The actuals cache (`aipm-cockpit:timelog-actuals`) stores the day-keyed aggregate. Entries written before this
  change carry period keys; they are treated as stale and the panel asks for a refresh rather than applying them.
- `applyActualsToBuckets` keeps its rule that Apply owns every target line of each **period** it covers: within a
  covered period it replaces that line's day keys and deletes the line's hand-typed period key. The confirm dialog
  (`describeApplyRows`) already itemises rows whose values change; hand-typed values being removed appear there.

### 4.3 Reader helper

New pure helper `actualHoursIn(map, period)` returns the period key's value plus every day key whose date lies in
`[period.start, period.end]`. Every reader switches to it:

- `budget-report.ts` — the `sumPeriodMap(row.actualHours, keys)` call
- `budget-burndown.ts` — both `row.actualHours[p.key]` sites
- `budget-panel-totals.tsx` — the column total reducer
- `budget-panel.tsx` — both `actual={a.actualHours[p.key]}` cells
- `timelog-apply.ts` — the diff's `current` value

Readers that only test for non-zero values (`budget-bucket-modal.tsx` `hasHours`) need no change.

### 4.4 Hand edits

A period cell whose line holds any day key inside that period is **read-only**. Its title and accessible
description read "From TimeLog. Re-apply to change." Cells without day keys stay editable exactly as today.

Ruling — read-only rather than a hand correction on top of TimeLog hours — keeps one owner per period and avoids a
mixed total nobody can explain — cost if wrong: a PM cannot correct one TimeLog week by hand and must fix it in
TimeLog and re-apply.

### 4.5 Existing data and granularity changes

- Stored period-key actuals keep working unchanged; nothing is migrated. The next Apply rewrites covered periods.
- Switching plan granularity regroups day keys automatically. Hand-typed period keys from the old granularity still
  do not match the new periods; that is today's behaviour, recorded here, not fixed.

## 5. MR 2 — forecast engine

New pure, i18n-free module `budget-forecast.ts`. Inputs: the project `ProjectReport`, bucket reports, buckets
(for dated actuals and fixed-price data), the plan, `holidaySet`, `today`. Output:

```ts
type BudgetForecast = {
  facts: { bac: number; ac: number; remaining: number; ev: number | null; percentComplete: number | null };
  pace: PaceForecast | { unavailable: "not-enough-bookings" | "no-burn" };
  efficiency: EfficiencyForecast | { unavailable: "needs-percent-complete" | "no-actual-cost" };
  gap: { eacDifference: number; percentOfBac: number; severity: "info" | "warning";
         extraWorkingDays: number | null } | null;
  hasFixedPrice: boolean;
};
type PaceForecast = { burnRatePerDay: number; windowDays: number; spreadPeriodHoursUsed: boolean;
  etc: number; eac: number; vac: number; runOutDate: string | null; daysBeforePlannedEnd: number | null };
type EfficiencyForecast = { pv: number; cpi: number; spi: number | null; etc: number; eac: number; vac: number };
```

Named constants: `BURN_RATE_WINDOW_WORKING_DAYS = 20`, `FORECAST_GAP_WARNING_RATIO = 0.10`.

### 5.1 Facts

- BAC = project `budgetValue`.
- AC = forecast actual value (see §5.4 for fixed-price).
- Remaining = BAC − AC.
- EV = Σ over buckets of `budgetValue × percentComplete / 100`, using `bucketPercentComplete`; null unless every
  bucket with `budgetValue > 0` has a known percent complete. percentComplete (project) = EV ÷ BAC.

### 5.2 Current pace

- Window: the last `BURN_RATE_WINDOW_WORKING_DAYS` working days strictly before `today`, skipping weekends and
  `holidaySet`.
- Value per day: day-key hours count on their own date. Hand-typed period-key hours are spread evenly over their
  period's working days; if any such spread hours fall in the window, `spreadPeriodHoursUsed = true` and the tooltip
  says so. Hours are valued at the same rate or fixed-price ratio the report uses for that line.
- Burn rate = window value ÷ 20.
- Working days left = working days strictly after `today` up to and including the plan end (weekends and
  `holidaySet` excluded).
- ETC = burn rate × working days left.
- EAC = AC + ETC; VAC = BAC − EAC.
- Run-out date = the n-th working day after `today`, for the smallest n with `Remaining − burn rate × n ≤ 0`; null
  when Remaining ≤ 0 already or burn rate is 0. `daysBeforePlannedEnd` = calendar days from run-out to plan end
  (negative when the run-out falls after it).
- Unavailable: fewer than 20 working days between the first booking and `today` → `not-enough-bookings`; burn rate
  0 → `no-burn`.

### 5.3 Current efficiency

- PV = the planned (budget) value scheduled up to `today`, from the same planned series the burn-down uses.
- CPI = EV ÷ AC; SPI = EV ÷ PV (null when PV = 0).
- ETC = (BAC − EV) ÷ CPI; EAC = AC + ETC; VAC = BAC − EAC.
- Unavailable: EV null → `needs-percent-complete`; AC = 0 → `no-actual-cost`.

### 5.4 Fixed-price buckets

`consumedValue` for a fixed-price bucket is capped at the contract amount, so a price-based overrun would never
show. The forecast uses the **uncapped** value `contract × actualHours ÷ budgetHours` (0 when budgetHours = 0) as
that bucket's actual value. The existing capped tiles are unchanged. When any bucket is fixed-price, both cards
carry the note "Fixed price: the overrun is internal effort; the client price does not change."

Ruling — uncapped for forecasting only — shows an overrun that the capped figure hides — cost if wrong: an EAC
above the contract amount may be read as money the client pays; the note mitigates it.

### 5.5 Gap line

Present only when both forecasts are available.

- `eacDifference = |EAC_efficiency − EAC_pace|`, `percentOfBac = eacDifference ÷ BAC`.
- `severity = "warning"` when `percentOfBac ≥ 0.10`, else `"info"`.
- `extraWorkingDays = ceil(ETC_efficiency ÷ burn rate) − working days left to plan end`, shown only when > 0.

### 5.6 Worked example (acceptance fixture)

Contract €240,000; plan 2026-01-05 to 2026-12-18; today 2026-09-14; €168,000 consumed; €27,000 in the last 20
working days; 62% complete; PV €176,000; no holidays in range.

| Figure | Pace | Efficiency |
|---|---|---|
| Burn rate | €1,350/day | — |
| CPI · SPI | — | 0.89 (0.885714) · 0.85 (0.845455) |
| ETC | €93,150 (69 working days) | €102,968 |
| EAC | €261,150 | €270,968 |
| VAC | −€21,150 (−8.8%) | −€30,968 (−12.9%) |
| Run-out | 2026-11-27 (54th working day after today), 21 days before plan end | — |

Gap: €9,818 = 4.1% of BAC → info; extra working days = ceil(102,968 ÷ 1,350) − 69 = 77 − 69 = 8.

Calendar check: 2026-09-14 is a Monday and 2026-12-18 a Friday; working days after today up to the plan end are
4 (15–18 Sep) + 65 (21 Sep – 18 Dec) = 69. Remaining €72,000 ÷ €1,350 = 53.3, so the remaining budget first reaches
≤ 0 on the 54th working day, 2026-11-27.

The engine test pins these values. The brainstorming mockups quoted "26 Nov", "about 7 days" and "around 29 Dec"
from rounded arithmetic; the values in this table are authoritative.

## 6. UI

### 6.1 Budget report (`budget-report-panel.tsx`)

Order of sections:

1. **Project total** — the facts row (BAC, AC, Remaining, EV) at its top, existing tiles below.
2. **Forecast** (new, `budget-forecast-cards.tsx`) — "At current pace" card and "At current efficiency" card, each
   with a question subtitle, its EAC as the large figure, and a `<dl>` of VAC ("VAC at current pace" /
   "VAC at current efficiency"), ETC, and burn rate + run-out or CPI + SPI + needs. Unavailable states show their
   reason ("Not enough recent bookings", "Needs linked tasks or a % complete"). The gap line sits below both cards;
   its wording names the difference, the percentage and, when positive, the extra working days beyond the planned
   end, with the explanation that the pace forecast assumes the work finishes on time.
3. **Burn-down** — existing chart; MR 3 adds the forecast series and the switch.
4. **By bucket** — unchanged.
5. **Earned value · effort** — today's task-effort section moved to the bottom, labels Effort CPI / Effort SPI.

New components live in their own files (panel-split convention); the panel stays an orchestrator.

### 6.2 Tooltips

Every non-self-explanatory term gets an `InfoTooltip` with a term-bearing accessible name ("What is CPI?"): BAC,
AC, EV, both forecast methods, both EACs, both VACs, both ETCs, CPI, SPI, burn rate, run-out, needs, and the gap
line's extra-days figure. Each text states the meaning, the formula with the project's own numbers, and how to read
it. The approved texts are those of the union mockup, adjusted where §5 changed a value.

### 6.3 Dashboard "Budget burn" tile (`burn`)

- Headline: "EAC €261k–€271k · VAC −9% to −13% · runs out 27 Nov"; pace figure alone when efficiency is
  unavailable; Actuals when pace is unavailable.
- The budget RAG input is the pace VAC.
- The tile's minimum height may rise from 2 to 3 rows; the layout engine clamps saved layouts.
- MR 3 adds the forecast lines and the switch inside the tile.

### 6.4 Budget view (`budget-panel.tsx`)

- One line above the bucket cards: "Forecast: EAC €261k–€271k → Budget report" (link to the view).
- "Cost recovery" is renamed "Internal cost index" on the project and per-bucket cards.

### 6.5 Chart (MR 3, `burndown-chart.tsx`)

- Series: planned, actual, pace forecast (dashed), efficiency forecast (dotted), run-out marker, EV point today.
  Dash patterns and the legend carry meaning, not colour alone.
- Burn-down orientation plots remaining = BAC − cumulative, including values below zero; cumulative orientation
  plots cumulative spend with a BAC line and the two EAC end values.
- `SegmentedControl` "Burn-down / Cumulative" on the Budget report and the dashboard tile.
- New device setting `budgetChartView?: "burndown" | "cumulative"` in `settings-types.ts`, default burn-down, no
  per-project override, persisted through `writeSettings`. Print shows the selected orientation.

### 6.6 i18n and accessibility

- All strings EN and DE in the same commit; DE edited via a Node UTF-8 write with CRLF anchors, real umlauts.
- Renamed keys: the `budgetCciRecovery*` pair; reworded: `evmCpiHint`, `evmSpiHint` for the effort basis.
- Each forecast card has a heading and lists its figures in a `<dl>`.
- The gap line is plain text in its info state. In its warning state it carries `role="status"` and starts with a
  word ("Warning:"), so the state is not conveyed by colour alone. It never uses `role="alert"`, because it is not
  a sudden change the user caused.
- Per-bucket labels stay row-unique. Unit tests cover duplicate accessible names and label-in-name, which axe does
  not report. Budget, Reports and Dashboard are already in `A11Y_VIEWS`.

## 7. Testing

### MR 1

- Round-trip a day key through JSON, CSV, Markdown, Turso single, Turso tenant and IndexedDB; the test fails on any
  backend that drops it.
- Add day keys to one allocation in `sample-workspace-small.json` (monthly plan) and regenerate `__fixtures__/golden-*`
  in a separate commit — a legitimate input change.
- Apply: covered periods receive day keys and lose the hand-typed period key; uncovered periods untouched.
- §169 regression: aggregate, switch granularity month → week, apply, hours still counted by the report.
- `actualHoursIn`: property test — period total equals period key plus that period's day keys, and summing all
  periods equals summing all keys.
- Read-only cell: disabled state and accessible description.
- Before planning: grep the repository for tests and code that assume period-only actual keys and label each hit
  DELETE, MIGRATE or RECOMPUTE.

### MR 2

- `budget-forecast.ts`: the §5.6 fixture exactly; the 20-working-day window across a holiday; spread period hours;
  `not-enough-bookings` and `no-burn`; efficiency unavailable when one budgeted bucket lacks percent complete;
  fixed-price uncapped value; gap severity at 9.99% and 10%; `extraWorkingDays` ≤ 0 hidden. Each rule mutation-checked.
- Components: both cards, every unavailable state, tooltip names unique per term, dashboard headline and RAG from
  pace, Budget view link line, renames on every surface.
- i18n: DE loaded (`loadI18n("de")`), encoding test green.

### MR 3

- Chart series and markers in both orientations; switch state via `SegmentedControl`; setting persisted through
  `writeSettings`; toolbar order checked with `src/test/toolbar-order.ts` wherever the switch sits in a toolbar.

## 8. Documentation

- Register: close §499, §501, §504 and §169 with evidence in the MR that closes each; correct §504's
  "URL supplied truncated" status.
- `docs/AGENTS/integrations.md` (Timelog section): the day-key rule, Apply's period ownership, the read-only cell.
- CHANGELOG entry per release. MR descriptions carry one `Closes #NN` per line; commit messages carry none.

## 9. Follow-up to file

New register entry and GitLab work item, filed with this slice's first docs commit (number reserved on
`origin/main` at merge):

> The AI dashboard snapshot (`ai-dashboard-snapshot.ts`) and every export carry none of the forecast figures, and
> the snapshot's `evm.spi` / `evm.cpi` become the effort indices after the renames without saying so.

## 10. Out of scope

Per-person actuals storage, per-bucket forecast cards, EV history (an EV curve over time), multi-currency beyond the
existing EUR rollup, scenario forecasts and Monte Carlo (§502), spreadsheet import (§500), AI summary and exports
(§9).

## 11. Risks

- **Silent key drop.** Any codec path that keeps the old period-only rule drops TimeLog day hours without error. The
  six-backend round-trip test is the guard.
- **Cache shape change.** Old period-keyed cache entries must never be applied as if day-keyed; they are treated as
  stale.
- **Three indices, one word.** Renames must land on every surface in MR 2 at once, or two different numbers carry
  the same "CPI" label again.
- **Monthly sample.** The sample plan is monthly; the 20-working-day window is exercised by engine fixtures, not by
  the sample.
