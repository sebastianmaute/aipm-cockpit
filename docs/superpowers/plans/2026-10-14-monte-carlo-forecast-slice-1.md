# Monte Carlo Forecast — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A seeded Monte Carlo schedule forecast (When · How many · milestone chance) and a Forecast view under Reports with Quick and What-if modes.

**Architecture:** A pure, i18n-free engine in `src/app/forecast/` bootstraps daily task throughput from completed tasks and returns codes and numbers. A new `"forecast"` `AppView` (child of Reports) renders an orchestrator panel split into toolbar, chart and tables, fed from `workspace-section.tsx` like `change-report`.

**Tech Stack:** TypeScript, React 19, Next.js (read `node_modules/next/dist/docs/` before touching routing), vitest + RTL, Playwright axe.

**Spec:** `docs/superpowers/specs/2026-10-14-monte-carlo-forecast-design.md` — sections 4–7 are slice 1. Read it before any task.

## Global Constraints

- Branch `feat/502-monte-carlo-schedule`, worktree `C:/Projects/aipm-cockpit-wt40`. Never touch `C:/Projects/aipm-cockpit-2`.
- `src/app/**` files are CRLF in the working tree: edit with the Edit tool or node; never `sed -i`. New files: write CRLF (check with `git ls-files --eol <file>` after `git add` → `w/crlf`).
- `i18n.de.ts` edits only by a node utf8 script with `\r\n` anchors and real umlauts; EN/DE key sets identical (tsc enforces).
- Commits: cite §502, no `Claude-Session:` trailer, no URLs, no `Closes #`. Never `--amend`; commit with explicit paths.
- Before each commit: `npx eslint --max-warnings=0 <changed files>; echo EXIT=$?` and `npx tsc --noEmit; echo EXIT=$?` — exit 0 and zero errors in total. Never read an exit code through a pipe.
- Vitest: targeted files only, under the guarded lock: `if mkdir /c/Projects/.vitest-lock 2>/dev/null; then npx vitest run <files> > <scratch>/v.log 2>&1; echo EXIT=$?; rm -rf /c/Projects/.vitest-lock; else echo LOCKED; fi`. Never delete a lock you did not create; never two runs at once. No full suite, e2e or build locally except the one axe run in Task 6.
- No `Math.random`, `Date.now()` or `new Date()` in the engine or a render body; `today` comes in as a `YYYY-MM-DD` prop.
- Palette tokens only (`globals.css`); icons only from `src/app/icons.ts`; shared primitives (`SegmentedControl`, `Button`, `SortResizeTh`) — no hand-rolled toggles or sort headers.
- Engine constants (spec 4.2): `FORECAST_TRIALS = 10000`, `MIN_FINISHED_TASKS = 10`, `MIN_HISTORY_WORKING_DAYS = 10`, `HISTORY_WINDOWS = [30, 60, 90, "all"]`, `DEFAULT_HISTORY_WINDOW = 60`, `EFFORT_MODE_MIN_COVERAGE = 0.7`, `MAX_HORIZON_WORKING_DAYS = 1300`, percentiles `[50, 80, 95]`.
- File-size LIMIT 1600 lines (`scripts/check-file-sizes.mjs`); never run `size:check --update`.

## Review Focus

1. **Holidays not loaded yet** (`useHolidaySet().ready === false`): the forecast must still render (weekends excluded) and recompute when the set arrives — pinned in Task 5 ("recomputes when holidaySet changes").
2. **A project where every recent day is zero** (team paused for 60 working days but 10+ older completions): window 60 yields `finished < 10` → insufficient, while "all" forecasts — pinned in Task 4.
3. **Backlog far larger than history supports** (1 000 open tasks, 0.1/day): every trial hits the horizon; percentiles report "beyond", no hang — pinned in Task 2 and Task 4.
4. **Milestone due today**: 0 working days ahead; chance = share of trials with ≥ position completions on day 0, i.e. only an already-satisfied position (0 open linked) scores — pinned in Task 3.
5. **What-if scope that empties the backlog** (−100 %): result is "done today" at 100 %, not insufficient — pinned in Task 4.

---

### Task 1: Seeded RNG and daily throughput

**Files:**
- Create: `src/app/forecast/rng.ts`, `src/app/forecast/throughput.ts`, `src/app/forecast/constants.ts`
- Test: `src/app/forecast/rng.test.ts`, `src/app/forecast/throughput.test.ts`

