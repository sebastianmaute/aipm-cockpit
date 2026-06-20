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
                            # `npx tsc --noEmit` after editing ANY test.
npm run test:run            # vitest (unit/integration)
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
  `*_CSV_COLUMNS` (covers CSV **and** Turso single+tenant — DDL/insert derive from it), plus
  markdown codec + `sanitize.ts`; REGENERATE `__fixtures__/golden-*` (legit new-column format change)
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
- **Secrets at rest:** Anthropic `apiKey` + Turso `authToken` ENCRYPTED via `secrets.ts`
  (AES-256-GCM; non-extractable device key in IndexedDB by default, optional per-secret PBKDF2
  passphrase). `writeSettings` is ONLY writer of `localStorage["lop-app:settings"]` and BLANKS
  both fields — settings persist EFFECT must call `writeSettings`, NEVER raw `setItem` (raw
  write dumps decrypted in-memory key/token to disk on every settings change — real CRITICAL
  we shipped and caught). Secrets hydrated into memory on load (`hydrateSecretsInto`);
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

- **Orientation / key files:** `task-manager.tsx` is the root orchestrator (owns layout, top bar,
  view routing, and threads workspace + AI hooks down). `storage.ts` = backend facade;
  `workspace-context.tsx` = live workspace state + setters; `types.ts` = all entity shapes + enum
  consts; `sanitize.ts` = the single per-entity validators; `i18n.ts`/`i18n.de.ts` = EN/DE strings;
  `nav-config.ts` = `AppView` list + nav labels. Pure engines live in i18n-free subdirs
  (e.g. `next-actions/`).
- `src/app/` is flat, organized by feature. Pure domain logic lives in i18n-free modules/subdirs
  (e.g. `next-actions/`, serializers); React surfaces import them. Keep engines i18n-free —
  surface translates.
  Before creating `<name>.ts`, check for existing `<name>.tsx` (and vice versa) — a bare
  `./<name>` import resolves `.ts` AHEAD of `.tsx`, so new pure `foo.ts` silently hijacks existing
  `foo.tsx` component import and breaks its tests. Name pure module distinctly
  (e.g. `action-notifications.ts` beside `notifications.tsx` component).
- Storage is a facade (`storage.ts`) over multiple backends: JSON file, CSV, Markdown, Turso
  (single + multi-tenant), IndexedDB. Snapshots/Trends + version history are Turso-ONLY.
- Sample data tiered: `sample-workspace-small.*` is curated source; `-big` (3×) and
  `-huge` (10×) JSON+SQLite GENERATED via pure `scaleWorkspace(ws, factor)` (id-offset
  `k*100000` + full FK remap; reference data — resources/roles/disciplines/grades — NOT
  replicated; replicas get distinct stakeholder names + workstream-qualified titles, not "(2)").
  Don't hand-edit `-big`/`-huge`; regenerate from `-small`.
  MASTER is `sample-workspace-small.md` — `scripts/generate-sample-workspace.ts` PARSES it and
  EMITS `.json` + `.sqlite3` + `-big`/`-huge` (regen: `npx vite-node scripts/generate-sample-
  workspace.ts`, then regenerate `__fixtures__/golden-*` via serializers). `project` meta +
  `status` SYNTHESIZED IN GEN SCRIPT (not in .md). `sample-workspace-small.csv` is
  SEPARATE hand-curated artifact (parsed by sample tests). MD table cells with internal `|` are
  `\|`-escaped and CSV has MULTI-LINE quoted fields → NEVER naive-split a row: edit .md by
  exact full-line replace, edit .csv via app codec (`csvToWorkspace`→patch→`workspaceToCsv`,
  verified data-safe round-trip).
- Action-Center CTAs surface-only: thread optional handler
  task-manager → workspace-section → ActionsPanel → ActionRow (ActionsPanel renders in
  workspace-section, not task-manager, and renders TWO ActionRow lists — tier + monitor — so new
  CTA prop must thread to BOTH); `next-actions/` engine stays pure.
- Shell renders top bar in TWO independent places, both built in `task-manager.tsx`: classic
  `AppHeader` (`appHeaderEl`, used by classic main-window `legacyTree`) and modern
  `ModernShell` `topBarMenus` slot (DEFAULT layout). New top-bar control must wire into
  BOTH or invisible in whichever layout you forgot (modern default is easy miss). Popout
  `legacyTree` branch (`isPopout ? …`) renders NO header, so header controls correctly never
  appear in popouts.
