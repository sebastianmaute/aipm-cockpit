# Forecast chart, hours forecast and rate-mix signal — design (MR 3 addendum)

**Date:** 2026-09-15
**Status:** approved in brainstorming (sections 1–3), awaiting written-spec review
**Parent spec:** `docs/superpowers/specs/2026-09-14-budget-forecast-union-design.md` (§6.5 is superseded in part by this
document; everything else in the parent still holds)
**Mockup:** `docs/superpowers/specs/2026-09-15-forecast-chart-hours-mockup.html` (the scenario switch drives every card
and signal with the MR 2 formulas)
**Register:** closes §501 (#40) and §504 (#44); files §549 (#339, earned-value history — narrowed by MR 3 to recorded
history for hand-entered % complete, see §3.4); extends §545 (#335)
**Branch:** `feat/budget-forecast-chart` off `origin/main` at 1.6.1

## 1. Problem

The parent spec planned MR 3 as a chart-only change: forecast lines, run-out marker, EV point and a Burn-down /
Cumulative switch on the Budget report and the dashboard tile. Reading the shipped code against it found three gaps:

- **The chart is twin charts, and forecasts exist only in €.** `BurndownCharts` draws an hours chart and a € chart side
  by side on both surfaces; the forecast engine was only ever fed € facts. The hours chart would gain nothing.
- **The chart is indexed by period, not by date.** Run-out, today and the plan end need a date-accurate position, and
  the y axis clamps every value at zero.
- **The forecast lines would not meet the actual line.** The forecast uses the report's BAC and an uncapped
  fixed-price AC; the chart uses the burn-down totals over the bucket-chain window.

Reviewing the hours question surfaced a product point that drives most of this addendum: **€ and hours can tell
different stories.** When cheaper roles book more of the hours than planned, the € forecast looks milder than the
effort overrun; when senior roles do, € looks worse than the effort. A € forecast alone hides the first case.

### Why hours had no forecast

A spec ruling, not a technical limit. Parent §2 set the money basis to contract price (the AIPM Burndown standard), so
MR 2 built € facts only. `computeForecastFromFacts` reads `bac`, `ac`, `ev`, `pv` and the dated values and nothing
else, so it forecasts hours unchanged once it is given hours facts.

## 2. Decisions

| Decision | Ruling |
|---|---|
| Hours forecast | Yes — same engine, hours facts |
| Chart | Option A: ONE chart with two `SegmentedControl`s, orientation (Burn-down / Cumulative) and unit (€ / Hours), on the Budget report and the dashboard tile |
| Forecast cards | Card 1: the € card stays the headline; each card gains one "In hours" line |
| Divergence signal | S1 banner (trigger-gated) whose action opens S4 "Where the hours went"; S2 rate fact always in the facts row; S5 chip on the tile; S6 one shared explanation text for every chip and tooltip |
| Chip tooltip | The tooltip opens from the chip itself (its text and its ⓘ), not only from a separate icon |
| Trigger | `|rate drift| ≥ 3%` OR the € and hours pace VAC ratings differ |
| Budget RAG and tile headline | Unchanged — € only. Hours explain a rating; they never change it |
| S4 role mix | In MR 3 |
| Earned-value history | In MR 3, derived from task completion dates (Option 1, decided 2026-09-15); drawn only when every budgeted bucket is task-linked (§3.4) |
| §501 | Closes with MR 3; §549 stays open, narrowed to recorded history for buckets with a hand-entered % complete |

## 3. Engine and data

### 3.1 Hours forecast

- One walk in the facts builder yields both € facts and hours facts. `computeForecastFromFacts` is unchanged.
- Hours facts:
  - **BAC h** = `report.project.budgetHours`.
  - **AC h** = `report.project.actualHours` — raw hours, fixed-price buckets included (no §5.4 uncapping applies).
  - **EV h** = Σ bucket budget hours × `bucketPercentComplete`, with the SAME `bucketsMissingPercent` rule as €, so
    both units become unavailable together.
  - **PV h** = the burn-down's hours series at `todayIndex` (`totalBudgetHours − plannedRemainingHours[todayIndex]`),
    mirroring the € PV rule of parent §5.7.
  - **Dated values** = the same day-key and spread-period walk as €, with hours as the value.
- **EV h basis (verified 2026-09-15 by probe, corrects an earlier "own-hours" wording here):** each bucket's EV h term
  uses the REPORTED, spillover-inclusive `br.budgetHours`, because `report.project.budgetHours` (BAC h) sums exactly
  those, just as EV € uses the spillover-inclusive `br.budgetValue` that BAC € sums. A closed donor spilling 50 h /
  €5,000 into a 60%-complete T&M successor gives EV h ÷ BAC h = EV € ÷ BAC € = 45% on this basis and a mismatched
  30% on the own-hours basis. The own-hours subtraction (`br.budgetHours − br.spilloverInHours`) stays where it is:
  the fixed-price AC ratio only.
- New wrapper `computeProjectForecasts(args)` returns `{ eur: BudgetForecast; hours: BudgetForecast; mix: RateMix |
  null }`. `computeProjectForecast` keeps returning the € forecast, so every 1.6.x caller is unchanged.

### 3.2 Rate mix (`budget-rate-mix.ts`, pure, i18n-free)

- **Rate drift** = (booked € ÷ booked h) ÷ (budget € ÷ budget h) − 1, at external (contract) rates, over **hourly
  buckets only** — fixed-price buckets are excluded, because their € actual is already an hours ratio. Null when any
  of the four totals is 0.
  - The exclusion is **disclosed on every surface that shows a rate figure**: the hours pace VAC in the same sentence
    is project-wide (§3.1), so a reader otherwise compares an hourly-bucket share against a project-wide overrun.
    `excludedActualHours` carries the booked hours the skip dropped (actual hours only — no budget-hours walk), and
    the disclosure prints only when it is above 0.
- **Role mix rows**, grouped across all hourly buckets by role (role-planned buckets) or by discipline (blended
  buckets): `plannedShare` (budget hours ÷ total budget hours), `bookedShare` (actual hours ÷ total actual hours),
  `difference` (booked − planned share), `usedOfBudget` (actual ÷ budget hours of that row).
  - `RateRow` gains an optional `roleId` or `disciplineId`, set in `bucketRateRows`; nothing else reads it.
  - Hours per row mirror `computeBucketReport` exactly: effective budget hours (`effectiveBudgetHours`, so
    budget-follows-plan buckets work) and `actualHoursIn` over the bucket's active periods, OWN hours (no
    spillover). A parity test pins Σ rows against the report.
  - Row names are workspace data, not i18n: a role row uses `roleLabel(role, disciplines, grades)`, a discipline
    row the discipline's name. The engine therefore takes `disciplines` and `grades`; the Budget report panel and
    the dashboard input gain both.
