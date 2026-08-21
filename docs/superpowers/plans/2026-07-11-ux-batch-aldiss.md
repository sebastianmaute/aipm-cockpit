# UX Batch "Aldiss" (0.177.0) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. One task per commit. `npx tsc --noEmit` + `npm run test:run` after each. Branch `feat/ux-batch-aldiss` (already created off main). NOT a release until user says "release".

**Goal:** 14 user-requested improvements across AI assistant, planning/rate-card, gantt, history, RACI, dashboard, tasks, and tooling.

**Architecture:** Extend existing subsystems (the AI-usage subsystem, roles rate card, planning table, version-history diff/restore) rather than build new. Pure engines stay i18n-free. Per-device settings ride the `writeSettings` spread (no allowlist edit). New persisted Role columns follow the 6-write-path + golden-regen rule.

**Tech Stack:** Next.js (forked) / React / TypeScript / vitest / Turso.

Decisions from brainstorming (locked):
- Token multiplier: **configurable, default 5**.
- Limit behavior: **notice, never block** (advisory; distinct "usage limit reached" message from both 429 and self-cap).
- Gantt milestone date: **hover title only** (match task bars).
- Rate card: **day rates = source of truth**, hourly derived/materialized.

---

## Task grouping (execution order)

Wave A (independent, trivial — can parallelize): T3 gantt, T12 status hover, T11 npm stop.
Wave B (AI cluster, serial — shares settings-types/ai-section/i18n): T9 turn cap, T5 token multiplier, T6 self-limit clarity, T1 usage-limit notice.
Wave C (dashboard): T2 tile tooltips.
Wave D (RACI): T10 filter.
Wave E (history, serial): T7 compare feedback+scroll, T8 restore controls.
Wave F (resources/rate-card, serial — shares resources-panel/types/codecs/i18n): T13 rate card /d, T4 hide external, T14 capacity column.
Wave G: version bump + CHANGELOG + memory + gates.

i18n rule: EN `i18n.ts` + DE `i18n.de.ts` parity is tsc-enforced. Edit `i18n.de.ts` via node utf8 write, CRLF `\r\n` anchors, REAL umlauts (i18n-encoding test bans ASCII subs). Serialize i18n edits — never two implementers editing i18n concurrently.

---

## T3 — Gantt: milestone diamond hover date

**Files:** `gantt-rows.tsx`, `gantt.test.tsx` (or existing gantt test).

The milestone diamond `<rect>` (`gantt-rows.tsx:522-529`) lacks a date in its `title`; task bars show `${name} · ${fmtFull(start)} → ${fmtFull(end)}` (`:315-319`). `fmtFull` + `md` (parsed milestone date, `:412`) are already in scope.

- [ ] Add/confirm a `title={`${m.name} · ${fmtFull(md, lang)}`}` on the milestone diamond element (the clickable `<rect>` / its wrapper at `:522-529`). If a title already exists there, ensure it includes `fmtFull(md, lang)`.
- [ ] Test: render a milestone in the gantt; assert the diamond element's `title` contains the formatted date.
- [ ] Commit `feat(gantt): show milestone date in diamond hover title`.

## T12 — Open Points: status dropdown hover

**Files:** `task-status-select.tsx`, `task-status-select.test.tsx` (create if absent).

`TaskStatusSelect` `<select>` (`:27`) has `${FOCUS_RING} ${TRANSITION}` but no `hover:`.

- [ ] Append palette-safe `hover:border-AIPM-dark-blue` to the className at `:27` (TRANSITION already smooths it). Do NOT add shadow/off-palette.
- [ ] Test: assert the select's className contains `hover:border-AIPM-dark-blue`.
- [ ] Commit `feat(tasks): hover affordance on status dropdown`.

## T11 — npm run stop (port-scoped)

**Files:** `scripts/stop-dev.mjs` (create), `package.json` (`scripts` + `scriptsDescriptions`).