- **Remount-swallow (parent request/nonce → conditionally-mounted child):** modern shell renders
  ONLY the active view; workspace-section renders ONLY the active tabpanel — so a view MOUNTS FRESH
  each visit. A child consuming a parent "request"/nonce prop must NOT seed its last-seen/handled
  ref from the LIVE prop (`useRef(prop)`/`useState(prop)`) — a fresh mount sees prop===seed and
  silently SWALLOWS a pending request. Seed `undefined`/sentinel + guard `!== undefined`; parent must
  CLEAR (consume) or monotonically bump the nonce so re-mounts don't re-fire stale. Bit settings-view
  learning deep-link AND milestones-panel `openCreateNonce` (Gantt "Add milestone").
- Task editor has TWO surfaces: modern DEFAULT uses full-page `TaskEditView` (ModernShell `editView`
  slot; `useEditView = layout==="modern" && !isPopout`); classic/popout use `TaskFormModal` (which
  already has `ModalHeader` title+✕). New editor controls/heading wire into the surface in play —
  TaskEditView's control bar is SEPARATE from the modal's header.
- **Task status model (SP-A, v0.107.0):** `Task.status` (To Do/In Progress/On Hold/In Review/
  Cancelled/Done) is the SOURCE OF TRUTH for "done", but `completedDate` is AUTO-MANAGED to keep
  the invariant **`status==="Done" ⟺ completedDate set`** — so the ~30 existing completedDate-based
  derivations were left untouched. Pure i18n-free engine `task-status.ts` owns it:
  `applyStatusChange(task,next,today)` is the SOLE writer of status+completedDate — EVERY status
  mutation (form save create+update in `use-task-submit`, inline dropdown + `onToggleComplete` in
  `use-task-row-handlers`, AI/Jira/template seeds) routes through it; `migrateTaskStatus` runs on
  ALL SIX load paths (completedDate set → Done, else To Do). `isTaskFinished`=Done|Cancelled;
  Cancelled is terminal-but-NOT-completed (excluded from overdue/next-actions/health-red, but
  completion-% still counts Done only). UI labels via `task-status-ui.ts` (AIPM palette tokens only).
  ★ The table status column key is **`taskStatus`** — the pre-existing `"status"` col key is the
  RAG/health DOT (its header is "Health"/DE "Ampel"). ★ The tasks view ("Open Points") IS in the
  axe `A11Y_VIEWS`, so the inline status `<select>` needs a row-UNIQUE label (`Status – <task>`).