**Interfaces:**
- Produces:
  - `constants.ts`: every constant from Global Constraints, plus `type HistoryWindow = 30 | 60 | 90 | "all"`, `type ForecastUnit = "tasks" | "effort"`.
  - `mulberry32(seed: number): () => number` — returns floats in [0, 1).
  - `seedFrom(parts: readonly (string | number)[]): number` — FNV-1a 32-bit over `parts.join("|")`, unsigned.
  - `type ThroughputHistory = { samples: number[]; days: string[]; finished: number; doneWithoutDate: number }`
  - `dailyThroughput(args: { tasks: readonly Task[]; today: string; window: HistoryWindow; holidaySet: ReadonlySet<string>; unit: ForecastUnit }): ThroughputHistory`

**Rules `dailyThroughput` must implement (spec 4.3, 4.5):**
- Counts only `status === "Done"` with a valid `YYYY-MM-DD` `completedDate` ≤ `today`. Done without `completedDate` → `doneWithoutDate += 1`. Cancelled never counts.
- A completion on a non-working day is attributed to the next working day (`nthWorkingDayAfter(d, 1, holidaySet)`); if that lands after `today` it is attributed to `today` only when `today` is a working day, else dropped. A completion on `today` counts on `today` when `today` is a working day.
- Window days: N working days ending at `today` inclusive when `today` is a working day (`[...workingDaysBefore(today, N - 1, hs), today]`), else `workingDaysBefore(today, N, hs)`. `"all"`: every working day from the earliest attributed completion to the window end.
- `unit: "effort"` sums `originalEstimateMinutes ?? 0` per day instead of counting; `finished` still counts tasks.
- `finished` = completions that landed inside the window.

- [ ] **Step 1: Write failing tests.** `rng.test.ts`: same seed → identical first 5 values; different seeds differ; 10 000 draws all in [0,1) with mean within 0.49–0.51; `seedFrom(["a",1])` stable across calls and ≠ `seedFrom(["a",2])`. `throughput.test.ts` (holidaySet with one weekday holiday):
  - `"counts Done tasks per working day and keeps zero days"` — 3 completions over a 5-day window → `samples` sums to 3, length 5, contains a 0.
  - `"excludes Cancelled tasks"` — a Cancelled task with `completedDate` in the window → not counted (fixture where otherwise sum would differ).
  - `"counts Done-without-date separately"` → `doneWithoutDate === 1`, not in `samples`.
  - `"moves a Saturday completion to Monday"` and `"moves a holiday completion to the next working day"`.
  - `"ignores invalid and future completedDate"`.
  - `"effort unit sums originalEstimateMinutes"`.
  - `"window 'all' starts at the first completion"`.
- [ ] **Step 2: Run them; expect FAIL (module not found).**
- [ ] **Step 3: Implement the three files** using `isWorkingDay`, `workingDaysBefore`, `nthWorkingDayAfter` from `../working-days`.
- [ ] **Step 4: Run; expect PASS.** Lint + tsc as in Global Constraints.
- [ ] **Step 5: Commit** — `feat: seeded rng and daily throughput for the Monte Carlo forecast (§502)`.

### Task 2: Simulation (When and How many)

**Files:**
- Create: `src/app/forecast/simulate.ts`
- Test: `src/app/forecast/simulate.test.ts`

**Interfaces:**
- Consumes: `mulberry32`, constants.
- Produces:
  - `type SimOptions = { trials: number; rng: () => number; capacity: number /* 0.1–3 */; horizon: number }`
  - `simulateWhen(samples: readonly number[], backlog: number, o: SimOptions): { days: Int32Array /* sorted asc; horizon+1 = beyond */; beyondShare: number }`
  - `simulateHowMany(samples: readonly number[], days: number, o: SimOptions): Float64Array /* sorted asc */`.
  - `percentile(sorted: ArrayLike<number>, p: number): number` — nearest-rank: index `ceil(p/100 * n) - 1`.

**Rules:** each simulated day draws `samples[floor(rng() * samples.length)]`, multiplies by `capacity`, then stochastic-rounds (`floor(x) + (rng() < frac ? 1 : 0)`) — in tasks unit only; effort unit keeps the fraction. `backlog <= 0` → every trial is 0 days. A trial still short after `horizon` days records `horizon + 1`.

