<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
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
                            # `useState(() => Date.now())`, or read it inside an effect/callback.)
npx tsc --noEmit            # typecheck (enforces i18n EN/DE key parity)
npm run test:run            # vitest (unit/integration)
npm run e2e                 # playwright (incl. the 12-view axe a11y gate)
```

## Hard constraints (CI-enforced — these gate merges)

- **i18n:** `i18n.ts` (EN) + `i18n.de.ts` (DE) key sets must be identical (tsc enforces).
  DE must use real German umlauts — the `i18n-encoding` test BANS ASCII subs (fuer/druecken).
  The Edit tool corrupts umlauts AND curls double-quotes in `i18n.de.ts` (bites umlaut-free
  strings too); patch it via a node utf8 write and re-verify. The file is CRLF — a node
  replace whose anchor uses `\n` silently no-ops; match `\r\n`.
  Interpolated strings use 0-based positional placeholders: `t(lang, key, a, b)` → `{0}`/`{1}`.
  `Lang` is `"en-US" | "en-GB" | "de"` — there is NO `"en"` (legacy runtime alias only, invalid
  as a TS literal; `t(lang, …)` calls and component tests must use `"en-US"`). The DE dict is lazy —
  a test asserting DE output must call `loadI18n("de")` (e.g. in `beforeAll`) before the assertion.
- **Byte-stable serializers:** `golden-workspace.test` pins the exact CSV/Markdown storage bytes.
  A failure usually means a real format change — only regenerate the `__fixtures__` when the
  *input* (`sample-workspace-small.json`) legitimately changed, never to mask a format diff.
  Renaming/moving sample data or any asset: grep `e2e/` TOO (not just `src scripts README docs`) —
  `e2e/seed.ts` reads `sample-workspace-small.json` at MODULE TOP-LEVEL, so a stale path ENOENTs the
  whole e2e job (fails only in CI; `npx playwright test --list` triggers the read without browsers).
- **Palette:** only the sanctioned AIPM brand tokens (`globals.css`); no off-palette colors,
  gradients, or shadows. The a11y gate + palette-sweep test enforce contrast/token use.
  Note: palette-sweep scans CSS for `box-shadow` — an off-palette Tailwind class (e.g. `shadow-md`)
  on an element PASSES CI but is still forbidden; check new components by eye.
- **a11y (axe gate):** every new interactive control (button/checkbox/input/drag handle) needs an
  accessible name and keyboard operability — an unlabeled form control is an axe-critical FAIL.
  A `placeholder` is NOT an accessible name — an input needs `aria-label`/`<label>` (a placeholder-only
  input fails the axe gate even though it looks labeled).
  In a LIST of rows, per-row controls need a row-UNIQUE accessible name (e.g.
  `aria-label={`${t(lang,"edit")} – ${row.name}`}`) — N identical "Edit"/"Enabled" labels is a
  WCAG 2.4.6 fail, but the axe gate can PASS it when the live app seeds only ONE row (the collision
  never renders at scan time). Qualify the label; don't trust a green axe run with a single seeded row.
  Moving/folding a control INTO an axe-scanned view re-scans it: the gate scans `Settings`→General, so
  folding Storage/Appearance into General surfaced a pre-existing unlabeled `<select>` (a visible
  `<span>` label is NOT an `aria-label`/`<label>`) as axe-critical.
  The `A11Y_VIEWS` list (`e2e/a11y.spec.ts`) is 12 named views and does NOT include the chat/AI-Assistant
  view — controls only on the chat surface aren't scanned, but anything in the always-present top bar IS
  (scanned via every view). Verify IA/UI/contrast changes with
  `npx playwright test e2e/a11y.spec.ts --project=chromium -g "<View>"` (~16s, webServer auto-starts)
  BEFORE pushing — the unit suite (`test:run` = vitest) never runs playwright, so axe regressions slip
  the local gate and fail ONLY in CI.
- **CI is GitLab** (not GitHub),  (GitLab). Pipeline: install → lint → typecheck → unit → build → e2e.
- **Releasing:** bump `src/app/version.ts` (APP_VERSION + milestone), add a `CHANGELOG.md` entry,
  and append any new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` (+ EN/DE strings).
- **New persisted `Workspace` field → SIX write paths** (JSON/CSV/MD/Turso-single/Turso-tenant/
  IndexedDB). Miss one and data silently drops on that backend.