- **Kanban board (SP-B, v0.108.0):** tasks pane has a Table/Board toggle (per-device
  `settings.tasksViewMode`). Board component is **`task-kanban-board.tsx`** — NOT
  `task-kanban.tsx` (the pure `task-kanban.ts` engine shadows a `.tsx` sibling via
  `.ts`-before-`.tsx` resolution). Native HTML5 DnD (no lib); the per-card status `<select>`
  (shared `TaskStatusSelect`, also used by the table row) is the keyboard path. ★★ The board
  renders OUTSIDE `RowContextProvider` (which wraps only the table body) — so ANY component a
  Kanban card renders must take what it needs as PROPS, never `useTaskRowContext()` (that THROWS
  → board crashes on RAID-linked cards; bit `RaidBadge`, now in `task-raid-badge.tsx` taking
  `lang`+`onJumpToRaid` as props). Test cards/board with a populated `raidByTask` or the crash
  path stays untested. ★ Jira-synced tasks (`!!task.jiraKey`) are read-only: sync maps
  `statusCategory`→`status` via `jiraCategoryToStatus` INSIDE `issueToTaskFields`' patch and
  applies `patch.status` DIRECTLY — NOT through `applyStatusChange` (which would stamp `today`
  instead of Jira's resolution date). The board/table selects + drag are disabled for synced;
  `onStatusChange` no-ops on `jiraKey`. Board is NOT in the axe `A11Y_VIEWS` (gate scans the
  table view) — board a11y is eye-verified (row-unique select labels + per-column `aria-label`).
- **Scrollbar gap:** per-view inner scrollers (`min-h-0 flex-1 overflow-auto`) need `pr-2` for the
  content↔scrollbar gap. Shared `INNER_TABLE_CLASS`/report-table/actions-panel already include it;
  bare per-panel scrollers do NOT — add `pr-2` or content jams the scrollbar.
- **`useResizable(storageKey)` inline-size beats class width:** the hook writes a saved
  `{width,height}` as an INLINE style, which OVERRIDES class `w-full`/width. Changing a resizable
  pane's DEFAULT size (e.g. centered-half → full-width) silently no-ops for anyone with a persisted
  size — BUMP the storageKey (e.g. `…-size` → `…-size-full`) so the stale size is discarded (pane
  stays resizable from the new baseline). Bit Milestones/Documents going full-width.
- **Rounded table headers:** `TABLE_HEAD_CLASS` carries a `.lop-thead` marker; the Dark-Blue fill
  lives on `<th>` (NOT `<thead>`) via `globals.css` so rounded first/last corners clip it, with
  `border-spacing:0`. Don't move bg back to `<thead>` — a rounded `th` only clips a fill it paints.
- Heavy browser-only deps (rich-text editor, etc.) load via `next/dynamic({ ssr: false })` to
  stay off main bundle; ProseMirror/Tiptap-style libs need `Range.getClientRects` +
  `getBoundingClientRect` jsdom stubs in tests.
  jsdom has NO layout engine — `scrollHeight`/`offsetHeight`/`getBoundingClientRect` all return 0,
  so any measure-based UI (textarea autogrow, resize) must stub `scrollHeight` in its test
  (`Object.defineProperty(el, "scrollHeight", { configurable: true, value: N })`) — pixel-height
  assertion silently reads 0 otherwise.
- M365 Graph called client-side via `useMsAuth().acquireToken(scopes, { interactive })` —
  `interactive:true` pops incremental-consent dialog for new scope; background probes stay
  silent. New Graph host must be added to CSP allowlist (above).
- AI Assistant: `chat-panel.tsx` calls Anthropic directly (browser, `anthropic-dangerous-direct-
  browser-access`). `buildSystemPrompt` returns `SystemBlock[]`, NOT a string. Anthropic prompt
  caching is PREFIX-based: stable/cacheable content (instructions + operating-guide text) MUST come
  FIRST with `cache_control:{type:"ephemeral"}` breakpoint after it, and volatile data (today,
  task count, current view/mode) MUST come AFTER — mixing volatile data into cached block (or
  putting big guide block last) means cache never hits. Operating guides live in global
  store (`operating_guides`, out of TABLE_NAMES) surfaced by ONE `useOperatingGuides` instance in
  task-manager, threaded to both ChatPanel (chat) and AiSection (editor).
- **AI write tools** declared in `chat-tools.ts` (`TOOL_DEFS` + `runTool` routing + `ToolDispatcher`
  type), IMPLEMENTED in `use-chat-dispatcher.ts`. Tasks/RAID/Changes/Milestones/Stakeholders all have
  create/update/delete. NEW entity write tool: add tool def + runTool case + `ToolDispatcher` method,
  then implement in the dispatcher `useMemo` — guard `if (args.isReadOnly) throw readOnlyError()`
  FIRST (popouts must not mutate), build the raw object and run it through the entity's `sanitizeX`
  (the SINGLE validator — `sanitizeRaidItem` was added for this; enforces enums/dates/caps + per-
  category RAID-status defaulting), id = `nextEntityId(ref.current)` (max+1), then update BOTH the ref
  AND call `setX` (ref keeps back-to-back tool calls consistent). `runTool` write cases use
  `requireId`/`patchWithoutId` (strips `id` from the update patch — a destructured `_id` would trip
  the no-unused-vars CI rule).
- **AI doc ingestion / multimodal**: `chat-panel.tsx`'s `ContentBlock` union includes `AttachmentBlock`
  (image/document) from pure `chat-attachments.ts` (classify by mime+extension, 20 MB cap, build the
  Anthropic block — PDF/image as base64 `source`, text as `{type:"text"}` document source; NO parsing
  lib, Claude reads natively). The `FileReader` (readAsDataURL for binary, readAsText for text) lives
  in chat-panel (module stays pure). A user turn with attachments sends `content` as `ContentBlock[]`
  (text block first, then attachments) not a string. CSP already allows `api.anthropic.com`. Chat view
  is NOT in the axe `A11Y_VIEWS` — verify chat controls by eye.
- **AI project creation (SP3):** Step 0 "Describe" in `CreateProjectWizard` (gated on a configured
  key) → ONE forced-tool Anthropic call (`tool_choice:{type:"tool",name:"propose_project"}`, no
  agentic loop) in `use-project-proposal.ts`; pure contract/transforms in `ai-project-proposal.ts`.
  The proposal pre-fills the form as a `Partial<ProjectFormDraft>` patch (`initialDraftPatch`), NOT
  a `ProjectMeta` — `sanitizeProjectMeta`/`draftFromMeta` need many fields + present arrays Claude
  can't infer (a sparse meta throws). Seed records run through each `sanitizeX` (temp id BEFORE
  sanitize) → `appendSeed`/`remapSeed`; no new Workspace field. Model-supplied URLs gated by
  `isSafeHttpUrl`. Empty-state offers "Configure AI assistant" (`BackendConfigModal` `children` +
  `AiSection hideUsage`) so a first-run user can set the key.
