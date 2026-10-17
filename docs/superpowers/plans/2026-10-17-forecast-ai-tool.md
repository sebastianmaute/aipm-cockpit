# Forecast AI Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The assistant can read the project's Monte Carlo forecast and saved scenarios (`get_forecast`, with an unsaved `whatIf`), create and edit a saved scenario (`create_forecast_scenario`, `update_forecast_scenario`), and the Forecast view offers four Ask-Claude chips.

**Architecture:** Two pure modules carry the logic. One parses and validates tool input; the other turns the existing scenario comparison (`computeScenarioComparison` / `computeScenarioColumn`) into one JSON report. The rest is wiring along the existing chat-tool seams. A new dispatcher hook, `use-forecast-tools.ts`, is spread into the dispatcher the way `useRegisterTools` is, and new runTool cases live in `chat-tools-forecast.ts`. A third `ToolFlags` bit stops the three tools being offered while the simulation gate is closed. The Ask-Claude chips are a small in-view menu that calls `requestChat` from `useWorkspaceTab()`.

**Tech Stack:** TypeScript, React 19, Next (repo-pinned), Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-10-16-forecast-scenarios-and-ai-tool-design.md` — §4.4 (this step), with §4.1, §4.1a, §4.3, §5.3 and §5.4 as the rules it applies.

## Global Constraints

- Gate (spec §4.4): the three tools are offered and served only when `isSimulationActive(workspace.settingsOverrides, settings.features)` is true. `"forecast"` stays in `RELEASE_HIDDEN_VIEWS`. This step is verified by unit tests only.
- Every figure `get_forecast` returns uses the app defaults: `DEFAULT_HISTORY_WINDOW` (60 working days) and unit `"tasks"`, for the saved scenarios and the `whatIf` too. The result states both settings.
- Common random numbers (spec §5.4): `get_forecast` computes its As-is, scenario and `whatIf` columns through `computeScenarioComparison` / `computeScenarioColumn` and nothing else. A `whatIf` with the same rows as a saved scenario returns identical numbers.
- The write tools follow the chat rules exactly:
  - `shouldStage`: one write applies, two or more stage.
  - An applied update is undo-captured. An applied create is not (`docs/AGENTS/undo.md` "Creates").
  - The update requires `expectedToken` (it is in `TOKEN_REQUIRED_TOOLS` because its schema requires it).
  - The create mints kind `"forecastScenario"`.
  - Popouts refuse every write (`isReadOnly`).
- Activity log: one entry per applied write, actor `"ai"`: `logActivityAs("ai", "forecastScenario.created" | "forecastScenario.updated", id, name)`.
- No delete tool. Never add any forecast tool to `ALLOWED_REC_TOOLS` (insight replay is a security boundary).
- Engine modules stay i18n-free. Model-facing strings (tool descriptions, refusals, the prompt block) are English only, as every chat tool's are.
- Repo constraints (AGENTS.md):
  - EN/DE i18n parity, real umlauts. Edit `i18n.de.ts` only with a node utf8 script anchored on `\r\n`.
  - `src/app` files are CRLF; never `sed -i`.
  - `task-manager.tsx` gains no lines.
  - Every new control needs an accessible name and keyboard operation; the menu reuses `usePopoverDismiss`.
  - No `set-state-in-effect`.
- Before every commit: unpiped `npx eslint --max-warnings=0 <changed files>` and `npx tsc --noEmit`, both exit 0. Run targeted vitest only, under the lock: `if mkdir /c/Projects/.vitest-lock 2>/dev/null; then npx vitest run <files> > <log> 2>&1; echo "EXIT=$?"; rm -rf /c/Projects/.vitest-lock; else echo LOCKED; fi`. No full vitest, e2e or build locally.
- Commit messages cite §502, with no `Claude-Session:` trailer, no URLs and no `Closes #`. Never `--amend`.

## Review Focus

1. **Loose model input:** `"50"` as a string, a missing `until`, a missing `rampWeeks`, a `who` carrying both shapes, an unknown `kind`. Strings and mixed shapes are refused with the row index named and nothing written. A missing `until` means `""` (to the end) and a missing `rampWeeks` means 4. *Pinned in Task 1.*
2. **Update that sends `changes: []` or drops rows:** this is replace semantics, so omission means deletion. It is allowed, but the result must report `removedRows`, and a refused call writes nothing. *Task 4.*
3. **Staged create, then update of the minted id in the same turn:** the update must link to the create's minted id (`TARGET_MINTED_BY`), not dangle. *Task 4.*
4. **Gate closes mid-conversation:** a `get_forecast` or write call after the switch goes off is refused by `runTool` with the "forecasting is off" message, whatever the request carried. *Task 3.*
5. **Insufficient history:** `get_forecast` returns `status: "insufficient"` with the floor figures and a reason for As-is and every scenario column, and never throws. *Task 2.*

