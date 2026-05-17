# Runbook

Operational notes for deploying and supporting List of Open Points Tracker.
Architecture detail lives in [CODEMAPS/architecture.md](CODEMAPS/architecture.md);
this file covers what to do when the app needs to ship or starts misbehaving.

## What this app is, operationally

- **Pure client-side app** with thin Next.js route handlers for Jira CORS
  proxying. No database, no auth middleware, no session store, no background
  jobs.
- **All user data lives in the browser** (`IndexedDB` for tasks/RAID,
  `localStorage` for settings + credentials). Losing the server tier loses
  nothing about the users; losing the browser profile loses the user's data.
- **Outbound calls** from the server are only to `api.atlassian.com` from
  `/api/jira/*`, and only with credentials forwarded from the request body.
  The browser calls `api.anthropic.com` directly (no server proxy).

This shape means most "incidents" are either build failures, browser-side
errors visible only in DevTools, or Atlassian / Anthropic outages we cannot
fix server-side.

## Build & deploy

### Build

```bash
npm ci
npm run build
```

`next build` runs the TypeScript check and emits `.next/`. The build artifact
is portable — any Node 20+ host with `npm start` will serve it.

### Hosting options

Any of these works:

| Host | Notes |
|---|---|
| **Vercel** | Zero-config — push the repo. `.vercel` is in `.gitignore`. |
| **Node 20+ + `npm start`** | Self-host. `next.config.ts` sets the security headers; no reverse-proxy header injection needed. |
| **Static export** | Not supported — `/api/jira/*` route handlers require the Node runtime. |

### Security headers
Static headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`) live in `next.config.ts`. The **Content-Security-Policy**
lives in `src/proxy.ts` because it carries a per-request nonce — Next.js 16
extracts that nonce from the request header and attaches it to framework
scripts and SSR `<style>` blocks. Production CSP is nonce-strict for
`script-src` and `style-src-elem` (no `'unsafe-inline'`); `style-src-attr`
keeps `'unsafe-inline'` because React renders `style={{...}}` props as the
`style` HTML attribute (Gantt/table use dynamic px math). The app never
renders untrusted HTML — no `dangerouslySetInnerHTML` anywhere — so the
attribute allowance is low-risk. `connect-src` allows
`https://api.anthropic.com`. **If you add a new outbound origin** (e.g. a
different LLM, a logging endpoint), update `connect-src` in `src/proxy.ts`
or the browser will block the call silently except for a DevTools console
message.

Because `src/proxy.ts` sets the per-request nonce, all pages must render
dynamically. `src/app/page.tsx` calls `await connection()` to opt in; new
routes must do the same or the served HTML will carry a build-time nonce
that no longer matches the per-request CSP header.

### Smoke test after deploy

1. Load `/` — header, footer, an empty task list, and the workspace pane
   should render. No JS console errors.
2. Open Settings → Storage. The page should not 500.
3. Add a task; refresh; confirm it persists.
4. Open the Version popover (info icon in header). `APP_VERSION` and
   `APP_BUILD_DATE` should match the build you just shipped.
5. If Jira is in use: open Settings → Jira, enter test creds, hit Test —
   the route handler at `/api/jira/test` should respond.

There is no `/healthz` endpoint. The home page rendering successfully is the
health check.

## Rollback

Because the server tier is stateless and user data lives in the browser:

1. `git checkout <previous-tag>`
2. `npm ci && npm run build`
3. Redeploy.

Users keep their data — there is no DB migration to reverse. The only
client-side gotcha is the **storage migration** in `storage.ts` (legacy
`localStorage` → `IndexedDB`). Rolling back across that migration boundary
on a browser that has already migrated means the older code reads from
`localStorage` and sees an empty list. Mitigation: don't roll back across
the migration boundary in environments with real user data. If you have to,
warn users to re-import from an export.

## Secrets

The repo contains **no production secrets**. Two credential paths:

| Credential | Stored | Sent to | Rotation path |
|---|---|---|---|
| Anthropic API key | Browser `localStorage` (per-user) | `api.anthropic.com` (direct from browser) | User edits Settings → AI |
| Jira site URL + email + API token | Browser `localStorage` (per-user) | Forwarded to Atlassian via `/api/jira/*` route handlers; **never persisted server-side** | User edits Settings → Jira |

If a deployment-host compromise is suspected, **no server-side secret needs
rotation** because the server holds none. Users may want to rotate their own
Atlassian tokens and Anthropic keys defensively.

## Common issues

### "Jira sync fails with 401"
Cause: stale or revoked Atlassian API token, or the user changed Atlassian
password. Atlassian Cloud API tokens are not affected by password rotation,
but **basic-auth-with-password** is. Tell the user to issue a fresh API token
at <https://id.atlassian.com/manage-profile/security/api-tokens> and paste it
into Settings → Jira.

### "Jira sync fails with 403 / project not in list"
Cause: assignee scope or project permissions in Atlassian. Verify the user's
account has Browse Projects + Edit Issues on the target project. The route
handler returns Atlassian's error verbatim — check the browser Network tab
for the JSON body.

### "Jira sync hangs / slow"
The route handlers carry per-IP and per-credentials rate limits
(`src/app/api/jira/_rate-limit.ts`, token-bucket). On restart, buckets reset.
If a single user is hammering Sync, they will see 429 responses bubble up as
a generic sync error. There is no monitoring of this — only the user
reporting it.

### "Claude chat returns 401 / 403"
The Anthropic key in `localStorage` is invalid, expired, revoked, or
rate-limited. Users must regenerate at
<https://console.anthropic.com/settings/keys>. The server does not see this
traffic, so server-side logs will be silent.

### "Local file storage doesn't work in Firefox / Safari"
The File System Access API is Chromium-only. Users on Firefox or Safari
should keep the default IndexedDB backend; SharePoint backends are listed as
"coming soon" in the UI but not implemented.

### "Tasks disappeared on the user's machine"
Most likely causes, in order:
1. Browser cleared site data (privacy mode, history clear, "remove data when
   I close the browser" setting).
2. User switched browser profiles or browsers.
3. User cleared site data for a different reason.
4. IndexedDB quota eviction — rare; only when total origin storage exceeds
   the per-origin quota AND the browser decided this origin was inactive.

We can't recover the data — there is no server-side copy. Suggest users
periodically export to CSV / JSON / Markdown via the Export menu.

### "Build fails with type errors after dependency bump"
Next 16 + React 19 have moved fast. Pin the patch version and check
`node_modules/next/dist/docs/` for changes before re-bumping. The root
`AGENTS.md` exists specifically to flag this risk.

### "CSP blocks a new feature"
Symptoms: a specific resource fails in DevTools Console with `Refused to
connect to ...` or `Refused to load the script ...`. Fix: edit
`src/proxy.ts` → `buildCsp()` → add the origin to the correct directive.
Redeploy. Note the production CSP is nonce-strict for scripts and `<style>`
blocks — third-party inline scripts/styles will need the nonce attached
(read `headers().get('x-nonce')` and pass it to `<Script nonce={...}>`).

## Monitoring & alerting

There is **none, currently**.

- No APM / RUM (no Sentry, Datadog, etc).
- No structured logging — server-side errors land in the host's stdout
  (Vercel function logs / pm2 / systemd, depending on host).
- No uptime check configured in-repo.

If alerting is required, a minimal sensible setup is:
- A synthetic check that GETs `/` and asserts a 200 + a known string from the
  rendered HTML.
- A second synthetic that POSTs a known-invalid body to `/api/jira/test` and
  asserts the route responds (not 5xx).
- Server-side error tracking (Sentry) wired into the Jira route handlers.

None of this is wired in yet — flagging it explicitly so the next reader
knows it's a gap, not an oversight.

## Escalation

This is a single-team internal tool with no on-call rotation. Report issues
via the Acme internal channel. For data-loss reports specifically:
remind the user that data is browser-local and not server-recoverable, then
walk them through the Export menu so future incidents are recoverable.
