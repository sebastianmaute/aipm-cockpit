# Monte Carlo schedule forecast (§502, slice 1)

The Forecast view under Reports answers three questions from the project's own completion history:
**When** does the open work finish (P50/P80/P95), **How many** tasks (or minutes) fit by a chosen date,
and what is each milestone's **chance** of landing on its date. Part 1 of the surfaces design
(`docs/superpowers/specs/2026-10-15-forecast-simulation-surfaces-design.md`) adds the Dashboard
Show-simulation switch (`SettingsOverrides.forecast`) and a daily recorder that persists
`Workspace.forecastHistory` (a meta-blob on all six write paths). It replaced the old slices 2 and 5;
part 2 (the Dashboard picture, below) is built; saved scenarios, the AI tool and parts 3–4 are open — see §502 in [`../open-followups.md`](../open-followups.md).
Reproduce the file list: `ls src/app/forecast`.

★★ **HELD BACK FROM THE RELEASE.** `"forecast"` sits in `RELEASE_HIDDEN_VIEWS` (`feature-modules.ts`), so
`isViewEnabled` answers false for it in every mode: no sidebar entry, no Reports sub-tab, a `#forecast` hash
is ignored, a stale active tab is redirected, `workspace-section.tsx` renders nothing for it, Help draws no
"Go to Forecast" link and `e2e/a11y.spec.ts` skips its scans. The code and its unit tests stay live. To ship
it: drop it from that list, then put back what the hiding commit took out of the user-facing text — find it
with `git log -S RELEASE_HIDDEN_VIEWS --oneline` — namely its CHANGELOG "Added" entry, the Forecast
sentence of `helpSecReportsBody` (EN and DE) and its lines in `lib/app-feature-guide.md` (then run
`node scripts/gen-operating-guide.mjs`), and re-measure the scan count in `e2e/a11y.spec.ts`.
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
| `forecast/simulate.ts` | `SimOptions`, `dayDrawer` (with `drawDay` over it), `cannotReach`, `simulateWhen`, `simulateHowMany`, `percentile` |
| `forecast/milestones.ts` | `orderBacklog`, `milestoneChances` |
| `forecast/index.ts` | `computeScheduleForecast`: floor, backlog, effort mode, what-if, streams, the fixed trial count; `lastForecastableDay` (the How-many horizon) |

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

- **`SimOptions` (R1).** `{ trials, rng, capacity, horizon, integer }`. `integer: true` is the tasks unit:
  each simulated day is stochastically rounded to whole tasks. `integer: false` is effort: the fraction
  is kept.
- **`dayDrawer` (R2)** is the one place a simulated day is drawn (bootstrap sample × capacity, rounded when
  `integer`); `drawDay` is a one-shot wrapper over it. `simulateWhen`, `simulateHowMany` and
  `milestoneChances` all take their `draw` from it, so the rounding rule lives once. It hoists the
  per-sample arithmetic out of the loop and skips (rather than computes) the rounding draw of a whole
  sample, which can never round up; the values and the stream are those of the plain formula (pinned by
  "the hoisted drawer draws the plain formula's values from the same stream, both units"). An empty
  history draws 0.
- ★★ **Early exits are EXACT, because the stream can jump.** A trial stops drawing once its outcome is
  certain — When: even the best possible day (`dayDrawer`'s `max`) every remaining day cannot reach the
  backlog (`cannotReach`), so it is `beyond`; milestones: every milestone still ahead is already reached,
  or none can be — and then calls `skipDays`, which jumps the stream (`mulberry32`'s `skip`, its state
  only adds a constant per draw) to where drawing those days would have left it. So every later trial
  draws the same numbers and every result is unchanged: on the four probe cases below plus three more
  (effort, capacity 300 %), the result digests before and after are identical at the same trial count.
  Pinned against plain full-walk reference loops by "the certain-beyond early exit gives exactly the
  days of walking every trial to the horizon" (`simulate.test.ts`) and "the early exits (all reached,
  none reachable) give exactly the chances of walking to the last day" (`milestones.test.ts`). An rng
  without `skip` draws and drops instead. ★ Never add an exit that does not skip its draws: it shifts the
  stream for every later trial and changes the numbers.
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
machine). The levers left are a worker, or fewer trials; the owner decided against both (see "Trial count").
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
  `DEMO_AS_OF`, computed by the real engine over the tasks as they stood on each day, and its open milestones link
  tasks so the demo shows one milestone below 50 %, one borderline and one safe. ★ The demo shift moves whole
  months, so `buildDemoWorkspace` drops entries that land after the real today. `scaleWorkspace` copies the
  series unreplicated, so the big and huge samples' live forecast does not match it. The switch stays OFF in the data.
- **The recorder** (`use-forecast-history-recorder.ts`) is called from inside `useInsightLifecycle`, not from
  `task-manager.tsx` (no size-ratchet headroom). It writes only when the switch is on AND `hydrated`,
  not `isPopout`, not `loadPending` (§548), `holidaysReady` and the forecast is sufficient. ★★★ WHETHER to
  write is decided against THIS TAB's own memory (a `useRef`), not against the stored entry alone. The five
  rules are numbered in the file header; in short: ON SHARED STORAGE ONLY (`isSharedStorage`: Turso, SharePoint,
  the Turso portfolio), a day change with every input unchanged writes nothing (an idle device must not write the
  new day over a revision another device already moved, spec §4.1); nothing stored for today writes; a stored entry EQUAL to the
  computed one writes nothing; a stored entry this tab has not SEEN (a peer wrote it since the tab's last run),
  or a tab with no baseline for today, ADOPTS it without writing; otherwise (the stored entry is the one the tab
  last saw and differs) it writes only when its OWN computed entry differs from its baseline. The stored-only
  compare it replaced let two tabs that compute different entries (per-device holidays, an old and a new build)
  overwrite each other for ever, since `forecastHistory` is broadcast between tabs. Pinned by "two clients
  with different holiday sets write once per day" in `use-forecast-history-recorder.test.ts` (one write in total
  when the second client comes up after the first recorded; two open across midnight are the "rule 1 applies on
  shared storage only" tests). ★ On browser storage and a local file an idle tab DOES record the new day (only
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
  Milestones module, as the tile's at-risk section does, and the holidays. ★ Rulings: the group counts in the Soon tier, the Top actions tile
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
  switch is off; Help names the new surfaces.
- ★ Switch OFF → no tile (board or shelf), no chips, no sim action, no recorder; nothing else changes.

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