Kill ONLY the process on the app dev port (default 3000) — NOT every node process. Cross-platform (win32 primary). `docs:scripts:check` (prebuild) enforces `scripts`↔`scriptsDescriptions` parity.

- [ ] Create `scripts/stop-dev.mjs`: read port from `PORT` env or default 3000; on win32 use `netstat -ano | findstr :PORT` → PID → `taskkill /PID <pid> /F`; on posix use `lsof -ti tcp:PORT` → `kill`. Guard: if no PID found, print "no dev server on port N" and exit 0 (never error). Never kill by process-name glob.
- [ ] `package.json`: add `"stop": "node scripts/stop-dev.mjs"` to `scripts` and a matching entry to `scriptsDescriptions` (e.g. "stop the dev server on the app port (default 3000)").
- [ ] Verify `npm run docs:scripts:check` passes.
- [ ] Commit `chore: npm run stop kills the dev server on the app port`.

## T9 — Configurable chat turn cap

**Files:** `settings-types.ts`, `settings-sections/ai-section.tsx`, `chat-panel.tsx`, `settings-types.test.ts`, i18n.

- [ ] `AiConfig`: add `maxChatTurns?: number`. `defaultAiConfig`: `maxChatTurns: 12`. `sanitizeAiConfig`: coerce integer, clamp `[1, 50]`, else default 12.
- [ ] `chat-panel.tsx:326`: replace `MAX_CHAT_TURNS` with `settings.ai.maxChatTurns ?? 12` (keep the const as the default fallback). `settings.ai` already in scope.
- [ ] `ai-section.tsx`: add a `CapInput`-style numeric field (label `aiMaxTurns` + hint `aiMaxTurnsHint`), persisted via the `onChange({...settings, ai:{...settings.ai, maxChatTurns:v}})` spread. Place near the caps (`:525-540`).
- [ ] i18n EN+DE: `aiMaxTurns`, `aiMaxTurnsHint`.
- [ ] Test: sanitize clamps out-of-range/NaN to 12; chat loop honors the setting (or unit-test the resolved value).
- [ ] Commit `feat(ai): configurable chat turn cap`.

## T5 — Configurable token multiplier (default 5)

**Files:** `settings-types.ts`, `ai-usage-context.tsx`, `ai-section.tsx`, `ai-usage-context.test.tsx`, i18n.

Choke point: `ai-usage-context.tsx:91-92` `const tokens = u.input + u.output`.

- [ ] `AiConfig`: add `tokenMultiplier?: number`. `defaultAiConfig`: `tokenMultiplier: 5`. `sanitizeAiConfig`: coerce finite `> 0`, else default 5 (mirror `coerceCap` but allow decimals).
- [ ] `ai-usage-context.tsx` `record()`: multiply counted tokens by the resolved multiplier: `const tokens = (u.input + u.output) * multiplier`. Source the multiplier from `settings.ai.tokenMultiplier ?? 5` (thread settings into the provider the same way caps are read at `:87-88`).
- [ ] `ai-section.tsx`: add a `CapInput`-style field (label `aiTokenMultiplier` + hint `aiTokenMultiplierHint`), near the caps.
- [ ] i18n EN+DE: `aiTokenMultiplier`, `aiTokenMultiplierHint`.
- [ ] Test: `record({input:100, output:100})` with multiplier 5 accumulates 1000; with 1 accumulates 200.
- [ ] Commit `feat(ai): configurable token-count multiplier (default 5)`.

## T6 — Self-limit clarity (advisory, never block)

**Files:** `ai-section.tsx`, `settings-sections/ai-usage-panel.tsx`, i18n. (Mostly copy/tooltip — caps already user-editable.)

- [ ] Add InfoTooltip hints to the session/weekly cap fields explaining they are YOUR self-imposed limits, advisory only (a notice fires at the cap; calls are not blocked), and when they reset. Reuse/add `aiSessionCapHint`, `aiWeeklyCapHint`.
- [ ] i18n EN+DE for the new hint keys.
- [ ] Test: fields render with the hint (or assert i18n keys resolve).
- [ ] Commit `feat(ai): clarify self-imposed usage limits are advisory`.

