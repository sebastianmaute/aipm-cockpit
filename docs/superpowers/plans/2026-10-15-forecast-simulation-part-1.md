# Forecast simulation — Part 1: switch, marking, explainer, history, KPI cells — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-project "Show simulation" switch, the shared look and explainer for simulated numbers, a recorded daily forecast history, and the first simulated surface — the KPI strip's P80 finish and chance-on-time cells with the SPI divergence line.

**Architecture:** The switch is a new key in the existing per-project policy overrides (`Workspace.settingsOverrides`), so it rides the six write paths that slice already has. The forecast history is a new meta-blob slice, persisted exactly as `baselineHistory` was (commit `504390cd4` is the worked example). One pure function, `computeAppForecast`, runs the slice-1 engine with fixed defaults and is memoised on its inputs, so the KPI strip and the history recorder share one run.

**Tech Stack:** Next.js / React 19, TypeScript, vitest + RTL. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-15-forecast-simulation-surfaces-design.md` (§3.1–§3.5, §5, and the KPI row of §3.7). Parts 2–4 (Dashboard tile and other tiles; budget simulation; Gantt / Reports / Trends / exports) get their own plans after this ships.

## Global Constraints

- Engine defaults for every surface outside the Forecast view and for every history entry: window **60** working days, unit **"tasks"**, **no What-if** (`DEFAULT_WHAT_IF`), **10,000** trials (`FORECAST_TRIALS`), horizon 1,300 working days, floor ≥ 10 finished tasks and ≥ 10 window days.
- Switch off (the default, and the value for every existing project): every surface renders exactly as today.
- Simulated values: dashed teal outline + a "sim" badge; calculated values never change style. Palette tokens from `globals.css` only, light and dark.
- Plain words for percentiles: **Even odds** (P50) · **Safe to commit** (P80) · **Cautious** (P95).
- Explainer copy (EN): "The app replayed your team's real past days 10,000 times. P80 = 8 in 10 of those runs finished by this date." plus "Based on the last {0} working days." DE in real umlauts.
- Divergence rule: show the line when **SPI ≥ 1.0 and chance on time < 0.5**, or **SPI < 0.9 and chance on time ≥ 0.8**. Copy (EN): "These metrics use different units. SPI uses estimated effort completed versus planned effort due. Chance on time uses the observed completion rate. A project can look ahead on SPI and still have low date confidence if many remaining items are small, unestimated, or finishing slowly."
- Estimate-coverage cue (EN): "Estimates cover {0} % of remaining work".
- Intro copy (EN): "Simulation is on. Dashed teal numbers are simulated, not measured. \"P80\" means 8 in 10 simulated runs reached it." Actions: "Show me" (opens the Help entry) · "Got it".
- Repo rules (AGENTS.md): EN/DE key parity; DE edited only via a node utf8 script with `\r\n` anchors; `src/app` files are CRLF (Edit tool or node, never `sed -i`); `react-hooks/set-state-in-effect` banned; no `Date.now()`/`new Date()` in a render body; every control has an accessible name and keyboard operation; `task-manager.tsx` may gain **no new lines**.
- Commits: conventional prefix, cite §502, no `Claude-Session:` trailer, no URLs, no `Closes #`; never `--amend`.
- Local checks: targeted vitest only (through the guarded `/c/Projects/.vitest-lock`), `npx eslint --max-warnings=0 <changed files>`, `npx tsc --noEmit` (0 errors), `npm run size:check`, `npm run docs:symbols:check`, `npm run docs:claims:check`. No full vitest, e2e or build locally.

## Review Focus

1. **A project saved before this feature** (no `forecast` override, no `forecastHistory`) loads on every backend with the switch off and an empty history — pinned in Task 1 and Task 2.
2. **Plan end missing, invalid or in the past** — chance on time is `null` (no cell, not "0 %") when the plan end is blank or invalid, and 0 when it is past with open work — pinned in Task 3.
3. **History below the floor** — the KPI cells do not render (no "sim" cell with a dash) and no history entry is written — pinned in Tasks 3 and 4.
4. **Popout and load hold** — no history write from a popout or while `loadPending` is true, and none before holidays are ready — pinned in Task 4.
5. **Two tabs on the same day** — the second write for the same date overwrites, never appends — pinned in Task 2 (`upsertForecastHistory`).

---

### Task 1: The switch as a per-project policy override

