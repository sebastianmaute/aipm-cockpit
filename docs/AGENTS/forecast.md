# Monte Carlo schedule forecast (§502, slice 1)

The Forecast view under Reports answers three questions from the project's own completion history:
**When** does the open work finish (P50/P80/P95), **How many** tasks (or minutes) fit by a chosen date,
and what is each milestone's **chance** of landing on its date. Part 1 of the surfaces design
(`docs/superpowers/specs/2026-10-15-forecast-simulation-surfaces-design.md`) adds the Dashboard
Show-simulation switch (`SettingsOverrides.forecast`) and a daily recorder that persists
`Workspace.forecastHistory` (a meta-blob on all six write paths). It replaced the old slices 2 and 5;
part 2 (the Dashboard picture), part 3 (the budget simulation) and saved scenarios (build step 2) are built, all
held back with the view; the AI tool and part 4 are open — see §502 in [`../open-followups.md`](../open-followups.md).
Reproduce the file list: `ls src/app/forecast`.

★★ **HELD BACK FROM THE RELEASE.** `"forecast"` sits in `RELEASE_HIDDEN_VIEWS` (`feature-modules.ts`), so
`isViewEnabled` answers false for it in every mode: no sidebar entry, no Reports sub-tab, a `#forecast` hash
is ignored, a stale active tab is redirected, `workspace-section.tsx` renders nothing for it, Help draws no
"Go to Forecast" link and `e2e/a11y.spec.ts` skips its scans. The code and its unit tests stay live. To ship
it: drop it from that list, then put back what the hiding commit took out of the user-facing text — find it
with `git log -S RELEASE_HIDDEN_VIEWS --oneline` — namely its CHANGELOG "Added" entry, the Forecast
sentence of `helpSecReportsBody` (EN and DE) and its lines in `lib/app-feature-guide.md` (then run
`node scripts/gen-operating-guide.mjs`), and re-measure the scan count in `e2e/a11y.spec.ts`. ★★ Also run the Scenarios-mode axe spec,
`e2e/forecast-scenarios.spec.ts`, which CI skips while the view is held back (see "Saved scenarios (build step 2)").
★★ Part 1 of the surfaces design is held back WITH it, through the same `isViewEnabled("forecast", …)` gate
(`isSimulationActive`, `hiddenHelpEntryIds`): the Show-simulation switch, the simulated KPI cells, the intro, the
Help entry and the history recorder all vanish. ★★ Part 2 goes with it: the Dashboard Forecast tile (off the board
AND the shelf), the milestone chance chips and their explainer, the Next-actions "unlikely on time" signal and the
Forecast-tile placeholders, all through `isSimulationActive`. Shipping the view also means: turn part 1's CHANGELOG
`[Unreleased]` Notes line ("built but held back with the forecast") into an Added entry, and expect the
held-back tests to FAIL by design — each asserts that a surface is hidden while `"forecast"` sits in
`RELEASE_HIDDEN_VIEWS` (`grep -rl "held back" src/app --include=*.test.ts* | xargs grep -li simulation`); invert or delete them, and drop the
`showForecastView()` spy (`src/test/forecast-view.ts`) from the tests that use it.

## Module map

The engine lives in `src/app/forecast/` and is PURE and i18n-free: it returns numbers and codes, never
text. The view is flat in `src/app/` (`forecast-panel.tsx` orchestrates; `forecast-toolbar.tsx`,
`forecast-chart.tsx` and `forecast-tables.tsx` present). It reuses `forecast-format.ts` (the budget
forecast's formatter) rather than owning a formatter of its own.

| File | Owns |
|---|---|
| `forecast/constants.ts` | `FORECAST_TRIALS` (10,000), `MIN_FINISHED_TASKS` (10), `MIN_HISTORY_WORKING_DAYS` (10), `EFFORT_MODE_MIN_COVERAGE` (0.7), `MAX_HORIZON_WORKING_DAYS` (1300), `HISTORY_WINDOWS`, `DEFAULT_HISTORY_WINDOW` (60) |
| `forecast/rng.ts` | `mulberry32` (seeded PRNG, with `skip(n)` to jump `n` draws) and `seedFrom` (FNV-1a over the parts joined by `\|`) |
| `forecast/throughput.ts` | `dailyThroughput`: completions per working day, zero days kept, `cutAtFirstCompletion`; `isValidIsoDate` (strict `YYYY-MM-DD`) |
| `forecast/simulate.ts` | `SimOptions`, `dayDrawer` (with `drawDay` over it), `cannotReach`, `simulateWhen`, `simulateHowMany`, `percentile`; `buildArrivals` / `Arrivals` (dated scope, see "Saved scenarios") |
| `forecast/milestones.ts` | `orderBacklog`, `milestoneChances`; `isAttributableMilestone`, `ownWorkToday`, `clampAttributedRemovals` (attributed scope) |
| `forecast/index.ts` | `computeScheduleForecast`: floor, backlog, effort mode, what-if or dated `changes`, streams, the fixed trial count; `lastForecastableDay` (the How-many horizon) |
| `forecast/day-index.ts` | `simulatedDates`, `dayOnOrAfter`, `dayOnOrBefore`: simulated working days as dates and back (Saved scenarios) |

## Landmines

- ★★★ **No `Math.random`, `Date.now()` or `new Date()` in the engine.** A forecast must be reproducible
  for the same inputs, so every draw comes from `mulberry32`, and `today` is a PROP (`today` on
  `ScheduleForecastInput`), never read from the clock. `isValidIsoDate` in `throughput.ts` builds a
  `Date` only from a given string, to reject `2026-02-30`. Check: `grep -rn "Math.random\|Date.now\|new Date()" src/app/forecast --include=*.ts | grep -v test` must print nothing (the one guarded parse is `new Date(` with a template-literal argument, which that pattern does not match).
- ★★ **A Done task with no `completedDate` is EXCLUDED, not repaired.** `dailyThroughput` counts it in
  `doneWithoutDate` and keeps it out of `samples`; the view tells the user how many. Repairing it would
  invent a date — see [`task-status.md`](task-status.md) (load does not repair a split pair). A
  completion dated after `today` is dropped too.
- ★★ **The backlog is `!isTaskClosed`** (`task-closed.ts`): Done AND Cancelled leave it. History counts
  `status === "Done"` only — Cancelled is closed but never delivered.

## Seed, streams and the floor

- **Seed.** `computeScheduleForecast` builds `seedParts` from the sorted open task ids, the throughput
  samples, the window and the unit, so the same project state gives the same numbers on every render and
  machine. ★★ The What-if numbers and a scenario's dated `changes` are deliberately NOT in the seed (§502
  build step 2, owner): with the fixed draws per trial below, trial `t` of every run reads the same random
  numbers, so Quick, What-if and every scenario column differ only by what was changed (common random
  numbers, see "Saved scenarios"). Dropping them from the seed moved the pinned digests once, deliberately.
- **Separate streams (R5).** `stream(name)` derives one `mulberry32` per output — `"when"`, `"howMany"`,
  `"milestones"` — from `seedFrom([...seedParts, name])`. No figure depends on whether another ran first.
- **Floor.** When there is real OR simulated work (`open.length > 0 || backlog > 0`, where `backlog`
  is the post-what-if amount), fewer than `MIN_FINISHED_TASKS` completions inside the window, or fewer
  than `MIN_HISTORY_WORKING_DAYS` window days, returns `kind: "insufficient"` carrying the shortfall
  and `doneWithoutDate`. Only a project with NO open task AND no what-if scope added skips the floor
  (R3): it still runs `milestoneChances`, where all-closed reads 100 %, no linked tasks reads
  `no-linked-tasks`, and overdue needs an open task.
- ★★ **Neither backlog alone decides the floor.** Reading only the post-what-if `backlog` let a scope
  of −100 % empty the simulated backlog and skip the floor while real linked tasks stayed open, so
  How-many and the milestone chances (which use the real linked tasks, and read 0 % on an empty
  history) rendered with no history at all. Reading only `open.length` let a What-if of +N tasks on a
  project with no open task skip it the same way. Pinned by "a what-if that empties the backlog still
  needs the history floor" and "a what-if that adds scope to an empty backlog still needs the history
  floor" in `index.test.ts`.
- **Window.** `HistoryWindow` is 30, 60, 90 or `"all"`. Both kinds end at the latest working day on or
  before `today` and start NO EARLIER than the earliest attributed completion. `"all"` starts exactly
  there; a fixed window is that many working days, cut at that completion when the project is younger
  (R14). With no attributed completion at all the window is empty.