- **AI Action Center suggestions (SP4):** Action Center "Analyze with AI" button → ONE forced-tool
  Anthropic call (`tool_choice:{type:"tool",name:"report_analysis"}`, no loop) in
  `use-action-analysis.ts`; pure contract/transforms in `action-ai.ts` (`parseAnalysis` validates
  untrusted model output; `groundEntity` RE-VALIDATES model entity ids against the live workspace
  before any `requestOpen` deep-link — hallucinated id → fall back to `requestChat`). ADVISORY only
  (no write tool; deterministic `next-actions/` engine untouched; no new Workspace field). Hook lives
  in `task-manager.tsx` ABOVE the view so the in-memory result survives view remounts; bundle is
  `isPopout ? undefined` (popouts stay read-only even though advisory). Gated on key + `ai.action
  Suggestions !== false` (default ON). Rendered above the now/soon/monitor tiers; AI rows use a
  separate `ai-action-row.tsx` (NOT `ActionRow`).
- **AI scheduled jobs (SP5):** opt-in recurring portfolio-analysis. Pure i18n-free `scheduled-jobs/`
  engine (`isDue`/`nextRunAt`/`dueJobs`/`appendRun`; `now` ALWAYS passed in — no `Date.now()`/`new
  Date()` inside, keeps it test-pure). Global `scheduled_jobs` store (JSON-blob row, Turso-gated +
  localStorage fallback) OUT of `TABLE_NAMES` (guard test). Runner `use-scheduled-job-runner.ts` lives
  in `task-manager` ABOVE the view; runs DUE jobs on mount/visibility/5-min-tick, SERIAL + overlap-
  guarded; fail-once-per-slot (a failed run still advances `lastRunAt` — avoids re-spamming a BILLED
  call). SP4's call extracted to NON-hook `runJobAnalysis` (`scheduled-job-analysis.ts`) so the runner
  loops it; `use-action-analysis` delegates. ADVISORY only; never in popouts. Gated on key +
  `ai.scheduledJobs === true` (default OFF / opt-in — UNLIKE `actionSuggestions`'s `!== false`).
- **No `settings.mode` field:** PM mode is DERIVED — `deriveMode(settings.features)` (same call the
  chat snapshot uses in `use-chat-dispatcher.ts`). Reading `settings.mode` is `undefined`; use
  `deriveMode`.
- **Installable PWA (SP5 Phase 6):** `public/manifest.webmanifest` + `public/sw.js` (static, NOT
  bundled → can't `import` TS modules) registered from a CLIENT component (`service-worker-registrar.
  tsx`) — an inline `<script>` can't carry proxy.ts's per-request CSP nonce. SW does NO caching / NO
  fetch handler (hashed bundles → precache would serve stale JS). CSP needs explicit `worker-src
  'self'` in `src/proxy.ts`: `script-src 'strict-dynamic'` makes browsers IGNORE `'self'` for the SW
  load → without `worker-src` registration is blocked at RUNTIME (not caught by tests/build). Periodic
  Background Sync deliberately NOT built (Chromium+installed+device-seal only; baseline covers on open).
