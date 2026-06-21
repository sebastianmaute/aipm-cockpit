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
  consts; `sanitize.ts` = the single per-entity validators (now a BARREL — see "Sanitize module map"); `i18n.ts`/`i18n.de.ts` = EN/DE strings;
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
- **Gantt module map:** `GanttPanel` (`gantt.tsx`) is the orchestrator only (data derivation +
  layout); the heavy parts are extracted. Pure i18n-free ENGINE is `gantt-engine.ts` (date math,
  prefs load/save, critical-path, derive-bar — note `.ts` shadows no `.tsx`). React pieces:
  hooks `use-gantt-bar-drag.ts` (bar move/resize — window pointer-listener drag lifecycle +
  `previewDates`/`startBarDrag`, mirrors drag into state for the preview bar) and
  `use-gantt-prefs.ts` (sort/filter prefs state + localStorage hydrate/persist + setters);
  presentational `gantt-chrome.tsx` (`GanttToolbar`, `GanttHeader` axis, `GanttDependencyLayer`
  SVG arrows + milestone connectors) and `gantt-rows.tsx` (`GanttTaskRow`, `GanttMilestoneRow`).
  Rows/chrome are PURE — `GanttPanel` threads data + the drag state/handlers (incl. the same
  `interactingWithBarRef` the row's `onDragStart` reads synchronously) down as props. ★ Gantt IS in
  the axe `A11Y_VIEWS` (12-view gate). ★ One brittle markup-ORDER source test reads `gantt-chrome.tsx`
  now (toolbar markup moved there), not `gantt.tsx`.
- **Reports module map:** `ReportsPanel` (`reports.tsx`) owns data + sort/column-resize state;
  pure i18n-free `reports-stats.ts` (`computeStats` + `Stats`/`GroupOrLabelRow`) and presentational
  `reports-tables.tsx` (`GroupOrLabelTable`, `AssigneeTable`, `Tile`, `Section`, `StackedBar` + the
  shared `REPORTS_*_COL_WIDTHS` consts and `AssigneeSort`/`GroupOrLabelSort` types). One-way dep
  (reports → reports-tables → reports-stats); per-type report engines/panels (budget/raid/resource/
  stakeholder) already live in their own files. Reports IS in the axe `A11Y_VIEWS`.
- **RAID edit modal map:** `RaidEditModal` (`raid-edit-modal.tsx`) owns the draft, query state,
  derived option lists, and add/remove handlers; presentational `raid-risk-matrix.tsx` (`RiskMatrix`
  5×5 picker, Risk items only) and `raid-edit-fields.tsx` (`RaidLinkedTasksField`, `RaidCausedByField`
  — the two chip-picker sections, threaded handlers/state as props). The panel still owns draft state
  (these are pure render). RAID IS in the axe `A11Y_VIEWS`.
- **OOXML export map:** the hand-rolled Office export (no lib; own `zip.ts` writer) is split by
  format: `export-docx.ts` (`buildDocx`), `export-xlsx.ts` (`buildXlsx`), `export-pptx.ts`
  (`buildPptx`) over shared `export-ooxml-shared.ts` (brand palette consts, `xmlEscape`, `todayHuman`,
  `PPTX_MAX_ROWS_PER_SECTION`). `export-ooxml.ts` is now a BARREL re-exporting the 3 builders —
  `export.ts` consumes them via `await import("./export-ooxml")` and `export-ooxml.test.ts` imports
  from the barrel, so keep those three names exported there. (Sections come from `export-sections.ts`.)
- **Sanitize module map:** `sanitize.ts` is now a BARREL (`export *`) over three files — keep importing
  from `./sanitize` (≈37 importers unchanged). Pure i18n-free, one-way deps (core ← entities ← records):
  `sanitize-core.ts` (primitives + length caps: `sanitizeText`/`sanitizeMultiline`/`toNumber` now
  EXPORTED, plus the field/date/email/label/dependency sanitizers), `sanitize-entities.ts`
  (Absence/Shift/Resource/Role/Discipline/Grade/Plan/Budget/allocations/FxRates), `sanitize-records.ts`
  (Milestone/Change/RAID/Stakeholder/ProjectMeta/SteeringCommittee/timezone — imports only
  `BUDGET_NAME_MAX`+`sanitizeIdList` from entities). ★ A NEW entity sanitizer goes in entities or
  records (whichever cluster); a new shared primitive goes in core. Each `*_SET`/`*_RE` const must
  stay in the file with its consumers. Golden byte-stability + `sanitize.test`/`.property` + the 37
  importers guard behavior.
- **Codec module maps:** `csv-codecs.ts` and `markdown-codecs.ts` are now BARRELS (`export *`) — keep
  importing from `./csv-codecs` / `./markdown-codecs` (storage facade + `local-file-backend` + tests
  unchanged). Pure i18n-free, byte-stable (golden-workspace pins exact bytes). One-way deps:
  • CSV (core ← config ← decode): `csv-codecs-core.ts` (leaf — `*_CSV_COLUMNS` registries, parse
  helpers, the `fieldToString` family + `build*FromObj` decoders shared with the MD codec & Turso
  schema, csv escaping, per-section entity encoders, and the low-level `parseCsv` tokenizer),
  `csv-codecs-config.ts` (status/field-visibility/features/steering config-blob codecs + ProjectMeta
  codecs + the `workspaceToCsv` ENCODER assembler), `csv-codecs-decode.ts` (`splitCsvSections` +
  row→object helpers + entity decoders + `decodeRatesMap` + the `csvToWorkspace` assembler).
  • MD (core ← decode): `markdown-codecs-core.ts` (leaf — `*_MD_COLUMNS`, `mdEscape`/`mdUnescape`,
  per-entity table encoders, config/project MD codecs, the THREE self-contained table decoders
  `markdownToMilestones`/`Changes`/`Stakeholders`, the `workspaceToMarkdown` encoder, and the shared
  row primitives `splitMdRow`+`markdownTableToObjects`), `markdown-codecs-decode.ts`
  (`splitMarkdownSections` + remaining entity decoders + `markdownToWorkspace`). ★★ `parseCsv` (CSV) and
  `splitMdRow`+`markdownTableToObjects` (MD) were HOISTED into the respective CORE so the config-blob /
  early table decoders share them WITHOUT a config↔decode / core↔decode cycle. ★ Cross-module-referenced
  core internals (the `CSV_SECTION_*` consts, entity encoders, `csvCellEscape`; `mdUnescape`, the row
  primitives, the three MD table decoders) were promoted to EXPORTS — additive. A new per-section codec
  goes in core; a new config-blob codec in `csv-codecs-config`; a new assembler stays with its peer.
- **useStorageBackend module map:** `use-storage-backend.ts` keeps the PERSISTENCE core (backend memo,
  reactive refs, `applyWorkspace`, the load/save debounce effects, broadcast sync, the storage-file
  controls `onPick`/`onGrant`/`onOpen`/`onRequestStorageSwitch`, and the shared helpers
  `backendFor`/`currentWorkspace`/`commitRegistry`/`persistBackendHandle`/`tursoConfigNow`/
  `reportProjectError`). The two project-operation clusters live in hook factories it composes:
  `use-storage-file-ops.ts` `useFileProjectOps` (switchToProject / createProject / loadProjectFromFile /
  createDemoProject) and `use-storage-turso-ops.ts` `useTursoProjectOps` (switch/create/migrate/archive/
  restore/hardDelete Turso portfolio projects). Each takes a typed `deps` object (the live render-scope
  closure values + the shared helpers) and returns the handlers, spread into the hook's return.
  ★★ These handlers MUST NOT be memoized — they read live render-scope state every call (the same
  reason the originals were bare `function` declarations). ★★ The factories are named `use*` and called
  UNCONDITIONALLY (before the single `return`, no early-return precedes them) because the react-hooks
  PURITY rule REJECTS passing a ref object into a plain function call during render — a `use*` hook may
  receive the hook's refs, a plain `createX(deps)` cannot (this is why they aren't plain factories).
  ★ A new project flow goes in file-ops or turso-ops (whichever backend); a new persistence concern or
  shared helper stays in `use-storage-backend.ts` and is threaded into the deps. Public return shape is
  unchanged (task-manager + `use-storage-backend.test.tsx` untouched).
