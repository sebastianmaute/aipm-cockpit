# Forecast saved scenarios (§502, build step 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project keeps up to four named scenarios of dated changes (availability, added people, scope), saved
on all six write paths, and the Forecast view's new Scenarios mode compares them side by side with "As is" (range
bars, an exact table with cost rows, a milestone table), every column drawn from the same random numbers.

**Architecture:** The engine learns two per-working-day inputs: a capacity multiplier schedule (the day drawer
scales each drawn day by its day's multiplier) and a scope-arrivals schedule (work that arrives on a day index,
optionally attributed to a milestone). Every trial consumes a fixed number of draws and the seed leaves the changes
out, so columns differ only by their changes; the cost pass gets a per-trial sub-stream and two per-day schedules
(spend scale, added cost). A pure domain layer turns a stored scenario into those schedules (dates → day indexes,
the §4.1a added-people rules), and a pure runner computes every column outside React, so the §4.4 AI tool can call
it later. The UI adds a mode, a comparison view, an editor dialog and "Save as scenario".

**Tech Stack:** TypeScript, React 19 / Next.js (this repo's pinned version), Vitest + RTL, Playwright (axe).

**Spec:** `docs/superpowers/specs/2026-10-16-forecast-scenarios-and-ai-tool-design.md` §4.1, §4.1a, §4.2, §4.3,
§4.5 and §5 (cost rows included; §4.4, the AI tools and the Ask-Claude chips, is the next PR). Reference:
`docs/AGENTS/forecast.md`.

## Global Constraints

- Engine rules carry over (§5.1): seeded, deterministic, 10,000 trials (`FORECAST_TRIALS`), 1,300-working-day
  horizon (`MAX_HORIZON_WORKING_DAYS`), history floor, nearest-rank `percentile`, engine (`src/app/forecast/`)
  i18n-free and React-free; no `Math.random`, `Date.now()` or `new Date()` in the engine.
- **Common random numbers (§5.4):** every column of one comparison uses the same seed and stream split; "a scenario
  identical to As is shows identical numbers".
- **One seed for every column (§4.5, owner):** the seed is open task ids, history samples, window, unit and stream
  name only. Quick and What-if output changes; the pinned values are regenerated deliberately in Task 3.
- **Per-trial cost sub-stream on every surface (§4.5, owner):** part 3's pinned cost values are regenerated
  deliberately in Task 4.
- The §4.1 / §4.1a capacity, scope and limit rules apply exactly as the spec states them; Task 5 carries the limits
  as constants and Tasks 2 and 7 make the rules exact. They are not restated here.
- **Owner decisions 2026-10-17** (also written into the spec): the P95 row reads "Cautious (P95)" (`percentileWord`);
  attributed scope on a milestone with no open linked tasks is placed in the queue by the milestone's date, among the
  other milestones in due order, and only milestones after it move back; a version restore keeps today's scenarios.
- Persistence (§4.3): `Workspace.forecastScenarios` is a meta-blob slice on all six write paths, applied by the load
  funnel `applyWorkspaceFromLoad` (always replace) and NOT by `applyRestoredWorkspace`; storage-only (emitted only
  when `config === undefined`); byte-stable when absent; no `TABLE_NAMES` entry; not in `isWorkspaceEmpty`.
- Every create, edit, rename and delete is one activity-log entry; edits, renames and deletes are one undo entry
  each; creates are never captured (`docs/AGENTS/undo.md` "Creates").
- Performance (§5.3): Scenarios mode runs at most As is + the saved scenarios per input change (the panel skips its
  own Quick run in that mode), only while the mode is shown; nothing runs for scenarios on the Dashboard.
- Money in the baseline currency `plan.currency` (§476). Every simulated figure carries the sim marking (`SimValue`,
  `SimBadge`, `SIM_OUTLINE_CLASS` from `src/app/sim-value.tsx`).
- Repo rules: EN/DE parity with real umlauts (`i18n.de.ts` only through a node utf8 script with `\r\n` anchors, never
  the Edit tool); `src/app` files are CRLF — never `sed -i`; palette tokens only; accessible names, row-unique names
  for change rows and per-scenario actions (`useRowTokens` / `rowLabel`); no `set-state-in-effect`;
  `task-manager.tsx` gains no lines; `AGENTS.md` is not edited; size ratchet (`LIMIT` 1600, i18n exempt).
- Commands: targeted vitest only, under the lock
  `if mkdir /c/Projects/.vitest-lock 2>/dev/null; then npx vitest run <files> > "$TEMP/sc.log" 2>&1; echo "EXIT=$?"; rm -rf /c/Projects/.vitest-lock; else echo LOCKED; fi`,
  then `grep -E "Test Files|Tests " "$TEMP/sc.log"` (assert the file count). Never read an exit code through a pipe.
- Before every commit: `npx eslint --max-warnings=0 <changed files>; echo "EXIT=$?"` and `npx tsc --noEmit; echo "EXIT=$?"`,
  both 0 with 0 errors. Commits cite (§502); no trailer, no URL, no `Closes #`; never `--amend` (use
  `git commit --only <paths>` when the tree holds other changes).

## Review Focus

1. **Undo of a delete when four scenarios already exist, or after a same-named one was created** — the view shows
   five columns, duplicate names still give row-unique action names, "New scenario" stays disabled, nothing is
   dropped on reload. → Task 9 test "undoing a delete at the cap restores a fifth scenario"; Task 5 test "the
   sanitizer keeps a fifth scenario and duplicate names"; Task 10 test "duplicate scenario names get row-unique
   action names".
2. **A stored scenario whose milestone or person went away, or whose person joined the team later** — rows go inert
   with "milestone gone" / "person gone" / "already on the team", the scope counts as unattributed, nothing throws.
   → Task 7 tests "a gone milestone counts as unattributed and is flagged", "a gone person is inert", "a person who
   completed a task inside the window goes inert".
3. **A history-window change on the toolbar** — "already on the team" and `teamHoursPerDay` follow the window the
   run uses, live, not the window at save time; the editor reads the same window. → Task 8 tests "the on-team check
   follows the run's window" and "the editor's context is the one the columns used".
4. **The Forecast view in a popout** — Scenarios mode shows, but no Save as scenario, New, Edit, Rename or Delete
   (a popout records no undo). → Task 10 test "read-only in a popout".
5. **The effort unit** — a scope row adds `tasks` × the median estimate; an added person's share is unit-free. →
   Task 8 test "effort unit sizes scope rows at the median estimate".

---

## File map

| File | Status | Owns |
|---|---|---|
| `src/app/forecast/simulate.ts` | modify | per-day multiplier in `dayDrawer`, `bestBetween`, `drawDay(day)`, `buildArrivals`, arrivals in When/How many, fixed draws per trial |
| `src/app/forecast/milestones.ts` | modify | attributed arrivals, `isAttributableMilestone`, common tally length |
| `src/app/forecast/day-index.ts` | create | `simulatedDates`, `dayOnOrAfter`, `dayOnOrBefore` (date ↔ simulated day index) |
| `src/app/forecast/index.ts` | modify | `ScheduleForecastInput.changes`, `DatedScheduleChanges`, `ScopeArrival`, seed without changes, `ForecastInsufficient.windowDates` |
| `src/app/forecast/cost.ts` | modify | per-trial sub-stream, per-day `spendScale`, `addedCost` |
| `src/app/forecast/app-forecast.ts` | modify | export `chanceOnTime` |
| `src/app/budget-sim.ts` | modify | `simulateCostFromRun(Memo)` take the per-day schedules |
| `src/app/forecast-scenarios.ts` | create | scenario types, limits, `sanitizeForecastScenarios`, validation, pure list ops, `whatIfToScenarioChanges` |
| `src/app/id-mint-session.ts` | modify | `MintKind` `"forecastScenario"`, its `seedMintKind` line |
| `src/app/forecast-added-people.ts` | create | `teamHoursPerDay`, `onTeamResourceIds`, `resolveAddedPeople` (§4.1a) |
| `src/app/forecast-scenario-schedule.ts` | create | `buildScenarioSchedule`: a scenario → engine changes + cost schedules + per-row status |
| `src/app/forecast-scenario-compare.ts` | create | `buildScheduleContext`, `computeScenarioColumn`, `computeScenarioComparison` (pure; the view now, §4.4 later) |
| persistence files (Task 6) | modify | the six write paths, the load funnel, context, tab sync, slice policy |
| `src/app/use-forecast-scenarios.ts` | create | create/edit/rename/delete with activity log and undo |
| `src/app/activity-log.ts`, `src/app/undo/use-undo-stack.ts` | modify | `forecastScenario.*` kinds and the undo entity |
| `src/app/forecast-toolbar.tsx` | modify | third mode segment, "Save as scenario", availability label |
| `src/app/forecast-panel.tsx` | modify | `scenarios` prop, export `InsufficientState`, renders the Scenarios mode, skips its own run there |
| `src/app/forecast-scenarios-view.tsx` | create | Scenarios mode: runs the comparison, range bars, actions, New, opens the editor |
| `src/app/forecast-scenario-tables.tsx` | create | comparison table and milestone table (presentational) |
| `src/app/forecast-range-bar.tsx` | modify | optional shared `axis` |
| `src/app/forecast-scenario-editor.tsx` | create | the editor dialog (shared `Modal`) |
| `src/app/forecast-scenario-change-rows.tsx` | create | the change-row table inside the editor (presentational) |
| `src/app/forecast-scenario-name-dialog.tsx` | create | name prompt for Save as scenario and Rename |
| `src/app/workspace-section.tsx` | modify | facts gating, `useForecastScenarios`, the `scenarios` prop |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | modify | every new string |
| `e2e/forecast-scenarios.spec.ts` | create | axe scans of Scenarios mode and the editor (skipped while the view is held back) |

---

### Task 1: Per-day capacity in the day drawer (no result moves)

**Files:**
- Modify: `src/app/forecast/simulate.ts` (`SimOptions`, `DayDrawer`, `dayDrawer`, `drawDay`, `simulateWhen`,
  `simulateHowMany`)
- Modify: `src/app/forecast/milestones.ts` (`tally`)
- Test: `src/app/forecast/simulate.test.ts`, `src/app/forecast/milestones.test.ts`, `src/app/forecast/index.test.ts`

**Interfaces:**
- Produces:

```ts
export type SimOptions = {
  trials: number; rng: (() => number) & { skip?: (calls: number) => void }; capacity: number; horizon: number; integer: boolean;
  /** NEW. Multiplier per simulated working day, index 1..horizon (index 0 unused). When set it replaces `capacity`. */
  capacityByDay?: Float64Array;
};
export type DayDrawer = {
  /** CHANGED: the simulated working day's index (1-based) is passed in. */
  draw: (day: number) => number;
  /** The most one day can deliver (kept; the largest day under a schedule). */
  max: number;
  /** NEW: the most the days (afterDay, throughDay] can deliver together. */
  bestBetween: (afterDay: number, throughDay: number) => number;
  skipDays: (days: number) => void;
};
/** CHANGED: takes the day index too (default 1), so a schedule's multiplier applies. */
export function drawDay(samples: readonly number[], o: SimOptions, day?: number): number;
```

Rules: under `capacityByDay` a day's value is `sample × m[day]`, stochastically rounded when `integer`, with exactly
the rng calls of the flat drawer (1 per day in effort, 2 in tasks — a whole value skips its rounding draw, as today),
so the stream position after N days never depends on the multipliers. `bestBetween` is a prefix sum of the per-day
best (`ceil(maxSample × m[d])` in tasks, `maxSample × m[d]` in effort); the flat path returns
`(throughDay − afterDay) × max`. `simulateWhen` and the milestone tally test certainty with
`cannotReach(done, 1, bestBetween(d, last), target)` (signature of `cannotReach` unchanged). The flat path keeps its
hoisted arrays and `checkFrom`. The reference loops in `simulate.test.ts` and `milestones.test.ts` that call
`draw()` pass the day index.

- [ ] **Step 1: Pin today's numbers before touching `simulate.ts`.** In `index.test.ts` add a `describe("pinned
  digests")` with a test-local `digest(r)` = `seedFrom([...r.trialDays, ...r.howMany.map((h) => h.amount),
  ...r.milestones.flatMap((m) => m.state === "chance" ? [m.chance, m.chancePrioritised] : [m.state])])` and two cases:
  tasks unit (40 open tasks with mixed due dates and priorities, two milestones linked to tasks 12 and 35 dated 20
  and 60 working days out, `steadyDays(30)` history with 1–3 completions a day, window 30, What-if
  `{ scopeTasks: 3, scopePercent: 10, capacityPercent: 130 }`, `howManyTarget` 2026-11-30, `trials: 500`) and the
  same fixture in the effort unit (every task estimated). Write `expect(digest(r)).toBe(0)`, run it, paste the
  received values. Commit nothing yet.
- [ ] **Step 2: Write the failing tests.** Every exactness test first asserts that its case has both outcomes, as the
  existing sibling does (`simulate.test.ts`: "the case has both outcomes"), so it can fail.

```ts
// simulate.test.ts
test("a flat capacityByDay draws exactly what the scalar capacity draws, both units", () => {
  for (const integer of [true, false]) {
    const flat = new Float64Array(1301).fill(1.3);
    const a = simulateWhen([0, 1, 2, 3, 5], 120, opts({ integer, capacity: 1.3 }));
    const b = simulateWhen([0, 1, 2, 3, 5], 120, opts({ integer, capacity: 1, capacityByDay: flat }));
    expect(Array.from(b.trialDays)).toEqual(Array.from(a.trialDays));
    expect(Array.from(simulateHowMany([0, 1, 2, 3, 5], 40, 120, opts({ integer, capacityByDay: flat }))))
      .toEqual(Array.from(simulateHowMany([0, 1, 2, 3, 5], 40, 120, opts({ integer, capacity: 1.3 }))));
  }
});
test("a day's multiplier scales only its own day", () => {
  const m = new Float64Array(1301).fill(0.5); for (let d = 1; d <= 5; d += 1) m[d] = 1;
  expect(Array.from(simulateWhen([2], 15, opts({ capacityByDay: m })).days).every((d) => d === 10)).toBe(true); // 5×2 + 5×1
});
test("the certain-beyond exit stays exact under a varying multiplier", () => {
  // ~1.8 tasks a day on average → ~2,340 by day 1300; a backlog of 2,340 gives both outcomes
  const m = Float64Array.from({ length: 1301 }, (_, d) => (d % 2 ? 0.2 : 2.5));
  const fast = simulateWhen([0, 1, 3], 2340, opts({ capacityByDay: m }));
  expect(fast.days.includes(1301) && fast.days.some((d) => d < 1301), "the case has both outcomes").toBe(true);
  expect(Array.from(fast.trialDays)).toEqual(referenceWhen([0, 1, 3], 2340, m)); // plain loop, draw(d) every day to the horizon
});
test("bestBetween is the sum of each day's best", () => { /* samples [1.4], m = [_, 1, 2, 0.5] → tasks: 2+3+1 = 6 over (0,3]; effort: 1.4+2.8+0.7 */ });
// milestones.test.ts
test("the milestone early exits stay exact under a varying multiplier", () => {
  /* ordered tasks 1..60 size 1, M1 linked [20] at day 15, M2 linked [60] at day 40, samples [0, 1, 3],
     m alternating 0.2 / 2.5; assert some trials reach and some miss each milestone, then equal a full-walk reference */
});
```

- [ ] **Step 3: Run them** — the lock command on the three test files. Expected: FAIL (`capacityByDay` ignored,
  `bestBetween` undefined); the pinned digests PASS.
- [ ] **Step 4: Implement** the drawer, `bestBetween`, `drawDay(day)`, and pass the day index from `simulateWhen`,
  `simulateHowMany` and `tally`.
- [ ] **Step 5: Run** — Expected: PASS, the two pinned digests unchanged. Mutation (revert after): the per-day best
  as `floor` instead of `ceil` → "stays exact" fails. Note the kill in the commit body.
- [ ] **Step 6: Commit** — `feat: a per-day capacity schedule in the forecast day drawer (§502)`

### Task 2: Dated scope arrivals and dated capacity in the schedule engine (old seed)

**Files:**
- Create: `src/app/forecast/day-index.ts`
- Modify: `src/app/forecast/simulate.ts` (`buildArrivals`, `simulateWhen`, `simulateHowMany`)
- Modify: `src/app/forecast/milestones.ts` (`milestoneChances`, `isAttributableMilestone`)
- Modify: `src/app/forecast/index.ts` (`ScheduleForecastInput`, `computeScheduleForecast`, `ForecastInsufficient`)
- Test: `src/app/forecast/day-index.test.ts` (new), `simulate.test.ts`, `milestones.test.ts`, `index.test.ts`

**Interfaces:**
- Consumes: `capacityByDay`, `bestBetween` (Task 1).
- Produces:

```ts
// day-index.ts — pure
/** Index 0 = today, index i = the i-th working day after today (weekends + holidaySet off), length horizon + 1. */
export function simulatedDates(today: string, horizon: number, holidaySet: ReadonlySet<string>): string[];
/** 0 for a date on or before today; else the first index whose date ≥ iso; dates.length when past the last date
 *  (no simulated day — a window starting there is empty; a scope arrival there is clamped to the horizon). */