---

### Task 1: Shared row rules, strict tool-input parser, scenario token

**Files:**
- Modify: `src/app/forecast-scenarios.ts`. Move in `REFERENCE_ERRORS` and `keepsStoredReference` from `forecast-scenario-editor.tsx`, unchanged, plus a new `keepsAnyStoredReference`.
- Modify: `src/app/forecast-scenario-editor.tsx` (import them from there).
- Create: `src/app/forecast-scenario-tool-input.ts`
- Modify: `src/app/ai-entity-token.ts` (new `TokenEntity` member `"forecastScenario"`)
- Test: `src/app/forecast-scenario-tool-input.test.ts`, `src/app/ai-entity-token.test.ts`. The existing editor tests must stay green.

**Interfaces:**
- Produces, from `forecast-scenarios.ts`:
  - `REFERENCE_ERRORS: ReadonlySet<ScenarioChangeError>`
  - `keepsStoredReference(stored, c): boolean`, as today
  - `keepsAnyStoredReference(stored: readonly ScenarioChange[], c: ScenarioChange): boolean`. True when some stored row keeps `c`'s reference by `keepsStoredReference`. The AI sends whole lists, so a row is matched by its reference, not by its index.
- Produces, from `forecast-scenario-tool-input.ts`:
  - `parseToolChanges(raw: unknown): { ok: true; changes: ScenarioChange[] } | { ok: false; error: string }`
  - `checkToolDraft(a: { name: string; changes: readonly ScenarioChange[]; list: readonly ForecastScenario[]; exceptId: number | null; stored: readonly ScenarioChange[]; ctx: ValidationContext }): string | null`. Returns null when the draft may be saved, or the model-facing refusal.
- Produces, from `ai-entity-token.ts`: `entityToken("forecastScenario", row)`. Its projection is `JSON.stringify(sanitizeForecastScenarios([row])[0])`, because re-sanitizing fixes the key order.

**Decisions:**
- `parseToolChanges` is a shape check only and never clamps:
  - `raw` must be an array of at most `MAX_SCENARIO_CHANGES` items.
  - Each item needs `kind` ∈ {`availability`, `addPeople`, `scope`}, and each field must be the right primitive type: numbers are finite `number`s, dates are strings.
  - `until` absent means `""`; `rampWeeks` absent means `DEFAULT_RAMP_WEEKS`.
  - `who` is exactly one shape: `{resourceId, hoursPerWeek}` or `{label, count, rate, currency, hoursPerWeek}`. Any key of the other shape refuses it.
  - Unknown extra keys on a row are dropped.
  - Range rules are not checked here; that is `validateScenarioChange`'s job in `checkToolDraft`.
- Error copy:
  - Parse: `changes[<i>]: <what>`, e.g. `changes[2]: percent must be a number`, `changes[0]: who must be either {resourceId, hoursPerWeek} or {label, count, rate, currency, hoursPerWeek}`, `changes must be an array of at most 20 rows`.
- `checkToolDraft` order:
  1. `validateScenarioDraft`.
  2. Each row's `validateScenarioChange`. A reference error (`REFERENCE_ERRORS`) is accepted when `keepsAnyStoredReference(stored, c)` holds.
  3. Draft refusals:
     - cap: `This project already has 4 saved scenarios, the most it can keep. Ask the user to delete one first.`
     - name-empty: `A scenario needs a name.`
     - name-long: `A scenario name can be at most 60 characters.`
     - name-taken: `A scenario named "<name>" already exists. Choose another name.`
     - too-many-changes: `A scenario can hold at most 20 changes.`
  4. Row refusals: `changes[<i>]: <text>`, where text is:
     - `date`: `dates must be YYYY-MM-DD`
     - `until-before-from`: `until must be on or after from`
     - `percent`: `percent must be between 10 and 300`
     - `hours`: `hoursPerWeek must be between 1 and 60`
     - `count`: `count must be a whole number from 1 to 20`
     - `ramp`: `rampWeeks must be a whole number from 0 to 26`
     - `rate`: `rate must be between 0 and 100000`
     - `currency`: `currency must be one of <SUPPORTED_CURRENCIES joined by ", ">`
     - `label`: `label must be 1 to 60 characters`
     - `tasks`: `tasks must be a non-zero whole number between -1000 and 1000`
     - `milestone-unknown`: `milestone <id> does not exist`
     - `milestone-finished`: `milestone <id> is already achieved or cancelled`
     - `resource-unknown`: `resource <id> does not exist`
     - `resource-archived`: `resource <id> is archived`
     - `on-team`: `resource <id> already works on this project; use an availability change instead`
  5. Every failing row is listed, joined by `; `, so the model can fix them all in one go.

