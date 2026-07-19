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
                            # ★ The IDE language-server's inline diagnostics are MID-EDIT snapshots —
                            # after a multi-file edit they routinely show phantom "Cannot find module"/
                            # "implicitly any" that a real `npx tsc --noEmit` (exit 0) contradicts. Trust
                            # tsc, not the squiggles.
npm run test:run            # vitest (unit/integration). testTimeout/hookTimeout = 20s
                            # (raised from the 5s default in vitest.config) — the CPU-heavy
                            # fast-check property suites (`*.property.test.ts`, ~100 runs each) +
                            # fake-indexeddb setup can starve a worker past 5s under full-suite
                            # parallel load on a slow machine → a RARE, non-deterministic timeout
                            # that never repros in isolation or in CI. Don't "fix" such a flake by
                            # editing the property logic before ruling out a load timeout (run the
                            # property thousands of times in isolation first; logic bugs repro there).
npm run e2e                 # playwright (incl. the 13-view axe a11y gate)
npm run dup:check           # jscpd duplication GATE (--threshold set in package.json dup:check, per-format; BLOCKING in CI). baseline docs/baselines/jscpd-2026-07.json
npm run size:check          # file-size ratchet — fails on a NEW >800-line file or a baselined file that grew
npm run stop                # kill ONLY the dev server bound to the app port (default 3000; PORT-overridable)
                            # via scripts/stop-dev.mjs — port-scoped (netstat/taskkill on win, lsof/kill on
                            # posix); NEVER a blanket `taskkill /IM node.exe`. New script → also add a
                            # scriptsDescriptions entry or docs:scripts:check fails.
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
  ★ Tailwind v4 auto-scans ALL repo files (incl. `.md`/comments) for class candidates — NEVER put a
  `*` wildcard inside a Tailwind arbitrary-value bracket (a `--foo-*` glob inside `[var(…)]`) in ANY
  tracked file; Tailwind emits it as invalid CSS and `globals.css` fails to compile → app 500s.
  Use a real token name in examples (e.g. `shadow-[var(--shadow-card)]`); write token FAMILIES as bare
  `--foo-*` globs outside any Tailwind bracket.
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
  "Compact view, pressed" ⇒ compact is on. (The dashboard's own density + Trends toggles followed this
  before they were REMOVED — density moved to Settings → Appearance, Trends is now Turso-gated.) The
  pin-the-enabled-label + `aria-pressed` pattern remains the RULE for any new toggle button.
  Moving/folding a control INTO an axe-scanned view re-scans it: gate scans `Settings`→General, so
  folding Storage/Appearance into General surfaced pre-existing unlabeled `<select>` (a visible
  `<span>` label is NOT an `aria-label`/`<label>`) as axe-critical.
  `A11Y_VIEWS` list (`e2e/a11y.spec.ts`) is 13 named views and does NOT include chat/AI-Assistant,
  Projects, or Knowledge — controls only on those surfaces aren't scanned, but anything in the
  always-present top bar IS (scanned via every view). Verify IA/UI/contrast changes with
  `npx playwright test e2e/a11y.spec.ts --project=chromium -g "<View>"` (~16s, webServer auto-starts)
  BEFORE pushing — unit suite (`test:run` = vitest) never runs playwright, so axe regressions slip
  local gate and fail ONLY in CI.
  ★★ After ANY `globals.css` `@theme` edit or large class/token rename, run axe on a FRESH ISOLATED
  server (`PORT=3100 npm run dev`, stop with `PORT=3100 npm run stop`) — NEVER the reused long-running
  dev server. Playwright's `reuseExistingServer:!CI` will attach to a stale `:3000` whose Tailwind
  hasn't regenerated the new `bg-ui-*` utilities → phantom transparent-fill axe FAILS that a prod build
  + a fresh port both pass (cost ~5 debug cycles once). Also re-run after killing a `PORT=3100` axe
  server if `.next/dev/types/*` got corrupted (phantom tsc errors in GENERATED files → `Remove-Item
  -Recurse -Force .next`, not source).