export function dayOnOrAfter(dates: readonly string[], iso: string): number;
/** The last index whose date ≤ iso; 0 before day 1. */
export function dayOnOrBefore(dates: readonly string[], iso: string): number;

// simulate.ts
export type Arrivals = { arrivedAt: Float64Array; lastPositiveDay: number; suffixMin: Float64Array };
/** `arrivedAt[d]` (0..horizon) = base plus the steps with day ≤ d, applied in day order and clamped at 0 after
 *  each step; `lastPositiveDay` = the latest day of a positive step (0 if none); `suffixMin[d]` = min over d' ≥ d. */
export function buildArrivals(base: number, steps: readonly { day: number; amount: number }[], horizon: number): Arrivals;
export function simulateWhen(samples, backlog, o, arrivals?: Arrivals): { days; trialDays; beyondShare };
export function simulateHowMany(samples, days, backlog, o, arrivals?: Arrivals): Float64Array;

// milestones.ts
/** Not achieved and a valid date: the milestones a scope change may be attributed to (§4.1). */
export function isAttributableMilestone(m: Milestone): boolean;
// Args gains (both optional; absent = today's behaviour exactly):
//   attributed?: readonly { day: number; amount: number; milestoneId: number }[];
//   cap?: Arrivals;

// index.ts
export type ScopeArrival = { day: number; tasks: number; milestoneId: number | null };
export type DatedScheduleChanges = { capacityByDay: Float64Array; arrivals: readonly ScopeArrival[] };
export type ScheduleForecastInput = { /* existing */ changes?: DatedScheduleChanges }; // replaces whatIf when set
export type ForecastInsufficient = { /* existing */ windowDates: readonly string[] };
```

Engine rules (When / How many, `arrivals` given):
- Day 0 has no draw. `done(d) = min(done(d−1) + draw(d), arrivedAt[d])` — work cannot be delivered before it arrives.
- A trial finishes on the smallest `d ≥ lastPositiveDay` with `done(d) ≥ arrivedAt[d]` (added scope must be finished;
  a trial done before an addition resumes when it arrives). Certain-beyond: `cannotReach(done, 1, bestBetween(d,
  horizon), suffixMin[max(d + 1, lastPositiveDay)])`.
- How many reports `done(target)`; it stops drawing once `d ≥ lastPositiveDay` and `done ≥ arrivedAt[d]` and reports
  `arrivedAt[target]` (Task 3 adds the skip).

Milestone rules (`milestoneChances` with `attributed`):
- Each target gets a queue key `(position, date)`. A target with open linked tasks takes today's base position.
  **Owner decision 2026-10-17:** a milestone with no open linked tasks (all closed or all dangling) that receives net
  added work becomes a target placed in the queue by its date: its base position is the largest base position of the
  targets dated on or before it (0 when none).
- Processing `attributed` in day order: an addition of `a` to N adds `a` to N's own work and to the position of N and
  every target whose key comes after N's (`position > N.position`, or equal position and `date > N.date`); a removal
  subtracts `min(a, N's current own work)` the same way. For target M only changes with `day ≤ M.days` count, except
  that an addition to M itself with `day > M.days` makes both of M's figures 0. The prioritised figure of every other
  milestone is untouched.
- `cap` (base + every addition + attributed removals, NOT unattributed removals: those come off the queue's end)
  caps the tally's `done` per day. Overdue stays overdue whatever is attributed.

`computeScheduleForecast` with `changes`: `capacityByDay` goes into `SimOptions`; arrivals become amounts
(`tasks × unitSize`, so the effort unit sizes a task at the median estimate); an arrival whose `milestoneId` is not
an attributable milestone of `input.milestones` counts as unattributed; `backlog` in the result is
`arrivedAt[horizon]`; the floor applies when `open.length > 0` or any `arrivedAt[d] > 0`. In this task the seed is
unchanged (built from the clamped `input.whatIf` as today), so no pinned value moves.

- [ ] **Step 1: Write the failing tests**
  - `day-index.test.ts` (today Wednesday 2026-10-14): "dates skip weekends and holidays" (`dates[1]` = 2026-10-15,
    `dates[3]` = 2026-10-19); "a Saturday lands on Monday going forward and Friday going back"
    (`dayOnOrAfter(d, "2026-10-17")` = 3, `dayOnOrBefore(d, "2026-10-17")` = 2); "a past date is day 0"; "a date past
    the last simulated day is dates.length".
  - `simulate.test.ts`: "buildArrivals clamps at zero after each step" (base 10, steps day 3 +5, day 5 −20, day 7 +2 →
    `arrivedAt[2]` 10, `[3]` 15, `[5]` 0, `[7]` 2, `lastPositiveDay` 7); "work cannot be delivered before it arrives"
    (effort, samples [5], base 2, +10 on day 6 → every trial 7); "a removal never goes below zero and does not hold the
    finish back" (samples [3], base 10, −20 on day 2 → every trial 2); "How many counts only arrived work" (samples
    [4], base 5, +10 on day 4: target 3 days → 5, target 6 days → 15); "the certain-beyond exit stays exact with
    arrivals" (Task 1's varying multiplier, base 2,000 plus +340 on day 400; assert both outcomes, then equal a
    full-walk reference).
  - `milestones.test.ts` — ordered tasks 1..10 size 1, M1 linked [5], M2 linked [10], samples [1], `opts()`:
    "attributed scope moves its milestone and every later one, and both figures of its own" (+5 to M1 on day 0, M1 at
    day 9, M2 at day 14 → M1 `{ chance: 0, chancePrioritised: 1 }`, M2 `{ chance: 0, chancePrioritised: 1 }`);
    "unattributed added scope moves no milestone" (same, `attributed` empty, only `cap` raised → both 1/1); "an
    attributed removal stops at the milestone's own work" (−3 to M1 on day 0, M1 at day 4, M2 at day 7 → M1 chance 1,
    M2 chance 0 — position 9, not 7); "an addition after its milestone's date makes that milestone unreachable" (+1 to
    M1 on day 12, M1 at day 9 → 0/0); "an addition arriving after a later milestone's date does not move it" (+5 to M1
    on day 12, M2 at day 11 → M2 chance 1); "scope on a milestone with no open linked tasks is placed by its date"
    (owner decision: M1 at day 7, M2 at day 12, M3 linked [99] with `closedIds` {99} at day 10, +3 to M3 on day 0 →
    M3 position 5 + 3 = 8, chance 1; M1 unmoved, chance 1; M2 position 13, chance 0).
  - `index.test.ts`: "changes with a flat 1.0 schedule and no arrivals equal the plain run"; "an arrival on an
    achieved milestone counts as unattributed" (milestone chances equal the unattributed run); "effort unit: an arrival
    of 2 tasks adds 2 × the median estimate" (`backlog` = base + 120 with median 60); "arrivals alone still need the
    history floor" (no open task, +5 arrival, 3 completions → `insufficient`); "insufficient carries the window dates".
