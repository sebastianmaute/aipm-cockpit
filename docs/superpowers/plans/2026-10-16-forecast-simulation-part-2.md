# Forecast simulation part 2 (Dashboard picture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Dashboard Forecast tile, a chance chip per milestone, a "unlikely on time" Next-actions signal, and the eight fixes deferred from part 1, all held back with the Forecast view.

**Architecture:** One memoised run, `computeAppForecast`, gains the engine's milestone chances; the tile, the chips, the action helper, the KPI strip and the recorder all read it. Pure i18n-free helpers (`forecast-tile-model.ts`, `next-actions/sim-milestones.ts`) compute the tile's change line, its at-risk list and the actions; React surfaces translate. Every new surface reads `isSimulationActive(overrides, features)`, so nothing renders while `"forecast"` is in `RELEASE_HIDDEN_VIEWS`.

**Tech Stack:** Next.js 16 / React 19, TypeScript, Vitest + RTL, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-10-15-forecast-simulation-part-2-design.md` (approved by the owner 2026-10-16). It narrows `docs/superpowers/specs/2026-10-15-forecast-simulation-surfaces-design.md`, which stays the authority for marking (§3.2), explaining (§3.3) and constraints (§4). Read both.

**Branch / worktree:** `feat/502-sim-part-2` at `C:/Projects/aipm-cockpit-wt41` (from `origin/main` e49925485).

## Global Constraints

- Simulated numbers never pass for measured ones: every simulated value uses `SimValue` (dashed teal outline, `aria-hidden` "sim" badge, accessible name `"<label>, simulated"`). Calculated values (open-task count) never do.
- Switch off → nothing on screen changes. Every new surface gates on `isSimulationActive(settingsOverrides, settings.features)`, never `isSimulationOn`. Each new surface gets a held-back test of part 1's shape (`src/test/forecast-view.ts` `showForecastView()`; restore in `afterEach`).
- `task-manager.tsx` may gain NO lines: extend existing lines only (Task 3 and Task 6 name the two lines).
- i18n: every key in `i18n.ts` AND `i18n.de.ts`; DE through a node utf8 script with `\r\n` anchors, real umlauts, „…“ quotes. German for "chance on time" is "Termin-Wahrscheinlichkeit". EN percent follows `kpiSimPercent` ("31%"), DE "31 %". A test asserting DE output calls `loadI18n("de")` first.
- `src/app` and `e2e` files are CRLF in the working tree; edit with the Edit tool or a node script, never `sed -i`.
- No `react-hooks/set-state-in-effect`; no `Date.now()`/`new Date()` in a render body.
- Percent text through `chanceText` (`chance-text.ts`); percentile wording through `percentileWord` (`percentile-words.ts`).
- `computeAppForecast` callers pass the context's OWN `tasks`/`milestones`/`holidaySet` references (no `.filter()` copies) or the single-entry memo reruns 10,000 trials.
- Before every push: unpiped `npx eslint --max-warnings=0 <changed files>` and `npx tsc --noEmit` (0 errors). Targeted vitest only, under `if mkdir /c/Projects/.vitest-lock 2>/dev/null; then …; rm -rf /c/Projects/.vitest-lock; else echo LOCKED; fi`. Never two vitest at once. No full suite, e2e or build locally.
- Commits cite §502, no `Closes #`, no session trailer; `git commit --only <paths>`; never `--amend`.

## Review Focus

1. **A milestone at exactly 50 %** — the signal fires only for `chance < 0.5`; 0.5 must not fire. (Task 6 test.)
2. **History with only entries newer than 7 days, or a gap longer than 13 days** — the change line must say "Change shown from …" rather than compare against a too-recent or too-old entry. (Task 2 tests.)
3. **Today's or last week's P80 beyond the horizon (`null`)** — no arrow; "Change unavailable: beyond the forecast horizon". (Task 2 test.)
4. **A sim action whose milestone also has a measured milestone action** — one row, not two; the sim reason joins it as an extra reason that itself reads "simulated". (Task 6 test.)
5. **Restoring an unstamped (pre-format-2) capture with the switch on** — must not blank the project's other overrides (timezone, notifications). (Task 9 test.)

---

### Task 1: The shared run carries milestone chances

**Files:**
- Modify: `src/app/forecast/app-forecast.ts`
- Modify (fixtures only, tsc-driven): `src/app/dashboard-panel.test.tsx`, `src/app/forecast/app-forecast.test.ts`, `src/app/kpi-simulation.test.ts`, `src/app/use-forecast-history-recorder.test.ts`, `src/app/forecast-chart.test.tsx`, `src/app/forecast/index.test.ts` — any `AppForecast` literal with `kind: "forecast"` (find them: `grep -rln 'kind: "forecast"' src/app --include=*.test.*`).
- Test: `src/app/forecast/app-forecast.test.ts`

