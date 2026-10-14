# Monte Carlo schedule forecast (§502, slice 1)

The Forecast view under Reports answers three questions from the project's own completion history:
**When** does the open work finish (P50/P80/P95), **How many** tasks (or minutes) fit by a chosen date,
and what is each milestone's **chance** of landing on its date. Slices 2–5 (saved scenarios, Dashboard
tile, Gantt marker, AI tool) are open — see §502 in [`../open-followups.md`](../open-followups.md).
Reproduce the file list: `ls src/app/forecast`.

## Module map

The engine lives in `src/app/forecast/` and is PURE and i18n-free: it returns numbers and codes, never
text. The view is flat in `src/app/` (`forecast-panel.tsx` orchestrates; `forecast-toolbar.tsx`,
`forecast-chart.tsx` and `forecast-tables.tsx` present). It reuses `forecast-format.ts` (the budget
forecast's formatter) rather than owning a formatter of its own.

| File | Owns |
|---|---|
| `forecast/constants.ts` | `FORECAST_TRIALS` (10,000), `MIN_FINISHED_TASKS` (10), `MIN_HISTORY_WORKING_DAYS` (10), `EFFORT_MODE_MIN_COVERAGE` (0.7), `MAX_HORIZON_WORKING_DAYS` (1300), `HISTORY_WINDOWS`, `DEFAULT_HISTORY_WINDOW` (60) |
| `forecast/rng.ts` | `mulberry32` (seeded PRNG) and `seedFrom` (FNV-1a over the parts joined by `\|`) |
| `forecast/throughput.ts` | `dailyThroughput`: completions per working day, zero days kept; `isValidIsoDate` (strict `YYYY-MM-DD`) |
| `forecast/simulate.ts` | `SimOptions`, `drawDay`, `simulateWhen`, `simulateHowMany`, `percentile` |
| `forecast/milestones.ts` | `orderBacklog`, `milestoneChances` |
| `forecast/index.ts` | `computeScheduleForecast`: floor, backlog, effort mode, what-if, streams; `lastForecastableDay` (the How-many horizon) |

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
  samples, the window, the unit and the three what-if numbers, so the same project state gives the same
  numbers on every render and machine.
- **Separate streams (R5).** `stream(name)` derives one `mulberry32` per output — `"when"`, `"howMany"`,
  `"milestones"` — from `seedFrom([...seedParts, name])`. No figure depends on whether another ran first.
- **Floor.** With at least one open task, fewer than `MIN_FINISHED_TASKS` completions inside the window,
  or fewer than `MIN_HISTORY_WORKING_DAYS` window days, returns `kind: "insufficient"` carrying the
  shortfall and `doneWithoutDate`. A project with NO open task skips the floor (R3): it still runs
  `milestoneChances`, where all-closed reads 100 %, no linked tasks reads `no-linked-tasks`, and overdue
  needs an open task.
- ★★ **The floor reads the backlog BEFORE the what-if** (`open.length > 0`, not the post-what-if
  `backlog`). A What-if scope of −100 % empties the simulated backlog but not the real one; reading the
  simulated one let How-many and the milestone chances (which use the real linked tasks, and read 0 %
  on an empty history) render with no history at all. Pinned by "a what-if that empties the backlog
  still needs the history floor" in `index.test.ts`.
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
- **Next-working-day shift.** A completion on a non-working day counts on the NEXT working day
  (`attributedDay`), capped at `today` (dropped when `today` is itself non-working and the shift passes it).

## Simulation

- **`SimOptions` (R1).** `{ trials, rng, capacity, horizon, integer }`. `integer: true` is the tasks unit:
  each simulated day is stochastically rounded to whole tasks. `integer: false` is effort: the fraction
  is kept.
- **`drawDay` (R2)** is the one place a simulated day is drawn (bootstrap sample × capacity, rounded when
  `integer`). `simulateWhen`, `simulateHowMany` and `milestoneChances` all call it, so the rounding rule
  lives once. An empty history draws 0.
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
- ★ **Scope does not move milestone chances (R9).** What-if scope is aggregate and changes When and How
  many only; `milestoneChances` keeps the real linked tasks, because added scope cannot be attributed to a
  milestone. Capacity DOES reach all three (it scales `drawDay`).

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
date outside them with `forecastInputInvalid` (R15). The default window is 60 working days; the
axe spec selects **"All history" (R13)** and waits for the chart so axe sees the forecast state, not
only the empty state.

- **No Ask-Claude chips (R12).** `forecast` has no prompt chips until slice 4: no read tool exists, so a
  chip could not be answered. A test in `ask-claude-prompts.test.ts` pins the absence; the feature guide
  tells the AI not to quote the Forecast.
- Percent strings go through i18n keys (EN `{0}%`, DE `{0} %`; R10).

## Performance

The engine runs on the main thread, in the panel's render-time `useMemo`, on every input change. There
is no worker. Measured 2026-10-14 after the How-many backlog cap, in Node through `vite-node`, on
`sample-workspace-huge.json` (repo root: 270 tasks, 100 open, 60 milestones), at 10,000 trials, the
default window 60 and `today` 2026-10-14. Each figure is the median of 5 runs after one warm-up, on a
shared machine. It is a probe, not a benchmark gate:

| Case | Median |
|---|---|
| Default call (How-many target 2026-11-01) | 21 ms |
| How-many target at the horizon (`lastForecastableDay`) | 33 ms |
| Capacity 10 % + scope +500 % + horizon target | 382 ms |
| The same, plus one milestone dated at the horizon | 929 ms |

★★ **The everyday case is fast; the extremes the What-if allows are NOT.** At 10 % capacity every When
trial runs to the 1,300-day horizon (`beyond`), and a milestone at the horizon makes `milestoneChances`
walk the same distance. So the What-if fields can stall a render for around a second on a large
project. Before the cap, the horizon target alone cost about 220 ms (the pre-PR review's probe), because
How-many drew every day up to the target. Reproduce from the repo root (single runs, so expect noise;
delete the file afterwards):

```bash
cat > forecast-probe.ts <<'EOF'
import { readFileSync } from "node:fs";
import { computeScheduleForecast, lastForecastableDay, DEFAULT_WHAT_IF } from "./src/app/forecast/index";
const ws = JSON.parse(readFileSync("sample-workspace-huge.json", "utf8"));
const today = "2026-10-14", holidaySet = new Set<string>(), max = lastForecastableDay(today, holidaySet);
const open = ws.tasks.filter((t: { status: string }) => t.status !== "Done" && t.status !== "Cancelled");
const far = [...ws.milestones, { id: 999999, name: "far", date: max, linkedTaskIds: [open[open.length - 1].id] }];
const extreme = { scopeTasks: 0, scopePercent: 500, capacityPercent: 10 };
for (const over of [{}, { howManyTarget: max }, { howManyTarget: max, whatIf: extreme }, { howManyTarget: max, whatIf: extreme, milestones: far }]) {
  const t0 = performance.now();
  computeScheduleForecast({ tasks: ws.tasks, milestones: ws.milestones, today, holidaySet, window: 60, unit: "tasks", whatIf: DEFAULT_WHAT_IF, howManyTarget: "2026-11-01", ...over });
  console.log(Math.round(performance.now() - t0), "ms");
}
EOF
npx vite-node forecast-probe.ts; rm forecast-probe.ts
```

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