**Files:**
- Modify: `src/app/settings-types.ts` (`SettingsOverrides`), `src/app/settings-overrides.ts` (`sanitizeSettingsOverrides`, `hasAnyOverride`)
- Create: `src/app/forecast-simulation.ts`
- Test: `src/app/forecast-simulation.test.ts`, extend the existing overrides round-trip tests (grep `sanitizeOverridesOrNone` in `*.test.ts`)

**Interfaces:**
- Produces: `SettingsOverrides.forecast?: { showSimulation?: boolean }`; `isSimulationOn(o: SettingsOverrides | undefined): boolean`; `withSimulation(o: SettingsOverrides | undefined, on: boolean): SettingsOverrides | undefined` (returns `undefined` when the result has no override left).

- [ ] **Step 1: Failing tests** in `forecast-simulation.test.ts`:
  - `isSimulationOn(undefined)`, `isSimulationOn({})` → `false`; `isSimulationOn({ forecast: { showSimulation: true } })` → `true`.
  - `withSimulation(undefined, true)` → `{ forecast: { showSimulation: true } }`; `withSimulation({ forecast: { showSimulation: true } }, false)` → `undefined`; turning it off keeps other keys (`{ timezone: … }` survives).
  - `sanitizeSettingsOverrides({ forecast: { showSimulation: "yes" } })` → `{}`; `{ forecast: { showSimulation: true } }` survives; `hasAnyOverride({ forecast: { showSimulation: true } })` → `true`.
  - JSON, CSV and Markdown round-trip of a workspace carrying the override keeps it (extend the existing overrides round-trip test, same fixture shape).
- [ ] **Step 2:** Run them; expect failures on the missing module and key.
- [ ] **Step 3:** Implement. Off is stored as absence (`withSimulation(…, false)` deletes the key, then folds an empty override to `undefined`), so a project that never turned it on serialises byte-for-byte as before.
- [ ] **Step 4:** Tests pass; `npx tsc --noEmit` 0 errors.
- [ ] **Step 5:** Commit `feat: a per-project "show simulation" policy override (§502)`.

### Task 2: The forecast history slice on all six write paths

**Files:** follow commit `504390cd4` file for file (`git show --stat 504390cd4`), with `forecastHistory` in place of `baselineHistory`. Pure helpers in a new `src/app/forecast-history.ts`. Test: `src/app/forecast-history.test.ts` and `src/app/forecast-history-persistence.test.ts` modelled on `baseline-history-persistence.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export type ForecastHistoryEntry = {
    date: string;                 // YYYY-MM-DD, the day it was computed
    p50: string | null;           // finish date; null = beyond the horizon
    p80: string | null;
    p95: string | null;
    chanceOnTime: number | null;  // 0..1; null = no valid plan end
  };
  Workspace.forecastHistory?: readonly ForecastHistoryEntry[];
  sanitizeForecastHistory(raw: unknown): ForecastHistoryEntry[];
  upsertForecastHistory(h: readonly ForecastHistoryEntry[], e: ForecastHistoryEntry): ForecastHistoryEntry[];
  entryOnOrBefore(h: readonly ForecastHistoryEntry[], date: string): ForecastHistoryEntry | null;
  ```
  and `forecastHistory` / `setForecastHistory` on the workspace context.

- [ ] **Step 1: Failing tests:**
  - `upsertForecastHistory([], e)` → `[e]`; same `date` twice → one entry holding the second value; result sorted by `date` ascending; input not mutated.
  - `sanitizeForecastHistory` drops entries with an invalid `date` (use `isValidIsoDate` from `src/app/forecast/throughput.ts`), a non-date non-null `p50/p80/p95`, or a `chanceOnTime` outside 0..1; it keeps the last entry per date.
  - `entryOnOrBefore(h, "2026-10-08")` returns the latest entry with `date <= "2026-10-08"`, else `null`.
  - Persistence test: the six paths (JSON, CSV, Markdown, Turso single, Turso tenant, IndexedDB) round-trip a two-entry history; a workspace without the field loads as `[]` on each; `isWorkspaceEmpty` ignores it (as it ignores `baselineHistory`).
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement by mirroring `504390cd4` (meta-blob slice: no `ENTITY_SPECS` row, out of `TABLE_NAMES`). Do the same doc update that commit made to `docs/AGENTS/activity-log.md`'s meta-slice list.
- [ ] **Step 4:** Tests pass; tsc 0; `npm run docs:symbols:check` 0.
- [ ] **Step 5:** Commit `feat: persist the daily forecast history on all six write paths (§502)`.

### Task 3: `computeAppForecast` — one memoised default run

**Files:**
- Create: `src/app/forecast/app-forecast.ts`, test `src/app/forecast/app-forecast.test.ts`