- **Workspace-section module map:** `workspace-section.tsx` is the view ROUTER (the tabpanel switch);
  it imports the lazy panels from `workspace-panels.tsx` (the 20 `dynamic(ssr:false)` view-panel
  `export const`s — keep new lazy panels there) and the props contract `WorkspaceSectionProps` from
  `workspace-section-types.ts`, which it RE-EXPORTS (so importers of the type from `./workspace-section`
  are unchanged). Static (non-lazy) panels (Dashboard/Milestones/SteeringCommittee/ResourceDirectory)
  stay imported directly in `workspace-section.tsx`. (Routes the axe-scanned views, so changes there
  re-scan them.)
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
- AI Assistant: `chat-panel.tsx` is the React surface; the non-React WIRE LAYER (Anthropic
  protocol types `TextBlock`/`ContentBlock`/`SystemBlock`/`ApiMessage`/`DisplayItem`, `callClaude`,
  `buildSystemPrompt`, `systemBlocksText`, `readAttachmentData`, `stringifyResult`) lives in pure
  i18n-free `chat-api.ts` — import from there, NOT chat-panel (tests do too). It calls Anthropic
  directly (browser, `anthropic-dangerous-direct-browser-access`). `buildSystemPrompt` returns
  `SystemBlock[]`, NOT a string. Anthropic prompt
  caching is PREFIX-based: stable/cacheable content (instructions + operating-guide text) MUST come
  FIRST with `cache_control:{type:"ephemeral"}` breakpoint after it, and volatile data (today,
  task count, current view/mode) MUST come AFTER — mixing volatile data into cached block (or
  putting big guide block last) means cache never hits. Operating guides live in global
  store (`operating_guides`, out of TABLE_NAMES) surfaced by ONE `useOperatingGuides` instance in
  task-manager, threaded to both ChatPanel (chat) and AiSection (editor).