- [ ] **Step 1: Write failing tests** in `forecast-scenario-tool-input.test.ts`. Assert exact strings:
  - `parseToolChanges([{kind:"availability", percent:"50", from:"2026-11-02"}])` → `{ok:false, error:"changes[0]: percent must be a number"}`.
  - `parseToolChanges([{kind:"availability", percent:50, from:"2026-11-02"}])` → ok, with the row `until: ""`.
  - An addPeople row without `rampWeeks` → `rampWeeks: 4`.
  - A `who` with `resourceId` and `label` → refused with the shape message.
  - `kind:"hire"` → refused.
  - 21 rows → refused.
  - An extra key `foo` → dropped.
  - `checkToolDraft` at the cap returns the cap text. With two bad rows it returns both, joined by `; `.
  - A finished milestone in a row whose milestone id is also in `stored` → null. The same row with an empty `stored` → `changes[0]: milestone 7 is already achieved or cancelled`.
  - In `ai-entity-token.test.ts`: two rows equal in value but built with different key orders → equal token; a changed `percent` → a different token.
- [ ] **Step 2: Run them under the lock, expect FAIL.**
- [ ] **Step 3: Implement.** Move the two editor helpers (re-export nothing, update imports), write the parser and checker, and add the token kind.
- [ ] **Step 4: Run the new tests plus `forecast-scenario-editor.test.tsx` and `ai-entity-token.test.ts` under the lock, expect PASS.** If `ai-entity-token.test.ts` has exhaustiveness cases over `TokenEntity`, classify the new kind there and do not weaken them.
- [ ] **Step 5: eslint + tsc on changed files, commit** `feat: strict tool input, row refusals and a scenario token for the forecast AI tools (§502)`.

### Task 2: The forecast report builder

**Files:**
- Create: `src/app/forecast-ai-report.ts`
- Test: `src/app/forecast-ai-report.test.ts`

**Interfaces:**
- Consumes: from `forecast-scenario-compare.ts`, `ScenarioRunInput`, `computeScenarioComparison` and `computeScenarioColumn`; `weeklyChange` from `forecast-tile-model.ts`; `entityToken("forecastScenario", …)` from Task 1.
- Produces:
  - `type ForecastReportInput = { run: ScenarioRunInput; history: readonly ForecastHistoryEntry[]; scenarios: readonly ForecastScenario[]; currency: BudgetCurrency }`. `run.window` is `DEFAULT_HISTORY_WINDOW` and `run.unit` is `"tasks"`; the caller builds it that way and the builder asserts nothing.
  - `buildForecastReport(input: ForecastReportInput, whatIf: readonly ScenarioChange[] | null): ForecastReport`
  - `scenarioValidationContext(input: ForecastReportInput): ValidationContext`. It runs As-is once through `computeScenarioComparison(run, [])` and takes `onTeam` from its context.

**Decisions:** the result shape, verbatim (JSON-serialisable, no `Int32Array`):

```ts
type Pct = number | "beyond";                       // a cost in the baseline currency, or "beyond" (a trial past the horizon)
type ColumnReport =
  | { status: "forecast"; p50: string | "beyond"; p80: string | "beyond"; p95: string | "beyond";
      chanceOnTime: number | null;                  // 0–1, by plan end
      milestones: { id: number; name: string; date: string; chance: number }[];
      cost: { p50: Pct; p80: Pct; p95: Pct; chanceOverBudget: number | null } | { unavailable: string } | null }
  | { status: "insufficient"; finished: number; neededFinished: number; days: number; neededDays: number; reason: string };
type RowReport =
  | { index: number; kind: "availability"; ended: boolean }
  | { index: number; kind: "scope"; milestoneGone: boolean }
  | { index: number; kind: "addPeople"; sizing: { name: string; weeklyHours: number; ratePerHour: number; rateNote: string; shareAtFullSpeed: number } }
  | { index: number; kind: "addPeople"; inert: "person-gone" | "on-team" | "ended" | "needs-booked-hours" };
type ForecastReport = {
  simulated: true;
  settings: { historyWindowWorkingDays: number; unit: "tasks"; trials: number; currency: BudgetCurrency; planEnd: string; today: string };
  asIs: ColumnReport;
  weeklyChange: WeeklyChange;                       // from weeklyChange(history, today, asIs P80 date or null, holidaySet)
  scenarios: { id: number; name: string; expectedToken: string; changes: readonly ScenarioChange[]; result: ColumnReport; rows: RowReport[] }[];
  whatIf?: { result: ColumnReport; rows: RowReport[] };
};
```

