<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, file structure may all differ from training data. Read relevant guide in `node_modules/next/dist/docs/` before writing code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Contents

Read [Commands](#commands) and [Hard constraints](#hard-constraints-ci-enforced--these-gate-merges)
before your first edit — the rest is reference, reachable from here.

| | |
|---|---|
| [The doc set](#the-doc-set--what-lives-where) | which of the five docs owns what — read before restating a fact in a second file |
| [Commands](#commands) | every script + the CI gotcha that bites for each |
| [Hard constraints](#hard-constraints-ci-enforced--these-gate-merges) | i18n · byte-stable serializers · palette · a11y gate · six write paths · secrets · CSP |
| [Architecture pointers](#architecture-pointers) | orientation, module maps, extraction conventions, design-system primitives |
| [Dashboard landing cockpit](#dashboard-landing-cockpit) | delta strip · KPI trends · masonry · coaching · density |
| **UI shell** — [Help](#ui-shell--help-system) · [nav](#ui-shell--navigation--landing) · [focus/keyboard](#ui-shell--focus--keyboard-modern-shell) · [surfaces](#ui-shell--surfaces--controls) · [dismissal](#ui-shell--dismissal-escape--tab-ownership) · [theming](#ui-shell--theming--color-schemes) | ★ **dismissal** owns the Escape/Tab protocol — read it before touching any modal, popover or panel |
| [Insights → action loop](#insights--action-loop) | detect · reconcile · recommend · outcome · digest |
| [AI Assistant](#ai-assistant) | wire layer · tools · inline edit · dedup · scheduled jobs |
| [Steering committee](#steering-committee) · [Calendar write-back](#calendar-write-back-engine-generic--milestonescommittee--tasks) · [Timelog](#timelog-integration) | integrations |
| [Diagnostics · guards · dictation](#diagnostics-log--guard-transparency--dictation) · [AI master switch](#ai-master-switch--integration-disclaimer) | |
| [Guided tour + demo](#guided-tour--demo) · [Timezones](#timezones) · [Saved views](#saved-views) · [PWA](#installable-pwa) · [Resource calendar meetings](#resource-calendar-meetings) | |

Conventions used throughout: **★** = a non-obvious rule, **★★** = something that has already
caused a bug, **★★★** = something that has caused the same bug more than once. Open follow-ups
live in [`docs/open-followups.md`](docs/open-followups.md), not here.

★★★ **No gate checks anything in this file.** Every claim here was true when written and some have
outlived their code — six false clusters were found and fixed on 2026-07-30 alone, one of them
restated four times (a bundled-themes directory that does not exist). Before relying on a specific
claim (a path, a count, a call site, "X is guarded"), **grep it.** A function named `sanitizeX`
proves nothing about whether the path you care about calls it. Correct what you disprove, in the
same commit.

## The doc set — what lives where

| File | Owns |
|---|---|
| **AGENTS.md** (this file) | landmines, hard constraints, per-subsystem module maps. The deep reference. |
| [`docs/CODEMAPS/`](docs/CODEMAPS/) (5 files) | layered overview — architecture · frontend · backend · data · dependencies. Read these FIRST for shape; this file for detail. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | process + conventions: setup, scripts, testing layers, release checklist. |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | operations: build, deploy, rollback, secrets, and a symptom-indexed "common issues" list. |
| [`docs/open-followups.md`](docs/open-followups.md) | every known-open defect and deferred decision, numbered. |

★ A fact belongs in ONE of these. When it must appear twice, the second copy links rather than
restates — four restatements of the same claim is how `public/themes/*.json` survived in this file
long after the directory it named stopped existing.

## Commands

```bash
npm run dev                 # next dev (public next ^16.2.11 — read node_modules/next/dist/docs for version behavior)
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
                            # ★ `npm run lint` itself is bare `eslint` with NO `--max-warnings` flag, so it
                            # EXITS 0 even when warnings are present — it does not reproduce the CI gate.
                            # Check the actual gate locally with `npx eslint --max-warnings=0 src/app`.
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
                            # ★ `--reporter=basic` DOES NOT EXIST in vitest 4.1.8 — it fails to load a
                            # reporter module and errors at startup, which reads like a broken test run.
                            # Use `--reporter=dot`.
npm run test:coverage       # vitest + coverage. The floors in vitest.config.ts are BLOCKING in CI
                            # (global lines 92/funcs 91/branch 80/stmts 89 + per-engine globs), and
                            # `test:run` does NOT enforce them — a new coverage-gated `.ts` file (a
                            # pure engine, or an extracted `use*` hook that wasn't added to
                            # coverage.exclude) can be green locally and fail the unit job.
npm run e2e                 # playwright (incl. the 16-view axe a11y gate)
npm run e2e:smoke           # fast subset. e2e:visual / e2e:visual:update drive the visual-regression
                            # specs; e2e:ui opens the Playwright UI; e2e:install fetches browsers.
npm run dup:check           # jscpd duplication GATE (--threshold set in package.json dup:check, per-format; BLOCKING in CI). baseline docs/baselines/jscpd-2026-07.json
npm run size:check          # file-size ratchet — fails on a NEW >800-line file or a baselined file that grew
npm run stop                # kill ONLY the dev server bound to the app port (default 3000; PORT-overridable)
                            # via scripts/stop-dev.mjs — port-scoped (netstat/taskkill on win, lsof/kill on
                            # posix); NEVER a blanket `taskkill /IM node.exe`. New script → also add a
                            # scriptsDescriptions entry or docs:scripts:check fails.
```

★★★ **NEVER READ A GATE'S EXIT CODE THROUGH A PIPE — you get the PIPE's status, not the command's.**
`npm run test:run | tail -8` exits **0 while tests are failing**, because that is `tail`'s status; the
pipe also DISCARDS the failure diagnostic, so the obvious re-run tells you nothing either. Same shape
with grep: `npx eslint --max-warnings=0 src/app | grep -v notice` reports **1** when eslint passed and
grep simply matched nothing — a pass that reads as a failure, and a failure that reads as a pass, from
the same mistake. Both directions were hit in one session, the first causing a failing suite to be
reported as green **after** the trap had already been flagged twice.
★ Do this instead — redirect, check unpiped, then read the file:
```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"        # no pipe at all
```
★★ This matters more here than in most repos: the gates ARE the safety net, and a defeated gate is
worse than no gate — it reports success. A "green" claim is only worth what the exit code behind it is.

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
  ★★ THAT PIN CREATES A WCAG 1.4.1 PROBLEM IN THE DARK SCHEMES AND `ToggleButton` NOW CLOSES IT.
  Because the label may not say which state is active, the ON state rode the accent border+tint.
  ★★★ SCOPE IT CORRECTLY — an earlier revision here said "colour as the sole visual channel" flatly
  and that is FALSE for the three LIGHT schemes: Understanding 1.4.1 counts a lightness difference
  of ≥3:1 as the required additional distinction, and pressed-vs-unpressed border measures
  harbor-light 8.97:1 · meridian-light 7.71:1 · umber-light 9.30:1 (computed from `builtin-schemes.ts`).
  Those were already conformant. The DARK maps are 1.22 / 1.16 / 1.03:1 — that is the real failure,
  and it is not merely a colour-perception one (see §56). The primitive renders a trailing
  `data-pressed-marker` check glyph (`aria-hidden`, since `aria-pressed` already tells AT). ★ It is present in BOTH states and merely
  `invisible` when off, so the button keeps ONE width — conditional rendering would make the button
  ~20px narrower when off, moving a toolbar's neighbouring controls under the pointer on every click
  (reasoned, not measured — jsdom has no layout, so nothing here can test it). ★ `invisible` vs
  `opacity-0` is NOT load-bearing: heroicons DEFAULTS `aria-hidden` on every icon (its own attributes
  come first and `props` spread after, so a caller can override it — a default, not a hard-code), so the glyph is
  out of the a11y tree in both states either way. An earlier revision of this bullet claimed the
  a11y tree was the reason — it is inert, and a test written to pin it could not fail.
  ★★ `disabled` was declared on this primitive from the start but styled NOTHING until 0.212.0 — no
  call site ever passed it, so an inoperable toggle was pixel-identical to a live one. It now carries
  `disabled:cursor-not-allowed disabled:opacity-60`. ★★ THE JUSTIFICATION IS THE MEASURED FLOOR, not
  the exemption: at 60% the disabled label lands at 4.16:1 worst case (umber-light; harbor-light 4.34,
  meridian-light 4.51, all three dark 5.7+), so it stays readable. WCAG 1.4.3's inactive-component
  exemption is the conformance BACKSTOP, not the reason — quoting it alone would license `opacity-30`
  on some other disabled control, which is formally conformant and unreadable. Do not read this as
  licence for the enabled-state alpha traps recorded elsewhere in this file. ★ The disabled BORDER
  drops to ~1.15:1 and effectively vanishes; the control reads as a control via its text, which is
  why the floor above is the number that matters. ★ Keep it a real `disabled` attribute — an
  `aria-disabled` lookalike still fires `onClick`, which for the Settings auto-sync row would arm
  background sync from a row the user had switched off (pinned by a test).
  ★★ axe 4.12.1's ONLY `wcag141` rule is `link-in-text-block` (links vs surrounding text) — nothing
  in axe evaluates whether a CONTROL's state is colour-only, so the gate is silent on this for every
  toggle in the app and the primitive's unit test is the only coverage. (An earlier revision said
  "axe has NO rule for colour-as-sole-cue"; a contributor grepping the tag list finds one and stops
  trusting the bullet.) A hand-rolled `aria-pressed` button gets neither the cue nor the test — use
  `ToggleButton`.
  Moving/folding a control INTO an axe-scanned view re-scans it: gate scans `Settings`→General, so
  folding Storage/Appearance into General surfaced pre-existing unlabeled `<select>` (a visible
  `<span>` label is NOT an `aria-label`/`<label>`) as axe-critical.
  `A11Y_VIEWS` list (`e2e/a11y.spec.ts`) is **16** named views — Dashboard · Open Points · Gantt ·
  Resources · Budget · RAID · Settings · Stakeholders · Changes · Milestones · Reports · Activity ·
  Time bookings · AI Assistant · Next actions · Insights — so a passing run reports 5 scheme COMBOS × 16
  + 5 Kanban-board variants = **85** axe scans, plus ONE non-scan guard test (asserts the served app's
  `data-app-version` matches this checkout, open-followups §58) — **86** tests total in the spec file.
  It does NOT include Projects, Knowledge, or the
  Resources → **Calendar** sub-tab (Resources defaults to the directory), so controls only on those
  surfaces aren't scanned; anything in the always-present top bar IS (scanned via every view).
  ★★ Calendar being unscanned has already cost real bugs: 0.202.0 shipped an AA contrast failure
  there (`text-ui-pink` on `bg-surface-muted`, under the 4.5:1 AA threshold) that a full 85/85 axe pass said nothing
  about. Check contrast BY HAND for anything styled on that surface.
  Verify IA/UI/contrast changes with
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
- **Releasing:** bump `src/app/version.ts` (APP_VERSION + APP_BUILD_DATE + milestone), add
  `CHANGELOG.md` entry, append any new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` (+ EN/DE
  strings). ★★ FIVE MORE PLACES CARRY THE VERSION AND **NO GATE CHECKS ANY OF THEM**:
  `package.json` `version`, `package-lock.json` (TWO occurrences — the root `version` and the
  `packages[""]` one), the README shields badge (version **and** codename), and the
  `<!-- Generated: … | App <version> "<codename>" … -->` header on all five `docs/CODEMAPS/*.md`.
  Verified 2026-07-30: `package.json` had been stuck at 0.203.0 for six releases, `package-lock.json`
  at 0.199.0 for eleven, and the README badge + codemap headers at 0.203.0 — while `version.ts` and
  `CHANGELOG.md` were correct. Bump them in the SAME commit as `version.ts` or the drift restarts.
- **New persisted `Workspace` field → SIX write paths** (JSON/CSV/MD/Turso-single/Turso-tenant/
  IndexedDB). Miss one and data silently drops on that backend. `calendarEvents`
  ("Resource calendar meetings" below) is a worked example — one `ENTITY_SPECS` row buys three of the six.
- **New COLUMN on existing entity** (e.g. `Milestone.outlookEventId`): add to entity's
  `*_CSV_COLUMNS` (in `csv-codecs-core.ts` — covers CSV **and** Turso single+tenant, DDL/insert
  derive from it; also extend that entity's `*FieldToString`/`build*FromObj` THERE), plus the
  markdown codec (`*_MD_COLUMNS` + table codec in `markdown-codecs-core.ts`) + `sanitize.ts` (see
  "Codec module maps" / "Sanitize module map" for which sub-file); REGENERATE `__fixtures__/golden-*`
  (legit new-column format change) — the sample workspace is JSON-only now (no curated `.md`/`.csv`
  sample to hand-edit); add the column to `sample-workspace-small.json` if it needs sample coverage.
  EXISTING Turso DBs:
  `CREATE TABLE IF NOT EXISTS` can't add column and save INSERTs *named* columns, so old DB
  errors on save — `turso-migrate.ts` self-heals (PRAGMA-diff → `ALTER ADD COLUMN`, run inside
  write lock before save).
- **Turso-gated features** (Snapshots/Trends, version history, Portfolio health) must check
  `tursoConfig !== null`, not just `storageConfig.kind === "turso"` (kind can be set while config
  unset/quarantined). Nav-gating: add the view to `TURSO_ONLY_VIEWS` (`nav-config.ts`) → `filterNavGroups`
  prunes it from the sidebar in file mode (so it can't render a dead tab); the panel STILL runtime-guards.
  ★ such a view is NOT reachable by the file-mode e2e seed → keep it OUT of `A11Y_VIEWS` (unit/eye-verify).
  ★★ A REGION-QUALIFIED Turso host (`<db>-<org>.aws-eu-west-1.turso.io`) is VALID — it is what `turso db show`
  officially prints. `turso-config.ts` once carried an `isLikelyRegionQualifiedTursoUrl` guard driving a
  settings banner that told users to strip the region segment; that advice was wrong and the helper, banner
  and `tursoUrlRegionWarning` strings were all removed. Do NOT reintroduce it.
- **CSP allowlist:** every host BROWSER calls (Turso, Anthropic, MS Graph, MSAL, Jira) must be in
  `src/proxy.ts` `connect-src`/`frame-src` — NOT `next.config`. Missing host fails only at RUNTIME
  (unit tests mock `fetch`; `next build` passes), so silently slips through CI. CSP edits need dev-server restart.
- **New Turso table NOT workspace data** (snapshots, version history, comm_templates)
  must stay OUT of `TABLE_NAMES` (guard test enforces) — else workspace save's
  per-table DELETE wipes it. `SqlArg.value` (turso-schema) is string-only even for ints (`String(v)`).
- **Secrets at rest:** the `SecretId` union is now FIVE device-sealed ids. ★ The id and the SETTINGS
  FIELD it seals are NOT the same string, and three of the five differ — the ids are
  `"anthropicApiKey"` (field `settings.ai.apiKey`), `"tursoAuthToken"` (field `authToken`),
  `"jiraApiToken"` (field `settings.jira.apiToken`), `"timelogApiToken"` and `"sttApiKey"` (5th;
  lives under `settings.dictation`, browser→same-origin `/api/stt` SSRF proxy). Use the ID spellings
  above for the hardcoded allowlists below — earlier text here listed the field names as if they were
  the ids. All five are
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
  The one-time `lop-app`→`aipm-cockpit` migration (`storage-migration.ts` + its boot-IIFE duplicate) was
  REMOVED in 0.190.41 once complete — there is no longer any `lop-app*`/`lop-*` runtime literal, migration
  gate (`ensureStorageMigrated`), or `aipm-cockpit:idb-migrated` flag. The IDB-open entry points
  (`idb.ts`/`secrets.ts`/`project-file-handles.ts`) open the new-name DBs directly. A device that never
  opened the app post-rename would not carry its old-key data forward (accepted — migration is done).

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
     ★★★ **ID-MINT RACE — a save handler MUST decide create-vs-update by the modal's INTENT, never by
     id-EXISTENCE.** Entity "Add" modals precompute the new id at modal-OPEN. If a concurrent writer
     commits that id before Save — an AI `create_*` tool, a second tab, a bulk op — then a handler asking
     `find(id) === undefined` misclassifies the create as an UPDATE and **map-replace silently clobbers
     the concurrent row** (real data loss, fixed in 0.170.2 "Doctorow"). Route it through pure
     `entity-id-mint.ts` `resolveEntitySave(existing, itemId, isNew, mintId)`, which takes the intent and
     **re-mints** the id when the open-time one was taken: RAID (`use-resource-planner`), changes
     (`use-change-log`), stakeholders (`use-stakeholders`), milestones (`milestones-panel`), calendar
     events (`use-calendar-events`). Modals forward `isNew`; the pane contract types are
     `(item, isNew?) => void` (`workspace-section-types.ts`). ★ `isNew` is OPTIONAL and the fallback is
     `isNew ?? !taken` — bulk edit and other non-modal callers deliberately omit it and keep the old
     id-existence behaviour, which is correct because they never precompute an id.
     ★ **Two entities are outside that helper, both correctly:** RESOURCES hand-rolls the identical
     semantics inline (`use-resource-planner.ts:485`) *plus* an extra guard the others lack — editing a
     row a concurrent writer already deleted would make the map-replace a silent no-op, so it calls
     `reportSilentFailure` instead of dropping the edit; TASKS are immune by construction, deciding on
     `editingId !== null` (`use-task-submit.ts:126`) and never on id-existence.
     ★ TEST TRAP: the race only reproduces when the id is taken BETWEEN open and save. A test that saves
     against an untouched list passes whichever way the handler decides — seed the collision explicitly.
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
- **Sample data is JSON-only, tiered:** `sample-workspace-small.json` is the hand-curated MASTER (the
  ONLY hand-edited sample artifact); `-big.json` (3×) and `-huge.json` (10×) are GENERATED from it via
  pure `scaleWorkspace(ws, factor)` (id-offset `k*100000` + full FK remap, incl. `bucket.taskIds`;
  reference data — resources/roles/disciplines/grades — NOT replicated; replicas get distinct
  stakeholder names + workstream-qualified titles, not "(2)"). Don't hand-edit `-big`/`-huge`; regenerate
  via `scripts/generate-sample-workspace.ts` (`npx vite-node scripts/generate-sample-workspace.ts`), then
  regenerate `__fixtures__/golden-*` via serializers. There is NO `.md`/`.csv`/`.sqlite3` sample artifact
  anymore — those were removed; edit the JSON master directly (it's the app's native format, no
  round-trip codec needed).
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
  (mirrors the changes-panel toolbar). ★ Tasks "Clear all" opens a
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
- **★★ Orphaned list filters (`task-filters.ts`):** the Open Points assignee/group/label filters hold a free
  string, but their `<select>` options are DERIVED from the live tasks (`uniqueAssignees`/`uniqueGroups`/
  `uniqueLabels`). Editing the last task carrying a filtered-for value (reassign, re-group, re-label) removes
  the option while the filter state keeps pointing at it — the filter goes on hiding EVERY row while the
  control, left with no matching option, falls back to its first one and reads "All", so the table looks
  unfiltered and empty at once. Pure `resolveEffectiveFilters(values, options)` resolves an unmatched value to
  `FILTER_ALL`; `workspace-context` computes it ONCE into `effectiveFilters` and feeds BOTH `filteredSortedTasks`
  AND the pane's three `<select value=…>` — one source, so control and row filter cannot drift. ★ The RAW state
  is deliberately NOT written back: it lives in `FiltersProvider` (a parent — neither an effect nor a
  render-phase setState can reach it from the pane, and `set-state-in-effect` is banned), and leaving it makes
  the fallback SELF-HEALING (undo the reassign → the filter returns). Saved views capture the RAW values, which
  is correct — a preset preserves intent. ★ Consequence: a view saved WHILE a filter is orphaned stores the
  orphan (the control reads "All", the state does not), so if that value later reappears on a task the view
  starts filtering by it. Deliberate — the same self-healing property, seen from the other side. ★★ Each check MIRRORS how the row filter compares that field:
  assignee/group exact, label case-INSENSITIVE — matching more loosely here would keep a filter that hides every
  row, the exact state this prevents. ★★ `GROUP_NONE` (`""`) is EXEMPT: the group `<select>` renders a permanent
  "No group" option, but `uniqueGroups` drops blanks, so resolving it would make that option unselectable (a
  blank ASSIGNEE is not exempt — it only exists while `uniqueAssignees` still carries one). ★ TEST TRAP: with a
  genuinely orphaned value the `<option>` is gone and the select falls back to "All" whichever source it is
  bound to, so a realistic fixture CANNOT tell a correct binding from a reverted one — stub the raw and
  effective values apart, keeping the stale ones as real options (mutation-proved vacuous otherwise).
- **★ ResourcePicker ✕ CLEARS the whole field** (`name` + `email` + FK), it does not merely unlink. Dropping
  only the FK left the same name rendered (`display` falls back to `value.name`), so the sole visible effect was
  the button vanishing and the control read as dead — reported twice. A DANGLING link (resource deleted) clears
  the same way; re-picking from the dropdown is the repair path, because one glyph doing two different things
  depending on its colour is worse than losing the unlink-but-keep-name shortcut. ★ Keep the `onMouseDown`
  `preventDefault` — commit-on-blur consumers (the inline task-row assignee) close on blur, so without it the
  clear lands on an already-closed editor and is swallowed. ★★ The accessible NAME is the shared `clear` key in
  BOTH states, so linked-vs-dangling rides the `title` (the accessible DESCRIPTION, since `aria-label` wins the
  name): `resourcePickerLinked` / `resourcePickerDangling`. Don't collapse that back to a flat "Clear" title or a
  screen-reader user is never told an assignment is broken. ★★ That is a SCREEN-READER disclosure, NOT a WCAG
  1.4.1 fix — `title` is hover-only (no keyboard focus, unreachable on touch), so VISUALLY the two states still
  differ only by the green/pink border+glyph. Closing 1.4.1 needs a non-colour visual cue (a distinct
  glyph/marker for dangling) — CLOSED by a `data-dangling-marker` warning-triangle `<span>` (aria-hidden; AT
  already gets the state from the description) rendered beside the ✕, with the input padded `pr-12` in that
  state. Don't drop it back to colour-only. ★ the ✕ renders whenever there is something to clear — including a
  FREE-TEXT name (`!!display`), not just a linked/dangling one, since the control is labelled "Clear"; its
  colour/title fall back to neutral + `clear` when there is no link state.
- **Rich-text note log (Tasks + RAID, v0.196.0 "Emrys"):** dated note LOG on `Task.noteLog?` +
  `RaidItem.noteLog?` (`NoteLogEntry[]` = `{id;authorResourceId?;authorName?;timestamp;editedAt?;html;text}`),
  surfaced by ONE shared draggable NON-modal floating CRUD window `notes-window.tsx` (+ `🗒 N` badge
  `notes-badge-button.tsx` on Open Points + RAID rows, "Notes (N)" button in the editors). Author =
  per-device `settings.selfResourceId` (honor-system, NO dropdown/auth); `canEditNote` gates edit/delete
  (`authorResourceId == null || === self`; edit CLAIMS an authorless note). Pure model in `note-log.ts`
  (`addNote`/`editNote`/`deleteNote` immutable; `sanitizeNoteLog`; `encodeNoteLog`/`decodeNoteLog`
  JSON-in-cell for CSV/MD/Turso — mirrors `document-link.ts`). Composer = shared `RichTextEditor variant="lean"`
  (`commitOnEnter`; note-editor.tsx folded in). Drag via shared `use-draggable-window.ts` (help-menu shares it).
  ★★ **`RichTextEditorHandle.appendText`** (`rich-text-editor.tsx`): Tiptap binds its `content` ONCE at mount,
  so a changed `value` prop cannot reach an already-mounted editor — dictation therefore appends imperatively
  via an `editorRef` (`useImperativeHandle`), not by pushing a new `value`. The handle's `appendText` calls
  `editor.chain().focus().insertContent({type:"text",text}).run()` — `insertContent` MUST take a TEXT NODE
  object, never a bare string: a bare string is parsed as HTML, so dictated text containing `<`/`&` would be
  interpreted as markup instead of inserted literally. Both the note log's composer and its entry editor wire
  `useDictationMic`'s `onAppendFinal` straight to `editorRef.current?.appendText(txt)`.
  ★★ `Task.notes` was RENAMED to `Task.description` (rich HTML) — NO back-compat decoder / NO runtime
  migration; Turso `COLUMN_RENAMES` `{from:"notes",to:"description"}` self-heals; historical notes folded into
  `noteLog` ONLY in the sample generator (Description starts empty); CSV task column renamed + goldens regen.
  RaidItem's `description?` is PRE-EXISTING (unrelated); other entities' `notes?` fields are untouched.
  ★★★ STORED-XSS defense-in-depth — noteLog `html` is `dangerouslySetInnerHTML`, guarded at THREE layers:
  (1) SINK re-sanitize `sanitizeNoteHtml(html)` in `NoteBody` (idempotent; mirrors comm-send-preview/
  meeting-report); (2) `sanitizeNoteFields(entity)` (note-log.ts) at the WHOLE-OBJECT load boundaries that
  cast verbatim — `jsonToWorkspace` (file/sharepoint/local-file JSON) + IDB load (`browser-backend.ts`);
  CSV/MD/Turso route `noteLog` through `decodeNoteLog` — ★★ that covers `noteLog` ONLY, and reads as
  if it covered `description` too. It does not: NOTHING sanitizes the six rich DESCRIPTION fields on
  those three backends (see the rich-text bullet below; `docs/open-followups.md` §28). A NEW
  whole-object load path MUST call the `sanitize*RichFields` matching its entity, not just this one.
  ★★ The form must never write `noteLog` back: the log is WRITE-THROUGH and owns itself, so a draft
  that snapshots it at modal-open and spreads it over the live row on save silently destroys any note
  added while the editor was open (real data loss, fixed 0.209.0 — `use-task-submit.ts` deliberately
  omits `noteLog` from its payload). ★ 0.211.1 went further and removed the field from the DRAFT too:
  `emptyForm` carries no `noteLog`, so `TaskFormDraft` (a `ReturnType<typeof emptyForm>`) has no such
  key and there is nothing for a future writer to put back into `payload`. The unsaved-task fallback
  button shows NO count at all — a hardcoded `0` would be true only by WIRING (task-manager gates
  `taskNotePanel` on `editingId !== null`), not by construction. Re-adding the field is a typecheck
  error before it is a data-loss bug — keep it that way.
  ★★★ RAID HAD THE SAME DEFECT AND IT IS FIXED DIFFERENTLY — do not copy the task approach there.
  `raid-panel.tsx` seeds `useState<RaidItem | null>` with a full-row SNAPSHOT at edit-open, the notes
  window is owned ABOVE the panel (`task-manager.tsx` `openRaidNotes`) and commits write-through to the
  workspace `raid` array the snapshot never sees, and the save is a full row REPLACE — so open RAID
  editor → Notes → add a note → Save destroyed it (fixed 0.211.1, `docs/open-followups.md` §48).
  ★★ The task fix (OMIT the field from the payload) would be WORSE here: because the RAID save
  REPLACES the row, a payload without `noteLog` erases the log outright. `use-resource-planner.ts`
  instead builds `withStamp` with `noteLog` taken from the STORED row (`previous`), never the payload.
  ★★ It must land on `withStamp` and not only inside `setRaid` — `RAID_UNDO_GROUPS` is `[]`, so
  `changedFieldGroups` emits ONE capture PER changed key and a stale `noteLog` becomes undoable/
  redoable state. `NEVER_CAPTURE` is only `{id, localModifiedAt}`, so nothing else suppresses it.
  ★ The modal's `draft.noteLog?.length ?? 0` count still reads the stale snapshot, so it can
  under-report while the notes window is open. Cosmetic (the log itself is safe now) — left open.
  ★★★ **`sanitizeRaidItem` DROPS `noteLog` and CANNOT be taught to keep it.** It builds from an
  explicit field list, and `sanitizeNoteLog` → `sanitizeNoteHtml` → DOMPurify is DOM-BOUND while the
  entity sanitizers must stay DOM-free (they run under bare node in the sample generator — same
  constraint as §36(a)). So ANY caller that sanitizes an EXISTING RAID row silently erases its log.
  `use-chat-dispatcher.ts` `updateRaid` did exactly that until 0.211.1 and every AI edit to a RAID item
  wiped its notes unrecoverably (no undo on AI writes) — it now re-applies the stored log after
  sanitizing (`docs/open-followups.md` §49). The other THREE callers are CREATES and safe. ★ A NEW
  `sanitizeRaidItem` call site must ask whether it holds a stored row; nothing gates this. ★★ Sweep on
  the BARE name — `ai-project-proposal.ts:287` passes the sanitizer by REFERENCE into `buildList`, so
  `grep 'sanitizeRaidItem('` misses it (that trap produced a wrong count here first time round, and it
  applies to any sanitizer used as a `.map`/`buildList` callback).
  ★★ STILL OPEN (§50): whole-row `capture()` undo restores a stale row, so undoing a BULK edit reverts
  the note log. Shared engine (`undo-stack.ts:89`), so tasks are likely affected too — unverified.
  ★★ SSR landmine: `plainToHtml` must NOT run DOMPurify at module-eval (no DOM under Next SSR → 500) — it
  escapes `&<>` + wraps `<p>`/`<br>`, a provable no-op vs the sanitizer. ★ Enter-commit IME guard:
  `!event.isComposing && keyCode !== 229`. `use-notes-window.ts` = deps-object glue hook (coverage-excluded).
- **Rich-text register descriptions (0.209.0 "Lafferty"):** SIX more fields joined `Task.description`
  as rich HTML — RAID `description` + `mitigation`, Change `description` + `impactDescription` +
  `resolutionNotes`, Milestone `description`. Same lean `RichTextEditor`, same `sanitizeNoteHtml`
  allow-list. Two pure modules, split by ONE axis — whether the code may touch a DOM:
  • `rich-text-plain.ts` — **DOM-FREE**. `descriptionHtml` (upgrade), `htmlPlainProjection`,
  `htmlTextLength`, `capHtmlText`, `sanitizeRichText` (the entity sanitizers' entry point).
  • `rich-text-projection.ts` — **browser-only**. `descriptionText` (= projection ∘ `htmlToText` ∘
  upgrade) for every NON-DOM consumer, `descriptionTextWithBreaks` (the EXPORT projection), and
  `appendDictationToHtml`.
  ★★ **TWO projections, and exports use the SECOND one.** `descriptionText` COLLAPSES a block
  boundary to a space — right for search, AI digests and the inline-AI preview, wrong for an export
  a human reads, where a three-paragraph description arrived as one run-on line.
  `descriptionTextWithBreaks` keeps the boundary as `"\n"`, and `export-sections.ts`'s `richCell`
  routes EVERY rich column through it (`TASK_RICH_COLUMNS` · `RAID_` · `MILESTONE_` · `CHANGE_`);
  each renderer then maps that newline to its own primitive — `<br>` (HTML/PDF, escape FIRST),
  `<w:br/>` (DOCX, several `<w:t>` in one `<w:r>`), one `<a:p>` per line (PPTX), and XLSX already
  preserved it via `xml:space="preserve"` + `wrapText`. A new export column joins a `*_RICH_COLUMNS`
  set; a new RENDERER must map the newline or it silently ships fused text.
  ★★★ The break mode is OPT-IN at THREE points and all three are required:
  `separateBlockBoundaries(html, "\n")`, `htmlToText(html, {preserveBreaks:true})` and
  `htmlPlainProjection(html, {preserveBreaks:true})`. The middle one is the easy miss —
  `htmlToText`'s default collapse is `\s+` → `" "`, which flattens the very newline
  `separateBlockBoundaries` just inserted, silently producing the collapsed form. Every default path
  is BYTE-IDENTICAL and pinned by hardcoded byte-stability suites, because `htmlPlainProjection`
  feeds `capHtmlText` → `sanitizeRichText` → all six backends. `separateBlockBoundaries`' `sep` is
  typed `" " | "\n"`, not `string`: it lands in a `String.replace` REPLACEMENT position where `` $` ``
  and `$&` are special.
  ★★★ `rich-text-plain.ts` MUST NEVER CALL DOMPurify. It runs inside the entity sanitizers, which
  execute under bare node in `scripts/generate-sample-workspace.ts` and the fixture flow; DOMPurify
  binds `window` at module-eval, so with no DOM `sanitize` is undefined, the call throws, and
  `jsonToWorkspace`'s catch-all swallows it into an EMPTY workspace that then "successfully" writes
  near-empty sample files. A comment-stripping source scan in its test enforces it — comments may
  name the library, code may not. IMPORTING `plainToHtml` is fine (only a CALL needs the DOM).
  ★★★ **EVERY WRITE BOUNDARY FOR A RICH FIELD MUST BE UPGRADE-AWARE — `sanitizeRichText`, never
  `plainToHtml`.** `plainToHtml` ESCAPES `& < >`, so an HTML value passed through it is stored as
  `<p>&lt;p&gt;&lt;strong&gt;…` — literal tags visible in the field, in every export and in the search
  index, permanently. RAID/change/milestone were always safe **from that CORRUPTION** — they route through
  their entity sanitizer → `sanitizeRichText` → `descriptionHtml`, which passes HTML through and upgrades
  plain text. ★★★ They were NEVER allow-listed, and reading this sentence as "those three need nothing" is
  plausibly WHY the model-write gap below took three review rounds to find. Two different properties:
  upgrade-vs-escape (corruption) and allow-list (what a model may store). Never let a claim about one read
  as a claim about the other.
  `Task.description` had FOUR plain-text-in boundaries, all fixed in 0.210.0 — `use-chat-dispatcher.ts`
  create + `update_task`, `ai-project-proposal.ts` (the model's `propose_project`, fed from an uploaded
  PDF / SharePoint file / Confluence page — the most attacker-influenceable input in the app), and
  `templates.ts` `sanitizeSeedTask`. ★ `grep -rn "plainToHtml(" src/app` is the sweep; the remaining hits
  (`action-task-seed.ts`, `jira-api.ts` via `adfToText`, `templates-builtin.ts`) are provably plain by
  construction. ★★ `sanitizeSeedTask` ALSO read the pre-0.196.0 `raw.notes` only, which was silent DATA
  LOSS: `templateFromWorkspace` captures real `Task` objects, so every captured description imported as
  `""`. It now reads `raw.description || raw.notes` — `||` not `??`, because a template carrying
  `description: ""` beside a legacy `notes` must fall back, and `??` only catches null/undefined. ★ `ai-project-proposal` keeps `raw.notes` on
  purpose — `PROPOSAL_TOOL`'s task schema advertises that key, so it is what the model is asked for.
  0.210.0 made the inline-AI route reachable by renaming the descriptor's dead
  `notes` to `description` (a task-description diff became possible) while the confirm path applies the
  model's VERBATIM `diff.raw` — which is HTML, because `scopeBlock` hands the model the stored HTML to
  read. ★ Precisely: the plain CHAT route was already reachable at base (the model reads a stored
  description through a read tool and echoes HTML back), so 0.210.0 added a second route and made a hit
  far likelier — it did not create reachability from nothing. THREE of the four boundaries go through
  **`sanitizeAiRichText`** (`ai-rich-text.ts`); chat and persisted insight-recommendation replay share two.
  ★★★ The FOURTH — `templates.ts` `sanitizeSeedTask` — deliberately does NOT, and CANNOT: that file is in
  `scripts/generate-sample-workspace.ts`'s import graph, so a DOMPurify call there throws under bare node
  and `jsonToWorkspace`'s catch-all writes near-empty sample files. Template import gets the upgrade but no
  allow-list — the same DOM-free CAUSE as the codec load paths (§28), recorded as its own item in
  `docs/open-followups.md` **§36(a)**, since §28 is scoped to the codecs and does not cover this boundary.
  Do not "complete the sweep" by importing the helper there; the guard bans it precisely so you cannot.
  ★★★ AND SO DO THE OTHER THREE ENTITIES, via `withAiRichFields(input, AI_RICH_FIELDS.<entity>)` at the
  six raid/change/milestone create+update sites. Their entity sanitizers (`sanitize-records.ts`) are
  DOM-FREE and therefore CANNOT run an allow-list — verified: `sanitizeRaidItem` stored
  `<script>alert(1)</script>` verbatim — so the model's value is cleaned BEFORE it reaches them. Fixing
  only `Task.description` (as 0.210.0 first did) left six model-writable rich fields unguarded while this
  very bullet claimed "EVERY write boundary". ★★ Apply it to the model's INPUT/PATCH, never to the merged
  entity: an update spreads the STORED value, and re-sanitizing that rewrites bytes the call never asked
  to touch. ★★ A field the model did not supply must be SKIPPED, not blanked — otherwise renaming a RAID
  item erases its stored description and mitigation. ★ A new rich field on an AI-writable entity goes in
  `AI_RICH_FIELDS` (a test pins each list, so adding one forces the decision).
  ★★★ That helper is TWO layers and both are load-bearing: `sanitizeRichText` (upgrade-aware, DOM-free,
  caps + drops-empty) THEN `sanitizeTemplateHtml` (the actual DOMPurify allow-list). Layer 1 alone CANNOT
  sanitize — it is DOM-free by contract and `descriptionHtml` passes HTML-shaped input through verbatim,
  so a model's `<script>` reached all six backends. ★★★ It is `sanitizeTemplateHtml`, **NOT**
  `sanitizeNoteHtml`, and the difference is DATA LOSS: `sanitizeNoteHtml` sets `KEEP_CONTENT:false`, which
  deletes the TEXT inside a non-allow-listed tag — right for the editor (its schema emits only the lean
  set) and WRONG for a model, which legitimately emits `<h3>`/`<div>`/`<table>`. A test pins that
  distinction; swapping the sanitizer fails it. ★ The helper lives in its OWN module because it calls
  DOMPurify — putting it in `rich-text-plain.ts` would break the DOM-free guarantee that module's guard
  exists to protect.
  ★★ A model may send EITHER shape — never assume plain text just because the tool schema says "text".
  ★★ TEST AT THE WRITE, NOT THE TOOL CALL: the inline-AI tests spy on `runTool` and assert what reaches
  it, which is one hop short of this defect, and `descriptor-drift.test.ts` covers only the four
  sanitizer-backed entities — it says so — leaving the one entity without a `sanitizeRichText` boundary
  as the uncovered one. Three primed review rounds missed this; a COLD read found it.
  ★★ **MIGRATION IS READ-TIME, NOT WRITE-TIME.** Storage is not normalised by the decoders — they
  hand-build entities and never call the entity sanitizer (`buildRaidItemFromObj`,
  `buildMilestoneFromObj`). EVERY reader upgrades instead: `descriptionHtml` at a DOM boundary,
  `descriptionText` for search / AI digests / the inline-AI preview (exports use
  `descriptionTextWithBreaks` — see above). A project therefore
  holds BOTH shapes at once, and that is fine — but a new consumer that reads one of the six fields
  raw ships escaped markup or fused text. Grep the six names before adding a reader.
  ★★ The projection is REGEX, and both of its obvious spellings are wrong: `<[^>]*>` deletes a tag
  with nothing in its place (so `<p>a</p><p>b</p>` fused to `"ab"`, and every upgraded multi-line
  legacy value read as one word), and it is not the HTML tokenizer (a `<` NOT followed by an ASCII
  letter or `/` is literal text — `<p>cost < 5k</p>` projected to `"cost"`, and a value projecting to
  empty is DROPPED by `sanitizeRichText`'s empty rule). Block tags are replaced by a SPACE first;
  `&amp;` decodes LAST so `&amp;lt;` cannot double-decode. All three cost a data-integrity bug.
  ★★ `HTML_START` (`narrative-html.ts`, SHARED with the dashboard narrative) must see the tag
  actually CLOSE and be an OPENING tag. Accepting `"<li 3 items"` as HTML stored a value the counter
  measured at 11 while every reader rendered nothing.
  ★ Counters/caps measure VISIBLE TEXT (`htmlTextLength`), never `html.length`; `capHtmlText` backs a
  truncation off one code unit rather than splitting a surrogate pair (a lone surrogate is `U+FFFD`
  on CSV/MD but survives on JSON/IDB — a backend-dependent corruption). `clipText` in
  `sanitize-core.ts` still has that bug for ~49 plain-text call sites (open-followups §22).
  ★ Whole-object load boundaries (JSON + IDB) route the rich fields through `sanitizeNoteFields` /
  `sanitizeRaidRichFields` / `sanitizeChangeRichFields` / `sanitizeMilestoneRichFields` — escape
  BEFORE sanitize, or `KEEP_CONTENT:false` deletes tag-shaped plain text along with its content.
  ★ They are four ONE-ARGUMENT functions on purpose: every call site is `.map(fn)`, which passes the
  INDEX as the second argument, so a `(entity, fields)` signature would be fed `0, 1, 2…`, normalise
  nothing, and leave every `.map`-based test green.
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
- **★★ `ResourcesPanel` is the ONLY `memo()`'d panel `workspace-section` renders** — so it is the one place
  where adding a `useWorkspace()` call silently defeats a real optimization. A direct context consumer
  re-renders on ANY context-value change REGARDLESS of the parent's memo bailout (same rule as the
  `RowLookupContext` split above), and `WorkspaceProvider`'s value is one `useMemo` over ~30 slices, so a
  milestone/RAID/budget/insight edit — or a background Outlook-pull / insight-recommendation / scheduled-job
  write — would re-render the whole planning table, workload rollups and absence calendar.
  ★★ HONEST STATE: the memo does NOT currently bail, so the optimization this bullet defends is aspirational,
  not in effect. `workspace-section` passes it ~47 props and several are a FRESH IDENTITY every render —
  every `guardEdit(handler)` (`guardEdit` is `makeEditGuard(...)` called unmemoized during render in
  `task-manager.tsx`) plus the `absenceCalendar` bag. Verified twice in review. Do NOT cite this memo as the
  reason anything is fast, and note that "memoize `guardEdit`" is NOT the fix — it is one unstable family of
  several. Either stabilise every handler prop (measure first) or delete the memo and this bullet; tracked in
  the R5 follow-ups doc. The guidance below still stands regardless, because it is what would make a bail
  possible at all. THREAD PROPS instead — workspace-section already holds
  `disciplines`/`grades`/`setResources` and passes them to sibling panels. (Every other panel it renders —
  tasks, milestones, dashboard, insights, knowledge, timelog — is un-memoized, so consuming context there
  costs nothing.)
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
  `InfoTooltip`. Byte-equivalent DOM (Reports is axe-scanned). ★ Consumers are now raid-report (34) /
  resources-panel-rows (6) / change-report (6) / calendar-series-list (2) / milestones (2) /
  tasks-section (11) / reports-tables (4) / budget-panel (1) / budget-report-panel (1) — `reports-tables`
  and `budget-report` were once "left as-is" over local sort-var naming and have since adopted it, so
  every sortable header in the app now flows through here (which is why the `aria-sort` below lifts them
  all at once). NON-sortable text-only header cells (no `SortHeaderButton`) keep their raw `<th>` +
  `ColumnResizeHandle`.
  ★ `onResize` is OPTIONAL — omit it for a table that sorts but stores no column widths (the calendar series
  list) and NO handle renders. Never pass a no-op instead: that draws a grip which looks draggable and does
  nothing, the exact false affordance this component exists to avoid.
  ★★ The `<th>` carries **`aria-sort`** (`ascending`/`descending`/`none`), derived from the SAME `active` value
  the arrow is, so the announced and drawn states cannot drift; `active` gates on BOTH `sortKey === sortCol`
  AND `sortDir !== "off"` ("off" is a real member of the asc→desc→off cycle, so naming the column is not
  enough). The `↑`/`↓` is `aria-hidden` — it stays VISIBLE and in `textContent` (existing glyph assertions in
  `report-table.test.tsx` + `calendar-series-list.test.tsx` read textContent, so they are unaffected) but out
  of the accessible NAME, since aria-sort already says it. axe has NO rule for a missing aria-sort, so the
  gate is silent on regressions here — the unit tests are the only coverage.
  ★ The raw-`<th>` tables are NOT in step and knowing which way matters: `change-panel.tsx` +
  `raid-panel-rows.tsx` + `stakeholders-panel.tsx` set aria-sort AND keep a ▲/▼ inside the button's
  name (the double announcement this removed from the shared component), and `activity-log-panel.tsx`
  has the glyph with NO aria-sort at all. Folding them in is a follow-up, not a claim about today.
  ★ `SortHeaderButton` is used ONLY by `SortResizeTh`, so hiding the glyph cannot strand a raw `<th>`
  that lacks aria-sort.
  ★★ KNOWN LOSS: VoiceOver/Safari does not announce `aria-sort`, so a VO user goes from hearing
  "Title ↑" to "Title". Standard-correct (the glyph was never a state) but a real regression for that
  one AT — do not re-litigate it as a pure win.
- **★ `TableFilter` (`report-table.tsx`) has exactly ONE clear ✕, overlaid INSIDE the field.** The input is
  `type="search"`, so Chrome/Safari draw their own ✕ inside it; a sibling clear button therefore read as TWO
  clears on those browsers while Firefox — which draws none — showed only ours. The fix suppresses the native
  one (`[&::-webkit-search-cancel-button]:appearance-none`) and absolutely-positions our button over the field
  (`pr-8` reserves the room). ★ Do NOT "simplify" this back to a sibling button, and do NOT drop our button in
  favour of the native one — the native ✕ does not exist in Firefox and is not keyboard-reachable. Shared by
  7 panels (budget · budget-report · change-report · raid-report · reports-tables · resources-panel ·
  resources-report), several axe-scanned.
- **★★ `buildResourceWorkload` (`resource-workload-rows.ts`) MUST receive the COMPLETE resource list.** It
  builds its `managed` id-map and `nameToId` map from the `resources` ARGUMENT ALONE, and `resolve()` falls
  through to `ensureUnlinked` on a miss. So filtering that argument does NOT hide anyone — the withheld
  person's tasks/absences/shifts/RAID miss both lookups and REAPPEAR under "Unlinked", whose "Clear unlinked"
  control (`task-manager.tsx` `onClearUnlinked`) blanks task assignees + RAID owner and **`filter`s matching
  absences and shifts out of the workspace entirely**. A display filter would therefore become a path to real
  data deletion. `ResourceWorkload` takes a `hideExternal` FLAG and filters the BUILT `managed` rows instead
  (`unlinked` untouched). The full list is also the reassign-picker's target set (`WorkloadOverdueTriage`),
  which a display filter must never narrow. ★ TEST TRAP: a fixture whose external owns NO work cannot reach
  `ensureUnlinked`, so the naive "external disappears" assertion passes for the wrong reason — give them a
  task and assert absence from the WHOLE pane. (Planning/rollup DO correctly consume a pre-filtered
  `visibleResources` — they just `map` it.)
- **★ Toolbar button ORDER convention (this is the RULE, not a claim every pane already follows it — read the
  pane's own toolbar before assuming compliance):** every pane's toolbar ends with the contiguous trailing group
  **Print · reset-columns · reset-pane-size**, in that order. Destructive/bulk actions (Activity's "Clear log")
  and integration blocks (the Outlook `CalendarSyncControls`) go BEFORE it, never between two members. Drift has
  been caught and fixed more than once: Outlook once sat between the two resets in Resources; Clear once sat
  after them in Activity; Open Points had the worst case — Print/reset-size/reset-columns sat BEFORE the
  destructive Clear-all AND the two resets were in the wrong relative order (reset-size before reset-columns),
  fixed in 0.211.0. ★ the reset-columns button uses `ResetColWidthsIcon` (columns glyph) and reset-size uses
  `ResetSizeIcon`; Gantt's name-column reset once wore the reset-SIZE glyph, making the two adjacent resets
  indistinguishable. That one was fixed in an EARLIER release — 0.211.0 did not touch Gantt at all, and this
  sentence sitting under a "fixed in 0.211.0" clause made it read as though it had.
  ★★ A pane's PRIMARY action leads the control row, ahead of its filters — `PlanningToolbar`'s `aiPlanButton`
  is the reference, and RACI's "Suggest RACI" joined it in 0.212.0 (it had been sitting in the trailing group
  beside Print/Reset, reading as a trailing utility). The trailing group is unaffected either way: a leading
  control only has to come BEFORE it, which is why `expectButtonOrder` takes `contiguous` per call.
  ★★ ASSERT THIS WITH THE SHARED `src/test/toolbar-order.ts`, never a local `compareDocumentPosition` walk.
  `buttonIndex` THROWS when a key matches zero or several buttons; a hand-rolled `findIndex` silently takes
  the first, so an ordering assertion can pass against the wrong control. And plain ordering is NOT enough
  for the trailing group — only `contiguous: true` catches a control drifting BETWEEN two members, which is
  the exact drift this bullet lists four instances of. ★ The helper reads BUTTONS only, so a combobox filter
  still needs one hand-rolled position check.
  ★ 0.212.0 also moved Planning's "Hide externals" INTO the trailing `ml-auto` group so it sits beside the
  Outlook block, matching what `renderWorkloadHeader` already did — Planning had been the outlier. ★ That is
  a GROUPING change, not an ordering one: the toggle was already the element immediately preceding the group,
  so a DOM-ORDER assertion passes against the unfixed code. Assert `closest("div.ml-auto")` contains the
  Outlook control instead.

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
popout read-only, day captured via lazy `useState` (purity — no `Date.now()` in render).
★★ **Digest email (`use-digest.ts` + `digest/digest-mail-sender.ts`):** `createDigestMailSender`'s CONTRACT is
resolve ONLY on a mail Graph actually accepted, THROW on every other outcome — the hook treats a resolved
promise as "sent" and confirms it to the user, so reporting a failure and then resolving produced a false
"Digest email sent." with nothing in the mailbox. All user feedback lives in the HOOK (success toast, no-account
guidance via `reportCapabilityGap`, failure via `reportSilentFailure`); the sender only throws, and its message
must stay free of the recipient and token (it reaches the diagnostics ring). ★★ `generate()` takes THREE independent flags — `advance` (reschedule the cadence), `notify` (desktop
notification), `narrative` (a BILLED AI call). They were one flag, so emailing had to advance the cadence just
to get its narrative: clicking Email with the feature disabled pushed the next digest out a full week. Email
passes `advance:false, narrative:true`; a not-due remount passes all false. Never re-couple them — the
narrative is billed and must never ride along with something else. ★★ The duplicate-send guard is a
`sendingRef`, NOT the `busy` state: `emailDigest` awaits `generate()`, whose own `finally` clears `busy`, so
between that and the next `setBusy(true)` the flag is false and two clicks in one tick BOTH sent (verified —
it really sent twice). `busy` stays for the disabled/visual state only. ★ `generate()` is deliberately OUTSIDE
the send's `catch` so one of ITS failures can't surface as "digest email failed".
The presentational slices:
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
  no enable toggle). ★ Tasks (Open Points) hand-rolled its OWN copy of this whole block (enable control + push
  + pull) rather than consuming the shared component, and its control used the bare `calendarSyncEnable` name
  with no entity qualifier — until the 0.211.0 toolbar-polish batch, which moved it onto `CalendarSyncControls`
  (`entityLabelKey="calendarSyncEntityTask"`) like every other calendar-capable pane. The enable control now
  carries the same per-entity accessible name the other panes do ("… – Tasks (due dates)"), which is what
  makes N panes' identically-labelled controls distinguishable under WCAG 2.4.6.
  ★★ IT IS A `ToggleButton`, NOT A CHECKBOX, since 0.212.0 — in all four panes AND in the four Settings rows,
  labelled "Add to Outlook". This bullet said "checkbox" four times after that stopped being true. Query it by
  `role="button"`. The toolbars carry ONLY the enable control; Settings additionally has the auto-sync
  control, which is a `ToggleButton` too — so neither surface has a calendar checkbox left to find.
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

### UI shell — Help system

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

### UI shell — navigation & landing

  • Default landing view is `dashboard` (`workspace-tab-context.tsx` initial `activeTab`); `useHashView`
  also lands a fresh/empty hash ("" or bare "#") on `dashboard` (not the `slugToView` "open-points"
  fallback), so opening the app at `/` goes to the Dashboard home. Deep-links + reload-on-a-view still honour the hash.
  • Nav: `actions` (Next actions) + `trends` are SUB-MENU children of `dashboard` in the Overview group
  (`nav-config.ts`); `trends` is in `TURSO_ONLY_VIEWS` so the Trends sub-entry only shows on a Turso backend.
  ★ TURSO_ONLY child views are pruned in TWO places: `filterNavGroups` (sidebar) AND `subTabsFor(view,
  features, onTurso)` (classic sub-tab row, pass `trends.active`) — gate BOTH for a new turso-only child,
  or it leaks into the classic sub-tab row on file backends.

### UI shell — focus & keyboard (modern shell)

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

### UI shell — surfaces & controls

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

### UI shell — dismissal: Escape & Tab ownership

  • ★★ **Shared `Modal` (`modal.tsx`) STACKS — topmost-only Escape/Tab.** Per-instance Symbol tokens in
  the SHARED `dismissal-stack.ts` (the local `modalStack` it once owned is GONE — see the ESCAPE PROTOCOL
  bullet below); only the layer that owns the key handles Escape (`claimsEscape`) and only the topmost
  MODAL contains Tab (`isTopmostOfKind(token,"modal")`), so a nested modal (wizard
  opened from inside the create-project modal) no longer double-fires Escape and dismisses the parent.
  LANDMINE (bit twice): the keydown effect must depend on `[open]` ALONE and read `onClose` via a ref —
  if it deps `[open, onClose]`, an unstable parent `onClose` identity (re-created each render/keystroke)
  re-runs the effect and re-pushes that modal's token to the top → wrong modal becomes topmost. Push/pop
  lives in a SEPARATE `[open]`-only effect (order = mount order). Regression-tested in `modal.test.tsx`.
  • ★★★ **ESCAPE PROTOCOL — the dismissal stack decides, not listener phase.**
  `dismissal-stack.ts` holds a module-level stack of open layers in OPEN order,
  each tagged `modal` or `layer` and carrying an optional `claims()` predicate.
  `escapeOwner()` walks top-down to the first entry that CLAIMS the key and is
  the ESCAPE question; `isTopmostOfKind(token,"modal")` is the separate TAB
  question. `claimsEscape(e, token)` is the single guard every handler calls.
  React surface is `use-dismissable.ts` — `useDismissable({open, kind, onDismiss,
  claims?})` — which every document-level closer now uses on BUBBLE phase.
  ★★ WHY A STACK: phase ordering cannot work. Native listeners on one node fire
  in REGISTRATION order and a modal opens BEFORE a popover inside it, so a
  bubble-phase `preventDefault` lands after the modal already closed. 0.202.4
  moved closers to CAPTURE to beat that, which fixed Modal-vs-popover but broke
  the combobox pickers: React 19 delegates `onKeyDown` at BUBBLE, so a
  capture-phase closer ran BEFORE the picker's own handler and one keypress took
  BOTH layers down. Capture also never helped against PEERS — capture listeners
  are registration-ordered too. Nesting is knowable directly, so the stack knows
  it and phase stopped mattering.
  ★★ `preventDefault`/`defaultPrevented` REMAINS the boundary with
  ELEMENT-scoped handlers: `claimsEscape` declines an already-marked event, and
  `useDismissable` marks the one it consumes. `stopPropagation` CANNOT do this
  job — React 19 delegates on `document` (Next passes `document` to
  `hydrateRoot`), the same node the closers listen on, and stopPropagation does
  not suppress a listener co-registered on the SAME node.
  ★★★ PRECONDITION — stack order is OPEN order, and open order must equal
  NESTING order. Holds in production because a layer opens in response to a user
  action, never in the same commit as its parent. It is ASSERTED, NOT DETECTED:
  the obvious detection is DOM containment and `PopoverPanel` is a portal, which
  defeats it. ★★ A TEST HARNESS THAT RENDERS A POPOVER AS A CHILD OF AN
  ALREADY-OPEN `<Modal>` IN ONE COMMIT VIOLATES IT — React runs child effects
  BEFORE parent effects, so the modal ends up topmost over its own popover and
  Escape INVERTS. The plan's own first draft of `dismissal-integration.test.tsx`
  did exactly this and the failure read like an implementation bug. Open the
  popover via a click on a trigger, as production does. Nothing enforces this —
  a future surface that mounts a layer in its parent's commit gets inverted
  Escape with NO test failure anywhere to warn it. ★ The ONE push site in the app
  that is NOT a user gesture is `use-tour.ts`'s render-time auto-launch — re-check
  the precondition there specifically whenever tour launch conditions change (it
  is safe today only because the empty-state modal and the tour are mutually
  exclusive `if/else` branches in `task-manager.tsx`).
  ★★ `kind` MEANS "traps Tab", NOT "looks like a dialog". Tag a surface `modal`
  ONLY if it actually contains Tab; otherwise `layer`, however `aria-modal` it is.
  `tour-overlay` is `role=dialog aria-modal` with NO focus trap, and tagging it
  `modal` took `isTopmostOfKind(…,"modal")` away from any real `Modal` open at the
  same time — that Modal stopped trapping Tab and nothing took over, so focus
  walked out of both (WCAG 2.4.3). Caught in review, not by a gate. If such a
  surface gains a real trap, flip its `kind` in the SAME commit.
  ★★ STANDING GAP, not closed by that fix: `tour-overlay` has NO Tab trap at all
  and never has, so Shift+Tab from its first button walks into the app behind the
  dimmed backdrop, and its `aria-modal="true"` tells AT a containment story the
  keyboard does not honour. `kind:"layer"` only stops it breaking OTHER modals.
  Tracked separately — do not read the bullet above as "the tour is a11y-clean".
  ★★ **Focus-on-open (`use-panel-focus.ts`).** A floating panel that gates Escape
  on `useClaimsWhenFocusWithin` MUST call `usePanelInitialFocus`, or the trigger
  that opened it keeps focus, the panel declines its own Escape, and the layer
  beneath eats the key — for `notes-window` that is the task editor, and the
  user's draft goes with it. ★★★ Its flag means "the panel is RENDERED", not
  "open": `help-menu` renders on `{open && pos && …}` with `pos` arriving a tick
  later, so it passes `open && pos !== null`. Shipped once with raw `open` and
  the focus silently never moved — the panel looked fixed and was not.
  ★★ THREE LOAD-BEARING RULES: (1) the push/pop effect's deps are `[open]` (or
  `[open, kind]`) ALONE and handlers ride refs — re-running it moves the token to
  the TOP and makes the wrong layer topmost, the bug `modal.tsx` hit twice via an
  unstable `onClose`. (2) `claims()` is read at EVENT time and must be a live DOM
  read, never a captured state value. (3) Register ONLY when you can act —
  `use-focus-trap` gates on a `hasEscape` BOOLEAN because an always-claiming
  entry with no handler swallows the key and leaves every layer beneath
  unclosable (`inline-ai-edit-popover` passes no `onEscape`).
  ★★ A NON-MODAL floating panel claims Escape ONLY while focus is inside it (or
  nowhere) via `useClaimsWhenFocusWithin(ref)` — `notes-window` and `help-menu`.
  The gate MUST live in `claims`, not in the handler: a decliner that stayed
  topmost would block every layer beneath (each asks "am I topmost?" and gets
  false) and Escape would become a dead key. The stack walks PAST a decliner.
  ★★ `useClaimsWhenFocusWithin` is a HOOK, not a plain factory: `react-hooks/refs`
  rejects passing a ref object into an ordinary function call during render
  ("Cannot access refs during render"), and a `useMemo` wrapper does NOT satisfy
  it — both lint-verified. Call it unconditionally, pass the result (or
  `undefined`) as `claims`.
  ★ DELIBERATELY OUT of the stack: the five combobox pickers (`entity-link-picker`,
  `resource-picker`, `combo-input`, `labels-input`, `stakeholder-recipient-input`),
  `global-search-box`, and `chat-panel`'s abort. Focus location is a stronger signal
  than open order for a widget that only exists while its own field has focus, and
  React's boot-registered delegation runs an element-scoped handler before any effect
  listener. ★ Only the five pickers participate via `preventDefault` — they are the
  ones that CLOSE something. `global-search-box`'s Escape is element-scoped and merely
  clears + blurs its own field (it marks nothing), and `chat-panel`'s abort is a
  `document` listener that self-gates on an open `[aria-modal]` and on focus being
  inside the chat panel. Don't cite either as an example of the `preventDefault`
  boundary.
  ★ CORRECTION to long-standing text here: `global-search-box` does NOT close from
  a document listener. Its Escape is element-scoped on the input; its `document`
  listener is the ⌘K / "/" focus shortcut.
  ★ `use-focus-trap`'s Tab containment moved to BUBBLE with its Escape. That makes
  it consistent with `modal.tsx`, whose keydown listener has ALWAYS been bubble —
  so a descendant `stopPropagation` on keydown could defeat Tab containment in
  either. No consumer does this today (checked across the trapped subtrees); it is
  a constraint on future content placed inside a trap, not a current defect.
  ★★★ **TEST-TOPOLOGY TRAP — three separate bugs hid here in one release; assume a passing keyboard
  test is lying until its DOM shape matches production.** (1) React Testing Library renders into a div
  under `body`, so React's listener sits on a DESCENDANT and `stopPropagation` appears to work — it
  cannot in the real app, where the root IS `document`. (2) `document.dispatchEvent(...)` is an
  AT-TARGET dispatch, where capture and bubble listeners both fire in plain registration order — so it
  cannot distinguish a capture-phase fix from a bubble-phase one; fire from a focused ELEMENT instead.
  (3) jsdom reports every rect as zero, so a positioned popover never renders and its tests must be
  hosted on the hook. Assert `defaultPrevented` (a property of the event) rather than "some other
  listener did not fire" (a property of the topology).
  • **Info-flows diagram** (`settings-sections/information-flows-section.tsx`) has **9 nodes** in two
  colour-coded zones (AIPM tokens): *Your data* (green) = Local/IndexedDB, **File storage** (JSON/CSV/MD),
  Turso; central Browser-app hub; *Connected services* (dark-blue) = Jira, Timelog, **SharePoint**, **Outlook**,
  Anthropic — M365 SPLIT into SharePoint (docs) + Outlook (contacts/calendar). Option-B tight-horizontal SVG
  (`Node`/`Zone` helpers, `role=img`+`aria-label`+`<title>`/`<desc>`; node text hardcoded EN, legend `<dl>` +
  zone-swatch row use i18n). Rendered in BOTH Settings → Integrations AND the Help-view accordion (same
  component, two mounts).

### UI shell — theming & color schemes

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
  FIVE combos over the THREE built-in schemes: harbor-light, harbor-dark, meridian-light, meridian-dark,
  umber-light (5 × A11Y_VIEWS) — ★ umber-DARK is deliberately omitted to hold the count at five, so scheme
  DATA is 5-of-6 covered, not fully. Seeding
  `aipm-cockpit-style`/`aipm-cockpit-theme` via `addInitScript` — ★ Phase 2: it must ALSO seed `aipm-cockpit:color-schemes` `activeId`
  to the scheme under test, else `syncScheme` overwrites the boot paint on mount (scheme landmine 4). Appearance
  Style switch disables the theme control while Mockup (a light-only scheme) is active.
  ★★ ANY RAG-semantic color (status values, KPI deltas, win/loss, stacked-bar segments — NOT just the
  dots) MUST use the `--rag-*`/`--rag-*-text` tokens, never raw `text-ui-green`/`-pink-strong`, or it
  won't switch under Mockup (bit trend-arrow / reports-tables / StackedBar / budget / raid-report).
  ★★★ **A `dark:text-*` COMPANION DOES NOT SURVIVE `hover:` — a hover arm needs `dark:hover:text-*`.**
  `globals.css:3` is `@custom-variant dark (&:where(.dark, .dark *))`, and `:where()` contributes ZERO
  specificity, so `dark:text-x` is (0,1,0) while `hover:text-y:hover` is (0,2,0) — the hover rule wins
  whatever the source order. ★ Reasoning from source order gives the WRONG answer: Tailwind emits the
  `dark:` rule LATER, which looks like it should win. This is why an element can carry
  `text-ui-dark-blue hover:text-ui-dark-blue dark:text-ui-light-grey` and still go invisible in dark
  mode the moment the pointer touches it. ★★ The DEFECT is specificity-decided and therefore
  order-immune; the FIX is NOT — `dark:hover:text-*` compiles to `:where(.dark,.dark *):hover` =
  (0,2,0), which TIES `hover:text-*` and wins on emission order alone. Stable in Tailwind today, but
  the remedy is order-sensitive in a way the bug is not. 12 files already use `dark:hover:text-` correctly; 18 do not
  (`docs/open-followups.md` §40). ★★ A companion must also be checked for its VALUE, not merely its
  presence — `chat-prompt-chips.tsx:37` "has" a companion that re-asserts the identical broken colour.
  ★★ NO GATE CATCHES ANY OF THIS: axe scans the RESTING state only, so a hover-state contrast failure
  is structurally invisible to it, and there is no hover pass in `e2e/a11y.spec.ts`.
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
  `DERIVED_TOKENS`), any exported theme FILE's color KEYS, and the palette guards. The 12 base
  tokens are `ui-{dark-blue,green,green-strong,pink,pink-strong,purple,purple-strong,blue,white,dark-grey,
  light-grey,medium-grey}`. The var NAMES + `@theme` MECHANISM are otherwise unchanged (only the prefix);
  Phase-2 text below that says `--AIPM-*` now means `--ui-*`. PRESERVED (NOT renamed): `AIPM` (company /
  theme display name), `Acme`/`AIPM-consult` (host/email), `AIPM-logo`/`AIPM-icon` (asset classes),
  and the legacy `CiStyle` union members `"AIPM"`/`"mockup"` (`style-ci.ts` — vestigial: `data-style` is
  the constant `"custom"` now, and NO live scheme carries either id). NO key migration — a stored/
  exported scheme with legacy `--AIPM-*` color keys drops to the Harbor fallback (no active users).
  • **★★ RELEASE A (theme decouple, 0.190.22) SUPERSEDES the "FIVE built-ins" claim below:** AIPM + Mockup
  LEFT the code built-ins entirely. `BUILTIN_SCHEMES` = **[harbor, meridian, umber]** only, and a theme is
  now a FILE THE USER LOADS in the full portable format (light/dark/`structural`/branding/pinned AA tokens).
  ★★★ CORRECTED 2026-07-30 — earlier revisions of this bullet claimed AIPM and Mockup "ship as
  `public/themes/AIPM.json` + `mockup.json`" and that the gallery "fetches `/themes/*.json`". **There is no
  `public/themes/` directory, there are no shipped theme files, and nothing in the repo references that
  path** (verified: `find . -name AIPM.json` → nothing; `public/` holds only logos, the manifest and `sw.js`).
  The in-app **Theme gallery** (`theme-gallery.tsx`, mounted in `AppearanceSection` beside the scheme editor)
  is a FILE-UPLOAD importer (`accept="application/json,.json"`) → widened `importScheme` → `addScheme` +
  `updateScheme({dark,structural})` → a removable user scheme. Fresh install picker = Harbor/Meridian/Umber;
  `e2e/a11y.spec.ts`'s own comment states it plainly: "AIPM and Dashboard no longer exist in the app in any
  form — a theme is a file the user loads." Do not re-add a claim that any theme is bundled. NO migration (no active users) — an orphaned `activeId "AIPM"/"mockup"`
  Harbor-falls-back via reconcile. `ICC_SEED`/`MOCKUP_SEED` + their structural maps DELETED from
  `scheme-tokens.ts` (AA derivation uses a neutral `FALLBACK_SURFACE`); `globals.css :root` is now the
  **Harbor-resolved-light** no-JS fallback (the var NAMES are now `--ui-*` after Release B; `@theme` map
  structure UNCHANGED). Portable format widened: `exportScheme`/`cleanScheme` carry `structural`
  (via `cleanStructural` + `STRUCTURAL_TOKENS`, `isSafeRawCssValue`-gated) + the 7 pinned derived tokens;
  `updateScheme` accepts a `structural` patch. Scheme editor base/reset = `HARBOR_LIGHT`; its old
  "New from AIPM/Mockup" buttons → one "New from current theme". ★★ e2e axe `a11y.spec.ts` runs its 5-combo
  matrix on the THREE BUILT-INS — harbor light+dark, meridian light+dark, umber light — resolving each map
  node-side at seed time. ★ Umber-DARK is deliberately unscanned to hold the count at five, so 5 of the 6
  built-in combos are covered, not all of them (`SCHEME_SEED` carries `UMBER_DARK` and the matrix omits it). — The Phase-2 text below still describes
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
  ★★ **`deriveAaVariants` targets `--surface-muted` for every AA variant EXCEPT `--ui-purple-strong`**, which
  is derived against the purple tint COMPOSITED over that surface (`PURPLE_TINT_ALPHA_LIGHT` 0.20 /
  `..._DARK` 0.25 — the RAID "caused this" chips' HOVER state, mode-picked via the surface's own luminance).
  Reason: every consumer of that token — those chips, the chat AI-consent block, the read-only mirror banner
  — puts it on `bg-ui-purple/10`, and NONE on a plain surface, so the card was never the background this text
  actually sits on. Deriving against the card cleared 4.5 there while landing at 4.22:1 (Meridian light) and
  4.35:1 (Umber light) once hover deepened the tint. This is the documented translucent-tint-on-hover trap,
  and the axe gate CANNOT see it (it scans the resting state, and those chips live in an edit modal it never
  opens) — `scheme-purple-hover.test.ts` is the only coverage, and it checks the built-ins AND the shipped
  the `globals.css :root` Harbor-light fallback. ★★ The GUARD must composite over the same `--surface-muted` the DERIVATION
  does: composited over the lighter `--surface` it is looser than the code it guards, and a revert
  slips through in 4 of the 6 built-in combos. ★★ SIDE EFFECT, accepted deliberately: because the
  reference is the harder surface, this also LIGHTENED the value DERIVED FOR the three built-in DARK
  maps (harbor `#a990ff`→`#c7a9ff`, meridian `#ad83ff`→`#cc9bff`, umber `#b786db`→`#d79eff` — the token is
  not IN those maps, which hold exactly the 21 editable tokens; it is computed from them) — visible
  on the AI-consent block, read-only banner and RAID chips in dark mode, none of which was FAILING.
  Kept because it matches this module's existing "derive against the harder surface" rule and keeps the
  token safe if a purple chip is ever placed on a muted card. ★★ The same trap bites text ALPHA, not
  just a background tint: `hover:text-ui-purple-strong/80` on the consent link measured 3.40–3.58:1 in
  the light schemes as shipped (4.04–4.25:1 once 0.202.3's darker token is applied — still under AA
  either way). A `-strong` token is tuned to sit AT AA, so ANY alpha on it lands under — use a
  non-colour hover cue (that link now thickens its underline). A grep for `-strong` + `hover:bg-`
  structurally cannot find this shape — the same fade shipped on `trends-panel.tsx`'s delete button as
  a whole-element `hover:opacity-80` (~4.0–4.3:1), fixed alongside; sweep for `opacity`/`/NN` on a
  `-strong` element, not just for a background class. ★★★ `nudgeToAa` takes an explicit `lighten` OVERRIDE and the purple
  arm MUST pass it. The function defaults the direction to `bg`'s own luminance, which is right while `bg`
  IS the surface — but purple measures against a TINT, and a 20% composite moves luminance far more than
  20%, so the direction (read off the tint) and the alpha (read off the surface) can disagree. A light
  scheme with a mid-grey `--surface-muted` (e.g. `#c8c8c8`) then LIGHTENS on a light background, runs the
  loop to its 20-iteration cap and returns `#ffffff` — white text on a light card, ~1.7:1. Both inputs are
  user-editable (`ADVANCED_TOKENS`) and user schemes are light-only this phase, so it is reachable even
  though every built-in is clear — which also means the built-in sweep can never see it. ★ The custom-scheme
  cases in `scheme-purple-hover.test.ts` pin the direction for a card ABOVE `nudgeToAa`'s 0.5-luminance
  threshold; they do NOT close the hole generally — a `--surface-muted` BELOW 0.5 (e.g. `#a0a0a0`) still
  returns `#ffffff`, and that limitation is module-wide, hitting the green/pink/rag derivations too. Whoever
  decides the mode decides the direction.
  ★ Keep the alphas in lockstep with `raid-edit-fields.tsx`. ★ A pin was tried first
  and rejected: `builtin-schemes.test.ts` requires built-in maps to hold EXACTLY the 21 editable
  tokens, so a pinned AA variant is a test failure by construction. ★ Do NOT
  add "and `cleanColors` would drop the pin on save-as-new" to that argument — it is FALSE and was
  briefly written here: `--ui-purple-strong` is in `DERIVED_TOKENS`, which `VALID_TOKENS` includes, so
  `cleanColors` KEEPS it (that is exactly how an imported AIPM/Mockup scheme survives a save).
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
- **Feature-module guidance (Settings → Mode — the section is titled "Mode"; only its intro copy calls the toggles "functions"):** `mode-section.tsx` renders each `FEATURE_MODULES`
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
  ★★ **Standalone knowledge items (`Workspace.knowledgeItems`, v0.190.41):** a NEW persisted workspace-level
  field for Knowledge-library items that live on their OWN (not attached to an entity), each a `KnowledgeItem`
  = `KnowledgeLink & { taskIds?: number[] }` (optional multi-task link, the "second step"). Type + validator
  `sanitizeKnowledgeItems` live in `document-link.ts`. Persisted as a JSON blob across ALL SIX write paths like
  `timelogLinks` (JSON in/out in `workspace.ts`; CSV `# KNOWLEDGE ITEMS` section in `csv-codecs-config`/`-decode`;
  MD `## Knowledge Items` fenced block in `markdown-codecs-core`/`-decode`; Turso single meta row + tenant meta
  row keyed `knowledge_items`; IDB KV `knowledgeItems` in `browser-backend.ts`) — BUT unlike timelog/steering it
  is EXPORTABLE, so it is gated by a NEW `knowledgeItems` `ExportSectionKey` (`enabled("knowledgeItems")`, default
  OFF) rather than `config === undefined`, and has a `buildExportSections` PDF builder. Empty ⇒ byte-stable (no
  golden regen). ★ App-level save/load wiring MIRRORS neither timelog nor steering exactly: the value+setter are
  threaded through `workspace-context` (`knowledgeItems`/`setKnowledgeItems`), set on load in BOTH
  `use-storage-backend.applyWorkspace` AND `task-manager`'s restore effect, and — CRUCIALLY — INCLUDED in the
  three `backend.save({…})` literals + `currentWorkspace()` in `use-storage-backend.ts` (steering/timelog are
  NOT in those literals; knowledge is, so it actually autosaves). `version-diff` singleton entry. Panel: the add
  form's target `<select>` gains a "Standalone" option → `addStandaloneItem` pushes to `setKnowledgeItems`; a
  "Knowledge library" card grid renders `ws.knowledgeItems` with remove + a per-item `<select multiple>` task
  linker. Guarded by `knowledge-items-persistence.test.ts`.
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
  `INTERACTIVE`/`FOCUS_RING`/`TRANSITION`/`PRESS` (`interaction-styles.ts`). Link pickers:
  `EntityLinkPicker` (`entity-link-picker.tsx`). File dialogs: `FilePickerButton`
  (`file-picker-button.tsx`).
  ★★ **A VISUALLY-HIDDEN file input belongs to `FilePickerButton` and nothing else** (0.211.1) — a DS
  `Button` plus the `sr-only` input it owns. ★ Scope precisely: this does NOT ban every
  `<input type="file">`. A VISIBLE one is fine and `step0-import-panel.tsx` correctly keeps one (it is
  focusable, keyboard-operable and labelled — none of the three defects below can occur). The banned
  shape is specifically a HIDDEN input driven by a `<label>`. Three properties are load-bearing and each
  closes a real defect:
  the input is `sr-only` and NEVER `display:none` (a `display:none` input can't be clicked in every
  browser); it carries `tabIndex={-1}` + `aria-hidden` or it is a SECOND tab stop announcing the same
  accessible name as the Button (axe reports MISSING names, never DUPLICATED ones, so nothing automated
  catches that); and it is a real `<button>`, because a `<label>` is NOT focusable and a `focus:ring` on
  one can never render (WCAG 2.4.7 — axe has no focus-visibility rule either). It owns NO validation:
  `onFile` hands back the raw `File` and the caller keeps its own mime/size checks (see
  `branding-image-input.tsx`). ★ Do NOT hand-roll a `<label>`-wrapping-`sr-only-input` picker; that shape
  is what this replaced (`docs/open-followups.md` §15, §46). `chat-panel.tsx` still hand-rolls one with
  `display:none` — that is §47, not a precedent.
  ★★ **THREE link/chip pickers, one per problem — pick by shape, don't merge them:**
  `EntityLinkPicker` = chips + search dropdown over an UNBOUNDED set, entity-agnostic (caller maps its
  entity to a flat `LinkPickerEntry {id, code, label}` and OWNS both the query state and the option
  filtering — which is where its callers genuinely diverge: `TaskLinkPicker` filters by text alone,
  the RAID cause picker must also exclude self and any pick that would close a cycle). `TaskLinkPicker`
  is now a THIN task-flavoured wrapper around it, and `RaidCausedByField` renders it directly with
  `onOpen` (the click-through chip variant; the ↩ glyph rides `onOpen`'s presence, not a prop).
  `StakeholderChipPicker` stays SEPARATE — it renders EVERY item as a checkbox chip for a BOUNDED list,
  no search, no add/remove asymmetry. ★ `EntityLinkPicker` takes no `lang` and calls no `t()` — every
  string arrives translated. ★ the chip's remove button appends the entry's `code` to `removeLabel`, so
  N chips get row-UNIQUE names (WCAG 2.4.6); RAID's shipped with N identical "Clear" names because a
  single-chip fixture can never surface the collision. ★ the click-through chip pins `aria-label` explicitly
  — adjacent inline spans concatenate with NO separator, so name-from-content yielded "R#3Vendor delay".
  (Same fix applied to the read-only "caused this" children chips in `raid-edit-fields.tsx`, which had the
  identical bleed plus `text-ui-purple` → now `text-ui-purple-strong`.)
  ★★ That `-strong` swap was NOT a uniform win when it landed, and the caveat still applies to any OTHER
  `-strong` token: it repaired a real AA failure in the DARK schemes and in AIPM light/dark (the PINNED value)
  but was a literal NO-OP in Harbor/Meridian/Umber LIGHT, where `nudgeToAa` exited at zero iterations because
  the base already cleared 4.5 against `--surface-muted`. Don't assume `-strong` changes anything in a light
  scheme with no pinned value. (For PURPLE specifically this was then fixed at the source — see the
  `--ui-purple-strong` derivation note in the scheme section: its reference is no longer `--surface-muted`.)
  ★★ **The dropdown is a COMBOBOX and its rows ARE the options.** Input: `role="combobox"` +
  `aria-expanded`/`aria-controls`/`aria-activedescendant`/`aria-autocomplete="list"`; list: `role="listbox"`
  with `role="option"` `<li>`s carrying the click handler DIRECTLY. Do NOT put a `<button>` inside a
  `role="option"` — that is an axe **nested-interactive** violation, and the keyboard path is
  activedescendant, so the button buys nothing (mirrors `global-search-box.tsx`). ★ Highlight state is
  internal (view state) while `query` stays a CONTROLLED prop; it resets via a render-time reconcile keyed on
  the QUERY, never on the `options` identity — callers re-filter and hand a fresh array every render, so an
  identity-keyed reset would clear the highlight constantly and the arrow keys would never stick. It is also
  CLAMPED ON READ, which drops an OUT-OF-RANGE index only — an in-range index that now names a DIFFERENT
  entity is covered by the query-keyed reconcile above, not by the clamp (a caller that swapped `options`
  WITHOUT changing `query` would defeat both; none does today). ★★★ Escape calls `preventDefault()`, and THAT
  is what contains it: the shared `Modal`'s document-level handler bails on `e.defaultPrevented`.
  `stopPropagation` CANNOT contain it — React 19 delegates on `document` (Next passes `document` to
  `hydrateRoot`), the very node `Modal` listens on, and stopPropagation does not suppress a listener
  co-registered on the SAME node. ★ A test asserting "no document listener fired" PASSES anyway, because
  React Testing Library renders into a div under `body`, which puts React's listener on a DESCENDANT — a
  topology the real app never has. Assert `defaultPrevented` instead. Without the Modal-side bail, dismissing
  a dropdown ALSO closes the edit modal and discards the draft. ★★ Enter is claimed ONLY when an option is
  actually armed — these pickers live inside `<form>` edit modals where a bare Enter submits, so swallowing it
  whenever the list happens to be open silently breaks submitting from that field.
  ★ The remove button's name DIVERGES by branch: with `onOpen` it is `"<removeLabel> <code>"` (the chip body
  already announces the entity), without it, it is `"<removeLabel> <code> <label>"` — in the inert branch the ×
  is the chip's ONLY focusable element, so a code-only name tells a screen-reader user nothing about what they
  are unlinking. `title` stays the short `removeLabel` in both.
  ★ The extraction unified three incidental sizings onto RAID's values, so the TASK flavour changed slightly:
  chip row `mb-1`→`mb-2` + `items-center`, chip label `max-w-[160px]`→`max-w-[220px]`, dropdown
  `max-h-48`→`max-h-60`. Deliberate (they were differences with no reason), and it lands in all four
  `TaskLinkPicker` call sites — Knowledge cards, change modal, RAID linked tasks, budget bucket editor.
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
- **★★ `useColumnResize` persists ONLY user-dragged widths (v2, 0.212.0)** — `{v:2,widths}` where `widths`
  holds just the columns the user actually dragged, returned raw as `sizedWidths` beside the unchanged
  merged `colWidths` (37 other call sites across 17 files read `colWidths` and are untouched — count them
  as INVOCATIONS, not files: `raid-report-panel` alone holds 7 and `resources-report` 5). So a `*_COL_WIDTHS` default change
  now reaches a user who once dragged one unrelated column. ★★ BUT NOT retroactively, and the reason is a
  trap: the PRE-v2 persist effect had NO first-run guard, so it fired ~250ms after MOUNT and wrote the whole
  MERGED map — meaning a v1 blob is a full DEFAULTS SNAPSHOT, not a record of drags, and `readSized`
  promotes every key of it to user-set. A table carrying a v1 blob therefore still ignores its new defaults.
  Open Points escapes ONLY because its id was bumped `open-points` → `open-points-v2`; the other 37 tables
  did not (`docs/open-followups.md` §52). Bumping the tableId is the same remedy as the `useResizable`
  storage-key bump above, for the same reason. ★ An unrecognised VERSION reads as "no user widths" rather
  than falling through to the v1 branch — a `{v:3,widths:{…}}` spread verbatim would put a numeric `v` and
  an OBJECT-valued `widths` into a `Record<TId, number>`.
- **★★ Open Points table geometry — ONE auto column, computed minWidth (0.212.0).** The table is
  `tableLayout: fixed` + `width: 100%` + `minWidth: ${tableMinWidthPx(...)}px`. It was `width: max-content`
  + `minWidth: 100%`, so the table outgrew the sum of its declared columns and the browser spread the
  leftover across them. ★★ OBSERVED: gutter + `sel` + `status` rendered ~138px against 100px declared —
  about +12.7px EACH, invisible on a 200px column and a third again on a 36px one. `taskName` is now the
  SINGLE column that emits no `width` (only while un-sized — once dragged it declares one), so it absorbs
  the leftover. ★★ The exact distribution RULE is NOT verified: an equal-per-column split fits that one
  measurement and a proportional split does not, but it is an inference from a screenshot and nothing here
  can check it (CSS 2.1 §17.5.2.1 only says the excess "should be distributed over the columns"). The fix
  holds either way — an auto column takes the leftover before any fixed column does — so do NOT restate the
  mechanism as settled; measure it in DevTools first. An earlier revision of this bullet asserted
  "EQUALLY, NOT proportionally" at ★★★, which is exactly the unverifiable-claim shape this file warns about.
  ★★ DRAGGING `taskName` RE-ENABLES THE DEFECT: it then declares a width, no column is auto, and the edge
  padding comes back until "reset columns". Accepted — treating the drag as a floor while keeping the column
  auto makes the grip stop tracking the pointer, which reads as broken. ★ Do NOT restore `width: max-content`: with an
  auto column present it resolves against that column's longest unwrapped content — the longest task title
  — so the pane would scroll horizontally at all times. ★ Arithmetic lives in pure `open-points-table-geometry.ts`
  (`visibleTaskCols` · `colWidthStyle` · `tableMinWidthPx` · `GUTTER_WIDTH_PX` · `TASK_NAME_MIN_PX`), NOT in
  the pane, which sits at its size ratchet; the column list is the leaf `tasks-section-columns.ts`. ★ The
  pane's prop is `sizedWidths`, carrying the SIZED-ONLY map (an absent key is what lets `taskName` render
  width-free). ★★ It was briefly left named `colWidths` on the argument that renaming cost ratchet lines;
  that was wrong — a rename is net-zero — and the name matters: passing the DEFAULTS-FILLED map instead
  gives every column a width and silently reverts the flex layout. ★★★ THE GUARD IS THAT
  `useColumnManager` DOES NOT RETURN THE MERGED MAP — there is no `colWidths` binding anywhere in
  `task-manager.tsx` (grep it: zero occurrences), so `sizedWidths={colWidths}` is `TS2304 Cannot find
  name`, and `use-column-manager.test.ts` pins the omission with a `@ts-expect-error` that fails tsc as
  an unused directive if the key ever returns. ★★ DO NOT re-expose it on the argument that "the type
  wouldn't catch it anyway" — that much is true (`Record<string, number>` IS assignable to
  `Partial<Record<string, number>>`, proved with a standalone `tsc --strict`, exit 0), and it is exactly
  why the value must not be in scope. Two revisions of this bullet got this wrong in opposite directions:
  first claiming the type system catches it, then — after the removal made the guard real — still saying
  "the name is the only guard, and it is a human one". Both were false when written. ★ The
  leading gutter `<col>` renders from `GUTTER_WIDTH_PX`, never a `w-7` class, because `tableMinWidthPx`
  seeds its sum with that same constant and a class would let the two drift with nothing to catch it —
  jsdom sees neither.
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

### Insights → action loop

- **Pure `insights/` engines (i18n-free):** `detect.ts` `detectInsights(input, today)` runs FIVE
  deterministic detectors (milestone slip · stalled/no-progress work · budget aging · RAID aging ·
  overdue-trend) → `DetectedInsight[]`; `reconcile.ts` `reconcileInsights(stored, detected, today)` merges
  detected signals into the stored record, DEDUPES by a stable key, and PRESERVES each insight's lifecycle
  (`active` → `acknowledged`/`acted`/`dismissed` → `resolved`). `sanitize-insights.ts` = the single validator
  (never throws), `insight-text.ts` = i18n-free label/summary helpers, `insight-prompt.ts`
  `buildInsightsPromptBlock(insights)` = the AI context block. ★ `overdueTrend` is INERT in SP1 — it needs a
  prior-overdue count threaded in (SP2); do NOT treat its empty output as a bug.
- **Persistence + export:** `Workspace.insights` is a JSON blob persisted across ALL SIX write paths
  (JSON/CSV/MD/Turso-single/Turso-tenant/IndexedDB) and is EXPORTABLE via a new `insights` `ExportSectionKey`
  (default OFF, like `knowledgeItems`). ★★ An EMPTY record is BYTE-STABLE (no golden regen); mirrors the
  `knowledgeItems` app-level save/load wiring — value+setter through `workspace-context`, set on load in
  `applyWorkspace` + `task-manager` restore, and INCLUDED in the `backend.save({…})` literals + `currentWorkspace()`
  so it actually autosaves. ★★ LANDMINE: the autosave-effect DEPS array MUST include insights or edits silently
  drop (data-loss).
- **Detect→reconcile runner (task-manager):** debounced, gated `hydrated && !isPopout`, functional
  `setInsights((prev) => reconcileInsights(prev ?? [], detected, today))`. ★★ Its content-key EXCLUDES lifecycle
  fields, so acting on / dismissing an insight can't re-trigger detection → the reconcile→setInsights→re-run loop
  is avoided.
- **Surfaces:** Dashboard `dashboard-sections/insights-card.tsx` + a dedicated `insights` AppView (an Overview
  SUB-CHILD of `dashboard` in `nav-config.ts`, NOT Turso-gated, IS in axe `A11Y_VIEWS` as `#insights`). ★ severity
  rides a `RagDot` (non-text, AA-exempt), NEVER tinted small text. AI-aware: `buildInsightsPromptBlock` is appended
  AFTER the chat cache breakpoint (volatile — reflects the live record without busting prompt caching).
- **SP2 — proactive AI recommendations (0.191.0):** an `Insight` gains an optional persisted
  `recommendation` (`{summary, proposedCalls[], generatedAt, status: proposed|applied|rejected, appliedSummary?,
  appliedAt?}`) that rides the SAME insights blob (no new backend path, byte-stable when empty). ★★ THREE landmines:
  (1) `insightsMateriallyEqual` (reconcile) MUST compare the recommendation, else a freshly-generated rec is
  silently dropped by the churn guard (the SP1 data-loss class — pinned by a test); (2) `reconcile` upsert carries
  the rec forward via `...prev`, and a re-fire DROPS it (a stale proposal no longer fits the recurring problem);
  (3) `sanitizeInsights` only shape/size-guards `proposedCalls[].input` — the real per-entity validation happens at
  APPLY time in `runTool`. Pure engines: `insights/recommend.ts` (forced-tool `propose_insight_actions` +
  `parseRecommendation` re-grounding every entity id against the live workspace via `action-ai` `GroundingIndex`,
  allow-set = safe update/create tools only, NO delete/settings), `recommend-context.ts` (per-insight digest +
  cacheable system prompt, i18n-free English), `recommend-plan.ts` (`describeRecommendationPlan(calls, ws)` → an
  `EditPlan` preview reusing the inline-ai-edit descriptor engine, grounding each call by ITS OWN id). The call
  (`recommend-call.ts` `runInsightRecommendation`) mirrors `task-dedup-call` — ONE forced call through the shared
  never-log `runForcedToolCall`. TWO triggers share the generate path: on-demand hook `use-insight-recommend.ts`
  (per-insight ✨ button) + opt-in background `use-insight-recommend-runner.ts` (mirrors `use-scheduled-job-runner`
  — `[]`-dep refs, mount+visibility+15-min tick, serial, capped `MAX_BG_RECS_PER_TICK`, breaks the tick on a
  limit/auth error; gated `isAiEnabled && settings.ai.insightRecommendations === true && !isPopout`, default OFF).
  ★★ APPLY replays `rec.proposedCalls` DIRECTLY through the chat `runTool` dispatcher (each `{name,input}` carries
  its id; the `EditPlan` is PREVIEW-ONLY — its `updates` carry no id, so a multi-call rec can't apply from the
  plan). task-manager owns the generate/apply/reject handlers (the `insightActions` bag moved AFTER
  `useChatDispatcher` so apply can reach `dispatcher`/`runTool`) + the `recommendation-review-modal.tsx` (Confirm →
  replay → `recommendation.status="applied"` + insight `acted`, no undo; logs `ai.insightRecommendation`). Shared
  row controls in `insight-recommendation-controls.tsx` (both surfaces). ★ `overdueTrend` NOW FIRES:
  `buildInsightInput` reads the prior overdue count from the per-project `landing-state` `metrics.overdue`
  (key = `portfolioCurrentId ?? "default"`, the SAME key workspace-section writes; memo captured at mount, NOT
  re-read on activity — that would race `use-landing-delta`'s ~4s snapshot advance). SP4 = digest.
- **SP3 — outcome measurement (0.192.0):** acting on an insight captures the ONE number it is about into
  `metricAtAction`; a later reconcile measures the live number against it into a persisted `outcome`
  (`{direction: improved|unchanged|worsened, baseline, current, delta, measuredAt}`). Both ride the SAME
  insights blob (no new backend path, byte-stable when absent). Pure i18n-free `insights/outcome.ts` owns
  `METRIC_FIELD` (milestoneSlip→`daysOverdue` · overdueTrend→`current` · stalledWork→`count` ·
  budgetVariance→`variancePct` · raidAging→`daysSinceUpdate`), `insightMetricValue`/`insightMetricSnapshot`/
  `metricAtActionPatch`/`baselineOf`/`computeOutcome`. ★★ ALL metrics are LOWER-IS-BETTER, so `improved` ⇔
  current < baseline and `delta = baseline − current` — there is deliberately NO per-type direction table;
  a new detector whose metric is higher-is-better would break that assumption and needs one. ★ `delta` is
  NEGATIVE when worsened — the UI must render `Math.abs(delta)`. ★★ CAPTURE is at EVERY acted transition
  (manual `onActInsight` AND `confirmInsightRecommendation`), both spreading the SAME `metricAtActionPatch(i)`
  — read `i` from the functional setter's `prev`, NEVER a closure-captured insight, and the FIRST act wins
  (a re-act must not overwrite the baseline). ★★ MEASUREMENT lives in `reconcile`: `upsert` re-measures an
  `acted`+still-detected record from the fresh `det.data`; `clear` labels the (pre-existing SP1) acted→resolved
  auto-resolve as `improved` via `computeClearedOutcome` — ★★ DIRECTION-ONLY (no `current`/`delta`): four of
  the five detectors are THRESHOLD-gated (`stalledWork count<3`, `budgetVariance pct<10`, `raidAging days<7`,
  `overdueTrend current<=prior`), so "cleared" is BELOW THRESHOLD not zero, and reconcile has no detection left
  to read the true value from — emitting `current: 0` OVERSTATES the delta (review-caught: "improved by 10" for
  a real move of 8). `InsightOutcome.current`/`delta` are therefore OPTIONAL and the badge renders
  `insightOutcomeResolved` when they are absent. ★★ re-fire DROPS BOTH `outcome` AND `metricAtAction` — a
  recurrence is a NEW problem instance; keeping the baseline would make the next act a no-op for
  `metricAtActionPatch` ("first act wins") and measure a July recurrence against a March baseline.
  Measurement is idempotent (same data + same `today` ⇒ same outcome) so the reconcile→setInsights→re-run
  cycle converges — a test pins it. ★★ DATA-LOSS LANDMINE (third time in this feature): `insightsMateriallyEqual`
  MUST compare `outcome` (`outcomeEqual`) or the runner's churn guard skips the write-back and a freshly
  measured outcome is silently lost — exactly the SP1/SP2 class. ★ the badge (`insights/insight-outcome-badge.tsx`)
  renders in the Insights VIEW ONLY — the dashboard card filters to `active`/`acknowledged` while outcomes exist
  only on `acted`/`resolved`, so a card mount is unreachable dead code (one was written and removed). Direction
  rides the DOT; the wording carries the meaning so it is never colour-only. ★ the dot is a LOCAL
  `DIRECTION_DOT` token map, deliberately NOT the shared `RagDot` — that primitive's `level` is `Health`
  (`"R"|"A"|"G"`) and cannot express the neutral "unchanged" state (neutral→amber would read as "at risk").
  This mirrors every other non-Health dot in the app (`TIER_RAG` in `actions-panel`/`action-chips`, the
  resource-picker linked marker, tour step dots); `RagDot` stays reserved for genuine RAG health. Don't
  "fix" it to RagDot. ★ SP2 fold-ins landed here too:
  the recommendation context now includes a bounded linked-entity digest (milestones + raid only — the only
  detectors with an `entityRef`; RAID owner via `effectivePersonName`, incl. the `mitigation` plan so the model
  stops re-proposing an existing fix), a `rejected` recommendation re-offers the Generate CTA (shared
  `GenerateRecommendationCta`, NOT duplicated JSX — the dup gate is blocking), `runInsightRecommendation` lost a
  dead `| null`, and the background runner lost an unused `now` arg. ★ the apply preview re-derives against LIVE
  entities at apply time by design (a background proposal can be stale); the allow-set is enforced at load AND
  apply, so that divergence is safe.
- **SP4 — digest (0.193.0):** the FINAL slice. A rolling-window summary card at the top of the Insights
  view: fired / acted / open-now, plus a **wins** list (resolved-with-outcome) and a **regressions** list
  (worsened). Pure i18n-free `insights/digest.ts` `computeInsightDigest(insights, today, windowDays?)` →
  `InsightDigest`. ★★ Adds **ZERO persisted fields and ZERO backend write paths** — it is pure derivation
  over the lifecycle timestamps SP1–SP3 already store, so there is no six-write-path chore and no golden
  regen. Do NOT "improve" it into a persisted record. ★ window is INCLUSIVE at both ends (7 days = today +
  the 6 prior), cutoff via UTC-midnight `Date.parse` (the `bucketMilestonesByHorizon` pattern, no clock in
  the module — `today` passed in); future-dated events EXCLUDED (a skewed clock or imported record must not
  inflate counts); unparseable `today` → empty digest, never throws. ★★ `openNow` is deliberately NOT
  windowed — it is a live state, not an event — so `isEmpty` can be false with zero fired/acted, and the
  card separates it visually (own span behind a `·`) so "N open now" can't read as "N opened this week".
  ★★ wins and regressions are MUTUALLY EXCLUSIVE: the regression branch skips `resolved` records. Without
  that guard a resolved+worsened record counts in BOTH lists — unreachable in-app (`computeClearedOutcome`
  always writes `improved`) but `sanitizeInsights` RE-DERIVES direction from baseline/current and admits
  the shape from an imported blob. ★ the card (`insights/insight-digest-card.tsx`) is props-only (the
  panel's tests render outside providers), REUSES `InsightOutcomeBadge`, caps each list at
  `MAX_DIGEST_ROWS=5` with a NON-interactive `+N more` span (the full set is one History-toggle click away;
  a dead affordance is worse than a count), and makes a row a `<button>` only when `onOpenInsight` is
  passed AND `insight.entityRef !== undefined` — `stalledWork`/`overdueTrend`/`budgetVariance` are
  portfolio-level and carry NO entityRef, so an ungated row would be a dead button. Insights IS axe-scanned
  → row-unique accessible names.
- **SP4 cadence:** the SP2 background runner's fixed 15-min tick became
  `settings.ai.insightRecommendationIntervalMinutes` (default **60**, rides the `writeSettings` spread, no
  allowlist edit), edited via the shared `CapInput` in `AiSection` (shown only while
  `insightRecommendations` is on). ★★ ONE clamp — `clampInsightRecInterval` (`settings-types.ts`, whole
  minutes [15, 1440], the `clampMaxChatTurns` pattern) — is used by the sanitizer on load, the input on
  edit AND the runner on read, because this value drives BILLED calls; the FLOOR is load-bearing (`Number
  (null)` is `0`, which is finite, so only the range check rejects it). ★★★ `use-insight-recommend-runner`
  now has TWO effects and they must NOT be merged: a `[]`-dep one for the mount tick + `visibilitychange`,
  and an `[intervalMs]`-dep one for the `setInterval` ALONE. Folding the interval into the `[]` effect
  leaves a stale rate armed until reload; adding `[intervalMs]` to the effect that also fires the mount
  tick spends an EXTRA BILLED ROUND on every settings edit. The tick body lives in a `useRef` initializer
  (NOT an assignment during render — that trips the react-hooks purity rule); freezing the first closure is
  safe ONLY because the body reads nothing but refs — keep it that way.

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
- **Per-project setting overrides (`Workspace.settingsOverrides`, v0.190.42):** a "This project" Settings section
  (`settings-sections/project-overrides-section.tsx`, SectionId `projectOverrides`, hidden in popouts) overrides
  otherwise-per-device settings. SPLIT storage: POLICY overrides (nextActions/notifications/timezone) travel WITH
  the project = `Workspace.settingsOverrides` blob (storage-only, all 6 paths, gated `config===undefined &&
  hasAnyOverride`, EXCLUDED from exports — mirrors `timelogLinks`; `sanitizeSettingsOverrides`+`hasAnyOverride` in
  `settings-overrides.ts`; rides the SAME save/load wiring as `knowledgeItems` incl. the autosave-effect DEPS
  array). APPEARANCE overrides (density + showViewHints + tasksViewMode; theme/scheme EXCLUDED) = per-device-
  per-project `project-appearance-prefs.ts` (key `aipm-cockpit:project-appearance`, reactive via
  `subscribeAppearance`/`getAppearanceSnapshot` + `useSyncExternalStore`). ★ tasksViewMode: the Open Points
  pane's own Table/Board toggle is SCOPE-AWARE — while this project's appearance override is on it writes the
  project store (`saveProjectAppearance`), else device `setSettings`; the pane reads `effective.tasksViewMode`
  so an override no longer snaps back when toggled. Pure `resolveEffectiveSettings(device,
  policy, appearance)` (`settings-effective.ts`) merges OVERRIDE-else-DEVICE (partial-merge nextActions/
  notifications, whole-replace timezone/appearance); `useEffectiveSettings(projectId)` is the reactive hook. ★★
  CONSUMERS read EFFECTIVE (task-manager: nextActions RANKING/`buildActionInput` + reminders + timezone/today;
  workspace-section: density/showViewHints/world-clock) — the next-actions/timezone EDITORS stay DEVICE; no
  override ⇒ identical to before. ★★ the appearance store's projectId MUST be `portfolioCurrentId` (= tursoProjectId
  in Turso mode), NOT raw `registry.currentProjectId` — SettingsView + workspace-section must agree or the override
  lands under the wrong key in Turso portfolio mode (a caught review HIGH). The "This project" UI REUSES
  `NextActions`/`Notifications`/`TimezoneSettingsSection` fed effective + an override-writing onChange (Timezone
  passes `hideDisplaySwitcher` — the device-only switcher flag can't be captured into the override).
- **AI `update_settings` tool (safe-subset, v0.190.41):** a NON-entity write tool letting the assistant change
  a whitelisted slice of app settings on request — `dashboardDensity`, `showViewHints`, `tasksViewMode`,
  `enabledModules` (full desired set → `sanitizeFeatures`), and `nextActionsWeights` (each key coerced by the
  SAME `NEXT_ACTIONS_FIELD_COERCE` the settings UI + weight-suggestion flow use). Schema in `chat-tool-defs.ts`,
  routing in `chat-tools.ts` (`SettingsUpdateInput` + `updateSettings` on `ToolDispatcher`; the case throws if
  NO recognized field applied), impl in `use-chat-dispatcher.ts` (reads `settingsRef.current`, applies via
  `args.setSettings` → persists through the normal `writeSettings` effect, `isReadOnly` popout-guarded). ★★
  SECURITY: secrets / API keys / storage / integration config are DELIBERATELY unreachable — never widen this
  allowlist to a raw settings setter, and every value must stay routed through a validator/coercer. Guarded by
  `chat-tools.test.ts`.
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
  ★ R4 added THREE more: read-only `get_dashboard_snapshot` (live RAG + progress + EVM + budget rollup, via
  `ai-dashboard-snapshot.ts`) and read-only `list_allocations` (planner grid) — both zero-arg, NO `isReadOnly`
  guard (reads) — plus the write tool `set_task_dependencies`. Derived data reaches the dispatcher as
  un-memoized GETTERS on `ChatDispatcherArgs` (`getDashboardModel`/`getBudgetRollup`/`getAllocationsSnapshot`),
  each read through its own ref so the dispatcher `useMemo` dep array stays `[args.isReadOnly]` and an unused
  read tool costs nothing per render. Build the getter in `task-manager.tsx` beside the others.
  ★★ **REPLACE-SEMANTICS TOOLS: OMISSION MEANS DELETION.** `set_task_dependencies` replaces a task's whole
  predecessor list, so it is the ONLY tool in `runTool` where what the model LEAVES OUT is destroyed
  (`update_task` is a patch — a sloppy model can only overwrite what it names). Chat tool writes have **NO undo
  capture**, so that loss is unrecoverable. Two guards are mandatory and any FUTURE replace-semantics tool needs
  both: (1) a wholly-refused write (every proposed entry rejected, e.g. all cyclic) must leave the stored list
  UNTOUCHED — writing the empty result deletes the existing graph while the model reports only "I couldn't add
  that"; (2) every real write returns `removed[]` (prior minus applied) so a model that sends only the NEW entry
  instead of the full list cannot delete the rest invisibly. Validate the array-ness at the TOOL boundary
  (`chat-tools.ts` throws, mirroring `requireId`), not in the pure resolver — a non-array must never be treated
  as "clear all". ★ TEST TRAP: `expect(getX(id)?.field ?? []).toEqual([])` against a fixture that never had the
  field passes whether the code preserves or erases. Seed a real prior value and watch the test FAIL first.
- **AI allocation planning ("Plan with AI", Resources → Planning toolbar):** plan-then-apply over the EXISTING
  `Resource.utilization` map — ZERO new persisted fields, backend write paths or golden regen. Pure engine
  `alloc-plan/alloc-plan.ts` (prompt digest · forced `propose_allocations` tool · parse · **ground** · apply ·
  the `list_allocations` payload); one forced call in `alloc-plan-call.ts` (shared `runForcedToolCall`);
  glue hook `use-alloc-plan.tsx`; presentational `alloc-plan-modal.tsx`. Mirrors `task-dedup/` throughout.
  ★★ **`periodCapacityHours` (`resource-capacity.ts:145`) does NOT return available capacity** — despite the
  name it MULTIPLIES by the resource's own stored utilization (`percent: (util/100) × max(0, possible −
  absence)`, `hours: max(0, util − absence)`), i.e. hours ALREADY ALLOCATED. Used as "what fits" it reports
  every unallocated resource as **zero capacity** and a 50%-allocated person as `42/84`. Use
  **`availableCapacityHours`** (`alloc-plan.ts`) — workdays − holidays − absences, no utilization applied —
  and mirror its absence-override precedence (`absenceOverride?.[key]` first, else computed absence days) or
  the planner and the planning grid disagree about the same person. A contract-pin test holds the two
  functions equal at 100% utilization across all three absence branches.
  ★★ An allocation is a KEY in `Resource.utilization`, and its UNIT depends on that resource's own
  `utilizationMode`. The model always speaks HOURS; conversion happens in `groundAllocationCells`, which is
  also the anti-hallucination gate: unknown `resourceId` dropped, a `periodKey` outside the plan window OR at
  the wrong granularity refused (`PERIOD_KEY_RE` would otherwise eat it silently on the next load), negative/
  non-finite hours refused, values clamped to the SANITIZER's own bounds (percent ≤ 100, hours ≤
  `HOURS_MAP_MAX`) with a `clamped` flag, and a percent cell with ZERO capacity skipped — never written as 0
  or 100. ★ Writes are SET, NAMED CELLS ONLY (never window-ownership — that is the `timelog-apply` defect
  class), applied in ONE functional `setResources` with ONE `bulk.edit` undo entry, and confirm drops any cell
  whose live value moved since propose. ★ Every cap that can hide data reports it: `parseAllocationProposal`
  returns `truncated` (the cap that actually fires — the ground-level one is defence in depth and cannot),
  `buildAllocContext` caps periods (`ALLOC_CONTEXT_MAX_PERIODS`; 120 resources × 104 weekly periods was ~52k
  input tokens per click), and `list_allocations` carries a PER-RESOURCE `truncated` so an omitted resource is
  distinguishable from a genuinely idle one.
- **AI "Suggest RACI" (RACI matrix toolbar, 0.211.0):** plan-then-apply, mirroring `alloc-plan/` — no
  free-text instruction, just the live stakeholders + milestones. Pure engine `raci-suggest/raci-suggest.ts`
  (`buildRaciContext` digest · `RACI_SUGGEST_TOOL` schema · `parseRaciProposal` · `groundRaciCells` —
  re-grounds every UNTRUSTED model-proposed `{stakeholderId, milestoneId, role}` cell against the LIVE
  stakeholders/milestones, capped at `MAX_RACI_CELLS=200` with a `truncated` flag); one forced call in
  `raci-suggest-call.ts` (`runRaciSuggestion`, through the shared never-log `runForcedToolCall`); glue hook
  `use-raci-suggest.tsx`; review modal `raci-suggest-modal.tsx` shows every grounded cell's current value next
  to the proposed one, ticked by default, and applies only the ticked subset as ONE undo entry
  (`logActivity("ai.raciSuggest", …)`).
  ★★ **THE FOLD-PER-STAKEHOLDER LANDMINE — distinct from the bulk-edit FUNCTIONAL-SETTER landmine above,
  and NOT covered by it.** `useStakeholders.handleSaveStakeholder` already IS a functional setter
  (`setStakeholders(prev => …)`), so this is not that bug. The defect sits one layer up: `onSave` (the
  stakeholders pane's save handler) takes a SINGLE stakeholder and writes the CALLER's object verbatim, while
  `setRaciRole` (`stakeholders.ts`) returns a pure copy of a SNAPSHOT. Calling `onSave` once per accepted CELL
  means two accepted cells on the SAME stakeholder (different milestones) each fold into the same stale
  snapshot — the second `onSave` call silently drops the first cell's RACI entry. `foldCellsByStakeholder`
  (`use-raci-suggest.tsx`) collapses every accepted cell into ONE updated `Stakeholder` per person BEFORE any
  save happens, so `onSave` runs exactly once per touched stakeholder. ★ TEST TRAP: a fixture with one cell per
  stakeholder passes whether or not the fold happens — seed TWO accepted cells on ONE stakeholder to make the
  defect (and the fix) observable.
  ★★ **AMBIGUITY IS MEASURED AGAINST THE WORKSPACE, NOT THE PROPOSAL.** `raci-suggest-modal.tsx` qualifies a
  colliding name as `Name (#id)` using counts over the LIVE `stakeholders`/`milestones` lists (the same
  case-folded tally as `raci-panel.tsx`'s `labelFor`), for BOTH the accessible name and the VISIBLE text.
  Scoping the check to the proposed cells looks equivalent and is not: one proposed "Ada" while a second
  "Ada" exists in the project renders bare, and the user cannot tell which person this write lands on. Neither
  can `Milestone.name` be assumed unique — the milestone half needs the same treatment. ★ TEST TRAP: every
  fixture that keeps BOTH colliding rows in `cells` gives the same answer under either scope, so it proves
  nothing — seed the collision with only ONE side proposed. ★★ Qualifying only the `aria-label` and leaving
  the visible text bare is its own bug: it leaves the sighted user with strictly LESS information than the
  screen-reader user, in a dialog whose entire job is choosing which rows to commit.
  ★★ **THE CONTEXT CAP MUST REACH THE USER.** `buildRaciContext` caps at `MAX_CONTEXT_STAKEHOLDERS`/
  `MAX_CONTEXT_MILESTONES` and returns `truncated`; the hook surfaces it as `contextTruncated`, which the
  modal renders as its OWN sentence. Keep it distinct from `truncated` (the RESPONSE cap): they have opposite
  causes, and a capped INPUT means a missing proposal may simply be someone the model was never shown —
  otherwise silence reads as "Claude decided they need no role". This flag was computed and dropped on the
  floor at first, with only its engine unit test consuming it — so the engine test passed while the product
  had no such behaviour. A flag whose sole consumer is its own test is not a feature.
  ★ The modal's zero-cell branch must NOT say "Claude proposed no assignments": the hook only opens the
  preview with zero cells when everything was SKIPPED, so that sentence is false exactly when it renders.
  ★ `groundRaciCells` refuses an Accountable HANDOVER within one proposal (demote A, promote someone else on
  the same milestone) — `accountableHolder` still holds the old id when the second cell is examined.
  Conservative and safe, but it silently discards a natural proposal.
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
force `auto:false` when un-enabling (else re-enabling silently reactivates auto).
★★★ AND `sanitizeOutlookCalendar` MASKS `auto` BY `enabled` AT LOAD — do not weaken that on the assumption the
read-side `calendarSyncFor` mask covers everything, because it does NOT. The four toolbar enable-toggles
(`tasks-section.tsx`, plus raid/change/absence in `use-calendar-integrations.ts`) read the RAW stored `auto`
when switching a row ON, not the masked value, so a stored `{enabled:false, auto:true}` would arm unattended
two-way sync from a single click. No in-app writer produces that pair; an imported or hand-edited settings blob
can, which is why the guarantee has to hold at the STORAGE layer. Pinned by `calendar-sync-config.test.ts`; the
four toolbar guards themselves are still untested (`docs/open-followups.md` §57). Manual "Push to Outlook" button
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
- **Actuals cache:** fetched actuals are per-device (`aipm-cockpit:timelog-actuals`, mirrors `landing-state`; out of exports/Turso; cleared by `clearAppConfig`) — NOT workspace data. ★★ Keyed on the CANONICAL `portfolioCurrentId ?? "default"` (0.211.1), the same key the picker scope / `landing-state` / project-appearance use — NOT on `ws.project?.code`, which is user-editable and orphaned the cache on a rename. `timelog-panel.tsx`'s `projectCode` local keys NOTHING; it is only `useTimelogPickerScope`'s in-place project-switch signal and must keep receiving the code. ★ The store is one flat `Record<string, …>`, so never mix a second namespace into it (a code-keyed fallback let one project's "Clear all" delete another's entry — `docs/open-followups.md` §14). Pure `timelog-actuals.ts` aggregation routes unmapped user/project/null-bucket hours to an `unattributed` total (never dropped).
- **Timelog panel module map:** `timelog-panel.tsx` is the orchestrator; the PURE presentational pieces are `timelog-people-table.tsx` (`TimelogPeopleTable` — the people-matching DataTable) and `timelog-apply-confirm.tsx` (`TimelogApplyConfirm` — the itemized apply confirm bar). Both take data + handlers as props and own no state (gantt convention).
- **Apply to budget:** `timelog-apply.ts` is the ONLY write into the persisted budget — writes each bucket's period hours into the `actualHours` of the allocation line the booking's PERSON belongs to, via a FUNCTIONAL `setBudgets(prev=>…)` updater. Everything else is read-only overlay. ★★ ATTRIBUTION (fixed — it previously folded the whole bucket total into `allocations[0]`, so `computeBucketReport`'s `cost += aActual * internal` costed EVERY person at the first role's rate): `ActualsByBucket` cells carry an OPTIONAL `byResource` breakdown (`BucketPeriodCell`), and `allocationIndexFor` routes each person by `allocation.resourceIds` first, else their directory `Resource.roleId` → `allocation.roleId` (blended: role's `disciplineId` → `disciplineAllocation.disciplineId`). ★★ The panel passes **`matchableResources`** (internal only), NOT `ws.resources`, and `allocationIndexFor` returns `null` for anyone ABSENT from that list — checked BEFORE the `resourceIds` match, which otherwise never consults the directory. `isExternal` means capacity-only/excluded from all cost figures, but `autoMatchUsers` passes MANUAL links through unconditionally, so a hand-linked external does reach `byResource`; without both halves of this guard their hours land on a role line and `budget-report` costs them at its internal rate (review-caught). A dangling `resourceIds` ref to a deleted resource is withheld for the same reason. ★★ Apply OWNS every target line of a period that routed at least one NON-ZERO booking (`hc.hours !== 0` gates `routedPeriods.add`) — a person whose hours net to zero (a +4/-4 credit correction) says nothing about the period, so on its own it must not claim every line and zero a HAND-ENTERED figure; their own line is still written to 0 when some other booking arms the period — a line with no bookings in such a period is written to **0**, never skipped, or a stale total (e.g. one left by the old `allocations[0]` behaviour) survives beside the new per-role numbers and DOUBLE-COUNTS the bucket. ★★ A period whose hours were ENTIRELY unattributable is EXCLUDED from `Routed.periods` and nothing is written for it — ownership exists to clear a stale total the same period is about to replace, so with nothing to replace there is nothing to clear. Do NOT revert this to `Object.keys(periods)`: `use-timelog-sync` seeds `aggregates` from the persisted cache, so an upgraded user whose cached cells predate `byResource` would zero EVERY line in one click (review-caught data loss). ★ KNOWN consequence of that exclusion: within ONE bucket a routed period is rewritten per-role while an unroutable period keeps whatever a previous apply left — mixed provenance in a single bucket total. Accepted (the alternative is the data loss above); the unmatched notice is what tells the user some periods were skipped. ★★ Hours matching NO line (unlinked person, `roleId: null`, external/unknown resource, role absent from the bucket, or a pre-breakdown cached cell with no `byResource` — the empty-breakdown guard is `cell.hours !== 0`, NOT `> 0`, since TimeLog emits negative credit corrections) are WITHHELD and surfaced via the `timelogApplyUnmatched` notice (fed by `buildApplyPlan().unmatchedBuckets` — `bucketsWithUnmatchedHours`/`planApply` are now test-only wrappers, NOT the runtime path) — never written to an arbitrary line, which is the original defect at another role's rate. ★★ The notice also carries `unmatchedHours` (NET withheld hours), because a bare bucket count told the user something was wrong but not how far off the budget would read. Gate the notice on `unmatchedBuckets`, NEVER on `unmatchedHours` — a +40/-40 credit-correction pair nets to ZERO while hours are still being withheld. ★★ `actualHours` is a USER-EDITABLE input (`budget-panel.tsx` `onActual`), so period-ownership can zero a HAND-ENTERED figure on a line TimeLog never routed to (PM types 40h for a designer who books no time; someone else books that week; the 40 → 0). The confirm dialog therefore ITEMIZES every row via `describeApplyRows` (bucket · role/discipline line · period · current → next) instead of showing a bare count — do NOT revert it to a count, that is a silent overwrite of user-entered financial data. `describeApplyRows` reuses `roleLabel` (a `Role` has NO name of its own — it is discipline × grade). `byResource` is optional because the per-device actuals cache persists aggregates and its guard only shallow-checks `aggregates`; a re-fetch repopulates it. ★ `planApply` rows are per bucket·**allocIndex**·period and OMIT unchanged lines, so the confirm modal's count means "changes that will be written". ★★ The actuals period KEY MUST match the plan granularity: `computeBucketReport` sums `actualHours` ONLY over the plan's period keys (`bucketActivePeriods`→`generatePeriods`, `PlanGranularity` "week"→`"YYYY-Www"` / "month"→`"YYYY-MM"`). `aggregateActuals(items, links, granularity)` keys via the SHARED `periodKeyForDate` (in `resource-capacity.ts`, the single source `generatePeriods` itself uses — don't re-derive ISO weeks). Pass `plan.granularity` panel→`useTimelogSync`→engine; ★ `granularity` is a REQUIRED arg (no default — a silent "month" fallback was removed; a monthly key on a weekly plan silently drops hours from win/loss). ★ `aggregateActuals` builds project refs from items but SKIPS `projectId <= 0` (absence/non-project time → would render a blank Projects row). ★ Apply uses a `pendingApply` SNAPSHOT taken at confirm-open (not live aggregates) so the shown diff == the diff applied; Fetch is disabled while confirming. Matching `<select>`s/Clear are `isPopout`-disabled + handlers early-return (popout = read-only).
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
  secret. Inspect via `window.__aipmDiag()`. Panel = Settings → Diagnostics (level/code filter + summary;
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
- **Budget bucket earned value (Phase C EVM, ★):** `BudgetBucket` gained `taskIds?: number[]` (tasks whose completion drives the bucket's derived progress) + `percentComplete?: number` (manual 0-100 override — WINS over the derivation whenever set, including 0). Both ride `BUDGETS_CSV_COLUMNS` (→ CSV + Turso single/tenant DDL/insert, turso-migrate self-heals existing DBs) and `BUDGETS_MD_COLUMNS`, and are SPARSE-emitted so a bucket that never sets them stays byte-identical (no golden regen for untouched buckets). Pure i18n-free `budget-earned-value.ts`: `bucketPercentComplete(bucket, tasks)` (manual value first; else the share of `taskIds` that are `isTaskFinished` — Done|Cancelled — among the ones still present in `tasks`; `null` when neither source resolves — never guesses) and `earnedValueFor(budgetedCost, pct)` (= budgetedCost × pct/100, `null` when `pct` is `null`). `budget-report.ts` folds `earnedValue`/`costPerformanceIndex` (= earnedValue ÷ actual cost, guarded on `cost > 0`) into both `BucketReport` and the project rollup; `costPerformanceIndexHealth` (`budget-health.ts`) bands the TRUE 0-1 EVM ratio (R<0.8, A<0.9, G>=0.9 — same thresholds as the pre-existing `costPerformanceHealth` percent-flavor, just on a different scale, so the two never collide). ★★ PROJECT ROLLUP IS ALL-OR-NOTHING: `projectEarnedValue`/`projectCostPerformanceIndex` are `null` unless EVERY relevant budgeted bucket has a known `earnedValue` — one un-scored bucket blanks the whole rollup rather than silently summing a partial figure (mirrors the panel's `costIsKnowable` anti-approximation stance from the 0.195.x McGuire line). The Budget panel's fourth Cci tile ("Cost performance (CPI)", `budgetCciCpi` — the key freed when the old BAC/AC tile was renamed "Cost burn"/`budgetCciBurn` in 0.195.x) renders "—" whenever `costPerformanceIndex` is `null`. The bucket editor modal's task-link field reuses the shared `TaskLinkPicker` chip picker (same primitive as RAID/Change linked-tasks) — do not hand-roll a new one; clearing the manual % writes `undefined`, not `0`, mirroring the rate-override clear-to-undefined pattern.
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

### Resource calendar meetings

Recurring meeting occurrences render on the Resource Calendar alongside the pre-existing absence grid. New
entity `CalendarEvent` (`calendar-event.ts`) — one stored date + an optional `RecurrenceRule` + per-instance
`EventException[]` overrides — is expanded at render time by pure, clock-free `recurrence.ts`
`expandOccurrences(event, windowStart, windowEnd)` (the window is always a param, never `new Date()`).
`Occurrence` carries BOTH `date` (rendered/possibly-moved) and `originalDate` (the date the RULE produced) —
exceptions key off `originalDate`, and so must every caller that resolves one back to an occurrence; keying
off the rendered date instead silently mints a duplicate. Expansion is hard-capped at `MAX_OCCURRENCES=1000`
(a `truncated` flag, never a silently-incomplete list) and searches `GENERATION_BUFFER_DAYS=366` past the
window so a MOVED occurrence whose rule-date falls outside it is still found. ★ A caller deriving "the first/
nearest occurrence" from `event.startDate` directly (skipping expansion) reproduces a real, fixed bug — a skip
or move exception on the very first rule-generated instance means `startDate` disagrees with what the
calendar actually shows; always derive it via `expandOccurrences`, never read the raw field.

- **`applyOccurrenceMove(event, originalDate, toDate)`** (`calendar-event.ts`) decides how a drag is recorded:
  a RECURRING series gets a `move` `EventException` keyed by `originalDate`, REPLACING any existing exception
  for that date rather than stacking a second one; a NON-RECURRING event has `startDate` rewritten directly
  instead — an exception on a one-occurrence event would be a second, potentially-disagreeing source of truth
  for the same date. A no-op (`originalDate === toDate`) returns the input BY REFERENCE. Does not itself
  validate that the dates it's given are well-formed — both callers (the band's drag, the editor's date
  input) can only ever produce valid ones.
- **Six write paths, one `ENTITY_SPECS` line for three of them.** `spec<CalendarEvent>({table:
  "calendar_events", wsKey:"calendarEvents", columns: EVENTS_CSV_COLUMNS, ...})` (`turso-schema.ts`) covers
  CSV + BOTH Turso schemas at once — see "New persisted `Workspace` field → SIX write paths" above; the other
  three are hand-wired: Markdown (`EVENTS_MD_COLUMNS` + `calendarEventsToMarkdown`, `markdown-codecs-core.ts`
  — reuses `calendarEventFieldToString` from the CSV side rather than re-deriving cell values, so the two
  formats can't drift on what a column contains), JSON (`workspaceToJson`/`jsonToWorkspace`, `workspace.ts` —
  ★ the ENCODER side is easy to miss when a plan only specs the decoder, since the two live as separate
  additive blocks), and IndexedDB (a `KV_CALENDAR_EVENTS_KEY` KV slot in `browser-backend.ts`, deliberately
  NOT a new object store — a store needs an IDB version bump + upgrade path; events number in the tens).
  `Workspace.calendarEvents?` also had to join `isWorkspaceEmpty` + `nonEmptyCollectionCount` +
  `workspaceRecordCount` (`workspace.ts`) — skip even one and an events-only project either reads as EMPTY
  (arming the data-loss guard against a legitimate save) or a mass-deletion of every event goes completely
  undetected by the save-path guard, the more dangerous of the two failure directions.
- `recurrence`/`exceptions`/`attendeeResourceIds` ride as JSON-in-cell (`encodeRecurrence`/`decodeRecurrence`
  etc.). ★★ UNLIKE note-log's decoders, these do NOT self-validate — `sanitizeRecurrence` needs `startDate`
  for the `until >= start` cross-field check, which a decoder alone has no access to. A decoded cell is
  UNTRUSTED; any caller assembling a `CalendarEvent` from decoded cells MUST re-run the whole object through
  `sanitizeCalendarEvent()` before using it.
- ★★ Every CSV/MD cell for an unset column decodes to a real `""`, never `undefined`, so
  `sanitizeText(...) || undefined` is the RULE for any optional string arm — a bare
  `typeof === "string"` check keeps the empty string as a value and it round-trips as one.
  `sanitizeCalendarEvent` needed it for `localModifiedAt`; `sanitizeAbsence` (`sanitize-entities.ts:100`)
  and `sanitizeShift` (`:185`) had the bare-check bug and were FIXED the same way in 0.202.1 — both now read
  `sanitizeText(raw.localModifiedAt, 1024) || undefined`. (Earlier revisions of this bullet said the bug was
  "still live" in those two; that text outlived the fix.) The `sanitizeResource`/`sanitizeRole`/
  `sanitizeNamedRef`/budget-bucket arms use the different `if (typeof x === "string" && x)` shape, which is
  truthiness-guarded and therefore already correct — don't "fix" those to match.
- The `calendarEvents` export section is a first-class `ExportSectionKey`, default **ON**, gated by
  `enabled("calendarEvents")` in BOTH the CSV (`csv-codecs-config.ts`) and Markdown (`markdown-codecs-core.ts`)
  encoders — the two briefly diverged mid-release (one still on the storage-only gate other config blobs use)
  before being reconciled; a future edit to one MUST touch the other or a user's export checkbox stops
  meaning the same thing in both formats.
- **Meeting CRUD logs + undoes like every other entity.** `use-calendar-events.ts` takes the same four
  OPTIONAL callbacks `useChangeLog` does (`logActivity`/`logActivityChanges`/`capture`/`captureFieldEdit`),
  threaded from `use-resource-planner.ts` in ONE line — that file sits at its size-ratchet baseline, so
  keep it one line. Kinds: `calendarEvent.created`/`.updated`/`.deleted`.
  ★★ `CALENDAR_EVENT_UNDO_GROUPS` binds **startDate + recurrence + exceptions as ONE unit** and must stay
  that way: `sanitizeCalendarEvent` clears `exceptions` whenever `recurrence` is absent, and
  `sanitizeRecurrence` cross-validates `until >= startDate`. Split into separate entries, an undo can
  restore a rule whose exceptions are gone, or an `until` the very next load strips again — the undo looks
  like it worked and then doesn't. The editor also warns (`calendarEventExceptionsDiscarded`, a `FieldHint`)
  before a de-recurring save discards them.
  ★★★ A NEW UNDOABLE ENTITY NEEDS **TWO** REGISTRATIONS, not one. Adding the `ActivityKind`s buys the
  activity log; the undo LABEL needs the kind's prefix added to `UndoEntityKey` + `ENTITY_SINGULAR` +
  `ENTITY_KEY_SET` (`undo/use-undo-stack.ts`) plus an `undoEntity*` EN/DE string. Miss it and
  `entityKeyFromKind` returns `null`, so `buildUndoLabel` hits its generic `"Deleted N item(s)"` fallback
  **without ever using `opts.name`** (it computes the trimmed name one line earlier, then returns without
  it) — the capture site's carefully-passed title is silently dropped from
  every undo/redo toast while restore itself still works perfectly. That is invisible to functional tests
  (calendarEvent shipped exactly that way and EIGHT review passes missed it; a ninth caught it). The
  lockstep is now pinned by a sweep test in `undo/use-undo-stack.test.tsx` that walks every row-entity
  prefix in `ACTIVITY_KIND_TO_KEY` and fails on any that resolves to the generic label — `settings` is the
  one legitimate exemption (a singleton config write, no row to name).

**The calendar surface** (`resource-calendar.tsx` orchestrator + `resource-calendar-rows.tsx` assignee rows +
`resource-calendar-band.tsx` meetings band — same orchestrator/presentational-pieces split as gantt's
`gantt.tsx` + `gantt-rows.tsx` + `gantt-chrome.tsx`) grew a lane-packed meetings band: an extra `<tbody>`
rendered ABOVE the assignee rows but INSIDE THE SAME `<table>`,
so shared columns keep the band aligned with the day headers below it. Shared day/assignee vocabulary
(`CELL_PX`/`ASSIGNEE_COL_PX`/`CalendarAssignee`/`CalendarDay`) lives in its own leaf
`resource-calendar-shared.ts`, owned by neither sibling — mirrors the `gantt-engine.ts` precedent, and is
necessary rather than stylistic: `CELL_PX`/`ASSIGNEE_COL_PX` are VALUE bindings (not type-only), so either
sibling importing them from the other would be a genuine circular VALUE import (a real TDZ/evaluation-order
risk). `packOccurrenceLanes` (`occurrence-lanes.ts`) is a pure greedy packer over the already date/time-sorted
output of `expandOccurrences`: it checks EVERY occurrence already placed in a lane (not just the last one), so
an out-of-order input still packs correctly.

- ★★ Band cells carry `data-band-cell`, NOT `data-cell` — the grid's roving-tabindex model (`onGridKeyDown` in
  `resource-calendar.tsx`) indexes `data-cell` by row/column and treats exactly ONE such element as the tab
  stop. ★ That invariant is scoped to the DAY-CELL MATRIX specifically, NOT a whole-table "exactly one
  focusable element" property. A band cell wrongly caught by the `[data-cell]` selector is still a real bug
  (it would get folded into the roving model's row/column indexing and desync arrow-key navigation), so keep
  guarding that — but verifying it needs the resolved `.tabIndex` IDL property, not a raw `tabindex="0"`
  ATTRIBUTE match: a native button with no explicit `tabindex` attribute still has `.tabIndex === 0` (it IS in
  the tab order), so an attribute-only query is blind to it and will silently pass regardless of whether the
  real invariant holds.
- ★★ **Band chips reschedule from the keyboard**, mirroring the day grid one row below: Alt+Left/Right ARMS a
  move and accumulates a day delta IN STATE, Enter commits it as ONE `onMoveOccurrence` call (one undo entry
  per intent, not one per keypress), Escape cancels. ★★ There is NO preview: `pendingMove` is read only in the
  handlers, never during render, and the live region emits a CONSTANT string that does not report the
  accumulated delta — so three Alt+Rights give no visual and no announced feedback before Enter commits. The
  day grid has the identical gap. Do not describe either as "previewing"; building a real preview (a ghost
  chip + a delta in the announcement) is the open follow-up. ★ Gated on `onMoveOccurrence` — with no handler (read-only popout)
  Alt+Left stays browser Back, which is what `band-roving.ts`'s modifier guard preserves. ★ While armed the
  handler returns EARLY, so a plain arrow cannot walk the roving cursor out from under the preview; Alt+Up/Down
  are ignored (occurrences are single-day and lanes are packing artefacts — no row axis, no resize gesture).
  ★★ Commit routes through the SAME `resolveOccurrenceDrag` the drop handler uses, keyed on
  `(eventId, originalDate)` — read `occurrence-drag.ts` before touching it; both of its documented identity
  bugs are reachable from the keyboard path too, and its no-op result must write nothing.
  ★★ The announcement lives in the PARENT: this component renders a `<tbody>`, which cannot host a live region,
  so it reports up via `onMoveModeChange` and `resource-calendar.tsx` folds it into the ONE `aria-live` region
  it already owns for the grid's identical gesture (the two are mutually exclusive — focus is in one or the
  other). A new band-level announcement goes through that prop, not a new region.
- ★★ **Focus survives a chip unmounting** (a reschedule, or an edit that relocates the occurrence): a
  `lastFocusedKeyRef` records the last focused `lane-iso`, and an effect re-focuses the clamped `focusIndex`
  chip when that key has VANISHED **and** `document.activeElement === document.body`. Both guards are
  load-bearing — the vanished-key check stops an unrelated re-render from grabbing focus, and the body check
  stops it yanking focus out of a control the user moved to. Side effect ONLY (a `.focus()` call), never
  setState; `set-state-in-effect` is fatal here. Deliberately NOT driven by tracking focus leaving the band:
  removing a focused node does not reliably fire blur, and a click on dead space blurs with no `relatedTarget`.
- ★ **Chip accessible names are de-duplicated in the `chips` memo** (the only place that sees every rendered
  chip at once). Base is `title – date time`; a COLLIDING name earns ` (#eventId)`, and one still colliding
  after that earns the `originalDate` — the same-series-twice-on-one-date case a move exception can create,
  where the event id cannot separate them. Unconditional suffixing was rejected: it makes every announcement
  noisier for a rare case. ★ A collision test needs a fixture with two genuinely same-title/date/time series
  or it proves nothing.
- ★★ **The band runs its OWN roving group** over `[data-band-cell]` (pure `band-roving.ts` `moveBandFocus` +
  local state in `resource-calendar-band.tsx`): ONE chip is a tab stop, Left/Right walk chips in reading order
  (lane-major, then date — crossing lane boundaries, clamped not wrapping), Home/End jump to the ends, and
  Up/Down cross to the nearest chip at-or-after the current date in the closest NON-EMPTY lane. So the table
  has TWO roving groups (band + day-cell matrix) = 2 tab stops, plus the row-header edit buttons which sit
  outside both by design (they were tab stops long before the band existed). Chips were natively tabbable
  until the R5 batch-2 follow-up — ~65 tab stops ahead of the grid on a quarter-wide window with one daily
  series.
  ★ Left/Right walk READING ORDER, so they cross lane boundaries — a horizontal key changing rows is the
  second (smaller) deviation from a strict `role="grid"` model, and it is deliberate: a sparse band reads as
  one sequence, not as rows a user navigates independently.
  ★ The band is deliberately NOT folded into the day-cell matrix: band cells are overwhelmingly EMPTY and, unlike
  an empty day cell (which is clickable — it adds an absence), an empty band cell does nothing, so a unified
  matrix would make arrows walk dozens of dead cells AND re-index every absence move/resize site in
  `onGridKeyDown` against an offset row space. ★★ `onBandKeyDown` navigates from `document.activeElement`, NOT
  from the `focusChip` marker — a click focuses a chip directly and the marker's own state update is not
  necessarily committed by the next keypress, so a marker-driven handler jumps the user somewhere they never
  were (caught by a test, not by review — and a mutation test confirms the ArrowDown lane-crossing case FAILS
  if it is reverted to the marker, so don't "simplify" it back). The marker exists only to place the tab stop
  and FOLLOWS focus via each chip's `onFocus`; it is clamped on read so a window change that shrinks the band
  can't strand it.
  ★★★ The chip-INDEX memo and the RENDERER must evaluate the SAME EXPRESSION — literally
  `occ && eventsById.get(occ.eventId)`, NOT an equivalent one. (`has()` and a truthy `get()` agree for every
  map the type permits, but they are two different questions; the code comment argues this, so don't
  "simplify" the memo toward `has()`.)
  `lanes` and `eventsById` arrive as INDEPENDENT props, so if the index counted a chip the renderer skips, the
  marker could point at a phantom index and NO rendered chip would get `tabIndex={0}` — a band unreachable by
  keyboard, strictly WORSE than the per-chip tab stops roving replaced. Enforced in the memo (with `eventsById`
  in its deps) + a test rendering an occurrence whose event is absent.
  ★ EVERY lane's `role="rowheader"` carries a name — lane 0 the visible "Meetings" label, lanes 2+ an `sr-only`
  "Meetings N". Arrow keys now move BETWEEN lanes, so an empty header is a row a keyboard user can land in that
  announces nothing (WCAG 1.3.1); it was only tolerable while the band was mouse-only.
  ★ `moveBandFocus` returns `null` for any Alt/Ctrl/Meta chord — a roving group inside a page must not swallow
  Alt+Left (browser Back). Shift is NOT excluded (it competes with nothing here).
- ★★ The absence resize grips reuse the shared `DragHandle` atom (`drag-handle.tsx`, extracted from the
  gantt/table-manager `ColumnResizeHandle`) in its DECORATIVE mode — no `ariaLabel`, so it renders
  `aria-hidden` with no role; the surrounding `<span title=...>` carries the accessible name instead. The
  ACCESSIBLE mode (pass `ariaLabel`) adds `tabIndex={0}` + `role="button"`, which would add TWO extra tab
  stops (start+end grip) to every rendered absence cell — the reason to keep grips decorative is that
  multiplying cost, not a strict "exactly one focusable element in the whole table" invariant (row headers and
  band chips already sit outside the day-cell roving set, deliberately, per the bullet above) — never pass
  `ariaLabel` to a grip that lives inside this grid.
- ★ React Compiler trap: `onGridKeyDown` is a hoisted, non-JSX function (not an inline handler) that reads a
  `useMemo`'d `Map` (`resourceByKey`). Calling `resourceByKey.get(key)` directly from inside it broke
  `preserve-manual-memoization` on that unrelated `useMemo` — fixed via a `useCallback` indirection
  (`resourceFor`) wrapping the `.get()`. Verified: reverting the indirection reproduces the lint error. Don't
  "simplify" it back to a direct `.get()` call from a hoisted function.
- **Series list sorting (`calendar-series-list.tsx`):** Title and Next are sortable via the shared
  `SortResizeTh` with NO `onResize` (this list persists no column widths); Recurs and Edit stay bare `<th>`s
  — a rendered recurrence phrase is not a scale, and the last column holds a control. ★ Default is
  `dir:"off"` = WORKSPACE order, and the asc→desc→off cycle makes it recoverable: the user's own record order
  is information no derived ordering can reconstruct. ★★ A series with no resolvable next occurrence sorts as
  UNKNOWN (held out of the comparison, appended in BOTH directions), never via a sentinel date — a sentinel
  that sinks such a row ascending FLOATS it to the top descending, the one place it must never be. Both
  fallbacks ("no further occurrences" and the truncated-search "unknown") are unknown for this purpose.
- A new entity's edit modal needs an entry in BOTH the `ModalId` union AND `MODAL_FIELDS`
  (`modal-fields.ts`, a `Record<ModalId, readonly ModalField[]>`) — tsc catches a forgotten `MODAL_FIELDS`
  entry immediately for a normal edit (the Record type ties the two together), but a caller reaching
  `EditModalShell` with an unregistered/type-asserted id loses that safety net: every consumer
  (`field-visibility.ts`, `modal-field-controls.tsx`) calls `.map()`/`.filter()` on `MODAL_FIELDS[modalId]`
  unconditionally, so an id that slipped past the union crashes on `undefined.map`.
