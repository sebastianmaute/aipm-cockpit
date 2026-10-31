# Runbook

Operational notes for deploying and supporting AI PM Cockpit.
Architecture detail lives in [CODEMAPS/architecture.md](CODEMAPS/architecture.md);
this file covers what to do when the app needs to ship or starts misbehaving.

## What this app is, operationally

- **Pure client-side app** with fifteen thin Next.js route handlers that exist
  only to add CORS/SSRF/auth guards to calls the browser cannot make directly:
  `jira/*` (eight), `confluence/page`, `timelog`, `stt`, `ecb`, and `ai/status`,
  `ai/messages`, `ai/models` (the optional AI gateway relay, see
  [Routing AI through a gateway](#routing-ai-through-a-gateway-run-time-optional)).
  Count them with `find src/app/api -name route.ts | wc -l`. No database,
  no auth middleware, no session store,
  and no _server_ background jobs. "Scheduled jobs" (recurring Claude analyses,
  0.105.0+) run entirely in the browser while the app is open — there is no
  server cron; a run missed on an earlier day is skipped. They are opt-in and off by
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
  no user input and no secret, which is why it needs no SSRF guard. All of these
  go out only with credentials forwarded from the request body. The browser calls
  `api.anthropic.com` (Claude), `*.turso.io` (Turso), `graph.microsoft.com`
  (M365 Graph), and `login.microsoftonline.com` (MSAL) directly (no server
  proxy) — except on a deployment that routes AI through a gateway: there the
  browser calls the same-origin `/api/ai/*` relay instead of `api.anthropic.com`,
  and the server calls the one gateway URL the operator configured (no user
  input reaches the host, so it needs no SSRF guard either), adding the
  deployment's gateway token — the only server-side secret this app can have.

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
- `npm run e2e` boots `npm run dev` on port 3000 (or `PORT`). If a server is
  already running there, the run refuses with "is already used" rather than
  attaching to it, locally and in CI. Reuse is opt-in since §58 (b): set
  `PLAYWRIGHT_REUSE_SERVER=1` and start your server with the same
  `E2E_BOOT_NONCE` the run uses.
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
origins (`api.anthropic.com` only while AI is on and not routed through a gateway and not restricted to an organisation's keys, see
[Routing AI through a gateway](#routing-ai-through-a-gateway-run-time-optional) and
[Restricting AI to the organisation's Anthropic keys](#restricting-ai-to-the-organisations-anthropic-keys-run-time-optional); `*.turso.io`, `graph.microsoft.com`,
`login.microsoftonline.com`, the SharePoint download hosts `*.sharepoint.com` and
`*.files.1drv.com` — the backend's load fetches the file bytes from the pre-authenticated
`@microsoft.graph.downloadUrl` — plus `http://localhost:*` and `http://127.0.0.1:*`
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

### Microsoft 365 sign-in smoke (manual)

Nothing in CI signs in to a real Microsoft 365 tenant: MSAL is exercised only by
unit tests with a mocked client (open-followups §498). Run this by hand against a
tenant with the app registration from
[Microsoft 365 integration setup](#microsoft-365-integration-setup):

- after **every** `@azure/msal-browser` bump (check the lockfile diff of the PR);
- after any change to the sign-in flow or to the CSP hosts MSAL calls
  (`src/proxy.ts`);
- before a desktop release that touches either.

Steps, in a browser AND in the packaged desktop app (its sign-in runs in its own
popup window, so the browser result says nothing about it):

1. Settings → Integrations: enter the Client ID and Tenant ID, then click
   **Sign in with Microsoft**. The popup opens, accepts the tenant account and
   closes by itself; the settings show "Signed in as" and the account.
2. Read something through Microsoft Graph: with Outlook sync turned on in a
   pane that has it (Milestones, for example), click **Pull from Outlook**, or
   open **Import Outlook contacts**. It loads without a sign-in or permission
   error.
3. Reload the page. The account is still signed in (the MSAL cache survived) and
   the same read works without another popup.
4. Click **Sign out**. The account is gone, and the next Graph read asks you to
   sign in again.
5. Keep the browser console open throughout: no CSP violation and no MSAL error.

Record the run in §498 (date, app version, `@azure/msal-browser` version, browser
or desktop). A failed step is a release blocker for anything that depends on
Microsoft 365.

### Video guides (manual)

The narrated video guides are hosted on YouTube (linked from the README) and are not committed. They
are re-recorded by hand with `scripts/demo-video/`, which no CI workflow runs; its README owns the
commands, exit codes and re-take steps. Operationally it needs a `.env.local` with the throwaway Turso
pair (`TURSO_THROWAWAY_DATABASE_URL`, `TURSO_THROWAWAY_AUTH_TOKEN`), an `ANTHROPIC_API_KEY` and, for
narration, an `ELEVENLABS_API_KEY` — use throwaway credentials, since recordings make billed calls —
and a dev server started with `DEMO_RECORDER=1` (hides the Next.js dev indicator, `next.config.ts`).
It clears the throwaway database before every take, so never point it at a database holding real
projects, and never run it while an `e2e:live-*` run uses the same database.

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

A release from before the AI gateway relay ignores `AIPM_AI_GATEWAY_URL`
and the route a consent records, so its browsers send AI requests directly
to `api.anthropic.com`, under a consent given for the gateway. On a gateway
deployment, unset the gateway settings before rolling back (users are then
asked to accept the direct-route disclosure), or accept that users' requests
go direct. That older release also ignores the `ai` value of
`AIPM_DISABLED_INTEGRATIONS`, so it cannot be used to keep AI off.

## Publishing a desktop release (GitHub)

1. Bump `src/app/version.ts` (`APP_VERSION`, `APP_BUILD_DATE`, milestone), run
   `npm run version:sync` (rewrites every satellite file — `version:check` is
   blocking in CI's `static` job), add the `## [<v>] - <date> "<milestone>"`
   section to `CHANGELOG.md` (`release:publish` refuses to build notes without
   it), then merge to `main`.
2. Tag the merge commit: `git tag v<version> <sha> && git push origin v<version>`.
   The tag ruleset restricts creation of `refs/tags/v*` to the owner. The tag
   **must** match `APP_VERSION` (the `guard` job runs
   `node scripts/check-tag-version.mjs "$TAG"` — `npm run tag:check` — as soon
   as the workflow starts; exit 1 is drift, exit 2 means it could not scan),
   and the tagged commit must be an ancestor of `origin/main` or `guard`
   refuses it.
3. The `release` workflow (`.github/workflows/release.yml`) runs `guard` →
   `build` (Windows, ~20-30 min — installs dependencies, builds the app and the
   installer, uploads it as a workflow artifact) → `publish`. `publish` runs in
   the `release` environment, which pauses for the owner's approval: when
   `build` finishes, open the run's Actions page → "Review deployments" →
   approve `release`. The required reviewer was added at flip step 10a
   (2026-09-25). Also standing in front of it: only the owner/admin role can
   create, move or delete a `refs/tags/v*` (the tag ruleset), the tag must
   equal `APP_VERSION` and name a commit reachable from `main` (step 2's
   `guard` check), and once published a release is immutable. **Push one release
   tag at a time.** Every run shares one fixed concurrency group, and GitHub
   keeps only one PENDING run per group: pushing a third tag while one run is
   in progress and a second is queued silently cancels the queued one (and a
   run paused waiting for approval occupies that same slot). A cancelled run just needs a re-run of its tag's workflow.
4. `publish` verifies the built files (`release:verify`), attests build
   provenance (the step runs only while the repository is public, which it is
   now; on a private repository it is skipped), drafts the GitHub
   Release, uploads the three files, then publishes. Check the release page:
   exactly three assets, the CHANGELOG notes, not a draft.
5. Exit codes: `release:verify` — 0 the files are exactly right, 1 named
   problems (fix the build, delete the tag, re-tag after a new commit), 2 could
   not check. `release:publish` — 0 published (or an identical release already
   exists), 1 a human must act (a published release for the tag differs —
   immutable releases cannot be fixed in place, publish a new version instead —
   or anything failed after the publish edit was attempted, so the release may
   already be live: inspect it by hand, don't just re-run), 2 safe to retry
   (nothing has gone live yet, including a still-unpublished draft this run
   just created that didn't match).

**Withdrawing a bad release.** Releases are immutable — nothing can be edited
in place. Publish a fixed patch version at once. On the bad one, untick "Set as
the latest release" (`gh release edit v<bad> --latest=false`, once a newer
release exists). Installed copies only ever move forward — `allowDowngrade` is
off — so a bad release stops mattering to them the moment a newer one ships.

**Rollback of a deployment** stays as it is (see "Rollback" above); it is
unrelated to the desktop release pipeline.

## Secrets

The repo contains **no production secrets**. Multiple credential paths, all browser-local except the optional AI gateway token:

| Credential | Stored | Sent to | Rotation path |
|---|---|---|---|
| Anthropic API key | Browser, encrypted (AES-256-GCM ciphertext in `localStorage["aipm-cockpit:secrets"]`, device key in IndexedDB; optional passphrase) | `api.anthropic.com` (direct from browser); on a gateway deployment, the same-origin `/api/ai/*` relay, which forwards it to the organisation's AI gateway and **never persists or logs it** | User edits Settings → AI |
| AI gateway token (`AIPM_AI_GATEWAY_TOKEN`, optional) | Server environment only; never sent to a browser | The configured AI gateway, as `cf-aig-authorization: Bearer <token>` on every relayed call | Create a new token in Cloudflare, set it, restart, then revoke the old one |
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
rotation** because the server holds none — unless the deployment sets
`AIPM_AI_GATEWAY_TOKEN`: rotate that token in Cloudflare. Users may want to rotate
their own Atlassian tokens and Anthropic keys defensively; on a gateway deployment
the Anthropic keys passed through the server, so recommend it more strongly there.

## Setup & Integration Configuration

Integration config (storage backend, AI, Jira, Timelog, M365) can be done via the **guided setup wizard** (Settings → Integrations → "Run setup wizard", or from the new-project window) or directly through the flat Integrations panel. The wizard steps through each area in order; all integration steps are skippable.

### Environment variables (build-time, optional)

The optional `NEXT_PUBLIC_*` build-time variables (Microsoft Entra client/tenant
ID, Turso database URL and auth token, the AI-usage policy owner and link, the export
footer, the default Timelog tenant) and their caveats are documented in
[security.md → Environment variables](security.md#environment-variables), which
owns that list.

### Switching integrations off for a deployment (run-time, optional)

`AIPM_DISABLED_INTEGRATIONS` switches server-side integrations off for one
deployment, for example where the server cannot reach the internet. It works
wherever the server runs: `npm start`, a container, a hosting platform, or the
desktop app (set it in the Windows environment before starting the app). The values,
what each one hides and how the API routes answer are in
[security.md → Environment variables](security.md#environment-variables). To check
it took effect, open Settings → Integrations: a switched-off Jira or TimeLog has no
section there.

- **Restart, then reload.** The server reads the setting on every request, but a browser
  tab reads it once, when the page loads. A tab left open across the change keeps its
  controls until it is reloaded; the server refuses the switched-off routes anyway
  (503, read as "unreachable", so no token is marked invalid).
- **Confluence has its own name.** The Confluence import uses the Jira credentials, but
  switching off `jira` alone leaves it offered to users who stored Jira credentials
  earlier. Name `confluence` too to switch it off.
- **`ai` switches every AI feature off**, and dictation to a speech service with it
  (`/api/stt` refuses too). To check it took effect, open Settings → AI: it says the
  organisation switched AI off, and the master switch cannot be ticked. Users' keys and
  consents are kept and work again once `ai` is removed (unless the AI route changed
  meanwhile; then users are asked again).
  Dictation with the browser's own speech recognition is not affected: it stays
  available and, in some browsers (for example Chrome and Edge), sends the audio to the
  browser maker's service. No deployment setting switches it off.
  ★ **Tabs opened before this release ignore `ai` until reloaded; have users reload.** A
  page loaded from a release without the `ai` switch never asks the server before an AI
  call and keeps the content security policy it loaded with, which still allows
  `api.anthropic.com`, so on the first deploy that sets `ai` it goes on calling Anthropic
  directly from the browser. Only the server's own routes (`/api/stt`) are refused at
  once.

### Restricting AI to the organisation's Anthropic keys (run-time, optional)

A deployment can allow only Anthropic API keys that belong to its own Anthropic
organisation, and optionally only certain workspaces of it. Each user still enters
their own key; the app's server checks it before forwarding anything. The settings and
their rules are in [security.md → Environment variables](security.md#environment-variables),
which owns that list.

1. **Find the ids** in the Anthropic Console: the organisation id, a UUID, and, if you
   want to limit the keys to some workspaces, their ids, each `wrkspc_` followed by
   letters and digits, as the Console's Workspaces page shows them. Copy workspace ids
   exactly: their letter case matters.
2. **Set the server environment** and restart:
   ```
   AIPM_AI_ORGANIZATION_ID=<organisation UUID>
   AIPM_AI_WORKSPACE_IDS=<wrkspc_…>,<wrkspc_…>   # optional
   ```
   Both are read from the server's environment (`process.env`), which a running server does
   not re-read: a change needs a server restart; no rebuild.
   A malformed value, an empty list item, workspace ids without an organisation id, or
   a misspelled setting name switch AI off for the whole deployment (reason codes
   `org-id`, `workspace-ids`, `workspaces-without-org`, `misspelled-setting`) instead of
   letting keys through. The misspelling guard treats `AIPM_AI_ORGANISATION_ID`,
   `AIPM_AI_ORGANISATION_IDS`, `AIPM_AI_ORGANIZATION_IDS` and `AIPM_AI_WORKSPACE_ID`,
   when set to anything but blanks, as an invalid setting even beside the correctly
   spelled ones, so a typo cannot leave the deployment unrestricted. As with the gateway
   settings, the code is logged once per server process, as
   `ai key restriction invalid: <reason>`, and `GET /api/ai/status`
   answers `invalid: true` with it as `invalidReason`; any invalid setting, the
   gateway's or this one, refuses every AI call. The status answer carries only
   `keyRestricted: true`, never the ids.
3. **Check it.** After the restart, open `GET /api/ai/status` on the deployment: it must
   answer `keyRestricted: true` and `invalid: false` (with `invalid: true`, its
   `invalidReason` names what to fix). Then open Settings → AI: the note under the key
   field must say that your organisation restricts which Anthropic organisation's keys
   may be used (behind a gateway, that this app's server checks the key against your
   organisation's key restriction; the gateway does no such check). If either is
   missing, the server did not pick the setting up.
4. **What changes for users.** With no gateway set, AI goes by a third route, the
   relay: the browser calls this app's `/api/ai/*` and the server forwards to
   `https://api.anthropic.com`. The content security policy drops
   `api.anthropic.com` whenever the restriction is set or invalid. The relay route has
   its own disclosure texts, so every user is asked to accept the AI data disclosure
   again, and to tick background AI again, exactly as when the gateway is turned on or
   off (see "Consent follows the route" under
   [Routing AI through a gateway](#routing-ai-through-a-gateway-run-time-optional)).
   With a gateway set as well the route stays `gateway`, but a consent also records
   whether the restriction was on, so turning it on or off asks every user again there
   too. A tab of this release left open across the change sends nothing until it is
   reloaded: before each AI call it asks `GET /api/ai/status`, and when the route or
   `keyRestricted` differs from what the page loaded with, the call is refused as a
   changed deployment and the user is asked to reload. A tab still running the release
   before the restriction existed does not know `keyRestricted`: through a gateway it
   keeps sending until reloaded, and the server still checks every key; without a
   gateway the new `relay` route is one it cannot read, so it reports that it could not
   confirm the AI setting and sends nothing.
5. **How a key is checked.** Before the first call with a key, the server sends a free
   `GET /v1/models?limit=1` with that key and reads the answer headers
   `anthropic-organization-id` and `anthropic-workspace-id`. Several first requests with
   the same key share one check.
   - A key of another organisation or an unlisted workspace gets `403`
     `ai-key-wrong-organization` or `ai-key-wrong-workspace`. The refusal is cached
     for 5 minutes; users see it in the AI key banner and in Settings → AI. With a
     workspace list set, a key that is not tied to a workspace (Anthropic sends no
     `anthropic-workspace-id` for it) counts as an unlisted workspace.
   - A check that cannot be completed gets `503` `ai-key-check-unavailable` and nothing
     is forwarded; it is not cached, and users see that the key could not be checked
     and should try again, in Settings → AI and in the feature that failed. That covers
     any other answer than `2xx`, `401` or `403` (a `3xx`, `404`, `429` or `5xx`
     among them), a network error, a timeout (30 seconds), and a `2xx` that lacks the
     organisation header or carries an empty or repeated header. It also covers a
     server that is already running 32 checks for other keys: a new key's check is not
     sent then, and its user sees the same "could not be checked, try again".
   - A pass is cached in memory only, by a keyed SHA-256 (HMAC) of the key whose
     secret is drawn at random when the server starts, until the restriction settings
     change or the cache (at most 1000 entries) evicts it; when full, the cache evicts
     the entry whose key was used least recently, so keys in steady use stay cached. A
     restart empties the cache.
   - Anthropic's own `401` or `403` for the key is passed through unchanged. The `401`
     is remembered for 60 seconds (by the same keyed hash), so repeated calls with
     one invalid key send one check, not one each; the `403` is not cached.
   - A `401` or `403` that is not Anthropic's own answers `502` `ai-gateway-rejected`
     only when a gateway token (`AIPM_AI_GATEWAY_TOKEN`) is set: it is then the gateway
     refusing its token, as any gateway refusal does. Without a gateway token, on the
     direct relay or through a gateway without one, the check is unavailable: `503`
     `ai-key-check-unavailable`, nothing forwarded, nothing cached.
6. **Combining it with a gateway.** With `AIPM_AI_GATEWAY_URL` set too, calls stay on the
   gateway route and the check goes through the gateway with its token, sending
   `cf-aig-skip-cache: true` so that a cached answer for another key can never pass.
   ★★ **The gateway must pass Anthropic's two answer headers through.** A gateway that
   drops them makes every check "unavailable": AI stays off for everyone. Such a
   gateway cannot be combined with the restriction; check with Settings → AI after
   turning it on.
7. **Desktop.** The desktop app's server child receives the operating system's
   environment variables (`desktop/src/server-child.ts` copies `process.env`), so set
   both variables in the environment the desktop app starts in.

What the restriction does not do (the same four limits as
[security.md → AI features](security.md#ai-features)): it proves which organisation and
workspace a key belongs to, not what that organisation's contract covers; it is
enforced in this app's server, so a person with a key can still call Anthropic outside
the app; anyone with access to the server environment can change or remove it; and
verdicts are cached per server process, and a cached pass is not checked again until
the cache evicts it or the restriction settings change; a key that is revoked is
refused by Anthropic itself.

The relay is not reserved for the app's own pages: it answers any same-origin request,
and any client outside a browser, that sends a key. With the restriction on, every such
key is still checked, so only keys of the organisation (and of a listed workspace, when
a list is set) get through. The relay adds no access the key does not already have.

### Routing AI through a gateway (run-time, optional)

By default every AI request goes from the user's browser straight to
`api.anthropic.com`. A deployment can instead send them through this app's server
and the organisation's AI gateway (Cloudflare AI Gateway), for example to see usage
in one place or to enforce a rate limit. Each user still enters their own Anthropic
key; the server only relays the request. The two settings, their exact rules and
what an invalid value does are in
[security.md → Environment variables](security.md#environment-variables), which owns
that list.

1. **Create the gateway** in the Cloudflare dashboard (AI → AI Gateway).
2. **Create the token** in the gateway's settings ("Create authentication token"), with
   the **AI Gateway Run** permission, then turn on **Authenticated Gateway** there.
   ★ The token is **account-wide**: it can send requests through EVERY gateway in that
   Cloudflare account, not only this one — including any gateway that holds stored
   provider keys.
3. ★★ **No gateway in that Cloudflare account may hold stored provider keys** (BYOK,
   "Provider keys") — or use a dedicated Cloudflare account for this app. A gateway
   uses a stored key only when a request carries no provider key of its own. The relay
   always forwards the caller's own `x-api-key` and refuses a call without one
   (`400 missing-api-key`), so nobody calling through this app can make a gateway fall
   back to a stored key. The risk is the token itself: whoever obtains it (a
   compromised or leaked server environment) can send requests without a provider key
   to any BYOK gateway in the account and spend the organisation's stored
   credentials. If you keep stored keys in the same account anyway, you accept that
   this app's server-held token can spend them.
4. **Set the server environment** and restart:
   ```
   AIPM_AI_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/anthropic
   AIPM_AI_GATEWAY_TOKEN=<the token from step 2>
   ```
   Both are read from the server's environment (`process.env`), which a running server does
   not re-read: a change needs a server restart; no rebuild.
   An invalid value switches AI off for the whole deployment instead of falling back
   to a direct call: Settings → AI says the gateway setting is invalid, and
   `GET /api/ai/status` answers `invalid: true`. Which part is invalid is named by a
   reason code (`url`, `token` or `token-without-url`), never by the value, in two
   places: the server log, once per server process, as
   `ai gateway setting invalid: <reason>`, and the browser's diagnostic log, as
   `ai.gateway.invalid` with the field `reason`. (The status answer carries the same
   code as `invalidReason`.)
5. **Allow long responses and large requests on the front proxy.** A relayed call is
   held open until Anthropic answers; the relay itself gives up only after 15 minutes
   without data (an idle timeout: a call that keeps receiving data is never cut off by
   it). Any ingress, load balancer or reverse proxy in front of the app must allow an
   **idle (read) timeout of at least 15 minutes** on `/api/ai/messages`, and must set
   **no total request timeout shorter than the longest answer you expect**, or long
   answers fail at the proxy. It must also allow a **request body of at least 32 MB**
   on `/api/ai/messages` (the relay's own cap, Anthropic's Messages limit): common
   ingress defaults are around 1 MB, and a chat with attachments above that is refused
   before the relay sees it, so the user sees a gateway error. If your ingress or
   route configuration exposes no per-route setting for either, ask whoever operates
   it to set both for `/api/ai/messages`.
   ★ **Uploading the request has its own limit.** The app server must receive the
   whole request body within Node's default request timeout of 5 minutes (`next start`
   does not change it), so the largest allowed chat (32 MB) needs an upload of roughly
   110 KB/s from the user's browser; on a slower link a large chat fails before it is
   relayed. Smaller requests are rarely affected.
6. **Decide the gateway's logging before go-live.** If it is on, the gateway stores
   every prompt and answer, which include personal data from the project: set its
   retention, record the gateway provider as a processor, and name it in the AI usage
   policy the consent screen links to (`NEXT_PUBLIC_AI_POLICY_URL`). The consent screen
   tells users the gateway and its provider receive their requests and that the
   organisation decides what it logs.
7. **Check it.** Open Settings → AI: every user is asked to accept the AI data
   disclosure again, and the dialog and the key note now say the data goes through
   this app's server and the organisation's AI gateway. Send one chat message and
   find it in the gateway's logs (if logging is on).

What to know when running it:

- **Consent follows the route.** A consent records whether it was given for a direct
  or a gateway deployment, so turning the gateway on — or off again — asks every
  user to accept the disclosure again. The background consent (for the scheduled jobs
  and the automatic insight recommendations) follows the route too: it lapses at the
  same change, and each user has to tick background AI in Settings → AI again,
  separately from accepting the disclosure; until then those features do not run.
  Changing from one gateway URL to another is not a route change and asks nothing.
  If the new gateway belongs to a different provider or account, or logs differently,
  tell users yourself; the app does not ask them again.
  A tab left open across the change sends
  nothing: the chat and the other AI features that report a failure ask for a
  reload (never a key problem); the digest summary and the automatic insight
  recommendations, which fail quietly, are skipped.
  ★ **Tabs opened before this release ignore both settings until reloaded; have users
  reload.** A page loaded from a release without the gateway relay never asks the server
  before an AI call and keeps the content security policy it loaded with, which still
  allows `api.anthropic.com`. On the first deploy that sets the gateway (or the `ai`
  switch, see [Switching integrations off](#switching-integrations-off-for-a-deployment-run-time-optional)),
  such a tab goes on sending directly to Anthropic, under its old consent, until it is
  reloaded. Announce the change and ask users to reload every open tab.
- **Rate limiting belongs to the gateway.** The relay has no per-IP limit of its own;
  set one in the gateway's settings if you want one. When the gateway itself answers
  429, users see "Your organisation's AI gateway is limiting requests right now";
  Anthropic's own rate limit, which the relay passes through unchanged, keeps its
  usual message. The gateway's own request logging (prompts and answers) is also
  configured there — the relay logs nothing.
- **Residual: anyone who can reach the app server can use the gateway with their own
  Anthropic key.** The relay accepts same-origin browser calls only, which stops
  another web page from using it through a visitor's browser, but a script that
  sends no browser headers is not a browser and is not stopped. It still has to
  bring a working Anthropic key, which is billed to that key and always forwarded, so
  it cannot trigger a stored provider key; the exposure is the gateway's capacity.
  The organisation's money is at risk only through the token itself, on a gateway in
  the same Cloudflare account that holds stored keys (step 3). Network access to the
  app is the control here: restrict who can reach the app server, for example by
  keeping it on the organisation's network or behind its sign-in proxy.
- **Gateway errors** appear in the chat and the other AI features that report a failure as "Your
  organisation's AI gateway refused this app (check the gateway token)" (the gateway
  answered 401/403) or "… could not be reached or returned an error" (the gateway was
  unreachable, or any other non-Anthropic failure, including a 3xx, which the relay
  does not follow; a 429 is named as above), never as a problem with the user's key or
  with the browser's own connection; a scheduled job's run history records the same
  message. A switched-off, invalid or changed AI setting is named the same way in the
  features; a scheduled job does not record it but waits and retries on its next check.
  An error Anthropic itself returns, such as a rejected key, passes through unchanged.

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

### "A required check is red"
CI is `.github/workflows/ci.yml`; its eight jobs are the required checks, detailed in
[`docs/AGENTS/ci.md`](AGENTS/ci.md). Open the red job's **step summary** first. `static` runs every
static gate even after one fails (`--keep-going`) and lists every failing step with its exit code,
so one run shows them all; `unit` puts the "All files" coverage line and the failing tests there.
For the register and scan gates, **exit 1 = drift** (fix the content the gate names) and **exit 2 =
could not scan** (the gate read nothing it could trust — a missing file, an empty list, a moved
shape): the two demand opposite responses. `leaks:check` at exit 2 in CI usually means the
`LEAK_LIST` secret is missing or empty — for a Dependabot PR, in Dependabot's own secret store.
A leak row reading `FAIL (exit 2; LEAK_LIST_FILE unset under CI)` means the job never exported the
list; `FAIL (exit 2)` alone means `leaks:check` itself could not scan it.
Reproduce a `static` failure locally with the leak list set first — without `LEAK_LIST_FILE` a local
run SKIPS `leaks:check` and can still end `gate:local PASS`:
`LEAK_LIST_FILE=<path to your local leak list> node scripts/gate-local.mjs --group static --keep-going`.
Add `--allow-dirty` only when you have uncommitted tracked changes (it refuses to start over them,
exit 2, otherwise). Read the table it prints: a `SKIPPED` row means that step was NOT reproduced,
whatever the final line says.
The `static` job's "Commit-message leak scan" step is not part of `gate:local`; reproduce it over your
branch's commits with
`LEAK_LIST_FILE=<path to your local leak list> node scripts/check-commit-message-leaks.mjs origin/main..HEAD`
(exit 1 names each offending short SHA and class, e.g. `class=trailer`; reword those commits).

### "Actions minutes exhausted"
The repository is public (`gh repo view --json visibility`), and GitHub-hosted standard runners are
free for public repositories, so the minutes no longer run out. The fallback below still applies if
the repository goes private again (Actions then runs on GitHub Pro's included minutes with a $0
budget, so exhaustion stops jobs rather than billing) or when Actions itself is down: checks cannot
complete, so merging is blocked.
Fallback: run `npm run gate:local` (with `LEAK_LIST_FILE` set), merge with the admin bypass, and note
the bypass and the gate line (`gate:local PASS at <sha>`) in the PR. The next push to `main` once
Actions runs again re-runs everything. ★ `gate:local` runs `changelog:check` with no PR context, so the
`no-changelog` label cannot reach it: on a branch whose PR carries that label, run
`CHANGELOG_OPT_OUT=1 npm run gate:local` and say so in the PR (§527).

### "changelog:check failed"
App code changed without a line in `CHANGELOG.md` (§527). Add a line under `[Unreleased]`, or, for a
change that cannot reach a user, add the `no-changelog` label to the PR. Adding a label does NOT
start a new CI run: re-run the failed `static` job from the PR's Checks tab (the label is read live,
so the re-run sees it). A change to `CHANGELOG.md` that only deletes lines does not count; it must
add (or rewrite) at least one line.

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

### "Jira shows 'Malformed Jira response'" or a synced issue is missing
Since 1.15.0 the browser checks every Jira response against the schemas in
`src/app/jira-schemas.ts` before using it. A response whose envelope does not
match (an Atlassian API change, or something between the proxy and Atlassian
rewriting the body) is refused with "Malformed Jira response"; it is classified as
an ordinary error, never a network one, so sync does not treat it as transient. A single malformed issue,
project, issue type or user inside an otherwise valid list is dropped and the
rest are used. Both cases are recorded in Settings → Diagnostics
(`jira.malformedResponse` / `jira.malformedItems`, with the route path; the
payload is never logged). Ask the user for that entry, then compare the route's
JSON in the browser Network tab with the schema.

### "Jira settings say they couldn't reach Jira, but the network is fine"
The Jira code is a separate download, fetched on first use. If that download
fails, Settings → Jira shows the translated "Couldn't reach Jira" message and
the browser's own error goes to Settings → Diagnostics as
`jira.moduleLoadFailed`. The failed load is not cached: the next Jira action
retries the download, so a reload is not needed once the connection is back. A
failure that repeats on a good connection points at a stale deployment (the
page references a chunk the server no longer has) — reload the page.

### "Claude chat returns 401 / 403"
The Anthropic key the user saved in Settings → AI (held encrypted in the browser) is invalid, expired, revoked, or
rate-limited. Users must regenerate at
<https://console.anthropic.com/settings/keys>. The server does not see this
traffic, so server-side logs will be silent. On a gateway deployment the relay
passes Anthropic's answer through unchanged and logs nothing either; a 401/403
from the gateway itself shows as "your organisation's AI gateway refused this app
(check the gateway token)" instead (see
[Routing AI through a gateway](#routing-ai-through-a-gateway-run-time-optional)).

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
the switch). If Settings → AI says the organisation switched AI off, or that the
AI gateway setting is invalid, the switch cannot be ticked: the deployment's
`AIPM_DISABLED_INTEGRATIONS` names `ai`, or `AIPM_AI_GATEWAY_URL` /
`AIPM_AI_GATEWAY_TOKEN` is invalid (see
[security.md → Environment variables](security.md#environment-variables)).

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

### "Unsaved changes … could not be restored automatically because this project was changed elsewhere since"
Saves are asynchronous, so a save started as the page closes can be lost. The app therefore keeps a
copy of the last unconfirmed save in `localStorage` (the unload journal, §629) and, on the next load,
restores it over the stored project when that project is still the version the copy was built on.
When the stored project has moved on — another tab or device saved it in between — the app does not
choose: the notice offers **Restore anyway** (the copy overwrites the stored version) or **Discard**.
Ask the user which version they want before they pick.

Since 1.20.0 two false notices are fixed: a reload of a Turso project while a save was still on its
way, and a quick reload while two saves were in flight. A copy written by an older version may still
show the notice once, on the first reload after the update; Restore anyway is safe there if nobody
else edited the project. Drafts for other projects or storage locations are listed in a separate
notice with Download and Discard; a downloaded draft is workspace JSON that the Step 0 import reads.
Detail: [`docs/AGENTS/storage.md`](AGENTS/storage.md), "The unload journal (§629)".

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
is open (on load, on tab re-focus, and on a light interval), run on the day
they are due (a run missed on an earlier day is skipped) and **at most once per day (daily) or per week (weekly,
Monday to Sunday)** in the job's time zone, however its time or zone is edited, are **advisory only** (they never write to the workspace),
and **never run in popouts**. Each job names one project, needs a Turso portfolio, and keeps a report row in `scheduled_reports` for each run that reaches its project (a run whose project was deleted,
and a transient storage failure, write none; the newest 50 per job are kept).
State persists in a global `scheduled_jobs_v2` store (Turso, kept out of `TABLE_NAMES`, with a localStorage fallback;
the pre-§772 `scheduled_jobs` table is read once to migrate, its rows are then switched off, and it is never written
again, so a device on an older build cannot strip the jobs). **Every device sharing the portfolio needs the update.**
A job is due by the clock of the device that runs it, so a device whose clock runs fast claims a slot early (`ran_at`
in the report is the database's time, so the report shows when it really ran). Keep device clocks right.
To wipe the jobs, clear the `aipm-cockpit:scheduled-jobs` localStorage key (`LOCAL_KEY` in `scheduled-jobs-store.ts`)
or `DELETE FROM scheduled_jobs_v2 WHERE id <> '__migrated__'` on Turso (keep the marker row, or the next load copies
the old rows back in); to wipe the reports too, `DELETE FROM scheduled_reports`. There is no server cron and no Periodic Background Sync, so jobs cannot
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

There is no on-call rotation. Report bugs as GitHub issues on the repository;
report a security vulnerability privately as [SECURITY.md](../SECURITY.md)
describes, never in a public issue. For data-loss reports specifically:
remind the user that data is browser-local and not server-recoverable, then
walk them through the Export menu so future incidents are recoverable.