- The P-values come from the run's `when` rows: `date ?? "beyond"`. Milestone names are joined from `run.milestones` by id; a chance whose milestone has no row is skipped.
- `reason` for insufficient: `Not enough history: <finished> of <neededFinished> finished tasks and <days> of <neededDays> working days in the window.` Name only the part that is short, using the same rule as `forecast-insufficient.tsx`.
- Cost `unavailable`: one of `schedule-floor`, `spend-history`, `no-spend`, passed through. It is null when `cost` is null (Budget module off, or the switch off).
- `rows[i]` maps `schedule.rows[i]` (`ScenarioRowStatus`) one-to-one.

- [ ] **Step 1: Write failing tests**, with fixtures built the way `forecast-scenario-compare.test.ts` builds them:
  - **CRN:** a `whatIf` equal to a saved scenario's `changes` gives `whatIf.result` deep-equal to that scenario's `result`.
  - A scenario with no changes gives a result deep-equal to `asIs`.
  - The report says `settings.historyWindowWorkingDays === 60` and `unit === "tasks"`.
  - A fixture under the history floor → `asIs.status === "insufficient"`, every scenario is insufficient too, and `reason` names the short part.
  - An addPeople placeholder row → `rows[0].sizing.name` is the label. A resource on the team → `inert: "on-team"`.
  - `expectedToken === entityToken("forecastScenario", scenario)`.
  - `JSON.parse(JSON.stringify(report))` deep-equals `report` (no typed arrays leak).
- [ ] **Step 2: Run under the lock, expect FAIL.**
- [ ] **Step 3: Implement** `buildForecastReport` and `scenarioValidationContext`.
- [ ] **Step 4: Run under the lock, expect PASS.**
- [ ] **Step 5: eslint + tsc, commit** `feat: one JSON forecast report over the scenario comparison for get_forecast (§502)`.

### Task 3: Tool schemas, runTool routing and the gate