- **New COLUMN on an existing entity** (e.g. `Milestone.outlookEventId`): add it to the entity's
  `*_CSV_COLUMNS` (covers CSV **and** Turso single+tenant — the DDL/insert derive from it), plus the
  markdown codec + `sanitize.ts`; REGENERATE `__fixtures__/golden-*` (a legit new-column format change)
  and append the column to the curated `sample-workspace` `.md`/`.csv`. EXISTING Turso DBs:
  `CREATE TABLE IF NOT EXISTS` can't add the column and the save INSERTs *named* columns, so an old DB
  errors on save — `turso-migrate.ts` self-heals it (PRAGMA-diff → `ALTER ADD COLUMN`, run inside the
  write lock before the save).
- **Turso-gated features** (Snapshots/Trends, version history) must check `tursoConfig !== null`,
  not just `storageConfig.kind === "turso"` (kind can be set while the config is unset/quarantined).
- **CSP allowlist:** every host the BROWSER calls (Turso, Anthropic, MS Graph, MSAL, Jira) must be in
  `src/proxy.ts` `connect-src`/`frame-src` — NOT `next.config`. A missing host fails only at RUNTIME
  (unit tests mock `fetch`; `next build` passes), so it silently slips through CI. CSP edits need a dev-server restart.
- **New Turso table that is NOT workspace data** (snapshots, version history, comm_templates)
  must stay OUT of `TABLE_NAMES` (a guard test enforces it) — else the workspace save's
  per-table DELETE wipes it. `SqlArg.value` (turso-schema) is string-only even for ints (`String(v)`).

## Architecture pointers

- `src/app/` is flat, organized by feature. Pure domain logic lives in i18n-free modules/subdirs
  (e.g. `next-actions/`, serializers); React surfaces import them. Keep the engines i18n-free —
  the surface translates.
  Before creating `<name>.ts`, check for an existing `<name>.tsx` (and vice versa) — a bare
  `./<name>` import resolves `.ts` AHEAD of `.tsx`, so a new pure `foo.ts` silently hijacks an
  existing `foo.tsx` component import and breaks its tests. Name the pure module distinctly
  (e.g. `action-notifications.ts` beside the `notifications.tsx` component).
- Storage is a facade (`storage.ts`) over multiple backends: JSON file, CSV, Markdown, Turso
  (single + multi-tenant), IndexedDB. Snapshots/Trends and version history are Turso-ONLY.
- Sample data is tiered: `sample-workspace-small.*` is the curated source; `-big` (3×) and
  `-huge` (10×) JSON+SQLite are GENERATED via pure `scaleWorkspace(ws, factor)` (id-offset
  `k*100000` + full FK remap; reference data — resources/roles/disciplines/grades — is NOT
  replicated). Don't hand-edit `-big`/`-huge`; regenerate from `-small`.
- Action-Center CTAs are surface-only: thread an optional handler
  task-manager → workspace-section → ActionsPanel → ActionRow (ActionsPanel renders in
  workspace-section, not task-manager, and renders TWO ActionRow lists — tier + monitor — so a new
  CTA prop must be threaded to BOTH); the `next-actions/` engine stays pure.
- The shell renders the top bar in TWO independent places, both built in `task-manager.tsx`: the
  classic `AppHeader` (`appHeaderEl`, used by the classic main-window `legacyTree`) and the modern
  `ModernShell` `topBarMenus` slot (the DEFAULT layout). A new top-bar control must be wired into
  BOTH or it's invisible in whichever layout you forgot (the modern default is the easy miss). The
  popout `legacyTree` branch (`isPopout ? …`) renders NO header, so header controls correctly never
  appear in popouts.
- Heavy browser-only deps (rich-text editor, etc.) load via `next/dynamic({ ssr: false })` to
  stay off the main bundle; ProseMirror/Tiptap-style libs need `Range.getClientRects` +
  `getBoundingClientRect` jsdom stubs in their tests.
- M365 Graph is called client-side via `useMsAuth().acquireToken(scopes, { interactive })` —
  `interactive:true` pops an incremental-consent dialog for a new scope; background probes stay
  silent. A new Graph host must be added to the CSP allowlist (above).
- AI Assistant: `chat-panel.tsx` calls Anthropic directly (browser, `anthropic-dangerous-direct-
  browser-access`). `buildSystemPrompt` returns a `SystemBlock[]`, NOT a string. Anthropic prompt
  caching is PREFIX-based: stable/cacheable content (instructions + operating-guide text) MUST come
  FIRST with the `cache_control:{type:"ephemeral"}` breakpoint after it, and volatile data (today,
  task count, current view/mode) MUST come AFTER — mixing volatile data into the cached block (or
  putting the big guide block last) means the cache never hits. Operating guides live in a global
  store (`operating_guides`, out of TABLE_NAMES) surfaced by ONE `useOperatingGuides` instance in
  task-manager, threaded to both ChatPanel (chat) and AiSection (editor).