- ★★ **Why R14 cuts a fixed window.** Days before the team's first completion are not real zero days.
  Padding them in made a project with 15 working days of history at 2 tasks a day forecast 60 open tasks
  at P50 ≈ 119 working days on the default window 60, instead of 30 (pinned by "a young project is
  forecast from its own days, not padded to the window (R14)" in `index.test.ts`). The cost of the rule:
  a team that genuinely idled before its first finish gets an optimistic forecast. Because of the cut, the
  days floor (`MIN_HISTORY_WORKING_DAYS`) now bites on a fixed window too, not only on `"all"`.
- ★ **The empty state names the cut.** `dailyThroughput` sets `cutAtFirstCompletion` when R14 shortened a
  fixed window (it then holds fewer than `window` days), and the `insufficient` result carries
  `windowCutAt` (the first completion's day, else `null`). The view then reads
  `forecastInsufficientDaysCut` ("… The window was shortened to start at the first completion, Oct 5,
  2026."), so "8 of 10 working days" on window 60 does not read as a broken window. `"all"` always starts
  at the first completion and is never flagged.
- **Next-working-day shift.** A completion on a non-working day counts on the NEXT working day
  (`attributedDay`), but never after the window's end: a shift that would pass `today` counts on the
  window's last working day (`today` when it is a working day, else the working day before it). So a
  completion on Saturday read on that Saturday counts on Friday; before this rule it was dropped. Pinned
  by "a shift that would pass today counts on the window's last working day, never dropped"
  (`throughput.test.ts`, with a holiday-today case).

## Simulation

- **`SimOptions` (R1).** `{ trials, rng, capacity, horizon, integer, capacityByDay? }`. `integer: true`
  is the tasks unit: each simulated day is stochastically rounded to whole tasks. `integer: false` is
  effort: the fraction is kept. `capacityByDay`, when set, is a multiplier per simulated working day
  (index 1..horizon, index 0 unused) that replaces `capacity`; one shorter than `horizon + 1` throws
  (pinned by "a schedule shorter than horizon + 1 throws rather than finishing trials where it runs out").
- **`dayDrawer` (R2)** is the one place a simulated day is drawn (bootstrap sample × capacity, or × that
  day's `capacityByDay` multiplier, rounded when `integer`); `draw(day)` takes the 1-based day index, and
  a day makes the same rng calls whatever its multiplier, so the stream never depends on the schedule.
  `drawDay` is a one-shot wrapper over it. `simulateWhen`, `simulateHowMany` and `milestoneChances` all
  take their `draw` from it, so the rounding rule lives once. On the flat path (no schedule) it hoists
  the per-sample arithmetic out of the loop; both paths skip (rather than compute) the rounding draw of a
  whole value, which can never round up. The values and the stream are those of the plain formula
  (pinned by "the hoisted drawer draws the plain formula's values from the same stream, both units", and
  for a schedule by "a flat capacityByDay draws exactly what the scalar capacity draws, both units"). An
  empty history draws 0.
- ★★ **Early exits are EXACT, because the stream can jump.** A trial stops drawing once its outcome is
  certain — When: even the best possible remaining days (`dayDrawer`'s `bestBetween`: `max` per day
  without a schedule, a prefix sum of each day's best with one) cannot reach the backlog (`cannotReach`),
  so it is `beyond`; milestones: every milestone still ahead is already reached,
  or none can be — and then calls `skipDays`, which jumps the stream (`mulberry32`'s `skip`, its state
  only adds a constant per draw) to where drawing those days would have left it. So every later trial
  draws the same numbers and every result is unchanged: on the four probe cases below plus three more
  (effort, capacity 300 %), the result digests before and after are identical at the same trial count.
  Pinned against plain full-walk reference loops by "the certain-beyond early exit gives exactly the
  days of walking every trial to the horizon" (`simulate.test.ts`) and "the early exits (all reached,
  none reachable) give exactly the chances of walking to the last day" (`milestones.test.ts`). An rng
  without `skip` draws and drops instead. ★ Never add an exit that does not skip its draws: it shifts the
  stream for every later trial and changes the numbers.
- ★★ **Every trial consumes a FIXED number of draws** (§502 build step 2), whatever the backlog, capacity or
  scope: When walks (or skips) exactly `horizon` days per trial, also when it finishes early; How many exactly the
  target's days; the milestone tally exactly `walkTo` days, the latest attributable milestone dated today or later,
  whether or not a scenario leaves it a target. An empty backlog draws nothing at all. So trial `t` starts at the
  same stream position in every run, which is what common random numbers need. Pinned by the "fixed draws per
  trial" describes in `simulate.test.ts` ("every When trial consumes exactly the horizon's draws", "every How-many
  trial consumes exactly the target's draws") and `milestones.test.ts` ("the tally walks every trial to the last
  dated milestone, target or not").
- **When.** Working days until the backlog is done, per trial; a trial still short after
  `MAX_HORIZON_WORKING_DAYS` is `horizon + 1` and reported as `"beyond"` (with `beyondShare`). Dates come
  from `nthWorkingDayAfter(today, days, holidaySet)`; day 0 is `today`.
- **How many reads at 100−P (R7).** The result `amount` for P50/P80/P95 is `percentile(reached, 100 − p)`
  of the sorted per-trial totals: "at least N with P % confidence", the ActionableAgile How-Many
  convention the customer cited. So P95 is the LOW end.
- ★★ **How many is capped at the backlog.** `simulateHowMany` takes the post-what-if `backlog` (tasks or
  minutes, the samples' unit): each trial stops drawing once it reaches it and reports
  `Math.min(total, backlog)`. Uncapped, a horizon target showed P50 = 1,390 beside 100 open tasks in the pre-PR review's probe.
  Pinned by "How-many is capped at the open backlog" (`index.test.ts`) and "a trial never delivers more
  than the backlog" (`simulate.test.ts`).
- **How-many horizon (R15).** The target is capped at `lastForecastableDay(today, holidaySet)` —
  `MAX_HORIZON_WORKING_DAYS` working days after `today` — before its working days are counted, so the
  cost (`trials × target days` draws, run in the panel's render-time `useMemo`) is bounded the same way
  When is. Uncapped, a year-2206 target took about 14 s in the final review's probe. The panel enforces
  the same bound (see "What the panel owns").
- **Capacity** is `capacityPercent / 100` on every draw, clamped to 10–300 %.
- **Trial count.** Always `FORECAST_TRIALS` (10,000). Owner decision 2026-10-14: there is no adaptive
  fallback to 5,000 (it was removed; the early exits that came with it stay and are result-identical).
  What-if extremes are user-triggered (an opt-in mode), so a one-off pause of about 600 ms (see
  "Performance") per recompute is accepted, and there is no worker. Exactly four inputs commit on blur
  or Enter rather than per change: the three What-if number fields
  (`grep -c '{field("' src/app/forecast-toolbar.tsx` = 3) and the How-many target date. The History
  `<select>` and the Quick/What-if and unit toggles recompute on change — each is one discrete choice
  among a few options, not a value stepped through — so with an extreme applied every such choice costs
  one pause. `result.trials` carries the count and the caption prints it ("10,000 runs …"). An explicit
  `input.trials` (the tests) is used as given. Pinned by "always FORECAST_TRIALS, a What-if extreme
  included, the same on every call" in `index.test.ts` and the panel's caption test.

## Effort unit

- Offered only when `effortCoverage(open) >= EFFORT_MODE_MIN_COVERAGE` (share of open tasks with an
  `originalEstimateMinutes > 0`); otherwise `resultUnit` falls back to `"tasks"` silently and the toolbar
  disables the toggle. The reason is a VISIBLE muted hint beside it, which is also the radiogroup's
  `aria-describedby` (a disabled radio takes no focus, so a `title` alone reached hover only). The `>=` is boundary-pinned: exactly 70 % qualifies.
- **One measuring stick (R6/R8).** In effort mode an UNESTIMATED open task, an unestimated what-if
  addition AND an unestimated DONE task (via `dailyThroughput`'s optional `unestimatedSize`) all count at
  the median estimate of the estimated open tasks. `backlog` is then in minutes. This is the defensive
  fallback for the 30 % without estimates.

## What-if

- `WhatIf = { scopeTasks, scopePercent, capacityPercent }`, normalised by `clampWhatIf` (non-finite values
  fall back to the defaults, so `NaN` never reaches the engine). Added scope is `scopeTasks` at one task's
  size plus `scopePercent` of the base, rounded half-up; removing every open task empties the backlog
  whatever the estimates.
- The capacity field is labelled **Availability (%)** (`forecastCapacityPercent`), the word the scenario editor's
  "Availability change" uses; the field name `capacityPercent` is unchanged.
- ★ **Scope does not move milestone chances (R9).** What-if scope is aggregate and changes When and How
  many only; `milestoneChances` keeps the real linked tasks, because added scope cannot be attributed to a
  milestone. Capacity DOES reach all three (it scales `drawDay`). A saved scenario's scope row CAN name a
  milestone, and then it does move chances (see "Saved scenarios").
- **Save as scenario** (toolbar, What-if mode, not in a read-only popout) freezes the CLAMPED What-if
  (`usedWhatIf`) into scenario rows through `whatIfToScenarioChanges`; see "Saved scenarios".

## Milestones

- `orderBacklog` queues open tasks by due date ascending (blank last), then priority descending, then id.
- A milestone's **position** is the cumulative size up to the LAST of its open linked tasks in that
  queue (`Math.max` over its linked tasks). Using the first would credit a milestone for work not yet
  done. `chance` is the share of trials whose cumulative done work reaches that position by the
  milestone's date.
- **Prioritised.** `chancePrioritised` replaces the position by the sum of just its own tasks (as if
  they were worked first).
- **Gap (R11)** = chance if prioritised − chance, in whole percentage points (`+12 pts`), computed from
  the rounded percentages (`gapOf` in `forecast-tables.tsx`).
- **`closedIds` (R4).** A linked id is open when it is in `ordered`, closed when it is in `closedIds`,
  otherwise dangling and ignored. All linked closed → 100 %; all dangling → `no-linked-tasks`;
  a past date with open work → `overdue`; an achieved milestone is skipped. All-closed is checked BEFORE
  the date, so an overdue milestone whose linked tasks are all closed reads 100 % (pinned by "overdue with
  every linked task closed reads 1/1, not overdue (T3b)").
- ★★ **A milestone without a valid date is omitted (R16).** `requiredIsoDateOnLoad` repairs a date to
  `""` (and `"" < today` would read `overdue`) unless it is at least shape-valid: a `YYYY-MM-DD`
  non-calendar date in 1900–2100 such as `2026-11-31` is kept raw (`isKeptNonCalendarDate` in
  `sanitize-load-date.ts`). `milestoneChances` skips any `m.date` that fails `isValidIsoDate`, which
  covers both, so such a milestone is absent from the table. The table's date cell also formats only a
  valid date and is blank otherwise, because `formatDayMonthYear("")` throws a `RangeError`, which
  blanked the whole app before this rule. The panel's `defaultHowManyTarget` applies the same check to
  milestone dates and `plan.endDate`, so a kept non-calendar date never becomes the How-many target.

## What the panel owns

`ForecastPanel` holds mode (Quick / What-if), unit, window, target date and the what-if fields, and runs
the engine once per input change in a `useMemo`. Quick always runs the plain forecast whatever the
What-if fields hold. None of this is saved to the project. The How-many target, stored or defaulted, is
clamped into [`today`, `lastForecastableDay`] on every render by `clampHowManyTarget`, so a passing
midnight or a far plan end re-clamps it. The date input carries the same `min` and `max` and refuses a
date outside them with `forecastInputInvalid` (R15). Typing or arrow-stepping the date edits a draft in
`PercentileTable`; blur or Enter commits it, so the forecast reruns once per accepted date. A draft
remembers the target it began from, and a render-time reconcile drops it when the committed target
changes underneath (a new plan end, a midnight re-clamp). While a draft is pending a muted hint,
`forecastTargetDateHint`, says it applies on leaving the field or Enter (a day picked from the native
calendar waits too) and is added to the input's `aria-describedby`; its line is always reserved, so it
appears without moving the table. Pinned by "the How many target commits on
blur or Enter, not on each change (M5)" and "a draft target is dropped when the committed target
changes from outside (M5)" (`forecast-panel.test.tsx`). The default window is 60 working days; the
axe spec selects **"All history" (R13)** and waits for the chart so axe sees the forecast state, not
only the empty state.

- **No Ask-Claude chips (R12).** `forecast` has no prompt chips until slice 4: no read tool exists, so a
  chip could not be answered. A test in `ask-claude-prompts.test.ts` pins the absence; the feature guide
  tells the AI not to quote the Forecast.
- Percent strings go through i18n keys (EN `{0}%`, DE `{0} %`; R10).
- **Amounts carry their unit.** `formatAmount` writes tasks as `forecastAmountTasks` through `tPlural`
  ("1 task", "5 tasks"; DE "1 Aufgabe", "5 Aufgaben") and effort as whole hours ("12 h"), for the
  open-work line and every How-many cell. Milestone figures are chances and already read in `%`.
- ★ **The What-if fields show the values the engine uses.** The panel derives `usedWhatIf =
  clampWhatIf(whatIf, open.length)` at render and hands it to both the toolbar and the engine. A
  committed scope of −5 therefore reads −3 once two of the five open tasks close elsewhere, instead of
  showing −5 while the forecast removes 3. The raw state is kept (no write-back, no effect), so the field
  returns to −5 if the tasks reopen. Pinned by "a committed scope removal shows the clamped value the
  forecast uses once tasks close (M8)" in `forecast-panel.test.tsx`.

## Performance

The engine runs on the main thread, in the panel's render-time `useMemo`, on every input change. There
is no worker. Measured 2026-10-14 in Node through `vite-node`, on `sample-workspace-huge.json` (repo
root: 270 tasks, 100 open, 60 milestones), the default window 60 and `today` 2026-10-14, at 10,000
trials, median of 5 runs after one warm-up, on a shared machine. It is a probe, not a benchmark gate:

| Case | Time |
|---|---|
| Default call (How-many target 2026-11-01) | 29 ms |
| How-many target at the horizon (`lastForecastableDay`) | 50 ms |
| Capacity 10 % + scope +500 % + horizon target | 597 ms |
| The same, plus one milestone dated at the horizon | 595 ms |

The early exits (commit 28dda4652) change no result: at the same trial count the engine before and after
them gave identical result digests in every case. No before/after timing is quoted: the only "before"
figures were taken in a different process on a shared machine and cannot be compared with these.

★★ **The What-if extremes miss the spec's "budget ≈ 100 ms" (spec §5, Performance), at about 600 ms, and that is accepted.** At 10 % capacity no
trial reaches a +500 % backlog, so When walks most of the 1,300-day horizon before `beyond` is certain,
and How many walks all of it, because a trial that never reaches the backlog must draw every day of the
target. Both are bound by the rng (one draw per simulated day at least, about 7 ns each on this
machine). The levers left are a worker, or fewer trials; the owner decided against both (see "Trial count"). On 2026-10-16 the owner reopened the worker as an option: register §748.
Reproduce the table from the repo root (single runs, so expect noise; delete the file
afterwards):

```bash
cat > forecast-probe.ts <<'EOF2'
import { readFileSync } from "node:fs";
import { computeScheduleForecast, lastForecastableDay, DEFAULT_WHAT_IF } from "./src/app/forecast/index";
const ws = JSON.parse(readFileSync("sample-workspace-huge.json", "utf8"));
const today = "2026-10-14", holidaySet = new Set<string>(), max = lastForecastableDay(today, holidaySet);
const open = ws.tasks.filter((t: { status: string }) => t.status !== "Done" && t.status !== "Cancelled");
const far = [...ws.milestones, { id: 999999, name: "far", date: max, linkedTaskIds: [open[open.length - 1].id] }];
const extreme = { scopeTasks: 0, scopePercent: 500, capacityPercent: 10 };
for (const over of [{}, { howManyTarget: max }, { howManyTarget: max, whatIf: extreme }, { howManyTarget: max, whatIf: extreme, milestones: far }]) {
  const t0 = performance.now();
  const r = computeScheduleForecast({ tasks: ws.tasks, milestones: ws.milestones, today, holidaySet, window: 60, unit: "tasks", whatIf: DEFAULT_WHAT_IF, howManyTarget: "2026-11-01", ...over });
  console.log(Math.round(performance.now() - t0), "ms", r.kind === "forecast" ? r.trials : r.kind, "trials");
}
EOF2
npx vite-node forecast-probe.ts; rm forecast-probe.ts
```

## Simulation across the app — part 1

The Dashboard can show simulated numbers beside its measured ones. Part 1 is the KPI strip's P80 finish and
chance on time; the dated history it records is the input to later surfaces. Files: `forecast-simulation.ts`, `forecast-history.ts`, `use-forecast-history-recorder.ts`, `forecast/app-forecast.ts`,
`kpi-simulation.ts`, `sim-value.tsx`, `sim-explainer.tsx`, `simulation-intro.tsx`, `percentile-words.ts`.

- **The switch** is `SettingsOverrides.forecast.showSimulation` (`settings-types.ts`), read with
  `isSimulationOn` and written with `withSimulation` (`forecast-simulation.ts`). ★★ OFF IS ABSENCE: turning it
  off deletes the key and folds an empty override to `undefined`, so a project that never used it serialises
  byte-for-byte as before. Never store `false`. It is per PROJECT and rides the six write paths with the other
  overrides. `Settings.simulationIntroSeen` is the opposite scope: per DEVICE (the one-time note).
- **`Workspace.forecastHistory`** (`forecast-history.ts`) is a **meta-blob** slice like `baselineHistory`: no
  `ENTITY_SPECS` row, absent from `TABLE_NAMES` because it has no table, and written by hand on all six paths
  (`src/app/forecast-history-persistence.test.ts` pins the round trips). One entry per day (`date`, `p50`,
  `p80`, `p95`, `chanceOnTime`); `sanitizeForecastHistory` drops malformed rows, keeps the LAST per date and
  sorts; `upsertForecastHistory` is immutable.
- **The sample master carries history.** `sample-workspace-small.json` holds weekly `forecastHistory` entries up to
  `DEMO_AS_OF`, computed by the real engine over the tasks as they stood on each day (a task finished after the
  day counts as open, one created after it is absent; a day the engine answers "insufficient" has no entry), and
  its open milestones link tasks. Since the §715 MVP slip, Pilot Go-Live and Rollout sit far below 50 % and Closure
  is safe. ★ `demo-week-master.test.ts` pins the last entry to the live forecast on `DEMO_AS_OF`, so re-authoring
  the master's tasks means recomputing the history. ★ The demo shift moves whole
  months, so `buildDemoWorkspace` drops entries that land after the real today. `scaleWorkspace` copies the
  series unreplicated, so the big and huge samples' live forecast does not match it. The switch stays OFF in the data.
- **The recorder** (`use-forecast-history-recorder.ts`) is called from inside `useInsightLifecycle`, not from
  `task-manager.tsx` (no size-ratchet headroom). It writes only when the switch is on AND `hydrated`,
  not `isPopout`, not `loadPending` (§548), `holidaysReady` and the forecast is sufficient. ★★★ WHETHER to
  write is decided against THIS TAB's own memory (a `useRef`), not against the stored entry alone. The five
  rules are numbered in the file header; in short: ON SHARED STORAGE ONLY (`isSharedStorage`: everything but
  browser storage, since a local file can sit on a shared drive and trips its revision check like Turso), a day
  change with every input unchanged writes nothing (an idle device must not write the new day over a revision
  another device already moved, spec §4.1); nothing stored for today writes; a stored entry EQUAL to the
  computed one writes nothing; a stored entry this tab has not SEEN (a peer wrote it since the tab's last run),
  or a tab with no baseline for today, ADOPTS it without writing; otherwise (the stored entry is the one the tab
  last saw and differs) it writes only when its OWN computed entry differs from its baseline. The stored-only
  compare it replaced let two tabs that compute different entries (per-device holidays, an old and a new build)
  overwrite each other for ever, since `forecastHistory` is broadcast between tabs. Pinned by "two clients
  with different holiday sets write once per day" in `use-forecast-history-recorder.test.ts` (one write in total
  when the second client comes up after the first recorded; two open across midnight are the "rule 1 applies on
  shared storage only" tests). ★ On browser storage an idle tab DOES record the new day (only
  when nothing is stored for today yet; a peer tab's entry is adopted), so several tabs open at midnight can each
  write once. Skipping there left a window open for days with no edits recording nothing, and after a week the
  tile's "Change shown from" date moved forward every day; on shared storage an idle window still does that
  until its next edit or reload. ★ The cost the rule
  accepts: when the tasks and the history arrive in SEPARATE deliveries (a remote edit followed by the peer's
  entry, or the reverse), a tab can write once for what is one edit; it is bounded, because the next run adopts
  or finds the stored entry equal. ★★ The SCOPE RULE: the ref stores `{ scope, entry, seen }`, with `scope` read from
  `getScopeEpoch()` (`scope-epoch.ts`), and a memory from another epoch counts as nothing recorded. It is NOT
  cleared on `loadPending`: a same-project reload (the conflict banner's Reload is a held "same-scope" op) also
  raises `loadPending`, and clearing there made the tab answer a peer's entry after every reload, one extra
  Turso revision and a conflict pause for the other user each time. The epoch moves only when another
  project's data is applied, so the memory still never suppresses a write for another project. It keys on the
  epoch, not `currentProjectId`, because in Turso portfolio mode the open project is `tursoProjectId`. Pinned
  by "keeps what it recorded across a SAME-project reload" and "forgets what it recorded when the scope epoch
  moves". ★★ The effect is SYNCHRONOUS, which is why it needs no `dropStaleScopeWrite` (it reads the epoch
  only as a key): an `await` added to it would need a captured start epoch and that drop. It writes through the context setter, so there
  is no undo capture and no activity-log entry. It is not debounced (the insight runner is); it reruns the
  simulation on every `tasks` change while the switch is on.
- **`computeAppForecast`** (`forecast/app-forecast.ts`) is the one default run for app surfaces: window
  `DEFAULT_HISTORY_WINDOW`, unit `"tasks"`, `DEFAULT_WHAT_IF`. It returns `{kind: "insufficient"}` (carrying
  the engine's `finished`/`neededFinished`/`days`/`neededDays`) or a
  forecast with `p50`/`p80`/`p95` (null beyond the horizon), `chanceOnTime`, `estimateCoverage`, `windowDays`,
  `distribution`, `trials` and `markers` (working days ahead per percentile, horizon + 1 beyond it).
  `chanceOnTime` is `null` for an invalid plan end, `1` when nothing is open, `0` when the plan end is before
  today, else the share of trials done within the plan's working days (a beyond-horizon trial is never on
  time). ★★ It keeps a SINGLE-ENTRY module memo keyed by reference identity of `tasks`, `milestones`,
  `holidaySet` plus the `planEnd` and `today` strings: a caller must pass the context's OWN references
  unchanged (a `.filter()` copy defeats it and reruns 10,000 trials per render). `milestones` is in the key but
  unused by the result. ★★ `distribution` is the memoised `Int32Array` itself — READ-ONLY; copy before sorting
  or mutating. The Forecast view (`forecast-panel.tsx`) keeps its own settings and says so once, through
  `forecastDashboardDefaultsNote`, when the switch is on and a setting differs from these defaults.
- **Look and explainer.** `SimValue` (`sim-value.tsx`) is the one look for a simulated number (dashed outline,
  `aria-hidden` badge, accessible name `label, simulated`); `SimExplainer` (`sim-explainer.tsx`, a
  `PopoverPanel`) shows the histogram with the P50/P80/P95 cut lines and, given `onOpenHelp`, a link to
  `FORECAST_SIM_HELP_ID` (Help entry `concept-forecast-simulation`). `kind` is `"date"` or `"chance"`; the
  accessible names carry the cell's label so two explainers on one strip stay distinct. Percentile wording
  comes from `percentileWord` (`percentile-words.ts`), never hand-written. `SimulationIntro`
  (`simulation-intro.tsx`) is a non-modal `role="note"`; Escape is "Got it" and is claimed from the switch
  too, because focus stays there after the press. "Show me" also marks it seen (the same functional settings
  write as "Got it") before it opens Help, so the note is gone when the user comes back. Once it was dismissed, the in-pane Help view (`help-view.tsx`)
  offers "Show the simulation introduction again" under the simulation entry (through `HelpContentPane`'s
  `entryActions`): it clears `Settings.simulationIntroSeen` and goes to the Dashboard, where the note shows again
  while the switch is on. The floating Help panel (`help-menu.tsx`) does not offer it. The histogram's accessible
  label names a percentile past `MAX_HORIZON_WORKING_DAYS` as "beyond the horizon", never as horizon + 1 days.
- **KPI cells** (`kpi-simulation.ts`): `kpiSimulation(forecast, spi)` is `null` when the forecast is
  insufficient or P80 is beyond the horizon; `kpiSimulationGap(forecast)` then says which (too few finished
  tasks, named first when both floors are short; too few window days; or beyond the horizon), and the strip
  shows it as one muted, non-sim-styled line. `isDivergent` is true for SPI ≥ 1.0 with chance < 0.5, or SPI <
  0.9 with chance ≥ 0.8 (named constants in the file); the strip then adds a divergence line, always visible.
  `chancePercent` keeps a simulated chance from reading as certainty: one that rounds to 100 but is under 1
  shows `>99%` (DE `> 99 %`), one that rounds to 0 but is over 0 shows `<1%`; exactly 1 and 0 stay 100% and 0%.
  `estimateCoverage` is `null` when nothing is open, and the strip then shows no coverage line.
  Details of the cells and the re-measure are in [`dashboard.md`](dashboard.md) "KPI strip simulation cells".
- ★★ The 7- and 8-cell KPI layouts are unmeasured and not covered by `e2e/dashboard-grid.spec.ts`; the full statement is in
  [`dashboard.md`](dashboard.md) "KPI strip simulation cells". Check the switch and the note by eye and run
  `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` (CI runs it too).
- ★ Switch OFF → no recorder, no simulation prop, no cells, and nothing else on the Dashboard changes.

## Simulation across the app — part 2

Part 2 of the surfaces design (`docs/superpowers/specs/2026-10-15-forecast-simulation-part-2-design.md`) is the
Dashboard picture: a Forecast tile, a chance chip per milestone and a Next-actions signal. Files:
`forecast-tile-model.ts`, `forecast-range-bar.tsx`, `dashboard-sections/dashboard-forecast-tile.tsx`,
`milestone-horizon-strip.tsx`, `next-actions/sim-milestones.ts`; the layout side is in
[`dashboard.md`](dashboard.md) "Forecast tile and milestone chips". Every surface here gates on
`isSimulationActive`, never `isSimulationOn`, and has a held-back test (`showForecastView()` from
`src/test/forecast-view.ts`).

- ★★★ **ONE shared run.** `computeAppForecast` now also returns `milestones` (the engine's per-milestone chances,
  from the same trials). The Dashboard panel runs it ONCE per render set and feeds the KPI strip, the Forecast tile
  and the chips; `use-next-actions.ts` calls it with the same context references, so both hit the single-entry memo
  and the engine runs once. A caller that passes a `.filter()` copy reruns 10,000 trials per surface.
- **The tile** shows the P80 headline, the change since last week, a range bar and the milestones most at risk;
  `weeklyChange` compares today's P80 with the history entry from 7 to 13 days back (`WEEK_BACK_DAYS`,
  `WEEK_BACK_MAX_DAYS`) in working days, and answers `pending` (with the date it becomes available) or `beyond`
  instead of inventing a figure. The comparison and the range bar wear the sim marking; `pending`/`beyond` stay plain.
  ★ `pending`'s date is the earliest entry newer than 7 days back plus 7, or today plus 7 when there is none, so it
  is always after today; entries older than the window never date it. With the Milestones module off the engine still
  runs on the context's milestones (the memo stays shared), but the at-risk section is not rendered at all.
- **The chips** come from `chancesById` over the same run. ONE explainer for the strip, "About these chances"
  (`SimExplainer` `kind="milestone"`: no histogram, the props are a union), shown only when `visibleChipCount` is above
  zero, so a chance hidden behind a bucket's "+N more" cap never leaves an explainer with no chip.
- ★★★ **The Next-actions signal never enters the flat list.** `buildSimMilestoneActions` makes one
  `forecast-sim` action (`SIM_UNLIKELY_BELOW` = 0.5, soon band) per not-achieved milestone under 50 %; `mergeSimActions`
  adds them to the GROUPS after `groupNextActions` (a measured group for the same milestone takes the action as an
  extra reason and keeps its own primary, score and tier; otherwise it forms its own group), sorted with
  `groupNextActions`' own comparators. `computeNextActions`' flat list, and so notifications, the AI context and
  `nowCount`, never hold it; `use-action-learning.ts` skips the source, and a snooze of it does not teach either. It
  offers only Open Forecast and Snooze (`action-cta.ts` drops Create task and Log as RAID for it). It needs the
  Milestones module, as the tile's at-risk section does, and the holidays. Its why-line carries the milestone date
  as an `I18nDateParam` (`{ date }`), which every surface renders through `actionText` (`action-text.ts`, with
  `formatDayMonthYear`), so it reads "Dec 1, 2026" / "1. Dez. 2026", never the ISO string. The steering-committee
  info-pack action (`committee-info.ts`) passes its due date the same way, so the two rows agree (enumerate the
  providers that do with `grep -rn "{ date:" src/app/next-actions/providers`). ★ The Steering committee panel's own
  reminder line (`steering-committee-panel.tsx`, `tPlural` straight from the reminder engine, not from the action)
  still shows the ISO date; it never went through `actionText`. Open Forecast lands on
  `ForecastPanelDeepLinked` (`forecast-panel.tsx`), which scrolls that milestone's row in the chances table into view
  and flashes it (`useDeepLinkRowFlash`), then consumes the request; focus stays on the main region, as for every
  deep-link that opens no editor. ★ Rulings: the group counts in the Soon tier, the Top actions tile
  and the greeting's needs-you count, because it is a Next-actions signal shown with the sim badge; only flat-list
  consumers are excluded.
- ★★ **Holidays pending.** With the switch on and `holidaysReady` false, the panel computes no forecast and the
  simulated slots (KPI cells, tile, chips) are `SimPlaceholder`s: neutral, `aria-hidden`, no text. Off stays untouched.
- ★★ **Restore keeps the switch.** `keepSimulationSwitch` (`forecast-simulation.ts`) pins the version's
  `settingsOverrides` switch to the CURRENT value, because the switch is a viewing choice, not project data. `restore`
  (`use-version-history.ts`) pins AFTER the merge, so the blind-capture guard still sees the version's own `undefined`;
  `prepareVersion` (`use-version-history-wiring.ts`) pins for the vs-now compare view when the version carries
  overrides OR the capture is stamped (format 2 or later, `speaksForEmptySlices`, which the hook passes in): a stamped
  absence means "no overrides". An UNSTAMPED capture's absent overrides stay absent, since setting the key there would
  defeat that guard and blank the other fields.
- **Explainer label rows.** The histogram's P50/P80/P95 labels sit in three rows ABOVE the bars (`CHART_TOP`),
  each label taking the first row with no label within `2 * LABEL_HALF_W`, so three equal or near-equal cut-offs
  (common for a narrow distribution) never overprint.
- **Help.** The "Show the simulation introduction again" action becomes a note ("needs the switch") when the
  switch is off; Help names the new surfaces. `HelpEntryAction` (`help-content-pane.tsx`) is a union: a handler OR
  a note, exactly one, so an action can no longer render as an inert button.
- **The tile's change line and headline.** The weekly change's ▲/▼ sits inside its `SimValue` outline (`glyph`,
  `aria-hidden`). A P80 without a P50 cannot happen (P50 ≤ P80, so a P80 inside the horizon
  means a P50 inside it too); the tile renders nothing for it rather than an empty line. A P50 without a P80 is
  the ordinary beyond-horizon case and shows the gap line.
- ★ Switch OFF → no tile (board or shelf), no chips, no sim action, no recorder; nothing else changes.

## Budget simulation — part 3

Part 3 of the surfaces design (`docs/superpowers/specs/2026-10-15-forecast-simulation-surfaces-design.md`) adds a
simulated COST AT FINISH beside the Budget forecast's calculated one. Held back with the Forecast view like parts 1
and 2; nothing renders or runs while `isSimulationActive` is false. Storage is untouched (nothing new is persisted).

- ★★★ **The calculated figure does not move.** The pace forecast ("at current pace") still drives the Budget health
  dot (`paceVacHealth`), the forecast gap and the export pace leg; the simulation sits BESIDE it. See
  [`budget.md`](budget.md) "The forecast in exports (§545)".
- **The engine is `src/app/forecast/cost.ts`** (i18n-free, React-free). `simulateWhen` now also returns each trial's
  finish day (`trialDays`, a copy taken before the sort; "beyond" = horizon + 1), and `ScheduleForecast` /
  `AppForecast` carry `trialDays` and `windowDates` (the history window's working days). `spendSamples(dated,
  windowDates)` turns the pace forecast's own `dated` values (baseline currency, contract basis, never converted again)
  into per-working-day spend over the SAME window the schedule used (60 working days by default). ★ **First booking** =
  the earliest `date` with a non-zero value ANYWHERE in `dated`, not only in the window; samples start at
  max(window start, first booking), so a booking before the window means every window day is a sample, and a young
  project's idle days before its first booking are not counted as zero spend. A zero entry is not a booking.
  `simulateCostAtFinish` then walks each trial: `ac` plus, for each day `i` from 1 to the trial's finish day, one
  random sample times that day's scale, plus `addedCost[i]` when given. `spendScale` (default 1) is a number (the
  What-if) or a per-day `Float64Array`; `addedCost` is a per-day `Float64Array` booked on top of the drawn spend
  (Scenarios: added people). Both arrays are indexed 1..horizon, and one shorter than horizon + 1 throws a
  `RangeError` rather than turning every cost into NaN.
  ★ Two known biases, both pulling the added spend slightly LOW: the schedule window includes today (usually not yet
  booked, so a zero sample) while the pace forecast's window excludes it, and a weekend or holiday booking counts in
  `ac` but is never a sample (only the window's working days are).
- ★★ **What-if capacity scales spend (Forecast view only).** Capacity is team availability (the scenarios design uses
  it for contractors and holidays), so burn scales with headcount: the Forecast view passes
  `capacityPercent / 100` as `spendScale` through `simulateCostFromRun`. Alone, capacity is therefore about
  cost-neutral (the finish moves one way, spend per day the other); scope is what drives cost. The seed ignores
  `spendScale`, so at 1 every pinned value is unchanged and a scaled run draws the same days. The Dashboard and the
  Budget report pass nothing (the default What-if). ★ If the owner reads capacity as efficiency instead, this is
  the one parameter to drop.
- ★ **Nothing open short-circuits.** When every trial's finish day is 0, the result is `{ kind: "sim" }` with
  P50 = P80 = P95 = `ac` (the chance over budget by `bac`) even below the spend floor: the exact answer needs no
  history.
- ★★ **Beyond trials.** A trial whose finish day is past `MAX_HORIZON_WORKING_DAYS` costs `Infinity`: it counts as over
  budget (`chanceOverBudget`, null when `bac <= 0`) and a percentile that lands on it reads `"beyond"`, never a number.
  Such a trial draws nothing, which is why a capacity extreme is cheap and a finish just inside the horizon is the
  expensive case (see the measured cost below).
- ★★ **The floors.** The cost range needs BOTH the schedule floor (the schedule run is a `"forecast"`, not
  insufficient) and the spend floor: at least `MIN_SPEND_WORKING_DAYS` samples. Below either it is
  `{ kind: "unavailable", reason: "schedule-floor" | "spend-history", spendDays, neededSpendDays }`. With enough
  samples that are ALL zero (bookings exist before the window, none inside it) the reason is `"no-spend"`. The
  missing-input line is worded in ONE place: `costUnavailableText` (`budget-sim-text.ts`; `budgetSimMissingSchedule` /
  `budgetSimMissingSpend` / `budgetSimNoSpend`), used by the pace card, the tile and the Forecast view, which also
  share the P50/P80/P95/chance rows (`costRangeRows`). Not every surface shows it: the change table adds no row when
  the range is unavailable, the pace card shows the sim block only beside an available calculated figure, and the
  Forecast view shows no cost card at all below the schedule floor (its insufficient state already says the history
  is short, so the missing-schedule line would say it twice). `budgetSimNoSpend` says no "yet": that state only
  occurs when bookings exist before the window.
- ★ **The chance over budget never rounds to a certainty.** `formatChanceOverBudget` (`budget-sim-text.ts`), used by
  all three surfaces, shows "<1 %" for 0 < p < 0.005 and ">99 %" for 0.995 ≤ p < 1, the number part from
  `formatShare` in the locale's own format; an exact 0 or 1 stays "0 %" / "100 %".
  `budgetSimMissingSchedule` names no single cause ("not enough finished-task history") because the schedule floor
  also trips on too few history working days.
- **Seeded, one sub-stream per trial.** The base seed is `seedFrom([...samples, ac, bac, seedTag, "cost"])` and trial
  `t` draws from `mulberry32(seedFrom([base, t]))`, so a rerun is identical, EUR and hours draw from different streams
  (`seedTag` "eur" / "hours"), and one trial's finish day never moves another trial's draws: two scenario columns
  that share a tag share every draw of every trial whose finish day agrees. It is separate from the schedule's
  streams, so the cost pass moves no schedule number. Neither `spendScale` nor `addedCost` enters the seed.
- **`src/app/budget-sim.ts`.** `computeBudgetSim(forecast, facts)` returns `BudgetSim` (`finish` P50/P80/P95 dates, and
  `eur` / `hours` `CostAtFinish`), null when the forecast is null (switch off), and `BELOW_SCHEDULE_FLOOR` for both
  units when the run is insufficient; a single-entry memo is keyed on the `forecast` and `facts` identities.
  `withBudgetSim(bundle, forecast)` returns a NEW bundle with `sim` added. `simulateCostFromRun(run, facts, seedTag,
  spendScale = 1, addedCost?)` takes only `{ trialDays, windowDates }` of the run, so the Forecast view can pass its own
  What-if-adjusted run and its capacity. `simulateCostFromRunMemo` (same signature) keys its single entry on the trial
  days and window dates by value, the facts' identity, the tag, and `spendScale` / `addedCost` (a number by value, an
  array by identity, so a rebuilt array is a new input).
- **The bundle.** `ForecastBundle` (`budget-forecast-bundle.ts`) gains `facts` (REQUIRED: the per-unit facts the
  forecasts were built from, via `forecastFactsByUnit`; only the Forecast view's facts come from
  `computeProjectForecastFacts`, in `workspace-section.tsx`) and `sim` (absent, or null, when the simulation is
  off). A new `ForecastBundle` literal in a test needs `facts` (`FIXTURE_FACTS` in `src/test/forecast-bundle-fixture.ts`).
- ★★★ **One shared run, a new caller.** `useAppForecast` (`use-app-forecast.ts`) wraps `computeAppForecast` in a
  `useMemo` and never calls the engine while `active` is false. `workspace-section.tsx` calls it ONCE and feeds both the
  Budget report tab (`simulation` on `BudgetReportPanel`) and Reports (`budgetSimulation`, forwarded to its embedded
  Budget report). `active` = the simulation is active AND the holidays are ready AND the tab is `budget-report` or
  `reports`. The Dashboard's existing run feeds its burn tile through `withBudgetSim`, with no second
  `computeAppForecast`; it calls `withBudgetSim` only while the burn tile is shown (Budget module on and the tile
  on the board), since nothing else on the Dashboard reads `sim`. All callers pass the SAME collection references; `forecast-shared-run.test.tsx` pins it, and a
  `.filter()` copy reruns 10,000 trials.
- **Surfaces.**
  - Pace card (`budget-forecast-cards.tsx`): a block with P50/P80/P95 cost and the chance over budget, plus the P80
    hours, rendered ONLY inside the pace-available branch, i.e. only beside a calculated figure. With no calculated
    figure the card keeps its unavailable message.
  - Burn charts (`burndown-geometry.ts`, `burndown-chart.tsx`): a finish band (P50 to P95), a P80 line and a cost wedge.
    ★ Only when a finish band is drawn (the simulation on AND the run above the schedule floor) does the x domain
    stretch to the simulated finish dates; the end figures then anchor at plan end and the last period label at the
    last period's own end (`model.planned.at(-1).date`, falling back to plan end), not at the stretched right edge.
    A beyond P95 falls back to the domain end computed from the other dates (the last period end, plan end and the
    in-horizon finishes). Below the schedule floor, or with the switch off, the chart is byte-identical to before. A
    beyond P95 draws no cost wedge.
    ★★ **The stretch is capped** (owner-delegated decision): `simDomainCap` ends the domain at most one plan length
    (plan start to plan end; the Dashboard tile and the Budget report pass `planStart`, and without it the chart's
    first date stands in) past the later of the last period end and plan end, so a P95 just inside the horizon (about
    five years out) cannot squeeze the plan into a sliver. A finish past the cap is CLAMPED to it for drawing only:
    `simFinish.from` / `to` / `p80` are the drawn dates, while `p80Date` / `p95Date` keep the real ones and
    `p80PastChart` / `p95PastChart` flag the clamp, so the text alternative names the real dates and adds
    `burndownAriaSimP80PastChart` / `burndownAriaSimP95PastChart` ("… is beyond the chart's end"). The cost wedge
    is drawn only when its P80 date is inside the domain (else left out, like a beyond one); its P80 cost stays in the
    text through `simCostP80`. One computation decides that: the private x-domain helper in `burndown-geometry.ts`,
    which sets `p80PastChart`. ★ A clamped band ends at the plot's right edge, which a sighted reader would take for the
    date, so the chart draws a visible `burndownSimPastChartCue` ("later →", `data-sim-past-chart`, `aria-hidden`)
    at that edge whenever P80 or P95 is clamped (WCAG 1.4.1: words, not colour).
    ★★ **A finish BEYOND the horizon counts as past the chart too** (review fix I1). Its date is null and it is drawn
    at the domain end, which is usually plan end, so without the cue a beyond P80 read as "safe to commit by plan
    end": the most optimistic reading of the most pessimistic state. So `p80PastChart` / `p95PastChart` are true
    for a null date as well, the cue shows, and a beyond P80 draws no wedge. The text alternative still says "beyond
    the horizon" for it and adds no "beyond the chart" (that sentence is guarded on a real `p80Date`).
  - Tile (`burndown-chart-panel.tsx`, compact mode): one line "Cost at finish (P80) … · … chance over budget"; in the
    hours unit it reads "Hours at finish (P80) …" (`burndownSimTileLineHours`), as does the chart's text
    alternative (`burndownAriaSimHours`). When unavailable, the muted missing line. ★ The line changes the tile's
    height, so `budgetSimContentKey` (`budget-sim.ts`: on/off, band drawn, and per unit the range with or without the
    chance or the missing-input reason) is part of the Dashboard's measured-height `contentKey`. ★★ So is
    `simCostContentKey` (`simCostDrawn` for both units): the legend's cost-range entry comes and goes with the
    wedge, and the Dashboard builds no chart model. `simCostDrawn` is defined as `buildChartModel(…).simCost !==
    null`, so EVERY reason the model drops the wedge reaches the key with no second copy of the rule: the cap, a
    beyond P50/P80/P95 cost, a P80 date on or before the last actual point, a beyond P80 finish, a missing range.
    (Until the review fix the key looked at the cap alone, so the other reasons left the tile at a stale height.)
  - ★ Copy decisions (review fixes): the P50/P80/P95 row labels are composed in `costRangeRows` from
    `percentileWord(p)` (`percentile-words.ts`) plus "(Pxx)", so the P95 row reads "Cautious (P95)" / "Vorsichtig (P95)"
    from the `simCautious` key itself, the words the KPI strip and the explainer already use; there is no separate
    per-row key. The chart's text alternative adds
    `burndownAriaSimP95Beyond` when only the P95 finish is past the horizon (`simFinish.p95Beyond`, beside `p80Beyond`),
    so a band edge sitting on P80 is not read as P95 = P80. The hours unit says hours everywhere, including the legend
    (`burndownSimHoursRange`) and the change-table row (`budgetChangeSimRowHours`).
  - Change table (`budget-change-table.tsx`): a footer row "Cost at finish (sim, P50–P95)" ("Hours at finish (sim, P50–P95)" in the hours unit) with the range; ABSENT when
    the range is unavailable (the card and tile say why). Its value cell sits in the running-total column, so it
    carries `headers` naming its own row header alone and is never announced under that column's heading. The
    three pace-split footer rows (performance, added scope, unexplained) sit in the same column and do the same, with
    `useId`-based ids so the table rendering twice on one page cannot collide. ★ Those split rows' `th id` /
    `td headers` are the ONE intentional markup change part 3 makes with the simulation off: a deliberate a11y fix
    (the values were announced under "Added scope to date"), kept. Everything else renders as before part 3 while
    the switch is off. The row label already says "sim", so its `SimValue` passes `labelSaysSim` and the value's
    name is the label alone, not "… (sim, P50–P95), simulated".
  - Forecast view (`forecast-panel.tsx`, `CostTable` in `forecast-tables.tsx`): a cost card computed from the view's OWN
    What-if-adjusted run, so moving scope moves it (capacity scales spend too, so alone it barely moves it; see above). It is hidden when the Budget module is off
    (`budgetEnabled`) and shows "Add a budget" (`budgetSimAddBudget`) only when there are no budget facts at all (no
    buckets). ★ A `bac` of 0 is one rule on every surface: the range shows and only the chance-over-budget row is
    dropped (the engine gives `chanceOverBudget: null` at `bac <= 0`, and `costRangeRows` leaves the row out),
    so the pace card, the tile and the Forecast view agree. The side-by-side wrapper around `PercentileTable` is
    rendered only with the cost card, so the view without one is the markup it always was.
    `workspace-section.tsx` computes its facts (`forecastFactsOn`) only on the Forecast tab with the Budget module on,
    NOT gated on the simulation switch: Scenarios mode sizes added people from the booked hours with the switch off
    too. The cost card and the Scenarios cost rows still need the switch (`showSimulation && budgetEnabled` in the panel).
    ★ A How-many target change rebuilds the run but cannot change a trial day (it draws from its own stream), so the
    view calls `simulateCostFromRunMemo` (`budget-sim.ts`), a single-entry memo keyed on the trial days and window
    dates BY VALUE, and the cost pass does not rerun.
- Every simulated figure is a `SimValue` (the sim marking), except the pace card's P50/P80/P95 rows, which sit inside
  one marked group.

### Measured cost of the cost pass

The extra pass is `simulateCostFromRun` alone, on the main thread, whenever the view's trial days or budget facts change — a
committed What-if change, the history window or unit, a new day, holidays, a task or booking edit (a How-many target change rebuilds the run with the same trial days, which the value-keyed memo
`simulateCostFromRunMemo` answers without a pass). Re-measured 2026-10-17 (after the per-trial cost sub-stream of build step 2) in Node through `vite-node` on a synthetic fixture (200 open tasks, a 60-working-day history
of about 1.33 finished tasks per day, 60 booking days), median of 7 after one warm-up, on a shared machine, four runs of the probe. A probe,
not a gate. The cost is 10,000 trials times the days each draws, so it peaks when finish days sit just inside the
horizon.

| Case | Time |
|---|---|
| Default What-if | about 15 ms (14 to 18) |
| Capacity 10 % (most trials beyond, so they draw nothing) | about 5 ms |
| Scope +300 % | about 50 ms |
| Scope +300 % with capacity 50 % (worst found) | about 95 ms (86 to 99) |

★ The per-trial sub-stream (one `seedFrom` and one `mulberry32` per trial) did NOT double the pass. An A/B in one
process, the 2026-10-16 `cost.ts` (from `git show f851ea902:src/app/forecast/cost.ts`) against today's on the same
run, gave 13 against 16 ms on the default case and 102 to 109 against 102 to 117 ms on the worst one: about 3 ms
more, within noise at the top. The 2026-10-16 table read 13, 2, 56 and about 110 ms.

Reproduce from the repo root (expect noise, a few ms either way; the command deletes the file):

```bash
cat > cost-probe.ts <<'EOF3'
import { computeScheduleForecast, DEFAULT_WHAT_IF, type WhatIf } from "./src/app/forecast";
import { simulateCostFromRun } from "./src/app/budget-sim";
import type { ForecastFacts } from "./src/app/budget-forecast";
import type { Task } from "./src/app/types";
import { workingDaysBefore } from "./src/app/working-days";
const TODAY = "2026-10-14", H: ReadonlySet<string> = new Set();
const days = [...workingDaysBefore(TODAY, 59, H), TODAY];
const mk = (id: number, status: string, completedDate?: string) => ({ id, title: "t", dueDate: "", priority: "Medium", status, completedDate }) as Task;
const tasks = [
  ...Array.from({ length: 200 }, (_, i) => mk(i + 1, "Open")),
  ...days.map((d, i) => mk(10_000 + i, "Done", d)),
  ...days.filter((_, i) => i % 3 === 0).map((d, i) => mk(20_000 + i, "Done", d)),
];
const facts: ForecastFacts = {
  bac: 500_000, ac: 200_000, ev: null, pv: 0, bucketsMissingPercent: [],
  dated: days.map((date, i) => ({ date, bookedFrom: date, value: 800 + (i % 7) * 120, spread: false })),
  planEnd: "2027-06-30", today: TODAY, holidaySet: H, hasFixedPrice: false,
};
const cases: [string, WhatIf][] = [
  ["default", DEFAULT_WHAT_IF],
  ["capacity 10 %", { ...DEFAULT_WHAT_IF, capacityPercent: 10 }],
  ["scope +300 %", { ...DEFAULT_WHAT_IF, scopePercent: 300 }],
  ["scope +300 % cap 50 %", { ...DEFAULT_WHAT_IF, scopePercent: 300, capacityPercent: 50 }],
];
for (const [label, whatIf] of cases) {
  const run = computeScheduleForecast({ tasks, milestones: [], today: TODAY, holidaySet: H, window: 60, unit: "tasks", whatIf, howManyTarget: "2026-12-31" });
  if (run.kind !== "forecast") throw new Error("insufficient");
  simulateCostFromRun(run, facts, "eur");
  const ms: number[] = [];
  for (let i = 0; i < 7; i += 1) { const t0 = performance.now(); simulateCostFromRun(run, facts, "eur"); ms.push(performance.now() - t0); }
  ms.sort((a, b) => a - b);
  console.log(label.padEnd(24), "median", ms[3].toFixed(1), "ms");
}
EOF3
npx vite-node cost-probe.ts; rm cost-probe.ts
```

The Dashboard and the Budget report pay a different pass: `computeBudgetSim` runs BOTH units (eur and hours) on the
shared run whenever the run or the facts change. Re-measured 2026-10-17 the same way (three runs) (the same history and spend, an hours
twin at 1/100, plan end 2027-06-30; a fresh facts object per timing, so the memo never answers), median of 7:

| Case | Time |
|---|---|
| Default (200 open tasks) | about 33 ms |
| Near the horizon (1,700 open tasks, P95 about five years out) | about 250 ms |
| Past the horizon (1,760 open tasks, every trial beyond) | about 17 ms (one run 34) |

Reproduce from the repo root (expect noise; the command deletes the file):

```bash
cat > sim-probe.ts <<'EOF3'
import { computeAppForecast } from "./src/app/forecast/app-forecast";
import { computeBudgetSim } from "./src/app/budget-sim";
import type { ForecastFacts } from "./src/app/budget-forecast";
import type { Task } from "./src/app/types";
import { workingDaysBefore } from "./src/app/working-days";
const TODAY = "2026-10-14", H: ReadonlySet<string> = new Set();
const days = [...workingDaysBefore(TODAY, 59, H), TODAY];
const mk = (id: number, status: string, completedDate?: string) => ({ id, title: "t", dueDate: "", priority: "Medium", status, completedDate }) as Task;
const eur: ForecastFacts = {
  bac: 500_000, ac: 200_000, ev: null, pv: 0, bucketsMissingPercent: [],
  dated: days.map((date, i) => ({ date, bookedFrom: date, value: 800 + (i % 7) * 120, spread: false })),
  planEnd: "2027-06-30", today: TODAY, holidaySet: H, hasFixedPrice: false,
};
const hours: ForecastFacts = { ...eur, bac: 5_000, ac: 2_000, dated: eur.dated.map((d) => ({ ...d, value: d.value / 100 })) };
for (const open of [200, 1700, 1760]) {
  const tasks = [
    ...Array.from({ length: open }, (_, i) => mk(i + 1, "Open")),
    ...days.map((d, i) => mk(10_000 + i, "Done", d)),
    ...days.filter((_, i) => i % 3 === 0).map((d, i) => mk(20_000 + i, "Done", d)),
  ];
  const f = computeAppForecast({ tasks, milestones: [], planEnd: "2027-06-30", today: TODAY, holidaySet: H });
  if (f.kind !== "forecast") throw new Error("insufficient");
  computeBudgetSim(f, { eur: { ...eur }, hours: { ...hours } });
  const ms: number[] = [];
  for (let i = 0; i < 7; i += 1) { const facts = { eur: { ...eur }, hours: { ...hours } }; const t0 = performance.now(); computeBudgetSim(f, facts); ms.push(performance.now() - t0); }
  ms.sort((a, b) => a - b);
  console.log(`open ${open}`.padEnd(12), "p95", f.p95, "median", ms[3].toFixed(1), "ms");
}
EOF3
npx vite-node sim-probe.ts; rm sim-probe.ts
```

## Saved scenarios (build step 2)

A saved scenario is a named list of dated changes (availability, added people, scope) compared with the plan as it
is. The Forecast view gains a third mode, **Scenarios** (beside Quick and What-if), showing As is plus every saved
scenario on one shared axis: range bars, a compared table (P50/P80/P95 finish, chance on time by plan end, and, when the
cost rows are on, cost at finish P80 and the chance over budget) and the milestone chances. Spec:
`docs/superpowers/specs/2026-10-16-forecast-scenarios-and-ai-tool-design.md` (§4.1–§4.3, §4.5); the AI tool (§4.4)
is not built. Held back with the view like parts 1–3.

| File | Owns |
|---|---|
| `forecast-scenarios.ts` | the types, the limits (`MAX_FORECAST_SCENARIOS` 4, `MAX_SCENARIO_CHANGES` 20, `SCOPE_TASKS_MAX` 1000 and the rest), `sanitizeForecastScenarios` (read side), `validateScenarioChange` / `validateScenarioDraft` (write side), the immutable list ops, `whatIfToScenarioChanges` |
| `forecast/day-index.ts` | `simulatedDates` (index 0 = today, length horizon + 1), `dayOnOrAfter`, `dayOnOrBefore` |
| `forecast-added-people.ts` | `teamHoursPerDay`, `onTeamResourceIds`, `shiftFor`, `changeDayWindow`, `resolveAddedPeople`; the `ScheduleContext` and `ScenarioDirectory` types |
| `forecast-scenario-schedule.ts` | `buildScenarioSchedule`: a change list as per-day `capacityByDay`, `spendScale`, `addedCost`, the scope arrivals and one status per row |
| `forecast-scenario-compare.ts` | `computeScenarioComparison` (As is + every scenario), `computeScenarioColumn`, `buildScheduleContext`: the ONE place a column is computed (the coming `get_forecast` tool is to call it too) |
| `use-forecast-scenarios.ts` | the per-entity CRUD hook: create, update, rename, delete, activity log, undo |
| `forecast-scenarios-view.tsx`, `forecast-scenario-tables.tsx` | the Scenarios mode and its two tables |
| `forecast-scenario-editor.tsx`, `forecast-scenario-change-rows.tsx`, `forecast-scenario-name-dialog.tsx` | the editor (a `Modal`), its rows, and the rename / Save-as-scenario name dialog |
| `forecast-insufficient.tsx` | the insufficient-history state, shared by the view and a column |

- **The engine input.** `computeScheduleForecast` takes optional `changes: DatedScheduleChanges` (`capacityByDay`
  plus `arrivals`), which REPLACES the What-if's scope and capacity. `capacityByDay` goes through the per-day
  drawer of "Simulation" (`dayDrawer`, with `bestBetween` as the prefix-sum bound of the early exits).
  `buildScenarioSchedule` builds it: the availability rows MULTIPLY into a team factor clamped to 0.1–3 (that
  clamped product is also `spendScale`, so delivery and spend scale alike, as the What-if capacity does); the
  added people's shares are added AFTER the clamp; scope rows become arrivals on `dayOnOrAfter(on)`, clamped to the
  horizon. Every per-day array is horizon + 1 long (index 0 unused); a shorter one throws a `RangeError` in the
  drawer and in the cost pass (pinned by "arrays are dates.length long (horizon + 1) and index 0 stays unused" and
  "a per-day array shorter than the horizon is refused rather than read as NaN").
- **Arrivals.** `buildArrivals` turns the base backlog plus the dated steps into `arrivedAt[d]`, clamped at zero
  after each step. When: `done(d) = min(done(d − 1) + draw(d), arrivedAt[d])` (work cannot be delivered before it
  arrives), and a trial finishes on the first day at or after the LAST addition (`lastPositiveDay`) with all
  arrived work done; a trial done before an addition resumes when it arrives. How many delivers at most what has
  arrived, and a trial done on or after the last addition reports `arrivedAt[days]`. The certain-beyond exit
  compares against `suffixMin`, the least work that can be open on any day it could still finish. Pinned by
  "work cannot be delivered before it arrives", "How many counts only arrived work" and "the certain-beyond exit
  stays exact with arrivals" (`simulate.test.ts`), and "a later scope arrival never makes any trial finish
  earlier" (`index.test.ts`). In the effort unit an arrival of N tasks is N × the median estimate.
- ★★ **Milestone attribution.** A scope row may name an attributable milestone (`isAttributableMilestone`: not
  achieved, valid date); one naming any other, or one deleted since, counts as unattributed, and its row reads
  "milestone gone". Milestones are ordered by the key (base queue position, date). An attributed addition moves
  its milestone (position and own work, so both figures) and every milestone whose key comes after it; an
  unattributed change moves no milestone. A milestone counts only changes dated on or before its own date: a later
  arrival does not move it, except that an ADDITION to the milestone itself after its date makes it unreachable
  (chance 0). ★ Owner decision 2026-10-17: a milestone with NO open linked tasks that gets net added work is placed
  in the queue by its date, at the largest base position of the milestones with open tasks dated on or before it,
  so only milestones after it move ("scope on a milestone with no open linked tasks is placed by its date").
  Overdue stays overdue whatever is attributed.
- ★★ **The own-work clamp (Task 2 ruling).** An attributed REMOVAL comes off that milestone's remaining work and
  stops at zero (`clampAttributedRemovals`, in day order from `ownWorkToday`). It lowers the totals (the backlog
  When simulates, and the caps) only by the CLAMPED amount, what really came off, never the raw amount; the raw
  amount made a later milestone unreachable. Pinned by "an attributed removal lowers the backlog and the cap only
  by what came off its milestone" (`index.test.ts`) and "an attributed removal stops at the milestone's own work".
- ★★ **Each milestone has its own cap.** The cap is the base plus every ADDITION; unattributed removals come off the
  queue's end, so they cap no milestone. Each milestone's cap is then lowered only by the attributed removals that
  move THAT milestone, so a removal on a later milestone never caps an earlier one ("a removal on a later
  milestone does not cap an earlier one", "the early exits stay exact with a cap per milestone").
- ★★★ **Common random numbers (spec §4.5, owner).** Two columns differ only by their changes, and a scenario
  with no changes shows exactly the As-is numbers ("a scenario with no changes shows exactly the As-is
  numbers"). Three mechanisms together: the schedule seed leaves out the What-if and the changes ("Seed"), every
  trial consumes a fixed number of draws ("Simulation"), and the cost pass draws each trial from its own
  sub-stream with one tag, `"eur"`, for every column (part 3's "Seeded" bullet). Drop any one and the columns
  stop being comparable.
- **Added people** (`forecast-added-people.ts`). Delivery is added at the current team's throughput per booked hour:
  a row's share on a day is its hours that day × the ramp ÷ the team's hours per day. **Team hours** =
  booked hours on the history window's days ÷ the number of window days (zero days included), from the hours
  facts; with no hours facts, too few samples, all zero or under 1 h a day the row is inert with "needs booked
  hours". This is why `workspace-section.tsx` builds the facts with the switch off too (part 3, "Forecast view").
  **On the team**: a person in any bucket's allocations, or the resource of a task finished inside the window, is
  inert ("use an availability change"); the editor offers them as a disabled option. **Ramp** is linear over
  `rampWeeks` × 5 working days counted from the stored `from`, so a start in the past keeps its progress;
  `rampWeeks` 0 is full speed at once. A directory person's hours follow their Shift's weekday proportions
  (`shiftFor`, the join `buildResourceWorkload` uses) and are zero on their absences; a placeholder is count ×
  hours, spread over Mon–Fri. **Cost** is booked from day one, not ramped, as `addedCost` on top of the drawn
  spend: a directory person at their role's internal rate (no role or no rate: 0, "no rate"; an external
  person: 0, "external", delivery without cost); a placeholder at its own rate converted to the baseline
  currency with `currencyToBase`, at par when no exchange rate resolves ("at par"). Rows over twice the team
  (`addedShareAtFullSpeed` > 1, counting only rows that apply on at least one simulated day) show the "more than
  double the team" warning.
- ★★ **Archived is not gone (Task 11 ruling).** An ARCHIVED person (`active === false`) on a stored row is still
  sized and counted, and the row says "archived — still counted in the forecast"; only a resource that no longer
  exists is "person gone" (inert). A NEW pick of an archived person is refused, as is a new pick of a gone or
  on-team one. ★ An unchanged stored reference is kept on save: a row whose milestone or person reference is the
  one the stored row had is accepted and keeps its "milestone gone" / "person gone" mark; only a newly chosen or
  changed reference is validated (spec §4.1 / §4.1a over the brief; "saves its stale references unchanged after
  an unrelated name edit, each row still marked", "only an unchanged stored reference is kept").
- ★ **Refused saves say why.** The hook refuses a write without a toast by design; the editor, the rename dialog
  and Save as scenario then show the reason in the dialog and stay open (Save as scenario does not switch modes):
  "a refused write keeps the editor open with its reason", "a create refused after open keeps the dialog open
  with the reason and stays in What-if".
- **A column with no work left reads chance on time 1**, even past plan end: the same "nothing open" rule as
  `computeAppForecast` (Task 8 ruling; "a scenario that removes every open task is on time even past the plan
  end").
- **Persistence.** `Workspace.forecastScenarios` is a **meta-blob** slice on all six write paths (no
  `TABLE_NAMES` entry), storage-only (emitted only when `config === undefined`), byte-stable when absent, sanitised
  on read (`sanitizeForecastScenarios`: bad rows dropped, values clamped, an unknown resource id KEPT because undo
  can bring the person back). It is applied by `applyWorkspaceFromLoad` (always replace) and NOT by
  `applyRestoredWorkspace`, so a version restore keeps today's scenarios (owner, 2026-10-17; see
  [`activity-log.md`](activity-log.md)). `counted: false` in `workspace-slice-policy.ts`, so it is not in
  `isWorkspaceEmpty`. Ids come from the session minter (`mintId`, kind `forecastScenario`). Every create, edit,
  rename and delete is one activity-log entry; edits, renames and deletes are one undo entry each, creates are not
  captured ([`undo.md`](undo.md) "Creates"). Pins: `forecast-scenarios-persistence.test.ts`.
- ★ **The 4-cap is a CREATION rule**, checked first by `validateScenarioDraft` (no edit can fix it). The sanitizer
  does not enforce it, so a stored list is never truncated, and undoing a delete at the cap restores a fifth
  scenario ("undoing a delete at the cap restores a fifth scenario"); New scenario and Save as scenario are then
  disabled with the reason. Owner decision 2026-10-17: keep it this way (a deleted scenario is never lost); the
  comparison then runs one extra forecast per scenario past four (spec §5.3).
- ★★ **Save as scenario** turns the clamped What-if into an availability row from today with no end (when capacity
  ≠ 100) and, only when it is non-zero, one unattributed scope row on today of `scopeTasks` + round-half-up(open ×
  `scopePercent` / 100). It
  caps that row at ±1,000 tasks (`SCOPE_TASKS_MAX`; the What-if allows 1,000 plus a percent on top) and the name
  dialog says so ("the note says when the scope was capped at 1,000 tasks"). **Exact parity with What-if holds in
  the tasks unit only** ("Save as scenario shows what What-if showed (tasks unit)"): in effort mode the What-if
  takes the percent of the effort sum, while a scenario sizes each added task at the median estimate, so the two
  can differ.
- **Performance.** Scenarios mode runs As is + the saved scenarios (at most five forecasts) once per input or list
  change, only while the mode is shown; the panel skips its own Quick/What-if run and cost pass in that mode, and
  nothing runs for scenarios on the Dashboard. Measured 2026-10-17 in Node through `vite-node`, on the synthetic
  fixture of "Measured cost of the cost pass" below (200 open tasks, 60-working-day history, eur and hours facts)
  plus one role and one resource, `computeScenarioComparison` with four scenarios, median of 7 after one warm-up,
  on a shared machine: four runs of the probe by the implementer and one by the reviewer, so each row gives the
  spread seen. A probe, not a gate (table below).

| Case (As is + 4 scenarios) | Time |
|---|---|
| Four empty scenarios, cost on | about 235 to 280 ms |
| The What-if extremes as scenarios (availability 10 %; scope +600 tasks; availability 300 % + scope +600; two added placeholders of 20 × 60 h), cost on | about 600 to 800 ms |
| The same, cost off | about 510 to 700 ms |

★★ This is a main-thread pause of up to about 0.6 to 0.8 s per input or list change while Scenarios mode is shown,
well above the spec's "budget ≈ 100 ms" for one run, and it is not a gate; the levers are a worker (register §748) or
fewer trials. (The single-run figure in "Performance", about 600 ms, is a different fixture and case:
`sample-workspace-huge.json`, capacity 10 % + scope +500 % + a horizon How-many target. It is not comparable with
this table.)
Reproduce from the repo root (expect noise; the command deletes the file):

```bash
cat > scenario-probe.ts <<'EOF4'
import { computeScenarioComparison, type ScenarioRunInput } from "./src/app/forecast-scenario-compare";
import type { ForecastScenario } from "./src/app/forecast-scenarios";
import type { ForecastFacts } from "./src/app/budget-forecast";
import type { Resource, Role, Task } from "./src/app/types";
import { workingDaysBefore } from "./src/app/working-days";
const TODAY = "2026-10-14", H: ReadonlySet<string> = new Set();
const days = [...workingDaysBefore(TODAY, 59, H), TODAY];
const mk = (id: number, status: string, completedDate?: string) => ({ id, title: "t", dueDate: "", priority: "Medium", status, completedDate }) as Task;
const tasks = [
  ...Array.from({ length: 200 }, (_, i) => mk(i + 1, "Open")),
  ...days.map((d, i) => mk(10_000 + i, "Done", d)),
  ...days.filter((_, i) => i % 3 === 0).map((d, i) => mk(20_000 + i, "Done", d)),
];
const eur: ForecastFacts = {
  bac: 500_000, ac: 200_000, ev: null, pv: 0, bucketsMissingPercent: [],
  dated: days.map((date, i) => ({ date, bookedFrom: date, value: 800 + (i % 7) * 120, spread: false })),
  planEnd: "2027-06-30", today: TODAY, holidaySet: H, hasFixedPrice: false,
};
const hours: ForecastFacts = { ...eur, bac: 5_000, ac: 2_000, dated: eur.dated.map((d) => ({ ...d, value: d.value / 100 })) };
const role = { id: 1, disciplineId: 1, gradeId: 1, internalRate: 90, externalRate: 120 } as Role;
const resource = { id: 1, name: "Pat", roleId: 1, active: true } as unknown as Resource;
const directory = { resources: [resource], roles: [role], shifts: [], absences: [], budgets: [], fxRates: null, workdayHours: 8, baseCurrency: "EUR" as const };
const base = (costOn: boolean): ScenarioRunInput => ({ tasks, milestones: [], today: TODAY, holidaySet: H, window: 60, unit: "tasks", planEnd: "2027-06-30", directory, budgetFacts: { eur, hours }, costOn });
const s = (id: number, changes: ForecastScenario["changes"]): ForecastScenario => ({ id, name: "s" + id, changes });
const empty = [1, 2, 3, 4].map((id) => s(id, []));
const placeholder = { label: "Contractors", count: 20, rate: 80, currency: "EUR" as const, hoursPerWeek: 60 };
const extremes = [
  s(1, [{ kind: "availability", percent: 10, from: TODAY, until: "" }]),
  s(2, [{ kind: "scope", tasks: 600, on: TODAY }]),
  s(3, [{ kind: "availability", percent: 300, from: TODAY, until: "" }, { kind: "scope", tasks: 600, on: TODAY }]),
  s(4, [{ kind: "addPeople", who: placeholder, from: TODAY, until: "", rampWeeks: 4 }, { kind: "addPeople", who: { ...placeholder, label: "More" }, from: TODAY, until: "", rampWeeks: 4 }]),
];
for (const [label, input, list] of [["four empty scenarios", base(true), empty], ["What-if extremes, cost on", base(true), extremes], ["What-if extremes, cost off", base(false), extremes]] as const) {
  computeScenarioComparison(input, list);
  const ms: number[] = [];
  for (let i = 0; i < 7; i += 1) { const t0 = performance.now(); computeScenarioComparison(input, list); ms.push(performance.now() - t0); }
  ms.sort((a, b) => a - b);
  console.log(label.padEnd(28), "median", ms[3].toFixed(1), "ms");
}
EOF4
npx vite-node scenario-probe.ts; rm scenario-probe.ts
```

- ★★ **The Scenarios-mode axe scan runs in CI only after un-hide.** `e2e/forecast-scenarios.spec.ts` (one test: the editor
  with one row of each kind, then the comparison, failing on critical or serious violations with the tags of
  `e2e/a11y.spec.ts`) is `test.skip` while `"forecast"` sits in `RELEASE_HIDDEN_VIEWS`, so CI skips it. It ran
  ONCE locally on 2026-10-17 with the view un-hidden in the working tree only (1 passed, no critical or serious
  violations; it needed `skipTour`, as `a11y.spec.ts` does). Run it again when the view ships:
  `PORT=3100 npx playwright test e2e/forecast-scenarios.spec.ts --project=chromium --workers=1`. Until then CI covers the
  editor and the comparison by their unit tests only.

## The AI tool (§502)

The assistant side is in `docs/AGENTS/ai-assistant.md`, "Forecast tools (§502)"; this section is what the FORECAST
owns. `get_forecast` returns one JSON report (`buildForecastReport`, `forecast-ai-report.ts`, type `ForecastReport`):
`simulated: true`, the `settings` it ran with (history window, tasks unit, `FORECAST_TRIALS` trials, baseline
currency, plan end, today), the `asIs` column, `weeklyChange`, one entry per saved scenario (id, name,
`expectedToken`, its `changes`, a `result` column and per-row `rows` statuses), and an optional `whatIf` column for the
call's own draft. A column is either `status: "forecast"` (P50/P80/P95 as ISO dates or `"beyond"`, `chanceOnTime`,
every milestone with a chance or an `overdue` / `no-linked-tasks` state, and cost) or `status: "insufficient"` with
the engine's reason, which the prompt tells the model to quote rather than estimate around.

★★ COMMON RANDOM NUMBERS HOLD. The report computes nothing of its own: it reshapes `computeScenarioComparison` and runs
the draft through `computeScenarioColumn`, so every column shares the comparison's streams, and a `whatIf` equal to a
saved scenario reproduces that scenario's column exactly. Do not give the report a seed or run of its own. ★ The run is
always the app DEFAULTS (`DEFAULT_HISTORY_WINDOW`, tasks), not the toolbar, so a figure the model quotes can differ
from the one on screen.

★ All three tools refuse with `HOLIDAYS_LOADING_MESSAGE` while the holiday calendar loads: the forecast input getter in
`use-chat-dispatcher-wiring.ts` returns null until `holidaysReady`, and `useForecastTools` turns that into the refusal. A
run on an unsettled calendar would quote dates the loaded one moves. They refuse with `FORECAST_OFF_MESSAGE` when the
simulation is off.

★★ ONE COMPARISON PER RENDER: in Scenarios mode `ForecastPanel` computes the scenario comparison once (a `useMemo`
over the comparison's inputs; null outside Scenarios mode) and passes it to `ForecastScenariosView` as `comparison`;
the Ask-Claude menu reads the worst milestone from it too, with no second run.

Chips: `ForecastAskClaude` (`forecast-ask-claude.tsx`) is a menu of Ask-Claude prompts that send the user to the chat.
The set depends on the mode: an explain prompt always; a milestone prompt naming the worst milestone of the run ON
SCREEN (`worstMilestoneName`; As is in Scenarios mode; absent with no run or when no milestone carries a chance); and
compare and suggest prompts in Scenarios mode. Enumerate them with `grep -n "forecastAsk.*Label" src/app/i18n.ts`.

★★ KNOWN LIMITATION: a scenario written in the same assistant turn as the milestone or person it names is refused
("does not exist"); see `ai-assistant.md`. It fails closed.

## Mutation proof (slice 1)

Four mutants for the slice, run one at a time, each turned red by its own test:

| Mutant | File | Killing test | Message |
|---|---|---|---|
| backlog filter keeps Cancelled (`!isTaskClosed` replaced by `status !== "Done"`) | `forecast/index.ts` | "Cancelled tasks are not in the backlog" | expected 4 to be 3 |
| next-working-day shift dropped in `attributedDay` | `forecast/throughput.ts` | "moves a Saturday completion to Monday" (and the holiday and after-today tests) | expected +0 to be 1 |
| coverage comparison `>=` changed to `>` in `resultUnit` | `forecast/index.ts` | "effort at 70% coverage is honoured, unestimated tasks count at the median" | expected 'tasks' to be 'effort' |
| first instead of last open linked task for the queue position in `milestoneChances` | `forecast/milestones.ts` | "a milestone waits for the LAST of its open linked tasks in the queue, not the first" | deep-equal failure (chance 1 instead of 0) |

Two more from the final-review fix wave, each killed by a test added for it:

| Mutant | File | Killing test | Message |
|---|---|---|---|
| floor-only rounding in `drawDay` (`return whole;`) | `forecast/simulate.ts` | "stochastic rounding averages to the fraction, both ways (T2b)" | expected [ +0, +0, … ] to include 1 |
| `overdue` checked before all-closed in `milestoneChances` | `forecast/milestones.ts` | "overdue with every linked task closed reads 1/1, not overdue (T3b)" | expected { state: 'overdue' } to deeply equal { state: 'chance', … } |

★ The floor-only mutant passed the older "integer: true stochastic-rounds to whole numbers" test, whose
`2 ≤ v ≤ 4` bound a floor still meets.

★ The fourth mutant SURVIVED until that test was added: no earlier test linked a milestone to two open
tasks at different queue positions.

The pre-PR fix-all round (2026-10-14), each mutant applied alone and reverted:

| Mutant | File | Killing test |
|---|---|---|
| the When early exit skips one day too few | `forecast/simulate.ts` | "the certain-beyond early exit gives exactly the days of walking every trial to the horizon" |
| best day taken as the whole part only (drops the round-up) | `forecast/simulate.ts` | the same, on the 0.7 capacity case |
| a whole sample's rounding draw dropped, not skipped | `forecast/simulate.ts` | "the hoisted drawer draws the plain formula's values from the same stream, both units" |
| the all-reached or none-reachable milestone exit skips one day too few; the two bounds swapped | `forecast/milestones.ts` | "the early exits (all reached, none reachable) give exactly the chances of walking to the last day" |
| `skip(n)` jumps `n − 1` | `forecast/rng.ts` | "skip(n) leaves the stream exactly where n draws would" |
| a shift past today counts on `today` again (dropped when today is off) | `forecast/throughput.ts` | "a shift that would pass today counts on the window's last working day, never dropped" |
| `windowCutAt` always `null`; `"all"` flagged as cut; `<=` for `<` | `forecast/index.ts`, `forecast/throughput.ts` | "the days floor bites on a fixed window too (R14)", the cut-window panel tests, the T1c test |
| tasks amount without `tPlural`, or without the unit word | `forecast-tables.tsx` | "tasks carry the unit word with a real singular …" and the panel's amount tests |
| the toolbar shown the raw What-if instead of `usedWhatIf` | `forecast-panel.tsx` | "a committed scope removal shows the clamped value the forecast uses once tasks close (M8)" |

★ Two survivors, both equivalent: `<=` for `<` in `cannotReach` (the `FLOAT_SLACK` factor makes an exact
tie unreachable in practice), and handing the engine the raw What-if instead of `usedWhatIf` (the engine
runs the same `clampWhatIf`, which is idempotent).

## Hiding the Forecast view hides part 1's surfaces

★★ Every part-1 simulation surface is gated on `isSimulationActive(overrides, features)`
(`forecast-simulation.ts`) = `isViewEnabled("forecast", features)` AND the stored switch, so a release that
hides the Forecast view cannot show simulated numbers with no view behind them. The gated surfaces: the
simulated KPI cells and the intro (`dashboard-panel.tsx`), the daily recorder
(`use-forecast-history-recorder.ts`, fed `features` by `useInsightLifecycle`), and the Help entry
`FORECAST_SIM_HELP_ID` with its reopen action (`help-view.tsx`, via `HelpContentPane`'s `hiddenEntryIds`).
★ Part 2's surfaces are gated the same way: the Dashboard Forecast tile (`TileGateInput.simulationActive`, so it leaves
the board and the shelf but keeps its stored placement), the milestone chips and their explainer, and the Next-actions
signal (`use-next-actions.ts`). `isSimulationOn` stays the RAW stored read for the writer: the stored value is never touched, so showing the
view again restores the user's choice. A new part-1 surface must read the helper, never `isSimulationOn`.
★ The two WRITER surfaces are the exception, because they must show the switch while it is off: the burn-tile
switch (`dashboard-panel.tsx`) and the Edit project "Forecasting" field (`project-edit-modal.tsx`, wired in
`workspace-section.tsx`) gate on `isViewEnabled("forecast", features)` alone (plus not-popout) and write
from the raw `isSimulationOn`. The burn-tile switch's pressed state reads `isSimulationActive`, which equals
the raw value wherever that switch renders; the Edit project field seeds from the raw value.
★ `HelpContentPane` has TWO hosts (`help-view.tsx` and the floating `help-menu.tsx`); both pass
`hiddenHelpEntryIds(features)`, which also filters search hits and Related links. `help-icon-button.tsx` and
`view-callouts.ts` resolve concept ids straight from `HELP_ENTRIES`, so a new link to the simulation entry from
either bypasses the gate and must check `isSimulationActive` / `isViewEnabled` itself.
