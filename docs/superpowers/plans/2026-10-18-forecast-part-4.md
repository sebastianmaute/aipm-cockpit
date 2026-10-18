# Forecast part 4 — from forecast to decision: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Target confidence, an app-computed "what it would take", a prepared proposal, an Ask-Claude draft path, the Reports Forecast section, the Gantt band, the P80 line, the export block, and full Claude coverage — all held back with the Forecast view.

**Architecture:** One pure lever engine (`forecast-levers.ts`) evaluates single-lever scenarios through the existing `computeScenarioColumn`, written as a probe-by-probe search so a hook (`use-lever-search.ts`) runs it off the render path and the AI tool and exports run it to completion. Target confidence and the proposal id live in `SettingsOverrides.forecast`; one hook writes and logs them. Every surface reads the same engine and the same settings.

**Tech Stack:** Next.js (repo's pinned version), React 19, TypeScript, Vitest + RTL, Playwright (not run locally).

**Spec:** [`docs/superpowers/specs/2026-10-18-forecast-part-4-decision-surfaces-design.md`](../specs/2026-10-18-forecast-part-4-decision-surfaces-design.md) and its mockup (`2026-10-18-forecast-part-4-mockup.html`). Read both. Background: `docs/AGENTS/forecast.md`, `docs/AGENTS/ai-assistant.md`.

## Global Constraints

- Everything is behind `isSimulationActive(settingsOverrides, features)`; `"forecast"` stays in `RELEASE_HIDDEN_VIEWS`. No un-hide.
- Target confidence values exactly `50 | 80 | 95`; default `80`; labels reuse `simEvenOdds` / `simSafeToCommit` and a "Cautious" label (reuse the existing P95 label key if one exists, else add `simCautious`).
- Existing primitives only: `Card`, `Section`, `Tile`, `SimValue`/`SimBadge`, `SegmentedControl`, `Banner`, `TABLE_HEAD_CLASS`/`SortResizeTh`, `RagDot`, `Badge`, `Button`, `ToggleButton` (chip), `Select`/`Input`, `Modal`/`ModalHeader`, native `<details>`, `SparklesIcon` from `icons.ts`. Theme tokens only.
- i18n: every string in `i18n.ts` and `i18n.de.ts` (real umlauts). Edit `i18n.de.ts` only with a node utf8 script anchored on `\r\n`; never the Edit tool.
- Row-unique accessible names on per-row buttons (`rowLabel` + `useRowTokens`); a unit test per new per-row control. The Ask-Claude draft button's name never equals `aiAskClaude` or `forecastAskClaude`.
- `src/app` files are CRLF: Edit tool only, never `sed -i`; no Write over an existing file. Docs are LF.
- `task-manager.tsx` gains no lines.
- Engines stay i18n-free and React-free (`forecast-levers.ts`, verdict and export-row builders take `lang` only where they format).
- Before every commit, unpiped, each exit 0: `npx eslint --max-warnings=0 <changed files>; echo "EXIT=$?"` and `npx tsc --noEmit; echo "EXIT=$?"`. If docs changed: `npm run docs:symbols:check` and `npm run docs:claims:check`.
- Vitest: targeted files only, never the full suite, never two runs at once, always under the lock: `if mkdir /c/Projects/.vitest-lock 2>/dev/null; then npx vitest run <files> > <log> 2>&1; echo "EXIT=$?"; rm -rf /c/Projects/.vitest-lock; else echo LOCKED; fi`. Check `Test Files N passed` equals the files given. Never delete a lock you did not create.
- Commits cite §502; no `Claude-Session:` trailer, no URLs, no `Closes #`, no Co-Authored-By; never `--amend`, `git restore`, `git checkout --`; never commit `AGENTS.md`; stage files explicitly; never push.
- Mutation-prove each task's key test (revert the fix, see red with the expected message, restore) and report the count.

## Review Focus

1. **Below the history floor** (`kind: "insufficient"`): the Reports section shows the existing insufficient state, runs no lever search, and the export/AI report say "insufficient". → Task 5 and Task 9 tests.
2. **Budget module off or no booked hours:** the people lever reads "needs booked hours"; the cost tile and cost rows are absent; tasks lever still works. → Task 2 test.
3. **Inputs change mid-search** (a task edited, the target switched): stale probe results are discarded and the row returns to "Working it out…"; no number from the old inputs is shown. → Task 3 test.
4. **Proposal id naming a deleted or never-existing scenario:** reads as "no proposal" everywhere (Reports, export, AI), and comes back when undo restores the scenario. → Task 1 and Task 5 tests.
5. **Milestone overdue or without linked open tasks:** no lever, no Explore, no Ask-Claude button on that row. → Task 2 and Task 4 tests.

---

## Phase A — settings, engine, Forecast view (PR 1)

### Task 1: Target confidence and proposal in project settings, logged

**Files:**
- Create: `src/app/forecast-target.ts`, `src/app/use-forecast-settings.ts`
- Modify: `src/app/settings-types.ts` (`SettingsOverrides.forecast`), `src/app/settings-overrides.ts` (`sanitizeSettingsOverrides`), `src/app/forecast-simulation.ts` (`withSimulation` keeps the other forecast fields), `src/app/activity-log.ts` (three kinds + `ACTIVITY_KIND_TO_KEY`), `src/app/i18n.ts`, `src/app/i18n.de.ts`, `src/app/version-diff.ts` (`COLLECTION_SPECS` row), `src/app/workspace-section.tsx` (instantiate the hook)
- Test: `src/app/forecast-target.test.ts`, `src/app/use-forecast-settings.test.tsx`, `src/app/settings-overrides.test.ts`, `src/app/forecast-simulation.test.ts`, `src/app/version-diff.test.ts`, `src/app/entity-persistence-registry.test.ts` (or the existing settingsOverrides round-trip test — grep `settingsOverridesToCsv` in tests)

**Interfaces:**
- Produces:
  - `type TargetConfidence = 50 | 80 | 95`; `const TARGET_CONFIDENCES: readonly TargetConfidence[] = [50, 80, 95]`; `const DEFAULT_TARGET_CONFIDENCE: TargetConfidence = 80`
  - `targetConfidenceOf(o: SettingsOverrides | undefined): TargetConfidence`
  - `proposalIdOf(o: SettingsOverrides | undefined, scenarios: readonly ForecastScenario[]): number | null` — null when unset or when the id names no scenario (stale-id rule).
  - `withTargetConfidence(o, v: TargetConfidence): SettingsOverrides | undefined` and `withProposal(o, id: number | null): SettingsOverrides | undefined` — new objects; 80 and null are stored as absence.
  - `chanceSeverity(chance: number, goal: TargetConfidence): "red" | "amber" | "green"` — red `< 0.5`, amber `< goal/100`, green otherwise; the one rule for every part-4 `RagDot` and for the verdict (Task 5).
  - `SettingsOverrides.forecast = { showSimulation?: boolean; targetConfidence?: 50 | 95; proposalScenarioId?: number }`
  - Activity kinds `"forecast.targetChanged"` (args: from, to), `"forecast.proposalSet"` (args: id, name), `"forecast.proposalCleared"` (args: id, name)
  - `useForecastSettings({ settingsOverrides, setSettingsOverrides, scenarios, logActivity }): { target: TargetConfidence; proposalId: number | null; setTarget(v: TargetConfidence): void; setProposal(id: number | null): void }` — logs, never captures undo (owner decision).

- [ ] **Step 1: Write failing tests**
  - `forecast-target.test.ts`: `chanceSeverity(0.49, 80) === "red"`, `chanceSeverity(0.5, 80) === "amber"`, `chanceSeverity(0.8, 80) === "green"`, `chanceSeverity(0.8, 95) === "amber"`; `targetConfidenceOf(undefined) === 80`; `targetConfidenceOf({forecast:{targetConfidence:95}}) === 95`; `withTargetConfidence(undefined, 80) === undefined`; `withProposal({forecast:{showSimulation:true, proposalScenarioId:3}}, null)` deep-equals `{forecast:{showSimulation:true}}`; `proposalIdOf({forecast:{proposalScenarioId:7}}, [{id:3,...}]) === null`; `proposalIdOf(..., [{id:7,...}]) === 7`.
  - `settings-overrides.test.ts`: `{forecast:{targetConfidence:95, proposalScenarioId:4}}` (switch absent) survives `sanitizeSettingsOverrides` unchanged; `targetConfidence: 80`, `70`, `"95"` are dropped; `proposalScenarioId: 0`, `-1`, `1.5` dropped; `sanitizeOverridesOrNone({forecast:{}})` is `undefined`.
  - `forecast-simulation.test.ts`: `withSimulation({forecast:{showSimulation:true, targetConfidence:95}}, false)` deep-equals `{forecast:{targetConfidence:95}}`.
  - `use-forecast-settings.test.tsx`: `setTarget(95)` calls `logActivity("forecast.targetChanged", 80, 95)` once and writes `targetConfidence: 95`; `setTarget(95)` again logs nothing; `setProposal(4)` logs `"forecast.proposalSet", 4, <name>`; `setProposal(null)` logs `"forecast.proposalCleared"`.
  - `version-diff.test.ts`: a `forecastScenarios` change (rename id 1) appears in `diffWorkspaces` under label "Forecast scenarios" with the scenario name; extend `arraysFixture` so the "never falls back to #id" guard covers it.
  - Round-trip: a workspace with `settingsOverrides.forecast = {targetConfidence: 95, proposalScenarioId: 2}` and no switch survives CSV, Markdown and JSON.
- [ ] **Step 2: Run them; expect red** (missing module / dropped fields / missing diff row).
- [ ] **Step 3: Implement.** Sanitizer keeps each of the three fields independently; `hasAnyOverride` unchanged (it already folds on `forecast !== undefined`; the sanitizer must not emit an empty `forecast`). Version-diff row: `{ key: "forecastScenarios", label: "Forecast scenarios", kind: "list", nameField: "name" }`. i18n: `activityForecastTargetChanged`, `activityForecastProposalSet`, `activityForecastProposalCleared`. Wire the hook in `workspace-section.tsx` next to `useForecastScenarios` (line ~338).
- [ ] **Step 4: Run; expect green.** Mutation: revert the sanitizer change → the "survives without the switch" test fails.
- [ ] **Step 5: Commit** `feat: target confidence and proposal in project settings, logged; scenarios in version compare (§502)`

### Task 2: The lever engine

**Files:**
- Create: `src/app/forecast-levers.ts`
- Test: `src/app/forecast-levers.test.ts`

**Interfaces:**
- Consumes: `computeScenarioColumn`, `buildScheduleContext`, `ScenarioRunInput`, `ScenarioColumn` (`forecast-scenario-compare.ts`); `ScheduleContext`, `ScenarioDirectory` (`forecast-added-people.ts`); `ScenarioChange`, `ADDED_COUNT_MAX`, `ADDED_HOURS_MIN`, `ADDED_HOURS_MAX`, `DEFAULT_RAMP_WEEKS` (`forecast-scenarios.ts`); `TargetConfidence` (Task 1).
- Produces:
  - `type LeverTarget = { kind: "milestone"; id: number } | { kind: "planEnd" }`
  - `type LeverKind = "people" | "tasks"`
  - `type LeverOutcome = { state: "reaches"; n: number; chance: number } | { state: "out-of-reach" } | { state: "inert"; reason: "needs-booked-hours" | "no-open-tasks" } | { state: "on-target" }`
  - `type WhatItTakes = { target: LeverTarget; chance: number; prioritised: number | null; people: LeverOutcome; tasks: LeverOutcome }`
  - `placeholderWho(context: ScheduleContext, directory: ScenarioDirectory): AddedPeopleWho | null` — label from i18n is NOT here: label is the constant `"Placeholder"` stored in data (same as the editor's default placeholder label; grep the editor for it and reuse its constant). `hoursPerWeek = clamp(round(teamHours × 5 / onTeam.size), ADDED_HOURS_MIN, ADDED_HOURS_MAX)`; `rate` = mean resolved rate of `onTeam` resources in `directory.baseCurrency` (use the budget rate resolver the scenario engine already uses for named people — grep `resolveAddedPeople`); `currency = directory.baseCurrency`; null when `teamHours === null` or `onTeam.size === 0`.
  - `leverChange(kind: LeverKind, n: number, target: LeverTarget, who: AddedPeopleWho | null, today: string): ScenarioChange` — people: `{kind:"addPeople", who:{...who, count:n}, from: today, until: "", rampWeeks: DEFAULT_RAMP_WEEKS}`; tasks: `{kind:"scope", tasks: -n, on: today, milestoneId?}` (no `milestoneId` for plan end).
  - `leverBound(kind, target, context): number` — people: `min(context.onTeam.size, ADDED_COUNT_MAX)`; tasks: `floor(openLinked / 2)` (plan end: all open tasks / 2).
  - `chanceFor(column: ScenarioColumn, target: LeverTarget): number | null`
  - Probe search as a step machine: `type LeverSearch`; `startSearch(bound: number, goal: number): LeverSearch`; `nextProbe(s: LeverSearch): number | null` (null = done); `applyProbe(s: LeverSearch, n: number, chance: number | null): LeverSearch`; `searchOutcome(s: LeverSearch): LeverOutcome`. Bisection for the smallest n with `chance >= goal/100`, assuming chance is non-decreasing in n; probe `bound` first (out of reach ends after one probe).
  - `whatItTakesSync(input: ScenarioRunInput, context: ScheduleContext, target: LeverTarget, goal: TargetConfidence, asIs: ScenarioColumn): WhatItTakes` — runs both searches to completion (used by AI and exports).

- [ ] **Step 1: Write failing tests** with a fixture of ~30 finished tasks over 40 working days, 12 open tasks, one milestone with 6 linked open tasks due soon:
  - `chanceFor` reads the milestone's `chance` and `column.chanceOnTime` for plan end; `null` for an overdue milestone.
  - The step machine on a synthetic monotone function `n => n >= 7 ? 0.85 : 0.5` with bound 20 and goal 80 returns `{state:"reaches", n:7}` in at most `1 + ceil(log2(20))` probes; with bound 5 returns `out-of-reach` after exactly 1 probe.
  - `whatItTakesSync` on the fixture: the chance it reports for the people lever equals `chanceFor(computeScenarioColumn(input, [leverChange("people", n, …)], context), target)` exactly (common random numbers).
  - No hours facts (`budgetFacts: null`) → `people: {state:"inert", reason:"needs-booked-hours"}`, `tasks` still computed.
  - A milestone already at or above goal → both outcomes `on-target`.
  - Milestone with no linked open tasks → `tasks: inert "no-open-tasks"`.
- [ ] **Step 2: Run; expect red.**
- [ ] **Step 3: Implement** per the interfaces. No React, no i18n.
- [ ] **Step 4: Run; expect green.** Mutation: make `applyProbe` move the wrong bound → the probe-count and n assertions fail.
- [ ] **Step 5: Measure** `whatItTakesSync` for 5 below-target milestones + plan end on `sample-workspace-small.json`; note ms in the task report (goes into `docs/AGENTS/forecast.md` in Task 12).
- [ ] **Step 6: Commit** `feat: lever engine — smallest single lever to reach the target (§502)`

### Task 3: Off-render lever search hook

**Files:**
- Create: `src/app/use-lever-search.ts`
- Modify: `vitest.config.ts` only if the hook is judged glue (it holds logic — test it, do not exclude)
- Test: `src/app/use-lever-search.test.tsx`

**Interfaces:**
- Consumes: Task 2.
- Produces: `useLeverSearch(args: { input: ScenarioRunInput | null; targets: readonly LeverTarget[]; goal: TargetConfidence; enabled: boolean }): ReadonlyMap<string, WhatItTakes | "pending">` keyed `leverKey(target)` (`"m:<id>"` / `"plan"`), plus exported `leverKey(target: LeverTarget): string`. Runs one probe per macrotask (`setTimeout(…, 0)`), builds the As-is column and context once per input, cancels on any input/target/goal change, caches the last finished result per `(input identity, goal)`.

- [ ] **Step 1: Failing tests** (fake timers): first render returns `"pending"` for every target; after advancing timers, values equal `whatItTakesSync` for the same input; changing `goal` mid-run → all keys back to `"pending"` and the old run's later probes never land (assert no value from goal 80 appears after switching to 95); `enabled: false` → empty map, no timers scheduled.
- [ ] **Step 2: red. Step 3: implement** (no `setState` in an effect body synchronously — schedule; follow the repo's `react-hooks/set-state-in-effect` rule; read an existing timer hook for the pattern). **Step 4: green**; mutation: drop the cancel → the stale-value test fails.
- [ ] **Step 5: Commit** `feat: run the lever search off the render path (§502)`

### Task 4: Forecast view — target control, what-it-takes column, Explore draft, proposal toggle

**Files:**
- Modify: `src/app/forecast-panel.tsx`, `src/app/forecast-tables.tsx` (`MilestoneTable`), `src/app/forecast-scenarios-view.tsx`, `src/app/forecast-scenario-editor.tsx`, `src/app/forecast-scenario-tables.tsx` (proposal badge), `src/app/workspace-section.tsx` (pass settings hook + pending draft), `src/app/workspace-tab-context.tsx` (pending forecast draft), `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Create: `src/app/forecast-target-control.tsx`, `src/app/forecast-lever-cell.tsx`
- Test: `src/app/forecast-target-control.test.tsx`, `src/app/forecast-lever-cell.test.tsx`, `src/app/forecast-panel.test.tsx`, `src/app/forecast-scenarios-view.test.tsx`, `src/app/forecast-scenario-editor.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `ForecastTargetControl({ lang, value, onChange, disabled? })` — `SegmentedControl` with three options, labels "Even odds 50 %" / "Safe to commit 80 %" / "Cautious 95 %".
  - `ForecastLeverCell({ lang, milestoneName, result: WhatItTakes | "pending", goal, onExplore?: (kind: LeverKind, n: number) => void, onAskClaude?: () => void })` — `Badge`s per lever ("+N people (team average)", "N fewer tasks", "prioritise it → X %" / "prioritising alone: not enough", "needs booked hours", "not within reach"), "On target", or "Working it out…"; Explore `Button` secondary xs only when people or tasks `reaches`; reused by Reports (Task 5).
  - `WorkspaceTabContext`: `pendingForecastDraft: ForecastDraftRequest | null`, `requestForecastDraft(req: ForecastDraftRequest): void`, `clearForecastDraft(): void`, with `type ForecastDraftRequest = { target: LeverTarget; kind: LeverKind; n: number; alt: { kind: LeverKind; n: number } | null }` — sets the active tab to `"forecast"`. Consumer seeds its handled ref with a sentinel (remount-swallow rule in AGENTS.md).
  - `ScenarioDialog` edit variant gains `seed?: ScenarioDraft` and `alt?: { label: string; seed: ScenarioDraft }`; the editor shows "Or use … instead" (`Button` ghost xs) when `alt` is set, and Save disabled with the existing cap message when `!api.canCreate`.
  - Scenario list row: `ToggleButton` chip "Use as proposal" (row-unique name) before Edit; pressed = `proposalId === s.id`; `onChange` → `setProposal(pressed ? s.id : null)`. Compared table header of the proposal column carries a `Badge` "proposal".
- [ ] **Step 1: Failing tests:**
  - Target control: three radios/buttons, the selected one `aria-checked`/pressed per `SegmentedControl`'s contract; clicking 95 calls `onChange(95)`.
  - Lever cell: `"pending"` renders "Working it out…"; a `reaches` people outcome renders "+2 people (team average)" and an Explore button named `rowLabel("Explore", "Go-live")`; prioritise-only (`people` and `tasks` out-of-reach, `prioritised >= goal`) renders no Explore; `inert needs-booked-hours` renders "needs booked hours".
  - Panel: with `showSimulation`, the Quick milestone table has a "What it would take to reach 80 %" header; switching the target to 95 changes the header text and calls `setTarget(95)`.
  - Explore: clicking Explore on Go-live switches to Scenarios mode with the editor open, name field `"Go-live — what it would take (+2 people)"`, one Add-people row with count 2; Cancel closes without calling `createScenario`; Save calls it once.
  - Cap: with 4 scenarios, the Explore draft's Save is disabled and the cap message is visible.
  - Proposal toggle: pressing it on scenario 2 calls `setProposal(2)`; pressing again calls `setProposal(null)`; two toggles have distinct accessible names.
  - Pending draft from context: a fresh mount of the panel with `pendingForecastDraft` set opens the draft once and calls `clearForecastDraft` (sentinel-seed test: mount fresh, not re-render).
- [ ] **Step 2: red. Step 3: implement.** Explore builds the seed with `leverChange` from Task 2 and `placeholderWho` from the panel's comparison context. **Step 4: green.** Mutation: seed the pending-draft ref from the live prop → the fresh-mount test fails.
- [ ] **Step 5: Commit** `feat: Forecast view — target confidence, what it would take, Explore draft, proposal (§502)`

## Phase B — Reports, Gantt, P80 line, exports (PR 2)

### Task 5: Reports Forecast section

**Files:**
- Create: `src/app/forecast-report-section.tsx`, `src/app/forecast-verdict.ts`, `src/app/forecast-p80-line.tsx`
- Modify: `src/app/report-blocks.ts` (block `"forecast"`, full width, tall), `src/app/reports.tsx` (render it; hidden from board and shelf while the simulation is off, as the Dashboard Forecast tile does — grep `"forecast"` in `dashboard-tiles.ts` for the gate pattern), `src/app/workspace-section.tsx` (build the `ScenarioRunInput` on the reports tab too; pass scenarios, settings hook, history), `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/forecast-verdict.test.ts`, `src/app/forecast-report-section.test.tsx`, `src/app/forecast-p80-line.test.tsx`, `src/app/report-blocks.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 (`ForecastTargetControl`, `ForecastLeverCell`, `useLeverSearch`, `requestForecastDraft`).
- Produces:
  - `forecastVerdict(chanceOnTime: number | null, goal: TargetConfidence, below: number, total: number): { severity: "error" | "warn" | "success"; below: number; total: number } | null` — severity maps `chanceSeverity` (Task 1) red→error, amber→warn, green→success; null when `chanceOnTime` is null.
  - `ForecastP80Line({ lang, history: readonly ForecastHistoryEntry[], planEnd, compact?: boolean })` — reuses `TrendChart`; points = entries with a non-null `p80`, y = working days from the first entry's date (or plain day offset; builder's choice, documented in the component docstring); reference line at plan end. Empty history → nothing.
  - `ForecastReportSection(props)` — layout exactly as spec §3.2 / mockup Reports tab: header (`Section` title + `SimBadge` + target control), verdict `Banner`, basis line, four `Tile`s with `SimValue`, compact P80 line, plan-end lever line, milestones table worst first using `ForecastLeverCell`, proposal `Select` + As is vs Proposal table (or the empty line), "Forecast by group" `<details>` (the existing group fold-out content per surfaces spec §3.7; computed only when opened).
- [ ] **Step 1: Failing tests:**
  - Verdict: `(0.41, 80, 2, 5)` → error; `(0.64, 80, …)` → warn; `(0.85, 80, …)` → success; `(0.85, 95, …)` → warn; `(null, …)` → null.
  - Section: insufficient run renders `InsufficientState` and starts no search (spy `useLeverSearch` args `enabled: false`); below-target milestones sorted worst first; on-target rows read "On target"; proposal `Select` lists scenarios + "None" and choosing one calls `setProposal(id)`; a stale proposal id renders the empty-proposal line; cost tile absent when `costOn` is false; Explore calls `requestForecastDraft` with the row's target and lever.
  - Block registry: `"forecast"` exists, `w: 4`, and is absent from the visible board when the simulation is off.
- [ ] **Step 2: red. Step 3: implement. Step 4: green.** Mutation: flip the verdict's `<` to `<=` at 0.5 → boundary test fails.
- [ ] **Step 5: Commit** `feat: Reports Forecast section — verdict, levers, proposal (§502)`

### Task 6: Ask Claude to draft a proposal

**Files:**
- Create: `src/app/forecast-draft-ask.tsx`
- Modify: `src/app/forecast-lever-cell.tsx` (render it via `onAskClaude`), `src/app/forecast-report-section.tsx` (empty-proposal area), `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/forecast-draft-ask.test.tsx`

**Interfaces:**
- Produces: `ForecastDraftAsk({ lang, milestone: { name: string; date: string; chance: number } | null, goal: TargetConfidence })` — `Button` secondary xs + `SparklesIcon` (`h-4 w-4`); label `forecastDraftAskLabel` ("Ask Claude to draft a proposal"); accessible name `rowLabel(label, milestone.name)` when a milestone is given; click → `requestChat(t(lang, "forecastDraftAskBody", name, date, percent, goal), true)` (milestone null → `forecastDraftAskBodyPlan`). Rendered only when `aiEnabled && showSimulation && !isPopout`.
- [ ] **Step 1: Failing tests:** click sends the body containing the milestone name, its percent and "80 %"; accessible name differs from `t(lang,"aiAskClaude")` and from `t(lang,"forecastAskClaude")` and contains the visible label; not rendered when AI is off.
- [ ] **Step 2–4:** red, implement, green. Mutation: drop the milestone from the name → distinct-name test fails.
- [ ] **Step 5: Commit** `feat: Ask Claude to draft a proposal (§502)`

### Task 7: Gantt band, P80 line and chance chips; Trends chart

**Files:**
- Create: `src/app/gantt-forecast-layer.tsx`
- Modify: `src/app/gantt-chart.tsx` (mount the layer behind bars), `src/app/gantt-rows.tsx` (chip on unfinished milestone rows), `src/app/gantt.tsx` (props), `src/app/workspace-section.tsx` (add `"gantt"` to the `useAppForecast` active tabs; pass the result), `src/app/trends-panel.tsx` (a `ForecastP80Line` chart, own date axis), `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/gantt-forecast-layer.test.tsx`, `src/app/gantt.test.tsx` (or the chart's test), `src/app/trends-panel.test.tsx`

**Interfaces:**
- Produces: `GanttForecastLayer({ p50, p80, p95, dayIndexOf: (iso: string) => number | null, nameColWidth, height })` — band P50–P95 with a token fill at low opacity, dashed P80 line in `--ui-green-strong`, labelled "P80 {date}"; dates beyond the visible range clamp to the edge. Chip = `SimValue`-look percent on milestone rows with `state: "chance"`.
- [ ] **Step 1: Failing tests:** layer renders band and line at the `dayLeftPx` positions of P50/P95 and P80; nothing renders when the simulation is off (Gantt gets `forecast: null`); a milestone row shows "31 %" with a `sim` badge; Trends renders the P80 chart only when `forecastHistory` has ≥ 2 entries with `p80`.
- [ ] **Step 2–4:** red, implement, green. Eye-check note in the report: band opacity chosen so bars stay readable (the owner checks at un-hide).
- [ ] **Step 5: Commit** `feat: forecast band and chance chips on the Gantt; P80 line in Trends (§502)`

### Task 8: Export and document block

**Files:**
- Create: `src/app/forecast-decision.ts` (pure: builds the decision model), `src/app/export-forecast-decision-section.ts` (rows)
- Modify: `src/app/export-forecast-section.ts` (`ExportExtras.forecastDecision?`), `src/app/export-sections.ts` (section `"forecastDecision"`, columns `KV_EXPORT_FIELDS`), `src/app/export-section-labels.ts`, `src/app/doc-data-section.ts`, `src/app/doc-render-html.ts` (+ docx/pptx renderers where `budgetForecast` is handled), `src/app/document-block-editors.tsx` (selectable data block), `src/app/export-extras-context.tsx` (compute on export), `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/forecast-decision.test.ts`, `src/app/export-forecast-decision-section.test.ts`, `src/app/doc-data-section.test.ts`

**Interfaces:**
- Produces: `type ForecastDecision = { goal: TargetConfidence; p80: string | null; planEnd: string; chanceOnTime: number | null; cost: { p80: number; overBudget: number; currency: BudgetCurrency } | null; below: { name: string; date: string; chance: number; take: WhatItTakes }[]; proposal: { name: string; p80: string | null; chanceOnTime: number | null; costP80: number | null } | null } | { insufficient: true }`; `buildForecastDecision(input, scenarios, settingsOverrides, goal): ForecastDecision | null` (null while the simulation is off — caller passes `isSimulationActive`); `forecastDecisionRows(d, lang): string[][]` — every row's first cell starts with or the heading says "simulated".
- [ ] **Step 1: Failing tests:** rows for the fixture match the mockup's export block line by line (heading with "simulated" and target; P80 vs plan end; cost; below-target milestones with "reaches 80 % with +2 people, or 9 fewer tasks"; proposal); simulation off → section omitted (not empty); insufficient → one row saying so; CSV/Markdown/JSON workspace formats never contain it (golden tests stay byte-identical — run `golden-workspace.test.ts`).
- [ ] **Step 2–4:** red, implement (synchronous `whatItTakesSync` on the explicit export action; record the measured cost), green.
- [ ] **Step 5: Commit** `feat: forecast decision block in exports and documents (§502)`

## Phase C — Claude, help, docs (PR 3)

### Task 9: Claude reads everything

**Files:**
- Modify: `src/app/forecast-ai-report.ts` (`ForecastReport` additions), `src/app/forecast-ai-prompt.ts`, `src/app/chat-tool-defs-forecast.ts` (`get_forecast` description), `src/app/use-forecast-tools.ts` (pass settings + history)
- Test: `src/app/forecast-ai-report.test.ts`, `src/app/forecast-ai-prompt.test.ts`, `src/app/chat-tools-forecast.test.ts`

**Interfaces:**
- Produces: `ForecastReport` gains `targetConfidence: TargetConfidence`, `whatItTakes: { planEnd: WhatItTakes | null; milestones: { id: number; name: string; take: WhatItTakes }[] }` (below-target only), `proposal: { id: number; name: string } | null`, `p80History: { date: string; p80: string | null }[]` (last 26 entries); `ForecastReportInput` gains `settingsOverrides`.
- [ ] **Step 1: Failing tests:** report on the fixture carries `targetConfidence: 80`, a `whatItTakes` entry for the below-target milestone whose people `n` equals Task 2's; stale proposal id → `proposal: null`; insufficient run → `whatItTakes` empty; prompt block mentions target confidence and the new tools only in the "on and offered" state.
- [ ] **Step 2–4:** red, implement, green. Record `get_forecast` cost.
- [ ] **Step 5: Commit** `feat: get_forecast reads target, what it would take, proposal and P80 history (§502)`

### Task 10: Claude writes everything — delete, proposal, target

**Files:**
- Modify: `src/app/chat-tool-defs-forecast.ts`, `src/app/chat-tools-forecast.ts`, `src/app/use-forecast-tools.ts`, `src/app/chat-dispatcher-types.ts`, `src/app/chat-proposal.ts` (staging tables: `ENTITY_WRITE_TOOLS`, `TARGET_MINTED_BY`, token tables), `src/app/chat-proposal-apply.ts`, `src/app/ai-entity-token.ts` (if delete needs a row kind entry), `src/app/inline-ai-edit/*` coverage tables if they enumerate tools
- Test: `src/app/chat-tools-forecast.test.ts`, `src/app/use-forecast-tools.test.tsx`, `src/app/chat-proposal.test.ts` (drift tests — classify, never widen), `src/app/chat-proposal-apply*.test.ts`, `src/app/inline-ai-edit/tool-input-coverage.test.ts`

**Interfaces:**
- Produces tools: `delete_forecast_scenario { id: number; expectedToken: string }`, `set_forecast_proposal { id: number | null }`, `set_forecast_target_confidence { value: 50 | 80 | 95 }`. All gated by `isForecastEnabled` (refuse with `FORECAST_OFF_MESSAGE`), staged and approved like `update_forecast_scenario`; delete uses the `forecastScenario` token kind; writes go through `useForecastScenarios.deleteScenario` and `useForecastSettings` so logging and undo match the UI, with the AI actor.
- [ ] **Step 1: Failing tests:** each tool refuses while the switch is off; delete with a stale token refuses; delete applies, logs `forecastScenario.deleted` as AI, and is undoable; `set_forecast_proposal` with an unknown id refuses with a templated message; target 70 refuses; staged plan `[create_forecast_scenario, set_forecast_proposal(id = provisional)]` remaps the provisional id (add `set_forecast_proposal.id` as a link field minted by `create_forecast_scenario`); deselecting the create cascades the proposal call.
- [ ] **Step 2–4:** red, implement, green. Mutation: remove the new link field → the remap test fails.
- [ ] **Step 5: Commit** `feat: Claude can delete scenarios, set the proposal and the target confidence (§502)`

### Task 11: Help texts and feature guide

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (`helpConceptForecastSimBody`), `lib/app-feature-guide.md` only for lines that do not name the hidden Forecast view or the Reports Forecast section, `docs/AGENTS/forecast.md` ("HELD BACK" un-hide list: the exact new Reports-help sentence (EN + DE) and guide lines to put back at un-hide)
- Test: existing `src/app/i18n*.test.ts`, the operating-guide sync test (run `node scripts/gen-operating-guide.mjs` and its check)

- [ ] **Step 1:** Write the concept-help additions: target confidence (three levels), what it would take (one lever at a time; levers are what scenarios model; prioritising is the existing column), the proposal, Ask Claude to draft, Gantt band and chips, P80 line in Trends and Reports, the export block. DE with real umlauts via node utf8 script.
- [ ] **Step 2:** Write the held-back sentences into the un-hide list in `docs/AGENTS/forecast.md`.
- [ ] **Step 3:** Regenerate the operating guide if `lib/app-feature-guide.md` changed; run the i18n and guide tests under the lock; tsc.
- [ ] **Step 4: Commit** `docs: help and guide for forecast part 4, held back with the view (§502)`

### Task 12: Reference docs, register, changelog

**Files:**
- Modify: `docs/AGENTS/forecast.md` (new "Part 4 — from forecast to decision" section: settings fields and sanitizer rule, lever engine and search, measured costs with a reproduce command, surfaces, exports, AI tools), `docs/AGENTS/ai-assistant.md` ("Forecast tools": three new tools, report fields), `docs/open-followups.md` (§502 status: part 4 built, held back; remaining: un-hide), `CHANGELOG.md` (Notes entry, held back)
- [ ] **Step 1:** Write the docs; every backticked mixed-case name must exist in `src` (docs:symbols); put a reproduce command beside every count.
- [ ] **Step 2:** `npm run docs:symbols:check`, `npm run docs:claims:check`, `npm run followups:index:check` — each exit 0 unpiped.
- [ ] **Step 3: Commit** `docs: forecast part 4 reference, register and changelog (§502)`

---

## PR grouping

One PR per phase, each green on the eight required checks before the next starts: PR 1 = Tasks 1–4, PR 2 = Tasks 5–8, PR 3 = Tasks 9–12. Push, PR and merge only on the owner's word.