- [ ] **Step 1: Failing tests.**
  - `"constant throughput of 2/day finishes 10 tasks in exactly 5 days"` — samples `[2]`, all `days` === 5.
  - `"empty backlog finishes on day 0"`.
  - `"same seed gives identical results"`.
  - `"all-zero history hits the horizon and reports beyond"` — samples `[0]`, `beyondShare === 1`, `percentile(days, 50) === horizon + 1`.
  - `"capacity 0.5 roughly doubles the days"` — samples `[2]`, backlog 10, seeded; P50 in 9–11.
  - `"how many after 5 days at 2/day is 10"`.
  - `"percentile uses nearest rank"` — `percentile([1,2,3,4,5,6,7,8,9,10], 80) === 8`.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** with typed arrays; sort with `.sort()` on the typed array.
- [ ] **Step 4: Run; expect PASS.** Lint + tsc.
- [ ] **Step 5: Commit** — `feat: Monte Carlo When and How-many simulation (§502)`.

### Task 3: Milestone chance

**Files:**
- Create: `src/app/forecast/milestones.ts`
- Test: `src/app/forecast/milestones.test.ts`

**Interfaces:**
- Consumes: `simulate.ts` internals are NOT reused; this file runs its own trials with the same `SimOptions` so one pass per trial yields the day each cumulative position is reached.
- Produces:
  - `type MilestoneChance = { id: number; state: "chance"; chance: number; chancePrioritised: number } | { id: number; state: "overdue" | "no-linked-tasks" }`
  - `orderBacklog(open: readonly Task[]): Task[]` — `dueDate` asc (blank last), then priority desc by `PRIORITIES` index (`Urgent` first), then `id` asc.
  - `milestoneChances(args: { milestones: readonly Milestone[]; ordered: readonly Task[]; sizeOf: (t: Task) => number; samples: readonly number[]; today: string; holidaySet: ReadonlySet<string>; o: SimOptions }): MilestoneChance[]`

**Rules (spec 4.4):** achieved milestones are omitted. Linked ids not in `ordered` and not among closed tasks are ignored. No linked ids at all → `no-linked-tasks`. All linked tasks closed → `chance: 1, chancePrioritised: 1`. `date < today` with open linked tasks → `overdue`. Target position (due-date order) = cumulative `sizeOf` through the last open linked task; prioritised position = sum of `sizeOf` over open linked tasks. Days available = number of working days in `(today, date]`, i.e. `countWorkingDays(addCalendarDays(today, 1), addCalendarDays(date, 1), hs)` — the same day count `simulateWhen` uses, where day 1 is the first working day after today. A trial meets the position if cumulative completions after that many days ≥ position. Chance = met trials / trials.

- [ ] **Step 1: Failing tests.**
  - `"orders by due date, blank last, then priority, then id"`.
  - `"prioritised chance is at least the due-date chance"` — milestone whose single linked task is last of 20; samples `[1]`; date 5 working days out → chance 0, prioritised 1.
  - `"due today with an open linked task is 0"` and `"due today with all linked tasks closed is 1"`.
  - `"overdue milestone has no percent"`, `"milestone with no linked tasks reports no-linked-tasks"`, `"achieved milestone is omitted"`, `"dangling linked id is ignored"`.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; expect PASS.** Lint + tsc.
- [ ] **Step 5: Commit** — `feat: Monte Carlo milestone chance, due-date and prioritised order (§502)`.

### Task 4: `computeScheduleForecast` (floor, backlog, effort mode, what-if, seed)

