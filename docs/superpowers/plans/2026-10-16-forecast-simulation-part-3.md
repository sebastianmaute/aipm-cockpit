# Forecast simulation part 3 — budget simulation (§502) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A simulated cost at finish (P50/P80/P95) and chance over budget, drawn from the same Monte Carlo runs as the
schedule, shown beside the calculated budget forecast on the pace card, the burn charts, the burn tile, the change
table and as a third question in the Forecast view — all held back with the Forecast view.

**Architecture:** The schedule engine keeps each trial's finish day in trial order. A new pure module carries each
trial's spend to that trial's finish day by bootstrapping real past spend days, so a slow run is slow on both. The
result rides on the existing `ForecastBundle` as an optional `sim` field, so every budget surface that already takes
the bundle gets it without new prop chains; the calculated pace forecast and everything it drives stay untouched.

**Tech Stack:** TypeScript, React 19 / Next.js (this repo's pinned version), Vitest + RTL, Playwright (axe) in CI.

**Spec:** `docs/superpowers/specs/2026-10-15-forecast-simulation-surfaces-design.md` §3.6, the part-3 rows of §3.7,
§4, §5 ("Spend window and floor"). Order and completion rule:
`docs/superpowers/specs/2026-10-16-forecast-scenarios-and-ai-tool-design.md` §2, §6 step 1.

## Global Constraints

- Engine rules: seeded and deterministic, 10,000 trials (`FORECAST_TRIALS`), 1,300-working-day horizon
  (`MAX_HORIZON_WORKING_DAYS`), nearest-rank `percentile`, engine modules i18n-free and React-free.
- **The calculated "at current pace" figure does not change** and keeps driving the Budget health dot
  (`paceVacHealth`), the forecast gap and the export pace leg, whatever the switch says.
- Simulated spend days come from the **same window as the schedule** (the app run's history days, 60 working days by
  default); the cost range needs the schedule floor **and** the spend floor; below either, show today's figures and a
  note saying which is missing.
- Money in the baseline currency (`plan.currency`, §476), contract basis as the existing forecast (reuse the pace
  forecast's `dated` values — never convert again).
- Every simulated figure carries the existing "sim" marking (`SimValue` / `SimBadge`, `src/app/sim-value.tsx`).
- Nothing renders or runs while `isSimulationActive(...)` is false (view hidden or switch off).
- The Dashboard and Budget report must not run the schedule simulation more than once per input change: every caller
  uses `computeAppForecast` with the SAME collection references (pinned by `forecast-shared-run.test.tsx`).
- Repo rules: EN/DE i18n parity with real umlauts (`i18n.de.ts` only via a node utf8 script with `\r\n` anchors);
  `src/app` files are CRLF — never `sed -i`; palette tokens only; accessible names; no `set-state-in-effect`;
  `task-manager.tsx` gains no lines; storage formats untouched (nothing new is persisted in this part).
- Commits cite §502; never `--amend` (`git commit --only <paths>`); no `Claude-Session:` trailer, no URLs.
- Before every push: `npx eslint --max-warnings=0 <changed files>` and `npx tsc --noEmit`, 0 errors. Locally run only
  targeted vitest, under the lock:
  `if mkdir /c/Projects/.vitest-lock 2>/dev/null; then npx vitest run <files> > /tmp/p3.log 2>&1; echo "EXIT=$?"; rm -rf /c/Projects/.vitest-lock; else echo LOCKED; fi`

## Review Focus

1. **A trial that never finishes inside the horizon** — its cost is not a number; P95 must read "beyond" and the trial
   must count as over budget, never as a cheap trial. → Task 2 test "beyond-horizon trials".
2. **Booking history shorter than the window** (project booked for 6 days of a 60-day window) — days before the first
   booking must not count as zero-spend days, or the cost range is far too low. → Task 2 test "days before the first
   booking are not samples".
3. **No budget (BAC 0) or no open work** — chance over budget is meaningless without a budget (null, hidden), and with
   nothing open the cost is exactly today's actual cost. → Task 2 tests "no budget", "nothing open".
4. **Switch off while Budget is on** — the pace card, burn tile and charts must render byte-identically to today. →
   Task 4/5 tests "switch off renders exactly as before".
5. **Hours unit** — the chart's hours switch must draw the hours cost band from hours bookings, not money. → Task 5
   test "hours unit uses the hours simulation".

---

### Task 1: Per-trial finish days and window dates from the schedule run

**Files:**
- Modify: `src/app/forecast/simulate.ts` (`simulateWhen`)
- Modify: `src/app/forecast/index.ts` (`ScheduleForecast`, `computeScheduleForecast`)
- Modify: `src/app/forecast/app-forecast.ts` (`AppForecast`)
- Test: `src/app/forecast/simulate.test.ts`, `src/app/forecast/index.test.ts`, `src/app/forecast/app-forecast.test.ts`

**Interfaces:**
- Produces: `simulateWhen(...)` returns `{ days: Int32Array; trialDays: Int32Array; beyondShare: number }` — `trialDays`
  is the unsorted per-trial result in trial order (`horizon + 1` = beyond), `days` stays the sorted copy.
- Produces: `ScheduleForecast.trialDays: Int32Array` and `ScheduleForecast.windowDates: readonly string[]` (the
  history's working days, `history.days`).
- Produces: the `"forecast"` arm of `AppForecast` gains `trialDays: Int32Array` and `windowDates: readonly string[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// simulate.test.ts
it("trialDays is the unsorted per-trial result and sorts to days", () => {
  const r = simulateWhen([0, 1, 2, 3], 20, opts(mulberry32(7)));
  expect(r.trialDays).toHaveLength(r.days.length);
  expect(Array.from(r.trialDays).sort((a, b) => a - b)).toEqual(Array.from(r.days));
  expect(Array.from(r.trialDays)).not.toEqual(Array.from(r.days)); // trial order, not sorted
});
// index.test.ts
it("exposes trialDays and the history window dates without changing any result", () => {
  const f = computeScheduleForecast(FIXTURE) as ScheduleForecast;
  expect(f.windowDates).toHaveLength(f.windowDays);
  expect(Array.from(f.trialDays).sort((a, b) => a - b)).toEqual(Array.from(f.distribution));
});
```

Use the file's existing option helper and fixture (read the test file first); keep every existing digest test as is —
they must stay green unchanged, which is the proof that no number moved.

- [ ] **Step 2: Run them to verify they fail** — the vitest lock command on the three test files. Expected: FAIL
  (`trialDays` / `windowDates` undefined).
- [ ] **Step 3: Implement** — in `simulateWhen` copy `days` into `trialDays` before `days.sort()`; thread both fields
  through `computeScheduleForecast` (`windowDates: history.days`) and `computeAppForecast`.
- [ ] **Step 4: Run the three test files** — Expected: PASS, including every pre-existing digest assertion.
- [ ] **Step 5: Commit** — `feat: keep per-trial finish days and the history window on the forecast run (§502)`

### Task 2: The cost-at-finish engine

**Files:**
- Create: `src/app/forecast/cost.ts`
- Modify: `src/app/forecast/constants.ts` (add `MIN_SPEND_WORKING_DAYS = 10`)
- Test: `src/app/forecast/cost.test.ts`

**Interfaces:**
- Consumes: `trialDays`, `windowDates` (Task 1); `DatedValue` (type-only import from `../budget-forecast`);
  `mulberry32`, `seedFrom` (`./rng`); `percentile` (`./simulate`).
- Produces:

```ts
export type CostAtFinish =
  | { kind: "sim"; p50: number | "beyond"; p80: number | "beyond"; p95: number | "beyond";
      /** Share of trials whose cost exceeds BAC (a beyond trial counts as over); null when BAC <= 0. */
      chanceOverBudget: number | null; spendDays: number }
  | { kind: "unavailable"; reason: "schedule-floor" | "spend-history"; spendDays: number; neededSpendDays: number };

/** Per-working-day spend in the window, from the first booking on (days before it are not samples). */
export function spendSamples(dated: readonly DatedValue[], windowDates: readonly string[]): number[];

export function simulateCostAtFinish(a: {
  trialDays: Int32Array; samples: readonly number[]; ac: number; bac: number; seedTag: string; horizon: number;
}): CostAtFinish;
```

Per trial `t`: `cost = ac + Σ` of `trialDays[t]` spend samples drawn with replacement from one rng stream seeded by
`seedFrom([...samples, ac, bac, seedTag, "cost"])`; a trial with `trialDays[t] > horizon` is `Infinity`. Sort ascending;
a percentile that lands on `Infinity` is `"beyond"`. Draw order is trial order, so the result is deterministic.
The caller decides "schedule-floor"; `simulateCostAtFinish` returns `"spend-history"` when
`samples.length < MIN_SPEND_WORKING_DAYS` or every sample is 0.

- [ ] **Step 1: Write the failing tests** (`cost.test.ts`)

```ts
const D = (date: string, value: number, bookedFrom = date): DatedValue => ({ date, bookedFrom, value, spread: false });
const WINDOW = Array.from({ length: 12 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);

it("sums spend per window day, zero days included", () => {
  expect(spendSamples([D("2026-10-01", 100), D("2026-10-01", 50), D("2026-10-03", 30)], WINDOW).slice(0, 3)).toEqual([150, 0, 30]);
});
it("days before the first booking are not samples", () => {
  expect(spendSamples([D("2026-10-07", 10)], WINDOW)).toHaveLength(6); // 07..12
});
it("is deterministic and carries each trial's own finish day", () => {
  const a = simulateCostAtFinish({ trialDays: Int32Array.from([0, 10, 20]), samples: Array(12).fill(100), ac: 1000, bac: 2500, seedTag: "eur", horizon: 1300 });
  expect(a).toEqual({ kind: "sim", p50: 2000, p80: 3000, p95: 3000, chanceOverBudget: 1 / 3, spendDays: 12 });
});
it("beyond-horizon trials read beyond and count as over budget", () => {
  const r = simulateCostAtFinish({ trialDays: Int32Array.from([1, 1301, 1301]), samples: Array(12).fill(1), ac: 0, bac: 1e9, seedTag: "eur", horizon: 1300 });
  expect(r).toMatchObject({ kind: "sim", p95: "beyond", p80: "beyond", chanceOverBudget: 2 / 3 });
});
it("nothing open: the cost is exactly today's actual cost", () => {
  const r = simulateCostAtFinish({ trialDays: new Int32Array(5), samples: Array(12).fill(7), ac: 420, bac: 400, seedTag: "eur", horizon: 1300 });
  expect(r).toMatchObject({ p50: 420, p80: 420, p95: 420, chanceOverBudget: 1 });
});
it("no budget: chance over budget is null", () => {
  expect(simulateCostAtFinish({ trialDays: Int32Array.from([3]), samples: Array(12).fill(5), ac: 0, bac: 0, seedTag: "eur", horizon: 1300 })).toMatchObject({ chanceOverBudget: null });
});
it("too little spend history is unavailable with the counts", () => {
  expect(simulateCostAtFinish({ trialDays: Int32Array.from([3]), samples: Array(9).fill(5), ac: 0, bac: 10, seedTag: "eur", horizon: 1300 }))
    .toEqual({ kind: "unavailable", reason: "spend-history", spendDays: 9, neededSpendDays: 10 });
});
it("a slow trial costs more than a fast one on varied spend (same runs drive both)", () => {
  const samples = [10, 0, 30, 5, 50, 0, 20, 10, 40, 15, 25, 35];
  const fastSlow = simulateCostAtFinish({ trialDays: Int32Array.from(Array(1000).fill(5).concat(Array(1000).fill(50))), samples, ac: 0, bac: 1e9, seedTag: "eur", horizon: 1300 });
  expect(fastSlow.kind === "sim" && fastSlow.p95 !== "beyond" && fastSlow.p95 > 50 * 10).toBe(true);
});
```

- [ ] **Step 2: Run** — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `spendSamples` and `simulateCostAtFinish` in `src/app/forecast/cost.ts`** (module docstring:
  "Simulated cost at finish (§502 part 3) — i18n-free, React-free").
- [ ] **Step 4: Run** — Expected: PASS. Then **mutation check** (revert each after): (a) count days before the first
  booking as samples → "days before the first booking" fails; (b) treat a beyond trial as cost `ac` → "beyond-horizon"
  fails; (c) draw a fixed day count for every trial → "same runs" test fails. Note the three kills in the commit body.
- [ ] **Step 5: Commit** — `feat: simulate cost at finish from the schedule runs (§502)`

### Task 3: The budget simulation on the forecast bundle, and the shared run in the Budget report

**Files:**
- Create: `src/app/budget-sim.ts`
- Modify: `src/app/budget-forecast.ts` (export `computeProjectForecastFacts`), `src/app/budget-forecast-bundle.ts`
  (`ForecastBundle.facts`, `ForecastBundle.sim`)
- Create: `src/app/use-app-forecast.ts`
- Modify: `src/app/dashboard-panel.tsx`, `src/app/budget-report-panel.tsx`, `src/app/reports.tsx`,
  `src/app/workspace-section.tsx` (pass `simulation`), `src/app/forecast-shared-run.test.tsx`
- Test: `src/app/budget-sim.test.ts`, `src/app/use-app-forecast.test.ts`, `src/app/forecast-shared-run.test.tsx`

**Interfaces:**
- Consumes: `AppForecast` (Task 1), `CostAtFinish`, `spendSamples`, `simulateCostAtFinish` (Task 2).
- Produces:

```ts
// budget-sim.ts — pure
export type BudgetSim = {
  /** Schedule finish dates from the same run (null = beyond the horizon). */
  finish: { p50: string | null; p80: string | null; p95: string | null };
  eur: CostAtFinish; hours: CostAtFinish;
};
/** null when the schedule run is absent (simulation off). Below the schedule floor both units are
 *  { kind: "unavailable", reason: "schedule-floor" } and `finish` is all null. */
export function computeBudgetSim(forecast: AppForecast | null, facts: ForecastFactsByUnit): BudgetSim | null;
/** A NEW bundle with `sim` set; the input bundle is never mutated. */
export function withBudgetSim(bundle: ForecastBundle, forecast: AppForecast | null): ForecastBundle;

// budget-forecast-bundle.ts
export type ForecastBundle = { /* existing */ facts: ForecastFactsByUnit; sim?: BudgetSim | null };

// budget-forecast.ts — the facts half of computeProjectForecast, for the Forecast view (Task 6)
export function computeProjectForecastFacts(a: ProjectForecastArgs): ForecastFactsByUnit | null;

// use-app-forecast.ts — the one way a component outside the Dashboard asks for the shared run
export function useAppForecast(a: AppForecastArgs & { active: boolean }): AppForecast | null;
```

`computeBudgetSim` single-entry memo keyed by `forecast` and `facts` identity (as `computeAppForecast`). Seed tags:
`"eur"` and `"hours"`. `useAppForecast` is a `useMemo` over `computeAppForecast`, returning null while `!active`.

- [ ] **Step 1: Write the failing tests**
  - `budget-sim.test.ts`: "returns null without a schedule run"; "schedule floor makes both units unavailable with
    reason schedule-floor"; "finish dates are the run's P50/P80/P95"; "eur and hours use their own dated values"
    (hours facts with different spend give a different hours P80); "withBudgetSim returns a new bundle and leaves the
    input untouched" (`expect(out).not.toBe(bundle); expect(bundle.sim).toBeUndefined()`); "memo returns the same
    object for the same inputs".
  - `use-app-forecast.test.ts`: "null while inactive and the engine never runs" (spy on `computeAppForecast`);
    "returns the shared run while active".
  - `forecast-shared-run.test.tsx`: add `"use-app-forecast"` to `SURFACES`, mount `BudgetReportPanel` with the same
    references next to the existing surfaces, and keep the existing assertion that the engine runs once per input
    change.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** `computeForecastBundle` keeps the facts it already builds (`facts` field). The Dashboard
  wraps `model.forecastBundle` with `withBudgetSim(bundle, forecast)` inside its existing forecast `useMemo` and passes
  the wrapped bundle to the tile bodies in place of `model.forecastBundle` (the `dashboard.ts` model and the budget RAG
  stay untouched). `BudgetReportPanel` gains an optional `simulation?: AppForecast | null` prop and wraps its bundle;
  `workspace-section.tsx` and `reports.tsx` compute it with `useAppForecast({ tasks, milestones, planEnd: plan.endDate,
  today, holidaySet, active: isSimulationActive(settingsOverrides, features) })` from the SAME context references the
  recorder and `useNextActions` use.
- [ ] **Step 4: Run** the three test files plus `dashboard-panel.test.tsx` and `budget-report-panel.test.tsx` —
  Expected: PASS. Add a test "the Budget health dot ignores the simulation": `paceVacHealth` input is identical with the
  switch on and off (assert the dashboard model's budget status for one fixture both ways).
- [ ] **Step 5: Commit** — `feat: attach the budget simulation to the forecast bundle from the shared run (§502)`

### Task 4: The "at current pace" card shows the simulated cost beside the calculated one

**Files:**
- Modify: `src/app/budget-forecast-cards.tsx` (`PaceCard`, `ForecastCards`), `src/app/budget-forecast-section.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/budget-forecast-cards.test.tsx`

**Interfaces:**
- Consumes: `ForecastBundle.sim` (Task 3).
- Produces: `ForecastCards` takes `sim?: BudgetSim | null` (passed by `ForecastSection` from `bundle.sim`).

UI: under the calculated `EacFigure` (unchanged), a block headed "Cost at finish" with `SimBadge`: rows "Even odds
(P50)", "Safe to commit (P80)", "Worst likely (P95)" — money via the card's `money`, `"beyond"` as the existing beyond
copy — and "Chance over budget" via `formatShare` (row hidden when null). In the hours line, one row "Hours at finish
(P80)" marked sim. Unavailable: one muted line naming what is missing — `schedule-floor`: "Not enough finished tasks to
simulate the finish yet."; `spend-history`: "Needs {0} working days with bookings in the window (has {1})." The block
renders only when `sim` is non-null, so the switch off leaves the card unchanged. The efficiency card is unchanged.

- [ ] **Step 1: Write the failing tests** — "switch off renders exactly as before" (render without `sim` and compare
  `container.innerHTML` with a snapshot taken from the same fixture before the change — store it as an inline string in
  the test); "shows P50/P80/P95 and the chance with the sim marking" (`getByText("Safe to commit (P80)")`, a `sim`
  badge inside the block, `getByText("80 %")` style figure from a fixed `BudgetSim`); "beyond reads as beyond";
  "names the missing spend history with both counts"; "hides the chance row without a budget"; "the calculated EAC
  figure is unchanged with the simulation on". German: `loadI18n("de")` and assert the DE heading renders.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (EN keys in `i18n.ts`, DE via a node utf8 script with `\r\n`
  anchors and real umlauts). **Step 4: Run** — PASS; `npx tsc --noEmit` 0 errors (key parity).
- [ ] **Step 5: Commit** — `feat: show the simulated cost at finish on the pace card (§502)`

### Task 5: Simulated bands on the burn charts, the burn tile line and the change-table row

**Files:**
- Modify: `src/app/burndown-geometry.ts` (`ChartInput`, `ChartModel`, `buildChartModel`)
- Modify: `src/app/burndown-chart.tsx`, `src/app/burndown-chart-panel.tsx`, `src/app/budget-change-table.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/burndown-geometry.test.ts`, `src/app/burndown-chart.test.tsx`, `src/app/burndown-chart-panel.test.tsx`,
  `src/app/budget-change-table.test.tsx`

**Interfaces:**
- Consumes: `BudgetSim` (Task 3) via `bundle.sim` — `BurndownChartPanel` already takes the bundle.
- Produces (geometry, pure):

```ts
export type ChartInput = { /* existing */ sim?: BudgetSim | null };
export type ChartModel = { /* existing */
  /** P50–P95 finish dates as a faint full-height band, P80 as a dashed line; null when off or unavailable. */
  simFinish: { from: string; to: string; p80: string } | null;
  /** Wedge from the last actual point to the P80 finish date spanning the P50..P95 cost, in the chart's unit
   *  and orientation (burndown: BAC − cost; cumulative: cost); null when off or unavailable. */
  simCost: { from: ChartPoint; at: string; low: number; high: number } | null;
};
```

`"beyond"` or null ends of the finish band clamp to the chart's last date; a `"beyond"` P95 cost makes `simCost` null
(nothing to draw honestly). The value domain grows to include the cost wedge. Unit picks `sim.eur` or `sim.hours`.

UI:
- Chart: the finish band (fill token at low opacity, the same faint treatment the spec asks of the Gantt band), the P80
  dashed line, the cost wedge; legend entries "Finish range (sim)" and "Cost range (sim)"; the chart's text
  alternative gains one sentence with the P80 finish and P80 cost. The calculated pace and efficiency segments are
  unchanged.
- Burn tile (`compact`): one line under the chart, marked sim: "Cost at finish (P80) {0} · {1} chance over budget"
  (second half dropped when the chance is null); unavailable → the Task 4 missing line.
- Change table footer: beside the calculated scope/performance split, one row "Cost at finish (sim) {P50} – {P95}",
  marked sim; absent when `sim` is null.

- [ ] **Step 1: Write the failing tests** — geometry: "no sim → simFinish and simCost null and the model equals today's"
  (deep-equal the pre-change model for one fixture), "burndown orientation maps cost to BAC − cost", "cumulative maps
  to cost", "hours unit uses the hours simulation", "beyond P95 cost draws no wedge", "beyond finish clamps to the
  last date", "domain includes the wedge"; chart: "switch off renders exactly as before" (inline HTML snapshot), legend
  names and the text-alternative sentence; panel: compact tile line with and without chance; change table: sim row
  present only with sim.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; mutation: swap the orientation mapping →
  "burndown orientation" fails; use `sim.eur` for hours → "hours unit" fails.
- [ ] **Step 5: Commit** — `feat: simulated finish and cost bands on the burn charts, tile and change table (§502)`

### Task 6: "Cost at finish" in the Forecast view, moved by What-if

**Files:**
- Modify: `src/app/forecast-panel.tsx`, `src/app/forecast-tables.tsx`, `src/app/workspace-section.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/forecast-panel.test.tsx`, `src/app/forecast-tables.test.tsx`

**Interfaces:**
- Consumes: `computeProjectForecastFacts` (Task 3), `spendSamples`, `simulateCostAtFinish` (Task 2),
  `ScheduleForecast.trialDays` / `windowDates` (Task 1).
- Produces: `ForecastPanel` prop `budgetFacts: ForecastFactsByUnit | null` (null when the Budget module is off or there
  are no buckets); `CostTable` in `forecast-tables.tsx` (props: `lang`, `cost: CostAtFinish`, `currency`, `bac`).

`workspace-section.tsx` computes `budgetFacts` with `computeProjectForecastFacts` in a `useMemo`, only while the
forecast tab is the active one. The panel computes cost from ITS OWN run (`trialDays` of the What-if-adjusted
forecast), money unit only, seed tag `"eur"`, so What-if capacity and scope move cost. Layout: a third card beside When
and How many, titled "Cost at finish", rows P50/P80/P95 and chance over budget, marked sim; no budget → "Add a budget
to see the cost at finish."; below either floor → the Task 4 missing lines. The "The Dashboard uses the default
settings" note already covers a differing toolbar.

- [ ] **Step 1: Write the failing tests** — "a What-if capacity of 200 % lowers the P80 cost" (two renders, compare);
  "no budget shows the add-a-budget line"; "below the spend floor names the counts"; "the cost card is absent without
  the simulation switch" (the view's existing `showSimulation` prop); table: rows, sim marking, beyond copy.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS. Measure the panel's extra cost at the
  What-if extremes (capacity 10 %, scope +300 %) with `performance.now()` in a throwaway script and record the number
  for Task 7.
- [ ] **Step 5: Commit** — `feat: cost at finish in the Forecast view, moved by What-if (§502)`

### Task 7: Docs, register and changelog

**Files:**
- Modify: `docs/AGENTS/forecast.md` (new section "Budget simulation — part 3": the engine, the spend window and floor
  `MIN_SPEND_WORKING_DAYS`, beyond handling, the bundle's `sim`, the shared run's new caller, the measured cost from
  Task 6 with its reproduce command), `docs/AGENTS/budget.md` (one paragraph: the calculated pace still drives the dot,
  gap and export leg; `sim` sits beside it), `CHANGELOG.md` (held-back note under Unreleased), `docs/open-followups.md`
  §502 status (part 3 built and held back; parts 4, scenarios and the AI tool remain).

- [ ] **Step 1:** Write the docs; every backticked name must exist (`npm run docs:symbols:check`, exit 0).
- [ ] **Step 2:** `node scripts/gate-local.mjs --group static` on the committed tree — Expected: PASS.
- [ ] **Step 3: Commit** — `docs: record the budget simulation (§502 part 3)`