- **Driver** = the row with the largest positive `difference`; null when none exceeds 3 points.
- **Trigger** fires when both pace forecasts are available AND (`|drift| ≥ RATE_DRIFT_SIGNAL_RATIO` (0.03) OR
  `paceVacHealth(eur) !== paceVacHealth(hours)`).
- **Direction** = `"hours-worse"` when hours pace VAC ÷ BAC h < € pace VAC ÷ BAC €, else `"eur-worse"`.
- **Severity** = `"warning"` when the two ratings differ, else `"info"`.
- `RateMix = { drift, bookedRate, plannedRate, rows, driver, excludedActualHours, triggered, direction, severity }`;
  the wrapper returns `mix: null` when there are no hourly buckets, no booked hours, or the booked hours carry no
  contract value at all (every hour on an unpriced or dangling role — `bookedRate` 0 would render as "−100% vs plan").

### 3.4 Earned-value history (Option 1, derived)

- For each date of the chart's actual line (every past period end, and today), per budgeted bucket (`budgetValue >
  0`): share = linked tasks finished (`isTaskFinished`) with a `completedDate` on or before that date ÷ resolved
  linked tasks. EV € = Σ `br.budgetValue` × share; EV h = Σ `br.budgetHours` × share (the §3.1 basis).
- The TODAY point uses `bucketPercentComplete` itself, so the line ends exactly at the forecast's EV. A finished task
  with no `completedDate` (Cancelled is closed but never delivered) cannot be placed in the past, so it counts only
  in the today point.
- **All or nothing.** When any budgeted bucket has a hand-entered `percentComplete`, or no resolvable linked tasks,
  there is no history: the engine returns the unavailable state with those buckets, and the chart shows a muted
  note naming them instead of a partial line. A partial line would under-report earned value and read as a
  schedule problem.
- It is an approximation and says so in its tooltip: today's links and budget are applied to the past, and a task
  reopened after completion loses its earlier completion.
- New pure module `budget-ev-history.ts`; the result rides the forecast bundle next to `mix`.

### 3.3 Unchanged

The budget RAG input (`paceVacHealth` on € pace, worst-of with Effort CPI), the tile headline, the AI dashboard
snapshot and every export. §545 now also names the hours forecast and rate-mix figures as missing there.

## 4. UI

### 4.1 `InfoTooltip` gains a custom trigger (primitive change, approved)

- Optional `children?: ReactNode`. When present they render inside the existing `role="button"` trigger span instead
  of the "i" glyph; hover and focus open, Escape closes, portal and positioning are unchanged. Existing callers render
  byte-identically.
- `label` becomes required when `children` is given (a type-level overload), and it must contain the chip's visible
  text (WCAG 2.5.3 label-in-name).
- The chip is ONE control: a `Badge` whose content is the arrow, the text and a trailing ⓘ, all inside the trigger. A
  separate icon beside the chip would be a second focus stop with the same name — a duplicate accessible name axe
  cannot see.

### 4.2 Forecast cards (`ForecastCards`)

- Each card gains an "In hours" `<dl>` under its € `<dl>`:
  - At current pace: EAC h · VAC h (% of BAC h) · runs out.
  - At current efficiency: EAC h · VAC h (%) · CPI (hours).
- Hidden whenever that card's € state is unavailable (both units share bookings and percent complete).
- When the trigger fires, both hours lines carry the chip: "▲ Effort worse than €" (`hours-worse`) or "▼ € worse than
  effort" (`eur-worse`). Accessible names are card-unique: "Effort worse than € at current pace — why?" and
  "… at current efficiency — why?".
- "CPI (hours)" is a new visible label beside Effort CPI; its `InfoTooltip` says it is bucket hours earned ÷ booked,
  not task effort.

### 4.3 S1 — mix banner (`ForecastBanners`)

- `Banner`, `role="status"`, severity from `mix.severity`, text starting with "Warning:" or "Note:".
- FIRST in the Forecast section's banner stack: it changes how the cards read. It cannot co-occur with a pace
  unavailable state, because the trigger requires both pace forecasts.
- EN, `hours-worse`: "Warning: the hours tell a worse story than the budget. Junior consultants did 37% of the booked
  hours (planned 30%), so hours cost €116/h on average instead of €120/h. At current pace the effort overrun is
  −10.4%; the budget shows −8.8%."
- EN, `eur-worse`: "Note: the budget tells a worse story than the hours. Senior consultants did 37% of the booked
  hours (planned 30%), so hours cost €124/h on average instead of €120/h. At current pace the budget shows −8.8%
  while the effort overrun is only −2.9%: the overrun is in rate, not in hours."
- When the driver is null the role sentence is omitted.
- When booked hours were excluded, a closing sentence names the scope: "Rate figures cover hourly buckets only;
  900 h of fixed-price work are excluded." It rides the shared S6 explanation, so it reaches the banner, both card
  chips, the tile chip and the S4 footnote at once.
- Action: `Button` (secondary, xs) "Where the hours went" — opens S4 and moves focus to its `<summary>`.

### 4.4 S4 — "Where the hours went"

- A `<details>` (the house pattern) directly under the banner stack, collapsed by default, rendered whenever `mix` is
  non-null — also when the mix is on plan.
- Table: role or discipline · rate · planned share · booked share · difference ("+7 pts") · hours used of that row's
  budget ("539 of 600 h (90%)"). Plain `<th>` headers — the table is not sortable.
- The driver row carries a text `Badge` "Driver" (not colour alone).
- Footnote: the shared S6 explanation. Prints only when open.

### 4.5 S2 — rate fact (`ForecastFactsRow`)

- A fifth fact, "Avg rate booked": "€116/h ▼ −3.4% vs plan" when `|drift| ≥ 3%`, else "€120/h · on plan".
- Standard `InfoTooltip` with the S6 text. Hidden when `mix` is null.
- Its tooltip closes with the same scope sentence as §4.3 when booked hours were excluded — the two rate figures it
  spells out are hourly-bucket totals, not project-wide ones.

### 4.6 S5 — tile chip

- Under the tile headline and its existing one-line banner, only when the trigger fires:
  "▲ Hours −10% · runs out 23 Nov" (`hours-worse`) or "▼ Hours only −3% — overrun is in rate" (`eur-worse`).
- Same chip component and S6 text; the name ends "— why?".

### 4.7 S6 — one explanation text

- One builder, `rateMixExplanation(lang, mix, eur, hours)`, feeds the card chips, the tile chip, the S2 tooltip and
  the S4 footnote. The banner composes its longer text from the same sentence parts, so every number agrees.

## 5. Chart

### 5.1 One chart, two switches

- `BurndownCharts` becomes a single chart taking `unit: "eur" | "hours"` and `orientation: "burndown" | "cumulative"`.
  The hours unit draws the hours series with the hours forecast; with no hours budget it shows the existing empty
  text.
- Two `SegmentedControl`s, `ariaLabel` "Chart orientation" and "Chart unit": on the Budget report above the chart in
  the Burn-down section, and in the tile directly above the chart. Neither sits in a trailing toolbar group.

### 5.2 Geometry

- **X axis by date**: domain = first period start → plan end. Planned and actual points sit at period ENDS plus an
  origin point at the domain start; the actual line ends at today's date; run-out, today and plan end are placed by
  date.
- **Y below zero**: the domain includes the lowest series value and forecast end; an "over" band and a labelled zero
  line appear when anything is below zero.
- **Forecast anchoring**: both forecast lines start at the last actual point and extend by their own ETC, so there is
  no jump at today. End labels print the forecast's own EAC / VAC (the card figures).
  - When the chart's frame differs from the forecast's (chart total ≠ BAC, or chart actual ≠ forecast AC — fixed-price
    uncapping, a bucket-chain window, negative corrections), a muted note under the chart reads: "Chart totals differ
    from the forecast figures (fixed-price or bucket window); the figures above are authoritative." The common case
    shows no note.
- **Series and markers** (dash patterns and the legend carry meaning, not colour alone):

| Element | Burn-down | Cumulative | Style |
|---|---|---|---|
| Planned | remaining | cumulative | muted, dashed |
| Actual | remaining to today | cumulative to today | green solid; pink when over (unchanged rule) |
| At current pace | to plan end | to plan end | `ui-dark-blue`, dashed |
| At current efficiency | to plan end | to plan end | `ui-purple`, dotted |
| Earned value today | diamond at BAC − EV ("work left") | diamond at EV | `--rag-amber` |
| Earned-value history (§3.4) | — | line from the origin to the EV diamond | `--rag-amber`, dash-dot |
| Run-out | circle at zero on the run-out date | circle on the BAC line | `ui-pink` |
| BAC line | — | dashed, labelled | muted |
| Today / plan end | vertical lines | vertical lines | muted (today is no longer dark blue — that colour now belongs to the pace line) |

- An unavailable forecast draws no line and has no legend entry; the legend lists only drawn series.
- The SVG keeps `role="img"`; its `aria-label` summarises orientation, unit, run-out and the end VAC values. Tick labels
  stay `aria-hidden`.

## 6. Settings

- `budgetChartView?: "burndown" | "cumulative"` and `budgetChartUnit?: "eur" | "hours"` in `settings-types.ts`;
  defaults `"burndown"` and `"eur"`. The Budget report and the tile share both.
- Written through `writeSettings`; coerced on load in `use-settings.ts` like `tasksViewMode` (an unknown stored value
  falls back to the default). No per-project override (`project-appearance-prefs.ts` untouched), no AI settings patch.
- Print shows the selected orientation and unit.
- Tile size stays `h: 3, minH: 3, maxH: 4`. The single chart frees width; if the controls and the chip clip at `h: 3`,
  the plan's eye-verify step raises the default `h` to 4 (`reconcile` already clamps saved layouts).

## 7. Testing

- **Engine (hours)**: fixture = §5.6 plus hours (BAC 2,000 h, AC 1,450 h, 220 h in the 20-working-day window, 62%
  complete, PV h 176,000 ÷ 120). Pins: burn 11.0 h/day, ETC 759 h, EAC 2,209 h, VAC −209 h, run-out 2026-11-23;
  efficiency CPI (hours) 0.8552, ETC 888.7 h, EAC 2,338.7 h; gap 129.7 h (6.49%), extra working days 12. The existing €
  tests stay untouched as the regression pin.
- **Rate mix**: three fixtures, roles Senior €150/h 600 h · Consultant €120/h 800 h · Junior €90/h 600 h, € actual
  €168,000 each:

| Scenario | Booked h (S / C / J) | Window h | Drift | Hours pace VAC | Trigger | Direction | Driver |
|---|---|---|---|---|---|---|---|
| Cheaper roles overburn | 339 / 572 / 539 | 220 | −3.45% | −10.4% (R vs € A) | yes, warning | hours-worse | Junior |
| Senior roles overburn | 505 / 540 / 305 | 205 | +3.70% | −2.9% (A = € A) | yes, info | eur-worse | Senior |
| Mix on plan | 420 / 560 / 420 | 225 | 0.00% | −8.8% (A = € A) | no | — | none |

  Plus: fixed-price buckets excluded from drift; null cases; drift at 2.99% vs 3.00%; the rating-band rule alone
  (drift under 3% with differing ratings); driver null under 3 points. Each rule mutation-checked.
- **EV history**: points at the actual line's dates; a task completed mid-period counted from its own date; the
  today point equal to the forecast's EV (both units); a Cancelled task counted only at today; unavailable with the
  named buckets for a hand-entered % complete and for a bucket with no resolvable links.
- **`InfoTooltip`**: existing tests unchanged; the children trigger opens on hover and focus, closes on Escape, and its
  label passes a label-in-name assertion.
- **Components**: hours lines per card and their unavailable states; chip names unique per card; banner text in both
  directions, both severities, absent when not triggered, first in the stack; the banner action opens S4 and focuses
  its summary; S2 both states; S4 rows and the Driver badge; tile chip; one explanation string across surfaces.
- **Chart**: every orientation × unit; unavailable forecasts omit line and legend entry; below-zero domain; run-out x
  from its date; the frame-difference note present and absent; both controls via `SegmentedControl`; settings written
  through `writeSettings`; a bad stored value coerced on load.
- **i18n**: DE loaded with `loadI18n("de")`; the encoding test green.
- **a11y**: the CI axe gate does not reach `budget-report`; run one local axe scan as in 1.6.0. Duplicate names and
  label-in-name are unit-tested.
- **Before planning**: grep every test assuming twin charts (`burndown-chart.test.tsx`, `budget-report-panel` tests,
  dashboard tile tests) and label each hit DELETE, MIGRATE or RECOMPUTE.

## 8. Documentation and register

- Close §501 (#40) and §504 (#44) in the MR that ships this, with evidence; delete their `**Work item:**` lines in the
  same commit; one `Closes #NN` per line in the MR description.
