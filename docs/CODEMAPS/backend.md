<!-- Generated: 2026-05-31 | Files scanned: src/proxy.ts + 10 (src/app/api/jira) | Token estimate: ~500 | Updated for 0.29.0–0.37.1: no backend changes; storage backends remain client-side -->

# Backend

No application backend in the traditional sense — no DB, no auth middleware,
no business logic on the server. Two thin server-side concerns only:

1. `src/proxy.ts` — Next.js 16 middleware that attaches a per-request CSP nonce.
2. `src/app/api/jira/*` — CORS proxy routes that forward to Atlassian Cloud.

## Middleware (`src/proxy.ts`)

Per-request `nonce-{uuid}` injected into `Content-Security-Policy: script-src
'self' 'nonce-X' 'strict-dynamic' [+'unsafe-eval' in dev]; style-src-elem
'self' 'nonce-X' [+'unsafe-inline' in dev]; style-src-attr 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'self'
https://api.anthropic.com; frame-src 'none'; frame-ancestors 'none';
object-src 'none'; base-uri 'self'; form-action 'self'`.

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

The browser chooses a storage backend via Settings → Integrations. All backends live in the client (next/dynamic, `ssr: false`). New in 0.21.0–0.25.0:

| Backend | File(s) | How |
|---------|---------|-----|
| Browser (IndexedDB) | `storage.ts` (BrowserBackend) | Default; record-level IDB writes |
| Local JSON/CSV/Markdown | `storage.ts` (LocalFileBackend) | File System Access API; round-trips via `migrateWorkspaceV5/V6` |
| **SharePoint JSON/CSV** (0.22.0) | `sharepoint-backend.ts` (SharePointBackend) | Stores workspace blob to SharePoint Sites library via `graph.microsoft.com /me/drive/items/...`; requires MSAL token (M365 toggle in Settings) |
| **Turso** (0.25.0) | `turso-backend.ts` (TursoBackend) | Stores workspace as single JSON blob via Turso HTTP `/v2/pipeline` API; no `@libsql/client` dep, raw fetch; configured in Settings → Integrations or `NEXT_PUBLIC_TURSO_*` env vars |

All backends implement the `StorageBackend` interface: `load(): Promise<Workspace>`, `save(workspace): Promise<void>`, `isReady(): Promise<boolean>`.

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