- **AI app-feature guide (v0.116.0):** view-scoped built-in operating guides that teach the assistant
  the APP's features (so it answers "how do I …?"). Source `lib/app-feature-guide.md` = `## Overview`
  (no marker → always-on) + per-view `## Title` each followed by `<!-- views: <AppView ids> -->`,
  each ending with a truthful `AI:` line (what it can/can't do via TOOLS — don't over-claim).
  `scripts/gen-operating-guide.mjs` `parseFeatureGuide(md, VALID_VIEWS)` (exported, pure) → emits
  `BUILTIN_FEATURE_GUIDES` (`builtin-app-overview` scope {} + `builtin-feature-<view>` scope
  {views:[…]}) into `operating-guide-builtin.generated.ts` beside the leadership constant.
  ★★ the generator's `writeFileSync` is inside `if (isMain)` — so a vitest `import { parseFeatureGuide }`
  does NOT rewrite the generated file (don't move the write to top level). Prebuild regenerates; the
  `operating-guide-builtin.test.ts` sync-guard re-parses the md + `toEqual`s the committed array (drift
  fails CI; keep the test's `VALID_VIEWS` == the generator's, == nav-config `AppView`).
  ★ Adding a section: TAG it (`<!-- views: … -->`) with REAL AppView ids — `parseFeatureGuide` THROWS
  on an unknown id AND on an untagged non-Overview section (no silent drop).
  Seeded by `use-operating-guides` `builtinSeeds()`/`reconcileBuiltins()`: on every load it refreshes
  built-in content/name/scope but PRESERVES the user's `enabled`/`priority` (no toggle-clobber on
  upgrade; existing leadership-only users get the feature guides next load); all built-ins undeletable
  via `BUILTIN_IDS`. `selectActiveGuides` loads overview + the current view's guide into the cached
  prompt prefix (view change re-caches that slice). Guide content is ENGLISH-ONLY (no i18n). Knowledge
  only — adds NO new AI tools. (Separately, the task create/update tools now expose `status`, routed
  through `applyStatusChange`, synced tasks read-only — MR !99.)