- **CI is GitLab** (not GitHub),  (GitLab). Pipeline: install → quality (lint · typecheck · **semgrep** SAST
  BLOCKING [two-scan: a full-severity `--gitlab-sast` report for the widget + a separate `--severity ERROR
  --error` gate] · **dependency-audit** blocking · **file-size-ratchet** BLOCKING · **duplication-gate**
  BLOCKING [jscpd `--threshold` per package.json `dup:check`, per-format] · **unit** [coverage floors: global lines 92/funcs 91/branch
  80/stmts 89 + per-engine globs in `vitest.config.ts`]) → build → e2e. All quality gates are ratchets and
  carry a commented `quality-gate-bypass` escape-hatch rules block. A weekly `schedule` pipeline also runs
  `dependency-audit-full` + a **dast-zap** ZAP baseline (dind-based, manual otherwise). (Phases 1-4 of the
  tech-debt roadmap are complete — gates flipped to blocking in Phase 4, MR !174.)
  New CI gate → also update this line.
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
- **Turso-gated features** (Snapshots/Trends, version history, Portfolio health) must check
  `tursoConfig !== null`, not just `storageConfig.kind === "turso"` (kind can be set while config
  unset/quarantined). Nav-gating: add the view to `TURSO_ONLY_VIEWS` (`nav-config.ts`) → `filterNavGroups`
  prunes it from the sidebar in file mode (so it can't render a dead tab); the panel STILL runtime-guards.
  ★ such a view is NOT reachable by the file-mode e2e seed → keep it OUT of `A11Y_VIEWS` (unit/eye-verify).
- **CSP allowlist:** every host BROWSER calls (Turso, Anthropic, MS Graph, MSAL, Jira) must be in
  `src/proxy.ts` `connect-src`/`frame-src` — NOT `next.config`. Missing host fails only at RUNTIME
  (unit tests mock `fetch`; `next build` passes), so silently slips through CI. CSP edits need dev-server restart.
- **New Turso table NOT workspace data** (snapshots, version history, comm_templates)
  must stay OUT of `TABLE_NAMES` (guard test enforces) — else workspace save's
  per-table DELETE wipes it. `SqlArg.value` (turso-schema) is string-only even for ints (`String(v)`).
- **Secrets at rest:** the `SecretId` union is now FIVE device-sealed ids — Anthropic `apiKey` +
  Turso `authToken` + Jira `apiToken` + Timelog `timelogApiToken` + dictation-STT `sttApiKey` (5th;
  lives under `settings.dictation`, browser→same-origin `/api/stt` SSRF proxy) — all
  ENCRYPTED via `secrets.ts` (AES-256-GCM; non-extractable device key in IndexedDB by default,
  optional per-secret PBKDF2 passphrase — Jira is device-only so far, no passphrase UI). ★ Adding a
  SecretId means SIX edits in lockstep: `SecretId` union, `isSealedSecret` id allowlist + `readStore`
  allowlist loop (both HARDCODE the id list — a missed one silently drops the ciphertext on read),
  `migratePlaintextSecrets` (seal + return), `writeSettings` blank, `hydrateSecretsInto` restore +
  the load-effect migrate/hydrate/re-merge block, and a seal-on-edit call in the field's settings
  section (`saveSecretValue(id,…,"device")`). ★ `jira` lives at TOP-LEVEL `settings.jira` (NOT under
  `settings.integrations`); `email`/`siteUrl` stay plaintext (identifying, and `email` is needed for
  the Basic-auth header). `writeSettings` is ONLY writer of `localStorage["aipm-cockpit:settings"]` and
  BLANKS those fields — settings persist EFFECT must call `writeSettings`, NEVER raw `setItem` (raw
  write dumps decrypted in-memory key/token to disk on every settings change — real CRITICAL
  we shipped and caught). M365 stores NO secret (clientId/tenantId are public; MSAL owns its token
  cache) — nothing to encrypt there. Secrets hydrated into memory on load (`hydrateSecretsInto`);
  passphrase-wrapped ones stay empty until unlock. Anything reading a secret uses live in-memory
  value; if IndexedDB/WebCrypto unavailable load path degrades to in-memory plaintext (never
  crash). `aipm-cockpit:secrets` ciphertext stays OUT of exports, Turso, recovery `CONFIG_KEYS`.
- **App config vs project data (reset/clear boundary):** `app-reset.ts` `clearAppConfig()` wipes
  ALL `aipm-cockpit:*` localStorage (snapshot keys BEFORE the remove loop — index-shift) + deletes the
  CONFIG IndexedDB DBs `aipm-cockpit-secrets` (device key) and `aipm-cockpit-project-handles` (FS-access
  pointers). It must NEVER delete the WORKSPACE IndexedDB DB `aipm-cockpit` (project data) — reset is
  detach-only ("no file/DB deletion"). Any new clear/reset path obeys the same split. IDB deletes
  are fire-and-forget (awaiting can hang on `onblocked` across tabs).
- **Storage namespace = `aipm-cockpit`** (renamed from legacy `lop-app`; MR rename-aipm-cockpit).
  `storage-migration.ts` runs a ONE-TIME idempotent migration: `migrateLocalStorage()` renames every
  `lop-app:*` key + the 5 non-prefixed boot keys (`lop-style`/`-theme`/`-active-scheme-colors`/
  `-active-scheme-structural`/`-scheme-supports-dark`) → `aipm-cockpit*`; `migrateIndexedDb()`
  copy-migrates the 3 IDB DBs (workspace `aipm-cockpit`, device-key `aipm-cockpit-secrets`, FS-handles
  `aipm-cockpit-project-handles`) by CONTENT (never `indexedDB.databases()` — Firefox lacks it),
  read-back-verifying before deleting the old, and NEVER clobbering a non-empty new DB. `ensureStorageMigrated()`
  (memoized) is awaited at all 3 IDB-open entry points (`idb.ts`/`secrets.ts`/`project-file-handles.ts`)
  BEFORE opening, and the boot IIFE (`boot-theme-script.ts`) duplicates the localStorage rename pre-paint
  (it can't import the TS module). A `aipm-cockpit:idb-migrated` flag makes post-migration boots zero-work.
  ★ storage-migration.ts / its test / boot-theme-script.ts / layout-boot-script.test.ts intentionally hold
  BOTH legacy + new literals — do NOT "clean up" the `lop-app`/`lop-*` strings there.

## Architecture pointers

> Bullets describe CURRENT behavior; version/MR provenance lives in git + CHANGELOG, not here.

- **Orientation / key files:** `task-manager.tsx` = root orchestrator (layout, top bar, view
  routing; threads workspace + AI hooks down). `storage.ts` = backend facade;
  `workspace-context.tsx` = live workspace state + setters; `types.ts` = all entity shapes + enum
  consts; `sanitize.ts` = single per-entity validators (a BARREL — see "Sanitize module map");
  `i18n.ts`/`i18n.de.ts` = EN/DE strings; `nav-config.ts` = `AppView` list + nav labels.
- **task-manager decomposition map (Phase 3):** the orchestrator's cross-cutting clusters were
  extracted into **deps-object hook factories** (see "Extraction conventions") called
  unconditionally before the single return, plus two render helpers. The wiring lives in:
  `use-calendar-integrations.ts` (ALL Outlook push/pull/background-auto-sync for milestones +
  committee + task/raid/change/absence), `use-action-center-handlers.ts` (assign / mark-done /
  clear-blocker / reschedule / draft / escalate / rebaseline / create-task CTAs), `use-ai-orchestration.ts`
  (Analyze-with-AI + weight-suggestion context + scheduled-job runner), `shell-chrome.tsx`
  (`buildShellChrome` — a plain builder, NOT a hook — assembles BOTH header mounts), and
  `calendar-summary-modals.tsx` (the four two-way pull-summary modals). ★★ These three hook files are
  RENDER-SCOPE UI GLUE and are EXCLUDED from the coverage gate (`vitest.config.ts` `coverage.exclude`,
  same class as `.tsx`) — extracting a `use*` factory from task-manager into a NEW `.ts` file makes its
  handlers coverage-GATED, so either exclude the new file or expect a function-coverage drop. The
  task-manager→WorkspaceSection prop contract is pinned by `task-manager.characterization.test.tsx`.
- **Extraction conventions (Phase 3) — follow these by default for new work:**
  1. **Deps-object hook.** Cross-cutting orchestration extracted from task-manager takes a typed `deps`
     object of live render-scope values, is named `use*` and called UNCONDITIONALLY before the single
     return, and returns NON-memoized handlers (they read live scope each render). Pattern origin:
     `use-storage-file-ops.ts`; Phase-3 instances above. A JSX-only builder with NO hook calls is a plain
     `build*` fn (e.g. `buildShellChrome`), not a `use*`. ★ Such `.ts` hook files are coverage-gated —
     add them to `vitest.config.ts` `coverage.exclude` if they are pure UI glue (see the decomposition note).
  2. **Calendar bag.** A new calendar-capable entity threads ONE `EntityCalendarProps` on the pane
     contract, never five flat props. `outlookEventId` persists across the six write paths + is guarded by
     `entity-persistence-registry.test.ts`.
  3. **Per-entity CRUD hooks.** Entity save/delete handlers live in a dedicated per-entity hook
     (`useChangeLog` / `useStakeholders` / `useResourcePlanner`), NOT inlined in task-manager. Every save
     handler is a FUNCTIONAL setter (`setX(prev => …)`) — the bulk-edit "N saves in one tick" landmine.
     (A generic `makeEntityCrudHandlers` factory was evaluated and deliberately NOT built — the per-entity
     hooks already encapsulate divergent behavior; a uniform factory adds risk without cohesion.)
  4. **Shared SSRF core, per-route normalize.** A new external-API proxy REUSES `api/_shared/proxy-ssrf.ts`
     for the IP-classification + host-allowlist checks and hand-rolls only its route-specific
     normalize/auth/URL. Do NOT parameterize the divergent guard chains into one `createProxyHelpers`
     factory (parameterizing divergent security guards is where a config slip silently weakens a guard).
  5. **Panel split (gantt pattern).** A panel crossing ~700 lines splits into orchestrator + `*-rows` +
     `*-toolbar` (+ a `*-columns` leaf for shared metadata) BEFORE it crosses the 800-line ratchet — rows
     and toolbar are PURE presentational (data + handlers as props). Precedent: gantt, reports, raid-panel.
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
- **Action-Center grouping (slice 1):** pure i18n-free `next-actions/group.ts` `groupNextActions(actions)` collapses
  signals on the SAME entity into one `ActionGroup` (key = open-CTA `${cta.view}:${cta.id}`, else the action's own id
  so snooze-only ids never merge; `primary`=max-score, `extra`=rest, group `score`/`tier`=primary's). `computeNextActions`
  stays FLAT — grouping is SURFACE-ONLY; learning/notifications/AI keep the flat list. `actions-panel.tsx` caps Now/Soon
  at `MAX_VISIBLE_PER_TIER=5` with a show-more toggle.
- **Action-row layout (slice 2):** `action-row.tsx` shows tier as a coloured LEFT STRIPE (`TIER_STRIPE` →
  `border-l-[var(--rag-red)]` for now, with `--rag-amber`/`--rag-green` for soon/monitor — REPLACED the dot; RAG tokens
  switch under Mockup). ★ Write each tier's stripe token as its own concrete `var(--rag-NAME)` here; never collapse the
  family into one arbitrary-value bracket with a pipe or wildcard — Tailwind v4 scans AGENTS.md and an invalid char inside
  such a bracket compiles to broken CSS (globals.css 500s, e2e webserver times out). A single `⋮` overflow
  popover (Draft / Create-task / Snooze) reuses `usePopoverDismiss`; contextual popovers (Escalate/Assign/Rebaseline/
  Reschedule) stay INLINE (≤1 per row). Expandable "+N more reasons" renders the group's `extraReasons`. ★ the reasons
  panel is ALWAYS mounted + `hidden`-toggled (id `action-reasons-${action.id}`) so the `aria-controls` target stays in DOM.
- **`task-attention` provider (slice 3):** `next-actions/providers/task-attention.ts` (core, NO moduleId) flags active
  (`!isTaskFinished`) tasks: unassigned (`assignee` blank && `resourceId==null`), stale (`lastUpdateDate` ≥`STALE_DAYS=14`),
  blocked (`blockers` non-empty), dep-blocked (first unfinished `FS` predecessor only; `d.taskId!==task.id` self-dep guard,
  SS/FF/SF ignored). ★ the new `ActionSource` `"task-attention"` forced the exhaustive map `ACTION_SOURCE_LABEL`
  (→`actionSourceAttention`). (`ACTION_SOURCE_ICON` was REMOVED in the next-actions redesign — rows show no source icon.)
- **Inline resolve CTAs (slice 4):** Assign-owner (extends the RAID assign bundle to unassigned tasks, routes by `cta.view`),
  Mark-done (`applyStatusChange`), Clear-blocker, Reschedule (`reschedule-popover.tsx`). Handlers live in `task-manager`
  (functional `setTasks(prev=>…)`, `isPopout`→undefined, guarded on `cta.view==="open-points"`); threaded the 5-layer chain
  task-manager → `workspace-section-types` → workspace-section → `ActionsPanel` → `ActionRow`.
- **Next-actions surface (focus hero + action-first rows):** pure `next-actions/action-cta.ts` = `pickPrimaryCta`/
  `overflowCtas` (SINGLE source for a row's primary verb + ⋮ overflow; the `can*` predicates live here, consumed by
  `action-row.tsx` AND `action-hero-card.tsx`) + `TIER_RAG` (tier→stripe/dot token classes — ★ NO `text` variant, see
  landmine). Shared React controls in `action-cta-controls.tsx` (`ActionPrimaryCta`/`ActionOverflowMenu`/`useActionCaps`/
  `ActionHandlers`/`AssignOwnerBundle`, re-exported by `action-row`) render identical CTAs for the compact row AND the
  hero. Hero = `groups[0]`, shown only when `tier!=="monitor"`, DE-DUPED from its tier list (`g.key!==heroKey`).
  `action-reasons.tsx` = shared +N-reasons expander. Escalate/Rebaseline/Reschedule popovers + the assign button take a
  `prominent?` prop (hero = filled+larger via `action-cta-styles.ts` `popoverTriggerClass`; rows pass nothing → unchanged
  ghost). Source icon/pill GONE — source label is a bold prefix in the why-line; numeric score is `expertMode`-only.
  ★★ `--rag-amber-text` (=ui-purple / a brown) is AA ONLY on LIGHT AIPM — as SMALL text on `bg-surface` it FAILS AA on
  dark+mockup (3.5/4.4:1). Tier colour MUST ride the DOT/STRIPE (non-text, AA-exempt), never tinted small text (bit the
  tier count + hero eyebrow; both now muted). ★ the `actions` (Next actions) view is now in axe `A11Y_VIEWS` (hash-nav in
  `e2e/a11y.spec.ts` — Dashboard sub-child, sidebar entry may be collapsed at scan time).
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
- **Task editor is ONE floating surface now:** ALL layouts (modern DEFAULT, classic, popout) use the shared
  floating `TaskFormModal` (draggable/resizable/reset; its own `ModalHeader` title+✕). The former modern
  full-page `TaskEditView` (ModernShell `editView` slot / `useEditView`) was RETIRED — modern no longer
  replaces the shell with an edit page; the modal floats over the active view (which stays Open Points). New
  editor controls/heading wire into the modal header/footer. ★ The Delete button lives footer-LEFT +
  pink/destructive (mirrors `change-edit-modal`) via exported `TaskDeleteButton` (`task-editor-actions.tsx`);
  `TaskFormModal` takes a `deleteAction` prop (the old `TaskEditView` `footerLeading` path is gone).
  Dark-mode hover uses `dark:hover:bg-ui-pink/5`.
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
- **Open Points + Milestones toolbars = ONE flat wrapping row** (`flex flex-wrap items-center gap-2`, no
  `<h2>` heading/count) with the search input `flex-1` so it expands and pushes trailing controls right
  (mirrors the changes-panel toolbar). Tasks `PrintButton` is `iconOnly`. ★ Tasks "Clear all" opens a
  `TypeToConfirmDialog` (type `"yes, clear all tasks"`) — the shared `handleClearAll` (`use-bulk-operations.ts`)
  no longer self-confirms via `window.confirm`; the button path is dialog-gated. ★★ the VOICE `clearAll`
  command ALSO routes to the `TypeToConfirmDialog` now (no more one-click `window.confirm`): hook
  `requestClearAllConfirm?` → task-manager `setActiveTab("open-points")` + bumps a MONOTONIC non-null
  `clearAllRequestNonce` → tasks-section render-reconcile (handled seed = SENTINEL null so a FRESH mount
  HONORS a pending request) + `onClearAllRequestConsumed` resets the nonce→null. LANDMINE: seeding the
  handled-ref to the LIVE nonce is the remount-SWALLOW trap — a voice-clear fired from a non-Tasks view
  (TasksSection unmounted) is silently DROPPED; sentinel-seed + parent-clear for any "works-from-any-view" req. All saved-views controls (`panel-views-control`/
  `saved-views-control`/`reports-views-control`) use the standard `FOCUS_RING` (ring-2) — a bare
  `focus:ring-ui-green` sets colour only (no width) and is invisible.
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
  ★★ ROW-CONTEXT IS SPLIT to bound edit re-renders: the volatile `tasksById` (new Map on ANY edit) lives in
  a SEPARATE `RowLookupContext`/`useTaskLookup`, consumed ONLY by `DependencyChipsImpl` — a context consumer
  re-renders on value change REGARDLESS of an ancestor `memo` bailout, so an edit re-renders one dep-chip
  cell, not all 4×N row cells (context-bypasses-memo). Don't fold `tasksById` back into `RowContextValue`.
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
  ★ The name-column resize handle (in `GanttHeader`, `gantt-chrome.tsx`) renders the SAME 3-dot ⋮ grip
  glyph as the Open Points table but tuned for the LIGHT `bg-surface-muted` header (`text-muted-foreground/60`
  + `hover:bg-ui-dark-blue/10` + `hover:text-ui-dark-blue`) — NOT the shared `ColumnResizeHandle` (which
  uses dark-header `table-head-*` tokens). It's `role="button"` + aria-label, mouse-only (`onMouseDown`); the
  SVG child is `aria-hidden` so the accessible name stays the aria-label.
- **Reports module map:** `ReportsPanel` (`reports.tsx`) owns data + sort/column-resize state; pure
  i18n-free `reports-stats.ts` (`computeStats` + `Stats`/`GroupOrLabelRow`) and presentational
  `reports-tables.tsx` (`GroupOrLabelTable`, `AssigneeTable`, `Tile`, `Section`, `StackedBar` + shared
  `REPORTS_*_COL_WIDTHS` consts and `AssigneeSort`/`GroupOrLabelSort` types). One-way dep (reports →
  reports-tables → reports-stats); per-type report engines/panels (budget/raid/resource/stakeholder) live
  in their own files. Reports IS in axe `A11Y_VIEWS`.
- **Shared sortable/resizable header cell (`SortResizeTh<K>` in `report-table.tsx`):** the
  `<th className="relative px-3 py-2[ text-right] font-medium"> + SortHeaderButton + ColumnResizeHandle`
  trio every report panel repeated per column (top cross-file jscpd clones, TD-6) is now ONE generic
  component beside `SortHeaderButton`. `K` is fixed by the `sortKey` prop (the table's typed sort union),
  so `sortCol` must be a valid key and `onSort={click}` typechecks with no cast. ★ `resizeCol` (defaults to
  `sortCol`) + `width` are SEPARATE from `sortCol` — they diverge on the name/label column (sort key `name`,
  width/resize key `label`). `align="right"` picks the `text-right` variant; `hint` forwards to the
  `InfoTooltip`. Byte-equivalent DOM (Reports is axe-scanned). Used by raid-report (34) / resources-report
  (16) / change-report (6); `reports-tables`/`budget-report` use different local sort-var names and were left
  as-is. NON-sortable text-only header cells (no `SortHeaderButton`) keep their raw `<th>` + `ColumnResizeHandle`.

### Dashboard landing cockpit

**Layout = single masonry (CSS multicol, NOT a fixed grid).** `dashboard-panel.tsx` stays a thin
orchestrator (data derivation + the `computeDashboard` memo) and renders three zones: a full-width
HEADLINE (`DashboardDeltaStrip` · `NarrativeSummary` · `DashboardCoachingCard` · `DashboardTipCard` ·
`DashboardHero`) → ONE
masonry flow → a full-width FOOTER (`NarrativeEditor` · Recent-activity `<details>`).
★★ The masonry is a CSS multicolumn container — `columns-1 lg:columns-2 xl:columns-3 ${dc.sectionGap}`
(default `column-fill: balance` equalises column heights) — NOT `grid-cols-*`. Each card is wrapped in
`<div className="break-inside-avoid ${dc.cardGap}">` so no card splits across a column. This REPLACED the
old fixed `lg:grid-cols-2` bento, whose `items-start` + wildly uneven card heights trapped large
wide-screen voids (huge whitespace under the short KPI/Progress cards). ★★ Masonry only kills voids when
`#cards > #cols` (two cards in two columns is one-per-column = the void stays) — that is WHY the hero was
re-split: its KPI strip + Top-actions had to join the same flow as the other short/tall cards. Reading
order is column-major (top→bottom per column); cards are ordered priority-first. New density key
`dc.cardGap` (`mb-4` comfortable / `mb-2` compact) is the inter-card vertical margin (multicol ignores
`gap`/`space-y` between items). The Trends widget (`props.tursoActive`-gated `VarianceSummary`) is a masonry
card placed directly after Progress and is itself a click-through button → navigates to the Trends view
(`onNavigate("trends")`); the footer holds only the status-summary + recent-activity
`<details>`. ★ Tip-of-the-day (`DashboardTipCard`, `dashboard-tip-card.tsx` + pure English-only `tips.ts`)
is a dismissable headline card that rotates one tip per day; per-device `aipm-cockpit:tip-state` (next/dismiss),
popout read-only, day captured via lazy `useState` (purity — no `Date.now()` in render). The presentational slices:
- `dashboard-sections/dashboard-hero.tsx` (`DashboardHero`) — now ONLY the compact Overall RAG band +
  Adjust-health `<details>`; OWNS the `OverrideSelect` helper. Props trimmed to
  `{lang, today, model, status, setStatus, showBudget?, showChanges?, dc}` — `trends`/`topActions`/
  `onOpenAction`/`onNavigate` were REMOVED (they moved with the KPI/Top-actions cards).
- `dashboard-sections/dashboard-kpi-strip.tsx` (`DashboardKpiStrip`) — the 3 "at a glance" KPI tiles
  (complete % · overdue · open RAID, each with a `TrendArrow`); a standalone masonry card. Uses a
  `dc.cardPad` card wrapper (NOT `<Section boxed>`, which hardcodes `p-4` and ignores compact density).
- `dashboard-sections/dashboard-top-actions.tsx` (`DashboardTopActions`) — the ranked Top-actions queue;
  returns `null` when `!topActions?.length`, and the PANEL also gates its `break-inside-avoid` wrapper on
  `topActions?.length` so an empty queue leaves no dead `dc.cardGap` margin in the flow.
- `dashboard-sections/registers-band.tsx` — split into `RaidRegisterCard` (gated on `showRaid`) +
  `UpcomingCard`, two standalone masonry cards; the old combined `RegistersBand` wrapper was RETIRED.
- `dashboard-sections/dashboard-narrative.tsx` — `NarrativeSummary` (headline, read-only saved text,
  renders null when empty) + `NarrativeEditor` (footer folded `<details>`, owns the draft + autogrow + the
  render-time reconcile; the textarea carries an `aria-label`, NOT just a placeholder — axe).
★ ALL tier/card spacing uses `dc.*` density classes (`dc.outer`/`sectionGap`/`cardGap`/`cardPad`/`kpiGap`),
never literal `gap-*`/`space-y-*`/`p-*`/`mb-*`. `DashboardPanelProps` is unchanged by the reorg (the ~30
test/caller sites were untouched).

The Dashboard (`dashboard-panel.tsx`, owns `computeDashboard`) opens with a greeting + "since you last
looked" delta strip, then the ranked top-actions queue (promoted ABOVE the health band), with the four
RAG `OverrideSelect`s folded into a `<details>` "Adjust health ratings" disclosure. Dashboard IS in axe
`A11Y_VIEWS`. Built as slices:

- **Delta strip:** pure i18n-free `dashboard-delta.ts` (`computeDelta` diffs the activity log by
  `timestamp > lastVisitAt` + a prior RAG snapshot → `DeltaResult`; `buildGreeting`); per-project
  localStorage store `landing-state.ts`; hook `use-landing-delta.ts`; presentational
  `dashboard-delta-strip.tsx`. ★★ `landing-state.ts` is a per-BROWSER, per-PROJECT store (single key
  `aipm-cockpit:landing-state` → `{[projectId]: LandingState}` map, capped 50 most-recent) — NOT a Workspace
  field (zero backend write paths), OUT of exports/Turso, cleared by `clearAppConfig`'s `aipm-cockpit:*` sweep.
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
  MetricSnapshot` rides the SAME `aipm-cockpit:landing-state` map (zero new backend paths); guard accepts an
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
  `sparkline.tsx` (pure SVG `<polyline>`, `stroke-ui-dark-blue`, null for <2 points; optional `ariaLabel`
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
  `DashboardPanel` takes `density?` (default `"comfortable"`). ★★ ONE control now (the on-panel toggle was
  REMOVED): the SOLE density control is a `SegmentedControl<DashboardDensity>` in `AppearanceSection`
  (Settings→General), writing `settings.dashboardDensity?` (per-device, persisted via
  `setSettings`→`writeSettings` SPREAD — no allowlist edit, mirrors `tasksViewMode`). The panel just reads
  the `density` prop. ★ Settings→General is axe-scanned — SegmentedControl's `ariaLabel` keeps the gate
  green. ★ Compact-test asserts `.space-y-2` PRESENCE only (container-only; a global-absence check is
  brittle). i18n EN+DE.
- **Click-through:** `Tile` (`report-table.tsx`) gained an optional `onActivate`/`activateLabel` clickable
  variant (renders a real `<button>` — axe-safe name via `activateLabel`); pure i18n-free `activityViewOf`
  (`dashboard-activity-nav.ts`) maps an activity `kind`→`AppView`; KPI/progress/burn tiles + the completion
  sparkline launch their view via `onNavigate`, Top Changes rows + RAID register rows + horizon chips
  deep-link the item.
- **`Tile` `hint` tooltip (★★):** `Tile` (`report-table.tsx`) has an optional `hint?: string` that renders an
  `InfoTooltip` as a DOM **SIBLING** of the tile (`<div className="relative h-full w-full">{tile}<span absolute>
  InfoTooltip</span></div>`), NOT inside the `label`. Embedding an `InfoTooltip` (role=button) inside a CLICKABLE
  tile's label (Tile `onActivate` → `<button>`) is a **nested-interactive axe FAIL** — Dashboard is axe-scanned, so
  the dashboard cockpit tiles (which are click-through) MUST use `hint`, never a label-embedded tooltip. The wrapper
  needs `w-full` or hinted tiles shrink-to-content in flex rows (grid rows stretch regardless; flex rows don't). A
  NON-clickable tile can still embed a tooltip in its label node (budget-report pattern), but `hint` is the safe
  default. ★ tests that walk `getByText(...).closest("div.rounded-lg").parentElement` to reach a tile's row need one
  extra `.parentElement` hop when `hint` adds the wrapper.

- **Deep-link row flash:** shared `use-deeplink-row-flash.ts` — `useDeepLinkRowFlash(view)` (render-time
  reconcile sets `flashId` + a monotonic `flashSeq` nonce; an effect keyed on `[flashId, flashSeq]` does the
  rAF `scrollIntoView({block:"center"})` + a `DEEPLINK_FLASH_MS=1800` auto-clear; the nonce makes a same-id
  re-request re-fire) + `flashOutlineClass(isFlashed)`. Each of the five deep-linkable panels
  (raid/milestones/changes/stakeholders/tasks) attaches `containerRef` to its `overflow-auto` scroll
  container and adds `data-deeplink-row={id}` + `flashOutlineClass(flashId===id)` to rows; static
  `outline-ui-green` (no bg → never fights row `bg-*` state classes; palette-safe). Fires ALONGSIDE the
  editor-open effect and does NOT clear `pendingOpen` (the panel's own effect does — both fire in the same
  commit; the side-effect is keyed on `flashId` NOT `pendingOpen` so `clearPendingOpen` can't cancel the
  scroll/auto-clear). ★ The Kanban **board** is ALSO wired: `tasks-section.tsx` threads the SAME
  `containerRef`+`flashId` into `<TaskKanban>` (only one of table/board mounts at a time, so the single ref
  is free); `task-kanban-board.tsx` attaches `containerRef` to the outer `overflow-x-auto` div and adds
  `data-deeplink-row`+`flashOutlineClass` to each card `<article>` (card scroll works because the per-column
  vertical scroller is a descendant of the outer ref). ★ Graceful no-ops (no scroll/outline, never crashes;
  editor still opens): tasks **modern full-page edit** (list unmounted) + any row/card hidden by an active
  filter/search (`hideFinishedTasks`, milestone filters). ★ By-design limit: toggling tasks table↔board
  WITHIN the 1.8s window re-points the shared `containerRef` so the OUTLINE shows on the new view, but the
  scroll won't re-fire (`flashId`/`flashSeq` unchanged). ★★ v0.190.0: the modern task editor is now the
  FLOATING `TaskFormModal` (the full-page `TaskEditView` was retired), so the list/board stays MOUNTED under
  the editor and the IMMEDIATE `requestOpen`/`pendingOpen` render-reconcile + rAF scroll flash path covers
  `open-points` deep-links too (no editor-return special case). The old flash-only `pendingFlash`/
  `requestFlash`/`clearPendingFlash` return-path channel on `WorkspaceTabContext` + `task-manager`'s
  `flashOnEditReturnRef` were REMOVED (dead once the editor became a modal) — do NOT reintroduce them; there
  is no `pendingFlash` channel and no reserved `"edit"` AppView anymore. Classic/popout also uses the
  immediate path; all five panels show the flash in modern the same way.
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
  input → no metachar/`/s`-flag traps) renders matched segments as `<mark class="bg-ui-green/20
  text-inherit">` in result title+subtitle, query-mode only. Pure `search-recents.ts` (per-device
  `aipm-cockpit:search-recents`, `MAX_RECENTS=8`, validated load, pure `pushRecent` dedupe+cap) — recents shown
  when the box is focused with an EMPTY query, FILTERED to items still present in the live workspace; OUT of
  exports/Turso, cleared by `clearAppConfig`. Unified `items` list (recents on empty, results otherwise)
  drives the combobox; "Recent" header is a non-option `<div>` outside the `<ul>`. ★ PERF: `buildSearchIndex(ws)`
  scans+lowercases the 5 arrays ONCE (query-independent, memoized on the arrays); `searchIndex(index, query)`
  runs per keystroke. `searchWorkspace` kept as a thin back-compat wrapper. Gantt uses the same shape — a
  `Map<taskId,haystack>` memo keyed on `[tasks]` ONLY (do NOT bundle the search text into the prefs memo, or
  every keystroke busts the whole `visible` memo).
- **RAID edit modal map:** `RaidEditModal` (`raid-edit-modal.tsx`) owns draft, query state, derived option
  lists, add/remove handlers; presentational `raid-risk-matrix.tsx` (`RiskMatrix` 5×5 picker, Risk items
  only) and `raid-edit-fields.tsx` (`RaidLinkedTasksField`, `RaidCausedByField` — the two chip-picker
  sections, threaded handlers/state as props). RAID IS in axe `A11Y_VIEWS`.
- **Shared edit-modal chrome (`edit-modal-chrome.tsx`):** three presentational atoms the change/raid/
  stakeholder edit modals repeated verbatim (top cross-file jscpd clones, TD-6): `ModalFieldError` (the
  `<p role="alert">` ui-pink banner — caller keeps the `{error && …}` guard), `StakeholderChipPicker` (the
  linked-stakeholders checkbox chip list — caller keeps its own field-visibility gate; change + raid),
  `ModalEditFooter` (bordered footer, destructive delete left + cancel/submit right — change + stakeholder;
  takes `deleteConfirmKey`/`deleteLabelKey`/`deleteAriaLabelKey?`/`deleteDisabled`/`saveDisabled`/
  `saveLabelKey`). ★ RAID's footer stays BESPOKE (border-less + `InfoTooltip`, no submit-disabled) — divergent,
  deliberately NOT folded in. Presentational only; edit shared modal markup/a11y HERE.
  ★ `EditModalShell` (the resizable/draggable panel + `ModalHeader` + backdrop, in `modal.tsx`) is now used by ALL
  SIX edit-modals — change/raid/stakeholder + absence/milestone/resource (adopted 0.190.39). It takes defaulted
  `widthClassName`/`formClassName` (defaults = the wide 720px two-column form), so a modal overrides ONLY when it
  diverges (the three newly-migrated ones pass a 560px width; milestone passes a single-column form). Changing a
  default here shifts every non-overriding adopter — keep the defaults == the pre-0.190.39 hardcoded values.
- **Stakeholder Influence/Interest map drag:** `stakeholder-map-panel.tsx` chips drag between the 2×2 quadrants
  (native HTML5 DnD, no lib). Pure i18n-free `applyQuadrantMove(s, quadrant)` in `stakeholders.ts` uses
  **preserve-Medium**: high side → "High"; low side demotes only a "High" → "Medium", keeps existing Medium/Low;
  returns `null` on a no-op drop. ★ round-trips are NOT identity (Low → keep-satisfied → monitor yields Medium — the
  2×2 can't express Medium so a demotion out of the high band lands there). Gated on the panel's `onSaveStakeholder`
  prop (omitted → read-only popout mirror, chips not draggable); reuses `handleSaveStakeholder` (functional setter +
  `localModifiedAt` stamp + `stakeholder.updated` log). Chips stay plain (no level badge). The map is NOT in axe
  `A11Y_VIEWS` — drag is a mouse enhancement; the edit modal's High/Med/Low selects are the keyboard path.
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
  views, so changes there re-scan them. ★ The two tab-navigation strips (primary tablist + sub-tablist)
  live in `workspace-section-chrome.tsx` (`WorkspaceTabStrip`, presentational, move-only Phase 3 split);
  the router file keeps only the tabpanel switch. Routing pinned by `workspace-section.characterization.test.tsx`.
- **RAID panel module map (gantt pattern):** `raid-panel.tsx` is the orchestrator (state, derivation, edit
  modal); the toolbar is `raid-panel-toolbar.tsx` (`RaidToolbar`), the table is `raid-panel-rows.tsx`
  (`RaidTable`), shared column metadata is the leaf `raid-panel-columns.ts` (`RAID_COL_WIDTHS`/`RAID_CONFIG_COLS`).
  Both presentational pieces are PURE (data + handlers as props). ★ Two brittle source-scan guard tests read
  the file the markup MOVED to: the add-before-search order test → `raid-panel-toolbar.tsx`; `table-head-sweep`
  → `raid-panel-rows.tsx` (same precedent as `gantt-chrome`).
- **Shared calendar toolbar controls:** the two-way Outlook toggle+push+pull toolbar block (duplicated
  verbatim across the RAID / Change / Absence toolbars — only the entity aria-label differed) is one shared
  `CalendarSyncControls` (`calendar-sync-controls.tsx`), keyed by an i18n `entityLabelKey`. Renders null
  unless `m365Configured && !isPopout && onToggleCalendar`. Milestone push/pull stays SEPARATE (manual-only,
  no enable toggle).
- **Portfolio health (Turso-only cross-project rollup):** view `portfolio-health` (`portfolio-health-panel.tsx`,
  lazy). Uses the STANDARD resizable content-pane shell (`VIEW_PANE_RESIZABLE_CLASS` +
  `useResizable("aipm-cockpit:portfolio-health-size")` + `ResetSizeButton`; header OUTSIDE the bordered scroller,
  `print-root print-landscape`) — the empty/loading/error states stay full-fill (`VIEW_PANE_FILL_CLASS`).
  Pure `portfolio-rollup.ts` (`aggregatePortfolio`/`deriveMilestoneHealthBucket`) + hook
  `use-portfolio-health.ts`: for each portfolio project it does `new TursoBackend(cfg, projectId).load()` then
  runs the pure `computeDashboard` → per-project RAG/completion/openRAID/milestone rows + aggregate KPIs.
  ★★ Loads SEQUENTIALLY — `TursoBackend.load()` embeds `CREATE TABLE IF NOT EXISTS` DDL OUTSIDE the write
  lock, so parallel loads contend → `SQLITE_BUSY` (the "read-only load" assumption is FALSE). ★★ total
  failure (every project errors) surfaces an error (`PORTFOLIO_LOAD_FAILED`), NOT the empty state (else an
  outage reads as "no projects"). ★ budget RAG needs a REAL plan (period-key alignment) → pass budgets ONLY
  when `ws.plan` exists, never against the placeholder `FALLBACK_PLAN`. ★ effect deps: `configKey` must
  include the authToken (token rotation reloads); `holidaySet` (a Set) via a derived content key. ★ all four
  `computeDashboard` call sites (this hook, dashboard-panel, task-manager snapshot + render model) assemble
  their input via the shared `buildDashboardInput(entities, ctx)` in `dashboard.ts` (one place for the
  14-field shape + `?? []` array defaults); callers do their OWN gating (feature-off / no-plan budgets)
  BEFORE building — pass `[]` for a gated-off entity.
- **UI shell:**
  • **Help view:** `help` AppView in the SYSTEM nav group below Settings (help-circle icon). `HelpView`
  (`help-view.tsx`, STATIC import — it takes function-valued callbacks like `onStartTour`/`onNavigateView` and
  `dynamic()` strips function props under the RSC serializable-props rule) renders the SHARED backbone `help-content.ts` (`HELP_ENTRIES`:
  HelpGroup `concepts`/`workflows`/`features`/`automated`, EN/DE, `relatedViews`/`relatedConcepts` for later
  SPs) GROUPED — grouped TOC + group headers (`HELP_GROUP_LABEL`, exhaustive `Record<HelpGroup>`) + per-concept
  "Related:" links. The floating top-bar Help panel stays features-only via the
  derived `HELP_SECTIONS` (`help-sections.ts` was renamed to `help-content.ts`).
  ★★ `help-content-pane.tsx` (shared by the in-pane view AND the floating panel) renders each concept
  as a CARD (`border-l-ui-dark-blue` stripe, no shadow) on a `bg-surface-muted` scroller, with a wider `w-56`
  TOC driven by an `IntersectionObserver` SCROLL-SPY (effect dep = a hoisted scalar `sectionIdsKey` join, NOT an
  array; observer callback sets `activeId` — not render-phase setState). ★★ IN-PANE `HelpView` is its OWN TABBED
  surface: a `role=tablist` in the header beside the search box with tabs **Help · Guided tours · How it connects ·
  Information flows** (arrow-key roving, `FOCUS_RING`, `activeTab` drift guard); clicking a tab swaps the body and
  ONLY the active tab's body mounts (single shared `role=tabpanel` `#help-view-panel`). Search renders on the Help
  tab ONLY. Tours tab gated on `onStartTour` (modern-only) → 3 tabs in classic/popout/tests. Connects-tab concept
  click → `goToConcept` switches to Help + bumps a nonce; a nonce-keyed effect `scrollIntoView`s (no
  `set-state-in-effect` — `scrollTarget` never cleared). The catalog props (`catalogTours`/`completedTours`/
  `onStartTour`) thread `task-manager → WorkspaceSectionProps → workspace-section → HelpView`, REPLACING the dead
  `onTakeTour`. In-pane view is resizable (`useResizable` key `aipm-cockpit:help-view-size`) + carries Print/Reset-size
  buttons. ★★ FLOATING panel (`help-menu.tsx`) is CONTENT-PANE ONLY (`HelpContentPane` + its own search box; props
  `{lang}` only — NO tabs, NO tour catalog); the `helpIntro` slogan + footer "Take a tour" button are GONE (footer =
  license link only). Floating `useResizable` key `aipm-cockpit:help-size-v3`.
  `InformationFlowsSection` has an optional `maxWidth` (default 480 keeps Settings byte-identical; the in-pane flows
  tab passes 720). jsdom
  lacks `IntersectionObserver`/`scrollIntoView` → global no-op stubs in `vitest.setup.ts`. ★ Adding `help` to `AppView` forced FOUR edits (tsc/runtime): `CORE_VIEWS` (`feature-modules.ts`
  — else `filterNavGroups` prunes it), `LABEL_KEYS` + `navLabelKey` (`nav-config.ts`), `ICON_PATHS`
  (`nav-icons.tsx`, exhaustive `Record<AppView>`), + i18n `navHelp`. NOT a popout tab. Not in `A11Y_VIEWS`
  (the sidebar entry IS scanned every view; eye-verify the page).
  • **Contextual per-view callouts (Help SP2):** a slim dismissable banner atop each WORKING view — a novice
  one-liner + "Learn more →" deep-linking the matching Help concept. Pure `view-callouts.ts`
  (`VIEW_CALLOUTS: Partial<Record<AppView, {textKey, conceptId}>>`, ~14 views; `conceptId` in `HELP_ENTRIES`
  concepts — guard test) + per-device dismiss store `view-hints-store.ts` (`aipm-cockpit:view-hints`, out of
  exports/Turso, cleared by `clearAppConfig`'s `aipm-cockpit:*` sweep). Presentational `view-callout.tsx` is
  PROPS-only (`view`/`lang`/`showHints`/`isPopout`/`onLearnMore`) — NOT context-consuming, because the
  TasksSection/Kanban unit tests render outside `WorkspaceTabProvider` (a `useWorkspaceTab()` there THROWS).
  Self-hides when: no `VIEW_CALLOUTS[view]` / `!showHints` / `isPopout` / dismissed. Mounted in
  `workspace-section` (after the `ActionChips` strip — covers all routed views) AND `tasks-section`
  (open-points renders separately; gated `{onLearnMoreHint && …}` so the bare unit test stays unaffected).
  ★ workspace-section's mount is gated `{activeTab !== "open-points" && …}`: in CLASSIC both surfaces mount at
  once, so without the guard the open-points callout double-renders (mirrors the adjacent ActionChips
  open-points `[]` guard). The Learn-more arrow is `aria-hidden` (label-bleed rule).
  ★★ "Learn more" deep-links via a NEW `workspace-tab-context` string channel `requestHelpConcept(conceptId)`
  (mirrors `requestChat`: `setActiveTab("help")` + `pendingHelpConcept`, NO hash write); `HelpView` consumes
  it via OPTIONAL props `pendingHelpConcept`/`onHelpConceptConsumed` (optional so the standalone
  `help-view.test.tsx`, which has no provider, is unchanged) using the render-reconcile + nonce-effect pattern
  (mirrors `useDeepLinkRowFlash`; no `set-state-in-effect`). Global on/off: `settings.showViewHints?` (default
  ON, read `!== false`) — a `SegmentedControl` in Settings → Appearance, persisted via the `writeSettings`
  spread (no allowlist edit, mirrors `dashboardDensity`). Many mount views are axe-scanned (banner buttons are
  labeled, palette-safe — verified). Dashboard EXCLUDED (has coaching + tip cards). ★ A loose
  `getByText(/changes/i)` in `dashboard-panel.test` collided with the date-rotating tip card's "Changes" text →
  scope such queries to a `heading` role, not free text.
  • **Interactive relations map (Help SP3):** a node graph of the Help CONCEPT entries (edges =
  `relatedConcepts`), now the "How it all connects" TAB of the Help-view accordion (was a `<details>`). Pure
  i18n-free engine `relations-graph.ts` `buildRelationsGraph(entries)` → `{nodes:[{id,titleKey,x,y}],edges:[{a,b}]}`:
  deterministic **VERTICAL single column** (concepts only; shared `x=0.5`, `y` evenly `TOP=0.08..BOTTOM=0.92`; no
  RADIUS), edges undirected + deduped (sorted `"a|b"` key), no self-loops; no `Date`/`Math.random`.
  Presentational `relations-map.tsx` uses the ★★ OVERLAY technique: a `<ul>` of flow rows, each a dot
  `<span aria-hidden>` + a real `<button>` (keyboard-native, axe-clean interactive layer), plus a decorative
  `aria-hidden` `<svg viewBox="0 0 24 100">` in the LEFT GUTTER drawing edge `<path>` bezier curves (control-point
  `bow` CLAMPED ≤11 so it stays in the viewBox; green when incident to the active node, else `stroke-line`). Local `useState(active)` from hover AND focus highlights incident edges (`stroke-ui-dark-blue`,
  dim the rest) + neighbour buttons; click → `onSelectConcept(id)` → HelpView `scrollToSection`. Concept-only —
  view navigation lives in the Related line: SP3 upgraded each entry's `relatedViews` from a plain italic `<span>`
  to a navigate `<button>` gated on a NEW OPTIONAL `HelpView` prop `onNavigateView?: (view:AppView)=>void` (optional
  ⇒ standalone `help-view.test.tsx` unchanged), wired `workspace-section` → `setActiveTab(v)`. Help is NOT in axe
  `A11Y_VIEWS` (map keyboard-focus/contrast + SVG positioning EYE-verified; jsdom rect=0 so tests assert
  structure/handlers/`data-active`, not pixels). i18n EN+DE; `helpRelationsGoToView` uses positional `{0}`.
  • **Themed guided tours (Help SP4):** the single onboarding tour became a CATALOG of 6 themed
  tours (`getting-started` · `raid` · `reporting` · `planning` · `stakeholders` · `ai`). Pure engine
  `app-tour.ts` gained `TourDefinition`/`TourCatalogEntry`/`TOURS`/`findTour`; the old flat `TOUR_STEPS`
  is KEPT as an export (= `getting-started`'s steps; `tour-overlay.test` imports it). `visibleSteps`
  is now `(steps, features)` (was `(features)`) — drops a step whose `view` is a disabled module.
  `use-tour.ts` tracks `activeTourId` (`start(tourId?)` defaults `getting-started`, preserving
  auto-launch + HelpMenu), exposes `catalogTours` (tours with ≥1 visible step) + `completedTours` +
  `activeTourTitleKey`; `done()` appends the active id to `settings.completedTours` (functional
  `setSettings`), `skip()` sets `tourSeen` only. Per-device `settings.completedTours?: readonly
  string[]` rides the `writeSettings` spread (no allowlist edit, sanitized on load, capped 50), OUT of
  exports/Turso, cleared by `clearAppConfig`'s `aipm-cockpit:*` sweep; `tourSeen` STILL gates first-run
  auto-launch separately. Presentational `tour-catalog.tsx` (props-only, no context — standalone
  unit-tested) renders a card grid as the "Guided tours" TAB of the Help-view accordion (was a `<details>`),
  gated on `onStartTour` presence (mirrors the `onTakeTour` gate) so standalone tests / classic / popout don't
  render it — tours stay modern-only. ★ `TourCatalogEntry` now also carries `stepCount` + `iconView: AppView`
  (projected in `use-tour.ts` `catalogTours` from `visibleSteps(...).length` + a new `TourDefinition.iconView`);
  each card shows a `NavIcon` badge (or green ✓ when done), a step-count meta line (`tourStepCount`), and a
  Start/Replay CTA (`tourReplayCta` when completed — the card's `aria-label` tracks that verb, WCAG 2.5.3).
  Threaded task-manager → `WorkspaceSectionProps` (3 new OPTIONAL fields) → HelpView. `TourOverlay`
  gained an optional `tourTitleKey` label. Help is NOT in axe `A11Y_VIEWS` → catalog a11y eye-verified
  (`tour-catalog` uses the `INTERACTIVE` atom + `text-ui-green-strong` for the ✓-Done badge — there is
  NO `text-ui-green-text` utility token).
  • Default landing view is `dashboard` (`workspace-tab-context.tsx` initial `activeTab`); `useHashView`
  also lands a fresh/empty hash ("" or bare "#") on `dashboard` (not the `slugToView` "open-points"
  fallback), so opening the app at `/` goes to the Dashboard home. Deep-links + reload-on-a-view still honour the hash.
  • Nav: `actions` (Next actions) + `trends` are SUB-MENU children of `dashboard` in the Overview group
  (`nav-config.ts`); `trends` is in `TURSO_ONLY_VIEWS` so the Trends sub-entry only shows on a Turso backend.
  ★ TURSO_ONLY child views are pruned in TWO places: `filterNavGroups` (sidebar) AND `subTabsFor(view,
  features, onTurso)` (classic sub-tab row, pass `trends.active`) — gate BOTH for a new turso-only child,
  or it leaks into the classic sub-tab row on file backends.
  • **Focus/keyboard a11y (modern shell, all modern-only — classic has no sidebar):** `use-focus-trap.ts`
  (`useFocusTrap(ref, active, onEscape)`) is the app's FIRST real focus trap — ★★ `onEscape` MUST be a
  stable `useCallback` or the effect re-focuses the first element every render. **Mobile off-canvas drawer**
  (`modern-shell.tsx`, `<1024px` via `useMediaQuery(SIDEBAR_NARROW_QUERY)`): the hamburger opens the EXPANDED
  sidebar as a `role=dialog aria-modal` overlay + backdrop (`bg-ui-dark-blue/50`) + trap; Escape/backdrop/nav
  close. ★ drawer content UNMOUNTS when closed (no phantom off-screen tab stops); ★ a stale `drawerOpen` is
  reset via a render-time reconcile (`if (!isNarrow && drawerOpen) setDrawerOpen(false)` — NOT an effect);
  ★ `Sidebar` gained `toggleAriaLabel?` so the drawer relabels its toggle as the dialog CLOSE
  (`sidebarCloseMenu`, WCAG 2.5.3), and opening the version modal from the drawer closes the drawer first
  (one trap at a time). **`CollapsedNavFlyout`** (`sidebar-nav.tsx`): a collapsed-rail parent-with-children
  becomes an `aria-haspopup` trigger opening a `usePopoverDismiss` popover of parent+children (roving arrows/
  Home/End, Escape→trigger) so nested views stay reachable from the icon rail; caret dot + collapsed urgency
  dot (`bg-ui-medium-grey`/`bg-ui-pink`). **`resource-calendar.tsx`** is the app's FIRST `role=grid` 2-D
  roving grid (Arrow ±day/±assignee, Home/End, Ctrl+Home/End, PageUp/Down ±7; ★ clamp-on-read `focusRow/
  focusCol` so a window shrink keeps EXACTLY one tab stop; keydown guards on `document.activeElement` being a
  `[data-cell]` so the assignee row-header keeps its own arrow keys; `default: return` before `preventDefault`
  so Tab still escapes). Calendar sub-tab is NOT axe-scanned (Resources default sub-tab = directory).
  • Steering committee panel uses the STANDARD resizable content-pane shell
  (`VIEW_PANE_RESIZABLE_CLASS` + `useResizable("aipm-cockpit:steering-size")` + `ResetSizeButton`, header OUTSIDE
  the bordered scroller).
  • Dashboard has NO on-panel density or Trends toggle (both removed + unwired). Density is set ONLY via
  Settings → Appearance (`settings.dashboardDensity`); the dashboard Trends card is Turso-gated
  (`props.tursoActive`), not toggled. The `ReportCard` `toolbarExtra` slot is unused on the dashboard now;
  the report date sits on the "Overall" line.
  • `settings.showDisplayTzSwitcher?` (per-device, default **false**) gates the top-bar `displayTzSwitcherEl`
  — both header mounts share the ONE gated element.
  • Task-editor actions render ONLY in the editor surface (the floating `TaskFormModal` footer), NEVER the
  top bar — `ModernShell` takes no `editActions`/`primaryAction` for the edit case.
  • `task-jira-badge.tsx` = SHARED Jira badge, TWO variants via `readOnlyProject?: boolean`: read-only project →
  padlock + `jiraSyncedReadOnlyProject` title/aria; two-way → sync-arrows glyph + `jiraSyncedTwoWay` (link variant
  when `href`). Used by BOTH the Kanban card and the table row; takes everything as PROPS (board renders outside
  RowContextProvider). ★ Callers pass `readOnlyProject={isReadOnlyIssue(task.jiraKey, {projectKey, extraProjects})}`
  — the SINGLE classifier (see multi-project Jira bullet); an unknown/removed project reads read-only.
  • Settings-section deep-link is GENERAL: dashboard `onNavigate(view, section?: SettingsSectionId)` →
  task-manager `onOpenSettingsSection(section)` → `settingsSectionRequest` → SettingsView. `SettingsSectionId`
  (mirrored in `dashboard-coaching.ts`) is a SUBSET of settings-view `SectionId`.
  • **Backend setup wizard:** `backend-setup-wizard.tsx` (4-step modal: Storage & connections → AI → Jira
  → Review; integration steps skippable; Review summarises configured/not-configured for storage/M365/AI/
  Jira/Timelog, driven by pure `backend-setup-steps.ts` — `BackendSetupStepKey`, `BACKEND_SETUP_STEPS`,
  `clampStep` (re-exported from `app-tour`), `summarizeBackendSetup`). ★ NO dedicated Timelog/M365 step:
  step 1 reuses the WHOLE `IntegrationsSection` (which already renders storage+Turso+M365+Timelog), so a
  separate step would duplicate the form. Step bodies: IntegrationsSection, AiSection, JiraSettingsSection;
  threads the SAME `settings`+`onChangeSettings` — no new persistence path. ★ Wizard passes
  `IntegrationsSection hidePortfolioSwitch` so the portfolio "Save & switch" `window.location.reload()`
  can't nuke a create-project draft. Shared `WizardStepIndicator` (`wizard-step-indicator.tsx`) de-dups
  the two wizards' step rails. Two launch points: Settings → Integrations ("Run setup wizard" button) and
  the new-project empty-state window's "Backend setup" section (alongside "Configure database / M365"),
  both gated `{wizardOpen && …}` (fresh mount per open → step resets). NOT launched from inside the
  CreateProjectWizard (the project-creation flow) — that header carries the step indicator only.
  `isPopout`-gated (never shown in pop-outs). `SettingsView` gained an `isPopout` prop threaded from
  task-manager. `onMigrateToTurso` is threaded ONLY on the Settings launch (no existing workspace to
  migrate in create-project / empty-state).
  • ★★ **Shared `Modal` (`modal.tsx`) STACKS — topmost-only Escape/Tab.** A module-level `modalStack` of
  per-instance Symbol tokens; only the last-opened modal handles Escape/Tab, so a nested modal (wizard
  opened from inside the create-project modal) no longer double-fires Escape and dismisses the parent.
  LANDMINE (bit twice): the keydown effect must depend on `[open]` ALONE and read `onClose` via a ref —
  if it deps `[open, onClose]`, an unstable parent `onClose` identity (re-created each render/keystroke)
  re-runs the effect and re-pushes that modal's token to the top → wrong modal becomes topmost. Push/pop
  lives in a SEPARATE `[open]`-only effect (order = mount order). Regression-tested in `modal.test.tsx`.
  • **Info-flows diagram** (`settings-sections/information-flows-section.tsx`) has **9 nodes** in two
  colour-coded zones (AIPM tokens): *Your data* (green) = Local/IndexedDB, **File storage** (JSON/CSV/MD),
  Turso; central Browser-app hub; *Connected services* (dark-blue) = Jira, Timelog, **SharePoint**, **Outlook**,
  Anthropic — M365 SPLIT into SharePoint (docs) + Outlook (contacts/calendar). Option-B tight-horizontal SVG
  (`Node`/`Zone` helpers, `role=img`+`aria-label`+`<title>`/`<desc>`; node text hardcoded EN, legend `<dl>` +
  zone-swatch row use i18n). Rendered in BOTH Settings → Integrations AND the Help-view accordion (same
  component, two mounts).
  • **Dual-CI / style axis:** ★ Phase 2 SUPERSEDES this axis — `data-style` is now the CONSTANT `"custom"` and
  AIPM/Mockup are read-only BUILT-IN SCHEMES (see the scheme bullet below); the CSS-role-token MECHANISM here
  still stands, only its source moved (scheme maps, not per-`data-style` CSS blocks). `data-style` (formerly
  `"AIPM"|"mockup"|"custom"`) on `<html>` is ORTHOGONAL to `.dark`; set by
  `use-style.tsx` (`useCiStyle`, `aipm-cockpit-style` localStorage, NOT the settings blob) + the no-flash boot script
  (`boot-theme-script.ts`, reads `aipm-cockpit-style`+`aipm-cockpit-theme`+the scheme boot keys pre-paint). Mockup ("Dashboard" style) is
  LIGHT-ONLY + PINS light: `use-style` fires a `aipm-cockpit-style-change` event; `use-theme` is the SOLE `.dark`
  writer and re-applies on that event (switching back to AIPM restores dark). ALL style difference is CSS
  role tokens in `globals.css`: `--rag-red/amber/green` (+ `-text` AA variants — ★ but `--rag-amber-text` is AA only on
  LIGHT AIPM; as SMALL text on `bg-surface` it FAILS AA on dark/mockup, see the Next-actions surface bullet), `--table-head-bg/-fg`,
  `--table-head-accent` (sort-button active/hover), `--shadow-card/-control/-card-hover`, `--gradient-kpi`,
  `--rag-green-chip`/`--rag-red-chip` + `--delta-chip-pad` (KPI delta pills), `--segment-track-bg/-active-bg/-active-fg`. AIPM values
  reproduce the old look; ★ Phase 2: AIPM-dark + Mockup no longer live in a `.dark` /
  `:root[data-style=mockup]` CSS block (both REMOVED) — they now ride their SCHEME maps, and `globals.css`
  `:root` is the static AIPM-LIGHT no-JS fallback only. RAG flows through `health.ts` (`healthDot`/`healthText` →
  `--rag-*` / `--rag-*-text` token families (e.g. `bg-[var(--rag-red)]`, `text-[var(--rag-green-text)]`)). `--gradient-kpi` is APPLIED to the completion-% gauge
  (`KpiGradientBar` in `report-table.tsx`, the Tile `bar` slot) — AIPM `var(--ui-green)` solid, Mockup the
  red→amber→green gradient (inline `style`, the ONLY legal gradient path). It is the SOLE "more=better"
  visual; NEVER apply to effort/usage bars (more=worse — gradient inverts the signal). Shadows/gradients
  legal ONLY via tokens (e.g. `shadow-[var(--shadow-card)]` — use the `--shadow-*` token family); `shell-palette-guard` bans raw
  `shadow*`/`drop-shadow`/`bg-gradient-` via strip-then-ban.
  ★★ `shell-palette-guard` + `palette-chrome-sweep` scan the WHOLE SOURCE incl. COMMENTS: the bare word
  "shadow" or a literal `--shadow-card` in prose (a JSDoc/comment) trips RAW_SHADOW (only the
  `shadow-[var(--…)]` className form is stripped first) — reference the token obliquely in comments.
  `bg`/`border`/`divide-ui-light-grey` + `text-ui-dark-grey` are BANNED chrome greys (`text-ui-light-grey`
  is fine) — use `bg-ui-medium-grey` for a neutral dot/fill. The axe gate (`e2e/a11y.spec.ts`) scans
  EVERY shipped combo: AIPM-light, AIPM-dark, Mockup-light, Harbor(custom)-light, Harbor(custom)-dark
  (5 × A11Y_VIEWS), seeding
  `aipm-cockpit-style`/`aipm-cockpit-theme` via `addInitScript` — ★ Phase 2: it must ALSO seed `aipm-cockpit:color-schemes` `activeId`
  to the scheme under test, else `syncScheme` overwrites the boot paint on mount (scheme landmine 4). Appearance
  Style switch disables the theme control while Mockup (a light-only scheme) is active.
  ★★ ANY RAG-semantic color (status values, KPI deltas, win/loss, stacked-bar segments — NOT just the
  dots) MUST use the `--rag-*`/`--rag-*-text` tokens, never raw `text-ui-green`/`-pink-strong`, or it
  won't switch under Mockup (bit trend-arrow / reports-tables / StackedBar / budget / raid-report).
  ★★ Data-table header sort buttons (`report-table` SortHeaderButton, used by every `SortResizeTh` — now
  the Open Points table too, `SortableTh` was RETIRED into it) use `text-[var(--table-head-accent)]` for
  active/hover — raw `text-ui-green` is sub-AA (2.03:1) on the
  Mockup light header AND a blanket `.aipm-cockpit-thead button{color}` rule silently kills the sort affordance.
  ★★ A TRANSLUCENT role-token tint (`rgba(...)`) over a parent whose bg CHANGES on hover (e.g. a `Tile`
  button's `hover:bg-surface-muted`) RE-composites darker → its TEXT can drop below AA on hover. The axe
  gate scans RESTING state only, so it PASSES. Use OPAQUE pre-composited tints — `--rag-green-chip`/
  `--rag-red-chip` are opaque hex (NOT rgba) for exactly this (bit the KPI delta chips).
  ★★ PURPLE TEXT on a purple tint needs `--ui-purple-strong` (light `#7a2d72`, dark `#d98cc8`), the AA
  companion mirroring `ui-pink-strong`/`ui-green-strong` — plain `text-ui-purple` (#aa4899) on
  `bg-ui-purple/10` is 3.6:1 (bit the AI-consent block). Bright `ui-purple` stays for fills/borders.
  ★★ A `-strong` text token tuned AA on `bg-surface` can still FAIL on the lighter `bg-surface-muted` —
  dark `--ui-pink-strong` was bumped `#e5497c`→`#e96089` so overdue pink text clears AA on a Kanban
  card (`bg-surface-muted`), not just on `bg-surface`. Brightening a dark text token only RAISES contrast.
  ★★ A STRUCTURAL style diff that must stay an AIPM no-op (padding/size, not color) can't ride a Tailwind
  class (a class isn't token-toggleable). Put it in a token applied via INLINE STYLE, gated on presence:
  e.g. `--delta-chip-pad` (AIPM `0` ⇒ byte-identical; Mockup pads the pill), `style={chip ? {padding:
  "var(--delta-chip-pad)"} : undefined}` — so AIPM is untouched AND a chip-less (flat) trend gets no empty bubble.
  • **★★ RELEASE B (token rename, 0.190.23):** the palette token NAMES were renamed `AIPM-*`→`ui-*`
  everywhere — Tailwind classes (`bg-AIPM-green`→`bg-ui-green`), CSS var names (`--AIPM-green`→`--ui-green`),
  the `@theme` map (`--color-AIPM-*`→`--color-ui-*`), scheme registries (`CORE_TOKENS`/`VALID_TOKENS`/
  `DERIVED_TOKENS`), the shipped `public/themes/*.json` color KEYS, and the palette guards. The 12 base
  tokens are `ui-{dark-blue,green,green-strong,pink,pink-strong,purple,purple-strong,blue,white,dark-grey,
  light-grey,medium-grey}`. The var NAMES + `@theme` MECHANISM are otherwise unchanged (only the prefix);
  Phase-2 text below that says `--AIPM-*` now means `--ui-*`. PRESERVED (NOT renamed): `AIPM` (company /
  theme display name), `Acme`/`AIPM-consult` (host/email), `public/themes/AIPM.json` + gallery id
  `"AIPM"` (the AIPM THEME identity), `AIPM-logo`/`AIPM-icon` (asset classes). NO key migration — a stored/
  exported scheme with legacy `--AIPM-*` color keys drops to the Harbor fallback (no active users).
  • **★★ RELEASE A (theme decouple, 0.190.22) SUPERSEDES the "FIVE built-ins" claim below:** AIPM + Mockup
  LEFT the code built-ins and now ship as self-contained importable theme files `public/themes/AIPM.json` +
  `mockup.json` (full portable format — light/dark/`structural`/branding/pinned AA tokens). `BUILTIN_SCHEMES` =
  **[harbor, meridian, umber]** only. An in-app **Theme gallery** (`theme-gallery.tsx`, mounted in
  `AppearanceSection` beside the scheme editor) fetches `/themes/*.json` → widened `importScheme` → `addScheme`
  + `updateScheme({dark,structural})` → a removable user scheme. Fresh install picker = Harbor/Meridian/Umber;
  AIPM/Dashboard are opt-in imports. NO migration (no active users) — an orphaned `activeId "AIPM"/"mockup"`
  Harbor-falls-back via reconcile. `ICC_SEED`/`MOCKUP_SEED` + their structural maps DELETED from
  `scheme-tokens.ts` (AA derivation uses a neutral `FALLBACK_SURFACE`); `globals.css :root` is now the
  **Harbor-resolved-light** no-JS fallback (the var NAMES are now `--ui-*` after Release B; `@theme` map
  structure UNCHANGED). Portable format widened: `exportScheme`/`cleanScheme` carry `structural`
  (via `cleanStructural` + `STRUCTURAL_TOKENS`, `isSafeRawCssValue`-gated) + the 7 pinned derived tokens;
  `updateScheme` accepts a `structural` patch. Scheme editor base/reset = `HARBOR_LIGHT`; its old
  "New from AIPM/Mockup" buttons → one "New from current theme". ★★ e2e axe `a11y.spec.ts` now READS
  `public/themes/*.json` and seeds AIPM/Mockup as **USER schemes** (not the empty-`schemes[]`+built-in-activeId
  shortcut — they're no longer built-ins) to keep the 5-combo matrix. — The Phase-2 text below still describes
  the MECHANISM (data-style/scheme apply/structural), just not the built-in ROSTER.
  • **Scheme-driven color schemes (Phase 2 — AIPM + Mockup ARE built-in schemes):** the AIPM/mockup/custom
  `data-style` AXIS COLLAPSED — `data-style` is now the CONSTANT `"custom"` (`use-style` always writes it;
  `CiStyle.style` is always `"custom"` in normal operation). AIPM + Mockup JOINED Harbor/Meridian/Umber as
  READ-ONLY BUILT-IN schemes → FIVE built-ins in `BUILTIN_SCHEMES` (`builtin-schemes.ts`; ids
  `"AIPM"`/`"mockup"`/`"harbor"`/`"meridian"`/`"umber"`, undeletable via `BUILTIN_SCHEME_IDS`). Harbor stays
  the fresh-install DEFAULT (`DEFAULT_SCHEME_ID`). A scheme carries `{ light, dark?, supportsDark, structural?,
  builtIn? }` (user ids `"u-<n>"`); apply is INLINE `documentElement.style.setProperty` (the legal runtime
  mechanism — NEVER a Tailwind class, so palette-sweep is untouched). ★★ STRUCTURAL (NON-color) token group:
  `ColorScheme.structural?` = 7 tokens (the `--shadow-card/-control/-card-hover` family + `--gradient-kpi`,
  `--delta-chip-pad`, `--rag-green-chip`, `--rag-red-chip`) defined in `scheme-tokens.ts`
  (`STRUCTURAL_TOKENS`/`ICC_STRUCTURAL`/`MOCKUP_STRUCTURAL`), applied via `applySchemeStructural`
  (`scheme-apply.ts`); each raw value is gated by `isSafeRawCssValue` — a charset allowlist plus a denylist
  blocking `url(` / `expression` / `image-set` / `;` / braces / `@` / angle brackets / backtick. Mirrored to
  boot key `aipm-cockpit-active-scheme-structural` (NOT `aipm-cockpit:`-prefixed → boot reads it pre-paint like
  `aipm-cockpit-active-scheme-colors`; consequently NOT swept by `clearAppConfig` — intentional, mirrors the colors
  key). ★★ `globals.css`: `:root` is KEPT as the STATIC no-JS / pre-boot AIPM-LIGHT fallback (colors +
  structural); the old `.dark` TOKEN block AND the `:root[data-style="mockup"]` block were REMOVED — AIPM-dark +
  Mockup now ride their SCHEME maps. `.dark` REMAINS a class toggle (Tailwind `dark:` utilities). ★★
  `resolveSchemeColors` is now BASE-WINS (`{...deriveAaVariants(colors), ...colors}`): derivation only FILLS
  missing AA variants; an explicitly PINNED `-strong`/`-text`/`muted-foreground` SURVIVES — that is why
  AIPM/Mockup reproduce the shipping look exactly (landmine 1). ★★ `effectiveDark(themeDark, schemeSupportsDark)`
  DROPPED the `style` arg; pin-light = `!activeScheme.supportsDark` (Mockup `supportsDark:false`, honours theme
  for a dark-capable scheme). `use-theme` (sole `.dark` writer) reads `data-scheme-dark` ONLY — the mockup
  `data-style` branch is GONE. `use-style.syncScheme` stays the SOLE apply path (resolves for the CURRENT theme,
  applies inline, mirrors both boot keys + `data-scheme-dark`). ★★ EVENT WIRING (order-independent, unchanged):
  `use-theme` recomputes `.dark` on `aipm-cockpit-style-change` ONLY; a theme flip dispatches `aipm-cockpit-theme-change` →
  `use-style` re-resolves; a SCHEME switch (`aipm-cockpit-scheme-change`) runs `syncScheme` FIRST then re-dispatches
  `aipm-cockpit-style-change` — do NOT make `use-theme` listen to `aipm-cockpit-scheme-change` (the fixed race). ★★ Boot script
  (`boot-theme-script.ts`, imported by `layout.tsx`) ALWAYS writes `data-style="custom"`, paints scheme colors
  AND structural, and EMBEDS the resolved AIPM/Mockup/Harbor maps so a legacy-first-boot device migrates without
  a Harbor flash. `use-style` ONE-TIME-migrates a legacy `aipm-cockpit-style="AIPM"/"mockup"` → the scheme activeId (in
  the lazy `useState` initializer) then writes `aipm-cockpit-style="custom"`. `layout-boot-script.test.ts` PINS the EXACT
  boot string + runtime-evals it — edit boot ⇒ update that guard in lockstep. ★★ AppearanceSection: the scheme
  `<select>` routes ALL ids (incl AIPM/mockup) through `selectScheme` (NOT `setStyle`); `pinsLight =
  !activeSupportsDark`; the editor is ALWAYS mounted (built-ins read-only via `BUILTIN_SCHEME_IDS` —
  Rename/Delete/Apply disabled, tweak + Save-as-new to customise); global app-name/footer inputs shown when the
  active scheme owns no branding (built-ins), HIDDEN for a branded user scheme. `reconcileBuiltins` remains the
  SOLE `activeId` validator (re-seeds built-ins from code, keeps user schemes + activeId; else
  `DEFAULT_SCHEME_ID`) — `loadSchemes`/`setActive` must NOT validate (built-ins aren't in the raw store).
  ★★ NO-FLASH SINGLE-SOURCE: EVERY editor mutation (select/save/import/rename/delete/apply) writes the boot
  key(s) + applies, so the active library scheme == what renders (the boot keys are purely DERIVED); mutating
  one channel without the other is the coherence bug (selecting did nothing / a deleted scheme's colours
  lingered). Schemes OWN slogan/footerSlogan (apply REPLACES via `mergeAppliedBranding`); logo/favicon stay
  GLOBAL. Derived `-strong`/`-text`/`muted-foreground` tokens are dropped on save (`cleanColors`). USER schemes
  are still light-only THIS PHASE (editor edits `.light`); built-ins carry both maps. Pure modules:
  `scheme-tokens.ts` (registry + AIPM/MOCKUP seed+structural maps, `deriveAaVariants`, `resolveSchemeColors`),
  `scheme-contrast.ts` (WCAG warn-only), `scheme-apply.ts` (colors + structural apply/read/write helpers),
  `color-schemes.ts` (per-device `aipm-cockpit:color-schemes`, hex-validated). Selection hook
  `use-color-schemes.ts` (coverage-excluded).
  ★★ FIVE Phase-2 landmines (do NOT reintroduce):
  (1) `resolveSchemeColors` is BASE-WINS — a built-in that must reproduce an exact hand-tuned value PINS it in
  its light/dark map; derivation only fills gaps. Flipping back to derived-wins silently OVERWRITES AIPM/Mockup
  pinned `-strong`/`-text`/`muted-foreground`.
  (2) Mockup's `-strong` tokens were NOT overridden by the (now-removed) `:root[data-style=mockup]` CSS — they
  cascaded from `:root` (AIPM). So `MOCKUP_LIGHT` MUST PIN `ui-green/pink/purple-strong` to
  `#4d7000`/`#c41e5a`/`#7a2d72`, else `nudgeToAa` re-derives WRONG values (review-caught regression).
  (3) AIPM scheme maps FLATTEN tokens that were `var(--surface)` in globals (e.g. `--segment-track-bg`) —
  `ICC_SEED` hardcodes `#ffffff`; `ICC_DARK` MUST re-override `--segment-track-bg: #121619` (dark surface) or
  the segmented control is white-on-near-white in dark (axe AA fail). Audit any seed-flattened chrome token
  when adding a dark map.
  (4) e2e axe seed: seeding the boot keys is NOT enough — `syncScheme` re-resolves from `aipm-cockpit:color-schemes`
  on mount and OVERWRITES the boot paint. The axe seed MUST also set `aipm-cockpit:color-schemes` `activeId` to the
  scheme under test (empty `schemes:[]` is fine — `reconcileBuiltins` injects built-ins).
  (5) The palette guards do NOT scan the `.ts` scheme data files (`shell-palette-guard` = fixed shell-file
  list; `palette-chrome-sweep` = `.tsx` only), so structural shadow/gradient STRINGS in
  `builtin-schemes.ts`/`scheme-tokens.ts` don't trip them — no allowlist needed.
- **Scrollbar gap:** per-view inner scrollers (`min-h-0 flex-1 overflow-auto`) need `pr-2` for the
  content↔scrollbar gap. Shared `INNER_TABLE_CLASS`/report-table/actions-panel already include it; bare
  per-panel scrollers do NOT — add `pr-2` or content jams the scrollbar.
- **Print:** `globals.css @media print` scopes printing to a `.print-root` subtree (`body * {visibility:
  hidden}`; only `.print-root` shows) — a view WITHOUT `print-root` prints BLANK. To make a view printable:
  add `print-root` (+ `print-landscape` for wide tables) to its outermost pane (alongside the `VIEW_PANE_*`
  class); add `<PrintButton lang={lang}/>` (from `task-manager-ui`; defaults to `window.print()`, already
  labeled + `print:hidden`) to the toolbar — LEFT of any Reset buttons (resets stay rightmost); `print:hidden`
  the toolbar/filters/bulk-bars (keep the data table + section title visible).
  `ColumnResizeHandle` is already `print:hidden`. ★★ The `@media print` block (a) anchors `.print-root` at
  `position:absolute; top:0; left:0` + `height:auto !important` (so a user-dragged `useResizable` inline size
  can't clip the printout) — NOT `inset:0` (a `bottom:0` pins the abs box to ONE PAGE height → content past
  page 1 is CLIPPED; the single-page-print bug); (b) GLOBALLY resets every `.print-root [class*="overflow-"]`/
  `[class*="max-h-"]` descendant to `overflow:visible !important; max-height:none !important` (inner scrollers
  otherwise print a scrollbar AND clip to their box = one page) — so per-panel `print:max-h-none
  print:overflow-visible` is now REDUNDANT; (c) strips rounded container chrome via `.print-root
  [class*="rounded"][class*="border-line"] {border:0; border-radius:0}` (`divide-line` row-lines + `rounded-full`
  RAG dots untouched). Guarded by `e2e/print.spec.ts` (print-media emulation: asserts 0 clipping scrollers, 0
  rounded boxes, box contains full content). Don't reintroduce `inset:0` or a per-pane print clip. Data views (tasks/milestones/changes/
  stakeholders/RAID/resources/
  knowledge/history/steering/portfolio/RACI/timelog) + the ReportCard views are wired; Settings/Chat/Projects
  are not (nothing to print).
- **Branding (per-device `settings.branding {logo?, slogan?, footerSlogan?, favicon?}`):** rides the
  `writeSettings` spread (no allowlist edit); validated by `sanitizeBranding` — logo/favicon must be a
  size-capped RASTER `data:image` URL (SVG EXCLUDED — XSS surface), slogan/footerSlogan trimmed+capped. Edited
  in Settings → Appearance. `logo` overrides the sidebar logo — ★ a custom logo renders WITHOUT
  `brightness-0 invert` (that filter only whitens the mono AIPM default); `slogan` = sidebar app-name subtitle;
  `footerSlogan` = bottom footer tagline (default `DEFAULT_FOOTER_SLOGAN`, seeded into
  `defaultSettings.branding`). `favicon` drives the document `<link rel=icon>` via `useApplyFavicon`/
  `applyFavicon` (`use-favicon.ts`) — captures the build-time default ONCE so a remove restores it. Sidebar +
  classic `AppHeader` + `app-modals` footer read branding via `useSettings()`. CSP already allows `data:` in
  `img-src`. Default sidebar logo is `/app-logo.svg` (mono mark, whitened by `brightness-0 invert`); classic
  header uses it un-inverted (light header).
- **Footer bar / page scrollbars (★★):** the footer (`app-modals.tsx`, `!isPopout`) is `position: fixed`
  bottom-right ON PURPOSE — `modalsBlock` is an in-flow SIBLING of the `h-screen` ModernShell, so an in-flow
  footer adds height > 100vh → a page VERTICAL scrollbar. Keep it fixed (out of flow) + `pointer-events-none`;
  both layouts reserve a `pb-6` bottom gap. Related: the shell root is `w-full`, NOT `w-screen` (`100vw`
  includes the scrollbar width → spurious HORIZONTAL scrollbar).
- **Settings sections:** each window shows a uniform pane `<h2>` (its rail label); `mode`/`templates`/
  `commTemplates` are excluded (they self-head + carry an intro line). Appearance is its OWN rail section
  (un-folded from General; General now folds only Storage).
- **Feature-module guidance (Settings → Functions):** `mode-section.tsx` renders each `FEATURE_MODULES`
  toggle with an optional `descKey` description under the label (use case + when to enable). ★ Adding a
  module ⇒ give it a `descKey` + EN/DE i18n string (all 12 now have one). ★★ a11y: the description is a
  SEPARATE `<span id>` linked via `aria-describedby` — do NOT nest it inside the `<label>` (that folds it
  into the checkbox's accessible name and breaks exact-name `getByRole` queries). The checkbox `id` +
  `aria-describedby` ids are `useId`-scoped so a settings pop-out can't collide.
- **Knowledge view (renamed from Documents, v0.190.0):** the `documents` AppView + feature module were
  renamed to `knowledge` across nav / help / operating-guide / i18n, and the files renamed
  (`documents-panel`→`knowledge-panel`, `document-meta`→`knowledge-meta`, `documents.ts`→`knowledge.ts`,
  `document-links-field`→`knowledge-links-field`; user strings read "Knowledge" / "Wissen"). ★★ The persisted
  per-entity **`documentLinks`** field + its CSV/MD/Turso COLUMNS are INTENTIONALLY LEFT on the wire — the
  rename is view/feature-only, NO serialization change, golden fixtures unchanged. Do NOT "fix" `documentLinks`
  to `knowledgeLinks` (that's a six-write-path + golden-regen migration for zero benefit). ★ Two back-compat
  migrations preserve existing users: `sanitizeFeatures` maps a stored `documents` module id → `knowledge`,
  and `slugToView` maps the legacy `documents` hash slug → `knowledge` (canonical slug is now `knowledge`;
  `#documents/<id>` deep-links still resolve). ★ The shared TS type is `KnowledgeLink` (was `DocumentLink`),
  with an OPTIONAL `linkKind: "document" | "confluence" | "url"` emitted ONLY for confluence/url (a document
  link — the default + every legacy link — omits it, so serialization stays byte-identical); `linkKindOf(link)`
  resolves the effective kind (absent ⇒ "document"). NOTE the pre-existing `kind` field already means the
  SharePoint item shape (file/folder) — the new field is `linkKind` to avoid that collision. The add-link form
  has a type selector (Web URL / Confluence page / Document); confluence/url are stored as ordinary
  `isSafeHttpUrl`-validated links (no fetch to store) with a kind-appropriate icon; `fileTypeOf` takes the kind
  (kind wins over the file heuristics).
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
  `focus:outline-none focus:ring-2 focus:ring-ui-green`), `TRANSITION` (`transition-colors duration-150`),
  `PRESS` (`active:translate-y-px`), and `INTERACTIVE` = all three. Palette-safe by construction (no color but
  the brand ring; no shadow/gradient). ★ Apply ADDITIVELY — append the atom AFTER the control's own color
  classes; convert a plain-string `className` to a template literal. ★ Buttons get `${INTERACTIVE}`; FORM
  FIELDS (`<input>`/`<select>`/`<textarea>`) get `${FOCUS_RING} ${TRANSITION}` ONLY — never PRESS (a 1px
  translate on a field is wrong). ★ A control that ALREADY has a complete `focus:ring-2` keeps it — add motion
  only (`${TRANSITION} ${PRESS}`), don't re-add the ring. ★★ Do NOT override a BESPOKE SEMANTIC focus ring
  (invalid-state `ui-pink`, consent `ui-purple`, critical-path toggle) with the green `FOCUS_RING` — leave
  those, add motion only. ★ Weak legacy `focus:ring-1 focus:ring-ui-green` fragments are normalized to the
  `ring-2` standard. The shared report/table primitives (`Tile`/`SortHeaderButton`/`TableFilter` in
  `report-table.tsx`, `task-manager-ui.tsx` tabs/reset/print/sort) already carry the atoms.
- **Design-system primitives (USE these; do NOT hand-roll — see the no-handroll rule):** the
  DS-sprawl program (0.190.2–0.190.35) built a full primitive layer. Reach for the primitive
  (or adapt it); ASK before introducing a new control. Controls: `Button` (`button.tsx`;
  primary/secondary/ghost/destructive × xs/sm/md, `ref`-forwarding, `cursor-pointer` base, folds
  `AddButton`), `IconButton`/`TextButton` (icon-only / inline action-link, both ref-forwarding),
  `Input`/`Select`/`Textarea`/`Checkbox` (`form-controls.tsx`; `size` md/xs, `invalid` prop,
  `<Textarea autoGrow>`), `SegmentedControl`, `ToggleButton`. Surfaces: `Modal`/`ModalHeader`/
  `EditModalShell` (`modal.tsx` — owns backdrop + focus-trap/restore + Escape + topmost-only
  stack; default tint `MODAL_BACKDROP_CLASS` = `bg-ui-dark-blue/40`; initial focus seeds the FIRST
  focusable child, not the un-ringed root), `PopoverPanel` (portal dropdown), `Card` (polymorphic
  `as`), `Banner` (auto-derives live-region role from severity). Empty/table:
  `EmptyState`/`AddFirstItemButton`/`Skeleton`/`PanelSkeleton`, `DataTable` + `SortResizeTh`/
  `SortHeaderButton`/`ColumnResizeHandle`. Display: `RagDot`/`RagBadge`, `Badge`, `CountBadge`,
  `ProgressTrack`, `FieldError`/`ModalFieldError`/`FieldHint`, `InfoTooltip`, interaction atoms
  `INTERACTIVE`/`FOCUS_RING`/`TRANSITION`/`PRESS` (`interaction-styles.ts`).
  ★★ LANDMINES: primitives concatenate `className` with NO tailwind-merge → a class that fights a
  variant/size PROP loses by CSS source-order (pick the right variant, don't override); ONLY
  `Button`/`IconButton`/`TextButton` forward `ref` — `Input`/`Select`/`Textarea` do NOT (a
  ref-needing field stays bespoke); `PopoverPanel` is RIGHT-ALIGN-ONLY + `onClose` must be a stable
  `useCallback` + `anchorRef`→the trigger button; a growable textarea needs `autoGrow` (the
  primitive forces `resize-none`). ★ Deliberately BESPOKE (not sprawl — don't migrate): help-menu
  (draggable window), project-switcher / ask-claude-menu (menu/dialog popovers), colConfig popover,
  filled-semantic one-offs (chat pink Stop, purple consent w/ bespoke ring).
- **Shared consolidation modules (Tier E, 0.190.39) — reuse these, do NOT re-hand-roll:**
  • **`device-store.ts`** = `readDeviceJson<T>(key, fallback)` / `writeDeviceJson(key, v)` / `removeDeviceKey(key)` —
  the SSR-guard + try/catch JSON envelope EVERY per-device `aipm-cockpit:*` store uses (the store keeps its OWN
  validation/cap/dedupe on the parsed result). ★ `writeDeviceJson` SWALLOWS quota throws — a store that must
  PROPAGATE a write failure (scheduled-jobs / operating-guide) keeps its own throwing writer and adopts device-store
  for READS only; a raw-non-JSON store (reminder-snooze stores a bare number) doesn't use it at all.
  • **`capped-list-store.ts`** = `createCappedListStore<T extends {id;name}>(key, max, sanitizeList, {capOnLoad?})`
  → `{load, add, remove, rename, save}` (`add` mints max-id+1, cap keeps the LAST `max`) built ON the device-store
  envelope; saved-views + reports-views adopt (`capOnLoad:true` vs default false). panel-views (per-VIEW cap) +
  search-recents (dedupe) stay bespoke — don't force them in.
  • **`ai-forced-call.ts`** = `runForcedToolCall({apiKey, model, system?, tools, toolName, messages, maxTokens, signal?})`
  — the ONE audited never-log one-shot forced-tool Anthropic envelope (key is header-ONLY; response body read only via
  sanitized `safeAiErrorType`/`safeAiErrorMessage`; `!ok`→`AiHttpError` with STATUS-only message; absent tool_use →
  `Error("parse")`). ★★ EVERY new one-shot forced-tool call routes its fetch through this (scheduled-job-analysis,
  weight-suggestion-call, task-dedup-call, committee report-call, digest-narrative, use-project-proposal already do);
  each caller keeps its OWN parse/ground/coerce. ★ the multi-turn agentic `callClaude` (chat) is NOT a forced call —
  do NOT fold it in.
  • **`use-draft-state.ts`** `useDraftState<T>(initial|null)` → `{draft, setDraft, update, error, setError}` — LOCAL-draft
  edit-modals only (absence/milestone/resource); the parent-owned-draft modals (change/raid/stakeholder call `onChange`,
  no local state) correctly do NOT use it. **`use-task-picker-options.ts`** `useTaskPickerOptions(tasks, selectedIds,
  query, extra?)` wraps `filterPickerOptions` for the change/raid task pickers (raid's self/cycle CAUSE picker stays
  separate). **`EntityPaneCalendarHintsProps`** / `EntityPaneHintsProps` interface mixin (`workspace-section-types.ts`)
  — change/raid extend calendar+hints, stakeholders is hints-ONLY (no calendar). **`guardTurso()`** = the
  isPopout+`tursoConfigNow`+toast preamble, a non-memoized local helper in `use-storage-turso-ops.ts` (switch keeps its
  extra `tursoProjectId===id` guard inline). jira **`parseIssueFields`** in `api/jira/_helpers.ts` (create/update issue
  routes share the field-sanitize; the SSRF/auth/URL guard stays per-route).
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
- **Add-first-item empty state (clickable dashed box):** when an entity panel has ZERO items (truly empty,
  NOT filtered-empty), render a full-width clickable dashed `<button>` that adds the first item — NOT the
  `EmptyState` primitive. Style (shared by budget · gantt · milestones · changes · stakeholders · raid · open-points):
  `flex w-full flex-col items-center gap-2 rounded-(lg|md) border border-dashed border-line p-(6|10)
  text-center text-sm text-muted-foreground hover:border-ui-dark-blue hover:text-ui-dark-blue
  dark:hover:text-ui-light-grey ${INTERACTIVE}` with two spans: the descriptive empty text + a
  `font-medium` "+ <Add X>…" line; `onClick` = the panel's create handler (`openNew`/`addBucket`/`onAddTask`/
  `setTaskModalOpen(true)`). ★★ NO SOLID OUTER BOX: the box sits UNWRAPPED (gantt look) — the panel's
  bordered scroller (`INNER_TABLE_CLASS` / `rounded-(md|xl) border border-line`) is made CONDITIONAL
  (`className={count===0 ? undefined : SCROLLER}`) so it borders only the DATA view; the empty box is the
  scroller div's sole child at natural height. Gantt's DATA view IS bordered — only its empty state is
  unwrapped; mirror that. ★ RAID's box is category-filter-aware (`openNew(effectiveCategory)`) + carries the
  `raidAddItem` aria-label so it's the add affordance the inline-add tests click.
  ★ For TABLE panels (changes/stakeholders/raid/open-points) the box REPLACES the `<table>` (`{count===0 ? box : <table>}`),
  and the in-table FILTERED no-matches row stays (headers give context); the truly-empty `<td>` row is
  removed. ★ FILTERED-empty + popout (no create handler) fall back to the plain text box (gantt) or the
  no-matches row (tables) — never a dead add affordance. ★ Test gotcha: the box's "+ Add X…" text collides
  with the header add-button on a `getByRole("button",{name:/add x/i})` query — render WITH one item when
  asserting the header button. ★ Knowledge uses the clickable box too — it opens the add-link panel
  (`setAddOpen(true)`; manual-link entry needs no SharePoint). ★ Activity is fully FLAT: the data-view
  scroller has NO border (border dropped per request) and the empty/no-match states are natural-height dashed
  boxes (`flex-1` dropped) — read-only, no add affordance. ★ Steering
  committee is a FORM (no empty state) — its content scroller is flattened (border removed) always. This
  SUPERSEDES the older "use EmptyState, not a dashed-div" rule for the add-first-item case (EmptyState still
  stands for read-only "no data" messages).
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
  size is discarded (pane stays resizable from the new baseline). Bit Milestones/Knowledge going full-width.
- **Rounded table headers:** `TABLE_HEAD_CLASS` carries a `.aipm-cockpit-thead` marker; the Dark-Blue fill lives on
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
  rewrite the generated file (don't move the write to top level). ★★ the generator NORMALIZES its output to
  LF (`out.replace(/\r\n/g,"\n")`) and `.gitattributes` pins `operating-guide-builtin.generated.ts` to
  `eol=lf` — WITHOUT this the emitted file mixed CRLF (template-literal lines on a Windows autocrlf checkout)
  with LF (`JSON.stringify`), so `prebuild` regeneration showed phantom line-ending drift. Don't drop either.
  Prebuild regenerates; the
  `operating-guide-builtin.test.ts` sync-guard re-parses the md + `toEqual`s the committed array (drift fails
  CI; keep the test's `VALID_VIEWS` == the generator's, == nav-config `AppView`). ★ Adding a section: TAG it
  (`<!-- views: … -->`) with REAL AppView ids — `parseFeatureGuide` THROWS on an unknown id AND on an untagged
  non-Overview section. Seeded by `use-operating-guides` `builtinSeeds()`/`reconcileBuiltins()`: on every load
  it refreshes built-in content/name/scope but PRESERVES the user's `enabled`/`priority` (no toggle-clobber on
  upgrade); all built-ins undeletable via `BUILTIN_IDS`. `selectActiveGuides` loads overview + the current
  view's guide into the cached prompt prefix (view change re-caches that slice). Guide content is
  ENGLISH-ONLY (no i18n). Knowledge only — adds NO new AI tools.
- **AI model picker:** `CHAT_MODELS` (`settings-types.ts`) is the SINGLE source for the dropdown; `ChatModel` is widened to
  `string` (open — pick any live model), sanitized on load by `/^claude-[\w.-]+$/` (≤64 chars, else `defaultAiConfig.model`).
  `use-chat-models.ts` `useChatModels(apiKey, enabled, currentId)` → `{options, loaded}` fetches Anthropic
  `GET /v1/models?limit=1000` browser-direct (live `claude-*` newest-first; key never logged). ★★ v0.165: NO
  offline pre-fill — `buildModelOptions(reg, live, currentId, {registryAsBase:false})` keeps the dropdown EMPTY
  (bar the current selection, still registry-labelled) until a live poll SUCCEEDS; `loaded` gates the
  `aiModelNeedsKey` hint (`ai-section.tsx`). Pure
  `chat-models.ts` `buildModelOptions`/`isValidAnthropicApiKey` (format `sk-ant-…`). ★ the AI key seals only when
  format-valid and is DISCARDED on blur with a toast (`ai-section.tsx`).
- **AI write tools:** tool SCHEMAS (`TOOL_DEFS` + per-entity field-property helpers `taskFields`/`raidFields`/…
  + `ALL_RAID_STATUSES`) live in pure `chat-tool-defs.ts`; `chat-tools.ts` re-exports `TOOL_DEFS` (so
  `chat-api` imports it unchanged) and holds `runTool` routing + the `ToolDispatcher` type + arg-coercion/
  summary helpers; tools are IMPLEMENTED in `use-chat-dispatcher.ts`. Tasks/RAID/Changes/Milestones/
  Stakeholders all have create/update/delete; Resources now have create/get/update/delete + list
  (`create_resource`/`get_resource`/`update_resource`/`delete_resource`/`list_resources` — a task assigned to a
  name is NOT a directory entry; the AI must create the resource to populate the directory. `delete_resource`
  is filter-and-set with NO cascade — dangling `resourceId`/`ownerResourceId`/`resourceIds[]` refs are left as-is,
  mirroring the UI delete. Reference data — roles/disciplines/grades — has NO AI tools; assign a role via `roleId`).
  NEW entity write tool: add tool def (in `chat-tool-defs.ts`) +
  runTool case + `ToolDispatcher` method, then implement in the dispatcher `useMemo` — guard
  `if (args.isReadOnly) throw readOnlyError()` FIRST (popouts must not mutate), build the raw object and run
  it through the entity's `sanitizeX` (the SINGLE validator — `sanitizeRaidItem` enforces enums/dates/caps +
  per-category RAID-status defaulting), id = `nextEntityId(ref.current)` (max+1), then update BOTH the ref AND
  call `setX` (ref keeps back-to-back tool calls consistent). `runTool` write cases use
  `requireId`/`patchWithoutId` (strips `id` from the update patch — a destructured `_id` would trip the
  no-unused-vars rule).
- **Inline "Ask Claude" edit (SP1):** a per-item edit popover (✨ hover icon on the task table row + Kanban
  card, or the row menu) takes a natural-language instruction and INVERTS the chat loop: ONE bounded
  `callClaude` call proposes tool calls but nothing executes yet. Pure `inline-ai-edit/plan.ts`
  `describeToolCalls` turns the returned tool_use blocks into a preview `EditPlan` (field diffs + related-item
  creates — RAID/change/milestone/stakeholder) the user reviews before Confirm; Confirm replays each call
  through the EXISTING `runTool` dispatcher (same per-entity `sanitizeX`), so it's plan-then-apply layered ON
  TOP of the chat tool schemas — ZERO new AI tools, Workspace fields, or backend write paths. New modules:
  `inline-ai-edit-call.ts` (the bounded call), `use-inline-ai-edit.ts` (the propose→preview→confirm/cancel
  state machine), `inline-ai-edit-popover.tsx` (the UI), `use-tasks-inline-ai-edit.tsx` (tasks-pane glue — a
  `.tsx` hook, coverage-EXCLUDED like the other Phase-3 glue hooks, keeping `tasks-section` under the size
  ratchet). Gated `isAiEnabled && !isPopout && !task.jiraKey`. ★ a request-generation nonce discards a stale
  proposal/confirm if the popover is reopened with a new instruction before the in-flight call resolves. Logs
  a new `ai.inlineEdit` activity kind. Wired into `task-row.tsx` (`RowContextValue`) + `task-kanban-card.tsx`
  (props — the board renders outside `RowContextProvider`, see the Kanban board bullet above).
- **AI "Deduplicate & unify tasks" (Open Points):** a toolbar action that PROPOSES duplicate merge groups,
  the user reviews/confirms, then it applies — plan-then-apply layered ON TOP of the existing task path (ZERO
  new AI tools, Workspace fields, or backend write paths). Pure i18n-free contract in `task-dedup/dedup.ts`
  (compact task digest → forced `propose_task_merges` tool schema → parse the UNTRUSTED model output →
  ★★ `groundMergeGroups` RE-GROUNDS every keep/merge id against the LIVE task list, so a hallucinated id can
  NEVER touch a real task); the non-hook `runDedupProposal` (`task-dedup-call.ts`) mirrors
  `scheduled-job-analysis.ts` EXACTLY (ONE forced call, no agentic loop, NEVER logs/echoes the apiKey or
  response body — thrown errors carry only HTTP-status + safe body tokens). `use-tasks-dedup.tsx` is the
  propose→preview→confirm/cancel state machine (a `.tsx` glue hook, coverage-EXCLUDED like the other glue
  hooks); `task-dedup-modal.tsx` is the review modal (per-group deselect). ★★ Confirm folds the duplicates +
  applies the KEEP task's sanitized unified fields via a FUNCTIONAL `setTasks(prev=>…)` updater and records
  ONE undo entry (removed duplicates + edited keeps). Gated `isAiEnabled && !isPopout && tasks.length >= 2`;
  no duplicates → toast; usage-limit / API errors surface via the shared `classifyAiError`. New `ai.taskDedup`
  activity kind + EN/DE strings. Wired into the Open Points toolbar (`tasks-section.tsx` → `task-manager`).
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
  assistant" (`BackendConfigModal` `children` + `AiSection hideUsage`). ★ The proposal seed NOW includes a
  `resources` list (`ProposalSeed`/`PROPOSAL_TOOL`/`TemplateSeed` all carry it) so the AI populates the
  directory; `remapSeed` id-maps the seeded resources and LINKS task `resourceId` / RAID `ownerResourceId` /
  stakeholder `resourceId` by case-folded name (or email) — an unmatched owner stays a plain-string assignee
  (FK undefined/null). When NO resources are seeded the person FKs are cleared exactly as before. Resource
  already round-trips all six paths, so no new write path / golden regen.
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
- **Create-project multi-upload:** `step0-import-panel.tsx`'s file path takes `<input multiple>` → classifies + size-gates
  each into ONE `ProposalContent` (`MAX_IMPORT_FILES=10`, invalid/over-cap files skipped with a notice). A Timelog-style
  BLOCKING loading modal with a Cancel button aborts the in-flight call via a shared `AbortController` (`abortRef`);
  `generate(input, signal?)` + the wizard's `onIngest`/`runIngest(content, signal?)` forward the signal. ★ during the fast
  local READ phase `abortRef` is null so Cancel is a no-op.
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
  (`suggest_weights`, forced, NO loop) in `weight-suggestion-call.ts` (the fetch now routes through the shared
  `runForcedToolCall` (`ai-forced-call.ts`) — the single never-log envelope; never logs/echoes apiKey or body; thrown
  errors carry only HTTP-status digits or `"parse"`). Pure contract `next-actions-tuning.ts` + `weight-suggestion-ai.ts`; hook
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
★★ Adding to the `ActionSource` / `AppView` unions surfaced exhaustive `Record<>` maps tsc forced
extending (`action-source-label`, `nav-icons` ICON_PATHS, `nav-config` LABEL_KEYS/`navLabelKey`; the former
`action-source-icon` map was REMOVED in the next-actions redesign) — "Map-based, no break" was WRONG; grep the union members.
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

### Calendar write-back engine (generic — milestones/committee + tasks)

Milestone + committee push use the BARE category `categoryFor(projectId)` = `AIPM:${projectId}` and are LIST-BASED
(`listProjectEvents` deletes any bare-category event NOT in the kept set). A GENERIC engine now serves other
entities: ★★ NEW entity types MUST use a TYPE-SCOPED category `categoryFor(projectId, entityType)` =
`AIPM:${projectId}:${type}` — if a new entity shared the bare tag, a milestone push would CROSS-DELETE its events
(OData `$filter` is exact-eq, so distinct type-scoped strings never match each other's list). Pure i18n-free
`planEntityReconcile<T extends HasEventLink>` (`calendar-reconcile.ts`, alongside the milestone `planCalendarReconcile`)
+ `listEntityEvents(token,projectId,type)` + per-entity `*ToGraphEvent` (`outlook-calendar-write.ts`); React hook
`useEntityCalendarPush<T>` (`use-entity-calendar-push.ts`) = a parameterized `useOutlookCalendarPush` clone (same
404-on-PATCH self-heal, popout no-op). ★★ A MODULE-LEVEL `inFlightReconcile` Set keyed `${projectId}:${type}`
serializes the auto + manual push instances so a manual click during an in-flight auto reconcile can't DOUBLE-CREATE
(check-then-add is synchronous before the first await; released in `finally`). ★ `interactive:false` (auto runner)
→ non-interactive token + FULLY SILENT (no result/partial/no-access toasts). **Tasks (SP1, v0.157+):**
`Task.outlookEventId?` persists across the 6 write paths (mirrors `Milestone.outlookEventId` — CSV `CSV_COLUMNS`
generic `fieldToString` default arm; MD decoder lives in `markdown-codecs-decode.ts` not `-core`; Turso derives from
`CSV_COLUMNS`; JSON/IDB whole-object pass-through, no task sanitizer). Per-device `settings.outlookCalendar?:
Partial<Record<CalendarEntityType,{enabled,auto}>>` (`calendar-sync-config.ts` `calendarSyncFor`, `sanitizeOutlookCalendar`;
writeSettings SPREAD, no allowlist edit); toggled in BOTH Settings→Integrations AND the tasks pane — ★ BOTH sites
force `auto:false` when un-enabling (else re-enabling silently reactivates auto). Manual "Push to Outlook" button
(pushable = `!isTaskFinished && !!dueDate`) + debounced `use-calendar-auto-sync.ts` runner (mounted in task-manager,
4s, fail-once-per-change; ★ auto-PUSH is STAGGERED via `staggerMs` (base `AUTO_SYNC_DEBOUNCE_MS`) — the 4 entity
sites pass 0/1×/2×/3× `AUTO_SYNC_STAGGER_STEP_MS=750` to avoid a save-time herd (background auto-PULL is already
serial — one awaited loop — no herd there); ★ content-key EXCLUDES `outlookEventId` — it's an OUTPUT the push writes back, including it
re-fires one redundant round). ALL activation sites gated on M365-configured + `!isPopout`. **RAID (SP2, v0.157+):**
pushes active (`isRaidActiveForReview` — the shared predicate EXPORTED from `raid-review.ts`, used by BOTH the review
engine and the pane filter) items WITH a `targetDate`, event on that date; `raidToGraphEvent` mirrors `taskToGraphEvent`
(body owner/severity/status); `RaidItem.outlookEventId` rides the same 6 paths + `RAID_CSV_COLUMNS`/`RAID_MD_COLUMNS`
column (MD decode arm in `markdown-codecs-decode.ts`; `sanitizeRaidItem` caps 1024). ★★ `RaidPanel` is a THIN
callback-prop pane (parent owns `raid`), so — UNLIKE the fat `tasks-section` — ALL calendar logic lives in `task-manager`
(manual + silent-auto `useEntityCalendarPush<RaidItem>`, `useCalendarAutoSync`, `setRaidForCalendar` bridge,
`onToggleCalendarRaid`) and threads FIVE props (`m365Configured`/`calendarRaidEnabled`/`onToggleCalendarRaid`/
`pushRaidToOutlook`/`calendarRaidPushBusy`) through `workspace-section-types` → `workspace-section` → the pane (renamed
to `calendarEnabled`/`onToggleCalendar`/`onPushCalendar`/`calendarPushBusy` at the pane boundary). The central Settings
rows are a reusable `CalendarSyncEntityRow` helper (`integrations-section.tsx`). **Change (SP3, v0.158+):** pushes decided
changes (`!!decisionDate`) as all-day events on the decision date; `changeToGraphEvent` mirrors `raidToGraphEvent`;
`ChangeItem.outlookEventId` rides the same 6 paths + `CHANGES_CSV_COLUMNS`/`CHANGES_MD_COLUMNS` column (MD decode arm in
`markdown-codecs-core.ts`; `sanitizeChangeItem` caps 1024). Like RAID it's a THIN callback-prop pane, so ALL calendar
logic lives in `task-manager` (manual + silent-auto `useEntityCalendarPush<ChangeItem>`, `useCalendarAutoSync`, the
`setChangeForCalendar` bridge, `onToggleCalendarChange`) and threads FOUR props through `workspace-section-types` →
`workspace-section` → the pane (renamed to `calendarEnabled`/`onToggleCalendar`/`onPushCalendar`/`calendarPushBusy` at the
pane boundary). ★★ **Pane-contract consolidation (Phase 3 T8):** on `WorkspaceSectionProps` the six flat
per-entity calendar props for raid/change/absence are now ONE `EntityCalendarProps` bag each
(`raidCalendar`/`changeCalendar`/`absenceCalendar` — `{enabled,onToggle,onPush,onPull,pushBusy,pullBusy}`, in
`workspace-section-types.ts`); task-manager builds the bag, workspace-section spreads it into the pane's
UNCHANGED flat `calendarEnabled`/… interface. Milestone stays flat (manual-only, no toggle). A new
calendar-capable entity threads ONE bag, never five flat props. ★ Persistence of every entity's
`outlookEventId` across CSV+MD (+Turso via the CSV columns) is guarded by `entity-persistence-registry.test.ts`
(codec-scoped, not sanitizer-scoped) — adding a calendar-synced entity = one new row there.
**Absence (SP4, v0.159+):** the FINAL entity — completes the roadmap. Pushes current+future
non-sick absences (`a.type !== "sick" && a.endDate >= today`) as a SINGLE **multi-day** all-day event spanning
the range: `absenceToGraphEvent` sets `start=startDate`, `end=nextDay(endDate)` (Graph all-day end is EXCLUSIVE —
the ONLY structural difference from the single-day task/raid/change events). `Absence.outlookEventId` rides the
same 6 paths + `ABSENCES_CSV_COLUMNS`/`ABSENCES_MD_COLUMNS` column (MD decode arm in `markdown-codecs-decode.ts`
`markdownToAbsences`; `sanitizeAbsence` in `sanitize-entities.ts` caps 1024). Absences ARE in the curated sample
(unlike synthesized changes) → the `.md` Absences table + `.csv` `# ABSENCES` section got the new column, golden
fixtures regenerated (Absences-section-only diff). THIN callback-prop pane (parent owns `absences`), so all calendar
logic lives in `task-manager` (`pushableAbsences`, `absenceAutoSyncKey` = `id|startDate|endDate|type|assignee`
EXCLUDING `outlookEventId`, `setAbsenceForCalendar` functional bridge, manual + silent-auto
`useEntityCalendarPush<Absence>`, `useCalendarAutoSync`, `onToggleCalendarAbsence`); threads FOUR props through
`workspace-section-types` → `workspace-section` → the Resources pane (`resources-panel.tsx` renders the toggle+push
in the shared `headerActions`, renamed to `calendarEnabled`/`onToggleCalendar`/`onPushCalendar`/`calendarPushBusy`).
★ Resources IS in axe `A11Y_VIEWS` — the toggle carries an aria-label. ROADMAP COMPLETE (tasks · RAID · changes ·
absences); no entities remain. **Polish (v0.159.1):** the absence event carries `showAs` (`training`→`busy`,
else `oof`) — the shared `GraphEvent` interface gained an OPTIONAL `showAs?` (other `*ToGraphEvent` builders omit
it); a SECONDARY category = `absence.type` rides alongside the reconcile category (`categories: [categoryFor(pid,
"absence"), a.type]` — reconcile cat stays FIRST; `listEntityEvents`' `any(c: c eq …)` match is unaffected); and
`absenceAutoSyncKey` now INCLUDES `note` (a note-only edit re-pushes the body). True multi-calendar routing (vs the
single `/me/events` + category-filter engine) remains OUT of scope — a separate future slice.
- **Two-way calendar sync (SP1, v0.160+):** the FIRST pull-direction slice — reschedules made in Outlook flow BACK into the app. Shared low-level Graph leaf `outlook-graph.ts` (`GRAPH`/`MAX_PAGES`/`graphGet`/`GraphCalendarError` — extracted from `outlook-calendar-write.ts`, which re-exports `GraphCalendarError`). Read helper `outlook-calendar-read.ts` `fetchProjectEventDates(token, projectId)` (bare `categoryFor(projectId)` filter, paging, `$select=id,start,isCancelled` → `PulledEvent`). Pure i18n-free engine `calendar-pull.ts` `planCalendarPull({entities,events,baseline})` → `{applies,conflicts,deletions}`: APP-WINS — an Outlook move auto-applies ONLY when the milestone is unchanged since the last agreed baseline; NO baseline for a moved event ⇒ CONFLICT (never a silent overwrite); missing/cancelled/null-date event ⇒ deletion notice. Per-device baseline store `calendar-sync-baseline.ts` (single key `aipm-cockpit:calendar-sync-baseline`, key `${projectId}:${entityType}:${eventId}` → last-agreed date; per-BROWSER, NOT workspace data — out of exports/Turso, swept by clearAppConfig; written on PULL only — apply/conflict-resolve/self-heal, NOT on push). Hook `use-milestone-calendar-pull.ts` (mirrors `use-outlook-calendar-push.ts`: internal `useMsAuth`+`useToastContext`, reuses `CALENDAR_READWRITE_SCOPE` so no second consent; auto-applies safe moves, self-heals in-sync baselines, opens the summary modal only when rows exist else a `calendarPullInSync` toast). `calendar-pull-summary-modal.tsx` (applied / conflicts-with-Keep-app-vs-Take-Outlook / deletions; rendered in the shared non-popout `modalsBlock` so it shows in BOTH classic + modern, hook early-returns on isPopout so no popout leak). Manual "Pull from Outlook" button in the Milestones toolbar (next to Push; gated `calendarPushEnabled`). MILESTONES ONLY; SP2 tasks / SP3 raid+change / SP4 absences(range) / SP5 auto-pull+deletion-semantics remain.
- **Two-way calendar sync SP2 (tasks, v0.161+):** task due-date pull. `fetchProjectEventDates` gained an optional `entityType` (type-scoped `categoryFor(pid,"task")` category); generic hook `use-entity-calendar-pull.ts` (parameterized over entity via `getDate`/`withDate`/`toGraphEvent`/`isPullable`; same app-wins + keep-app-convergence semantics as the milestone hook, which is left as-is). Wired ENTIRELY inside the fat `tasks-section.tsx` (which already owns the manual push): a Pull button beside Push + the shared `CalendarPullSummaryModal`, no task-manager/workspace-section threading. ★★ Jira-synced tasks (`!!task.jiraKey`) are EXCLUDED via `isPullable: t=>!t.jiraKey` (Jira owns their dates). No new persisted field (`Task.outlookEventId` exists), no new i18n keys beyond the release highlight, no golden fixtures. SP3 raid+change / SP4 absences(range) / SP5 auto-pull+deletion-semantics remain.
- **Two-way calendar sync SP3 (RAID + Change, v0.162+):** RAID `targetDate` + Change `decisionDate` pull, reusing the generic `use-entity-calendar-pull`. UNLIKE tasks (fat pane), RAID/Change are THIN panes → both pull hooks + summary modals live in `task-manager.tsx`, threaded via `workspace-section-types` → `workspace-section` → the pane (`onPullCalendar`/`calendarPullBusy`, mirroring the write-back push props). No `isPullable` (neither is Jira-linked). RAID axe-scanned; Change eye-verified. (SP4 absences + SP5 auto-pull shipped — roadmap complete.)
- **Two-way calendar sync SP4 (Absence, v0.163+):** the FINAL pull entity — completes the roadmap (milestones·tasks·RAID·changes·absences). Absence is the ONLY MULTI-DAY entity (`startDate..endDate`), so the pull is **faithful start+end** (user-chosen): reads BOTH the event's start AND end and maps them back, reflecting an Outlook move OR resize. ★★ The shared single-date engine/read/hook/modal gained an OPTIONAL end date, so the four single-date entities stay BYTE-IDENTICAL — `planCalendarPull` adds range keys only via `...(hasEnd ? {...} : {})`, `entKey` collapses to bare `ent.date` (baseline `"D"`, not `"D|…"`), the modal suffixes with `{x ? ` – ${x}` : ""}`. `PulledEvent.endDate`/`PullEntity.endDate?`/`applies[].newEndDate?`/`conflicts[].appEndDate?`+`outlookEndDate?` all OPTIONAL. Read helper `$select`s `end` + `prevDay` converts Graph's EXCLUSIVE all-day end → INCLUSIVE (`prevDay(nextDay(d))===d`). Generic hook `use-entity-calendar-pull` gained `getEndDate?` + 3-arg `withDate(item,start,end?)` + range-aware `applyMove(id,eventId,newDate,newEndDate?)`/`keepApp({…,appEndDate?})`/self-heal; all three baseline-write sites emit `"start|end"` so absences converge (no perpetual re-conflict). THIN pane → hook + 4th summary modal in `task-manager.tsx` (absence has no title → row name `${assignee} (${type}) – ${startDate}` for row-UNIQUE a11y), threaded `workspace-section-types` → `workspace-section` → `resources-panel` pull button (Resources axe-scanned). No new persisted field (`Absence.outlookEventId` exists), no new i18n keys beyond the highlight, no golden fixtures.
- **Two-way calendar sync SP5 (auto-pull + deletion-semantics, v0.164+):** the FINAL slice — **two-way pull roadmap COMPLETE**. The per-entity `.auto` flag is now BIDIRECTIONAL (reused, NOT a new flag): auto-push (content-key debounced) PLUS a 15-min BACKGROUND auto-pull for **task/raid/change/absence** (milestone stays manual-only — it's not in `CalendarEntityType`). Runner `use-calendar-auto-pull.ts` mirrors `use-scheduled-job-runner.ts` (ref-stable, `[]`-dep subscribe, overlap-guarded, mount+`visibilitychange`+interval, owns no state); mounted ONCE in task-manager with the 4 background pull instances (each a generic `useEntityCalendarPull` with `background:true`, gated on the SAME `<entity>AutoSyncActive` that powers auto-push, reusing its pushable list/setter/`toGraphEvent`). ★★ generic-hook `background` mode: non-interactive token, silent auto-apply, prune deletions, NEVER opens the modal, and a conflict-COUNT toast (`calendarPullConflictsPending`) DEDUPED by a per-instance `lastConflictSigRef` (sorted eventIds; reset to null on cleared conflicts AND on any failed/no-token background observation so a genuinely-new re-conflict re-announces). Background pulls DON'T toggle `busy` (avoid redundant re-renders); each auto-apply logs the `calendar.autoPulled` activity kind (via `onBackgroundApply` → task-manager `logActivity`). ★★ DELETION-SEMANTICS: a `plan.deletions` row is now DEFINITIVE-only (event MISSING or `isCancelled`) — a present event with a null/unreadable date is SKIPPED (not a deletion); the hook PRUNES each deletion (clears the entity `outlookEventId` + `removeBaselineEntry`) in BOTH manual and background. ★★ TRUNCATION-SAFE: `fetchProjectEventDates` now returns `{events, truncated}` (truncated = paging hit `MAX_PAGES` with more pages); `planCalendarPull` takes `eventsComplete?` (default true) — a MISSING event is a deletion ONLY when the fetch was complete (a `cancelled` event still deletes regardless), so a page-capped fetch never false-prunes a live link. ★ module-level `inFlightPull` Set (`${projectId}:${entityType}`, one per hook) serializes a manual + background pull for the same entity. KNOWN limit (documented, not a bug): with auto-push also on, a pruned event whose entity is still pushable is RE-CREATED next push (matches write-back self-heal); permanent per-item opt-out is future work.

### Timelog integration

Opt-in timekeeping integration (Settings → Integrations). Key landmines:
- **Browser → proxy only (CORS):** all reads go through `src/app/api/timelog/route.ts` + `_helpers.ts` (allowlist `*.timelog.com`, private-IP block, reject `:`/`@` in host + `..`/CRLF/`#` in path, `/v1/`+`/v2/` path allowlist (v2 = per-project `/v2/projects/{id}/time-registrations`, the customer-scoped booking fetch), Bearer auth, 10s timeout, own `"timelog"` rate-limit scope). CSP needs NO new host — same-origin `/api/*` like Jira. ★★ **Shared SSRF core (Phase 3 T11):** the byte-identical `isPrivateHost` + `mappedIpv4ToDotted` classifier + `isAllowedHostSuffix(host, apex)` live ONCE in `src/app/api/_shared/proxy-ssrf.ts`, imported by BOTH jira and timelog `_helpers.ts` (was duplicated verbatim). Provider-specific normalize/auth/URL stays per-route (jira full-URL + Basic, timelog host+tenant + Bearer) — DON'T parameterize the divergent guards into one factory. Directly pinned by `proxy-ssrf.test.ts` (the allowlist short-circuits before `isPrivateHost` in the integration paths, so unit-test it directly). Adding a new proxy = reuse `proxy-ssrf` for the IP/allowlist checks; hand-roll the route-specific normalize.
- **TAF envelope:** Timelog Web API v1 wraps responses as `{Entities:[{Properties}]}` (lists) or `{Properties}` (single) — `unwrapTaf` in `timelog-api.ts` normalises both. Time reads are self-scoped (token owner); org-wide needs the `approval/timesheets/...with-rejected-time-tracking-items?employeeUserId` endpoint, gated by `RegistrationAllTasks` privilege probe (`scopeMode` auto/self/org).
- **Secret:** `timelogApiToken` is the 4th `SecretId` (device-sealed only; the 6-edit lockstep applies — `SecretId` union, `isSealedSecret` allowlist, `readStore` allowlist loop, `migratePlaintextSecrets`, `writeSettings` blank, `hydrateSecretsInto`, + `saveSecretValue` seal-on-edit in `timelog-settings.tsx`). `settings.timelog` is TOP-LEVEL (mirrors `settings.jira`, NOT under `integrations`).
- **`Workspace.timelogLinks`** persists as a JSON meta-blob (same pattern as `steeringCommittee`): 6 write paths (JSON/CSV/MD/Turso-single/Turso-tenant/IndexedDB). NOT a `TABLE_NAMES` entry, NOT a column; excluded from exports; absent workspace stays byte-stable.
- **Actuals cache:** fetched actuals are per-device (`aipm-cockpit:timelog-actuals`, mirrors `landing-state`; out of exports/Turso; cleared by `clearAppConfig`) — NOT workspace data. Pure `timelog-actuals.ts` aggregation routes unmapped user/project/null-bucket hours to an `unattributed` total (never dropped).
- **Apply to budget:** `timelog-apply.ts` is the ONLY write into the persisted budget — writes each bucket's period total into its FIRST allocation's `actualHours` via a FUNCTIONAL `setBudgets(prev=>…)` updater. Everything else is read-only overlay. ★★ The actuals period KEY MUST match the plan granularity: `computeBucketReport` sums `actualHours` ONLY over the plan's period keys (`bucketActivePeriods`→`generatePeriods`, `PlanGranularity` "week"→`"YYYY-Www"` / "month"→`"YYYY-MM"`). `aggregateActuals(items, links, granularity)` keys via the SHARED `periodKeyForDate` (in `resource-capacity.ts`, the single source `generatePeriods` itself uses — don't re-derive ISO weeks). Pass `plan.granularity` panel→`useTimelogSync`→engine; ★ `granularity` is a REQUIRED arg (no default — a silent "month" fallback was removed; a monthly key on a weekly plan silently drops hours from win/loss). ★ `aggregateActuals` builds project refs from items but SKIPS `projectId <= 0` (absence/non-project time → would render a blank Projects row). ★ Apply uses a `pendingApply` SNAPSHOT taken at confirm-open (not live aggregates) so the shown diff == the diff applied; Fetch is disabled while confirming. Matching `<select>`s/Clear are `isPopout`-disabled + handlers early-return (popout = read-only).
- **`timelog` view IS in axe `A11Y_VIEWS`** ("Time bookings"); project-row discovery comes from `useTimelogSync().projectRefs` (distinct projects in fetched items) merged with already-linked projects.
- **Paging (★):** all TimeLog list endpoints page at 10 by default but honour OData `$page`/`$pagesize` (uncapped — `callPaged` uses 500/page, `MAX_PAGES=100`). WITHOUT a paging loop the app silently ingests only the first 10 rows of any list (e.g. 10 of 77 bookings). The proxy `encodeURIComponent`s the `$` (`%24page`) — upstream decodes it. `callRaw` transparently RETRIES a 429 honouring `Retry-After` (else exp backoff, abortable via the same signal), bounded at `MAX_429_RETRIES`.
- **★★ v2 per-project registrations use a DIFFERENT shape than v1 (`mapV2TimeItem`, NOT `mapTimeItem`):** the customer-scoped fetch's `/v2/projects/{id}/time-registrations` (the SOLE v2 endpoint; `/v2/...` on any other path → 404 `UnsupportedApiVersion`) returns rows keyed `ActualHours` (not `Hours`), `NonBillable` (not `IsBillable`, INVERTED), `TimeRegistrationId` (lowercase `d`), and carries **NO `ProjectID`/`TaskID`/`UserID`** — only `ProjectName`/`TaskName`/`EmployeeInitials`. Mapping it with the v1 `mapTimeItem` yields ALL-ZERO rows (hours 0, projectId 0) → "no bookings" (the bug fixed in this line's release). `mapV2TimeItem` injects `projectId` from the request path and resolves `userId` from `EmployeeInitials` against the loaded directory (`initialsToUserId`, built in `fetchBookingsForCustomer`; unmatched → 0 = unattributed). ★ v2 ALSO ignores `startDate`/`endDate` + paging → returns the project's WHOLE history unpaged (hence the 30s proxy timeout for this path); the hook clamps to the window client-side. Verified live: mapped `sum(ActualHours)` == the envelope's `Properties.TimeRegistrationsTotalActualHours`.
- **Two-step fetch (`use-timelog-sync.ts`):** `loadDirectory()` pulls ONLY the directory (cheap); `fetchBookings(start,end,userIds?)` pulls timesheets — org scope iterates ONLY the passed (ticked) ids, else all loaded users. Split so org scope doesn't fire one request/employee for the whole org. `displayableUsers`/`isDisplayableUser` (`timelog-match.ts`) drop inactive/nameless directory rows. Hook also exposes `removeUsers`/`clearAll`/`cancel` (AbortController threaded to every call; loading modal's Cancel aborts) + `loadManagedProjects`/`loadCustomers`. ★ Plain (non-memoized) functions reading live state — like the storage handlers. ★ Fetched `users`+`projectRefs` cached per-device (cache `aggregates` is now OPTIONAL so a directory-only load persists); `loadDirectory` only writes cache when bookings already exist (no fabricated `fetchedAt`).
- **Load my projects (`listManagedProjects`):** REST `/v1/project/get-all` exposes `ProjectManagerID`; filter `=== getMe().userId` (guard `managerUserId<=0`→[] so a bad /me can't match null-PM projects). `Project_GetAll` defaults `isActive=true` — pass `includeClosed` to ALSO pull `isActive=false`. `listProjectsForCustomer(customerId)` server-filters by `customerID` (NOT PM-scoped — lets a non-PM load a client's projects); `listCustomers` populates the picker (lazy on focus, no modal). Project allocations (people↔project) are Transactional-API only — NOT reachable via the REST employee token.

### Diagnostics log · guard transparency · dictation

- **Diagnostic log (`diagnostics.ts`):** `logDiag(level, code, fields?)` → a capped (200) per-device ring
  `aipm-cockpit:diag-log` — OUT of workspace exports/Turso/recovery `CONFIG_KEYS`, swept by `clearAppConfig`'s
  `aipm-cockpit:*` sweep, NEVER holds secrets. ★★ Level-aware eviction (drops oldest `info` first so rare
  `warn`/`error` survive an info/error storm). ★★ Redaction (`diagnostics-redact.ts`) is TWO-layer: a
  secret-KEY denylist (key normalized before match) AND a secret-VALUE scrub (`sk-ant-*`/`Bearer`/JWT/
  `ATATT…`/`Basic <base64>`/`key=value`) — the EXPORTED bundle (`buildDiagnosticBundle`) must never carry a
  secret. Inspect via `window.__lopDiag()`. Panel = Settings → Diagnostics (level/code filter + summary;
  ★ Copy/Download export the FULL ring, never the filtered view). `dataloss-forensics.ts` folds in under
  `dataloss.*` codes. ★ load() must THROW on a malformed/partial read, never mask it as an empty project
  (`relationalReadIsEmpty`); the save effect refuses a full-wipe / mass-deletion over a populated project
  unless `allowDestructiveSave()` armed (clear-all self-arms) — the data-loss defense.
- **Guard transparency (`guard-feedback.ts`):** `reportSilentFailure(showToast, lang, code, err, msgKey)`
  (error toast + `logDiag`) / `reportCapabilityGap(showToast, lang, code, guidanceKey)` (info toast +
  `logDiag`) — the pattern for surfacing a swallowed user-action failure or an off/unconfigured-feature
  no-op. Recovery pages (no ToastProvider) use `logDiag` + `setMessage` instead. ★ ADDITIVE — wire
  alongside the existing bail; never change control flow (except the recovery ignored-return fixes).
- **Dictation (push-to-talk):** `voice.ts` gained a NON-breaking `continuous?` flag + exported `getCtor`;
  `dictation-engine.ts` = the `DictationEngine` interface + pure `appendDictation`; `resolveDictationEngine(
  dictation, lang)` (`dictation-config.ts`) picks `web-speech-engine` (free, browser) vs `stt-engine`
  (OpenAI-compatible; `MediaRecorder` → `/api/stt`). `usePushToTalk` (hold/tap 250ms threshold; exposes
  `press`/`release`) → `useDictationMic` (shared mic button + interim/transcribing preview + centralized
  mic-denied/stt/unsupported toasts) used by chat + the 5 edit-modal prose textareas + prose single-line
  inputs. ★★ `dictation-target.ts` = ONE active target (registered on field focus, cleared on blur/unmount,
  clear-ONLY-if-active); the global hold-to-talk hotkey (`use-dictation-hotkey.ts`, configurable
  `settings.dictation.hotkey`, default `F4`) remote-triggers the focused field's mic — captures the pressed
  target so a mid-hold focus change / window blur can't strand it. ★★ Web Speech fires `onFinal` MULTIPLE
  times per hold → a field's `onAppendFinal` MUST read the LATEST state (functional setter or a ref), else
  each segment overwrites the last (bit RAID/change/stakeholder). ★★ `DictationMic`'s `target` useMemo must
  be identity-STABLE (route `press`/`release` through refs) or the unmount-cleanup effect nulls the live
  target every render (bit the hotkey).
- **`/api/stt` proxy (`api/stt/route.ts` + `_helpers.ts`):** browser → same-origin `/api/stt` (NO new CSP
  host); REUSES `proxy-ssrf` `isPrivateHost` + https-only on the USER-configured BYO base URL (no fixed
  apex allowlist — inherent BYO residual, documented), REFUSES upstream redirects (3xx→502, closes
  redirect-SSRF), content-length + post-parse file-size cap (25MB), Bearer key only outbound, never logged.
  `settings.dictation` = `{ engine: "web-speech"|"stt", sttBaseUrl?, sttModel?, sttApiKey?(sealed 5th SecretId), hotkey? }`.

### AI master switch + integration disclaimer

- **AI master switch:** `settings.ai.enabled` (default OFF, even for existing users) gates ALL AI features. Use `isAiEnabled(settings.ai)` (enabled && key present) / `aiKeyIfEnabled(settings.ai)` — NOT a raw `apiKey` read — at every AI activation site (chat, action analysis, scheduled jobs, weight suggestions, create-wizard). `sanitizeAiConfig` sets `enabled: obj.enabled === true`. AiSection collapses its config body until enabled.
- **Usage-limit notices + counting knobs (★★ security):** pure `ai-errors.ts` — `classifyAiError(status, errorType)` → `"limit"|"auth"|"network"|"parse"|"generic"` (429 or Anthropic `error.type` `rate_limit_error`/`overloaded_error` ⇒ limit), the `AiHttpError(status, errorType?)` class (message is STATUS-ONLY), and `safeAiErrorType(body)` (reads ONLY `error.type`, never the body message; can't throw). `callClaude` throws `AiHttpError` on `!ok` (the old body-slice leak is GONE); all 6 AI call sites classify + surface a distinct translated `aiUsageLimitReached` for `"limit"`. ★★ NEVER log/echo the key or response body anywhere. Behaviour is ADVISORY — never blocks: the 100%-of-self-cap notice (`crossed100` in `usage-warning.ts` → `aiSelfLimitReached` toast) and the 429 notice both just inform. Chat APPENDS a `notice` DisplayItem (`setDisplay(prev=>[...prev,…])`) — never clears history. `AiConfig` gained `maxChatTurns` (default 12; ★ clamp via the SINGLE `clampMaxChatTurns` in `settings-types.ts`, used by `sanitizeAiConfig` + the `CapInput` onChange + the `chat-panel` loop read site — a directly-typed out-of-range value must never drive unbounded billed calls) and `tokenMultiplier` (default 5). ★★ the multiplier is applied ONCE up-front in `ai-usage-context.record()` to a `scaled` usage fed to BOTH the session total AND `addToBuckets` (weekly) — scaling only one puts the two caps on different scales.
- **Rate card = DAY rates are the source of truth (★★):** `Role` has `internalRateDay?`/`externalRateDay?`/`rateBasis?:"day"|"hour"`; `internalRate`/`externalRate` stay HOURLY and remain the cost-math source every consumer reads (`resource-cost`/`budget-report`/EVM/reports UNCHANGED) — they are DERIVED. Pure `role-rates.ts` `materializeRoleRates(role, workdayHours)`: basis `"day"` → hourly = round2(day/wdh); basis `"hour"` → day = round2(hourly·wdh); guards `wdh<=0 → 8`. `roles-editor.tsx` edits materialize on change; "clear the filled cell to switch" flips `rateBasis`; the hour-basis day cell ALWAYS live-recomputes (never a frozen `internalRateDay`). ★★ `sanitizeRole` SPARSE-emits `rateBasis` (only `"day"`; absent⇒`"hour"`) + sparse day fields, so legacy roles stay byte-identical (an always-emit broke round-trip); consumers read `role.rateBasis ?? "hour"` / `=== "day"`. New columns ride `ROLES_CSV_COLUMNS` (auto CSV + Turso single/tenant + turso-migrate self-heal — roles ∈ ENTITY_SPECS, NO special migrate edit) + `ROLES_MD_COLUMNS`; golden regen roles-only; sample `rateBasis:"day"` synthesized in the gen script. ★★ `task-manager.tsx` re-materializes day-basis roles when `settings.resources.workdayHours` changes (guarded RENDER-TIME reconcile, NOT an effect) so the derived hourly can't go stale.
- **Integration disclaimer:** `integration-disclaimer.tsx` — a one-time security note shown the FIRST time any enable checkbox is ticked (AI/Jira/M365/Turso/Timelog). Context provider (no-op default) so the five checkboxes fire `useIntegrationDisclaimer().notifyEnable()` without prop-threading; gated by per-device `settings.integrationDisclaimerSeen`. Mounted at SettingsView + backend-setup-wizard + backend-config-modal. ★ memoize the context value (`useCallback`+`useMemo`) — an unstable value re-fires. NOT shown in popouts.
- **Jira lives INSIDE Integrations:** `IntegrationsSection` renders `JiraSettingsSection` (below Timelog) gated on `!hideJira`; the wizard passes `hideJira` (it has a dedicated Jira step). `settings.jira` stays TOP-LEVEL.
- **Multi-project Jira sync (per-project read-only):** `settings.jira` keeps a single PRIMARY `projectKey` (two-way,
  the create target + issue-type/user-picker source) PLUS `extraProjects: {key,name,readOnly}[]` (opt-in reads, each
  with its own read-only flag, default read-only ON). Pure dep-light `jira-projects.ts` (kept OUT of the lazy
  `jira-api.ts` so `use-settings`/badge/settings-UI import it cheaply): `jiraProjectKeyOf`, `jiraProjectKeys` (deduped
  union), `isReadOnlyIssue` (primary→false, extra→its flag, UNKNOWN/removed project→**true**), `sanitizeJiraExtraProjects`
  (drops primary-colliding/dup/`[A-Za-z0-9_]`-invalid keys, default readOnly true, cap 20). `buildJql` unions keys →
  `project in (...)` (single-project BYTE-IDENTICAL). ★★ `isReadOnlyIssue` is the SINGLE classifier across ALL surfaces
  — sync, conflict-resolution guard, badge, editor banner (thread `projectKey`+`extraProjects`, NOT a pre-filtered
  key list, or the surfaces diverge for a removed project). Read-only rows in `use-jira-sync` are PULL-ONLY: never
  `updateIssue`/`transitionIssueTo`, never queue a conflict; always pull (revert stray local edits, clear
  `localModifiedAt`), local-only fields (blockers/group/inquiriesSent) preserved. ★ `sanitizeJiraExtraProjects` runs on
  the settings LOAD merge in `use-settings.ts` (JiraConfig otherwise has NO sanitizer). ★★ PERSISTENCE: `extraProjects`
  rides `settings.jira` via the `writeSettings` spread — per-device, NOT a Workspace field: OUT of exports/Turso/CSV/MD,
  no six-write-path, no golden fixture. Settings UI = checkbox list + per-row read-only toggle + a degraded-state
  fallback (manage/remove configured extras when the project list isn't loaded); row-unique aria-labels (Settings is
  axe-scanned). Editor read-only banner (`jira-readonly-banner.tsx`) threads to the floating `TaskFormModal`
  (via `app-modals.tsx`).

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

- **Tasks:** pure i18n-free `saved-views.ts` (per-device `aipm-cockpit:saved-views`, `MAX_SAVED_VIEWS=30`,
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
  `panel-views.ts` (per-device `aipm-cockpit:panel-views` — a DIFFERENT key from tasks' `aipm-cockpit:saved-views`;
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
- **Reports:** dedicated bespoke store `reports-views.ts` (per-device `aipm-cockpit:reports-views`,
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
- **Shared control shell (`SavedViewsMenu`, `saved-views-menu.tsx`):** all THREE controls
  (`panel-views-control`/`saved-views-control`/`reports-views-control`) render ONE shared presentational
  `SavedViewsMenu` (the select + save-as name/confirm/cancel + delete shell; owns the local UI state —
  selection, save-name draft, stale-selection `selectionValid` derivation). Each control is a THIN wrapper
  passing its `views` list + `onApplyView(id)`/`onSaveView(name)`/`onDeleteView(id)` — divergent STORE logic
  (which hook, apply/capture/delete) stays in the wrapper. Edit shared markup/a11y HERE, not in a wrapper.
  ★ the confirm button carries `aria-label={savedViewsSave}` (accessible name "Save current view" ⊇ visible
  "Save" — WCAG 2.5.3 ok); reused across the three so a control-level a11y change touches one file.

### Installable PWA

`public/manifest.webmanifest` + `public/sw.js` (static, NOT bundled → can't `import` TS modules) registered
from a CLIENT component (`service-worker-registrar.tsx`) — an inline `<script>` can't carry proxy.ts's
per-request CSP nonce. SW does NO caching / NO fetch handler (hashed bundles → precache would serve stale JS).
CSP needs explicit `worker-src 'self'` in `src/proxy.ts`: `script-src 'strict-dynamic'` makes browsers IGNORE
`'self'` for the SW load → without `worker-src` registration is blocked at RUNTIME (not caught by
tests/build). Periodic Background Sync deliberately NOT built (Chromium+installed+device-seal only; baseline
covers on open).
