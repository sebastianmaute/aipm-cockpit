<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, file structure may all differ from training data. Read relevant guide in `node_modules/next/dist/docs/` before writing code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Commands

```bash
npm run dev                 # next dev (forked Next.js)
npm run build               # next build (prebuild checks script-docs are in sync)
npm run lint                # eslint  (CI --max-warnings=0: an unused import/var or `_`-prefixed
                            # param is FATAL — no argsIgnorePattern; re-check after every extract.
                            # react-hooks/exhaustive-deps REJECTS an `obj.member` dep (e.g.
                            # [snapshots.rebaselineNow]) — hoist it to a local const and depend on that.
                            # A react-hooks PURITY rule bans `Date.now()`/`Math.random()`/`new Date()`
                            # in a component RENDER body too (not just useMemo) — capture via a lazy
                            # `useState(() => Date.now())`, or read it inside an effect/callback.
                            # `react-hooks/set-state-in-effect` is BANNED (fatal) — to sync state to a
                            # changed prop, use the render-time reconcile pattern (`if (prop !== handled)
                            # { setState(...) }` guarded by a nonce/last-seen state), NOT a useEffect.)
npx tsc --noEmit            # typecheck (enforces i18n EN/DE key parity). `next build` does NOT
                            # typecheck *.test.tsx and vitest never typechecks — a test-only type
                            # error (e.g. an invalid getByRole `{exact:...}`; a string `name` is
                            # ALREADY an exact match) passes build + tests but FAILS tsc (CI). Run
                            # `npx tsc --noEmit` after editing ANY test. fast-check gotchas that pass
                            # vitest but FAIL tsc/the test: `fc.date()` can emit an Invalid Date →
                            # `.toISOString()` throws — pass `{noInvalidDate:true}` or map an integer
                            # ms range to `new Date(ms)`; the regex `/s` (dotAll) flag fails tsc
                            # (target < es2018) — use `[\s\S]` instead.
npm run test:run            # vitest (unit/integration). testTimeout/hookTimeout = 20s
                            # (raised from the 5s default in vitest.config) — the CPU-heavy
                            # fast-check property suites (`*.property.test.ts`, ~100 runs each) +
                            # fake-indexeddb setup can starve a worker past 5s under full-suite
                            # parallel load on a slow machine → a RARE, non-deterministic timeout
                            # that never repros in isolation or in CI. Don't "fix" such a flake by
                            # editing the property logic before ruling out a load timeout (run the
                            # property thousands of times in isolation first; logic bugs repro there).
npm run e2e                 # playwright (incl. the 12-view axe a11y gate)
```

## Hard constraints (CI-enforced — these gate merges)

- **i18n:** `i18n.ts` (EN) + `i18n.de.ts` (DE) key sets must be identical (tsc enforces).
  DE must use real German umlauts — `i18n-encoding` test BANS ASCII subs (fuer/druecken).
  Edit tool corrupts umlauts AND curls double-quotes in `i18n.de.ts` (bites umlaut-free
  strings too); patch via node utf8 write, re-verify. File is CRLF — a node
  replace whose anchor uses `\n` silently no-ops; match `\r\n`.
  Interpolated strings use 0-based positional placeholders: `t(lang, key, a, b)` → `{0}`/`{1}`.
  `Lang` is `"en-US" | "en-GB" | "de"` — NO `"en"` (legacy runtime alias only, invalid
  as TS literal; `t(lang, …)` calls + component tests must use `"en-US"`). DE dict lazy —
  test asserting DE output must call `loadI18n("de")` (e.g. in `beforeAll`) before assertion.
- **Byte-stable serializers:** `golden-workspace.test` pins exact CSV/Markdown storage bytes.
  Failure usually means real format change — only regenerate `__fixtures__` when the
  *input* (`sample-workspace-small.json`) legitimately changed, never to mask format diff.
  Renaming/moving sample data or any asset: grep `e2e/` TOO (not just `src scripts README docs`) —
  `e2e/seed.ts` reads `sample-workspace-small.json` at MODULE TOP-LEVEL, so stale path ENOENTs the
  whole e2e job (fails only in CI; `npx playwright test --list` triggers the read without browsers).
- **Palette:** only sanctioned AIPM brand tokens (`globals.css`); no off-palette colors,
  gradients, shadows. a11y gate + palette-sweep test enforce contrast/token use.
  Note: palette-sweep scans CSS for `box-shadow` — an off-palette Tailwind class (e.g. `shadow-md`)
  on element PASSES CI but still forbidden; check new components by eye.
- **a11y (axe gate):** every new interactive control (button/checkbox/input/drag handle) needs
  accessible name + keyboard operability — unlabeled form control is axe-critical FAIL.
  `placeholder` is NOT an accessible name — input needs `aria-label`/`<label>` (placeholder-only
  input fails axe gate even though looks labeled).
  In LIST of rows, per-row controls need row-UNIQUE accessible name (e.g.
  `aria-label={`${t(lang,"edit")} – ${row.name}`}`) — N identical "Edit"/"Enabled" labels is
  WCAG 2.4.6 fail, but axe gate can PASS it when live app seeds only ONE row (collision
  never renders at scan time). Qualify label; don't trust green axe run with single seeded row.
  ★★ TOGGLE-BUTTON name/state coherence: a `<button aria-pressed>` whose VISIBLE LABEL flips to the
  OPPOSITE action (e.g. "Comfortable view" while compact is active) announces "Comfortable view,
  pressed" — implying the WRONG mode is on (WCAG 4.1.2). axe PASSES it (a name exists). Fix: PIN the
  label to what the toggle ENABLES ("Compact view") and let `aria-pressed` track THAT state, so
  "Compact view, pressed" ⇒ compact is on. (Bit the dashboard density toggle; the older Trends toggle
  still has the inverted pattern.)
  Moving/folding a control INTO an axe-scanned view re-scans it: gate scans `Settings`→General, so
  folding Storage/Appearance into General surfaced pre-existing unlabeled `<select>` (a visible
  `<span>` label is NOT an `aria-label`/`<label>`) as axe-critical.
  `A11Y_VIEWS` list (`e2e/a11y.spec.ts`) is 12 named views and does NOT include chat/AI-Assistant,
  Projects, or Documents — controls only on those surfaces aren't scanned, but anything in the
  always-present top bar IS (scanned via every view). Verify IA/UI/contrast changes with
  `npx playwright test e2e/a11y.spec.ts --project=chromium -g "<View>"` (~16s, webServer auto-starts)
  BEFORE pushing — unit suite (`test:run` = vitest) never runs playwright, so axe regressions slip
  local gate and fail ONLY in CI.
- **CI is GitLab** (not GitHub),  (GitLab). Pipeline: install → lint → typecheck → unit → build → e2e.
- **Releasing:** bump `src/app/version.ts` (APP_VERSION + milestone), add `CHANGELOG.md` entry,
  append any new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` (+ EN/DE strings).
- **New persisted `Workspace` field → SIX write paths** (JSON/CSV/MD/Turso-single/Turso-tenant/
  IndexedDB). Miss one and data silently drops on that backend.