- **AI write tools**: tool SCHEMAS (`TOOL_DEFS` + the per-entity field-property helpers
  `taskFields`/`raidFields`/… + `ALL_RAID_STATUSES`) live in pure `chat-tool-defs.ts`; `chat-tools.ts`
  re-exports `TOOL_DEFS` (so `chat-api` imports it unchanged) and holds the `runTool` routing +
  `ToolDispatcher` type + arg-coercion/summary helpers; tools are IMPLEMENTED in
  `use-chat-dispatcher.ts`. Tasks/RAID/Changes/Milestones/Stakeholders all have
  create/update/delete. NEW entity write tool: add tool def (in `chat-tool-defs.ts`) + runTool case + `ToolDispatcher` method,
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
- **Create project from source (SP-D, v0.110.0):** the create wizard's Step 0 (now extracted to
  `step0-import-panel.tsx`) adds Upload-file / SharePoint / Confluence-URL import alongside Describe;
  all funnel into SP3's `useProjectProposal().generate(...)` — widened to `string | ContentBlock[]`
  (multimodal: PDF/image read natively via SP2 `chat-attachments`, NO parsing lib). File: 20 MB cap +
  `classifyAttachment` reused. SharePoint: existing `SharePointPickerModal` → `fetchSharePointFileContent`
  via Graph `/shares/{u!base64(url)}/driveItem/content` (reuses `PICKER_SCOPES`, so no extra consent).
  ★★ Confluence: the new `src/app/api/confluence/page/route.ts` MUST REUSE `api/jira/_helpers`
  (`parseJiraRequest`/`callJira`/`forwardJsonResponse`) — NEVER a raw `fetch` (that bypasses the
  SSRF allowlist to `*.atlassian.net` + Basic auth + timeout). Confluence is the SAME Atlassian host,
  just the `/wiki/rest/api/content/{id}?expand=body.view` path; validate `pageId` with `/^\d+$/`
  SERVER-SIDE before building the path (path-injection guard). Browser→`/api/confluence` is
  same-origin (no CSP host needed; Graph already allowlisted). ★ Gating: file+describe always,
  SharePoint on `isSharePointEnabled`, Confluence on FULL Jira config (`enabled&&siteUrl&&apiToken&&email`).
  ★ Error boundary: SOURCE failures → sanitized `importError`; the Anthropic `generate` failure →
  the hook's `aiError` (kept separate — don't let a generic source error clobber it). No key/token/body
  ever logged or rendered.
