<!-- Generated: 2026-06-11 | Files scanned: src/proxy.ts + 10 (src/app/api/jira) + client storage backends | Token estimate: ~600 | Updated for 0.29.0–0.60.0: still no server-side app backend; client-side Turso multi-tenant backend + portfolio-mode (0.58.0–0.59.0); SharePoint Graph pure core + picker scope (0.60.0 "Stephenson"); data version history (`version-store.ts` + `version-schema.ts`: append-only `project_versions` over the same `/v2/pipeline` transport, pruned by retention, Turso-only) [0.66.0–0.69.0] -->

# Backend

No application backend in the traditional sense — no DB, no auth middleware,
no business logic on the server. Two thin server-side concerns only:

1. `src/proxy.ts` — Next.js 16 middleware that attaches a per-request CSP nonce.
2. `src/app/api/jira/*` — CORS proxy routes that forward to Atlassian Cloud.

## Middleware (`src/proxy.ts`)

Per-request `nonce-{uuid}` injected into `Content-Security-Policy: default-src
'self'; script-src 'self' 'nonce-X' 'strict-dynamic' [+'unsafe-eval' in dev];
style-src-elem 'self' 'nonce-X' [dev: 'self' 'unsafe-inline', nonce omitted];
style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self';
connect-src 'self' https://api.anthropic.com https://*.turso.io
https://graph.microsoft.com https://login.microsoftonline.com
http://localhost:* http://127.0.0.1:*; frame-src
https://login.microsoftonline.com; frame-ancestors 'none'; object-src 'none';
base-uri 'self'; form-action 'self'`.

`connect-src` allowlists every host the browser calls directly: Anthropic (chat
panel), `*.turso.io` (Turso storage + snapshot pipeline), `graph.microsoft.com`
(SharePoint backend + Outlook calendar/contacts), `login.microsoftonline.com`
(MSAL PKCE token exchange), and loopback (self-hosted tursodb over plaintext
http). `frame-src` permits `login.microsoftonline.com` for MSAL
`acquireTokenSilent`'s hidden renewal iframe (sign-in/out use popups, which
are not governed by frame-src). Jira still goes through `/api/jira/*` (self).

Nonce is forwarded as `x-nonce` request header so Next reuses it for SSR
script + style attribution. `style-src-attr 'unsafe-inline'` stays because
React renders `style={{...}}` props as HTML attributes (Gantt/table dynamic
px math) — the app renders no untrusted HTML (`dangerouslySetInnerHTML` is
not used anywhere).

Matcher skips `/api/*`, `/_next/static`, `/_next/image`, favicon, and router
prefetches (no HTML, no need for CSP).

## Jira routes

All POST. Credentials (`siteUrl`, `email`, `apiToken`) arrive in the request
body, are forwarded to Atlassian via Basic auth, and discarded after the
response.

| Route | Purpose |
|---|---|
| `POST /api/jira/test` | Verify credentials (`GET /rest/api/3/myself`) |
| `POST /api/jira/projects` | List accessible projects |
| `POST /api/jira/issue-types` | List issue types for a project |
| `POST /api/jira/users` | Search assignable users (`/rest/api/3/user/search`) |
| `POST /api/jira/search` | JQL query (paginated) for sync pulls |
| `POST /api/jira/create-issue` | Create a new Jira issue from a local task |
| `POST /api/jira/update-issue` | Push local task edits back to Jira |
| `POST /api/jira/transition-issue` | Change workflow status (e.g. Done) |

## Shared helpers (not routes)

- `src/app/api/jira/_helpers.ts` — credential validation, Basic-auth header builder, common error translation, and `parseJiraRequest(request)`: the shared route entry point that runs the rate-limit check, parses the JSON body, and extracts credentials, returning either a ready-to-send error `Response` or `{ creds, body }`. Every route calls it instead of repeating that boilerplate. Outbound site URLs are normalised by `normalizeSiteUrl`: **HTTPS only** — plaintext `http://` is rejected so Basic credentials are never sent in the clear — and `isPrivateHost` rejects loopback / RFC-1918 / link-local plus IPv6 unique-local (`fc00::/7`), IPv6 link-local (`fe80::/10`), and IPv4-mapped (`::ffff:`) addresses (SSRF guard). ADF (Atlassian Document Format) ↔ plain-text conversion now lives in `src/app/adf.ts` (shared with client-side import/export paths).
- `src/app/api/jira/_rate-limit.ts` — per-IP / per-credentials rate-limit using an in-memory token bucket. Resets on server restart (acceptable for current scale).

## Per-route flow

```
request → parseJiraRequest (rate-limit check → parse JSON body → validate creds)
       → callJira (normalize + SSRF-check site URL → fetch atlassian REST)
       → translate errors → response JSON
```

Each `route.ts` runs independently — no shared middleware chain at the
project root other than `src/proxy.ts`, and that middleware excludes
`/api/*` via its matcher.

## Dependencies

- Native `fetch` for outbound calls (no axios / got).
- No `cookie-parser`, no session store, no database client.
- Pure-Node only; runs equally on Node 20+ or edge runtimes.

## Storage backends (client-side)

The browser chooses a storage backend via Settings → Integrations. All backends live in the client (next/dynamic, `ssr: false`). New in 0.21.0–0.25.0, extended with multi-tenant Turso in 0.59.0:

| Backend | File(s) | How |
|---------|---------|-----|
| Browser (IndexedDB) | `storage.ts` (BrowserBackend) | Default; record-level IDB writes |
| Local JSON/CSV/Markdown | `storage.ts` (LocalFileBackend) | File System Access API; round-trips via `migrateWorkspaceV5/V6` |
| **SharePoint JSON/CSV** (0.22.0) | `sharepoint-backend.ts` (SharePointBackend) | Stores workspace blob to SharePoint Sites library via `graph.microsoft.com /me/drive/items/...`; requires MSAL token (M365 toggle in Settings) |
| **Turso (single-project)** (0.25.0) | `turso-backend.ts` (TursoBackend) | Stores one workspace as relational rows via Turso HTTP `/v2/pipeline` API; no `@libsql/client` dep, raw fetch; configured in Settings → Integrations or `NEXT_PUBLIC_TURSO_*` env vars |
| **Turso multi-tenant** (0.59.0) | `turso-backend.ts` (`TursoBackend(config, projectId)` — tenant mode) | Stores MANY projects in ONE shared Turso DB: every entity table carries a `project_id` column, a `projects` table is the project list. Same `/v2/pipeline` transport as single-tenant mode; `load`/`save` read/write only the `WHERE project_id = ?` slice. Used in portfolio "turso" mode |

Both Turso modes live in ONE class: `createBackend` (storage.ts) passes `projectId` only when `kind === "turso"` AND a non-empty `tursoProjectId` dep is supplied; without it `TursoBackend` runs in single-tenant mode.

All backends implement the `StorageBackend` interface (`load(): Promise<Workspace>`, `save(workspace): Promise<void>`, `isReady(): Promise<boolean>`): BrowserBackend, LocalFileBackend, SharePointBackend, and TursoBackend.

### Version history (Turso-only, 0.66.0+)

- `version-schema.ts` — DDL + SQL builders for the append-only `project_versions` table (full workspace JSON payload per version). Kept out of the workspace `TABLE_NAMES` (like the snapshot tables), so a workspace save's clear-all never wipes it.
- `version-store.ts` — async CRUD (list / get / insert / prune) over the same Turso `/v2/pipeline` transport as the main backend; prunes auto-versions to `Settings.versionHistoryRetention`, leaving named checkpoints. Only active in Turso mode with the History feature module enabled.

### Portfolio mode (multi-project, client-side, 0.58.0–0.59.0)

- `portfolio-mode.ts` — global `"file" | "turso"` storage-mode switch (localStorage) plus the last-selected Turso project id. File mode uses the Phase 1 localStorage registry; Turso mode treats the shared DB's `projects` table as the source of truth.
- `turso-portfolio.ts` — project-list CRUD over the shared pipeline: list / list-archived / create / update-meta / archive / restore / hard-delete. Every call prepends `tenantSchemaDdl()` (CREATE IF NOT EXISTS) so a fresh DB self-initializes.
- `turso-tenant-schema.ts` — project-scoped DDL + statement builders, reusing the single-tenant column registries. Workspace tables gain a `project_id` column with a composite `PRIMARY KEY (id, project_id)`; a separate `projects` table holds one `ProjectMeta` row per project. Carries its own `SCHEMA_VERSION` ("10"), distinct from single-tenant turso-schema ("9").

## Configuration resolution (client-side, 0.21.0+)

`msal-config.ts` — resolves Microsoft Entra credentials from `NEXT_PUBLIC_MSAL_CLIENT_ID` / `NEXT_PUBLIC_MSAL_TENANT_ID` env vars or Settings → Integrations inputs (fallback order: env → Settings → undefined).

`turso-config.ts` — resolves Turso database URL + auth token from `NEXT_PUBLIC_TURSO_DATABASE_URL` / `NEXT_PUBLIC_TURSO_AUTH_TOKEN` env vars or Settings → Integrations inputs.

Both are client-side only; no server-side validation.

## What this layer does *not* do

- Does not store any user data.
- Does not authenticate end users (the browser is the trust boundary).
- Does not transform Jira responses beyond JSON parsing + ADF conversion.
- Does not handle WebSocket / SSE traffic.
- Does not proxy Microsoft Graph or Turso calls — browser makes them directly with MSAL tokens / Turso auth tokens.

## SharePoint Graph pure core (0.60.0+)

`sharepoint-graph.ts` — pure client-side Graph helper (no Next.js server involvement):

- Site search (`/sites?search=`) and drive/item enumeration (`/drives`, `/items/{id}/children`) for the picker browser.
- `parseSharePointSiteUrl(url)` — sibling utility that extracts the SharePoint site hostname + site path from a pasted storage URL, used by both the storage-config "Browse…" button and the picker modal.

**Scopes used by the SharePoint integration (0.60.0+):**

| Scope | Purpose |
|-------|---------|
| `Files.ReadWrite.All` | Storage backend: read and write the workspace JSON/CSV blob in a document library |
| `Sites.Read.All` | Picker: search SharePoint sites via `/sites?search=` |

The picker scope (`Sites.Read.All`) is requested incrementally only when the user opens the picker; the storage backend continues to work with `Files.ReadWrite.All` alone.
