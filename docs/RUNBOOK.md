# Runbook

Operational notes for deploying and supporting AI PM Cockpit.
Architecture detail lives in [CODEMAPS/architecture.md](CODEMAPS/architecture.md);
this file covers what to do when the app needs to ship or starts misbehaving.

## What this app is, operationally

- **Pure client-side app** with twelve thin Next.js route handlers that exist
  only to add CORS/SSRF/auth guards to calls the browser cannot make directly:
  `jira/*` (eight), `confluence/page`, `timelog`, `stt` and `ecb`. No database,
  no auth middleware, no session store,
  and no _server_ background jobs. "Scheduled jobs" (recurring Claude analyses,
  0.105.0+) run entirely in the browser while the app is open — there is no
  server cron; missed runs catch up on next open. They are opt-in and off by
  default (see "Disable / reset scheduled jobs" below).
- **All user data lives in the browser** (`IndexedDB` for the workspace,
  `localStorage` for settings). Losing the server tier loses nothing about the
  users; losing the browser profile loses the user's data.
- **Credentials are NOT in `localStorage` in the clear.** The five secrets
  (Anthropic key, Turso auth token, Jira, Timelog and STT tokens) are stored
  only as AES-256-GCM ciphertext (`localStorage["aipm-cockpit:secrets"]`),
  wrapped by a non-extractable device key held in the IndexedDB database
  `aipm-cockpit-secrets`; `writeSettings` is the only writer of the settings key and blanks
  those fields before it writes. What stays in `localStorage` unencrypted is the
  identifying half — Jira site URL and email, Timelog host, tenant and email —
  which is identifying rather than secret.