## T1 — Usage-limit notice (429 + self-cap), never block

**Files:** `ai-errors.ts` (new pure classifier), `chat-api.ts`, `chat-panel.tsx`, `use-inline-entity-edit.ts`, `use-action-analysis.ts`, `use-scheduled-job-runner.ts`, `use-weight-suggestions.ts`, `use-project-proposal.ts` / `step0-import-panel.tsx`, `ai-usage-context.tsx`, `lib/app-feature-guide.md`, i18n, tests.

**Security:** never log/echo the API key or response BODY. The classifier may read ONLY the Anthropic `error.type` token (`rate_limit_error`/`overloaded_error`) — not the message. Errors keep carrying status digits only elsewhere.

- [ ] New pure `ai-errors.ts`: `classifyAiError(status: number, errorType?: string): "limit" | "auth" | "network" | "parse" | "generic"`. `status===429` OR `errorType` in {`rate_limit_error`,`overloaded_error`} → `"limit"`. `401/403` → `"auth"`. Pure, no i18n, no logging.
- [ ] `chat-api.ts` `callClaude`: when `!res.ok`, parse the body's `error.type` in a try/catch (safe token only), attach it so callers can classify. Keep the thrown Error message as status-only for the non-limit path (don't leak body). Simplest: throw a typed error `AiHttpError { status, errorType? }`.
- [ ] Each call site: on catch, `classifyAiError(...)==="limit"` → show the distinct translated `aiUsageLimitReached` message instead of the generic one. **Chat: APPEND a notice DisplayItem to the transcript (do not clear history / do not replace prior messages).** Other dialogs: swap their generic error branch for the limit message when classified `"limit"`.
- [ ] Self-cap notice: in `ai-usage-context.tsx`, when usage crosses 100% of a cap (extend the existing 80% `crossed80` logic with a `crossed100`), fire a distinct `aiSelfLimitReached` toast. Advisory — do NOT block any call.
- [ ] `lib/app-feature-guide.md`: add a `- AI:` line under `## Settings` and `## AI assistant` describing usage limits (self-caps advisory, token multiplier, Claude's own weekly/rate limit shows a notice). Regenerate the built-in guide (`npx vite-node scripts/gen-operating-guide.mjs` or per prebuild) and let `operating-guide-builtin.test.ts` pass.
- [ ] i18n EN+DE: `aiUsageLimitReached`, `aiSelfLimitReached`.
- [ ] Tests: `classifyAiError` truth table; a 429 in chat appends a notice item and preserves prior messages; a self-cap 100% crossing fires the toast; no call is blocked.
- [ ] Commit `feat(ai): distinct usage-limit notice for 429 and self-caps (advisory)`.

## T2 — Dashboard tile tooltips

**Files:** `dashboard-sections/dashboard-kpi-strip.tsx`, `dashboard-panel.tsx`, i18n, tests. (Embed InfoTooltip in `Tile` label nodes — established pattern; no `Tile` prop change required.)

Tiles: KPI strip complete%/overdue/openRAID (`dashboard-kpi-strip.tsx:25-46`); panel complete%, R/A/G, budget, hours, SPI, CPI (`dashboard-panel.tsx:289-378`). SPI/CPI reuse existing `evmSpiHint`/`evmCpiHint`.

- [ ] Wrap each tile `label` as `<>{t(lang,"…")}<span className="print:hidden ml-1"><InfoTooltip text={t(lang,"…Hint")} /></span></>` (mirror `budget-report-panel.tsx:105-107`).
- [ ] i18n EN+DE new hint keys: `dashboardKpiCompleteHint`, `dashboardKpiOverdueHint`, `dashboardKpiOpenRaidHint`, `dashboardRagHint`, `dashboardBudgetHint`, `dashboardHoursHint` (+ reuse evmSpiHint/evmCpiHint). Keep interpretation-oriented copy ("what it shows + how to read it").
- [ ] a11y: InfoTooltip renders a labeled `role=button` — Dashboard IS axe-scanned, so verify the tooltip triggers have accessible names (InfoTooltip defaults label to text). Scope any `getByText` collisions to `heading` role (dashboard-panel.test landmine).
- [ ] Test: a KPI tile renders an InfoTooltip with its hint text.
- [ ] Commit `feat(dashboard): explanatory tooltips on cockpit tiles`.

## T10 — RACI additive user filter

**Files:** `raci-panel.tsx`, i18n, `raci-panel.test.tsx`.

Replace the subtractive `excluded` checkbox model (`:52,97-112`) with an additive inclusion set.

- [ ] State: `const [filtered, setFiltered] = useState<Set<number>>(new Set())` (empty = show all). Derive `visibleStakeholders = filtered.size===0 ? stakeholders : stakeholders.filter(s=>filtered.has(s.id))`. `visibleIds` unchanged downstream (header `:124-128`, cells `:152` already key off these).
- [ ] Toolbar UI (`:97-117`): a type-to-filter text `<input aria-label={t(lang,"raciFilterAdd")}>` with a datalist/typeahead of stakeholder names → add matched id to `filtered`; a chip row of added users each with a remove `×` (row-unique aria-label `${raciFilterRemove} – ${name}`); a bulk "Clear filter" button (`setFiltered(new Set())`). Use `INTERACTIVE`/`FOCUS_RING` atoms + palette tokens.
- [ ] i18n EN+DE: `raciFilterAdd`, `raciFilterRemove`, `raciFilterClear` (keep existing `raciFilterPersons` or repurpose). Positional placeholders 0-based if interpolated.
- [ ] a11y: chips + input labeled; if RACI is not in A11Y_VIEWS, eye-verify. Row-unique remove labels.
- [ ] Test: typing+adding a user narrows visibleStakeholders; remove chip restores; clear empties the set (show all).
- [ ] Commit `feat(raci): additive type-to-filter for people columns`.

## T7 — History compare: identical feedback + scroll

**Files:** `history-panel.tsx`, `version-diff-view.tsx` (copy), i18n, `history-panel.test.tsx`.

Empty per-row compare is usually a legit identical snapshot (`diffWorkspaces` → `[]`), but the UI gives no clear signal (unlike restore's `historyRestoreNothing` toast). Also add scroll-to-output.

- [ ] Distinguish identical-vs-failure: `loadDiff` already logs `version.compareEmptyPayload`/`compareParseFailed`/`compareLoadFailed` on failures. For a SUCCESSFUL load that yields `[]`, surface a clear "This version is identical to the current workspace — nothing to compare or restore" message (new `historyCompareIdentical`) in the compare output, distinct from a generic no-changes state. (Keep the diagnostics logging for the failure branches.)
- [ ] Scroll: add `const compareRef = useRef<HTMLDivElement>(null)` on the `mt-4` compare-output container (`:287`); after `setDiff(...)` resolves in `runDiff` (`:84`) and `compareSelected`, `requestAnimationFrame(() => compareRef.current?.scrollIntoView({ block: "start" }))`. (scrollIntoView is stubbed in vitest.setup.)
- [ ] i18n EN+DE: `historyCompareIdentical`.
- [ ] Tests: an identical snapshot compare shows `historyCompareIdentical` (not the ambiguous no-changes text); the compare handler calls scrollIntoView.
- [ ] Commit `fix(history): clear feedback + scroll on compare-with-current`.

## T8 — History restore controls (Select all / Deselect all / Restore this state)

**Files:** `history-panel.tsx`, i18n, `history-panel.test.tsx`.

In the `compareFrom !== null` compare-output header (`:290-303`), beside "Restore selected":

- [ ] Deselect all: button → `setSelection({})` (existing reset). Select all: `setSelection(Object.fromEntries((diff ?? []).map(c => [changeKey(c.collection, c.recordId), "all"])))` (mirrors `restoreWholeVersion:123-124`). Both inside the `compareFrom !== null` block only (checkboxes exist only there).
- [ ] "Restore this state" in the compare header: a compare-scoped variant that sets every current-`diff` key to `"all"` then calls `restore(compareFrom.id, sel, compareFrom.label)` (reuse the same reset-on-success as "Restore selected"). Reuse existing i18n `historyRestoreState`/`historyRestoreStateHint`.
- [ ] i18n EN+DE: `historySelectAll`, `historyDeselectAll` (if not present).
- [ ] a11y: buttons labeled; "Restore selected" already `disabled` when selection empty — Select-all enables it.
- [ ] Test: Select-all ticks every diff record and enables Restore selected; Deselect-all clears; Restore-this-state in the header restores the whole snapshot.
- [ ] Commit `feat(history): select-all/deselect-all + restore-this-state in compare header`.

## T13 — Rate card: day rates as source of truth

**Files:** `types.ts`, `sanitize-entities.ts`, `csv-codecs-core.ts`, `markdown-codecs-core.ts` (+ decode files), `turso-schema.ts`, `turso-tenant-schema.ts`, `turso-migrate.ts`, `roles-editor.tsx`, `resource-capacity.ts` (helper), `settings-sections/*` (workdayHours re-derive), sample `.md`/`.csv`, `__fixtures__/golden-*` regen, i18n, tests.

**Model:** day rates authoritative; hourly `internalRate`/`externalRate` remain the cost-math source, DERIVED/materialized on save. New Role fields `internalRateDay`, `externalRateDay`, `rateBasis?: "day" | "hour"` (default `"day"`). Materialize: basis `"day"` → `internalRate = round(internalRateDay / workdayHours, 2)` (same for external); basis `"hour"` → `internalRateDay = round(internalRate * workdayHours, 2)`.

- [ ] `types.ts` Role: add the three fields (comment day = customer-visible rate/day, hourly = derived).
- [ ] `sanitize-entities.ts` `sanitizeRole`: sanitize new fields (`sanitizeRate` for day rates; `rateBasis` = `"hour"` only when input is exactly `"hour"`, else `"day"`). **Legacy migration:** if `internalRateDay`/`externalRateDay` absent on load, set `rateBasis="hour"` (preserve exact existing hourly) and derive day fields from hourly × default workdayHours. Keep hourly authoritative for basis `"hour"`.
- [ ] Persistence: add the three columns to `ROLES_CSV_COLUMNS` + `ROLES_MD_COLUMNS` + decoders + Turso single+tenant DDL/insert (derived from CSV columns). **Extend `turso-migrate.ts` if roles is in its column-ensure spec** (verify — roles is a normal entity table, so ENTITY_SPECS should cover it; confirm, unlike the plan/fx_rates/meta exclusion).
- [ ] `resource-capacity.ts` or a new `role-rates.ts`: shared pure `materializeRoleRates(role, workdayHours)` → the role with hourly re-derived from day (basis day) — the SINGLE rule. Call it wherever roles are saved (roles-editor onSaveRole) so cost math keeps reading correct hourly. Do NOT change the cost consumers themselves.
- [ ] `roles-editor.tsx`: add internal/d + external/d columns (notation `internal/d`, `external/d`). Per role: the column matching `rateBasis` is the editable `<input>`; the other shows the computed value read-only (greyed). "Clear the filled cell to unlock the other": clearing the editable cell (empty) flips `rateBasis` and unlocks the sibling. Add InfoTooltip on the /d and /h headers explaining the mutual-exclusion + auto-calc. Thread `workdayHours` (from `settings.resources.workdayHours`) into the editor. Keep column widths / sort keys consistent.
- [ ] workdayHours change: when `settings.resources.workdayHours` changes, re-derive hourly for all `rateBasis==="day"` roles (a one-shot re-materialize on the settings save path). Confirm where resources settings persist and add the re-derive (functional setter over roles).
- [ ] Sample data: regenerate `sample-workspace-small` roles with `rateBasis="day"` + day rates = hourly×8 (via the gen script), then regenerate `__fixtures__/golden-*` (legit new-column change). Update the curated `.md`/`.csv` roles table + `# ROLES` section columns.
- [ ] i18n EN+DE: `rolesInternalRateDay`, `rolesExternalRateDay`, `rolesRateBasisHint` (mutual-exclusion explanation).
- [ ] Tests: sanitize round-trips the three fields; materialize derives hourly correctly (800/d ÷ 8 = 100/h); basis flip; legacy load (no day fields) → basis hour + preserved hourly; codec round-trip (csv+md); `entity-persistence-registry.test.ts` row for the new columns.
- [ ] Commit `feat(rate-card): day rates as source of truth with hourly auto-calc`.

## T4 — Planning: hide external resources

**Files:** `resources-panel.tsx`, i18n, `resources-panel.test.tsx`.

- [ ] View-local toggle (useState, mirror `showRollup`) in the planning toolbar (near the granularity/util-mode SegmentedControls `:442-465`): a labeled checkbox/toggle "Hide external" (`planningHideExternal`).
- [ ] Filter `Resource.isExternal` out of the planning rows (before `planRows` map `:308`) AND the rollup table (`:623-677`) when on.
- [ ] i18n EN+DE: `planningHideExternal`.
- [ ] a11y: toggle labeled (Resources IS axe-scanned).
- [ ] Test: enabling the toggle removes external-flagged resources from the rows.
- [ ] Commit `feat(planning): toggle to hide external resources`.

## T14 — Planning: Capacity (hours) column

**Files:** `resources-panel.tsx`, i18n, `resources-panel.test.tsx`.

`totalHours` already computed per row (`:314`) — currently only shown as days.

- [ ] Add `capacityHours` to `PLANNING_COL_WIDTHS` (`:55-62`), `PlanningCol`/`PlanSortKey` (`:63-64`), `getPlanValue` (`:336-342`), a sortable header th (mirror `:492-499`), a body td showing `totalHours.toFixed(1)` (`:588` pattern), and a tfoot total (`:607`).
- [ ] i18n EN+DE: `planningCapacityHours`.
- [ ] **Size:** `resources-panel.tsx` is 825 vs ratchet 826 — T4+T14 will cross it. Either extract the planning table into `resources-planning-table.tsx` (presentational, props-driven; mirror `ResourceWorkload`) OR `node scripts/check-file-sizes.mjs --update` if the growth is modest and extraction is disproportionate. Prefer extraction if it cleanly crosses; document the choice.
- [ ] Test: the capacity-hours column renders the per-row total and a footer sum.
- [ ] Commit `feat(planning): capacity (hours) column`.

## T-final — Release prep

- [ ] `version.ts`: APP_VERSION `0.177.0`, APP_MILESTONE `Aldiss`, APP_BUILD_DATE. Append any new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` + EN/DE (one highlight for the batch, e.g. `versionHighlightUxBatchAldiss`).
- [ ] `CHANGELOG.md`: 0.177.0 "Aldiss" entry listing the 14 items.
- [ ] Memory: write `ux-batch-aldiss.md` + MEMORY.md index line.
- [ ] Gates: `npx tsc --noEmit`, `npm run test:run`, `npm run build`, `npm run size:check`, `npm run dup:check`, `npm run lint`, `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"` / `"Resources"` / `"Open Points"` for the axe-scanned surfaces touched.

## Security / constraints
- Never log/echo apiKey/token/response body; classifier reads only `error.type`.
- DE i18n via node utf8 write, CRLF anchors, real umlauts (i18n-encoding test).
- `writeSettings` sole writer of `lop-app:settings`; new AiConfig fields ride the spread + sanitizer.
- New Role columns → 6 write paths + golden regen; verify `turso-migrate` covers roles.
- Palette-safe: only AIPM tokens, no gradients/shadows; hover uses `hover:border-AIPM-dark-blue`.
- Confirm-before-window-changes already granted for the ⚠ items in this batch.