- [ ] **Step 2: Run** the four files — Expected: FAIL.
- [ ] **Step 3: Implement** `day-index.ts`, `buildArrivals`, the arrival paths, the attributed milestones and
  `changes` in `computeScheduleForecast`.
- [ ] **Step 4: Run** — Expected: PASS; Task 1's pinned digests unchanged. Mutations (revert each): drop the arrival
  cap → "before it arrives" fails; shift later milestones by a removal's raw amount → "stops at the milestone's own
  work" fails; count later-arriving changes for an earlier-checked milestone → "does not move it" fails; base
  position 0 for a milestone with no open tasks → "placed by its date" fails (M1 drops to 0).
- [ ] **Step 5: Commit** — `feat: dated scope arrivals and dated capacity in the forecast engine (§502)`

### Task 3: Common random numbers — one seed, fixed draws per trial (pins regenerated)

**Files:**
- Modify: `src/app/forecast/index.ts` (`seedParts`), `src/app/forecast/simulate.ts`, `src/app/forecast/milestones.ts`
- Modify: `sample-workspace-small.json` (`forecastHistory`), `sample-workspace-big.json`, `sample-workspace-huge.json`,
  `src/app/__fixtures__/golden-workspace.csv`, `src/app/__fixtures__/golden-workspace.md`
- Test: `simulate.test.ts`, `milestones.test.ts`, `index.test.ts`, and every test whose pin moves (Step 4)

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces (behaviour): `seedParts` = sorted open ids, history samples, window, unit (no What-if, no changes). Every
  When trial consumes exactly `horizon` days of draws (a finished trial skips the rest with `skipDays`); every How-many
  trial exactly `target` days; every milestone-tally trial exactly `lastDay` days, where `lastDay` = the latest day
  of any attributable milestone dated on or after today (capped at the horizon), target or not — the same in every
  column. So trial t starts at the same stream position in every column.

- [ ] **Step 1: Write the failing tests**

```ts
// simulate.test.ts — a counting rng: wraps mulberry32 and adds `skip(n)` calls to its counter
test("every When trial consumes exactly the horizon's draws", () => {
  const rng = counting(mulberry32(3));
  simulateWhen([1, 2], 10, opts({ trials: 50, rng }));
  expect(rng.calls()).toBe(50 * 1300 * 2);
});
test("every How-many trial consumes exactly the target's draws", () => { /* 50 trials, 40 days, backlog 10 → 50*40*2 */ });
// milestones.test.ts
test("the tally walks every trial to the last dated milestone, target or not", () => {
  /* M1 open at day 9, M2 all closed at day 30 → calls = trials × 30 × 2 */
});
// index.test.ts
test("a higher capacity never makes any trial later (shared draws)", () => {
  const quick = run({ whatIf: NEUTRAL }); const more = run({ whatIf: { ...NEUTRAL, capacityPercent: 130 } });
  expect(Array.from(more.trialDays).every((d, t) => d <= quick.trialDays[t])).toBe(true);
});
test("a later scope arrival never makes any trial finish earlier", () => { /* changes: +5 on day 20 vs none, per trial ≥ */ });
test("a flat 130 % schedule plus a day-0 arrival equals the What-if it came from (tasks unit)", () => {
  // 50 open tasks; What-if { scopeTasks: 3, scopePercent: 10, capacityPercent: 130 } vs
  // changes { capacityByDay: flat 1.3, arrivals: [{ day: 0, tasks: 8, milestoneId: null }] }
  // trialDays, when and milestones deep-equal
});
```

- [ ] **Step 2: Run** — Expected: FAIL (draw counts vary; the What-if is in the seed).
- [ ] **Step 3: Implement** the seed change and the three skips. The existing "the certain-beyond early exit gives
  exactly the days of walking every trial to the horizon" and "the early exits … give exactly the chances of walking
  to the last day" references must now also walk finished trials to the end; update their reference loops, not the
  assertions.
- [ ] **Step 4: Regenerate the engine pins on purpose.** Run Task 1's digests and re-pin both; then run every test
  that reads engine output — `grep -rlE "computeScheduleForecast|computeAppForecast|simulateWhen|simulateHowMany|milestoneChances" src --include=*.test.ts --include=*.test.tsx`
  — and re-pin only exact values (dates, chances, counts) that moved; never a structural assertion. List each old →
  new in the commit body. Commit this step on its own before Step 5 (`test: regenerate the forecast pins for the
  shared seed (§502)`), so the sample regeneration below sits in a separate commit.