**Interfaces:**
- Produces: `AppForecast` `kind: "forecast"` gains `milestones: readonly MilestoneChance[]` (from `./milestones`), the SAME array the engine run returned. `MilestoneChance` is re-exported from `app-forecast.ts` for surfaces.

- [ ] **Step 1: Write the failing tests** in `app-forecast.test.ts`:
  - `"carries the engine's milestone chances from the same run"`: spy `vi.spyOn(indexModule, "computeScheduleForecast")`; call `computeAppForecast(args)` with one open milestone linked to an open task; assert `f.kind === "forecast"`, `f.milestones` equals the spy's returned `.milestones` (`toBe` identity) and the spy was called once.
  - `"a second call with the same references reuses the run"`: two calls, same args object fields (same refs) → spy called once, `f1 === f2`.
- [ ] **Step 2: Run** `npx vitest run src/app/forecast/app-forecast.test.ts` (under the lock) → FAIL (`milestones` undefined).
- [ ] **Step 3: Implement** — add `milestones: r.milestones` in the forecast branch.
- [ ] **Step 4: Fix the fixtures** tsc now rejects: add `milestones: []` to each `AppForecast` literal. Run `npx tsc --noEmit` → 0 errors.
- [ ] **Step 5: Run** the test file plus every fixture file touched → PASS.
- [ ] **Step 6: Commit** `feat: the app forecast run carries milestone chances (§502)`.

### Task 2: Pure Forecast-tile model

**Files:**
- Create: `src/app/forecast-tile-model.ts` (pure, i18n-free, DOM-free)
- Test: `src/app/forecast-tile-model.test.ts`

**Interfaces:**
- Consumes: `ForecastHistoryEntry`, `entryOnOrBefore` (`forecast-history.ts`); `addCalendarDays`, `countWorkingDays` (`working-days.ts`); `MilestoneChance` (Task 1).
- Produces:
  ```ts
  export const WEEK_BACK_DAYS = 7;
  export const WEEK_BACK_MAX_DAYS = 13;
  export const AT_RISK_LIMIT = 3;
  export type WeeklyChange =
    | { kind: "later" | "earlier"; workingDays: number }   // workingDays > 0
    | { kind: "same" }
    | { kind: "pending"; from: string }                    // no entry 7–13 days back yet
    | { kind: "beyond" };                                  // today's or the earlier P80 is null
  export function weeklyChange(args: { history: readonly ForecastHistoryEntry[]; today: string; p80: string | null; holidaySet: ReadonlySet<string> }): WeeklyChange;
  export interface AtRiskMilestone { id: number; name: string; date: string; chance: number }
  export function milestonesAtRisk(chances: readonly MilestoneChance[], milestones: readonly Milestone[]): AtRiskMilestone[];
  ```
