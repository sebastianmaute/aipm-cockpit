# Monte Carlo forecast (§502) — design

**Status:** approved in brainstorming 2026-10-14. This spec records the whole decision (five slices) and
specifies **slice 1** in full. Slices 2–5 each get their own spec, plan and PR.

**Register:** §502 (work item #41). Stays OPEN until slice 5 ships.

## 1. Intent

A customer asked three times — calling it their strongest functional ask — for Monte Carlo forecasting with scenarios
and confidence levels, because project reality is neither linear nor exponential; he cited ActionableAgile's
"Monte Carlo: How Many". Today the schedule forecast is not a forecast at all (`forecastEndDate` in
`snapshot.ts` is the latest due date of open work) and the budget forecast is a straight line from the last
20 working days (`budget-forecast.ts`).

**Success:** a project manager can say "we finish by 12 Nov with 80% confidence, and go-live has a 64% chance
— 85% if we put its tasks first", see where that number came from, and change the inputs to ask "what if".

## 2. Decisions (all slices)

| Decision | Choice |
|---|---|
| What is forecast | Schedule AND budget, one shared sampling engine |
| Schedule throughput unit | Tasks finished per working day (default); effort per day offered when ≥ 70% of open tasks carry an estimate |
| Scenario modes | Quick (fixed P50/P80/P95) · What-if (transient inputs) · Scenarios (named, saved, side by side) — one `SegmentedControl` |
| Questions | When (open work done) · How many (by a date) · per-milestone chance |
| Queue order | Due-date order by default, plus an "if prioritised" column (milestone's tasks first) |
| Thin history | Floor; below it an empty state says what is missing, no number |
| Sampling | Daily bootstrap: each simulated working day draws one real past working day's count, with replacement |
| Surfaces | Own Forecast view · Dashboard tile · Gantt P50/P80 marker · Reports section · Budget report (budget percentiles) |
| AI and exports | `get_forecast` read tool · a "Forecast (P80)" line in status/steering reports · print and PDF |

## 3. Slices

| # | Slice | Depends on |
|---|---|---|
| 1 | Engine + Forecast view: Quick and What-if, When / How many / milestone chance, history floor | — |
| 2 | Dashboard tile, Gantt marker, Reports section | 1 |
| 3 | Saved Scenarios — a new persisted `Workspace` field across all SIX write paths | 1 |
| 4 | `get_forecast` AI tool, status/steering report line, print and PDF | 1 |
| 5 | Budget Monte Carlo on the Budget report | 1 and §476 (peer branch touches `budget-forecast.ts` and `budget-burndown.ts`) |

Slices 1–4 touch no file on the §476 branch. Ping the peer before branching slice 5.

---

## 4. Slice 1 — engine

Pure, i18n-free, no React, in `src/app/forecast/`. The engine returns codes and numbers, never text.

### 4.1 Files

- **`rng.ts`** — `mulberry32(seed: number): () => number`, plus `seedFrom(parts: readonly (string | number)[]): number`
  (a stable string hash). The seed is derived from the inputs (open task ids, the throughput samples, the
  what-if inputs), so the same data always yields the same numbers: stable renders, stable tests, and no
  `Math.random` in a render body (lint-banned).
- **`throughput.ts`** — `dailyThroughput(args): ThroughputHistory`. One sample per working day in the window,
  counting tasks with `status === "Done"` whose `completedDate` falls on that day. Effort mode sums
  `originalEstimateMinutes` instead. Working day = `isWorkingDay(iso, holidaySet)` (`working-days.ts`).
  Zero days are kept — they are real.
- **`simulate.ts`** — `simulateWhen(samples, backlog, trials, rng)` returns the sorted working-day count each
  trial needed; `simulateHowMany(samples, days, trials, rng)` returns the sorted completed amount after
  `days` working days. Percentiles are index reads on the sorted arrays.
- **`milestones.ts`** — `milestoneChances(…)`, see 4.4.
- **`index.ts`** — `computeScheduleForecast(input: ScheduleForecastInput): ScheduleForecastResult`, where the
  result is `ScheduleForecast | { kind: "insufficient"; finished: number; neededFinished: number; days: number; neededDays: number }`.

### 4.2 Constants

| Name | Value |
|---|---|
| `FORECAST_TRIALS` | 10 000 |
| `MIN_FINISHED_TASKS` | 10 |
| `MIN_HISTORY_WORKING_DAYS` | 10 |
| `HISTORY_WINDOWS` | 30 · 60 · 90 working days · all |
| `DEFAULT_HISTORY_WINDOW` | 60 |
| `EFFORT_MODE_MIN_COVERAGE` | 0.7 (share of open tasks with `originalEstimateMinutes`) |
| `MAX_HORIZON_WORKING_DAYS` | 5 years of working days (≈ 1 300) |
| Percentiles | P50 · P80 · P95 |

### 4.3 Inputs and rules

- **History window:** the last N working days ending today (inclusive), or all working days from the first
  `completedDate` to today. Floor: ≥ `MIN_FINISHED_TASKS` counted completions AND ≥ `MIN_HISTORY_WORKING_DAYS`
  working days in the window; otherwise `kind: "insufficient"`.
- **Backlog:** open tasks, `!isTaskClosed(task)` (`task-closed.ts`) — Cancelled excluded, overdue included.
  An empty backlog returns "done today" at 100% and skips the floor check.
- **Effort mode:** available only when coverage ≥ `EFFORT_MODE_MIN_COVERAGE`. Unestimated open tasks count at
  the median `originalEstimateMinutes` of the estimated open tasks.
- **What-if scope:** ± tasks or ± percent of the backlog (in effort mode, added tasks count at the median
  estimate). Clamped to −backlog … +1 000 tasks, or −100 % … +500 %.
- **What-if capacity:** percent multiplier on each sampled day, clamped 10 % … 300 %. Fractional output is
  rounded once per day by stochastic rounding drawn from the same seeded generator.
- **Horizon:** a trial still unfinished at `MAX_HORIZON_WORKING_DAYS` is recorded as "beyond"; the result
  carries the share of beyond trials, and a percentile that lands on one is reported as beyond.

### 4.4 Milestone chance

- **Due-date order:** open tasks sorted by `dueDate` (blank last), then priority, then id. A milestone's
  queue position = index (1-based) of its last open linked task in that order. Its chance = the share of
  trials whose cumulative completions reach that position by the milestone's date (working days from today).
- **If prioritised:** position = number of open linked tasks.
- **States:** achieved (`achievedDate` set) → skipped. All linked tasks closed → 100 %. No linked tasks →
  `"no-linked-tasks"`, no percent. Date before today, not achieved, open linked tasks → `"overdue"`, no
  percent. Linked ids that resolve to no task are ignored.
- **Effort mode:** positions become cumulative effort up to and including the last linked task.

### 4.5 Data edge cases

- `status === "Done"` without `completedDate` (a split pair survives load, see `docs/AGENTS/task-status.md`):
  excluded from throughput; the result carries the count for the caption.
- `completedDate` invalid or after today: ignored.
- Completed on a weekend or holiday: counted on the next working day; a completion today counts today.
- Jira-synced tasks need no special case — `completedDate` already holds Jira's resolution date.

---

## 5. Slice 1 — Forecast view

- **Nav:** new `AppView` `"forecast"`, a child of Reports beside `budget-report` (`nav-config.ts`); label keys
  in EN and DE; a Help entry. Not Turso-only (tasks only), so it joins axe's `A11Y_VIEWS`.
- **Panel split:**
  - `forecast-panel.tsx` — orchestrator: reads tasks, milestones, holidays and today; holds mode and inputs
    in state; computes in a `useMemo`. What-if number inputs commit on blur or Enter, not per keystroke.
  - `forecast-toolbar.tsx` — mode `SegmentedControl` Quick / What-if (no Scenarios segment until slice 3);
    unit `SegmentedControl` Tasks / Effort, disabled below coverage with the reason as its description;
    history-window select; in What-if, labelled scope and capacity inputs; then the trailing
    Print · reset group per the toolbar order convention.
  - `forecast-chart.tsx` — SVG histogram of finish dates per working week with a cumulative curve, P50/P80/P95
    as vertical lines each carrying a text label (never colour alone), one scale for marks and ticks, palette
    tokens only, `role="img"` with a summary `aria-label`.
  - `forecast-tables.tsx` — percentile table (When as dates; How many as counts by a target date whose input
    defaults to the next unachieved milestone, else the plan end, else today + 30 working days) and the
    milestone table (name · date · chance · chance if prioritised · gap) on `SortResizeTh` with row-unique names.
- **Empty state:** "4 of 10 finished tasks — 6 more needed" plus the working-day shortfall.
- **Formatting:** existing date formatting and time zone. Percent as whole numbers; a sub-certain 100 shows as
  "≥ 99 %". Caption: "10 000 runs of your last 60 working days (34 finished tasks)", plus the Done-without-date
  count and the beyond share when non-zero.
- **States:** no background writer, so the load hold needs nothing extra; read-only in popouts; today from the
  existing today hook (rolls at midnight).
- **Performance:** measure once on `sample-workspace-huge.json` while implementing and record the result in the
  plan ledger; budget ≈ 100 ms. Above it, `FORECAST_TRIALS` drops to 5 000. No timing assertion in tests.

## 6. Slice 1 — testing

- **Engine:** seeded percentiles against hand-checked values; floor boundaries (9/10 tasks, 9/10 days); Cancelled
  excluded and Done-without-date excluded, each in a fixture where it changes the answer; weekend/holiday
  shift; clamps; horizon "beyond"; milestone due-date vs prioritised; overdue and no-linked-tasks states;
  empty backlog.
- **Mutation:** the Cancelled filter, the next-working-day shift, the 70 % threshold and the milestone queue
  position must each be killed by its own test's message. The count goes in the PR.
- **UI:** RTL for mode switch, disabled effort toggle with description, empty state, milestone columns,
  row-unique names; `expectButtonOrder` for the toolbar.
- **Gates:** `forecast` in `A11Y_VIEWS` and a local axe run on it; coverage floors over `src/app/forecast/`;
  `size:check`.

## 7. Slice 1 — docs

- `docs/AGENTS/forecast.md` (engine, seed, floor, queue rule), linked from the AGENTS.md subsystem table.
- §502 status: slice 1 shipped, slices 2–5 open.
- CHANGELOG entry, Help entry, user-guide paragraph.

## 8. Out of scope for slice 1

Saved scenarios, Dashboard tile, Gantt marker, Reports section, AI tool, report line, print/PDF of the view
beyond the toolbar Print button, and anything budget.