- **Steering committee (SP-E, v0.111.0):** opt-in per-project `Workspace.steeringCommittee`
  (`{name, memberResourceIds[], meetings[], infoSchedules[], infoReminderEventIds?, pendingDeleteEventIds?}`;
  pure validator `sanitizeSteeringCommittee` — never throws, bad dates dropped, leadDays>=0, ids deduped).
  Nav view `steering-committee` → `steering-committee-panel.tsx`, mounted ONCE in `workspace-section.tsx`
  (`activeTab==="steering-committee"`) which covers BOTH shells (modern + classic route view bodies
  through WorkspaceSection); the Push-to-Outlook button lives IN the panel so no top-bar control. NOT in
  axe `A11Y_VIEWS` → eye-verify row-unique labels (`${edit} – ${meeting.title}`).
  ★★ Persists as a JSON BLOB, NOT a row table: CSV `# STEERING COMMITTEE` (`config,<json>` row) + MD
  `## Steering Committee` (fenced JSON) + Turso `meta` row `steering_committee` (REUSES the `meta`
  singleton — NOT a new `TABLE_NAMES` entry) + JSON + IDB KV slot. Storage-ONLY (gated `config===undefined`,
  like fieldVisibility/features — EXCLUDED from user exports); committee-less ws stays BYTE-STABLE (section
  emitted only when present). ★ Adding a FIELD to the nested object costs ZERO extra write paths (rides the
  blob) — only extend `sanitizeSteeringCommittee` (that's how `pendingDeleteEventIds` was added).
  ★★ Adding to the `ActionSource` / `AppView` unions surfaced FOUR exhaustive `Record<>` maps tsc forced
  extending (`action-source-label`, `action-source-icon`, `nav-icons` ICON_PATHS, `nav-config`
  LABEL_KEYS/`navLabelKey`) — "Map-based, no break" was WRONG; grep the union members.
  Pure engines: `steering-reminders.ts` (`dueInfoReminders` — working-day lead, `today` passed in, no
  `Date.now()`) + `committee-calendar-reconcile.ts` (`planCommitteeReconcile` is ID-TRACKED: derives
  create/update/delete from the committee's OWN stored ids, NO `listProjectEvents`).
  Provider `next-actions/providers/committee-info.ts`: ★ optional `ActionInput.steeringCommittee` MUST be
  populated in task-manager's `buildActionInput` or the provider silently returns [] live; "upcoming" tier
  skipped. ★ Outlook push `use-committee-outlook-push.ts` (mirrors milestone push; `Calendars.ReadWrite`,
  popout no-op, M365-gated, status-only logs — never token/body): meeting events keyed 1:1 on
  `meeting.outlookEventId`, info-instances in `infoReminderEventIds["<meetingId>:<scheduleId>"]`.
  ★★ A deleted meeting loses its `outlookEventId` (stored on the meeting obj, not a map) → the panel
  stashes it in `pendingDeleteEventIds` for the next push to delete + clear (info-instances ARE map-tracked
  so they prune automatically). ★★ `outlook-calendar-write.ts` `graph()` tolerates 404 ONLY for DELETE;
  PATCH/POST THROW `GraphCalendarError(404)` so an event deleted in Outlook gets re-created next push
  (committee + milestone hooks self-heal by clearing the stale id) — it previously swallowed 404 for ALL
  methods, making the milestone 404 branch DEAD.
- **Guided tour + demo (SP-F, v0.112.0):** MODERN-shell-only onboarding (never classic/popout).
  Pure i18n-free `app-tour.ts` (`TOUR_STEPS` ~12 keys-only, `visibleSteps(features)` drops steps
  whose `view` is a disabled module via `isViewEnabled`, `clampStep`). `tour-overlay.tsx` =
  controlled component: centered modal OR anchored "spotlight" over a `[data-tour-id]` element —
  ★ a MISSING anchor (gated/unmounted view) FALLS BACK to a centered modal (never points at
  nothing); role=dialog/aria-modal/Escape-skips/focus. `use-tour.ts` (in task-manager, above the
  view): open/index + per-device `settings.tourSeen` (written via `setSettings`->`writeSettings`,
  which spreads the whole object so a new flag persists with NO allowlist edit) + ★ RENDER-TIME
  auto-launch (`if (eligible && !autoHandled) { setAutoHandled(true); setIsOpen(true) }` during
  render — NOT a useEffect; set-state-in-effect is banned) gated `hydrated && layout==="modern"
  && !isPopout && !tourSeen`. Overlay mounted ONCE in the modern tree (not classic); Help
  "Take the tour" re-launch via `HelpMenu onTakeTour` (threaded through `ActionMenus`, passed
  only when modern && !popout). 4 `data-tour-id` anchors: sidebar tasks/actions (`NAV_TOUR_ID`
  map in `sidebar-nav.tsx`), Ask-Claude `<span>` wrapper, project-switcher container.
  ★★★ **DEMO CTA MUST REGISTER A PROJECT, not just apply data.** The empty-state "Explore a demo
  project" loads `sample-workspace-small.json` (lazy `import("../../sample-workspace-small.json")`
  — first JSON import in app code; `resolveJsonModule` is on). It MUST go through
  `createDemoProject(ws)` (new `useStorageBackend` method) which REGISTERS a real project
  (`addProject`+`commitRegistry`), because the empty-state gate is `showEmptyState =
  registry.projects.length===0` (file mode) — an apply-only path (`applyRestoredWorkspace`+
  `startTour`) leaves the registry empty so `showEmptyState` stays TRUE -> `modernTree` (which holds
  BOTH the views AND `TourOverlay`) never mounts -> demo invisible + tour never renders. (Shipped
  this exact CRITICAL; caught in final review. Applying workspace data != showing it.) `createDemoProject`
  uses the `browser`/IndexedDB backend kind (NO file picker — frictionless) + derives meta from
  `ws.project`. ★ Turso portfolio mode: a local demo can't flip the turso-branch empty-state gate
  (it reads the Turso project LIST), so it persists registry+settings+`savePortfolioMode("file")`
  and `window.location.reload()`s (mirrors `loadProjectFromFile`'s switchPortfolioToFileOnSuccess) —
  ALL durable writes BEFORE the reload, and SKIP the in-place `applyWorkspace`/`setStorageConfig`
  (the reload discards them; avoids a mount-then-teardown flash); after reload `tourSeen` is unset
  so auto-launch re-fires the tour. Demo CTA is empty-state-only (never clobbers a real project);
  the demo is a normal deletable project (non-destructive to any Turso DB). Tour view NOT in axe
  `A11Y_VIEWS` (eye-verified); spotlight positioning eye-verified (jsdom rect=0).
- **Timezones (TZ-1, v0.113.0):** FIRST of 3 tz sub-projects (TZ-2 = display routing + per-window
  switcher; TZ-3 = calendar multi-tz — both NOT YET BUILT). Pure i18n-free `timezone.ts` (Intl only,
  NO dep): `todayInZone(now,tz)` (uses `Intl.DateTimeFormat("en-CA").formatToParts` — date-line + DST
  correct, NOT offset math), `formatInZone` (TZ-2 consumes; built+tested but currently UNUSED — not
  dead code), `isValidTimeZone`, `browserTimeZone()` (env read — a FUNCTION not a module const, SSR/
  test-safe), `tzZones()` (shared picker list, guarded `Intl.supportedValuesOf` → `[browserTimeZone(),
  "UTC"]` fallback), `resolveTimezone(overrideTz, projectTz)` = override ?? project ?? browser (each
  validity-gated, always returns a valid zone).
  ★★ **The effective tz = `resolveTimezone(settings.timezone, project?.operatingTimezone)` and the
  app's central `today` now derives in it** — `task-manager` `todayISO()` → `effectiveToday(tz)` =
  `todayInZone(new Date(), tz)` (a MODULE fn so `new Date()` isn't in a render body), so overdue/
  next-actions/reminders/due-date logic follow the zone. Secondary derivations aligned:
  `use-resource-planner` now takes `today` as a PARAM (fed the effective today); `use-bulk-operations`
  resolves tz in a callback. ★ The ~30 OTHER `new Date().toISOString().slice(0,10)` sites (export/
  codec/backend stamps, plan-start defaults, gantt/calendar DISPLAY) STAY UTC by design — none
  compares a UTC-today against the zone-today (verified: no off-by-one). DISPLAY of timestamps is
  still browser-local until TZ-2 (logic/display split is intentional for the phased rollout).
  ★★ **`operatingTimezone` lives on `ProjectMeta`, NOT a top-level Workspace field** — it rides the
  existing project-meta serialization via the single `PROJECT_CSV_COLUMNS` list (drives CSV cols + MD
  `projectFieldToString` generic arm + Turso TENANT DDL/insert), mirroring `jiraUrl` EXACTLY; add the
  column there + the decoder + `sanitizeProjectMeta` (validate via `isValidTimeZone`) + regenerate
  golden fixtures (the sample's project meta is SYNTHESIZED in `generate-sample-workspace.ts`, not the
  `.md`). ★ Adding ANY `ProjectMeta` key forces an `export-sections.ts` `PROJECT_FIELD_I18N_KEYS`
  exhaustive-`Record` entry + its i18n key (tsc-forced). ★ Turso SINGLE schema doesn't persist
  `ws.project` (tenant projects row via portfolio upsert); `turso-migrate` ALTER-adds the column.
  Per-device `settings.timezone?` (override; undefined = follow project/browser) + `additionalTimezones?`
  (TZ-2/TZ-3 consume; currently UNUSED) — persist via `writeSettings` (spreads, no allowlist edit).
  Settings picker: `settings-sections/timezone-settings-section.tsx` ("System default" option value
  `""` → override undefined; row-unique remove labels — Settings/General is axe-scanned). Project form:
  operating-tz `<select>` (blank → undefined).
- **Timezone display (TZ-2, v0.114.0):** SECOND tz sub-project (TZ-3 = calendar multi-tz, NOT BUILT).
  Renders INSTANT timestamps in a session display zone over TZ-1's effective zone. ★ DISPLAY-ONLY +
  EPHEMERAL: `display-timezone-context.tsx` holds an in-memory `override` (useState, NEVER persisted —
  resets on reload); `displayTz = override ?? effectiveTz` (effectiveTz = TZ-1
  `resolveTimezone(settings.timezone, project?.operatingTimezone)`). `useDisplayTimezone()` →
  `{displayTz, effectiveTz, isOverridden, setDisplayOverride, resetDisplayTz}`. Shared formatter
  `tz-display.ts` `formatDisplayTimestamp(iso, tz, lang, {withSeconds?})` wraps TZ-1 `formatInZone`
  with `timeZoneName:"short"` (zone label) — the ACTIVITY LOG passes `{withSeconds:true}` (sub-minute
  entries), history/trends use minute precision.
  ★★ **ONLY instant-timestamp DISPLAYS convert** (`activity-log-panel`, `history-panel` capturedAt
  labels, `trends-panel` capturedAt cell) — every `capturedAt` used as a SORT/dedup/column-width/
  row-SELECTION key STAYS on raw ISO (converting a shared display+key value is an ordering bug; the
  review specifically checked this). Date-only fields, the gantt month-axis, and storage/export
  `toISOString` stamps are untouched.
  ★★ **Switcher `display-tz-switcher.tsx` wired into BOTH headers** (modern `topBarMenus` + classic
  `AppHeader` via a NEW `trailing?` prop — AppHeader builds Ask-Claude internally so it had no element
  slot) — dual-header rule; NOT in popouts (no header). The `DisplayTimezoneProvider` wraps BOTH
  task-manager return branches (popout + main) with `effectiveTz`, so popout timestamps convert to the
  effective DEFAULT (no switcher there). Options: Default(`value=""`→clears override) + UTC +
  `settings.additionalTimezones` (extras filtered to drop UTC/effective dups). `DisplayTzSwitcherConnected`
  is a MODULE-LEVEL wrapper (static-components rule); switcher `<select>` carries `aria-label`
  (top bar axe-scanned every view).
- **Calendar timezones (TZ-3, v0.115.0):** FINAL tz sub-project — COMPLETES the timezone roadmap
  (TZ-1 model+logic, TZ-2 display+switcher, TZ-3 calendar). A live multi-zone "world clock" strip atop
  the Calendar view. Pure `tz-clock.ts` `formatZoneClock(iso,tz,lang)` (wraps TZ-1 `formatInZone`;
  time + SHORT DATE so the date-line rollover shows). `tz-clock-strip.tsx`: live `now` via a LAZY
  `useState(() => new Date())` + a `useEffect` `setInterval(…,60_000)` cleared on unmount (NOT a
  render-body `new Date()`); renders the default zone + each additional zone; `role="region"` +
  `aria-label`; ★ DEDUPES the default out of the list (`[defaultTz, ...zones.filter(z => z !==
  defaultTz)]`) to avoid a double chip + a duplicate React key. Wired in `workspace-section.tsx` ONLY
  when `activeTab==="calendar"` && `settings.additionalTimezones` non-empty (returns null otherwise);
  default = `resolveTimezone(settings.timezone, project?.operatingTimezone)` (the EFFECTIVE zone, NOT
  the TZ-2 display override). Date-grid cells/logic untouched (the grid is date-only — no per-cell
  conversion). Calendar is NOT in axe `A11Y_VIEWS` (eye-verified). ★ The TZ-1 settings editor now also
  excludes the resolved default (`settings.timezone || browserTimeZone()`) from the add-additional
  list (the per-project operating-tz case is rarer; the strip dedupes it regardless).
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
- **AI weight suggestions (SP-C, v0.109.0):** "Suggest with AI" in the next-actions settings →
  ONE forced-tool call (`suggest_weights`, `tool_choice` forced, NO loop) in
  `weight-suggestion-call.ts` (mirrors `scheduled-job-analysis.ts` security EXACTLY — never
  logs/echoes apiKey or body; thrown errors carry only HTTP-status digits or `"parse"`). Pure
  contract `next-actions-tuning.ts` + `weight-suggestion-ai.ts`; hook `use-weight-suggestions.ts`.
  ★★ EVERY model-proposed value reaching `settings.nextActions` MUST pass `parseWeightSuggestions`
  → `NEXT_ACTIONS_FIELD_COERCE[field]` — the SAME per-field validators `resolveNextActionsConfig`
  uses (hoisted to a shared exported map in `settings-types.ts`; a hallucinated/out-of-bounds value
  can never land). Accept writes via the settings setter (→ `writeSettings`), never raw setItem.
  Targets the 3 confidence weights by default; opt-in `ai.suggestAllNextActionThresholds` (default
  OFF) widens to all 10. Learning history + `summarizeTrendsForPrompt(actionTrends)` = INPUTS;
  ephemeral result; popout read-only. ★ A pure rationale sanitizer regex is the SHARED
  `CONTROL_CHARS = /[\x00-\x1f]/g` (use `\x` HEX escapes — never type literal control bytes; they
  corrupt the file to binary).
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