- Rules (spec §3.1):
  - Earlier entry = `entryOnOrBefore(history, today − 7)` if its date ≥ `today − 13`; else `pending` with `from` = first history date + 7 calendar days (no history at all → `today + 7`).
  - Either P80 `null` → `beyond` (checked before `pending` only when an earlier entry exists; with no earlier entry and today's P80 null → `beyond`).
  - Working days from a to b (a < b) = `countWorkingDays(addCalendarDays(a, 1), addCalendarDays(b, 1), holidaySet)` — the convention `chanceOnTime` uses. 0 working days → `same`.
  - At risk: `state === "chance"` and `chance < 1`; sort by chance asc, then milestone date asc, then id; at most `AT_RISK_LIMIT`. Ids without a matching milestone are dropped.

- [ ] **Step 1: Write the failing tests:**
  - `"compares with the entry exactly 7 days back"`: history `[{date:"2026-10-09", p80:"2027-02-01"}]`, today `2026-10-16`, p80 `"2027-02-12"`, no holidays → `{kind:"later", workingDays:9}`.
  - `"falls back to the nearest earlier entry 7–13 days back"`: only `2026-10-05` (11 days) → used; only `2026-10-02` (14 days) → `{kind:"pending", from:"2026-10-09"}` (first date + 7).
  - `"an entry newer than 7 days is never the comparison"`: only `2026-10-12` → `pending`, `from:"2026-10-19"`.
  - `"earlier finish reads earlier"` → `{kind:"earlier", workingDays:n}`; same date → `{kind:"same"}`; dates differing only across a weekend → `{kind:"same"}`.
  - `"holidays are not counted"`: a holiday between the two P80 dates reduces `workingDays` by 1.
  - `"beyond the horizon on either side"`: today p80 `null` → `beyond`; earlier entry p80 `null` → `beyond`.
  - `"no history → pending from today + 7"`.
  - `milestonesAtRisk`: mixes of `chance`/`overdue`/`no-linked-tasks`; asserts order `[0.2, 0.31(earlier date), 0.31(later date)]`, at most 3, a `chance: 1` entry excluded, overdue/no-linked excluded, an unknown id dropped.
- [ ] **Step 2: Run** `npx vitest run src/app/forecast-tile-model.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** the two functions and constants.
- [ ] **Step 4: Run** → PASS. `npx tsc --noEmit` → 0.
- [ ] **Step 5: Commit** `feat: pure model for the Dashboard forecast tile (§502)`.

### Task 3: Holidays-ready reaches the Dashboard; simulated slots wait for it (fix 4)

**Files:**
- Modify: `src/app/task-manager.tsx` — ONLY the existing line `    holidaySet,` inside `const workspaceProps = {` becomes `    holidaySet, holidaysReady,` (no new line).
- Modify: `src/app/workspace-section.tsx` (destructure `holidaysReady`, pass `holidaysReady={holidaysReady}` to `DashboardPanel`; its props type)
- Modify: `src/app/dashboard-panel.tsx`, `src/app/dashboard-sections/dashboard-kpi-strip.tsx`, `src/app/dashboard-tile-bodies.tsx`
- Create: `SimPlaceholder` export in `src/app/sim-value.tsx`
- Test: `src/app/dashboard-panel.test.tsx`, `src/app/sim-value.test.tsx`

**Interfaces:**
- Produces: `DashboardPanelProps.holidaysReady?: boolean` (default `true`, so existing callers and tests are unchanged). `simReady = simulationOn && holidaysReady`. While `simulationOn && !holidaysReady`, `computeAppForecast` is NOT called and every simulated slot renders `<SimPlaceholder />`: a neutral, `aria-hidden`, fixed-height (`h-6`) empty span, no text. Later tasks render it in the tile (Task 4) and the chips (Task 5).

- [ ] **Step 1: Write the failing tests** (dashboard-panel.test.tsx, simulation shown via `showForecastView()`, switch on):
  - `"holds the simulated cells as placeholders until holidays are ready"`: `holidaysReady={false}` → no gap text (`kpiSimGap*` strings absent), no `[data-sim]`, ≥1 `[data-sim-placeholder]`, and `computeAppForecast` spy NOT called. Rerender `holidaysReady` → spy called, cells present.
  - `"switch off: no placeholder"` → zero `[data-sim-placeholder]`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the prop threading, the gate in the KPI memo and the placeholder in the KPI strip's two simulated cell slots.
- [ ] **Step 4: Run** dashboard-panel.test.tsx + sim-value.test.tsx → PASS; `npx tsc --noEmit` → 0; `wc -l src/app/task-manager.tsx` unchanged (2024).
- [ ] **Step 5: Commit** `fix: simulated Dashboard slots wait for holidays instead of flashing the gap line (§502)`.

### Task 4: The Forecast tile

**Files:**
- Create: `src/app/dashboard-sections/dashboard-forecast-tile.tsx` (presentational), `src/app/forecast-range-bar.tsx` (SVG + text alternative)
- Modify: `src/app/dashboard-tiles.ts`, `src/app/dashboard-panel.tsx`, `src/app/dashboard-tile-bodies.tsx`, `src/app/kpi-simulation.ts` (only if the tile reuses the gap text helper — move `simulationGapText` out of the KPI strip into a shared export rather than copying it), `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/dashboard-sections/dashboard-forecast-tile.test.tsx`, `src/app/forecast-range-bar.test.tsx`, `src/app/dashboard-panel.test.tsx`, plus any test enumerating tiles (`grep -rln "DASHBOARD_TILES\|completionTrend" src/app --include=*.test.*` — label each hit MIGRATE or untouched)

**Interfaces:**
- Consumes: Task 1 `AppForecast.milestones`; Task 2 `weeklyChange`, `milestonesAtRisk`; Task 3 `simReady`, `SimPlaceholder`; `SimValue`, `SimExplainer`, `chanceText`, `percentileWord`, `buildRowTokens`.
- Produces:
  - `DashboardTileId` gains `"forecast"`; `TileGateInput.simulationActive: boolean`; registry row appended LAST: `{ id: "forecast", labelKey: "dashboardForecast", w: 2, h: 3, minW: 1, maxW: 4, minH: 2, maxH: 4, gate: (g) => g.simulationActive }`.
  - `DashboardForecastTile` props: `{ lang; forecast: AppForecast | null /* null = placeholder */; history: readonly ForecastHistoryEntry[]; milestones: readonly Milestone[]; planEnd: string; today: string; holidaySet; openTaskCount: number; onOpenMilestone?: (id: number) => void; onOpenForecast?: () => void; onOpenHelp? }`.
  - `ForecastRangeBar` props: `{ lang; p50: string; p80: string; p95: string | null; planEnd: string | null; today: string }`.
- Content and copy (EN; DE by the builder, same meaning):
  - `dashboardForecast`: "Forecast" (DE: the word `navForecast` uses, "Prognose").
  - Headline (one `SimValue` + one `SimExplainer`, `kind: "date"`): "8 in 10 simulated runs finish by {P80}." then "Half by {P50} · almost all (19 in 20) by {P95}." — P95 `null` → "… almost all (19 in 20) only beyond the forecast horizon."
  - Change: `forecastTileLater` "▲ {0} working days later than last week" / `…One` "▲ 1 working day later than last week"; `forecastTileEarlier` "▼ {0} working days earlier than last week" / `…One`; `forecastTileNoChange` "No change since last week"; `forecastTileChangeFrom` "Change shown from {0}"; `forecastTileChangeBeyond` "Change unavailable: beyond the forecast horizon". The ▲/▼ glyph is `aria-hidden`; the words carry the direction.
  - Range bar: band P50–P95, mark at P80, plan-end tick (omitted when `planEnd` invalid), shared date axis; `role="img"` with `forecastRangeAria` "Half by {0}, 8 in 10 by {1}, almost all by {2}. Plan end {3}." (no-plan-end variant drops the last sentence; P95 null → "beyond the forecast horizon"). Colours from the explainer histogram's tokens only.
  - Open work (NOT sim): `forecastTileOpenTasks` "{0} open tasks" / `…One` "1 open task". Count = `tasks.filter(t => !isTaskClosed(t)).length`, computed in the panel.
  - At risk: heading `forecastTileAtRisk` "Milestones at risk"; each row: name (a `Button` calling `onOpenMilestone(id)`, row-unique name via `buildRowTokens`; plain text when absent), due date, `SimValue` label `forecastTileChanceOnTime` "{0} chance on time" with `chanceText`. Empty → `forecastTileNoneAtRisk` "No milestones at risk".
  - `forecastTileOpen` "Open Forecast →" — a link-style `Button` calling `onOpenForecast`; rendered only when `onOpenForecast` is given (panel passes `props.onNavigate ? () => props.onNavigate!("forecast") : undefined`).
  - `forecast.kind === "insufficient"` → only the muted, non-sim gap line (the same text the KPI strip shows). P80 `null` (beyond) → the gap line replaces the headline and the bar; change reads `beyond`; open work and at-risk still render.
  - `forecast === null` (holidays not ready) → `SimPlaceholder` in the headline, change and at-risk slots; open work renders.
- Wiring: the panel computes ONE forecast in the existing KPI memo (extend it to return `forecast`), adds `simulationActive: simulationOn` to `gate`, passes the tile body through `buildTileBodies` (`forecast:` key), and extends the `useMeasuredHeights` `contentKey` with the tile's row count (`forecastTileContentKey(forecast, atRiskCount)` beside `kpiContentKey`) so the tile re-measures when rows appear.

- [ ] **Step 1: Write the failing tests:**
  - tile test: `"headline names P80, then P50 and P95, marked simulated"` (accessible group name ends ", simulated"; dates formatted with the app's date formatter); `"P95 beyond the horizon reads 'only beyond the forecast horizon'"`; `"change line forms"` (later 9 → "▲ 9 working days later than last week", one day singular, same, pending with date, beyond); `"insufficient history shows only the gap line, not marked sim"` (no `[data-sim]`); `"open tasks are not marked sim"`; `"top 3 at risk, worst first, row-unique names"` (two milestones named "Go-live" on different dates get distinct accessible names); `"none at risk"`; `"Open Forecast only when a navigator is given"`; `"placeholder while forecast is null"`.
  - range bar test: P80 mark x between band edges; no plan-end tick when `planEnd` is `""`; aria label lists the four dates; P95 null → aria says beyond the horizon.
  - panel tests: `"the Forecast tile exists only while the switch is active"` (switch off → no tile and no shelf chip for it); `"held back: no Forecast tile while the view is hidden though the stored switch is on"` (no `showForecastView()` spy); `"a stored placement survives the switch going off and on"` (layout entry for `forecast` kept in storage after toggling).
- [ ] **Step 2: Run** the three test files → FAIL.
- [ ] **Step 3: Implement** registry row, gate field, tile, range bar, panel wiring, i18n keys (EN via Edit, DE via node script).
- [ ] **Step 4: Run** the three files + any MIGRATE hits → PASS; `npx tsc --noEmit` → 0; `npx eslint --max-warnings=0` on changed files → 0.
- [ ] **Step 5: Commit** `feat: Dashboard Forecast tile — P80 headline, weekly change, range bar, milestones at risk (§502)`.

### Task 5: Chance chip on each milestone

**Files:**
- Modify: `src/app/milestone-horizon-strip.tsx`, `src/app/dashboard-tile-bodies.tsx`, `src/app/dashboard-panel.tsx`, `src/app/sim-explainer.tsx` (new `kind: "milestone"`), `src/app/sim-value.tsx` (export `SimBadge`, the badge span `SimValue` already renders, so the chip and Task 6 reuse it), i18n files
- Test: `src/app/milestone-horizon-strip.test.tsx`, `src/app/sim-explainer.test.tsx`, `src/app/dashboard-panel.test.tsx`

**Interfaces:**
- Produces: `MilestoneHorizonStrip` optional props `chances?: ReadonlyMap<number, number>` (id → chance, only `state: "chance"` entries) and `simPending?: boolean` (holidays not ready → `SimPlaceholder` per chip) and `explainer?: ReactNode`. Absent → output byte-identical to today (pin with a snapshot of `container.innerHTML` taken with and without the prop omitted).
- Chip: inside the existing chip `Button` (a button cannot nest a group), after the date: a dashed-teal span with the percent (`chanceText`) and `SimBadge`, both `aria-hidden`; the Button's `aria-label` becomes `rowLabel(...)`-token + ", " + `milestoneChanceChipSr` "{0} chance on time, simulated" (EN) — label-in-name holds because the visible "62%" is inside the name. The non-button `span` branch renders the same visible chip and puts the sentence in a visually-hidden span.
- Overdue and no-linked milestones get no chip (they are absent from `chances`).
- ONE explainer per tile (spec call): a `SimExplainer` with `kind: "milestone"` and `label` = `milestoneChancesAbout` "About these chances", rendered in the tile body above the buckets only when at least one chip shows. `kind: "milestone"` shows `simExplainerLineMilestone` ("Each chance is the share of the 10,000 runs that finished the milestone's last linked task by its date, working through open tasks in due-date order. The Forecast view also shows the chance if the milestone's tasks went first.") plus the window line and the Help link; it draws no histogram and no percentile list.

- [ ] **Step 1: Write the failing tests:** strip — chip shows "62%" for a `state: "chance"` milestone, accessible name contains "62% chance on time, simulated"; overdue milestone has no chip; omitted `chances` → `innerHTML` equals the pre-change render (capture before implementing as a literal fixture); explainer kind `"milestone"` renders the milestone line and no `svg`. Panel — switch on: chips present and one "About these chances" button; switch off: none; held back: none.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; tsc 0; eslint 0.
- [ ] **Step 5: Commit** `feat: simulated chance-on-time chip on each Dashboard milestone (§502)`.

### Task 6: Next-actions "unlikely on time" signal

**Files:**
- Create: `src/app/next-actions/sim-milestones.ts` (pure, i18n-free)
- Modify: `src/app/next-actions/types.ts` (`ActionSource` gains `"forecast-sim"`), `src/app/action-source-label.ts`, `src/app/use-next-actions.ts`, `src/app/task-manager.tsx` (ONLY the existing line `    workdayHours: settings.resources.workdayHours, holidaySet,` in the `useNextActions({` call becomes `    workdayHours: settings.resources.workdayHours, holidaySet, holidaysReady, settingsOverrides,`), `src/app/use-action-learning.ts`, `src/app/action-row.tsx`, `src/app/action-hero-card.tsx`, `src/app/action-cta-controls.tsx`, i18n files
- Test: `src/app/next-actions/sim-milestones.test.ts`, `src/app/use-next-actions.test.ts` (create if absent), `src/app/action-row.test.tsx`, `src/app/use-action-learning.test.tsx`

**Interfaces:**
- Consumes: Task 1 `AppForecast`.
- Produces:
  ```ts
  export const SIM_UNLIKELY_BELOW = 0.5;
  export function buildSimMilestoneActions(args: {
    forecast: AppForecast; milestones: readonly Milestone[]; dismissed: ReadonlySet<string>;
  }): SuggestedAction[];
  export function mergeSimActions(groups: readonly ActionGroup[], sim: readonly SuggestedAction[]): ActionGroup[];
  ```
  - One action per milestone with `state: "chance"`, `chance < SIM_UNLIKELY_BELOW`, not achieved; none when `forecast.kind !== "forecast"`; ids in `dismissed` dropped.
  - `id: \`forecast-sim:milestone:${id}\``, `source: "forecast-sim"`, `moduleId: "milestones"`, `tier: "soon"`, `score = TIER_SOON + Math.round((SIM_UNLIKELY_BELOW - chance) / SIM_UNLIKELY_BELOW * (TIER_NOW - 1 - TIER_SOON))` (always in [30, 59], lower chance higher), `cta: { kind: "open", view: "forecast", id }`.
  - `title`: `actionForecastSimTitle` "{0} is unlikely on time — {1}% chance" with params `[name, Math.round(chance * 100)]`; chance in (0, 0.005) uses `actionForecastSimTitleBelow1` "{0} is unlikely on time — <1% chance". `why`: `actionForecastSimWhy` "Simulated: {0}% chance of finishing by {1}" (and a `Below1` twin) with `[percent, milestone.date]` — the word "Simulated" makes the reason self-marking when it shows as an extra reason.
  - `mergeSimActions`: a group whose key is `milestones:${id}` takes the sim action into `extra` (re-sorted score desc, id asc; group `primary`/`score`/`tier` unchanged); otherwise the action forms its own group `{ key: action.id, primary: action, extra: [], score, tier }`. Result re-sorted exactly as `groupNextActions` sorts.
- `use-next-actions.ts`: new deps `holidaysReady: boolean`, `settingsOverrides: SettingsOverrides | undefined`. When `isSimulationActive(settingsOverrides, features) && isModuleEnabled("milestones", features) && holidaysReady`, compute `computeAppForecast({ tasks, milestones, planEnd: plan.endDate, today, holidaySet })` (same refs as the Dashboard) and `nextActionGroups = mergeSimActions(groupNextActions(nextActions), buildSimMilestoneActions(...))`. The flat `nextActions`, `nowCount` and `commsPendingStakeholderIds` are untouched.
- `snoozeAction` and `use-action-learning`'s `record` skip learning for `source === "forecast-sim"` (snooze still goes to the store).
- `ACTION_SOURCE_LABEL["forecast-sim"]` = `actionSourceForecastSim` "Forecast".
- Rows: `action-row.tsx` and `action-hero-card.tsx` render `SimBadge` beside the title when `primary.source === "forecast-sim"`; the Open button's text and name use `actionOpenForecast` "Open Forecast" when `cta.view === "forecast"` (else `actionOpen`). The overflow shows only Snooze for a sim action: `canCreateTask` and `canLogAsRaid` return false for `source === "forecast-sim"`.

- [ ] **Step 1: Write the failing tests:**
  - sim-milestones: chance 0.31 → one action, title params `["Go-live", 31]`, tier `"soon"`, score in [30, 59]; chance 0.5 → none; chance 0.49 → one; achieved milestone → none; insufficient forecast → none; dismissed id → none; chance 0.003 → Below1 keys; lower chance → higher score.
  - merge: a `milestones:7` group gains the sim action as extra, primary unchanged; an unmatched sim action becomes its own group placed after every `now` group; sort order matches `groupNextActions`.
  - use-next-actions (`renderHook`): switch off → groups equal `groupNextActions(nextActions)`; switch on, held back (no `showForecastView()`) → no sim group; switch on + shown → sim group present, `nextActions` contains no `forecast-sim` action; `holidaysReady: false` → no sim group; `"shares the Dashboard's run"` — call `computeAppForecast` once with the same refs first, then render the hook → `computeScheduleForecast` spy count unchanged.
  - action-row: sim primary shows the "sim" badge and an "Open Forecast" button; overflow menu lists only snooze items.
  - learning: `record` with a `forecast-sim` action writes nothing.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the four files + `src/app/next-actions/action-cta.test.ts` + `src/app/next-actions/group.test.ts` → PASS; tsc 0 (the exhaustive `ACTION_SOURCE_LABEL` record forces the label); `wc -l src/app/task-manager.tsx` still 2024.
- [ ] **Step 5: Commit** `feat: Next actions flags a milestone unlikely on time, marked simulated (§502)`.

### Task 7: Recorder — one write per day across devices (fix 1)

**Files:**
- Modify: `src/app/use-forecast-history-recorder.ts`
- Test: `src/app/use-forecast-history-recorder.test.ts`

**Ruling on the builder's call (spec §6, "which fields the midnight fix compares"):** every stored field (`p50`/`p80`/`p95`/`chanceOnTime`) is computed in holiday-adjusted working days, so NO stored field is holiday-immune. The recorder therefore compares a tab's computed entry with its OWN earlier computation, never with a peer's:
1. A stored entry for today that this tab did not record is ADOPTED (no write) and the tab remembers its own computed entry as its baseline. Change from today: the branch "not recorded today and the stored entry differs → write" goes.
2. A day change in a mounted tab whose other inputs (`tasks`, `milestones`, `planEnd`, `holidaySet`, scope epoch) did not change since its last run writes NOTHING (the idle-tab-at-midnight case); the next input change or load records the day.
3. Unchanged: nothing stored and not a bare rollover → write; own computed entry changed since its baseline → write.

- [ ] **Step 1: Write the failing tests** (existing harness):
  - `"two clients with different holiday sets write once per day"`: client A records day D; client B (different holidays) receives A's history → B writes nothing; A receives nothing new → total writes 1. Replace the old "two tabs that disagree settle" expectation of one write per tab with this.
  - `"an idle tab writes nothing at the day change"`: mounted tab, rerender with only `today` advanced → 0 writes; then a `tasks` change → 1 write for the new day.
  - `"a tab whose own forecast changes after adopting a peer entry writes"`: adopt, then `tasks` change → 1 write.
  - Keep `"keeps what it recorded across a SAME-project reload"` and `"forgets what it recorded when the scope epoch moves"` green.
- [ ] **Step 2: Run** → FAIL on the first two.
- [ ] **Step 3: Implement** (a ref holding the previous inputs to detect a bare rollover; the adopt branch). Update the file's header comment to state the new rule.
- [ ] **Step 4: Run** the recorder test + `src/app/use-insight-lifecycle.test.ts` → PASS.
- [ ] **Step 5: Commit** `fix: the forecast recorder adopts a peer's entry and skips an idle day change, one write per day (§502)`.

### Task 8: Explainer — Help link closes the popover; histogram labels stay inside (fixes 2 and 5)

**Files:**
- Modify: `src/app/sim-explainer.tsx`
- Test: `src/app/sim-explainer.test.tsx`

**Interfaces:**
- Help link: `onClick={() => { close(); onOpenHelp(FORECAST_SIM_HELP_ID); }}` order — close first (dismissal protocol, `docs/AGENTS/ui-shell.md` "dismissal"), then open Help.
- Labels: each cut label's x is clamped to `[LABEL_HALF_W, CHART_W − LABEL_HALF_W]` (`LABEL_HALF_W = 8`, a named constant); when two labels end up closer than `2 × LABEL_HALF_W`, the later one moves to a second row (`y = CHART_TOP + 7`, inside the viewBox; raise `CHART_TOP` if needed so neither row clips).

- [ ] **Step 1: Write the failing tests:** `"following the Help link closes the popover, then opens Help"` (dialog gone and `onOpenHelp` called once with `FORECAST_SIM_HELP_ID`); `"cut labels stay inside the chart at both ends"` (markers at first and last day → every `text` x ∈ [8, 232]); `"labels of cut-offs in neighbouring bins do not overlap"` (P50/P80 one bin apart → their (x, y) boxes do not overlap).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `fix: the simulation explainer closes before opening Help and keeps its cut labels inside the chart (§502)`.

### Task 9: Version restore keeps the current switch (fix 3)

**Files:**
- Modify: `src/app/forecast-simulation.ts`, `src/app/use-version-history.ts` (in `restore`, after `applyRestore`), `src/app/use-version-history-wiring.ts` (`prepareVersion`), and the restore comment review flagged in `use-version-history-wiring.ts` above `applyRestoredWorkspace` (it lists the slices restore fans out; add that the switch is pinned and why)
- Test: `src/app/forecast-simulation.test.ts`, `src/app/use-version-history.test.tsx`

**Interfaces:**
- Produces: `export function keepSimulationSwitch(target: SettingsOverrides | undefined, current: SettingsOverrides | undefined): SettingsOverrides | undefined` = `withSimulation(target, isSimulationOn(current))`, returning `target` itself when the switch already agrees.
- Mechanism: in `restore`, `restored.settingsOverrides = keepSimulationSwitch(merged.settingsOverrides, now.settingsOverrides)` (immutably) — AFTER the merge, so the blind-capture guard (`PRE_FORMAT_2_BLIND_SLICES`) still sees the version's own `undefined`. Cosmetic: `prepareVersion` applies the same pin to the version ONLY when `version.settingsOverrides !== undefined`, so a compare does not offer a switch row; pinning an `undefined` there would defeat the blind guard and blank other overrides.

- [ ] **Step 1: Write the failing tests:** `keepSimulationSwitch` truth table (on/off × present/absent, identity when equal, off folds an empty override to `undefined`); restore `"keeps the switch on when restoring a version where it was off"`; `"keeps it off when restoring a version where it was on"`; `"an unstamped capture with the switch on keeps the project's timezone override"` (Review Focus 5).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both files + `src/app/version-restore.test.ts` → PASS.
- [ ] **Step 5: Commit** `fix: version restore keeps the current simulation switch (§502)`.

### Task 10: Help — reopen action with the switch off; wording (fixes 6 and 7)

**Files:**
- Modify: `src/app/help-view.tsx`, `src/app/help-content-pane.tsx` (`HelpEntryAction` gains optional `note?: string`: rendered as muted text INSTEAD of a button), i18n files (`helpSimulationIntroNeedsSwitch`, `helpConceptForecastSimBody` EN + DE)
- Test: `src/app/help-view.test.tsx`, `src/app/help-content-pane.test.tsx`

**Interfaces:**
- `help-view.tsx` reads `settingsOverrides` via `useWorkspace()` and `isSimulationActive`. Switch active → today's action. Switch off (view shown) → `{ label: t("helpShowSimulationIntro"), note: t("helpSimulationIntroNeedsSwitch") }` where the note reads "The introduction shows on the Dashboard once Use Monte Carlo forecasting is switched on for this project." No navigation happens.
- Help body: the sentence "With too little history, a short line under the strip says what is missing instead." becomes "With too little history, or a finish beyond the forecast horizon, a short line under the strip says what is missing instead." Add one sentence: "The Dashboard also gains a Forecast tile with the weekly change and the milestones most at risk, a chance on each milestone, and a Next actions entry for a milestone unlikely on time." DE equivalents.

- [ ] **Step 1: Write the failing tests:** switch off → no "Show the simulation introduction again" button, the note text present, `setSettings` not called; switch on → button as before; body EN contains "beyond the forecast horizon" and "Forecast tile"; DE body (after `loadI18n("de")`) contains "Prognose" and differs from EN.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `fix: Help's simulation intro action says it needs the switch; Help names the new surfaces (§502)`.

### Task 11: Part-1 test hygiene (fix 8)

**Files:** the part-1 test files: `src/app/dashboard-panel.test.tsx`, `src/app/dashboard-sections/dashboard-kpi-strip.test.tsx`, `src/app/sim-explainer.test.tsx`, `src/app/sim-value.test.tsx`, `src/app/simulation-intro.test.tsx`, `src/app/help-view.test.tsx`, `src/app/help-menu.test.tsx`, `src/app/use-forecast-history-recorder.test.ts`, `src/app/forecast/app-forecast.test.ts`, `src/app/kpi-simulation.test.ts`.

- [ ] **Step 1:** In each file, every `describe` that calls `vi.spyOn` (directly or via `showForecastView()`) has `afterEach(() => vi.restoreAllMocks())`; list them with `grep -n "vi.spyOn\|showForecastView\|afterEach" <file>`. Every assertion on DE output is preceded by `await loadI18n("de")` in that test or a `beforeAll`.
- [ ] **Step 2:** Any further part-1 review minor found is fixed only if the fix is test-only.
- [ ] **Step 3: Run** each touched file → PASS (order-dependence is left to CI's `unit-shuffled`).
- [ ] **Step 4: Commit** `test: part-1 simulation tests restore their spies and load DE before asserting it (§502)`.

### Task 12: Docs, CHANGELOG, register

**Files:** `docs/AGENTS/dashboard.md`, `docs/AGENTS/forecast.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-10-15-forecast-simulation-part-2-design.md`, `docs/open-followups.md`

- [ ] **Step 1:** `dashboard.md`: the Forecast tile (id, size, the `simulationActive` gate, gate-not-storage, the measured content key) and the chips with their single explainer.
- [ ] **Step 2:** `forecast.md`: a "Simulation across the app — part 2" section (tile, chips, sim action and why it never enters the flat list or learning, the shared run, the recorder's new rule replacing the ★★★ paragraph's "writes when … the stored entry differs" clause, restore keeps the switch, the placeholder); add the part-2 surfaces to the HELD BACK list and the "Hiding the Forecast view" gated-surfaces list.
- [ ] **Step 3:** CHANGELOG `[Unreleased]`: extend the existing held-back Notes line (do not add a second one).
- [ ] **Step 4:** Spec header: "**Status:** approved by the owner 2026-10-16; built on `feat/502-sim-part-2`."
- [ ] **Step 5:** §502 Status: prepend an "**Update 2026-10-16 (part 2 built, held back; entry stays OPEN):**" paragraph with a command (`grep -n '"forecast"' src/app/dashboard-tiles.ts`), keep the rest as **Earlier:**. Run `npm run docs:symbols:check`, `npm run followups:index:check`, and `node scripts/gate-local.mjs --group static --allow-dirty` → all exit 0 (unpiped).
- [ ] **Step 6: Commit** `docs: part 2 of the simulation surfaces in AGENTS, CHANGELOG, spec and register (§502)`.

---

## Self-review notes

- Spec coverage: §3.1 → Tasks 2, 4; §3.2 → Task 5; §3.3 → Task 6; §3.4 → Tasks 1, 6 ("shares the Dashboard's run"), 4 (one memo in the panel); §4 fixes 1–8 → Tasks 7, 8 (2, 5), 9, 3, 10 (6, 7), 11; §5 → Global Constraints + Task 12; §6 builder calls → Task 7 ruling, Task 4 (weekly change with undefined P80 = `beyond`), Task 6 helper location.
- Calls made in this plan, not the spec: the EN percent format "31%" (app convention) over the spec's "31 %"; the sim action requires the milestones module; sim actions offer only Open and Snooze and skip learning; the Help reopen action becomes a note when the switch is off; `SimExplainer` `kind: "milestone"` drops the histogram; restore pins the switch after the merge.
