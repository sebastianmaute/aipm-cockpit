<!-- Generated: 2026-05-17 | Files scanned: src/proxy.ts + 10 (src/app/api/jira) | Token estimate: ~500 -->

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

- `src/app/api/jira/_helpers.ts` — credential validation, Basic-auth header builder, common error translation. ADF (Atlassian Document Format) ↔ plain-text conversion now lives in `src/app/adf.ts` (shared with client-side import/export paths).
- `src/app/api/jira/_rate-limit.ts` — per-IP / per-credentials rate-limit using an in-memory token bucket. Resets on server restart (acceptable for current scale).

## Per-route flow

```
request → parse JSON body → validate creds → rate-limit check
       → fetch atlassian REST → translate errors → response JSON
```

Each `route.ts` runs independently — no shared middleware chain at the
project root other than `src/proxy.ts`, and that middleware excludes
`/api/*` via its matcher.

## Dependencies

- Native `fetch` for outbound calls (no axios / got).
- No `cookie-parser`, no session store, no database client.
- Pure-Node only; runs equally on Node 20+ or edge runtimes.

## What this layer does *not* do

- Does not store any user data.
- Does not authenticate end users (the browser is the trust boundary).
- Does not transform Jira responses beyond JSON parsing + ADF conversion.
- Does not handle WebSocket / SSE traffic.
- Does not yet talk to SharePoint — the `sp-json`/`sp-csv` storage backends are stub classes that throw `StorageNotImplementedError("sharepoint-coming-soon")`.