- [ ] **Step 5: Sync before touching the shared sample.** `git fetch origin` and `git merge origin/main` into the
  branch (the peer's §715 work rewrites `sample-workspace-small.json`, including `forecastHistory`). Then STOP and
  tell the controller that the regeneration is next; the controller messages `cockpit-peer` before it happens. Wait
  for the controller's go.
- [ ] **Step 6: Recompute the sample's history** with a throwaway `vite-node` script in `$TEMP` (method of 568da1ede):
  for each date D already in `sample-workspace-small.json`'s `forecastHistory`, take the master's tasks as they stood
  on D (drop a task with `createdDate > D`; a task with `completedDate > D` becomes `status: "Open"` without
  `completedDate`), run `computeAppForecast({ tasks, milestones, planEnd: plan.endDate, today: D, holidaySet: new Set() })`,
  write `toHistoryEntry(…, D)`, and drop the date if it is `insufficient`. The script writes the JSON back with a node
  utf8 write preserving the file's line endings — never a hand edit, so a later merge conflict on the file is resolved
  by merging and re-running the script, not by hand. Then `npx vite-node scripts/generate-sample-workspace.ts` and
  `npx vite-node scripts/regen-golden-fixtures.ts`. Note in the commit body whether the demo's milestone shape
  (forecast.md: "Pilot Go-Live and Rollout sit far below 50 %, Closure is safe") still holds; Task 12 corrects the
  doc if not.
- [ ] **Step 7: Run** `src/app/demo-week-master.test.ts`, `src/app/demo-workspace.test.ts`,
  `src/app/golden-workspace.test.ts` and the Step 4 list — Expected: PASS. Mutation: put `whatIf.capacityPercent`
  back into `seedParts` → "a higher capacity never makes any trial later" fails.
- [ ] **Step 8: Commit** — `feat: one seed and fixed draws per trial, so forecast columns share their random numbers (§502)`
  (the engine change and its tests) and then `chore: recompute the sample forecast history for the shared seed (§502)`
  (the samples and golden fixtures). Report both shas to the controller.

### Task 4: Per-trial cost sub-stream and per-day spend schedules (cost pins regenerated)

**Files:**
- Modify: `src/app/forecast/cost.ts` (`simulateCostAtFinish`), `src/app/budget-sim.ts` (`simulateCostFromRun`,
  `simulateCostFromRunMemo`)
- Test: `src/app/forecast/cost.test.ts`, `src/app/budget-sim.test.ts`, and every test whose cost pin moves (Step 4)

**Interfaces:**
- Produces:

```ts
export function simulateCostAtFinish(a: {
  trialDays: Int32Array; samples: readonly number[]; ac: number; bac: number; seedTag: string; horizon: number;
  /** A number (What-if) or a per-day schedule, index 1..horizon (Scenarios: the clamped availability product). */
  spendScale?: number | Float64Array;
  /** NEW. Baseline-currency cost per simulated working day, index 1..horizon (Scenarios: added people). */
  addedCost?: Float64Array;
}): CostAtFinish;
export function simulateCostFromRun(run: { trialDays: Int32Array; windowDates: readonly string[] }, f: ForecastFacts,
  seedTag: string, spendScale: number | Float64Array = 1, addedCost?: Float64Array): CostAtFinish;
// simulateCostFromRunMemo: same signature; the memo also compares spendScale and addedCost (identity, or value for a number).
```

Trial `t` draws from `mulberry32(seedFrom([base, t]))`, `base = seedFrom([...samples, ac, bac, seedTag, "cost"])`;
day `i` (1-based, up to the trial's finish day) adds `sample × scale(i) + addedCost[i]`. A beyond trial stays
`Infinity`; "nothing open" still short-circuits to `ac`.

- [ ] **Step 1: Write the failing tests**

```ts
it("a trial's own finish day leaves every other trial's draws alone (per-trial sub-stream)", () => {
  const samples = [10, 0, 30, 5, 50, 0, 20, 10, 40, 15, 25, 35];
  const run = (first: number) => simulateCostAtFinish({ trialDays: Int32Array.from([first, ...Array(999).fill(20)]), samples, ac: 0, bac: 1e9, seedTag: "eur", horizon: 1300 });
  expect(run(61)).toMatchObject({ p50: (run(60) as { p50: number }).p50, p80: (run(60) as { p80: number }).p80 });
});
it("a per-day spend scale applies to its own day only", () => {
  const scale = Float64Array.from([0, 1, 1, 0.5, 0.5]);
  expect(simulateCostAtFinish({ trialDays: Int32Array.from([4]), samples: Array(12).fill(100), ac: 7, bac: 0, seedTag: "eur", horizon: 4, spendScale: scale }))
    .toMatchObject({ p50: 7 + 100 + 100 + 50 + 50 });
});
it("added cost is booked every day up to the trial's finish, on top of the drawn spend", () => {
  /* trialDays [3], samples all 100, addedCost [0,10,10,10,10] → p50 = ac + 300 + 30 */
});
it("a beyond trial stays beyond with added cost", () => { /* trialDays [1301], addedCost set → p50 "beyond" */ });
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** both files; `computeBudgetSim` and the Forecast view keep calling with their scalar.
- [ ] **Step 4: Regenerate the cost pins on purpose**: run `cost.test.ts`, `budget-sim.test.ts` and every file from
  `grep -rlE "simulateCostAtFinish|simulateCostFromRun|computeBudgetSim|withBudgetSim" src --include=*.test.ts --include=*.test.tsx`;
  re-pin only moved values (`cost.test.ts` "varied spend is seeded" is the one expected to move), old → new in the
  commit body.
- [ ] **Step 5: Run** — PASS. Mutation: one shared stream for all trials → the sub-stream test fails.
- [ ] **Step 6: Commit** — `feat: a per-trial cost sub-stream and per-day spend schedules (§502)`

### Task 5: The scenario model — types, sanitizer, validation, list operations

**Files:**
- Create: `src/app/forecast-scenarios.ts` (header: "Saved forecast scenarios (§502) — pure, i18n-free, DOM-free")
- Modify: `src/app/id-mint-session.ts` (`MintKind` gains `"forecastScenario"`; `seedMintFromWorkspace` gains
  `seedMintKind("forecastScenario", ws.forecastScenarios ?? [], mode)` — lands with Task 6's `Workspace` field, so
  add the line in Task 6 if the field does not exist yet)
- Test: `src/app/forecast-scenarios.test.ts`

**Interfaces:**
- Consumes: `WhatIf` (`./forecast`), `isValidIsoDate` (`./forecast/throughput`, not the one in
  `action-rebaseline.ts`), `isAttributableMilestone` (Task 2), `SUPPORTED_CURRENCIES` / `BudgetCurrency` / `Milestone`
  / `Resource` (`./types`).
- Produces:

```ts
export type AvailabilityChange = { kind: "availability"; percent: number; from: string; until: string }; // until "" = to the end
export type AddedPeopleWho =
  | { resourceId: number; hoursPerWeek: number }
  | { label: string; count: number; rate: number; currency: BudgetCurrency; hoursPerWeek: number };
export type AddPeopleChange = { kind: "addPeople"; who: AddedPeopleWho; from: string; until: string; rampWeeks: number };
export type ScopeChange = { kind: "scope"; tasks: number; on: string; milestoneId?: number };
export type ScenarioChange = AvailabilityChange | AddPeopleChange | ScopeChange;
export type ForecastScenario = { id: number; name: string; changes: readonly ScenarioChange[] };

export const MAX_FORECAST_SCENARIOS = 4, MAX_SCENARIO_CHANGES = 20, SCENARIO_NAME_MAX = 60;
export const AVAILABILITY_MIN = 10, AVAILABILITY_MAX = 300, ADDED_HOURS_MIN = 1, ADDED_HOURS_MAX = 60;
export const ADDED_COUNT_MAX = 20, RAMP_WEEKS_MAX = 26, DEFAULT_RAMP_WEEKS = 4, PLACEHOLDER_RATE_MAX = 100_000;
export const SCOPE_TASKS_MAX = 1000; // |tasks|, the What-if field's own bound (MAX_SCOPE_TASKS)

export function sanitizeForecastScenarios(raw: unknown): ForecastScenario[];
export type ScenarioChangeError =
  | "date" | "until-before-from" | "percent" | "hours" | "count" | "ramp" | "rate" | "currency" | "label"
  | "tasks" | "milestone-unknown" | "milestone-finished" | "resource-unknown" | "resource-archived" | "on-team";
export type ScenarioError = "name-empty" | "name-long" | "name-taken" | "too-many-changes" | "cap";
export type ValidationContext = { milestones: readonly Milestone[]; resources: readonly Resource[]; onTeam: ReadonlySet<number> };
export function validateScenarioChange(c: ScenarioChange, ctx: ValidationContext): ScenarioChangeError | null;
export function validateScenarioDraft(d: { name: string; changes: readonly ScenarioChange[] }, list: readonly ForecastScenario[],
  exceptId: number | null): ScenarioError | null;
export function isScenarioNameTaken(list: readonly ForecastScenario[], name: string, exceptId: number | null): boolean;
export function addScenario(list: readonly ForecastScenario[], s: ForecastScenario): ForecastScenario[];
export function replaceScenario(list: readonly ForecastScenario[], s: ForecastScenario): ForecastScenario[];
export function removeScenario(list: readonly ForecastScenario[], id: number): ForecastScenario[];
/** "Save as scenario", fed the CLAMPED What-if the panel uses (`usedWhatIf`): an availability row from today with no
 *  end when capacity ≠ 100, and one unattributed scope row on today of scopeTasks + round-half-up(openCount ×
 *  scopePercent / 100) when that is ≠ 0. Exact parity with What-if holds in the tasks unit only (effort takes the
 *  percent of the effort sum; a scenario sizes each task at the median). */
export function whatIfToScenarioChanges(w: WhatIf, openCount: number, today: string): { changes: ScenarioChange[]; percentTasks: number };
```

Ids are minted with `mintId("forecastScenario", list)` (`id-mint-session.ts`), the session high-water mark every
entity uses, so a deleted id is never reused in the same session; there is no `max + 1` helper.

Sanitizer (read side, §4.3): a non-array is `[]`; a scenario needs an integer `id > 0` (a repeated id keeps the
first) and a name that trims to 1+ characters (cut to 60); `changes` keeps at most 20 valid rows. Rows: unknown keys
dropped; a wrong type, an invalid ISO date, `until` before `from`, `tasks` 0, a `who` that fits neither shape or an
unsupported currency drops the row; numbers are clamped to the limits above (`tasks` rounded, `rampWeeks` rounded,
absent → 4; a label cut to 60). An unknown resource id or milestone id is KEPT (it can come back on undo). The 4-cap
and name uniqueness are creation rules: the sanitizer keeps a fifth scenario and duplicate names, because dropping
them would lose saved data.

Validation (write side, the editor now and the AI tools in §4.4): the stored-row rules plus "milestone-unknown",
"milestone-finished" (achieved or no valid date), "resource-unknown", "resource-archived" (`active === false`),
"on-team" (in `ctx.onTeam`); `validateScenarioDraft` checks the trimmed name, uniqueness (case-insensitive), at most
20 changes, and "cap" when creating (`exceptId === null`) at 4 or more.

- [ ] **Step 1: Write the failing tests** — "drops junk, keeps a valid scenario and its rows"; "clamps out-of-range
  numbers (percent 5 → 10, hoursPerWeek 80 → 60, count 0 → 1, rampWeeks 30 → 26, rate 2e5 → 1e5)"; "absent rampWeeks
  is 4"; "drops a row with until before from, tasks 0, a bad date, an unsupported currency, or a who with both
  shapes"; "drops unknown keys"; "keeps the first of a repeated id"; "the sanitizer keeps a fifth scenario and
  duplicate names" (Review Focus 1); "keeps an unknown resource id and milestone id"; "at most 20 changes survive";
  validation: each `ScenarioChangeError` from one bad row, "name-taken is case-insensitive and ignores the scenario
  being edited", "cap only when creating"; list ops return new arrays and leave the input untouched
  (`JSON.stringify` before and after); `whatIfToScenarioChanges({ scopeTasks: 0, scopePercent: 10,
  capacityPercent: 100 }, 55, "2026-10-14")` → one scope row of 6 tasks (5.5 rounds half-up), `percentTasks` 6;
  capacity 130 alone → one availability row `{ percent: 130, from: "2026-10-14", until: "" }`; the default What-if →
  no rows.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat: the saved forecast scenario model and its sanitizer (§502)`

### Task 6: `forecastScenarios` on all six write paths and the load funnel

**Files** (mirror `forecastHistory`, commit bba495076, file by file):
- Modify: `src/app/workspace.ts` (field `forecastScenarios?: readonly ForecastScenario[]`, JSON write and parse with
  `sanitizeForecastScenarios` + `noteIfDropped`), `src/app/csv-codecs-sections.ts`
  (`CSV_SECTION_FORECAST_SCENARIOS = "# FORECAST SCENARIOS"`), `src/app/csv-codecs-config.ts`
  (`forecastScenariosToCsv`, `csvToForecastScenarios`, emitted only when `config === undefined`),
  `src/app/csv-codecs-decode.ts`, `src/app/markdown-codecs-core.ts` (`forecastScenariosToMarkdown`,
  `markdownToForecastScenarios`, section "## Forecast Scenarios", same gate), `src/app/markdown-codecs-decode.ts`,
  `src/app/turso-schema.ts` (decode, dirty check, meta row `forecastScenarios`), `src/app/turso-tenant-schema.ts`,
  `src/app/idb-layout.ts` (`IDB_OPTIONAL_KV_KEYS.forecastScenarios`), `src/app/browser-backend.ts`,
  `src/app/workspace-context.tsx` (`forecastScenarios`, `setForecastScenarios`),
  `src/app/use-storage-backend.ts` (destructure, `mirrorApply`, `applyWorkspaceFromLoad` ALWAYS replace,
  `outgoing`, save deps, sync `slices`, `currentWorkspace`), `src/app/id-mint-session.ts` (the `seedMintKind` line, if
  Task 5 deferred it), `src/app/use-workspace-sync.ts` (broadcast channel), `src/app/workspace-slice-policy.ts`
  (`counted: false`), `src/app/workspace-metrics.ts` (the exclusion comment), `src/app/use-storage-file-ops.ts` (the
  uncounted-slices comment list), `e2e/seed-workspace.ts` (`SEED_UNSEEDED_BY_DESIGN.forecastScenarios`),
  `src/test/meta-slices-fixtures.ts`
- Test: `src/app/forecast-scenarios-persistence.test.ts` (new, the shape of `forecast-history-persistence.test.ts`),
  `src/app/csv-codecs.meta-slices.test.ts`, `src/app/markdown-codecs.meta-slices.test.ts`,
  `src/app/turso-schema.execute.test.ts`, `src/app/unload-journal.test.ts` (32-key surface),
  `src/app/is-workspace-empty.test.ts`, `src/app/idb-layout.test.ts`, `src/app/workspace-slice-policy.test.ts`

**Interfaces:**
- Consumes: `ForecastScenario`, `sanitizeForecastScenarios` (Task 5).
- Produces: `useWorkspace()` returns `forecastScenarios: readonly ForecastScenario[]` and
  `setForecastScenarios: Dispatch<SetStateAction<readonly ForecastScenario[]>>`.

Slice-policy reason (`counted: false`): "Scenario inputs, at most four short lists, cheap to recreate; the spec keeps
them out of isWorkspaceEmpty, and widening the save-time thresholds changes when saves are refused for every
project (the documents precedent needed §98). Protected by riding all six write paths." The version-restore funnel
(`applyRestoredWorkspace`) deliberately does NOT set it (owner decision 2026-10-17, as `forecastHistory`); Task 12
updates the funnel list in `docs/AGENTS/activity-log.md`.

Size budget: `use-storage-backend.ts` stands at 1,578 of the ratchet's 1,600 (`wc -l` + 1); the `forecastHistory`
precedent added 8 net lines there. Add to the existing long lines, not new ones.

- [ ] **Step 1: Write the failing tests** — persistence file: "forecastScenarios round-trips on every write path" (JSON,
  CSV, Markdown, Turso single, Turso tenant, IndexedDB — a fixture with one scenario holding all three kinds and both
  `who` shapes); "a workspace without forecastScenarios writes nothing for it" (JSON no key; CSV and Markdown
  byte-identical to the empty workspace; no Turso meta row; IndexedDB clears the stored value); "fires a save when
  forecastScenarios is the ONLY thing that changed"; "loads stored scenarios into workspace state"; "registers a
  forecastScenarios broadcast-sync channel"; "a load REPLACES the scenarios (a project switch never carries them over)";
  "a loaded workspace seeds the scenario id minter, so the next mint is above its largest id". Add the slice to the
  meta-slice fixtures, the unload-journal key list (31 → 32), the Turso execute meta map and
  `is-workspace-empty.test.ts` ("forecastScenarios is excluded", both directions as for `forecastHistory`).
- [ ] **Step 2: Run** the eight files — FAIL.
- [ ] **Step 3: Implement** every file above; reuse the meta-blob helpers the `forecastHistory` codecs use
  (`decodeMetaJson`), so `dup:check` stays green.
- [ ] **Step 4: Run** — PASS. The sample master gains no scenarios, so the golden fixtures stay byte-identical: run
  `src/app/golden-workspace.test.ts` to prove it. Run `npm run size:check; echo "EXIT=$?"` — expected 0.
- [ ] **Step 5: Commit** — `feat: persist forecast scenarios on all six write paths (§502)`

### Task 7: Added people and the scenario schedule builder (§4.1a)

**Files:**
- Create: `src/app/forecast-added-people.ts`, `src/app/forecast-scenario-schedule.ts`
- Test: `src/app/forecast-added-people.test.ts`, `src/app/forecast-scenario-schedule.test.ts`

**Interfaces:**
- Consumes: Task 2 (`simulatedDates`, `dayOnOrAfter`, `dayOnOrBefore`, `DatedScheduleChanges`, `ScopeArrival`,
  `isAttributableMilestone`), Task 5 types; `spendSamples` (`./forecast/cost`), `MIN_SPEND_WORKING_DAYS`;
  `materializeRoleRates` (`./role-rates`), `currencyToBase` / `resolveRateSource` (`./fx`), `absencesForResource`
  (`./resource-capacity`), `resourceDisplayName` (`./resource-foundation`), `DEFAULT_WEEK_HOURS`, `isWorkingDay`,
  `countWorkingDays`, `addCalendarDays`.
- Produces:

```ts
// forecast-added-people.ts — pure, i18n-free
export type ScenarioDirectory = {
  resources: readonly Resource[]; roles: readonly Role[]; shifts: readonly Shift[]; absences: readonly Absence[];
  budgets: readonly BudgetBucket[]; fxRates: FxRates | null; workdayHours: number; baseCurrency: BudgetCurrency;
};
export type ScheduleContext = {
  today: string; holidaySet: ReadonlySet<string>; dates: readonly string[]; // simulatedDates(today, horizon, holidaySet)
  tasks: readonly Task[]; milestones: readonly Milestone[]; directory: ScenarioDirectory;
  windowDates: readonly string[]; hoursFacts: ForecastFacts | null;
  onTeam: ReadonlySet<number>; teamHours: number | null; // derived once from windowDates and hoursFacts
};
/** Booked hours on the window days / number of window days (zero days included); null when there are no hours
 *  facts, the hours samples miss the spend floor or are all zero, or the result is under 1 h. */
export function teamHoursPerDay(hoursFacts: ForecastFacts | null, windowDates: readonly string[]): number | null;
/** Ids in any bucket's allocations[].resourceIds or disciplineAllocations[].resourceIds, plus the resource (by
 *  resourceId, else case-folded display name) of every Done task whose completedDate is a window date. */
export function onTeamResourceIds(tasks: readonly Task[], directory: ScenarioDirectory, windowDates: readonly string[]): ReadonlySet<number>;
export type AddedPersonStatus =
  | { kind: "sized"; name: string; weeklyHours: number; ratePerHour: number;
      rateNote: "ok" | "no-rate" | "external" | "at-par"; shareAtFullSpeed: number }
  | { kind: "inert"; reason: "person-gone" | "on-team" | "ended" | "needs-booked-hours" };
export function resolveAddedPeople(c: AddPeopleChange, ctx: ScheduleContext): { status: AddedPersonStatus; share: Float64Array; cost: Float64Array };

// forecast-scenario-schedule.ts — pure, i18n-free
export type ScenarioRowStatus =
  | { kind: "availability"; ended: boolean }
  | { kind: "addPeople"; status: AddedPersonStatus }
  | { kind: "scope"; milestoneGone: boolean };
export type ScenarioSchedule = {
  changes: DatedScheduleChanges;   // capacityByDay = clamp(Π availability, 0.1, 3) + Σ added shares
  spendScale: Float64Array;        // the clamped availability product
  addedCost: Float64Array;         // Σ added cost per day, baseline currency
  rows: readonly ScenarioRowStatus[]; // aligned with the scenario's changes by index
  teamHoursPerDay: number | null;
  /** Σ sized rows' (weeklyHours / 5) / teamHoursPerDay; > 1 means "added people more than double the team". */
  addedShareAtFullSpeed: number;
};
export function buildScenarioSchedule(changes: readonly ScenarioChange[], ctx: ScheduleContext): ScenarioSchedule;
```

Rules (the spec's, made exact):
- Arrays are `dates.length` long (index 0 = today, unused for capacity). Availability applies on days
  `[max(1, dayOnOrAfter(from)), until ? dayOnOrBefore(until) : horizon]` (empty when `from` is past the last simulated
  day); overlapping rows multiply; the product is clamped to [0.1, 3] per day and is both the delivery factor and
  `spendScale`. `until` before today → `ended`.
- Scope: `day = min(dayOnOrAfter(on), horizon)` (a past date is day 0); a `milestoneId` that is not an attributable
  milestone of `ctx.milestones` becomes `null` with `milestoneGone: true`.
- Added people: inert reasons in this order — `person-gone` (no such resource), `on-team`, `ended`
  (`until` before today), `needs-booked-hours` (`ctx.teamHours` null). A directory person's weekday hours come from
  their `Shift` (matched by `resourceId`, else case-folded `assignee` = `resourceDisplayName`), else
  `DEFAULT_WEEK_HOURS`; weekend hours are ignored and Mon–Fri is rescaled so it sums to `hoursPerWeek` (a shift with no
  weekday hours falls back to an even Mon–Fri split); a day inside one of `absencesForResource` is 0. A placeholder is
  `count × hoursPerWeek / 5` each weekday, no absences. Ramp: `rampWeeks === 0 ? 1 : min(1, w / (5 × rampWeeks))`,
  `w = countWorkingDays(from, addCalendarDays(dates[d], 1), holidaySet)` (the first working day counts 1).
  `share[d] = hours(d) × ramp(d) / teamHours`; `cost[d] = hours(d) × ratePerHour` (no ramp), both on the same day
  window as availability.
- Rate: a directory person's role `materializeRoleRates(role, workdayHours).internalRate`; no role or 0 → 0 with
  `no-rate`; `isExternal` → 0 with `external`. A placeholder's `currencyToBase(rate, { currency }, fxRates,
  baseCurrency)`, `at-par` when `resolveRateSource(...)` is "unresolved".

- [ ] **Step 1: Write the failing tests** (today 2026-10-14, no holidays, horizon 30 for readable arrays)
  - added people: "team hours are booked hours over every window day, zero days included" (12 window days, 120 h on
    six of them → 10); "team hours are null below the spend floor, all zero, or under 1 h"; "a budget allocation or a
    task completed inside the window puts a person on the team; one completed before the window does not"; "a
    Shift's weekday hours are rescaled to hoursPerWeek and its weekend hours ignored" (Shift [4,8,8,8,8,8,4],
    hoursPerWeek 20 → 4 h each weekday); "an absence removes that day's hours from delivery and cost"; "ramp counts
    from the stored from, so a past start keeps its progress" (from 10 working days before today, rampWeeks 4: today
    is w = 11, so day 1 ramp = 12/20); "rampWeeks 0 is full speed at once"; "a placeholder converts its rate to the
    baseline at read time" (USD 100 with a USD rate → `currencyToBase` value, `rateNote` "ok"; an unresolved currency →
    par, `at-par`); "an external directory person adds delivery and no cost"; "no role means rate 0 with no-rate";
    "a gone person is inert" (Review Focus 2); "a person who completed a task inside the window goes inert" (Review
    Focus 2); "without team hours the row is inert with needs-booked-hours".
  - schedule: "overlapping availability multiplies, then clamps" (130 % and 40 % on one day → 0.52; 300 % twice →
    3); "added shares are added after the clamp and not clamped" (availability 80 % + share 0.5 → 1.3; spendScale
    0.8); "a past from counts from day 1; an until before today is ended"; "a Saturday change applies from Monday";
    "a from past the last simulated day applies on no day"; "a gone milestone counts as unattributed and is flagged"
    (Review Focus 2); "addedShareAtFullSpeed sums the sized rows" (31 h team, 40 h/week → 8/31).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS. Mutation: clamp after adding the shares
  → "added after the clamp" fails; count ramp from today → "keeps its progress" fails.
- [ ] **Step 5: Commit** — `feat: size added people and build a scenario's day schedules (§502)`

### Task 8: The comparison runner, outside React

**Files:**
- Create: `src/app/forecast-scenario-compare.ts`
- Modify: `src/app/forecast/app-forecast.ts` (export `chanceOnTime`)
- Test: `src/app/forecast-scenario-compare.test.ts`

**Interfaces:**
- Consumes: Tasks 2–7; `simulateCostFromRun` (Task 4).
- Produces:

```ts
// app-forecast.ts
export function chanceOnTime(planEnd: string, today: string, holidaySet: ReadonlySet<string>, distribution: Int32Array, hasOpen: boolean): number | null;

// forecast-scenario-compare.ts — pure, i18n-free (the view now, get_forecast in §4.4)
export type ScenarioRunInput = {
  tasks: readonly Task[]; milestones: readonly Milestone[]; today: string; holidaySet: ReadonlySet<string>;
  window: HistoryWindow; unit: ForecastUnit; planEnd: string;
  directory: ScenarioDirectory;
  /** Per-unit facts; null when the Budget module is off or there are no buckets. */
  budgetFacts: ForecastFactsByUnit | null;
  /** Cost rows only when the simulation switch AND the Budget module are on (as the Forecast view's cost card). */
  costOn: boolean;
};
export type ScenarioColumn = {
  forecast: ScheduleForecastResult;
  chanceOnTime: number | null;
  cost: CostAtFinish | null;          // null when !costOn or no facts or the run is insufficient
  schedule: ScenarioSchedule | null;  // null for As is
};
export type ScenarioComparison = {
  asIs: ScenarioColumn;
  scenarios: readonly { scenario: ForecastScenario; column: ScenarioColumn }[];
  /** The context every column was built with; the editor reads it, so it sees the same window. */
  context: ScheduleContext;
};
/** The one way to build a ScheduleContext: dates, onTeam and teamHours from the given window dates. */
export function buildScheduleContext(input: ScenarioRunInput, windowDates: readonly string[]): ScheduleContext;
/** One column for any change list (null = As is); `get_forecast`'s `whatIf` calls this with an unsaved list. */
export function computeScenarioColumn(input: ScenarioRunInput, changes: readonly ScenarioChange[] | null,
  context: ScheduleContext): ScenarioColumn;
export function computeScenarioComparison(input: ScenarioRunInput, scenarios: readonly ForecastScenario[]): ScenarioComparison;
```

Every column calls `computeScheduleForecast` with `whatIf: DEFAULT_WHAT_IF`, `howManyTarget: today` (the comparison
shows no How-many, so it costs nothing) and, for a scenario, `changes: schedule.changes`. `computeScenarioComparison`
runs As is first and builds the context from its `forecast.windowDates` (or `ForecastInsufficient.windowDates`) with
`hoursFacts = budgetFacts?.hours ?? null`. `chanceOnTime(planEnd, today, holidaySet, distribution,
distribution.some((d) => d > 0))`. Cost: `simulateCostFromRun(forecast, budgetFacts.eur, "eur",
schedule?.spendScale ?? 1, schedule?.addedCost)`.

- [ ] **Step 1: Write the failing tests** (a fixture with 50 open tasks, a steady 60-day history, two milestones,
  budget facts with eur and hours `dated` over the window, one role with `internalRate` 80, one Shift)
  - "a scenario with no changes shows exactly the As-is numbers" (`column.forecast` deep-equals `asIs.forecast`, cost
    equal) — §5.4;
  - "Save as scenario shows what What-if showed (tasks unit)": `whatIfToScenarioChanges({ scopeTasks: 3,
    scopePercent: 10, capacityPercent: 130 }, 50, today)` as a column equals `computeScheduleForecast` with that
    What-if on `when`, `trialDays` and `milestones`, and its cost equals `simulateCostFromRun(run, eur, "eur", 1.3)`;
  - "added people bring the finish forward and raise cost at finish" (P80 date earlier, P80 cost higher than As is);
  - "an availability change barely moves cost at finish" (|ΔP80 cost| < 5 % of As is at 150 %);
  - "the on-team check follows the run's window" (Review Focus 3: a person whose task completed 40 working days ago
    is sized at window 30 and inert at window 60);
  - "the editor's context is the one the columns used" (Review Focus 3: `comparison.context` deep-equals
    `buildScheduleContext(input, asIs.forecast.windowDates)` and its `onTeam` matches the inert rows);
  - "effort unit sizes scope rows at the median estimate" (Review Focus 5: +2 tasks → `backlog` + 2 × median);
  - "below the floor every column is insufficient and costs nothing" (`cost` null);
  - "no budget facts: no cost and added people inert with needs-booked-hours".
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat: compute every scenario column outside React (§502)`

### Task 9: Create, edit, rename and delete — activity log and undo

**Files:**
- Create: `src/app/use-forecast-scenarios.ts`
- Modify: `src/app/activity-log.ts` (`ActivityKind` + `ACTIVITY_KIND_TO_KEY`: `forecastScenario.created`,
  `forecastScenario.updated`, `forecastScenario.deleted`), `src/app/undo/use-undo-stack.ts` (`UndoEntityKey`,
  `ENTITY_SINGULAR`, `ENTITY_PLURAL`, `ENTITY_KEY_SET`: `forecastScenario`), `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/use-forecast-scenarios.test.tsx`, `src/app/undo/use-undo-stack.test.tsx` (the prefix sweep must pass
  unchanged)

**Interfaces:**
- Consumes: `useWorkspace().forecastScenarios` / `setForecastScenarios` (Task 6), Task 5's list ops and validation,
  `mintId` (`./id-mint-session`), `resolveEntitySave` (`./entity-id-mint`), `diffFields`, `reportSilentFailure`
  (`./guard-feedback`).
- Produces:

```ts
export type ScenarioDraft = { name: string; changes: readonly ScenarioChange[] };
export type ForecastScenariosApi = {
  scenarios: readonly ForecastScenario[];
  canCreate: boolean;                  // scenarios.length < MAX_FORECAST_SCENARIOS
  /** The id an editor opened for a new scenario starts from: mintId("forecastScenario", scenarios). */
  mintId: () => number;
  createScenario: (openId: number, d: ScenarioDraft) => number | null; // the id, or null when refused (cap, invalid)
  updateScenario: (id: number, d: ScenarioDraft) => boolean;          // false when the row vanished
  renameScenario: (id: number, name: string) => boolean;
  deleteScenario: (id: number) => void;
};
export function useForecastScenarios(args: {
  lang: Lang; showToast?: (kind: "info" | "error", text: string) => void;
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges?: (kind: ActivityKind, changes: readonly FieldChange[], ...args: (string | number)[]) => void;
  capture?: UndoStackApi["capture"];
}): ForecastScenariosApi;
```

Behaviour: create decides by intent (`resolveEntitySave(scenarios, openId, true, () => mintId("forecastScenario",
scenarios))`), appends through a functional setter, logs `forecastScenario.created (id, name)` and captures nothing.
Update and rename: `capture({ setter, kind: "forecastScenario.updated", edited: [before], editedAfter: [after],
fromArray, name })` (one entry whatever changed) and one log entry. `diffFields` skips arrays, so the hook appends a
synthetic change `{ field: "changes", from: "<n> rows", to: "<m> rows" }` (counts) when the rows differ
(`JSON.stringify` compare) — a rows-only edit then says what changed. Delete:
`capture({ … kind: "forecastScenario.deleted", removed: [doomed], fromArray, name })`, log; no
`allowDestructiveSave` (the slice is not counted by the save guards, so an arm would leak to the next save). A
concurrent delete during an edit shows `guardEditVanished` through `reportSilentFailure` and writes nothing.
i18n: `activityForecastScenarioCreated` "Scenario #{0} created: {1}", `…Updated` "Scenario #{0} updated: {1}",
`…Deleted` "Scenario #{0} deleted: {1}"; `undoEntityForecastScenario` "scenario", `undoEntityForecastScenarios`
"scenarios" (DE with real umlauts).

- [ ] **Step 1: Write the failing tests** (render the hook inside `TestProviders` with a recording `capture` and
  `logActivity`) — "create appends, logs created and captures nothing"; "a create whose open-time id was taken since
  re-mints and leaves the concurrent scenario untouched" (seed the collision between `mintId()` and save); "a deleted
  scenario's id is not reused by the next create"; "create is refused at the cap"; "an edit that changes name and
  rows is ONE undo entry and one log entry whose changes are the name diff plus the synthetic row count"; "a rows-only
  edit logs only the row count"; "rename is one undo entry"; "delete captures the removed row and logs deleted"; "undo
  of an edit restores the old changes"; "undoing a delete at the cap restores a fifth scenario" (Review Focus 1: four
  live, delete one, create one, undo the delete → five); "editing a scenario another tab deleted toasts and writes
  nothing".
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (EN keys in `i18n.ts`; DE via a node utf8 script with `\r\n`
  anchors). **Step 4: Run** the two files — PASS; `npx tsc --noEmit` 0 errors (key parity, `ENTITY_SINGULAR` record).
- [ ] **Step 5: Commit** — `feat: create, edit, rename and delete forecast scenarios with log and undo (§502)`

### Task 10: Scenarios mode — the comparison view

**Files:**
- Create: `src/app/forecast-scenarios-view.tsx`, `src/app/forecast-scenario-tables.tsx`
- Modify: `src/app/forecast-toolbar.tsx` (`ForecastMode` = `"quick" | "whatif" | "scenarios"`, third segment;
  `forecastCapacityPercent` EN "Availability (%)", DE "Verfügbarkeit (%)"), `src/app/forecast-range-bar.tsx`
  (optional `axis`), `src/app/forecast-panel.tsx` (`scenarios` prop; export `InsufficientState`; skip `result` and the
  cost card in Scenarios mode), `src/app/workspace-section.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/forecast-scenarios-view.test.tsx`, `src/app/forecast-scenario-tables.test.tsx`,
  `src/app/forecast-range-bar.test.tsx`, `src/app/forecast-panel.test.tsx`,
  `src/app/workspace-section.forecast-cost.test.tsx`

**Interfaces:**
- Consumes: `computeScenarioComparison`, `ScenarioRunInput`, `ScenarioComparison` (Task 8), `ForecastScenariosApi`
  (Task 9).
- Produces:

```ts
// forecast-panel.tsx — new optional prop; absent (tests, older callers) = no Scenarios segment, no Save as scenario
export type ForecastScenariosProps = { api: ForecastScenariosApi; directory: ScenarioDirectory; readOnly: boolean };
export function InsufficientState(p: { lang: Lang; result: ForecastInsufficient }): JSX.Element; // now exported
// forecast-range-bar.tsx — new optional prop: one shared axis for every row; absent = today's own-axis behaviour
axis?: { lo: string; hi: string };
// forecast-scenario-tables.tsx
export type ComparedColumn = { key: string; name: string; column: ScenarioColumn };
export function ScenarioComparisonTable(p: { lang: Lang; columns: readonly ComparedColumn[]; currency: BudgetCurrency }): JSX.Element;
export function ScenarioMilestoneTable(p: { lang: Lang; milestones: readonly Milestone[]; columns: readonly ComparedColumn[] }): JSX.Element;
// forecast-scenarios-view.tsx — the view opens the editor and rename dialog itself (Task 11 fills them in)
export function ForecastScenariosView(p: { lang: Lang; input: ScenarioRunInput; scenarios: ForecastScenariosProps }): JSX.Element;
```

The view follows spec §4.2's five parts. What the spec leaves open:
- Range bars share the axis `{ lo: today, hi: the latest in-horizon P95 or plan end }`; a P50 or P80 beyond the
  horizon shows the text `forecastBeyond` ("> 5 y") in place of the bar.
- Table rows: `percentileWord(50|80|95)` + "(Pxx)" (owner decision: "Cautious (P95)"), "On time by plan end", and
  with a non-null `cost`: "Cost at finish (P80)" and "Chance over budget" (`budgetSimChanceOver`,
  `formatChanceOverBudget`). An `unavailable` cost spans both cost cells with `costUnavailableText` (the cost card's
  missing-input line). Each figure is a `SimValue` labelled `"<row>, <column>"`; headers are `<th scope="col">`.
- Under each scenario's header, once: the distinct reasons of its inert Add-people rows (person gone, already on the
  team, ended, needs booked hours — §4.1a "Where reasons show") and the "more than double the team" warning when
  `addedShareAtFullSpeed > 1`. Below the table, one note per cost caveat (no rate, converted at par).
- Milestones: sorted by the As-is chance worst first, non-chance states as text and last.
- Per-scenario actions use `rowLabel(verb, token)` from `useRowTokens`; Delete goes through `useConfirm`
  (`tone: "danger"`); "New scenario" is disabled at `!api.canCreate` with `forecastScenarioCapReached` visible as its
  `aria-describedby`. Below the floor: `InsufficientState` once, then the scenario list with its actions. `readOnly`:
  no actions, no New.
- The panel builds `input` in a `useMemo` over its fields (tasks, milestones, today, holidaySet, window, unit,
  planEnd, directory, budgetFacts, `costOn = showSimulation && budgetEnabled`); the view runs
  `computeScenarioComparison` in ONE `useMemo` keyed on `input` and the scenario list. In Scenarios mode the panel's
  own `result` and cost card are not computed, so a mode switch runs exactly As is + one forecast per scenario.

`workspace-section.tsx`: rename `forecastCostOn` (line ~328) to `forecastFactsOn = activeTab === "forecast" &&
budgetEnabled` — the switch is no longer required, because Add-people sizing needs booked hours; the cost card and
cost rows still need `showSimulation`. Call `useForecastScenarios({ lang, showToast: useToastContext(), logActivity,
logActivityChanges, capture: onCaptureUndo })` unconditionally (`useToastContext` from `./toast-context`; the section
has no `showToast` of its own) and pass `scenarios={{ api, directory, readOnly: isPopout }}` with `directory =
{ resources, roles, shifts, absences, budgets, fxRates, workdayHours, baseCurrency: plan.currency }` in a `useMemo`.

New EN keys (DE with real umlauts): `forecastModeScenarios` "Scenarios", `forecastScenariosAsIs` "As is",
`forecastScenarioNew` "New scenario", `forecastScenarioEdit` "Edit", `forecastScenarioRename` "Rename",
`forecastScenarioDelete` "Delete", `forecastScenarioDeleteConfirm` "Delete scenario “{0}”? You can undo this.",
`forecastScenariosNone` "No scenarios yet. A scenario is a list of dated changes, compared with the plan as it is.",
`forecastScenarioCapReached` "A project keeps at most {0} scenarios.", `forecastScenarioRowOnTime` "On time by plan
end", `forecastScenarioRowCostP80` "Cost at finish (P80)", `forecastScenarioRangeTitle` "Finish range",
`forecastScenarioTableTitle` "Compared", `forecastScenarioMilestonesTitle` "Milestones: chance on time", the four
inert reasons, `forecastScenarioDoublesTeam` "Added people more than double the team; the team-average assumption is
weak here.", `forecastScenarioNoRate`, `forecastScenarioAtPar`, `forecastScenarioColumnInsufficient` "Not enough
history for this scenario.".

- [ ] **Step 1: Write the failing tests**
  - tables: "every figure is a SimValue named by row and column"; "cost rows only with a cost"; "an unavailable cost
    reads the missing-input line"; "milestones sort by the As-is chance, worst first, states last"; "each inert reason
    shows once under its column's header"; "the P95 row reads Cautious (P95)".
  - range bar: "a shared axis places the same date at the same x in two bars"; "without axis the bar is unchanged"
    (inline HTML snapshot of the current output taken before the change).
  - view (inside `TestProviders`): "As is first, then scenarios in saved order"; "New scenario is disabled with its
    reason at four"; "delete asks, then deletes"; "duplicate scenario names get row-unique action names" (Review
    Focus 1); "read-only in a popout" (Review Focus 4: no Save as scenario, New, Edit, Rename or Delete); "below the
    floor the message shows once and the list stays editable".
  - panel: "Scenarios mode runs As is plus one forecast per scenario, once per input change" (spy on
    `computeScheduleForecast`: switching to Scenarios with 2 scenarios → 3 calls; a rerender with the same props → 0
    more); "Quick and What-if never run the comparison" (spy on `computeScenarioComparison`, 0 calls); the toolbar-order
    test extended with the third segment; the six `"Capacity (%)"` queries in `forecast-panel.test.tsx` (lines 63, 69,
    75, 103, 381, 439) change to `"Availability (%)"` — the two `queryByLabelText(...).toBeNull()` at 63 and 75 would
    otherwise pass forever.
  - `workspace-section.forecast-cost.test.tsx`: "passes null while the simulation is off" becomes "passes the facts
    while the simulation is off (added-people sizing needs booked hours); the cost card stays hidden".
- [ ] **Step 2: Run** the five files — FAIL.
- [ ] **Step 3: Implement** (DE via the node utf8 script). Keep `forecast-panel.tsx` an orchestrator.
- [ ] **Step 4: Run** — PASS; `npx tsc --noEmit` 0 errors.
- [ ] **Step 5: Commit** — `feat: compare saved scenarios with As is in the Forecast view (§502)`

### Task 11: The scenario editor and "Save as scenario"

**Files:**
- Create: `src/app/forecast-scenario-editor.tsx`, `src/app/forecast-scenario-change-rows.tsx`,
  `src/app/forecast-scenario-name-dialog.tsx`
- Modify: `src/app/forecast-scenarios-view.tsx` (opens the editor and the rename dialog),
  `src/app/forecast-toolbar.tsx` + `src/app/forecast-panel.tsx` ("Save as scenario" in What-if mode),
  `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/forecast-scenario-editor.test.tsx`, `src/app/forecast-scenario-name-dialog.test.tsx`,
  `src/app/forecast-panel.test.tsx`

**Interfaces:**
- Consumes: Task 5 (`validateScenarioChange`, `validateScenarioDraft`, `whatIfToScenarioChanges`, limits), Task 7
  (`buildScenarioSchedule` for the live row status), Task 8 (`ScenarioComparison.context`), Task 9
  (`ForecastScenariosApi`).
- Produces:

```ts
export function ForecastScenarioEditor(p: {
  lang: Lang; open: boolean; scenario: ForecastScenario | null; /* null = new */ openId: number;
  context: ScheduleContext; /* comparison.context — the window the columns used */ list: readonly ForecastScenario[];
  onSave: (d: ScenarioDraft) => void; onCancel: () => void;
}): JSX.Element | null;
export function ForecastScenarioNameDialog(p: {
  lang: Lang; open: boolean; title: string; initialName: string; note?: string; list: readonly ForecastScenario[];
  exceptId: number | null; onSave: (name: string) => void; onCancel: () => void;
}): JSX.Element | null;
```

The editor is spec §4.2's dialog on the shared `Modal` (`ariaLabelledby` on `ModalHeader`'s title; Escape and Tab per
`docs/AGENTS/ui-shell.md` "dismissal"). What the spec leaves open:
- The person picker is a native `Select` of active resources: an external one reads "… (no cost — external in the
  directory)"; an on-team one (`context.onTeam`) is a disabled option "… (already on the team — use an availability
  change)". Picking a person prefills `hoursPerWeek` from their Shift's Mon–Fri sum, else 40. The milestone `Select`
  lists attributable milestones plus "No milestone".
- Under each row its live status from `buildScenarioSchedule(draft.changes, context)`: ended, milestone gone, person
  gone, already on the team, no cost (external), no rate, at par, or the basis "team books ≈ {0} h per day → +{1}
  h/week ≈ +{2} at full speed"; above the rows the "more than double the team" warning when
  `addedShareAtFullSpeed > 1` (§4.1a "Clamp").
- Control names are row-unique: `"Change {n}: <field>"`. The three add buttons are disabled at 20 rows with the
  reason visible.
- Save runs `validateScenarioDraft`, then each row's `validateScenarioChange` (with `context.onTeam`), shows each
  message beside its field through `aria-describedby`, focuses the first invalid control and writes nothing until
  valid. The draft is local state seeded at mount; the view mounts the editor with
  `key={scenario?.id ?? "new-" + openId}`, so no state is set in an effect.

Save as scenario: a toolbar button in What-if mode (absent without the `scenarios` prop or when `readOnly`; disabled at
the cap with the reason). It opens the name dialog with `whatIfToScenarioChanges(usedWhatIf, open.length, today)` (the
clamped What-if the engine uses); when `scopePercent ≠ 0` the note reads `forecastSaveAsScenarioScopeNote` "{0} = {1}
today" (the signed percent via `forecastPercent`, "+" for a positive value; the tasks via
`formatAmount(percentTasks, "tasks", lang)`). Save calls `api.createScenario(api.mintId(), { name, changes })` and
switches the mode to Scenarios.

New EN keys: `forecastSaveAsScenario` "Save as scenario", `forecastSaveAsScenarioScopeNote`,
`forecastScenarioEditorTitleNew` "New scenario", `forecastScenarioEditorTitleEdit` "Edit scenario",
`forecastScenarioName` "Name", `forecastScenarioAddAvailability` "+ Availability change",
`forecastScenarioAddPeople` "+ Add people", `forecastScenarioAddScope` "+ Scope change", `forecastScenarioChangeRow`
"Change {0}: {1}", the field labels (from, until, on, tasks, milestone, no milestone, person, directory, placeholder,
hours per week, label, count, rate per hour, currency, ramp-up weeks, remove), the row statuses, and the validation
messages ("Enter a name.", "Another scenario already has this name.", "At most {0} characters.", "Between {0} and
{1}.", "Enter a valid date.", "Must not be before the start date.", "Enter a whole number other than 0.", "At most {0}
changes.", "This milestone is finished.", "This person is archived.").

- [ ] **Step 1: Write the failing tests**
  - editor: "adds one row of each kind and saves the draft" (`onSave` called with the three rows); "refuses a
    duplicate name and an out-of-range percent, says why beside the field and focuses the first"; "the on-team person
    is a disabled option and an external one says no cost"; "picking a person prefills hours from their Shift";
    "a row's status reads ended / milestone gone / person gone"; "the doubles-the-team warning shows in the editor";
    "control names are row-unique" (two availability rows → "Change 1: Availability (%)" and "Change 2: Availability
    (%)"); "Escape cancels and writes nothing"; "the add buttons are disabled at 20 rows with the reason".
  - name dialog: "trims, refuses empty and taken names"; "shows the frozen scope note".
  - panel: "Save as scenario turns the clamped What-if into rows and switches to Scenarios" (`createScenario` called
    with `whatIfToScenarioChanges`' rows; the note reads "+10% = 6 tasks today" for 55 open tasks at +10 %); "Save as
    scenario is disabled at four with the reason".
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (DE via the node utf8 script). **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat: the scenario editor and Save as scenario (§502)`

### Task 12: Measure, axe, docs, changelog and the gates

**Files:**
- Create: `e2e/forecast-scenarios.spec.ts`
- Modify: `docs/AGENTS/forecast.md`, `docs/AGENTS/activity-log.md`, `CHANGELOG.md`, `docs/open-followups.md` (§502
  status line only)

- [ ] **Step 1: Measure the 5-column cost (constraint 3).** A throwaway `$TEMP/scenario-probe.ts` run with
  `npx vite-node` from the repo root, on the synthetic fixture of forecast.md's "Measured cost of the cost pass"
  (200 open tasks, 60-day history, eur and hours facts) plus one role and one resource: time
  `computeScenarioComparison` with four scenarios, median of 7 after one warm-up, for (a) four empty scenarios, (b) the
  What-if extremes as scenarios — availability 10 %, scope +600 tasks, availability 300 % + scope +600, two added
  placeholders of 20 × 60 h — and (c) (b) with `costOn` false. Delete the file afterwards.
- [ ] **Step 2: Axe.** Write `e2e/forecast-scenarios.spec.ts`: `test.skip(RELEASE_HIDDEN_VIEWS.includes("forecast"))`;
  go to `#forecast`, select "All history", pick the Scenarios segment, create one scenario through the editor (one row
  of each kind), scan with the editor open and again on the comparison, failing on critical or serious violations
  (the `AxeBuilder` tags of `e2e/a11y.spec.ts`). Then, locally only: remove `"forecast"` from `RELEASE_HIDDEN_VIEWS`
  in `src/app/feature-modules.ts`, run `PORT=3100 npx playwright test e2e/forecast-scenarios.spec.ts e2e/a11y.spec.ts --project=chromium -g "Forecast" --workers=1; echo "EXIT=$?"`
  (expected 0), restore the line with an anchored node write, and prove `git diff --stat -- src/app/feature-modules.ts`
  is empty. The held-back unit tests are not run while it is un-hidden.
- [ ] **Step 3: Docs.** `docs/AGENTS/forecast.md`: a new section "Saved scenarios (build step 2)" — the module map rows
  for the new files; the per-day capacity drawer and `bestBetween`; arrivals (cap, finish, removal, How many);
  milestone attribution (queue keys, the owner's date-order placement, later arrivals, own-work clamp, cap without
  unattributed removals); common random numbers (the seed, fixed draws per trial, the cost sub-stream); added people
  (team hours, on-team, ramp, rates, externals, at par); persistence (meta-blob, six paths, storage-only, kept by a
  version restore, `counted: false`, ids from `mintId`); the 4-cap as a creation rule; Save as scenario's exact parity
  in the tasks unit only (effort mode can differ); the Step 1 table with its reproduce command; the facts gating
  change. Update the "Seed" bullet, the "What-if" section (the field is Availability; Save as scenario), the
  early-exit paragraph (every trial now consumes a fixed number of draws), part 3's "Seeded" bullet (per-trial
  sub-stream) and the demo milestone sentence if Task 3 found it moved. `docs/AGENTS/activity-log.md`: add
  `forecastScenarios` to the slices the restore funnel omits (re-run the three commands there and paste their new
  output; do not quote a count without them). `CHANGELOG.md` [Unreleased] Notes: "**Saved forecast scenarios are
  built but held back with the forecast (§502).** …" in the style of the part-3 line. `docs/open-followups.md` §502:
  saved scenarios built and held back; the AI tool, part 4 and the un-hide remain.
- [ ] **Step 4: Gates** (each unpiped, `echo "EXIT=$?"`, expected 0): `npm run docs:symbols:check`,
  `npm run docs:claims:check`, `npm run dup:check`, `npm run size:check`, then commit and run
  `node scripts/gate-local.mjs --group static` on the committed tree.
- [ ] **Step 5: Commit** — `docs: record saved forecast scenarios and their measured cost (§502)`

---

## Self-review notes

- Spec coverage: §4.1 → Tasks 2, 5, 7; §4.1a → Task 7 (+ Task 4 cost, Task 8 sizing gate, Tasks 10–11 reasons);
  §4.2 → Tasks 10–11; §4.3 → Tasks 5, 6, 9; §4.5 → Tasks 1–4, 8; §5.1 → Tasks 1–3; §5.2 → Tasks 9–12; §5.3 → Tasks
  10, 12; §5.4 → Tasks 3, 4, 8; §5.5 → Tasks 4, 7; §5.6 → no register number is opened by this plan.
- Out of scope here, by the brief: §4.4 (`get_forecast`, the two write tools, the Ask-Claude chips). Task 8's
  `buildScheduleContext` / `computeScenarioColumn` / `computeScenarioComparison`, Task 5's validation and list ops,
  and the `forecastScenario` mint kind are the seams it uses.