**Files:**
- Create: `src/app/forecast/index.ts`
- Test: `src/app/forecast/index.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `type WhatIf = { scopeTasks: number; scopePercent: number; capacityPercent: number }` (defaults `0, 0, 100`); `clampWhatIf(w: WhatIf, backlog: number): WhatIf` per spec 4.3 (scope tasks −backlog…+1000, percent −100…+500, capacity 10…300).
  - `type ScheduleForecastInput = { tasks: readonly Task[]; milestones: readonly Milestone[]; today: string; holidaySet: ReadonlySet<string>; window: HistoryWindow; unit: ForecastUnit; whatIf: WhatIf; howManyTarget: string /* YYYY-MM-DD */; trials?: number }`
  - `type ScheduleForecast = { kind: "forecast"; unit: ForecastUnit; backlog: number; when: { p: 50|80|95; daysAhead: number | "beyond"; date: string | null }[]; howMany: { p: 50|80|95; amount: number }[]; milestones: MilestoneChance[]; distribution: Int32Array /* simulateWhen's sorted days, for the chart */; beyondShare: number; finished: number; windowDays: number; doneWithoutDate: number; trials: number }`
  - `type ForecastInsufficient = { kind: "insufficient"; finished: number; neededFinished: number; days: number; neededDays: number; doneWithoutDate: number }`
  - `type ScheduleForecastResult = ScheduleForecast | ForecastInsufficient`
  - `effortCoverage(open: readonly Task[]): number` (share with `originalEstimateMinutes > 0`; 0 when no open tasks).
  - `computeScheduleForecast(input: ScheduleForecastInput): ScheduleForecastResult`

**Rules:** backlog = `!isTaskClosed` tasks, plus what-if scope (tasks, then percent of the original backlog, rounded half-up), floored at 0. Empty backlog → `kind: "forecast"` with all `when` at `daysAhead: 0, date: today` and every unfinished-milestone chance 1, floor skipped. Else floor check (`finished ≥ 10 && windowDays ≥ 10`). Effort unit requested while coverage < 0.7 → compute in tasks unit and set `unit: "tasks"` (the UI disables the toggle; this is the defensive fallback). Effort size of an unestimated open or added task = median estimate of the estimated open tasks. `date` = `nthWorkingDayAfter(today, daysAhead, hs)` (`today` when 0), `null` when beyond. How many uses working days in `(today, howManyTarget]`. Seed = `seedFrom([...open ids sorted, ...samples, window, unit, whatIf.scopeTasks, whatIf.scopePercent, whatIf.capacityPercent])`.

- [ ] **Step 1: Failing tests.**
  - `"returns insufficient below 10 finished tasks"` (9) and `"forecasts at exactly 10 finished and 10 days"`.
  - `"a paused team is insufficient for window 60 but forecasts for all"` (Review Focus 2).
  - `"scope -100% empties the backlog and finishes today"` (Review Focus 5).
  - `"huge backlog reports beyond without hanging"` (Review Focus 3) — 1 000 open, history of mostly zeros; `when[0].daysAhead === "beyond"`, `date === null`.
  - `"effort requested under 70% coverage falls back to tasks"` and `"effort at 70% coverage is honoured"` (boundary).
  - `"same input gives the same percentiles; changing capacity changes them"`.
  - `"Cancelled tasks are not in the backlog"` — fixture where counting them changes `backlog`.
  - `"clampWhatIf clamps every field"`.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all `src/app/forecast/*.test.ts`; expect PASS.** Lint + tsc.
- [ ] **Step 5: Performance probe (not a test).** In a scratch script (session scratchpad, never the repo), load `src/app/__fixtures__`/the `-huge` sample workspace (`grep -rn "sample-workspace-huge" src e2e scripts` to find the path), call `computeScheduleForecast` with window `"all"` and record the wall time of 5 runs in the report. If the median exceeds 100 ms, set `FORECAST_TRIALS = 5000` and say so in the report and the commit body. Superseded 2026-10-14 (owner decision): the forecast always runs 10,000 trials; see docs/AGENTS/forecast.md 'Trial count'.
- [ ] **Step 6: Commit** — `feat: computeScheduleForecast with history floor, effort mode and what-if (§502)`.

### Task 5: Forecast panel components

**Files:**
- Create: `src/app/forecast-panel.tsx`, `src/app/forecast-toolbar.tsx`, `src/app/forecast-chart.tsx`, `src/app/forecast-tables.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (all new strings, prefix `forecast`)
- Test: `src/app/forecast-panel.test.tsx`, `src/app/forecast-tables.test.tsx`

**Interfaces:**
- Consumes: Task 4's exports.
- Produces: `ForecastPanel(props: { lang: Lang; tasks: Task[]; milestones: Milestone[]; plan: ResourcePlan; today: string; holidaySet: ReadonlySet<string>; isPopout?: boolean })`.

**Behaviour (spec 5):**
- State: `mode: "quick" | "whatif"`, `unit`, `window` (default 60), `whatIf`, `howManyTarget` (default: earliest unachieved milestone date ≥ today, else `plan.endDate` when ≥ today, else `nthWorkingDayAfter(today, 30, hs)`). Quick mode passes `{0,0,100}` regardless of stored what-if values.
- Result in one `useMemo` over the input object; what-if number inputs are local drafts that commit on blur/Enter, invalid → revert to last valid and show `forecastInputInvalid` beside the field.
- Toolbar order: mode `SegmentedControl` · unit `SegmentedControl` (disabled below coverage; `title` = `forecastEffortUnavailable` with the coverage percent) · window `<select>` with a `<label>` · (What-if only) scope tasks, scope %, capacity % inputs each labelled · trailing group: Print (absent in Electron, follow existing panels) · reset-size. Assert with `expectButtonOrder(..., { contiguous: true })` for the trailing group.
- Chart: weekly buckets (5 working days) of `ScheduleForecast.distribution`, beyond trials in a final "> 5 y" bucket, cumulative polyline, three labelled percentile lines, `role="img"` + `aria-label` from `forecastChartSummary` ("P50 {0}, P80 {1}, P95 {2}").
- Tables: percentile table (When date or `forecastBeyond` "> 5 y"; How many count); milestone table columns name · date · chance · chance if prioritised · gap, via `SortResizeTh` with `nameContext`; row-unique names via the existing row-token helper. Chance format: whole percent; `< 1` but rounding to 100 → "≥ 99 %"; `overdue` → `forecastOverdue`; `no-linked-tasks` → `forecastNoLinkedTasks`.
- Empty state for `insufficient`: `forecastInsufficient` "{0} of {1} finished tasks — {2} more needed" and, when days fall short, `forecastInsufficientDays`.
- Caption: `forecastBasis` "{0} runs of your last {1} working days ({2} finished tasks)" (window "all" → `forecastBasisAll`), plus `forecastDoneWithoutDate` and `forecastBeyondShare` when non-zero.

- [ ] **Step 1: Failing tests** (`forecast-panel.test.tsx`, `lang="en-US"`, fixture workspace built in the test):
  - `"shows the empty state below the history floor"`.
  - `"Quick ignores what-if values; What-if shows scope and capacity inputs"`.
  - `"effort toggle is disabled with a reason under 70% coverage"`.
  - `"an invalid capacity reverts and shows the message"`.
  - `"recomputes when holidaySet changes"` (Review Focus 1) — rerender with a holiday on a counted day changes the caption's day count or a percentile.
  - `"toolbar keeps the trailing group contiguous"` via `src/test/toolbar-order.ts`.
  - `forecast-tables.test.tsx`: `"milestone rows have unique accessible names"`, `"overdue and no-linked-tasks show text, not a percent"`, `"a 0.996 chance renders as ≥ 99 %"`.
  - One DE assertion with `loadI18n("de")` in `beforeAll` for the empty-state string.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement components and strings** (DE via node utf8 script, `\r\n` anchors, real umlauts).
- [ ] **Step 4: Run; expect PASS.** Lint + tsc (tsc checks EN/DE parity).
- [ ] **Step 5: Commit** — `feat: Forecast panel with Quick and What-if modes (§502)`.

### Task 6: Wire the `"forecast"` view

**Files:**
- Modify: every non-test file that names `"change-report"` as a view — enumerate with `grep -rn '"change-report"' src/app e2e --include=*.ts --include=*.tsx | grep -v '\.test\.'` and mirror each hit for `"forecast"`: `nav-config.ts` (`AppView`, Reports children after `"change-report"`, `LABEL_KEYS` → `forecastTitle`), `nav-icons.tsx` (a chart icon from `icons.ts`), `workspace-panels.tsx` (lazy import), `workspace-section.tsx` (tabpanel `panel-forecast` with `panelScrollClass`, passing `tasks`, `milestones`, `plan`, `today`, `holidaySet`, `isPopout`), `view-ai-scope.ts`, `ask-claude-prompts.ts`, `help-content.ts` (add `"forecast"` to `feature-reports.relatedViews`), `app-tour.ts` only if a test requires every report view to have a step (check, don't add otherwise). `feature-modules.ts`: no module (core, always on) unless a test demands membership — then the tasks/core module. `operating-guide-builtin.generated.ts` is generated: regenerate with `node scripts/gen-operating-guide.mjs` only if its source docs list report views; never hand-edit.
- Modify tests that enumerate views and now fail (grep `change-report` in `*.test.*`: `nav-config.test.ts`, `nav-icons.test.tsx`, `ask-claude-prompts.test.ts`); label each hit MIGRATE (add forecast) before editing.
- Modify: `e2e/a11y.spec.ts` — add `"Forecast"` to `A11Y_VIEWS` with a `HASH_VIEW` entry (`#forecast`), the way `"Next actions"` is reached.
- Modify: `AGENTS.md` — the remount bullet's tabpanel count ("27 of its 29") changes; re-measure with the two greps it quotes and write the new numbers.

- [ ] **Step 1: Make the edits; run tsc** — every `Record<AppView, …>` miss is a tsc error; fix until `npx tsc --noEmit` reports 0 errors.
- [ ] **Step 2: Run the affected unit tests** (the three test files above plus `workspace-section.test.tsx` and `forecast-panel.test.tsx`) under the lock; expect PASS.
- [ ] **Step 3: Axe run** (one local e2e): `PORT=3100 npx playwright test e2e/a11y.spec.ts --project=chromium -g "Forecast" --workers=1 > <scratch>/axe.log 2>&1; echo EXIT=$?` — expect EXIT=0. A timeout is contention, not a violation: re-run once before diagnosing.
- [ ] **Step 4: `npm run size:check > <scratch>/size.log 2>&1; echo EXIT=$?`** — expect 0.
- [ ] **Step 5: Commit** — `feat: Forecast view under Reports, in the axe gate (§502)`.

### Task 7: Docs, register, mutation proof

**Files:**
- Create: `docs/AGENTS/forecast.md` (LF) — engine files, seed derivation, floor, window, queue rule, the defensive effort fallback, what the panel owns; ★ landmines: no `Math.random`; `today` is a prop; Done-without-date is excluded, not repaired.
- Modify: `AGENTS.md` — a row in both doc tables for `forecast.md`.
- Modify: `docs/open-followups.md` — §502 **Status:** a dated update naming slice 1 shipped (with a reproduce grep, e.g. `grep -rln "simulateWhen" src/app/forecast`) and slices 2–5 open; the entry stays OPEN and its index row unchanged.
- Modify: `CHANGELOG.md` (Unreleased section, plain language, §502), the Help entry body for Reports (`helpSecReportsBody` EN + DE) mentioning the Forecast view, and the user guide paragraph (find the Reports section: `grep -rln "Reports" docs/guide* docs/user* 2>/dev/null`).

- [ ] **Step 1: Write the docs.** Run `npm run docs:symbols:check > <scratch>/sym.log 2>&1; echo EXIT=$?`, `npm run docs:claims:check …; echo EXIT=$?`, `npm run followups:index:check …; echo EXIT=$?` — all exit 0.
- [ ] **Step 2: Mutation proof.** One mutant at a time, each reverted by an anchored inverse write with `git diff --stat` empty afterwards; run only the owning test file under the lock; record the failing test's name and message:
  1. drop the Cancelled exclusion in the backlog (`index.ts`);
  2. drop the next-working-day shift (`throughput.ts`);
  3. change `EFFORT_MODE_MIN_COVERAGE` comparison `>=` to `>`;
  4. use the first instead of the last open linked task for the queue position (`milestones.ts`).
  Each must turn a test red with its own message. Put the 4/4 table in the report.
- [ ] **Step 3: Commit** — `docs: Forecast engine reference, register status and changelog (§502)`.

## Corrections (2026-10-14, post-review)

Dated record; the tasks above are left as written.

- **P1 — the coverage floor step was missing.** No task added a `src/app/forecast/**` threshold to
  `vitest.config.ts`, so the new engine had no coverage gate. It was added in f8ac7878b (lines 98,
  branches 86, the measured values rounded down minus 2).
- **P2 — the performance probe swept one case only.** The default call alone hid the What-if extremes.
  `docs/AGENTS/forecast.md` § Performance now measures four cases (default, horizon target, capacity
  10 % + scope +500 % + horizon target, the same plus a horizon milestone), with a reproduce block.
- **P3 — "every unfinished-milestone chance 1" on an empty backlog is wrong.** R3 governs: with no open
  task the milestones keep their own states (all linked closed reads 100 %, no linked tasks reads
  `no-linked-tasks`, an achieved one is omitted). The floor applies when `open.length > 0 || backlog > 0`
  (`backlog` after the what-if), so only no open task AND no added scope skips it.
- **P4 — the 5,000-trial fallback is dropped (owner decision 2026-10-14).** The performance step
  and spec §5 prescribed `FORECAST_TRIALS = 5000` above the ≈ 100 ms budget, and an adaptive
  fallback was briefly built. The owner decided the forecast always runs 10,000 trials and accepts
  the about-600 ms What-if extremes; 5aae55267 removed the fallback. Both prescribing sentences
  carry a dated "Superseded" note.