**Files:**
- Create: `src/app/chat-tool-defs-forecast.ts` (exports `FORECAST_TOOL_DEFS`), spread into `TOOL_DEFS` in `chat-tool-defs.ts` the way `DOCUMENT_TOOL_DEFS` is.
- Create: `src/app/chat-tools-forecast.ts` (exports `runForecastTool(name, input, d): unknown | typeof NOT_FORECAST_TOOL`), called from `runTool` in `chat-tools.ts` before its `switch`.
- Modify: `src/app/chat-tools.ts`. Add `ToolDispatcher` members (below) and the optional snapshot field `forecastSimulation?: boolean`.
- Modify: `src/app/chat-api.ts`. `ToolFlags` becomes `Pick<AiConfig, "historySearch" | "chatSearch"> & { forecast?: boolean }`, with bit `4` in `DISABLED_BY_BIT` removing the three forecast tools.
- Modify: `src/app/chat-panel.tsx`. Build one `toolFlags` per send from the snapshot and pass it at all four sites that pass `ai` as flags today (`buildStableSystemBlocks`, `buildTurnContext`, `callClaude`, the fingerprint's `toolNamesFor`).
- Test: `src/app/chat-tools-forecast.test.ts`, `src/app/chat-api.test.ts` (the tool-variant cases).

**Interfaces:**
- `ToolDispatcher` gains (implemented in Task 4):
  - `isForecastEnabled(): boolean`
  - `getForecast(whatIf: readonly ScenarioChange[] | null): ForecastReport`
  - `getForecastScenarioRow(id: number): ForecastScenario | null`
  - `createForecastScenario(name: string, changes: readonly ScenarioChange[]): ForecastScenarioResult`
  - `updateForecastScenario(id: number, patch: { name?: string; changes?: readonly ScenarioChange[] }): ForecastScenarioResult & { removedRows?: number }`

  Here `ForecastScenarioResult = { id: number; name: string; expectedToken: string; changes: readonly ScenarioChange[] }`. All three throw `Error(<refusal>)` on refusal.

**Decisions:**
- **The gate is a variant bit with the inverse default of the other two.** The forecast tools are offered only when `flags.forecast === true`, so every caller that does not say so (inline edit's `NO_RECALL_TOOLS`, tests) gets none. One array identity per combination still holds.
- `runForecastTool` checks `d.isForecastEnabled()` first in all three cases and throws: `Monte Carlo forecasting is off for this project (the Forecast view is hidden or the project's "Use Monte Carlo forecasting" switch is off). Nothing was read or written.` That is the enforcement half, mirroring `isHistorySearchEnabled`.
- Input handling:
  - `get_forecast`: `whatIf` is optional and parsed by `parseToolChanges`. On failure throw `whatIf <error>`.
  - `create_forecast_scenario`: `name` must be a string; `changes` goes through `parseToolChanges`.
  - `update_forecast_scenario`:
    1. `requireId`, then resolve the row with `getForecastScenarioRow`. If it is missing, throw `forecast scenario <id> not found`. Not-found is checked before the token, per AGENTS.md.
    2. `requireToken` against `entityToken("forecastScenario", row)`.
    3. At least one of `name` / `changes` must be present, or throw `send name, changes, or both`.
    4. `changes` goes through `parseToolChanges`.
- Schema text, verbatim descriptions:
  - **get_forecast:** `Read this project's Monte Carlo schedule forecast: P50/P80/P95 finish dates, chance of finishing by the plan end, each milestone's chance, the week-on-week change, cost at finish and chance over budget, and every saved scenario's results. Every figure is simulated with the app defaults (60-working-day history, tasks unit). Optional whatIf: a list of changes, in the same shape as a scenario's, computed once and never saved. Each saved scenario carries an expectedToken for update_forecast_scenario.`
  - **create_forecast_scenario:** `Save a new forecast scenario (at most 4 per project): a name and a list of dated changes. Check it with get_forecast's whatIf first.`
  - **update_forecast_scenario:** `Edit a saved forecast scenario. changes REPLACES the whole list (omitted rows are removed); send name alone to rename. Requires the expectedToken from get_forecast.`
  - The `changes` item schema documents the three kinds, with `until: ""` meaning "to the end", `rampWeeks` defaulting to 4, and the two `who` shapes.
  - The update schema has `required: ["id", "expectedToken"]` and declares the token property through `expectedTokenField` from `chat-tools-updates.ts`, as the other update tools do.

- [ ] **Step 1: Write failing tests:**
  - `toolNamesFor({})` and `toolNamesFor({historySearch: true, chatSearch: true})` contain none of the three names; `toolNamesFor({forecast: true})` contains all three.
  - `toolsFor({forecast: true}) === toolsFor({forecast: true})` (same identity).
  - `runForecastTool("get_forecast", {}, dispatcher)` with `isForecastEnabled: () => false` throws the off message and never calls `getForecast`.
  - `update_forecast_scenario` without `expectedToken` throws `ConcurrencyTokenError`. A wrong token throws it too. An unknown id throws `not found` before any token check.
  - `{whatIf: [{kind:"scope", tasks:"3", on:"2026-11-02"}]}` throws `whatIf changes[0]: tasks must be a number`.
  - `TOKEN_REQUIRED_TOOLS.has("update_forecast_scenario")`.
- [ ] **Step 2: Run under the lock, expect FAIL.**
- [ ] **Step 3: Implement.** Add stub members to every `ToolDispatcher` test fixture that tsc names; do not loosen the type.
- [ ] **Step 4: Run the new tests plus `chat-tools.test.ts`, `chat-api.test.ts` and `chat-panel*.test.tsx` under the lock, expect PASS.**
- [ ] **Step 5: eslint + tsc, commit** `feat: get_forecast and the forecast scenario write tools, gated on the simulation switch (§502)`.

### Task 4: Dispatcher implementation and staging

**Files:**
- Create: `src/app/use-forecast-tools.ts`. Exports `useForecastTools(deps): ForecastToolDispatcher`, a `Pick` of the five `ToolDispatcher` members.
- Modify: `src/app/use-chat-dispatcher.ts`. Spread it in beside `...registerTools`, and add `forecastSimulation` to `getSnapshot()` from the same predicate.
- Modify: `src/app/use-chat-dispatcher-wiring.ts`. Build the getter `getForecastInput(): ForecastReportInput` from `useWorkspace()` slices (`tasks`, `milestones`, `plan`, `resources`, `roles`, `shifts`, `absences`, `budgets`, `fxRates`, `forecastHistory`, `forecastScenarios`, `settingsOverrides`), `settings`, `clock` and `holidaySet`. It takes a new wiring-only dep `holidaysReady: boolean`, added to task-manager's existing `useChatDispatcherWiring` argument line, so that file gains no lines.
- Modify: `src/app/chat-proposal.ts`:
  - `ENTITY_WRITE_TOOLS` += both write tools.
  - `TARGET_MINTED_BY` += `update_forecast_scenario: "create_forecast_scenario"`.
  - `CREATE_MINT_KIND` += `create_forecast_scenario: "forecastScenario"`.
- Modify: `src/app/chat-proposal-apply.ts`. `TOKEN_ROW_SOURCE` += `update_forecast_scenario: { kind: "forecastScenario", getRow: (d, id) => d.getForecastScenarioRow(id) }`.
- Modify: `src/app/chat-proposal-describe.ts`. Card lines for both tools, following the pattern of their nearest neighbours: name plus row count, for example `Save scenario "Contractor in January" (3 changes)` and `Edit scenario "…"`.
- Test: `src/app/use-forecast-tools.test.tsx`, plus the drift suites named in Step 4.

**Decisions:**
- **Budget facts:** the getter builds `budgetFacts` with `computeProjectForecastFacts`, using the arguments `workspace-section.tsx` passes, only when the Budget module is enabled; otherwise null. `costOn = isSimulationActive(...) && budget enabled`. The directory is built exactly as `workspace-section.tsx` builds `forecastDirectory`. `currency = plan.currency`.
- **Holidays:** while `holidaysReady === false`, all three tools throw `The holiday calendar is still loading; try again in a moment.` A forecast on a partial calendar would quote wrong working days.
- **Create:**
  1. `if (isReadOnly) throw readOnlyError()`.
  2. Run `checkToolDraft` with `exceptId: null`, `stored: []` and `ctx = scenarioValidationContext(input)`.
  3. `id = mintId("forecastScenario", scenariosRef.current)`.
  4. Build the row as `{ id, name: name.trim(), changes: trimScenarioChanges(changes) }`.
  5. Update the ref and call `setForecastScenarios` with `addScenario`.
  6. Log. No undo capture.
- **Update:**
  1. Refuse a read-only popout.
  2. Run `checkToolDraft` with `exceptId: id` and `stored: row.changes`.
  3. Keep the stored references for anything unchanged (same rule as `use-forecast-scenarios.ts`, `sameRows`). If neither the name nor the rows changed, return without a write, log or capture.
  4. Capture with `captureComposite` / `capturePart({ setter: setForecastScenarios, edited: [stored], fromArray: list, isPrimary: true })`, kind `"forecastScenario.updated"`, `entityKey` per the existing undo label registration.
  5. Write the ref, then call the setter.
  6. Log.
  7. `removedRows` = the number of stored rows with no `JSON.stringify`-equal row in the new list. It is present only when `changes` was sent.
- **Refs:** `scenariosRef` is synced from the slice in an effect, like `changesRef` in `use-register-tools.ts`. Writers assign it synchronously, so a create followed by an update in one turn sees the create.
- **Drift-test classification:** a red drift test is the signal to classify, never to widen a guard. Classify each tool the test asks about:
  - Inline Ask-Claude edit does not cover scenarios. Exclude them with a reason line where `tool-input-coverage` / `plan.model-writable-surface` ask.
  - They are not insight-replay tools. Leave `ALLOWED_REC_TOOLS` and `UPDATE_TARGET` unchanged, and give the reason where a test asks.

- [ ] **Step 1: Write failing tests** in `use-forecast-tools.test.tsx`, rendering the hook inside the workspace provider the way `use-register-tools` tests do:
  - **Round trip:** take `expectedToken` OUT of `getForecast(null).scenarios[0]`, pass it to `runTool("update_forecast_scenario", …)` → it applies. Assert `toBe` on the token value too.
  - **Create, then update the minted id in one turn:** the update sees the create.
  - **Update `{changes: []}` on a 2-row scenario:** `removedRows === 2`, the row is stored empty, and one undo restores both rows.
  - **Refused update** (bad row): stored row unchanged, no log entry, no capture.
  - **Create:** not captured; one `forecastScenario.created` log with actor `"ai"`.
  - **Create at the cap**, including a 5-scenario list restored by undo: refused with the cap text.
  - **Popout** (`isReadOnly`): both writes throw the read-only error.
  - **Holidays not ready:** all three throw the loading text.
  - **Snapshot:** `getSnapshot().forecastSimulation` follows `isSimulationActive`.
  - **Staging:** `shouldStage([create, update])` → true; `shouldStage([create])` → false. `buildPlanRows` links the update to the create's `mintedId`.
- [ ] **Step 2: Run under the lock, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run under the lock, expect PASS:** the new test plus the drift suites `chat-proposal.test.ts`, `chat-proposal-apply.test.tsx`, `chat-proposal-stage*.test.ts`, `ai-entity-token.test.ts`, `chat-tools.test.ts`, `use-chat-dispatcher.test.tsx`, `inline-ai-edit/tool-input-coverage.test.ts`, `inline-ai-edit/plan.model-writable-surface.test.ts` and `insights/recommend-tokens.test.ts`. Assert `Test Files N passed` with N = the number of paths given.
- [ ] **Step 5: eslint + tsc, commit** `feat: the forecast tools in the chat dispatcher, staged and undo-captured like every entity write (§502)`.

### Task 5: Prompt block and view scope

**Files:**
- Create: `src/app/forecast-ai-prompt.ts` (exports `buildForecastBlock(offeredTools: ReadonlySet<string>): string`)
- Modify: `src/app/chat-api.ts`. Add it to the volatile half's returned list, after `viewScopeBlock`.
- Modify: `src/app/view-ai-scope.ts`, entry `forecast`.
- Test: `src/app/forecast-ai-prompt.test.ts`, `src/app/view-ai-scope.test.ts`.

**Decisions:** exact text.
- When `offeredTools.has("get_forecast")`:

  `FORECAST — get_forecast returns this project's Monte Carlo forecast. Every figure it returns is simulated: say so. Call P80 "safe to commit", never a promise or a guarantee. When a column reports status "insufficient", quote its reason instead of estimating dates yourself. Its figures use the app defaults (60-working-day history, tasks unit), not the Forecast view's toolbar. You may create or edit a saved scenario (create_forecast_scenario, update_forecast_scenario) but never delete one.`
- Otherwise:

  `FORECAST — Monte Carlo forecasting is off for this project (the Forecast view is hidden or the project's switch is off), so no forecast tool is available. If asked for forecast dates or chances, say forecasting is off and never estimate them.`
- View scope `forecast`:
  - `toolHints: ["get_forecast", "list_tasks", "list_milestones"]`
  - `readingRequiresTool: "get_forecast"`
  - `reading`: `get_forecast returns the simulated finish dates, chance on time, milestone chances, saved scenarios and cost this view shows, with the app defaults; the view's own toolbar (history window, unit, What-if) can differ.`
  - The old "No chat tool returns…" line goes. With the tool not offered, the forecast block above carries the "off" message.

- [ ] **Step 1: Failing tests:**
  - Both texts are exact.
  - `buildForecastBlock(new Set())` names no tool.
  - The volatile prompt built with `{forecast: true}` contains `safe to commit`; built with `{}`, it contains `forecasting is off`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run under the lock with `chat-api.test.ts` and `view-ai-scope.test.ts`, expect PASS.**
- [ ] **Step 5: eslint + tsc, commit** `feat: tell the assistant how to quote the simulated forecast, and when it is off (§502)`.

### Task 6: Ask-Claude chips in the Forecast view

**Files:**
- Create: `src/app/forecast-ask-claude.tsx`, with the component `ForecastAskClaude`.
- Modify: `src/app/forecast-panel.tsx`. Render it in the toolbar, before the trailing group (toolbar order convention).
- Modify: `src/app/workspace-section.tsx`. Pass `aiEnabled={isAiEnabled(settings.ai)}` to `ForecastPanel`.
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`.
- Test: `src/app/forecast-ask-claude.test.tsx`, `src/app/forecast-panel.test.tsx`.

**Interfaces:** `ForecastAskClaude({ lang, inScenarios, scenarioCount, worstMilestone }: { lang: Lang; inScenarios: boolean; scenarioCount: number; worstMilestone: string | null })`. It calls `useWorkspaceTab().requestChat(body, true)` on pick.

**Decisions:**
- **Mounting:** the panel mounts the component only when `aiEnabled && showSimulation && !isPopout`.
- **Menu shape:** the `AskClaudeMenu` pattern — a `Button` with the `SparklesIcon` and accessible name "Ask Claude", opening a list of `menuItemClass` buttons dismissed through `usePopoverDismiss`. Read `docs/AGENTS/ui-shell.md` "dismissal" first.
- **Chips, in order:**
  1. Explain: always.
  2. Milestone: only when `worstMilestone !== null`.
  3. Compare: only when `inScenarios && scenarioCount >= 1`.
  4. Suggest: only when `inScenarios`.
- **Worst milestone:** the lowest `chance` among the milestones of the run on screen. In Quick / What-if that is the panel's own run; in Scenarios it is the comparison's As-is. Ties go to the earlier date. With no milestone chances it is null.
- **EN copy (keys → text):**
  - `forecastAskClaude` → `Ask Claude`
  - `forecastAskExplainLabel` → `Explain this forecast`
  - `forecastAskExplainBody` → `Explain this project's Monte Carlo forecast: what the P50, P80 and P95 finish dates mean, how likely we are to make the plan end, and which milestones are at risk. Use get_forecast and say the figures are simulated.`
  - `forecastAskMilestoneLabel` → `What would get {0} on time?`
  - `forecastAskMilestoneBody` → `What would it take to get the milestone "{0}" on time? Use get_forecast, try a few what-if changes, and tell me which ones raise its chance the most. Don't save anything.`
  - `forecastAskCompareLabel` → `Compare my scenarios`
  - `forecastAskCompareBody` → `Compare my saved forecast scenarios with As is: finish dates, chance on time, milestone chances and cost. Use get_forecast and tell me which scenario is the strongest and why.`
  - `forecastAskSuggestLabel` → `Suggest a scenario that makes plan end`
  - `forecastAskSuggestBody` → `Suggest a forecast scenario that gets this project to its plan end with a good chance (P80 on or before the plan end if possible). Check it with get_forecast's whatIf first, then offer to save it as a scenario.`
- **DE copy:** the implementer's, with real umlauts.

- [ ] **Step 1: Failing tests** (`userEvent`, not `.focus()`):
  - Quick mode with a worst milestone "Go-live" → two items, "Explain this forecast" and "What would get Go-live on time?".
  - Scenarios with 0 scenarios → Explain + Suggest. With 1 → all four, in order.
  - Picking an item calls `requestChat` with the interpolated body and `true`.
  - Escape closes the menu and returns focus to the trigger.
  - The panel renders no trigger when `aiEnabled` is false, the simulation is off, or `isPopout`.
  - DE: after `loadI18n("de")` the label differs from EN.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Edit `i18n.de.ts` with a node utf8 script, anchored on `\r\n`, and re-verify the umlauts.
- [ ] **Step 4: Run the new test, `forecast-panel.test.tsx` and `i18n*.test.ts` under the lock, expect PASS.**
- [ ] **Step 5: eslint + tsc, commit** `feat: Ask-Claude chips in the Forecast view (§502)`.

### Task 7: Docs and register

**Files:**
- Modify: `docs/AGENTS/ai-assistant.md`. Add one bullet, "Forecast tools (§502)", covering:
  - the gate's two halves (`ToolFlags.forecast` bit, inverse default; `isForecastEnabled` in `runForecastTool`);
  - the defaults-only rule;
  - the meta-blob token (`entityToken("forecastScenario")` = re-sanitized JSON);
  - replace semantics with `removedRows`;
  - reference rows matched by reference, not index;
  - no delete tool;
  - not in `ALLOWED_REC_TOOLS`.
- Modify: `docs/AGENTS/forecast.md`. Add a "The AI tool" section with `get_forecast`'s report shape in one paragraph, CRN with saved scenarios, the holiday-loading refusal and the chips.
- Modify: `docs/open-followups.md` §502. Update the status line: AI tool built, held back; part 4 and un-hide remain. Leave the heading and the index row unless `npm run followups:index:check` demands otherwise.
- [ ] **Step 1: Write the docs.** Cite symbols, not lines.
- [ ] **Step 2: Run unpiped:** `npm run docs:symbols:check`, `npm run docs:claims:check` and `npm run followups:index:check`, each with `echo "EXIT=$?"`. Expect 0.
- [ ] **Step 3: Commit** `docs: the forecast AI tools in ai-assistant.md and forecast.md; §502 status (§502)`.