**Interfaces:**
- Consumes: `computeScheduleForecast`, `DEFAULT_WHAT_IF`, `DEFAULT_HISTORY_WINDOW`, `effortCoverage` (`src/app/forecast/index.ts`), `countWorkingDays`, `addCalendarDays` (`src/app/working-days.ts`).
- Produces:
  ```ts
  export type AppForecast =
    | { kind: "forecast"; p50: string | null; p80: string | null; p95: string | null;
        chanceOnTime: number | null; estimateCoverage: number; windowDays: number;
        distribution: Int32Array; trials: number }
    | { kind: "insufficient" };
  export function computeAppForecast(a: { tasks: readonly Task[]; milestones: readonly Milestone[];
    planEnd: string; today: string; holidaySet: ReadonlySet<string> }): AppForecast;
  export function toHistoryEntry(f: AppForecast, today: string): ForecastHistoryEntry | null; // null when insufficient
  ```

- [ ] **Step 1: Failing tests** (build tasks with the helpers the slice-1 tests use, e.g. `src/app/forecast/index.test.ts`):
  - With 20 finished tasks over 20 working days and 10 open: `kind === "forecast"`, `p50 <= p80 <= p95` (string compare), `trials === 10000`.
  - Below the floor (5 finished): `kind === "insufficient"` and `toHistoryEntry(...) === null`.
  - `chanceOnTime`: plan end blank or `"2026-11-31"` → `null`; plan end before `today` with open work → `0`; zero open tasks → `1`; otherwise equals the share of `distribution` values `<=` the working days in (today, planEnd], counted as milestones are (`countWorkingDays(addCalendarDays(today, 1), addCalendarDays(planEnd, 1), holidaySet)`).
  - `estimateCoverage` equals `effortCoverage(open)`.
  - Memoisation: two calls with the same `tasks`/`milestones`/`holidaySet` references and equal `planEnd`/`today` return the **same object** (`toBe`); a new `tasks` array returns a new one.
  - Determinism: two un-memoised runs (different array references, same contents) give identical `p50/p80/p95/chanceOnTime`.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement: call `computeScheduleForecast` with `window: DEFAULT_HISTORY_WINDOW`, `unit: "tasks"`, `whatIf: DEFAULT_WHAT_IF`, `howManyTarget: today`; map `when` P50/P80/P95 to dates; a single-entry memo keyed on the five inputs (references for the collections). Keep it i18n-free.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `feat: one memoised default forecast run for app surfaces (§502)`.

### Task 4: The background history recorder

**Files:**
- Create: `src/app/use-forecast-history-recorder.ts`, test `src/app/use-forecast-history-recorder.test.ts`
- Modify: `src/app/use-insight-lifecycle.ts` (call the recorder from inside it; extend `InsightLifecycleDeps` with `settingsOverrides`, `forecastHistory`, `setForecastHistory`), and its call site in `src/app/task-manager.tsx` **by adding the three names to existing lines only** (the `useInsightLifecycle({...})` deps lines and the `useWorkspace()` destructure). `npm run size:check` must pass; if it does not, stop and report rather than raise a baseline.

**Interfaces:**
- Consumes: `isSimulationOn` (Task 1), `upsertForecastHistory`, `ForecastHistoryEntry` (Task 2), `computeAppForecast`, `toHistoryEntry` (Task 3).
- Produces: `useForecastHistoryRecorder(d: { hydrated: boolean; isPopout: boolean; loadPending: boolean; holidaysReady: boolean; today: string; tasks; milestones; planEnd: string; holidaySet; settingsOverrides; forecastHistory; setForecastHistory }): void`.

- [ ] **Step 1: Failing tests** (renderHook):
  - Switch on, enough history, ready → `setForecastHistory` called once with a functional updater whose result has today's entry.
  - No call when: switch off; `isPopout`; `loadPending`; `!hydrated`; `!holidaysReady`; insufficient history.
  - When today's stored entry already equals the computed one, no call (no write loop).
  - The updater upserts (a stale same-day entry is replaced, not duplicated).
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement as an effect that calls the context setter with a functional updater (the call is synchronous, so no scope-epoch handling is needed; a write that awaited would need `dropStaleScopeWrite`). No undo capture and no activity-log entry: write through `setForecastHistory` only. Explain in the file header why it lives inside `useInsightLifecycle` (no headroom in `task-manager.tsx`; both are background derivations over the same inputs).
- [ ] **Step 4:** Tests pass; `npx vitest run src/app/use-insight-lifecycle.test.ts src/app/task-manager.guardrail-reconcile.test.tsx` still green; size:check 0.
- [ ] **Step 5:** Commit `feat: record one forecast history entry a day while simulation is on (§502)`.