- **Outbound calls** from the server are only to `api.atlassian.com` from
  `/api/jira/*` and `/api/confluence/page` (both Atlassian — the Confluence
  route reuses the Jira proxy helpers, the same SSRF allowlist, and the
  user-supplied Atlassian credentials; no new outbound host) and to the user's
  `*.timelog.com` host from `/api/timelog` (the Timelog time-booking proxy —
  its own SSRF allowlist, private-IP block, `/v1/` path allowlist, Bearer auth,
  and per-IP rate limit; reads are forwarded with the user-supplied token from
  the request; the path allowlist is `/v1/` **and** `/v2/`, the second for the
  per-project time-registrations endpoint). Two more: `/api/stt` reaches a
  **user-supplied** OpenAI-compatible host — the one route with no vendor apex
  to pin, compensating with a private-IP block, https-only, `redirect:
  "manual"` and a size cap — and `/api/ecb` reaches one hard-coded ECB URL with
  no user input and no secret, which is why it is the only route that needs no
  SSRF guard. All go out only with credentials forwarded from the request
  body. The browser calls `api.anthropic.com` (Claude), `*.turso.io` (Turso),
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
is portable — any Node 24+ host with `npm start` will serve it. 24 is the
version CI builds and tests on; Node 20 reached end-of-life on 2026-04-30 and
no longer receives security updates, so it is no longer a supported baseline.

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
  `vitest.config.ts` (values listed in
  [CONTRIBUTING.md → Testing](../CONTRIBUTING.md#testing)) and will exit
  non-zero if any floor slips. These are the
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
| **Node 24+ + `npm start`** | Self-host. `next.config.ts` sets the security headers; no reverse-proxy header injection needed. |
| **Static export** | Not supported — `/api/jira/*` route handlers require the Node runtime. |

### Security headers
Static headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`) live in `next.config.ts`. The **Content-Security-Policy**
lives in `src/proxy.ts` because it carries a per-request nonce — Next.js 16
extracts that nonce from the request header and attaches it to framework
scripts and SSR `<style>` blocks. Production CSP is nonce-strict for
`script-src` and `style-src-elem` (no `'unsafe-inline'`); `style-src-attr`
keeps `'unsafe-inline'` because React renders `style={{...}}` props as the
`style` HTML attribute (Gantt/table use dynamic px math). The app does use
`dangerouslySetInnerHTML` (list the sites with
`git grep -l dangerouslySetInnerHTML -- src ':!*.test.*'`), but only for HTML
that has been sanitized (`sanitize-html.ts` / DOMPurify) or is an app-authored
constant, and script execution stays nonce-strict — which is why the
attribute allowance is treated as low-risk. `connect-src` allows the browser-called
origins (`api.anthropic.com`, `*.turso.io`, `graph.microsoft.com`,
`login.microsoftonline.com`, plus `http://localhost:*` and `http://127.0.0.1:*`
for a local/self-hosted Turso); `worker-src 'self'` is set for the installable
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

Users keep their data — there is no DB migration to reverse, and no
client-side storage migration either (the one-time `lop-app` →
`aipm-cockpit` storage migration was removed in 0.190.41). The remaining
risk is forward compatibility: data saved by a newer build can carry
fields or a schema version the older build does not know. In environments
with real user data, have users take an export before rolling back.

## Publishing a desktop release

1. Bump `src/app/version.ts` (`APP_VERSION`, `APP_BUILD_DATE`, `APP_MILESTONE`),
   add the `CHANGELOG.md` entry, and propagate with `npm run version:sync`,
   which rewrites every other file that restates the version —
   `version-sync-check` is blocking.
2. Merge to the default branch.
3. Tag the merged commit: `git tag v<version> && git push origin v<version>`.
   The tag **must** match `APP_VERSION`; `tag-version-check` runs as soon as the
   tag pipeline starts and fails otherwise (exit 1 is drift, exit 2 means it
   could not scan at all). A failure holds back `publish-release`, which runs
   only once every earlier stage has passed.
   Whoever pushes the tag needs
   Developer+ and the right to create protected tags, because the pipeline's job
   token acts with the pusher's access — GitLab behaviour as documented,
   unverified here.
4. The tag pipeline runs `desktop-package-tag` (blocking; a full wine build, so
   slow) and then, only once every earlier stage has passed, `publish-release`,
   which creates the Release and attaches the installer link.
5. Check the Releases page: the asset link should download
   `aipm-cockpit-<version>-setup.exe`.

**If the tag pipeline is red.** `publish-release` has no `needs:` and runs only
once every earlier stage has passed.

- **Another job failed.** If the failure was flaky and `install` finished less
  than an hour ago, retry that job, and GitLab then runs the skipped
  `publish-release`. Later than that, run a new pipeline for the tag instead
  (Build → Pipelines → Run pipeline, choose the tag): every `needs: [install]`
  job downloads `install`'s `node_modules/` artifact, which has `expire_in: 1h`,
  so a late retry likely fails without it. The `workflow:` rule
  `if: $CI_COMMIT_TAG` admits that pipeline, and its `publish-release` creates
  the Release — or answers 409 and confirms, if an earlier run already created
  it with this link. A deterministic failure — tag drift, a real lint or test
  error — fails the same way every time: it needs a fix and a new tag, because
  a tag's pipeline only ever builds the commit the tag names. Until the
  pipeline is green the asset link may 404, because GitLab resolves a per-tag
  artifact URL only through a successful pipeline. The retry running
  `publish-release`, a late retry failing, the Run pipeline form taking a tag,
  and the 404 are GitLab behaviour, unverified here.
- **`publish-release` exited 2** (a timeout, a 5xx, a 408/429, a 2xx it could not
  confirm): retry it. A create that did land answers 409 the second time, and the
  job exits 0 only if that existing Release carries the link. A redirect or a
  missing variable also exits 2 and will not clear on a retry, so read the message.
- **`publish-release` exited 1**: a human must act. Either the API refused with
  a 4xx other than 408, 409 or 429 (for a 403 it prints
  `API refused: HTTP 403 (the tag pusher needs Developer+, and the right to create protected tags)`,
  which is step 3's access), or it answered 409 and the Release that already
  exists for the tag lacks the link
  (`a Release for <tag> exists WITHOUT <link> — add the link (Release links API) or delete that Release, then retry`).

★ Tag-build artifacts never expire, deliberately — a published download must not
vanish. The manual `desktop-package` build on other pipelines still expires
after a week.

★★ If `desktop-package-tag` cannot run on the wine image, the fallback is a
local Windows build (`npm ci` and `npm --prefix desktop ci`, then
`npm run desktop:build && npm run desktop:package`; the installer lands in
`desktop/release/`), attached by hand to a Release you create yourself — a
failed `desktop-package-tag` stops the pipeline before `publish-release` runs.
If the image is unreachable for good and the `desktop-package` jobs are deleted,
remove `publish-release` in the same change: it has no `needs:`, so
on its own it would go on running on every tag and publish a Release whose link
names a job that no longer exists — a green pipeline over a download that 404s.
See `docs/superpowers/specs/_probes/2026-09-10-wine-runner-and-artifact-size.md`
for why that is the sanctioned fallback rather than a thing to debug in CI.

★★ The installer is unsigned. A copy downloaded through a browser carries the
Mark-of-the-Web stream the browser writes on download, which is what SmartScreen
checks, so colleagues should expect the prompt. A locally built copy was
measured to carry no such stream (`Get-Item -Stream *` lists `:$DATA` alone), so
"no prompt appeared" from a local build is not evidence the prompt is gone for
colleagues.

## Secrets

The repo contains **no production secrets**. Multiple credential paths, all browser-local:

| Credential | Stored | Sent to | Rotation path |
|---|---|---|---|
| Anthropic API key | Browser, encrypted (AES-256-GCM ciphertext in `localStorage["aipm-cockpit:secrets"]`, device key in IndexedDB; optional passphrase) | `api.anthropic.com` (direct from browser) | User edits Settings → AI |
| Jira site URL + email + API token | Site URL + email: browser `localStorage`, unencrypted. Token: encrypted like the Anthropic key (device key only) | Forwarded to Atlassian via `/api/jira/*` route handlers; **never persisted server-side** | User edits Settings → Jira |
| Timelog host + tenant + email + API token | Host, tenant, email: browser `localStorage`, unencrypted. Token: encrypted (device key only) | Forwarded to the user's `*.timelog.com` host via `/api/timelog`; never persisted server-side | User edits Settings → Integrations → Timelog |
| Dictation (STT) base URL + API key | Base URL: browser `localStorage` (settings). Key: encrypted (device key only) | Forwarded to the user-configured endpoint via `/api/stt`; never persisted server-side | User edits Settings → Dictation engine |
| **Microsoft Entra (M365)** Client ID + Tenant ID | Browser `localStorage` or `NEXT_PUBLIC_*` env vars | `login.microsoftonline.com` via MSAL (browser) for OAuth consent; issued token sent to `graph.microsoft.com` | Stored in Settings → Integrations or env vars; token is short-lived (refresh token managed by MSAL) |
| **Turso** Database URL + Auth Token | URL: browser `localStorage` or `NEXT_PUBLIC_*` env vars. Token: encrypted like the Anthropic key (optional passphrase), or a `NEXT_PUBLIC_*` env var | Your Turso database host (`*.turso.io`, or a local libSQL on loopback), direct from browser | Stored in Settings → Integrations or env vars; **recommend scoped token with minimal permissions** |

**Important:** The `NEXT_PUBLIC_*` env vars are **build-time public** — they are inlined into the JavaScript bundle and visible in the browser. Use them only for non-secret client-side config (e.g., Entra Client ID). The Turso auth token should **not** be exposed as a build-time env var in public deployments — use Settings inputs instead, or a scoped token if env var is unavoidable.

The recent feature batch (timezones, guided tour, steering committee, Kanban,
scheduled jobs, Confluence import) introduced **no new credential**: Confluence
reuses the existing Atlassian (Jira) token, scheduled jobs reuse the Anthropic
key, and committee Outlook push reuses the M365 Graph token. All five
secrets (Anthropic key, Turso auth token, Jira, Timelog and STT tokens) remain
encrypted at rest (see `secrets.ts` — AES-256-GCM, non-extractable device key by
default; only the Anthropic key and Turso token offer a passphrase). What is
stored where, and the build-time env vars, are owned by
[security.md](security.md#security-model).

If a deployment-host compromise is suspected, **no server-side secret needs
rotation** because the server holds none. Users may want to rotate their own
Atlassian tokens and Anthropic keys defensively.

## Setup & Integration Configuration

Integration config (storage backend, AI, Jira, Timelog, M365) can be done via the **guided setup wizard** (Settings → Integrations → "Run setup wizard", or from the new-project window) or directly through the flat Integrations panel. The wizard steps through each area in order; all integration steps are skippable.

### Environment variables (build-time, optional)

The optional `NEXT_PUBLIC_*` build-time variables (Microsoft Entra client/tenant
ID, Turso database URL and auth token, the AI-usage policy owner and link) and their caveats are documented in
[security.md → Environment variables](security.md#environment-variables), which
owns that list.

### Microsoft 365 integration setup

To enable Outlook contacts/calendar import and SharePoint storage:

1. Register an app in [Microsoft Entra admin center](https://entra.microsoft.com/).
2. Create a Single-Page Application (SPA) with:
   - Redirect URI: `http://localhost:3000` (dev) or your production URL
   - API permissions (delegated): `User.Read`, `Contacts.Read`, `Calendars.Read`, `Calendars.ReadWrite` (calendar write-back), `Files.ReadWrite.All` (SharePoint storage and document links), `Sites.Read.All` (SharePoint picker). The authoritative list is [integrations.md](integrations.md).
3. Copy **Client ID** and **Tenant ID** into Settings → Integrations, or set the build-time env vars in [security.md](security.md#environment-variables).
4. The app authenticates via MSAL in the browser using PKCE (no backend token exchange).

### Turso integration setup

To enable Turso as a storage backend:

1. Create a database at [Turso console](https://console.turso.io/).
2. Generate an **auth token** with minimal permissions (scoped to the database if possible).
3. Enter the **Database URL** and **Auth token** in Settings → Integrations, or set the build-time env vars in [security.md](security.md#environment-variables).
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
The Anthropic key the user saved in Settings → AI (held encrypted in the browser) is invalid, expired, revoked, or
rate-limited. Users must regenerate at
<https://console.anthropic.com/settings/keys>. The server does not see this
traffic, so server-side logs will be silent.

### "Outlook import fails with 401 / permission error"
Cause: M365 toggle is OFF, invalid M365 credentials, or insufficient Graph scopes. 
Fix: Open Settings → Integrations, enable the M365 master toggle, enter valid Entra Client ID / Tenant ID, and ensure the Entra app has `Contacts.Read` and `Calendars.Read` scopes granted.

### "Calendar write-back not syncing / re-consent"
Cause: The write-back toggle is OFF, no push has been triggered, or `Calendars.ReadWrite` consent was denied.
Fix: Enable it in Settings → Integrations → Microsoft 365 → "Push milestones to my Outlook calendar", then click "Push to Outlook" on the Milestones view. If access was denied, re-grant the `Calendars.ReadWrite` scope (the consent dialog re-appears on the next push). Events are tagged `AIPM:<projectId>` — a re-push reconciles existing events and removes orphans.

### "SharePoint storage shows 'not ready'"
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
clear the `aipm-cockpit:scheduled-jobs` localStorage key (`LOCAL_KEY` in `scheduled-jobs-store.ts`) or `DELETE FROM scheduled_jobs` on
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
via the maintainer's issue tracker. For data-loss reports specifically:
remind the user that data is browser-local and not server-recoverable, then
walk them through the Export menu so future incidents are recoverable.
