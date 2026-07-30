# Runbook

Operational notes for deploying and supporting AI PM Cockpit.
Architecture detail lives in [CODEMAPS/architecture.md](CODEMAPS/architecture.md);
this file covers what to do when the app needs to ship or starts misbehaving.

## What this app is, operationally

- **Pure client-side app** with thin Next.js route handlers for Jira and
  Confluence CORS proxying. No database, no auth middleware, no session store,
  and no _server_ background jobs. "Scheduled jobs" (recurring Claude analyses,
  0.105.0+) run entirely in the browser while the app is open — there is no
  server cron; missed runs catch up on next open. They are opt-in and off by
  default (see "Disable / reset scheduled jobs" below).
- **All user data lives in the browser** (`IndexedDB` for tasks/RAID,
  `localStorage` for settings + credentials). Losing the server tier loses
  nothing about the users; losing the browser profile loses the user's data.
- **Outbound calls** from the server are only to `api.atlassian.com` from
  `/api/jira/*` and `/api/confluence/page` (both Atlassian — the Confluence
  route reuses the Jira proxy helpers, the same SSRF allowlist, and the
  user-supplied Atlassian credentials; no new outbound host) and to the user's
  `*.timelog.com` host from `/api/timelog` (the Timelog time-booking proxy —
  its own SSRF allowlist, private-IP block, `/v1/` path allowlist, Bearer auth,
  and per-IP rate limit; reads are forwarded with the user-supplied token from
  the request). All go out only with credentials forwarded from the request
  body. The browser calls `api.anthropic.com` (Claude), `api.turso.io` (Turso),
  `graph.microsoft.com` (M365 Graph), and `login.microsoftonline.com` (MSAL)
  directly (no server proxy).

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

### Stopping the dev server

```bash
npm run stop
```

`npm run stop` stops the dev server bound to the app port (default 3000; set
`PORT` to override, e.g. `PORT=4000 npm run stop`). It is **port-scoped** — it
frees only the process listening on that port and does not kill unrelated Node
processes. Use it to reclaim a stuck port before restarting `npm run dev`.

### Pre-deploy testing (recommended)

Since v0.7.1 the repo carries a test suite. Recommended pre-ship sequence:

```bash
npm run lint
npm run test:run          # Vitest unit/component, single run
npm run e2e:install       # one-time per host; downloads Chromium
npm run e2e               # Playwright headless against a fresh dev server
```

Notes:

- `npm run test:coverage` enforces the v8 coverage floors set in
  `vitest.config.ts` (global lines 92 / funcs 91 / branch 80 / stmts 89, plus
  per-engine globs) and will exit non-zero if any floor slips. These are the
  same floors CI's blocking unit gate applies — treat a drop as a real
  regression to fix, not a threshold to lower.
- `npm run e2e` boots `npm run dev` on port 3000. If you already have a dev
  server running there, Playwright reuses it (outside CI). In CI it always
  spawns its own.
- Tests run independently of `next build`. None of them feed into the
  bundler; failures don't pollute `.next/`.

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
attribute allowance is low-risk. `connect-src` allows the browser-called
origins (`api.anthropic.com`, `api.turso.io`, `graph.microsoft.com`,
`login.microsoftonline.com`); `worker-src 'self'` is set for the installable
PWA's service worker (0.106.0+). The recent feature batch (timezones, guided
tour, steering committee, Kanban, scheduled jobs, Confluence import) added
**no new outbound host**: committee Outlook push uses the already-allowlisted
Graph host, scheduled jobs use the already-allowlisted Anthropic host, and the
Confluence proxy is same-origin (browser → `/api/confluence/page`, which then
calls the already-allowlisted Atlassian host server-side). **If you add a new
outbound origin** (e.g. a different LLM, a logging endpoint), update
`connect-src` in `src/proxy.ts` or the browser will block the call silently
except for a DevTools console message.

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
   `APP_BUILD_DATE` should match the build you just shipped — compare against
   `src/app/version.ts` and the top entry of `CHANGELOG.md` rather than a version
   named here, which only goes stale.
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

The repo contains **no production secrets**. Multiple credential paths, all browser-local:

| Credential | Stored | Sent to | Rotation path |
|---|---|---|---|
| Anthropic API key | Browser `localStorage` (per-user) | `api.anthropic.com` (direct from browser) | User edits Settings → AI |
| Jira site URL + email + API token | Browser `localStorage` (per-user) | Forwarded to Atlassian via `/api/jira/*` route handlers; **never persisted server-side** | User edits Settings → Jira |
| **Microsoft Entra (M365)** Client ID + Tenant ID | Browser `localStorage` or `NEXT_PUBLIC_*` env vars | `login.microsoftonline.com` via MSAL (browser) for OAuth consent; issued token sent to `graph.microsoft.com` | Stored in Settings → Integrations or env vars; token is short-lived (refresh token managed by MSAL) |
| **Turso** Database URL + Auth Token | Browser `localStorage` or `NEXT_PUBLIC_*` env vars | `api.turso.io` (direct from browser) | Stored in Settings → Integrations or env vars; **recommend scoped token with minimal permissions** |

**Important:** The `NEXT_PUBLIC_*` env vars are **build-time public** — they are inlined into the JavaScript bundle and visible in the browser. Use them only for non-secret client-side config (e.g., Entra Client ID). The Turso auth token should **not** be exposed as a build-time env var in public deployments — use Settings inputs instead, or a scoped token if env var is unavoidable.

The recent feature batch (timezones, guided tour, steering committee, Kanban,
scheduled jobs, Confluence import) introduced **no new credential**: Confluence
reuses the existing Atlassian (Jira) token, scheduled jobs reuse the Anthropic
key, and committee Outlook push reuses the M365 Graph token. The Anthropic key
and Turso auth token remain encrypted at rest (see `secrets.ts` —
AES-256-GCM, non-extractable device key by default, optional per-secret
passphrase).

If a deployment-host compromise is suspected, **no server-side secret needs
rotation** because the server holds none. Users may want to rotate their own
Atlassian tokens and Anthropic keys defensively.

## Setup & Integration Configuration

Integration config (storage backend, AI, Jira, Timelog, M365) can be done via the **guided setup wizard** (Settings → Integrations → "Run setup wizard", or from the new-project window) or directly through the flat Integrations panel. The wizard steps through each area in order; all integration steps are skippable.

### Environment variables (build-time, optional)

Set these at build time to pre-configure integrations (all can be overridden in-app via Settings → Integrations):

```bash
# Microsoft Entra (for M365 features)
NEXT_PUBLIC_MSAL_CLIENT_ID=<your-app-client-id>
NEXT_PUBLIC_MSAL_TENANT_ID=<your-tenant-id>

# Turso (libSQL database backend)
NEXT_PUBLIC_TURSO_DATABASE_URL=<libsql://...>
NEXT_PUBLIC_TURSO_AUTH_TOKEN=<your-scoped-token>
```

**Note:** `NEXT_PUBLIC_*` variables are embedded in the bundle. Use them only for public config like Entra Client ID. For Turso, prefer the in-app Settings inputs over env vars.

### Microsoft 365 integration setup

To enable Outlook contacts/calendar import and SharePoint storage:

1. Register an app in [Microsoft Entra admin center](https://entra.microsoft.com/).
2. Create a Single-Page Application (SPA) with:
   - Redirect URI: `http://localhost:3000` (dev) or your production URL
   - API permissions: `Contacts.Read`, `Calendars.Read`, `Sites.ReadWrite.All`
3. Copy **Client ID** and **Tenant ID** into Settings → Integrations, or set env vars above.
4. The app authenticates via MSAL in the browser using PKCE (no backend token exchange).

### Turso integration setup

To enable Turso as a storage backend:

1. Create a database at [Turso console](https://console.turso.io/).
2. Generate an **auth token** with minimal permissions (scoped to the database if possible).
3. Enter the **Database URL** and **Auth token** in Settings → Integrations, or set env vars above.
4. The app calls Turso's HTTP `/v2/pipeline` API directly from the browser.

## Common issues

### "Jira sync fails with 401"
Cause: stale or revoked Atlassian API token, or the user changed Atlassian
password. Atlassian Cloud API tokens are not affected by password rotation,
but **basic-auth-with-password** is. Tell the user to issue a fresh API token
at <https://id.atlassian.com/manage-profile/security/api-tokens> and paste it
into Settings → Jira.

### "Jira sync fails with 403 / project not in list"
Cause: assignee scope or project permissions in Atlassian. Sync now covers the primary project plus any extra projects configured in Settings → Integrations → Jira. Verify the user's account has Browse Projects + Edit Issues on all configured projects. The route handler returns Atlassian's error verbatim — check the browser Network tab for the JSON body.

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

### "Outlook import fails with 401 / permission error"
Cause: M365 toggle is OFF, invalid M365 credentials, or insufficient Graph scopes. 
Fix: Open Settings → Integrations, enable the M365 master toggle, enter valid Entra Client ID / Tenant ID, and ensure the Entra app has `Contacts.Read` and `Calendars.Read` scopes granted.

### "Calendar write-back not syncing / re-consent"
Cause: The write-back toggle is OFF, no push has been triggered, or `Calendars.ReadWrite` consent was denied.
Fix: Enable it in Settings → Integrations → Microsoft 365 → "Push milestones to my Outlook calendar", then click "Push to Outlook" on the Milestones view. If access was denied, re-grant the `Calendars.ReadWrite` scope (the consent dialog re-appears on the next push). Events are tagged `AIPM:<projectId>` — a re-push reconciles existing events and removes orphans.

### "SharePoint storage shows 'not ready' or 'coming soon'"
Cause: M365 toggle is OFF or integration is not set up.
Fix: Same as Outlook import — enable M365 in Settings → Integrations and configure Entra app credentials.

### "Turso storage fails to connect"
Cause: Database URL is malformed, auth token is invalid, or scoped to a different database.
Fix: Verify the Database URL and Auth token in Settings → Integrations. Test the credentials in Turso console. Ensure the token has read/write permission on the target database.

**Use the URL exactly as `turso db show <db>` prints it.** A region-qualified
host (`<db>-<org>.aws-eu-west-1.turso.io`) is valid and officially issued — do
**not** strip the region segment. Up to 0.193.x, Settings showed a warning
advising exactly that; the advice was wrong and the warning was removed in
0.194.0. If a support note or runbook copy still says otherwise, disregard it.

### "Timelog sync is slow / hangs on a large fetch"
All Timelog reads go through the same-origin `/api/timelog` proxy
(SSRF-guarded; per-IP rate limit of 60 requests/min on its own `"timelog"`
bucket). Fetches now page through **all** results (500/page), so loading a lot
of history — especially with **Include closed projects** ticked — pulls many
pages and can be slow, but it is **paced**: when the proxy returns a 429 the
app transparently retries honouring `Retry-After` with exponential backoff, so
a slow fetch is the rate limit working, not a fault. The loading modal has a
**Cancel** button that aborts the in-flight fetch; "Clear all" resets fetched
data and the per-device cache. To keep request volume down, the flow is
two-step: "Load people" pulls the directory only, then "Fetch bookings" pulls
timesheets for just the ticked employees.

### "Timelog booked hours show 0"
A resource's hours count as booked only when **both** links exist: the
booking's Timelog user must be linked to a resource in the app, **and** the
booking's Timelog project must be linked to a budget bucket. If either link is
missing the hours are attributed as unmapped/unattributed rather than landing
on a resource — check the attribution banner and the user/project link tables
in Settings → Integrations → Timelog. (Non-project absence time is never mapped
to a project.)

### "Timelog 'Load my projects' comes back empty"
"Load my projects" only returns Timelog projects where the signed-in token
owner is the **Project Manager** — that is intentional, so a PM can link those
projects to budgets before any bookings exist. If you are not the PM on the
projects you expect, use the **customer picker** to load a specific client's
projects, or tick **Include closed projects** to also pull finished/closed ones.

### "AI features look disabled / missing"
AI is gated behind a master switch (0.144.0+) that is **off by default**, even
for existing users. If chat, action suggestions, scheduled jobs, weight
suggestions, or AI project proposal don't appear, open Settings → AI assistant
and tick **"Enable AI assistant"** — the rest of the AI configuration UI stays
collapsed until it is enabled (a valid Anthropic key is still required on top of
the switch).

### "Local file storage doesn't work in Firefox / Safari"
The File System Access API is Chromium-only. Users on Firefox or Safari
should use the default IndexedDB backend, Turso (if configured), or export/import manually.

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

### "Disable / reset Action Center learning"
The Action Center learning layer (0.95.0+) is **opt-in and off by default**. To
turn it off or wipe what it has learned: Settings → Next actions → toggle
learning off, or use **"Reset learned data"** in the same section. A manual reset
is also possible: for the **local store**, clear the `aipm-cockpit:action-learning`
localStorage key; for the **Turso store**, run `DELETE FROM action_learning`
(a global, cross-project table kept out of the workspace save cycle). Learning
**never blocks boot** — a load failure is swallowed and the engine falls back to
the intrinsic ranking — and it is **ignored in safe-mode** (`?safe=1`), so it can
never wedge startup.

### "Disable / reset scheduled jobs"
Scheduled jobs (0.105.0+) are **opt-in and off by default** — each run is a
billed Anthropic call. They are gated on a configured Anthropic key **and** the
`ai.scheduledJobs` toggle. To turn them off: Settings → "Scheduled jobs" → flip
the master toggle off (or remove the Anthropic key). Jobs run only while the app
is open (on load, on tab re-focus, and on a light interval), catch up missed
runs on next open, are **advisory only** (they never write to the workspace),
and **never run in popouts**. State persists in a global `scheduled_jobs` store
(Turso, kept out of `TABLE_NAMES`, with a localStorage fallback) — to wipe it,
clear the `scheduled_jobs` localStorage key or `DELETE FROM scheduled_jobs` on
Turso. There is no server cron and no Periodic Background Sync, so jobs cannot
fire while every tab is closed.

### "Overdue / due-soon dates look wrong by a day"
Cause: timezone resolution (0.113.0+), not data corruption. The app now derives
its day boundary (what counts as overdue, due today, or due soon) from a
resolved timezone — a per-project operating timezone, falling back to the
per-device default (Settings → Timezone) — instead of UTC. Existing data is
unchanged; this is a display/logic preference only. Fix: set the correct
per-device default or per-project operating timezone in Settings. The display
timezone switcher in the top bar (Default / UTC / additional zones) only affects
how timestamps render for the session and resets on reload; it does not change
the underlying data or the due-date logic.

### "A description shows literal `<p>` tags, or an export lost its paragraphs"
Both are reader-side, not stored corruption — the underlying value is almost
certainly fine, so **do not "repair" the data**. Descriptions are rich HTML on
seven fields (task, RAID description + mitigation, change description + impact +
resolution notes, milestone). Storage deliberately holds **both** plain-text and
HTML shapes at once; every reader upgrades on read.

- *Literal tags visible.* Either a writer escaped HTML (`plainToHtml` on a value
  that was already HTML — it escapes `& < >`, so tags become text and stay that
  way permanently), or a reader read the field raw instead of via
  `descriptionHtml` / `descriptionText`. Sweep with
  `grep -rn "plainToHtml(" src/app`; every remaining hit must be provably
  plain-text input. Fix the writer, then correct the affected records by hand —
  escaped text cannot be un-escaped safely in bulk, because a description may
  legitimately contain `&lt;`.
- *Paragraphs fused into one line.* A document renderer is not mapping the
  newline. The export path is `descriptionTextWithBreaks`, which emits `"\n"`;
  each renderer must translate it (`<br>` for HTML/PDF — escape first, `<w:br/>`
  for DOCX, one `<a:p>` per line for PPTX; XLSX relies on `xml:space="preserve"`
  + `wrapText`). A new export column must also join the matching
  `*_RICH_COLUMNS` set.
- *Not a bug:* CSV and Markdown exports contain the markup. They are the app's
  own storage format and round-trip a project losslessly on purpose.

### "Regenerating sample data produced near-empty files"
Symptoms: `npx vite-node scripts/generate-sample-workspace.ts` exits **0** and
reports success, but `sample-workspace-big/huge.json` come out with almost no
records. Cause: something in the decode path called DOMPurify without a DOM.
DOMPurify binds `window` at module-eval time; under bare Node the call throws,
and `jsonToWorkspace`'s catch-all swallows it into an *empty* workspace that then
"successfully" scales and writes. Fix: the jsdom globals must be installed
**before** the first `await import("../src/app/storage")` — ordinary `import`
statements hoist above that, which is why the script uses dynamic imports. If the
script itself is unchanged, the regression is a new DOMPurify *call* reached from
`rich-text-plain.ts` or an entity sanitizer, both of which must stay DOM-free;
`rich-text-plain.test.ts` guards this. ★ Never commit the output of a run you did
not verify record counts for — the failure mode is silent.

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