### Task 5: `SimValue` and `SimExplainer`

**Files:**
- Create: `src/app/sim-value.tsx`, `src/app/sim-explainer.tsx`, `src/app/percentile-words.ts`; tests beside each.
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`.

**Interfaces:**
- Produces:
  - `percentileWord(p: 50 | 80 | 95): "simEvenOdds" | "simSafeToCommit" | "simCautious"` (i18n keys).
  - `<SimValue lang label value hint? explainer?>` — renders the dashed teal outline, the "sim" badge (`aria-hidden`; the accessible name gets ", simulated" via `simValueSr`), and an optional trailing `SimExplainer`.
  - `<SimExplainer lang windowDays distribution trials markers>` — an ⓘ `Button` (accessible name "How to read this", `simExplainerOpen`) that opens a popover via `usePopoverDismiss` (Escape and outside click close, focus returns to the button), containing an inline SVG histogram with P50/P80/P95 cut lines, the two copy lines from Global Constraints, and a link that opens the Help entry `concept-forecast-simulation` (Task 6).

- [ ] **Step 1: Failing tests:**
  - `SimValue` exposes the accessible name `"<label>, simulated"` and renders the badge text "sim" (`aria-hidden`); its container carries the token classes for the dashed outline (assert on the `data-sim="true"` attribute, not on class strings).
  - `SimExplainer`: closed by default; clicking the ⓘ opens a dialog/region containing the "replayed your team's real past days 10,000 times" text and "Based on the last 60 working days."; Escape closes it and focus returns to the button (`userEvent.keyboard("{Escape}")`); keyboard-only open works (`userEvent.tab()` then `{Enter}`).
  - DE: after `loadI18n("de")`, the explainer text renders in German (no ASCII umlaut substitutes — the existing `i18n-encoding` test covers the file).
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement with the shared `Button` and `usePopoverDismiss`; read `docs/AGENTS/ui-shell.md` "dismissal" before writing the popover. Histogram: ≤ 20 bars binned from `distribution`, `role="img"` with an `aria-label` summarising the three dates.
- [ ] **Step 4:** Tests pass; eslint clean.
- [ ] **Step 5:** Commit `feat: shared look and explainer for simulated values (§502)`.

### Task 6: The switch in the Dashboard toolbar, the one-time intro, the Help entry

**Files:**
- Modify: `src/app/dashboard-panel.tsx` (toolbar), `src/app/settings-types.ts` (`Settings.simulationIntroSeen?: boolean`), `src/app/help-content.ts` (new entry), `src/app/i18n.ts`, `src/app/i18n.de.ts`.
- Create: `src/app/simulation-intro.tsx`; tests `src/app/simulation-intro.test.tsx`, extend `src/app/dashboard-panel.test.tsx`.

**Interfaces:**
- Consumes: `isSimulationOn`, `withSimulation` (Task 1); `setSettingsOverrides` from `useWorkspace()`.
- Produces: Help entry `{ id: "concept-forecast-simulation", group: "concepts", titleKey: "helpConceptForecastSimTitle", bodyKey: "helpConceptForecastSimBody", primerKey: "helpConceptForecastSimPrimer", relatedViews: ["forecast", "dashboard"], relatedConcepts: ["concept-milestone", "concept-budget"] }`.

- [ ] **Step 1: Failing tests:**
  - The Dashboard toolbar has a `ToggleButton` named "Show simulation", unpressed for a workspace with no override; pressing it calls `setSettingsOverrides` so that `isSimulationOn(next)` is true; pressing again turns it off and the override folds away.
  - Toolbar order: the switch sits before the trailing Print · reset group (`expectButtonOrder` from `src/test/toolbar-order.ts`, `contiguous: true` for the trailing group).
  - Popout (`readOnly`): no switch rendered.
  - Intro: renders once when the switch turns on and `simulationIntroSeen` is not set; "Got it" writes `simulationIntroSeen: true` through the settings setter (functional) and hides it; "Show me" opens Help at `concept-forecast-simulation`; it never renders while the switch is off.
  - Help: the new entry renders its title and body in EN and DE.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement. The intro is a non-modal note under the toolbar (no focus trap), dismissible by "Got it" or Escape.
- [ ] **Step 4:** Tests pass. Then run axe for the Dashboard: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` **only if the owner allows local e2e; otherwise note it for CI.**
- [ ] **Step 5:** Commit `feat: "Show simulation" switch, one-time intro and Help entry (§502)`.

