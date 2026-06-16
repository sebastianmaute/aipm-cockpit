<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Commands

```bash
npm run dev                 # next dev (forked Next.js)
npm run build               # next build (prebuild checks script-docs are in sync)
npm run lint                # eslint  (CI --max-warnings=0: an unused import/var or `_`-prefixed
                            # param is FATAL — no argsIgnorePattern; re-check after every extract)
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
- **Byte-stable serializers:** `golden-workspace.test` pins the exact CSV/Markdown storage bytes.
  A failure usually means a real format change — only regenerate the `__fixtures__` when the
  *input* (`sample-workspace.json`) legitimately changed, never to mask a format diff.
- **Palette:** only the sanctioned AIPM brand tokens (`globals.css`); no off-palette colors,
  gradients, or shadows. The a11y gate + palette-sweep test enforce contrast/token use.
  Note: palette-sweep scans CSS for `box-shadow` — an off-palette Tailwind class (e.g. `shadow-md`)
  on an element PASSES CI but is still forbidden; check new components by eye.
- **a11y (axe gate):** every new interactive control (button/checkbox/input/drag handle) needs an
  accessible name and keyboard operability — an unlabeled form control is an axe-critical FAIL.
- **CI is GitLab** (not GitHub),  (GitLab). Pipeline: install → lint → typecheck → unit → build → e2e.
- **Releasing:** bump `src/app/version.ts` (APP_VERSION + milestone), add a `CHANGELOG.md` entry,
  and append any new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` (+ EN/DE strings).
- **New persisted `Workspace` field → SIX write paths** (JSON/CSV/MD/Turso-single/Turso-tenant/
  IndexedDB). Miss one and data silently drops on that backend.
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
- Storage is a facade (`storage.ts`) over multiple backends: JSON file, CSV, Markdown, Turso
  (single + multi-tenant), IndexedDB. Snapshots/Trends and version history are Turso-ONLY.
- Action-Center CTAs are surface-only: thread an optional handler
  task-manager → workspace-section → ActionsPanel → ActionRow (ActionsPanel renders in
  workspace-section, not task-manager); the `next-actions/` engine stays pure.
- Heavy browser-only deps (rich-text editor, etc.) load via `next/dynamic({ ssr: false })` to
  stay off the main bundle; ProseMirror/Tiptap-style libs need `Range.getClientRects` +
  `getBoundingClientRect` jsdom stubs in their tests.
- M365 Graph is called client-side via `useMsAuth().acquireToken(scopes, { interactive })` —
  `interactive:true` pops an incremental-consent dialog for a new scope; background probes stay
  silent. A new Graph host must be added to the CSP allowlist (above).