- §549 (#339) filed with this addendum; the MR that ships §3.4 narrows its title, status and fix shape (and the
  issue title) to recorded history for buckets with a hand-entered % complete.
- §545 (#335) extended: hours forecast and rate-mix figures also missing from the snapshot and exports.
- `docs/AGENTS/dashboard.md`: the burn tile's chart switches and chip. CHANGELOG entry at release (1.7.0; codename
  checked then with the dash-agnostic command in `version.ts`).

## 9. Out of scope

Recorded earned-value history for hand-entered % complete (§549); hours in the budget RAG or tile headline; the AI snapshot and exports (§545); per-person
rate mix; a % of budget chart view (mockup option C, not chosen); scenario forecasts and Monte Carlo (§502).

## 10. Risks

- **Signal noise.** A 3% drift fires on small projects where one booking moves the mix. Mitigation: the trigger also
  requires both pace forecasts (20 working days of bookings); thresholds are named constants.
- **Two numbers per figure.** Hours lines add reading load on every visit. Mitigation: one compact line, the € figure
  stays the headline.
- **Primitive change.** `InfoTooltip` is used app-wide. Mitigation: the children path is additive and existing tests
  stay unchanged.
- **Frame mismatch hidden by the note.** If the note appears often, users learn to ignore it. The plan measures how
  often the sample and demo workspaces trigger it.
