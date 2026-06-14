<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Commands

```bash
npm run dev                 # next dev (forked Next.js)
npm run build               # next build (prebuild checks script-docs are in sync)
npm run lint                # eslint  (CI runs with --max-warnings=0)
npx tsc --noEmit            # typecheck (enforces i18n EN/DE key parity)
npm run test:run            # vitest (unit/integration)
npm run e2e                 # playwright (incl. the 12-view axe a11y gate)
```

## Hard constraints (CI-enforced — these gate merges)

- **i18n:** `i18n.ts` (EN) + `i18n.de.ts` (DE) key sets must be identical (tsc enforces).
  DE must use real German umlauts — the `i18n-encoding` test BANS ASCII subs (fuer/druecken).
  The Edit tool corrupts umlauts AND curls double-quotes in `i18n.de.ts` (bites umlaut-free
  strings too); patch it via a node utf8 write and re-verify.
- **Byte-stable serializers:** `golden-workspace.test` pins the exact CSV/Markdown storage bytes.
  A failure usually means a real format change — only regenerate the `__fixtures__` when the
  *input* (`sample-workspace.json`) legitimately changed, never to mask a format diff.
- **Palette:** only the sanctioned AIPM brand tokens (`globals.css`); no off-palette colors,
  gradients, or shadows. The a11y gate + palette-sweep test enforce contrast/token use.
- **CI is GitLab** (not GitHub),  (GitLab). Pipeline: install → lint → typecheck → unit → build → e2e.
- **Releasing:** bump `src/app/version.ts` (APP_VERSION + milestone), add a `CHANGELOG.md` entry,
  and append any new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` (+ EN/DE strings).
- **New persisted `Workspace` field → SIX write paths** (JSON/CSV/MD/Turso-single/Turso-tenant/
  IndexedDB). Miss one and data silently drops on that backend.
- **Turso-gated features** (Snapshots/Trends, version history) must check `tursoConfig !== null`,
  not just `storageConfig.kind === "turso"` (kind can be set while the config is unset/quarantined).

## Architecture pointers

- `src/app/` is flat, organized by feature. Pure domain logic lives in i18n-free modules/subdirs
  (e.g. `next-actions/`, serializers); React surfaces import them. Keep the engines i18n-free —
  the surface translates.
- Storage is a facade (`storage.ts`) over multiple backends: JSON file, CSV, Markdown, Turso
  (single + multi-tenant), IndexedDB. Snapshots/Trends and version history are Turso-ONLY.