### Task 7: KPI strip — P80 finish, chance on time, divergence line, estimate coverage

**Files:**
- Modify: `src/app/dashboard-sections/dashboard-kpi-strip.tsx`, its caller `src/app/dashboard-tile-bodies.tsx`, `src/app/dashboard-panel.tsx` (compute and pass), `src/app/i18n.ts`, `src/app/i18n.de.ts`.
- Create: `src/app/kpi-simulation.ts` (pure), test `src/app/kpi-simulation.test.ts`; extend `dashboard-sections/dashboard-kpi-strip.test.tsx` (create if absent).

**Interfaces:**
- Consumes: `computeAppForecast` (Task 3), `SimValue`, `SimExplainer`, `percentileWord` (Task 5), `isSimulationOn` (Task 1).
- Also modifies `src/app/forecast-toolbar.tsx` / `forecast-panel.tsx`: while simulation is on and the view's window, unit or What-if differ from the defaults, the Forecast view shows the note "The Dashboard uses the default settings" (spec §5). Test: default toolbar → no note; window 90 → note visible; switch off → no note.
- Produces: `DashboardKpiStripProps.simulation?: KpiSimulation` where
  ```ts
  export type KpiSimulation = { p80: string; chanceOnTime: number | null; estimateCoverage: number;
    divergent: boolean; explainer: { windowDays: number; distribution: Int32Array; trials: number } };
  export function kpiSimulation(f: AppForecast, spi: number | null): KpiSimulation | null; // null when insufficient or p80 beyond
  export function isDivergent(spi: number | null, chance: number | null): boolean;
  ```
  `KpiCellCount` widens to cover the two extra cells.

- [ ] **Step 1: Failing tests:**
  - `isDivergent(1.0, 0.49)` → true; `isDivergent(1.0, 0.5)` → false; `isDivergent(0.89, 0.8)` → true; `isDivergent(0.9, 0.8)` → false; `isDivergent(null, 0.1)` → false; `isDivergent(1.2, null)` → false.
  - `kpiSimulation` returns `null` for `{ kind: "insufficient" }` and when `p80` is `null`.
  - Strip without `simulation`: renders exactly today's cells (snapshot of the cell labels in order).
  - Strip with `simulation`: two extra cells, accessible names "Safe to commit, simulated" (value = the P80 date, formatted with the existing date formatter for the locale) and "On time, simulated" (value e.g. "34 %"); each has an ⓘ explainer; with `divergent: true` the divergence copy from Global Constraints is visible text (not only in the explainer); the coverage cue "Estimates cover 41 % of remaining work" renders for `estimateCoverage: 0.41`.
  - Chance cell absent when `chanceOnTime === null` (the P80 cell still renders).
  - Dashboard panel: simulation off → no `simulation` prop reaches the strip; on → it does (mock `computeAppForecast` for this test).
  - Reports (`reports.tsx` renders the same strip): unchanged in this part — it passes no `simulation` prop.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3:** Implement. Compute in `dashboard-panel.tsx` with `useMemo` over the same inputs `computeAppForecast` memoises on, only when `isSimulationOn(settingsOverrides)`. Check the KPI tile still fits its measured height in both densities (`docs/AGENTS/dashboard.md`, the KPI tile is 2×3 and wraps); if the wrap needs a layout change, note it for the e2e `dashboard-grid.spec.ts` run in CI.
- [ ] **Step 4:** Tests pass; eslint on changed files; tsc 0.
- [ ] **Step 5:** Commit `feat: KPI strip shows simulated P80 finish and chance on time (§502)`.

### Task 8: Docs

**Files:** `docs/AGENTS/forecast.md` (new section "Simulation across the app — part 1": the switch and where it is stored, the history slice and its writer's gates, `computeAppForecast` defaults and memo, the KPI cells, the divergence rule), `docs/AGENTS/dashboard.md` (KPI strip cells), `CHANGELOG.md` (Unreleased, §502, wrap to the file's width), `AGENTS.md` only if a hard-constraint line changes (it should not).

- [ ] **Step 1:** Write the sections. Every backticked name must exist (`npm run docs:symbols:check` 0); every count carries its reproduce command.
- [ ] **Step 2:** `npm run docs:symbols:check`, `npm run docs:claims:check`, `npm run size:check` — each exit 0, unpiped.
- [ ] **Step 3:** Commit `docs: forecast simulation part 1 — switch, history, KPI cells (§502)`.