- **New COLUMN on existing entity** (e.g. `Milestone.outlookEventId`): add to entity's
  `*_CSV_COLUMNS` (in `csv-codecs-core.ts` — covers CSV **and** Turso single+tenant, DDL/insert
  derive from it; also extend that entity's `*FieldToString`/`build*FromObj` THERE), plus the
  markdown codec (`*_MD_COLUMNS` + table codec in `markdown-codecs-core.ts`) + `sanitize.ts` (see
  "Codec module maps" / "Sanitize module map" for which sub-file); REGENERATE `__fixtures__/golden-*`
  (legit new-column format change)
  and append column to curated `sample-workspace` `.md`/`.csv`. EXISTING Turso DBs:
  `CREATE TABLE IF NOT EXISTS` can't add column and save INSERTs *named* columns, so old DB
  errors on save — `turso-migrate.ts` self-heals (PRAGMA-diff → `ALTER ADD COLUMN`, run inside
  write lock before save).
- **Turso-gated features** (Snapshots/Trends, version history) must check `tursoConfig !== null`,
  not just `storageConfig.kind === "turso"` (kind can be set while config unset/quarantined).
- **CSP allowlist:** every host BROWSER calls (Turso, Anthropic, MS Graph, MSAL, Jira) must be in
  `src/proxy.ts` `connect-src`/`frame-src` — NOT `next.config`. Missing host fails only at RUNTIME
  (unit tests mock `fetch`; `next build` passes), so silently slips through CI. CSP edits need dev-server restart.
- **New Turso table NOT workspace data** (snapshots, version history, comm_templates)
  must stay OUT of `TABLE_NAMES` (guard test enforces) — else workspace save's
  per-table DELETE wipes it. `SqlArg.value` (turso-schema) is string-only even for ints (`String(v)`).
- **Secrets at rest:** Anthropic `apiKey` + Turso `authToken` + Jira `apiToken` (`SecretId` union)
  ENCRYPTED via `secrets.ts` (AES-256-GCM; non-extractable device key in IndexedDB by default,
  optional per-secret PBKDF2 passphrase — Jira is device-only so far, no passphrase UI). ★ Adding a
  SecretId means SIX edits in lockstep: `SecretId` union, `isSealedSecret` id allowlist + `readStore`
  allowlist loop (both HARDCODE the id list — a missed one silently drops the ciphertext on read),
  `migratePlaintextSecrets` (seal + return), `writeSettings` blank, `hydrateSecretsInto` restore +
  the load-effect migrate/hydrate/re-merge block, and a seal-on-edit call in the field's settings
  section (`saveSecretValue(id,…,"device")`). ★ `jira` lives at TOP-LEVEL `settings.jira` (NOT under
  `settings.integrations`); `email`/`siteUrl` stay plaintext (identifying, and `email` is needed for
  the Basic-auth header). `writeSettings` is ONLY writer of `localStorage["lop-app:settings"]` and
  BLANKS those fields — settings persist EFFECT must call `writeSettings`, NEVER raw `setItem` (raw
  write dumps decrypted in-memory key/token to disk on every settings change — real CRITICAL
  we shipped and caught). M365 stores NO secret (clientId/tenantId are public; MSAL owns its token
  cache) — nothing to encrypt there. Secrets hydrated into memory on load (`hydrateSecretsInto`);
  passphrase-wrapped ones stay empty until unlock. Anything reading a secret uses live in-memory
  value; if IndexedDB/WebCrypto unavailable load path degrades to in-memory plaintext (never
  crash). `lop-app:secrets` ciphertext stays OUT of exports, Turso, recovery `CONFIG_KEYS`.
- **App config vs project data (reset/clear boundary):** `app-reset.ts` `clearAppConfig()` wipes
  ALL `lop-app:*` localStorage (snapshot keys BEFORE the remove loop — index-shift) + deletes the
  CONFIG IndexedDB DBs `lop-app-secrets` (device key) and `lop-app-project-handles` (FS-access
  pointers). It must NEVER delete the WORKSPACE IndexedDB DB `lop-app` (project data) — reset is
  detach-only ("no file/DB deletion"). Any new clear/reset path obeys the same split. IDB deletes
  are fire-and-forget (awaiting can hang on `onblocked` across tabs).

## Architecture pointers

> Bullets describe CURRENT behavior; version/MR provenance lives in git + CHANGELOG, not here.

- **Orientation / key files:** `task-manager.tsx` = root orchestrator (layout, top bar, view
  routing; threads workspace + AI hooks down). `storage.ts` = backend facade;
  `workspace-context.tsx` = live workspace state + setters; `types.ts` = all entity shapes + enum
  consts; `sanitize.ts` = single per-entity validators (a BARREL — see "Sanitize module map");
  `i18n.ts`/`i18n.de.ts` = EN/DE strings; `nav-config.ts` = `AppView` list + nav labels.
- `src/app/` is flat, organized by feature. Pure domain logic lives in i18n-free modules/subdirs
  (e.g. `next-actions/`, serializers); React surfaces import them and translate — keep engines i18n-free.
  ★ Before creating `<name>.ts`, check for existing `<name>.tsx` (and vice versa) — a bare `./<name>`
  import resolves `.ts` AHEAD of `.tsx`, so a new pure `foo.ts` silently hijacks an existing `foo.tsx`
  component import and breaks its tests. Name the pure module distinctly (e.g. `action-notifications.ts`
  beside `notifications.tsx`).
- Storage facade (`storage.ts`) over backends: JSON file, CSV, Markdown, Turso (single + multi-tenant),
  IndexedDB. Snapshots/Trends + version history are Turso-ONLY.
- **Sample data** tiered: `sample-workspace-small.*` is curated source; `-big` (3×) and `-huge` (10×)
  JSON+SQLite GENERATED via pure `scaleWorkspace(ws, factor)` (id-offset `k*100000` + full FK remap;
  reference data — resources/roles/disciplines/grades — NOT replicated; replicas get distinct
  stakeholder names + workstream-qualified titles, not "(2)"). Don't hand-edit `-big`/`-huge`; regenerate.
  MASTER is `sample-workspace-small.md` — `scripts/generate-sample-workspace.ts` PARSES it and EMITS
  `.json` + `.sqlite3` + `-big`/`-huge` (regen: `npx vite-node scripts/generate-sample-workspace.ts`,
  then regenerate `__fixtures__/golden-*` via serializers). `project` meta + `status` SYNTHESIZED IN
  GEN SCRIPT (not in .md). `sample-workspace-small.csv` is a SEPARATE hand-curated artifact (parsed by
  sample tests). MD table cells with internal `|` are `\|`-escaped and CSV has MULTI-LINE quoted fields
  → NEVER naive-split a row: edit .md by exact full-line replace, edit .csv via app codec
  (`csvToWorkspace`→patch→`workspaceToCsv`, verified data-safe round-trip).
- **Action-Center CTAs surface-only:** thread optional handler task-manager → workspace-section →
  ActionsPanel → ActionRow (ActionsPanel renders in workspace-section, not task-manager, and renders
  TWO ActionRow lists — tier + monitor — so a new CTA prop must thread to BOTH); `next-actions/` engine
  stays pure.
- **Top bar in TWO independent places**, both built in `task-manager.tsx`: classic `AppHeader`
  (`appHeaderEl`, used by classic main-window `legacyTree`) and modern `ModernShell` `topBarMenus` slot
  (DEFAULT layout). A new top-bar control must wire into BOTH or it's invisible in whichever layout you
  forgot (modern default is the easy miss). Popout `legacyTree` branch renders NO header, so header
  controls correctly never appear in popouts.
- **Remount-swallow (parent request/nonce → conditionally-mounted child):** modern shell renders ONLY
  the active view; workspace-section renders ONLY the active tabpanel — so a view MOUNTS FRESH each
  visit. A child consuming a parent "request"/nonce prop must NOT seed its last-seen/handled ref from the
  LIVE prop (`useRef(prop)`/`useState(prop)`) — a fresh mount sees prop===seed and silently SWALLOWS a
  pending request. Seed `undefined`/sentinel + guard `!== undefined`; parent must CLEAR (consume) or
  monotonically bump the nonce so re-mounts don't re-fire stale. Bit settings-view learning deep-link AND
  milestones-panel `openCreateNonce` (Gantt "Add milestone").
- **Task editor has TWO surfaces:** modern DEFAULT uses full-page `TaskEditView` (ModernShell `editView`
  slot; `useEditView = layout==="modern" && !isPopout`); classic/popout use `TaskFormModal` (which has
  its own `ModalHeader` title+✕). New editor controls/heading wire into the surface in play —
  TaskEditView's control bar is SEPARATE from the modal's header.
- **Task status model:** `Task.status` (To Do/In Progress/On Hold/In Review/Cancelled/Done) is the
  SOURCE OF TRUTH for "done", but `completedDate` is AUTO-MANAGED to keep the invariant
  **`status==="Done" ⟺ completedDate set`** — so the ~30 existing completedDate-based derivations were
  left untouched. Pure i18n-free engine `task-status.ts`: `applyStatusChange(task,next,today)` is the SOLE
  writer of status+completedDate — EVERY status mutation (form save create+update in `use-task-submit`,
  inline dropdown + `onToggleComplete` in `use-task-row-handlers`, AI/Jira/template seeds) routes through
  it; `migrateTaskStatus` runs on ALL SIX load paths (completedDate set → Done, else To Do).
  `isTaskFinished`=Done|Cancelled; Cancelled is terminal-but-NOT-completed (excluded from
  overdue/next-actions/health-red, but completion-% still counts Done only). UI labels via
  `task-status-ui.ts` (AIPM palette tokens only). ★ The table status column key is **`taskStatus`** — the
  pre-existing `"status"` col key is the RAG/health DOT (header "Health"/DE "Ampel"). ★ The tasks view
  ("Open Points") IS in axe `A11Y_VIEWS`, so the inline status `<select>` needs a row-UNIQUE label
  (`Status – <task>`).
- **Kanban board:** tasks pane has a Table/Board toggle (per-device `settings.tasksViewMode`). Board
  component is **`task-kanban-board.tsx`** — NOT `task-kanban.tsx` (the pure `task-kanban.ts` engine
  shadows a `.tsx` sibling via `.ts`-before-`.tsx` resolution). Native HTML5 DnD (no lib); the per-card
  status `<select>` (shared `TaskStatusSelect`, also used by the table row) is the keyboard path. ★★ The
  board renders OUTSIDE `RowContextProvider` (which wraps only the table body) — so ANY component a Kanban
  card renders must take what it needs as PROPS, never `useTaskRowContext()` (that THROWS → board crashes
  on RAID-linked cards; bit `RaidBadge`, now in `task-raid-badge.tsx` taking `lang`+`onJumpToRaid` as
  props). Test cards/board with a populated `raidByTask` or the crash path stays untested. ★ Jira-synced
  tasks (`!!task.jiraKey`) are read-only: sync maps `statusCategory`→`status` via `jiraCategoryToStatus`
  INSIDE `issueToTaskFields`' patch and applies `patch.status` DIRECTLY — NOT through `applyStatusChange`
  (which would stamp `today` instead of Jira's resolution date). Board/table selects + drag are disabled
  for synced; `onStatusChange` no-ops on `jiraKey`. Board is NOT in axe `A11Y_VIEWS` (gate scans the table
  view) — board a11y is eye-verified (row-unique select labels + per-column `aria-label`).
- **Gantt module map:** `GanttPanel` (`gantt.tsx`) is orchestrator only (data derivation + layout); heavy
  parts extracted. Pure i18n-free ENGINE `gantt-engine.ts` (date math, prefs load/save, critical-path,
  derive-bar). React pieces: hooks `use-gantt-bar-drag.ts` (bar move/resize — window pointer-listener drag
  lifecycle + `previewDates`/`startBarDrag`, mirrors drag into state for the preview bar) and
  `use-gantt-prefs.ts` (sort/filter prefs state + localStorage hydrate/persist + setters); presentational
  `gantt-chrome.tsx` (`GanttToolbar`, `GanttHeader` axis, `GanttDependencyLayer` SVG arrows + milestone
  connectors) and `gantt-rows.tsx` (`GanttTaskRow`, `GanttMilestoneRow`). Rows/chrome are PURE —
  `GanttPanel` threads data + drag state/handlers (incl. the same `interactingWithBarRef` the row's
  `onDragStart` reads synchronously) down as props. ★ Gantt IS in axe `A11Y_VIEWS`. ★ One brittle
  markup-ORDER source test reads `gantt-chrome.tsx` (toolbar markup moved there), not `gantt.tsx`.
- **Reports module map:** `ReportsPanel` (`reports.tsx`) owns data + sort/column-resize state; pure
  i18n-free `reports-stats.ts` (`computeStats` + `Stats`/`GroupOrLabelRow`) and presentational
  `reports-tables.tsx` (`GroupOrLabelTable`, `AssigneeTable`, `Tile`, `Section`, `StackedBar` + shared
  `REPORTS_*_COL_WIDTHS` consts and `AssigneeSort`/`GroupOrLabelSort` types). One-way dep (reports →
  reports-tables → reports-stats); per-type report engines/panels (budget/raid/resource/stakeholder) live
  in their own files. Reports IS in axe `A11Y_VIEWS`.

### Dashboard landing cockpit

The Dashboard (`dashboard-panel.tsx`, owns `computeDashboard`) opens with a greeting + "since you last
looked" delta strip, then the ranked top-actions queue (promoted ABOVE the health band), with the four
RAG `OverrideSelect`s folded into a `<details>` "Adjust health ratings" disclosure. Dashboard IS in axe
`A11Y_VIEWS`. Built as slices:

- **Delta strip:** pure i18n-free `dashboard-delta.ts` (`computeDelta` diffs the activity log by
  `timestamp > lastVisitAt` + a prior RAG snapshot → `DeltaResult`; `buildGreeting`); per-project
  localStorage store `landing-state.ts`; hook `use-landing-delta.ts`; presentational
  `dashboard-delta-strip.tsx`. ★★ `landing-state.ts` is a per-BROWSER, per-PROJECT store (single key
  `lop-app:landing-state` → `{[projectId]: LandingState}` map, capped 50 most-recent) — NOT a Workspace
  field (zero backend write paths), OUT of exports/Turso, cleared by `clearAppConfig`'s `lop-app:*` sweep.
  Keyed off workspace-section's `currentProjectId ?? "default"`. ★★ `use-landing-delta` captures the delta
  ONCE at mount via a LAZY `useState(() => computeDelta(loadPrior, …))` (reads the PRIOR snapshot before
  advancing) and advances the stored snapshot in a DEBOUNCED (4s) `useEffect` that ONLY writes localStorage
  (a side-effect, NOT setState) — both shapes are deliberate to pass the react-hooks PURITY +
  `set-state-in-effect` bans; `new Date()` lives in the timeout callback. Popout = read-only (no advance).
  ★★ CHIP CLICK ROUTING: deep-links RAID/milestone/change to the SPECIFIC item via `requestOpen(view, id)`
  (wired in `workspace-section.tsx`, same channel as the Action Center) — `onOpenRaid`/`onOpenMilestone`/
  `onOpenChange` carry their id arg. Only the AGGREGATE delta-strip milestone/change chips + the
  milestone-horizon "+N more" affordance stay view-LEVEL (pass sentinel `-1` → target panel's `pendingOpen`
  effect finds no item → view switch only). `onOpenTask` OPENS A SPECIFIC EDITOR by id (`tasks.find(id)`),
  so it MUST be gated on a real `repTaskId` (first overdue/due-soon) or the chip is a DEAD `-1` no-op button
  (the strip downgrades a handler-less chip to a non-interactive `<span>`). ★ `DashboardPanel.projectId` is
  OPTIONAL (defaults `"default"`) so the ~30 existing test render sites don't break. ★ greeting hour via
  lazy `useState(() => new Date().getHours())` (purity — no `Date` in render body). ★ `newOverdue` lower
  bound is INCLUSIVE (`dueDate >= sinceDate && < today`): a task due ON the last-visit date wasn't overdue
  then (due end-of-day) but is now. ★ strip chips are real `<button>`s (text = accessible name), flip labels
  are `<span>`s; the `<details>` is keyboard-native and keeps the override `<select>`s in the DOM (so
  `getByText("Overall")` still resolves).
- **Milestone horizon strip ("what's coming"):** pure engine `bucketMilestonesByHorizon` (in
  `milestones.ts`) buckets NON-achieved milestones into `overdue`/`thisWeek`/`next2Weeks`/`later` by
  CALENDAR days (`HORIZON_THIS_WEEK_DAYS=7`, `HORIZON_NEXT_DAYS=21`; UTC-midnight `Date.parse`, no
  `new Date()` of now — `today` passed in); overdue-first, a `d < 0` safety net also routes to overdue, an
  unparseable date → `later` (never crashes, never false-overdues). Each `HorizonEntry` carries its
  `milestoneStatus`. Presentational `milestone-horizon-strip.tsx` REPLACED the old flat dashboard
  Milestones list (same `showMilestones`-gated `Section` slot; buckets via a `useMemo` over
  `props.milestones`+`props.tasks`+`today`+`holidaySet`; `onOpenMilestone` ignores its arg → routes to the
  milestones view). ★ The ENGINE is uncapped (full + testable); the STRIP caps each bucket at
  `MAX_PER_BUCKET = 5` rendered chips with a "+N more" affordance (bucket header still shows the TRUE
  total) — without the cap a large portfolio's `later` bucket floods the cell. ★★ REUSABLE a11y LANDMINE: a
  `RagBadge` (renders `<span role="img" aria-label="Red"/"Amber">`) placed INSIDE a `<button>`/clickable
  chip BLEEDS its label into the element's computed accessible name (→ "Red ⚠ M1 · date"). Wrap it in
  `<span aria-hidden="true">` whenever the visible ⚠/text already conveys the meaning — applies to ANY
  RagBadge-in-button. ★★ INVERSE trap (same class): an `aria-label` on a NON-interactive BARE `<div>`/wrapper
  (no `role`) is NOT announced by screen readers — dead markup. To name a decorative graphic (SVG
  sparkline/chart), put `role="img"` + `aria-label` ON THE GRAPHIC element itself (mirrors
  `trend-chart.tsx`), NOT on a wrapper div. axe does NOT flag the dead-label case, so it passes the gate
  while the meaning is invisible.
- **Coaching CTAs (first-open story):** pure i18n-free `dashboard-coaching.ts`
  `computeCoaching({taskCount,milestoneCount,budgetCount,showMilestones,showBudget,aiConfigured})` →
  ordered `CoachingCta[]` (`{key,labelKey,view}`, keys+`AppView` only). ★ GATED on `taskCount === 0`
  (blank project) → returns `[]` once any task exists, so the card SELF-HIDES (no dismiss control). Order:
  Add task(`open-points`) · Configure AI(`settings`) · Add milestone(`milestones`) · Set budget(`budget`),
  each gated on its module/empty condition. Presentational `dashboard-coaching-card.tsx` (returns null when
  empty); rendered right after the delta strip. ★★ NAV from the dashboard uses a single `onNavigate` prop
  wired to `useWorkspaceTab().setActiveTab` (the SINGLE active-view source — routes to `open-points`
  correctly even though tasks render in a separate `TasksSection`, not WorkspaceSection). ★★ The
  Anthropic-key "configured" signal is `settings.ai.apiKey` (NOT top-level `settings.apiKey` — that does
  not exist; `apiKey` lives on the nested `AiConfig`); use `!!settings.ai.apiKey?.trim()` (in-memory
  hydrated value, blanked on disk by `writeSettings`, passphrase-locked → `""` → unconfigured). ★ New
  `DashboardPanel` props `onNavigate?`/`aiConfigured?` are OPTIONAL (back-compat with ~30 test sites).
  ★★ EXHAUSTIVE-DEPS LANDMINE: a `?.length`/`obj.member`/any complex expression INSIDE a `useMemo` dep array
  is a FATAL `--max-warnings=0` warning — HOIST it to a scalar local (`const milestoneCount =
  props.milestones?.length ?? 0`) and depend on that. ★ The greeting summary is suppressed when
  `needsYou===0 && milestonesSoon===0` (avoids "0 items need you" on a blank project). ★ The live demo seeds
  a POPULATED project so the coaching card is ABSENT at scan time (buttons eye/unit-verified, not axe-gated).
- **KPI trend arrows ("which way is it moving"):** an "at a glance" 3-tile KPI strip (completion % · overdue
  · open RAID) below the coaching card, each tile with a trend arrow (↑/↓/→) + signed delta vs LAST VISIT.
  Pure i18n-free `dashboard-trends.ts` `computeMetricTrends(prior, current)` → `Record<MetricKey,
  MetricTrend>` (`{value, delta, direction, improved}`); per-metric `HIGHER_IS_BETTER` (completion up = good;
  overdue/openRaid up = bad). ★ `delta===null ⟺ improved===null ⟺ no prior value` → arrow renders NOTHING;
  exactly-flat `delta===0` → `improved:false` + `direction:"flat"` ("unchanged", muted, NOT worsened).
  Presentational `trend-arrow.tsx` returns `null` when `improved===null || delta===null`; glyph + signed
  delta are `aria-hidden`, the WRAPPER carries the full `aria-label` (label-bleed class — never let the glyph
  become the accessible name). ★★ REUSES the per-project `landing-state` snapshot — `LandingState.metrics?:
  MetricSnapshot` rides the SAME `lop-app:landing-state` map (zero new backend paths); guard accepts an
  optional metrics object. `use-landing-delta` returns `{delta, trends}` — trends mount-captured in the SAME
  lazy `useState` (reads `prior.metrics` before advancing), `metrics` written in the SAME debounced 4s
  advance (popout read-only). ★ The KPI tile VALUE reads LIVE `model`
  (`progress.percent`/`overdue.length`/`openRaidCount`); the arrow is mount-captured vs prior — same
  mount-snapshot asymmetry as the delta strip (a mid-visit reload can briefly diverge value vs arrow;
  accepted). ★ `DashboardModel.openRaidCount` is the TRUE open (non-terminal) RAID count — `topRaid` is
  capped at 5 so can't be the source; REQUIRED field but the only literal `DashboardModel` construction
  (`snapshot.test`) is an `as unknown as` cast. ★ `complete` KPI is a PERCENTAGE → `TrendArrow` takes a
  `unit` prop (`"%"`) so the visible delta (`+5%`) + aria-label aren't ambiguous; counts pass `""`. ★ `Tile`
  (`report-table.tsx`) gained an optional `trend` slot. Trend templates are i18n EN+DE.
- **Completion-trend sparkline ("trajectory"):** compact axis-less line of % complete over time, in a
  self-hiding card below the KPI strip. Pure i18n-free `completion-trend.ts`
  `computeCompletionTrend({snapshots, activity, currentDone, currentTotal, today})` → `CompletionPoint[]`
  (`{label,percent}`). ★★ SOURCE PRIORITY: if `snapshots` yields ≥2 points → exact
  `SnapshotRecord.pctComplete` series (Turso path); ELSE reconstruct done/total from the LOCAL activity log —
  anchor at the live counts and walk `task.created/completed/reopened/deleted` BACKWARD per day (deleted
  task's done-state unknown → assumed NOT done; documented approximation, like `newOverdue`). Neither ≥2 →
  `[]` (card hidden). Pure: `today`+counts passed in; percents clamped 0–100; future-dated + non-task events
  ignored; trailing cap `MAX_POINTS=12`. ★ ALWAYS-ON, no `tursoConfig` guard — on file/IDB `snapshots` is
  `[]` so the log path runs automatically (reads snapshots opportunistically, never WRITES). Presentational
  `sparkline.tsx` (pure SVG `<polyline>`, `stroke-AIPM-dark-blue`, null for <2 points; optional `ariaLabel`
  prop → SVG gets `role="img"`+`aria-label`, else `aria-hidden` decorative — name rides the GRAPHIC, not the
  bare card div). ★ New optional `DashboardPanel` prop `snapshots?` threaded from `trends.snapshots`; the
  panel ALREADY loads `activity` via `loadActivityLog()` (no activity prop). ★ series `useMemo` deps hoisted
  to scalar locals (`snapCount`/`activityCount`/`currentDone`/`currentTotal`/`today`). `model.progress`
  exposes `completed`+`total`. i18n EN+DE.
- **Density toggle ("fit more on screen"):** per-device Comfortable/Compact, SPACING ONLY (no
  font/palette/contrast change). Pure i18n-free `dashboard-density.ts` `densityClasses(d)` →
  `{outer,kpiGap,cardPad,sectionGap}` class strings — comfortable REPRODUCES the current literals
  (`space-y-4`/`gap-2`/`p-3`/`gap-4`, a no-op for existing users), compact tightens
  (`space-y-2`/`gap-1`/`p-2`/`gap-2`). `sectionGap` drives the two-column section grids
  (Progress+Budget, Milestones+Changes) so compact mode compresses them too. ★ Any NEW
  spacing on a cockpit slice MUST use a `dc.*` class (`outer`/`kpiGap`/`cardPad`/`sectionGap`),
  NOT a literal `gap-*`/`space-y-*`/`p-*` — a literal ignores compact mode (bit the two section
  grids: they stayed `gap-4` while everything else compressed).
  `DashboardPanel` takes `density?` (default `"comfortable"`) + `onToggleDensity?`. ★★ TWO controls, ONE
  setting (`settings.dashboardDensity?`, per-device, persisted via `setSettings`→`writeSettings` SPREAD —
  no allowlist edit, mirrors `tasksViewMode`): on-panel toggle button + a `SegmentedControl<DashboardDensity>`
  in `AppearanceSection` (Settings→General). `onToggleDensity` is `isPopout ? undefined` (popouts honour the
  `density` prop but render no toggle). ★ Settings→General AND Dashboard are BOTH axe-scanned —
  SegmentedControl's `ariaLabel` + the on-panel button's text name keep the gate green. ★ Compact-test
  asserts `.space-y-2` PRESENCE only (container-only; a global-absence check is brittle). i18n EN+DE.
- **Click-through:** `Tile` (`report-table.tsx`) gained an optional `onActivate`/`activateLabel` clickable
  variant (renders a real `<button>` — axe-safe name via `activateLabel`); pure i18n-free `activityViewOf`
  (`dashboard-activity-nav.ts`) maps an activity `kind`→`AppView`; KPI/progress/burn tiles + the completion
  sparkline launch their view via `onNavigate`, Top Changes rows + RAID register rows + horizon chips
  deep-link the item.

- **Deep-link row flash:** shared `use-deeplink-row-flash.ts` — `useDeepLinkRowFlash(view)` (render-time
  reconcile sets `flashId` + a monotonic `flashSeq` nonce; an effect keyed on `[flashId, flashSeq]` does the
  rAF `scrollIntoView({block:"center"})` + a `DEEPLINK_FLASH_MS=1800` auto-clear; the nonce makes a same-id
  re-request re-fire) + `flashOutlineClass(isFlashed)`. Each of the five deep-linkable panels
  (raid/milestones/changes/stakeholders/tasks) attaches `containerRef` to its `overflow-auto` scroll
  container and adds `data-deeplink-row={id}` + `flashOutlineClass(flashId===id)` to rows; static
  `outline-AIPM-green` (no bg → never fights row `bg-*` state classes; palette-safe). Fires ALONGSIDE the
  editor-open effect and does NOT clear `pendingOpen` (the panel's own effect does — both fire in the same
  commit; the side-effect is keyed on `flashId` NOT `pendingOpen` so `clearPendingOpen` can't cancel the
  scroll/auto-clear). ★ The Kanban **board** is ALSO wired: `tasks-section.tsx` threads the SAME
  `containerRef`+`flashId` into `<TaskKanban>` (only one of table/board mounts at a time, so the single ref
  is free); `task-kanban-board.tsx` attaches `containerRef` to the outer `overflow-x-auto` div and adds
  `data-deeplink-row`+`flashOutlineClass` to each card `<article>` (card scroll works because the per-column
  vertical scroller is a descendant of the outer ref). ★ Graceful no-ops (no scroll/outline, never crashes;
  editor still opens): tasks **modern full-page edit** (list unmounted) + any row/card hidden by an active
  filter/search (`hideFinishedTasks`, milestone filters). ★ By-design limit + modern-editor-return path: (a)
  toggling tasks table↔board WITHIN the 1.8s window re-points the shared `containerRef` so the OUTLINE shows
  on the new view, but the scroll won't re-fire (`flashId`/`flashSeq` unchanged); (b) every `open-points`
  task deep-link ALSO opens the editor, which in the DEFAULT modern layout is full-page `TaskEditView`
  (list/board unmounted) so the flash can't show WHILE editing — a modern full-page task deep-link flashes
  the row/card ON EDITOR RETURN via a flash-only `pendingFlash` channel on `WorkspaceTabContext`:
  `requestFlash(view,id)` sets `pendingFlash` ONLY (no `activeTab`/hash side-effects), `useDeepLinkRowFlash`
  consumes it (the SAME parallel render-reconcile, sentinel-seeded `handledFlash`) and SELF-CLEARS via
  `clearPendingFlash`; `task-manager`'s `flashOnEditReturnRef` is set when a deep-link opens the modern
  full-page editor and fired in the view-switch close branch when returning to `open-points` (works for
  cancel + save). Classic/popout uses the immediate path; the other four panels show the flash in modern as
  before.
- **Global search:** pure i18n-free `global-search.ts` (`searchWorkspace(ws, query)` → ranked
  `SearchResult[]`; id-exact > title-hit > body-hit tiers, per-type cap `SEARCH_MAX_PER_TYPE`
  round-robin-merged under `SEARCH_MAX_RESULTS`, `SEARCH_MIN_QUERY=2` with pure-numeric `#id` queries exempt
  from the min). Presentational `global-search-box.tsx` uses `combobox-shared`
  (`role=combobox/listbox/option`); module-level `GlobalSearchConnected` wraps `useWorkspace`+
  `useWorkspaceTab`, mounted in BOTH headers (modern `topBarMenus`/`search` slot + classic `AppHeader
  trailing`, not popout). Result select → `requestOpen(view,id)` → deep-link + row flash. ★ The search input
  is a top-bar control → scanned in EVERY axe view; keep its combobox a11y (aria-label + roles) intact. ★
  i18n key is `searchGlobalPlaceholder` (`searchPlaceholder` was taken by the task-table search). ★ Document
  keydown FOCUS SHORTCUT (⌘K/Ctrl-K always; "/" only when no INPUT/TEXTAREA/SELECT/contentEditable is active;
  Escape blurs). Pure `search-highlight.ts` `splitHighlight(text,query)` (indexOf-based, NOT a RegExp from
  input → no metachar/`/s`-flag traps) renders matched segments as `<mark class="bg-AIPM-green/20
  text-inherit">` in result title+subtitle, query-mode only. Pure `search-recents.ts` (per-device
  `lop-app:search-recents`, `MAX_RECENTS=8`, validated load, pure `pushRecent` dedupe+cap) — recents shown
  when the box is focused with an EMPTY query, FILTERED to items still present in the live workspace; OUT of
  exports/Turso, cleared by `clearAppConfig`. Unified `items` list (recents on empty, results otherwise)
  drives the combobox; "Recent" header is a non-option `<div>` outside the `<ul>`.
- **RAID edit modal map:** `RaidEditModal` (`raid-edit-modal.tsx`) owns draft, query state, derived option
  lists, add/remove handlers; presentational `raid-risk-matrix.tsx` (`RiskMatrix` 5×5 picker, Risk items
  only) and `raid-edit-fields.tsx` (`RaidLinkedTasksField`, `RaidCausedByField` — the two chip-picker
  sections, threaded handlers/state as props). RAID IS in axe `A11Y_VIEWS`.
- **OOXML export map:** hand-rolled Office export (no lib; own `zip.ts` writer) split by format:
  `export-docx.ts` (`buildDocx`), `export-xlsx.ts` (`buildXlsx`), `export-pptx.ts` (`buildPptx`) over shared
  `export-ooxml-shared.ts` (brand palette consts, `xmlEscape`, `todayHuman`, `PPTX_MAX_ROWS_PER_SECTION`).
  `export-ooxml.ts` is a BARREL re-exporting the 3 builders — `export.ts` consumes them via `await
  import("./export-ooxml")` and `export-ooxml.test.ts` imports from the barrel, so keep those three names
  exported there. (Sections come from `export-sections.ts`.)
- **Sanitize module map:** `sanitize.ts` is a BARREL (`export *`) over three files — keep importing from
  `./sanitize` (≈37 importers). Pure i18n-free, one-way deps (core ← entities ← records): `sanitize-core.ts`
  (primitives + length caps: `sanitizeText`/`sanitizeMultiline`/`toNumber` EXPORTED, plus the
  field/date/email/label/dependency sanitizers), `sanitize-entities.ts`
  (Absence/Shift/Resource/Role/Discipline/Grade/Plan/Budget/allocations/FxRates), `sanitize-records.ts`
  (Milestone/Change/RAID/Stakeholder/ProjectMeta/SteeringCommittee/timezone — imports only
  `BUDGET_NAME_MAX`+`sanitizeIdList` from entities). ★ A NEW entity sanitizer goes in entities or records
  (whichever cluster); a new shared primitive goes in core. Each `*_SET`/`*_RE` const stays in the file with
  its consumers. Golden byte-stability + `sanitize.test`/`.property` + the 37 importers guard behavior.
- **Codec module maps:** `csv-codecs.ts` and `markdown-codecs.ts` are BARRELS (`export *`) — keep importing
  from `./csv-codecs` / `./markdown-codecs`. Pure i18n-free, byte-stable (golden-workspace pins exact bytes).
  One-way deps:
  • CSV (core ← config ← decode): `csv-codecs-core.ts` (leaf — `*_CSV_COLUMNS` registries, parse helpers,
  the `fieldToString` family + `build*FromObj` decoders shared with the MD codec & Turso schema, csv
  escaping, per-section entity encoders, the low-level `parseCsv` tokenizer), `csv-codecs-config.ts`
  (status/field-visibility/features/steering config-blob codecs + ProjectMeta codecs + the `workspaceToCsv`
  ENCODER assembler), `csv-codecs-decode.ts` (`splitCsvSections` + row→object helpers + entity decoders +
  `decodeRatesMap` + the `csvToWorkspace` assembler).
  • MD (core ← decode): `markdown-codecs-core.ts` (leaf — `*_MD_COLUMNS`, `mdEscape`/`mdUnescape`, per-entity
  table encoders, config/project MD codecs, the THREE self-contained table decoders
  `markdownToMilestones`/`Changes`/`Stakeholders`, the `workspaceToMarkdown` encoder, the shared row
  primitives `splitMdRow`+`markdownTableToObjects`), `markdown-codecs-decode.ts` (`splitMarkdownSections` +
  remaining entity decoders + `markdownToWorkspace`). ★★ `parseCsv` (CSV) and
  `splitMdRow`+`markdownTableToObjects` (MD) were HOISTED into the respective CORE so the config-blob / early
  table decoders share them WITHOUT a config↔decode / core↔decode cycle. ★ Cross-module-referenced core
  internals (the `CSV_SECTION_*` consts, entity encoders, `csvCellEscape`; `mdUnescape`, the row primitives,
  the three MD table decoders) are EXPORTS. A new per-section codec goes in core; a new config-blob codec in
  `csv-codecs-config`; a new assembler stays with its peer.
- **useStorageBackend module map:** `use-storage-backend.ts` keeps the PERSISTENCE core (backend memo,
  reactive refs, `applyWorkspace`, the load/save debounce effects, broadcast sync, the storage-file controls
  `onPick`/`onGrant`/`onOpen`/`onRequestStorageSwitch`, and shared helpers
  `backendFor`/`currentWorkspace`/`commitRegistry`/`persistBackendHandle`/`tursoConfigNow`/
  `reportProjectError`). The two project-operation clusters live in hook factories it composes:
  `use-storage-file-ops.ts` `useFileProjectOps` (switchToProject / createProject / loadProjectFromFile /
  createDemoProject) and `use-storage-turso-ops.ts` `useTursoProjectOps`
  (switch/create/migrate/archive/restore/hardDelete Turso portfolio projects). Each takes a typed `deps`
  object (the live render-scope closure values + shared helpers) and returns the handlers. ★★ These handlers
  MUST NOT be memoized — they read live render-scope state every call (the same reason the originals were
  bare `function` declarations). ★★ The factories are named `use*` and called UNCONDITIONALLY (before the
  single `return`, no early-return precedes them) because the react-hooks PURITY rule REJECTS passing a ref
  object into a plain function call during render — a `use*` hook may receive the hook's refs, a plain
  `createX(deps)` cannot. ★ A new project flow goes in file-ops or turso-ops; a new persistence concern or
  shared helper stays in `use-storage-backend.ts` and is threaded into the deps. Public return shape is
  unchanged.
- **Workspace-section module map:** `workspace-section.tsx` is the view ROUTER (the tabpanel switch); it
  imports the lazy panels from `workspace-panels.tsx` (the 20 `dynamic(ssr:false)` view-panel `export
  const`s — keep new lazy panels there) and the props contract `WorkspaceSectionProps` from
  `workspace-section-types.ts`, which it RE-EXPORTS. Static (non-lazy) panels
  (Dashboard/Milestones/SteeringCommittee/ResourceDirectory) stay imported directly. Routes the axe-scanned
  views, so changes there re-scan them.
- **UI shell:**
  • Default landing view is `dashboard` (set in `workspace-tab-context.tsx`).
  • Steering committee panel uses the STANDARD resizable content-pane shell
  (`VIEW_PANE_RESIZABLE_CLASS` + `useResizable("lop-app:steering-size")` + `ResetSizeButton`, header OUTSIDE
  the bordered scroller).
  • Dashboard density/Trends toggles render in the `ReportCard` `toolbarExtra` slot (left of Print); the
  report date sits on the "Overall" line.
  • `settings.showDisplayTzSwitcher?` (per-device, default **false**) gates the top-bar `displayTzSwitcherEl`
  — both header mounts share the ONE gated element.
  • Task-editor actions render ONLY in the editor surface (TaskEditView footer / TaskFormModal), NEVER the
  top bar — `ModernShell` takes no `editActions`/`primaryAction` for the edit case.
  • `task-jira-badge.tsx` = SHARED read-only Jira badge (lock SVG `aria-hidden` + `jiraSyncedReadOnly`
  title/aria; link variant when `href`), used by BOTH the Kanban card and the table row; takes everything as
  PROPS (board renders outside RowContextProvider).
  • Settings-section deep-link is GENERAL: dashboard `onNavigate(view, section?: SettingsSectionId)` →
  task-manager `onOpenSettingsSection(section)` → `settingsSectionRequest` → SettingsView. `SettingsSectionId`
  (mirrored in `dashboard-coaching.ts`) is a SUBSET of settings-view `SectionId`.
- **Scrollbar gap:** per-view inner scrollers (`min-h-0 flex-1 overflow-auto`) need `pr-2` for the
  content↔scrollbar gap. Shared `INNER_TABLE_CLASS`/report-table/actions-panel already include it; bare
  per-panel scrollers do NOT — add `pr-2` or content jams the scrollbar.
- **Responsive metric grids:** a multi-column grid of CONTENT cards (KPI tiles, budget CCI cards, hours
  breakdown, checkbox lists) must carry a `grid-cols-1` (or `grid-cols-2`) mobile base and only widen at
  `sm:`/`lg:` — a bare `grid grid-cols-3`/`grid-cols-4` overflows a phone/narrow-tablet viewport (the
  cells crush + text wraps). The convention is the Reports tile grid (`grid-cols-1 ... sm:grid-cols-2
  lg:grid-cols-3` / `grid-cols-2 ... sm:grid-cols-4`). EXEMPT: a 2×2 grid whose two dimensions are
  SEMANTIC (the stakeholder interest×power matrix) and a side-by-side diff grid — collapsing those to one
  column destroys the meaning; leave them `grid-cols-2`. Most views are NOT in the axe gate's narrow-width
  scan, so a responsive break slips CI — eye-check new metric strips at ~375px.
- **Interaction-state atoms (`interaction-styles.ts`):** pure class-string consts every interactive control
  composes so hover/focus/press read identically app-wide — `FOCUS_RING` (canonical
  `focus:outline-none focus:ring-2 focus:ring-AIPM-green`), `TRANSITION` (`transition-colors duration-150`),
  `PRESS` (`active:translate-y-px`), and `INTERACTIVE` = all three. Palette-safe by construction (no color but
  the brand ring; no shadow/gradient). ★ Apply ADDITIVELY — append the atom AFTER the control's own color
  classes; convert a plain-string `className` to a template literal. ★ Buttons get `${INTERACTIVE}`; FORM
  FIELDS (`<input>`/`<select>`/`<textarea>`) get `${FOCUS_RING} ${TRANSITION}` ONLY — never PRESS (a 1px
  translate on a field is wrong). ★ A control that ALREADY has a complete `focus:ring-2` keeps it — add motion
  only (`${TRANSITION} ${PRESS}`), don't re-add the ring. ★★ Do NOT override a BESPOKE SEMANTIC focus ring
  (invalid-state `AIPM-pink`, consent `AIPM-purple`, critical-path toggle) with the green `FOCUS_RING` — leave
  those, add motion only. ★ Weak legacy `focus:ring-1 focus:ring-AIPM-green` fragments are normalized to the
  `ring-2` standard. The shared report/table primitives (`Tile`/`SortHeaderButton`/`TableFilter` in
  `report-table.tsx`, `task-manager-ui.tsx` tabs/reset/print/sort) already carry the atoms.
- **Empty + loading primitives:** `empty-state.tsx` `EmptyState` (presentational; `title`/`description`/
  `actions[]` props, i18n done by caller; CTA buttons carry `INTERACTIVE`; `compact` for inline card slots) —
  use it instead of a bare `<p>no data</p>` for true "no rows" messages (NOT `<td>`-cell or dashed-`<div>`
  card empties; the swap still renders the title text so `getByText` tests survive). `skeleton.tsx`
  `Skeleton` (decorative `animate-pulse` `bg-surface-muted` block, `aria-hidden`) + `PanelSkeleton`
  (full-pane loading placeholder over `VIEW_PANE_FILL_CLASS`). ★★ `PanelSkeleton` `lang` is OPTIONAL: WITH
  lang → `role="status"`+`aria-live` + sr-only translated label; WITHOUT → purely decorative `aria-hidden`
  shimmer (no announcement, but no worse than blank). `workspace-panels.tsx` wires the prop-less decorative
  variant as the `loading` fallback on all 20 lazy `dynamic()` view panels (so all are full-pane — don't wire
  it into a non-full-pane lazy mount). New i18n key `loading` (EN/DE).
- **Bulk edit (entity panels):** generic multi-row bulk edit shared across
  RAID/Milestones/Changes/Stakeholders. Pure `row-selection.ts` (set ops) +
  `use-row-selection.ts` (Set<number> selection, filter-aware select-all);
  `bulk-edit-bar.tsx` ("N selected" + toggle + clear); `bulk-edit-panel.tsx`
  (generic per-field enable-checkbox panel driven by a `BulkField[]` descriptor +
  `selectField`/`dateField`/`textField` builders; Apply emits ONLY ticked fields;
  entity logic stays in the caller's `onApply`). Each panel adds a checkbox column
  (row-unique `selectItem` labels + `selectAllVisibleRows`), the bar, and the
  panel; bump the empty/no-match/add-row `colSpan` by 1. No new persisted field —
  patches ride the existing single-item save path via `sanitizeX`.
  ★★ FUNCTIONAL-SETTER LANDMINE: bulk `applyBulk` LOOPS the single-item save handler
  N times in ONE tick. A handler that does `setX(<value from closure>)`
  (non-functional) makes every call read the SAME stale array → last write wins →
  all but one row silently dropped. EVERY entity save handler MUST use
  `setX(prev => …)`. Bit RAID/Changes/Stakeholders (Milestones was already
  functional); single-row tests + a mocked `onSave` hid it — regression-tested with
  a per-hook "N saves in one tick" test. ★ RAID Status is OMITTED from bulk
  (category-specific; `sanitizeRaidItem` silently defaults a mismatch).
- **`useResizable(storageKey)` inline-size beats class width:** the hook writes a saved `{width,height}` as
  an INLINE style, which OVERRIDES class `w-full`/width. Changing a resizable pane's DEFAULT size silently
  no-ops for anyone with a persisted size — BUMP the storageKey (e.g. `…-size` → `…-size-full`) so the stale
  size is discarded (pane stays resizable from the new baseline). Bit Milestones/Documents going full-width.
- **Rounded table headers:** `TABLE_HEAD_CLASS` carries a `.lop-thead` marker; the Dark-Blue fill lives on
  `<th>` (NOT `<thead>`) via `globals.css` so rounded first/last corners clip it, with `border-spacing:0`.
  Don't move bg back to `<thead>` — a rounded `th` only clips a fill it paints.
- **Heavy browser-only deps** (rich-text editor, etc.) load via `next/dynamic({ ssr: false })` to stay off
  the main bundle; ProseMirror/Tiptap-style libs need `Range.getClientRects` + `getBoundingClientRect` jsdom
  stubs in tests. jsdom has NO layout engine — `scrollHeight`/`offsetHeight`/`getBoundingClientRect` all
  return 0, so measure-based UI (textarea autogrow, resize) must stub `scrollHeight` in its test
  (`Object.defineProperty(el, "scrollHeight", { configurable: true, value: N })`) — pixel-height assertion
  silently reads 0 otherwise.
- **M365 Graph** called client-side via `useMsAuth().acquireToken(scopes, { interactive })` —
  `interactive:true` pops an incremental-consent dialog for a new scope; background probes stay silent. New
  Graph host must be added to the CSP allowlist (above).

### AI Assistant

- **Wire layer:** `chat-panel.tsx` is the React surface; the non-React WIRE LAYER (Anthropic protocol types
  `TextBlock`/`ContentBlock`/`SystemBlock`/`ApiMessage`/`DisplayItem`, `callClaude`, `buildSystemPrompt`,
  `systemBlocksText`, `readAttachmentData`, `stringifyResult`) lives in pure i18n-free `chat-api.ts` — import
  from there, NOT chat-panel. Calls Anthropic directly (browser,
  `anthropic-dangerous-direct-browser-access`). `buildSystemPrompt` returns `SystemBlock[]`, NOT a string.
  ★★ Anthropic prompt caching is PREFIX-based: stable/cacheable content (instructions + operating-guide text)
  MUST come FIRST with `cache_control:{type:"ephemeral"}` breakpoint after it, and volatile data (today, task
  count, current view/mode) MUST come AFTER — mixing volatile data into the cached block (or putting the big
  guide block last) means the cache never hits. Operating guides live in a global store (`operating_guides`,
  out of TABLE_NAMES) surfaced by ONE `useOperatingGuides` instance in task-manager, threaded to both
  ChatPanel (chat) and AiSection (editor).
- **App-feature guide:** view-scoped built-in operating guides that teach the assistant the APP's features
  (so it answers "how do I …?"). Source `lib/app-feature-guide.md` = `## Overview` (no marker → always-on) +
  per-view `## Title` each followed by `<!-- views: <AppView ids> -->`, each ending with a truthful `AI:` line
  (what it can/can't do via TOOLS — don't over-claim). `scripts/gen-operating-guide.mjs`
  `parseFeatureGuide(md, VALID_VIEWS)` (exported, pure) → emits `BUILTIN_FEATURE_GUIDES` (`builtin-app-overview`
  scope {} + `builtin-feature-<view>` scope {views:[…]}) into `operating-guide-builtin.generated.ts`. ★★ the
  generator's `writeFileSync` is inside `if (isMain)` — so a vitest `import { parseFeatureGuide }` does NOT
  rewrite the generated file (don't move the write to top level). Prebuild regenerates; the
  `operating-guide-builtin.test.ts` sync-guard re-parses the md + `toEqual`s the committed array (drift fails
  CI; keep the test's `VALID_VIEWS` == the generator's, == nav-config `AppView`). ★ Adding a section: TAG it
  (`<!-- views: … -->`) with REAL AppView ids — `parseFeatureGuide` THROWS on an unknown id AND on an untagged
  non-Overview section. Seeded by `use-operating-guides` `builtinSeeds()`/`reconcileBuiltins()`: on every load
  it refreshes built-in content/name/scope but PRESERVES the user's `enabled`/`priority` (no toggle-clobber on
  upgrade); all built-ins undeletable via `BUILTIN_IDS`. `selectActiveGuides` loads overview + the current
  view's guide into the cached prompt prefix (view change re-caches that slice). Guide content is
  ENGLISH-ONLY (no i18n). Knowledge only — adds NO new AI tools.
- **AI write tools:** tool SCHEMAS (`TOOL_DEFS` + per-entity field-property helpers `taskFields`/`raidFields`/…
  + `ALL_RAID_STATUSES`) live in pure `chat-tool-defs.ts`; `chat-tools.ts` re-exports `TOOL_DEFS` (so
  `chat-api` imports it unchanged) and holds `runTool` routing + the `ToolDispatcher` type + arg-coercion/
  summary helpers; tools are IMPLEMENTED in `use-chat-dispatcher.ts`. Tasks/RAID/Changes/Milestones/
  Stakeholders all have create/update/delete. NEW entity write tool: add tool def (in `chat-tool-defs.ts`) +
  runTool case + `ToolDispatcher` method, then implement in the dispatcher `useMemo` — guard
  `if (args.isReadOnly) throw readOnlyError()` FIRST (popouts must not mutate), build the raw object and run
  it through the entity's `sanitizeX` (the SINGLE validator — `sanitizeRaidItem` enforces enums/dates/caps +
  per-category RAID-status defaulting), id = `nextEntityId(ref.current)` (max+1), then update BOTH the ref AND
  call `setX` (ref keeps back-to-back tool calls consistent). `runTool` write cases use
  `requireId`/`patchWithoutId` (strips `id` from the update patch — a destructured `_id` would trip the
  no-unused-vars rule).
- **AI doc ingestion / multimodal:** `chat-panel.tsx`'s `ContentBlock` union includes `AttachmentBlock`
  (image/document) from pure `chat-attachments.ts` (classify by mime+extension, 20 MB cap, build the Anthropic
  block — PDF/image as base64 `source`, text as `{type:"text"}` document source; NO parsing lib, Claude reads
  natively). The `FileReader` (readAsDataURL for binary, readAsText for text) lives in chat-panel (module
  stays pure). A user turn with attachments sends `content` as `ContentBlock[]` (text block first, then
  attachments) not a string. CSP already allows `api.anthropic.com`. Chat view is NOT in axe `A11Y_VIEWS` —
  verify chat controls by eye.
- **AI project creation:** Step 0 "Describe" in `CreateProjectWizard` (gated on a configured key) → ONE
  forced-tool Anthropic call (`tool_choice:{type:"tool",name:"propose_project"}`, no agentic loop) in
  `use-project-proposal.ts`; pure contract/transforms in `ai-project-proposal.ts`. The proposal pre-fills the
  form as a `Partial<ProjectFormDraft>` patch (`initialDraftPatch`), NOT a `ProjectMeta` —
  `sanitizeProjectMeta`/`draftFromMeta` need many fields + present arrays Claude can't infer (a sparse meta
  throws). Seed records run through each `sanitizeX` (temp id BEFORE sanitize) → `appendSeed`/`remapSeed`; no
  new Workspace field. Model-supplied URLs gated by `isSafeHttpUrl`. Empty-state offers "Configure AI
  assistant" (`BackendConfigModal` `children` + `AiSection hideUsage`).
- **Create project from source:** the create wizard's Step 0 (extracted to `step0-import-panel.tsx`) adds
  Upload-file / SharePoint / Confluence-URL import alongside Describe; all funnel into
  `useProjectProposal().generate(...)` — widened to `string | ContentBlock[]` (multimodal: PDF/image read
  natively via `chat-attachments`, NO parsing lib). File: 20 MB cap + `classifyAttachment` reused. SharePoint:
  `SharePointPickerModal` → `fetchSharePointFileContent` via Graph `/shares/{u!base64(url)}/driveItem/content`
  (reuses `PICKER_SCOPES`, no extra consent). ★★ Confluence: `src/app/api/confluence/page/route.ts` MUST REUSE
  `api/jira/_helpers` (`parseJiraRequest`/`callJira`/`forwardJsonResponse`) — NEVER a raw `fetch` (that
  bypasses the SSRF allowlist to `*.atlassian.net` + Basic auth + timeout). Confluence is the SAME Atlassian
  host, just the `/wiki/rest/api/content/{id}?expand=body.view` path; validate `pageId` with `/^\d+$/`
  SERVER-SIDE before building the path (path-injection guard). Browser→`/api/confluence` is same-origin (no
  CSP host needed). ★ Gating: file+describe always, SharePoint on `isSharePointEnabled`, Confluence on FULL
  Jira config (`enabled&&siteUrl&&apiToken&&email`). ★ Error boundary: SOURCE failures → sanitized
  `importError`; the Anthropic `generate` failure → the hook's `aiError` (kept separate). No key/token/body
  ever logged or rendered.
- **AI Action Center suggestions:** Action Center "Analyze with AI" → ONE forced-tool call
  (`tool_choice:{type:"tool",name:"report_analysis"}`, no loop) in `use-action-analysis.ts`; pure contract/
  transforms in `action-ai.ts` (`parseAnalysis` validates untrusted model output; `groundEntity` RE-VALIDATES
  model entity ids against the live workspace before any `requestOpen` deep-link — hallucinated id → fall back
  to `requestChat`). ADVISORY only (no write tool; deterministic `next-actions/` engine untouched; no new
  Workspace field). Hook lives in `task-manager.tsx` ABOVE the view so the in-memory result survives view
  remounts; bundle is `isPopout ? undefined`. Gated on key + `ai.actionSuggestions !== false` (default ON).
  Rendered above the now/soon/monitor tiers; AI rows use a separate `ai-action-row.tsx` (NOT `ActionRow`).
- **AI scheduled jobs:** opt-in recurring portfolio-analysis. Pure i18n-free `scheduled-jobs/` engine
  (`isDue`/`nextRunAt`/`dueJobs`/`appendRun`; `now` ALWAYS passed in — no `Date.now()`/`new Date()` inside).
  Global `scheduled_jobs` store (JSON-blob row, Turso-gated + localStorage fallback) OUT of `TABLE_NAMES`.
  Runner `use-scheduled-job-runner.ts` lives in `task-manager` ABOVE the view; runs DUE jobs on
  mount/visibility/5-min-tick, SERIAL + overlap-guarded; fail-once-per-slot (a failed run still advances
  `lastRunAt` — avoids re-spamming a BILLED call). The call is the NON-hook `runJobAnalysis`
  (`scheduled-job-analysis.ts`) so the runner loops it; `use-action-analysis` delegates. ADVISORY only; never
  in popouts. Gated on key + `ai.scheduledJobs === true` (default OFF / opt-in — UNLIKE
  `actionSuggestions`'s `!== false`).
- **AI weight suggestions:** "Suggest with AI" in the next-actions settings → ONE forced-tool call
  (`suggest_weights`, forced, NO loop) in `weight-suggestion-call.ts` (mirrors `scheduled-job-analysis.ts`
  security EXACTLY — never logs/echoes apiKey or body; thrown errors carry only HTTP-status digits or
  `"parse"`). Pure contract `next-actions-tuning.ts` + `weight-suggestion-ai.ts`; hook
  `use-weight-suggestions.ts`. ★★ EVERY model-proposed value reaching `settings.nextActions` MUST pass
  `parseWeightSuggestions` → `NEXT_ACTIONS_FIELD_COERCE[field]` — the SAME per-field validators
  `resolveNextActionsConfig` uses (hoisted to a shared exported map in `settings-types.ts`; a
  hallucinated/out-of-bounds value can never land). Accept writes via the settings setter (→ `writeSettings`),
  never raw setItem. Targets the 3 confidence weights by default; opt-in
  `ai.suggestAllNextActionThresholds` (default OFF) widens to all 10. Learning history +
  `summarizeTrendsForPrompt(actionTrends)` = INPUTS; ephemeral result; popout read-only. ★ A pure rationale
  sanitizer regex is the SHARED `CONTROL_CHARS = /[\x00-\x1f]/g` (use `\x` HEX escapes — never type literal
  control bytes; they corrupt the file to binary).
- **No `settings.mode` field:** PM mode is DERIVED — `deriveMode(settings.features)` (same call the chat
  snapshot uses in `use-chat-dispatcher.ts`). Reading `settings.mode` is `undefined`; use `deriveMode`.

### Steering committee

Opt-in per-project `Workspace.steeringCommittee` (`{name, memberResourceIds[], meetings[], infoSchedules[],
infoReminderEventIds?, pendingDeleteEventIds?}`; pure validator `sanitizeSteeringCommittee` — never throws,
bad dates dropped, leadDays>=0, ids deduped). Nav view `steering-committee` → `steering-committee-panel.tsx`,
mounted ONCE in `workspace-section.tsx` (covers BOTH shells); the Push-to-Outlook button lives IN the panel so
no top-bar control. NOT in axe `A11Y_VIEWS` → eye-verify row-unique labels (`${edit} – ${meeting.title}`).
★★ Persists as a JSON BLOB, NOT a row table: CSV `# STEERING COMMITTEE` (`config,<json>` row) + MD `## Steering
Committee` (fenced JSON) + Turso `meta` row `steering_committee` (REUSES the `meta` singleton — NOT a new
`TABLE_NAMES` entry) + JSON + IDB KV slot. Storage-ONLY (gated `config===undefined`, like
fieldVisibility/features — EXCLUDED from user exports); committee-less ws stays BYTE-STABLE. ★ Adding a FIELD
to the nested object costs ZERO extra write paths (rides the blob) — only extend `sanitizeSteeringCommittee`.
★★ Adding to the `ActionSource` / `AppView` unions surfaced FOUR exhaustive `Record<>` maps tsc forced
extending (`action-source-label`, `action-source-icon`, `nav-icons` ICON_PATHS, `nav-config`
LABEL_KEYS/`navLabelKey`) — "Map-based, no break" was WRONG; grep the union members.
Pure engines: `steering-reminders.ts` (`dueInfoReminders` — working-day lead, `today` passed in, no
`Date.now()`) + `committee-calendar-reconcile.ts` (`planCommitteeReconcile` is ID-TRACKED: derives
create/update/delete from the committee's OWN stored ids, NO `listProjectEvents`). Provider
`next-actions/providers/committee-info.ts`: ★ optional `ActionInput.steeringCommittee` MUST be populated in
task-manager's `buildActionInput` or the provider silently returns [] live. ★ Outlook push
`use-committee-outlook-push.ts` (mirrors milestone push; `Calendars.ReadWrite`, popout no-op, M365-gated,
status-only logs — never token/body): meeting events keyed 1:1 on `meeting.outlookEventId`, info-instances in
`infoReminderEventIds["<meetingId>:<scheduleId>"]`. ★★ A deleted meeting loses its `outlookEventId` (stored on
the meeting obj, not a map) → the panel stashes it in `pendingDeleteEventIds` for the next push to delete +
clear (info-instances ARE map-tracked so they prune automatically). ★★ `outlook-calendar-write.ts` `graph()`
tolerates 404 ONLY for DELETE; PATCH/POST THROW `GraphCalendarError(404)` so an event deleted in Outlook gets
re-created next push (committee + milestone hooks self-heal by clearing the stale id).

### Guided tour + demo

MODERN-shell-only onboarding (never classic/popout). Pure i18n-free `app-tour.ts` (`TOUR_STEPS` ~12 keys-only,
`visibleSteps(features)` drops steps whose `view` is a disabled module via `isViewEnabled`, `clampStep`).
`tour-overlay.tsx` = controlled component: centered modal OR anchored "spotlight" over a `[data-tour-id]`
element — ★ a MISSING anchor (gated/unmounted view) FALLS BACK to a centered modal (never points at nothing);
role=dialog/aria-modal/Escape-skips/focus. `use-tour.ts` (in task-manager, above the view): open/index +
per-device `settings.tourSeen` (written via `setSettings`→`writeSettings`, which spreads the whole object so a
new flag persists with NO allowlist edit) + ★ RENDER-TIME auto-launch (`if (eligible && !autoHandled) {
setAutoHandled(true); setIsOpen(true) }` during render — NOT a useEffect; set-state-in-effect is banned) gated
`hydrated && layout==="modern" && !isPopout && !tourSeen`. Overlay mounted ONCE in the modern tree; Help "Take
the tour" re-launch via `HelpMenu onTakeTour` (threaded through `ActionMenus`, passed only when modern &&
!popout). 4 `data-tour-id` anchors: sidebar tasks/actions (`NAV_TOUR_ID` map in `sidebar-nav.tsx`), Ask-Claude
`<span>` wrapper, project-switcher container.
★★★ **DEMO CTA MUST REGISTER A PROJECT, not just apply data.** The empty-state "Explore a demo project" loads
`sample-workspace-small.json` (lazy `import("../../sample-workspace-small.json")`; `resolveJsonModule` on). It
MUST go through `createDemoProject(ws)` (a `useStorageBackend` method) which REGISTERS a real project
(`addProject`+`commitRegistry`), because the empty-state gate is `showEmptyState =
registry.projects.length===0` (file mode) — an apply-only path (`applyRestoredWorkspace`+`startTour`) leaves
the registry empty so `showEmptyState`
stays TRUE → `modernTree` (which holds BOTH the views AND `TourOverlay`) never mounts → demo invisible + tour
never renders. Applying workspace data != showing it. `createDemoProject` uses the `browser`/IndexedDB backend
kind (NO file picker) + derives meta from `ws.project`. ★ Turso portfolio mode: a local demo can't flip the
turso-branch empty-state gate (it reads the Turso project LIST), so it persists
registry+settings+`savePortfolioMode("file")` and `window.location.reload()`s (mirrors `loadProjectFromFile`'s
switchPortfolioToFileOnSuccess) — ALL durable writes BEFORE the reload, SKIP the in-place
`applyWorkspace`/`setStorageConfig` (the reload discards them; avoids a mount-then-teardown flash); after
reload `tourSeen` is unset so auto-launch re-fires the tour. Demo CTA is empty-state-only; the demo is a normal
deletable project (non-destructive to any Turso DB). Tour view NOT in axe `A11Y_VIEWS` (eye-verified);
spotlight positioning eye-verified (jsdom rect=0).

### Timezones

Pure i18n-free `timezone.ts` (Intl only, NO dep): `todayInZone(now,tz)` (uses
`Intl.DateTimeFormat("en-CA").formatToParts` — date-line + DST correct, NOT offset math), `formatInZone`,
`isValidTimeZone`, `browserTimeZone()` (env read — a FUNCTION not a module const, SSR/test-safe), `tzZones()`
(shared picker list, guarded `Intl.supportedValuesOf` → `[browserTimeZone(), "UTC"]` fallback),
`resolveTimezone(overrideTz, projectTz)` = override ?? project ?? browser (each validity-gated, always returns
a valid zone).
- **Model + logic (TZ-1):** ★★ the effective tz = `resolveTimezone(settings.timezone,
  project?.operatingTimezone)` and the app's central `today` derives in it — `task-manager` `todayISO()` →
  `effectiveToday(tz)` = `todayInZone(new Date(), tz)` (a MODULE fn so `new Date()` isn't in a render body),
  so overdue/next-actions/reminders/due-date logic follow the zone. Secondary derivations:
  `use-resource-planner` takes `today` as a PARAM (fed the effective today); `use-bulk-operations` resolves tz
  in a callback. ★ The ~30 OTHER `new Date().toISOString().slice(0,10)` sites (export/codec/backend stamps,
  plan-start defaults, gantt/calendar DISPLAY) STAY UTC by design — none compares a UTC-today against the
  zone-today (verified: no off-by-one). ★★ `operatingTimezone` lives on `ProjectMeta`, NOT a top-level
  Workspace field — it rides the existing project-meta serialization via the single `PROJECT_CSV_COLUMNS` list
  (drives CSV cols + MD `projectFieldToString` generic arm + Turso TENANT DDL/insert), mirroring `jiraUrl`
  EXACTLY; add the column there + the decoder + `sanitizeProjectMeta` (validate via `isValidTimeZone`) +
  regenerate golden fixtures (the sample's project meta is SYNTHESIZED in `generate-sample-workspace.ts`, not
  the `.md`). ★ Adding ANY `ProjectMeta` key forces an `export-sections.ts` `PROJECT_FIELD_I18N_KEYS`
  exhaustive-`Record` entry + its i18n key (tsc-forced). ★ Turso SINGLE schema doesn't persist `ws.project`
  (tenant projects row via portfolio upsert); `turso-migrate` ALTER-adds the column. Per-device
  `settings.timezone?` (override; undefined = follow project/browser) + `additionalTimezones?`; persist via
  `writeSettings` (spreads, no allowlist edit). Settings picker:
  `settings-sections/timezone-settings-section.tsx` ("System default" value `""` → override undefined;
  row-unique remove labels — Settings/General is axe-scanned). Project form: operating-tz `<select>` (blank →
  undefined).
- **Display routing (TZ-2):** renders INSTANT timestamps in a session display zone over the TZ-1 effective
  zone. ★ DISPLAY-ONLY + EPHEMERAL: `display-timezone-context.tsx` holds an in-memory `override` (useState,
  NEVER persisted — resets on reload); `displayTz = override ?? effectiveTz`. `useDisplayTimezone()` →
  `{displayTz, effectiveTz, isOverridden, setDisplayOverride, resetDisplayTz}`. Shared formatter
  `tz-display.ts` `formatDisplayTimestamp(iso, tz, lang, {withSeconds?})` wraps `formatInZone` with
  `timeZoneName:"short"` — the ACTIVITY LOG passes `{withSeconds:true}`, history/trends use minute precision.
  ★★ ONLY instant-timestamp DISPLAYS convert (`activity-log-panel`, `history-panel` capturedAt labels,
  `trends-panel` capturedAt cell) — every `capturedAt` used as a SORT/dedup/column-width/row-SELECTION key
  STAYS on raw ISO (converting a shared display+key value is an ordering bug). Date-only fields, the gantt
  month-axis, and storage/export `toISOString` stamps are untouched. ★★ Switcher `display-tz-switcher.tsx`
  wired into BOTH headers (modern `topBarMenus` + classic `AppHeader` via the `trailing?` prop — AppHeader
  builds Ask-Claude internally so it had no element slot); NOT in popouts. The `DisplayTimezoneProvider` wraps
  BOTH task-manager return branches (popout + main) with `effectiveTz`, so popout timestamps convert to the
  effective DEFAULT. Options: Default(`value=""`→clears override) + UTC + `settings.additionalTimezones`
  (extras filtered to drop UTC/effective dups). `DisplayTzSwitcherConnected` is a MODULE-LEVEL wrapper;
  switcher `<select>` carries `aria-label` (top bar axe-scanned every view).
- **Calendar multi-tz (TZ-3):** a live multi-zone "world clock" strip atop the Calendar view. Pure
  `tz-clock.ts` `formatZoneClock(iso,tz,lang)` (wraps `formatInZone`; time + SHORT DATE so the date-line
  rollover shows). `tz-clock-strip.tsx`: live `now` via a LAZY `useState(() => new Date())` + a `useEffect`
  `setInterval(…,60_000)` cleared on unmount (NOT a render-body `new Date()`); renders the default zone + each
  additional zone; `role="region"` + `aria-label`; ★ DEDUPES the default out of the list (`[defaultTz,
  ...zones.filter(z => z !== defaultTz)]`) to avoid a double chip + duplicate React key. Wired in
  `workspace-section.tsx` ONLY when `activeTab==="calendar"` && `settings.additionalTimezones` non-empty;
  default = `resolveTimezone(settings.timezone, project?.operatingTimezone)` (the EFFECTIVE zone, NOT the TZ-2
  display override). Date-grid cells/logic untouched (the grid is date-only). Calendar is NOT in axe
  `A11Y_VIEWS` (eye-verified). ★ The TZ-1 settings editor also excludes the resolved default (`settings.timezone
  || browserTimeZone()`) from the add-additional list.

### Saved views

- **Tasks:** pure i18n-free `saved-views.ts` (per-device `lop-app:saved-views`, `MAX_SAVED_VIEWS=30`,
  `id=max+1`, validated load, oldest dropped at cap; `SavedViewPayload` = useFilters fields + sortKey/sortDir +
  `hiddenCols[]`, EXCLUDES colWidths/hideFinishedTasks/tasksViewMode/raidFilterTaskId). Hook `use-saved-views.ts`
  (functional-updater mutators + a `useEffect([views])` persist — no stale closure). `saved-views-control.tsx`
  in the tasks toolbar applies a view through every `useFilters` setter (+`setRaidFilterTaskId(null)`,
  `setHiddenCols(new Set(...))`); single labeled controls (select+save+delete) → no row-unique-label landmine;
  Open Points IS axe-scanned. ★ GLOBAL presets (not per-project) → applying one whose assignee/group isn't in
  the current project just yields an empty filter (graceful). OUT of exports/Turso, cleared by `clearAppConfig`.
  ★ The control renders in BOTH table and board modes (its filters+sort apply to the board too; the preset's
  hiddenCols are dormant in board and take visible effect on return to table).
- **Cross-view (RAID/Milestones/Changes/Stakeholders):** a SEPARATE generic stack — tasks' bespoke
  `saved-views.ts`/`filters-context`/`saved-views-control.tsx` path is UNCHANGED. Pure i18n-free
  `panel-views.ts` (per-device `lop-app:panel-views` — a DIFFERENT key from tasks' `lop-app:saved-views`;
  view-tagged entries `{id,name,view,state}`, `MAX_PANEL_VIEWS=30` PER view, `id=max+1` across the whole list,
  validated load). Generic `panel-filters-context.tsx` (`PanelFiltersProvider`/`usePanelFilters`) holds
  `{search, filters:Record<string,string>, sort:{key,dir}|null}` + setters/`applyState`/`reset`; seeded
  per-panel with `*_FILTER_DEFAULTS`. Hook `use-panel-views.ts` (`usePanelViews(view)`). `panel-views-control.tsx`
  reuses the existing `savedViews*` i18n keys (no new control strings). ★★ Each panel SPLIT into an outer
  wrapper rendering `<PanelFiltersProvider defaults={…}><XPanelBody/></…>` (body consumes the context instead
  of local `useState`); provider lifetime = panel mount, so filter-reset-on-unmount is unchanged. ★
  `pf.filters.X`/`pf.sort` are typed loosely (`Record<string,string>`, `sort.key:string`) — panels CAST to
  their own union (`sort.key as RaidSortKey`, `filters.category as RaidCategory`) at the `compareX`/derive call
  sites; HOIST each `pf.filters.X` to a scalar local before a `useMemo` dep array (exhaustive-deps bans
  `obj.member` deps). ★ RAID passes `onApply={() => onClearTaskFilter?.()}` so applying a preset drops the
  transient task backlink (mirrors tasks clearing `raidFilterTaskId`). ★ Milestones' sort is never null
  (default `{date,asc}`); its wrapper casts `dir as "asc"|"desc"` for `useSortableFilter` (report-table
  `SortDir` includes `"off"`, which the setter never emits). Column widths/pane size still persist separately
  (`useColumnResize`/`useResizable`). RAID + Milestones ARE axe-scanned; Changes/Stakeholders eye-verified. OUT
  of exports/Turso, cleared by `clearAppConfig`.
- **Reports:** dedicated bespoke store `reports-views.ts` (per-device `lop-app:reports-views`,
  `MAX_REPORTS_VIEWS=30`, `id=max+1`, validated load, oldest dropped at cap) — Reports' 3 tables
  (byAssignee/byGroup/byLabel) each carry `{filter, sort:{key,dir}|null}`, which the generic
  `PanelFiltersState` ({search,filters,sort}) can't hold, so this is SEPARATE from BOTH the tasks bespoke path
  AND the `panel-views.ts` generic stack. `useReportsViews` + props-based `reports-views-control.tsx` (NO
  context — `ReportsPanel` already centralizes the six sort/filter `useState`; the control takes
  `currentState`+`onApply`, instantiates the hook itself). Sort `dir` uses report-table's SortDir SUPERSET
  incl `"off"` (the Milestones landmine — a narrower union silently drops the view on reload). Apply guards
  each `sort` non-null and casts `key:string`→the table's key union (`as AssigneeSort`/`as GroupOrLabelSort`).
  Column widths/pane size persist separately. OUT of exports/Turso, cleared by `clearAppConfig`. Reports IS
  axe-scanned (single labeled controls).

### Installable PWA

`public/manifest.webmanifest` + `public/sw.js` (static, NOT bundled → can't `import` TS modules) registered
from a CLIENT component (`service-worker-registrar.tsx`) — an inline `<script>` can't carry proxy.ts's
per-request CSP nonce. SW does NO caching / NO fetch handler (hashed bundles → precache would serve stale JS).
CSP needs explicit `worker-src 'self'` in `src/proxy.ts`: `script-src 'strict-dynamic'` makes browsers IGNORE
`'self'` for the SW load → without `worker-src` registration is blocked at RUNTIME (not caught by
tests/build). Periodic Background Sync deliberately NOT built (Chromium+installed+device-seal only; baseline
covers on open).
