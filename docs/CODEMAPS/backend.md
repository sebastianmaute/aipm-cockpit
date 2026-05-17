<!-- Generated: 2026-05-15 | Files scanned: 10 (src/app/api/jira) | Token estimate: ~400 -->

# Backend

No application backend in the traditional sense — no DB, no auth middleware,
no business logic on the server. Only thin CORS proxy routes that the browser
calls because Atlassian Cloud refuses cross-origin requests from arbitrary
origins.

## Routes

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

- `src/app/api/jira/_helpers.ts` — credential validation, Basic-auth header builder, ADF (Atlassian Document Format) ↔ plain-text conversion.
- `src/app/api/jira/_rate-limit.ts` — per-IP / per-credentials rate-limit using an in-memory token bucket. Resets on server restart (acceptable for current scale).

## Middleware chain

Next.js App Router handles each `route.ts` independently. No `middleware.ts`
at the project root. Per-route flow:

```
request → parse JSON body → validate creds → rate-limit check
       → fetch atlassian REST → translate errors → response JSON
```

## Dependencies

- Native `fetch` for outbound calls (no axios / got).
- No `cookie-parser`, no session store, no database client.
- Pure-Node only; runs equally on Node 20+ or edge runtimes.

## What this layer does *not* do

- Does not store any user data.
- Does not authenticate end users (the browser is the trust boundary).
- Does not transform Jira responses beyond JSON parsing.
- Does not handle WebSocket / SSE traffic.
