# AI PM Cockpit

[![Pipeline Status](https://gitlab.example.com/example-group/public-collab/aipm-cockpit/badges/main/pipeline.svg)](https://gitlab.example.com/example-group/public-collab/aipm-cockpit/-/commits/main)
[![coverage](https://gitlab.example.com/example-group/public-collab/aipm-cockpit/badges/main/coverage.svg)](https://gitlab.example.com/example-group/public-collab/aipm-cockpit/-/commits/main)
[![version](https://img.shields.io/badge/version-v0.299.0_%22Yefremov%22-2e7d32)](./CHANGELOG.md)
[![license](https://img.shields.io/badge/license-EUPL--1.2-blue)](./LICENSE)

> **The AI project-management cockpit that knows *your* project.**
>
> A command surface for project leads with a Claude copilot grounded in your operating guides and the view you're in — it surfaces the next best action and can act on it. It plugs into the Microsoft 365 / Jira / Timelog stack you already use, so it accelerates your workflow instead of becoming one more place to re-key data. Local-first, bring-your-own-key, open source — no backend account required.

![The AI PM Cockpit dashboard: project health, ranked next actions, open RAID and budget burn](docs/assets/dashboard.png)

<sub>The landing dashboard, loaded from the bundled demo project.</sub>

![A guided tour of AI PM Cockpit: dashboard, next actions, Gantt, budget and the Claude assistant](public/demos/demo-aipm-cockpit.webm)

<sub>Guided product tour (no audio). If your viewer does not play it inline, [download the clip](public/demos/demo-aipm-cockpit.webm).</sub>

---

## Why AI PM Cockpit

**A copilot that knows *this* project — not a chatbot bolted on.**
The Claude assistant is grounded in your operating guides, so its advice fits this project rather than reading like a generic chatbot. Per-view **"Ask Claude"** prompts and one-tap starters (a risk review, a weekly status update, a stakeholder update, "prioritize all tasks") mean the tool tells you the next step — and can take it, creating and updating tasks, RAID, changes, milestones, and stakeholders in natural language. The **Action Center** ranks live project data into next-best-actions and **learns** from how you respond (act / snooze / dismiss).

**It tells you what it cannot see.**
The assistant knows which view you are on and — on Open Points, Workload, Gantt and Budget — what your current filters are actually showing. Where no tool can answer it says so, by name: time bookings, the activity log, cross-project portfolio data, RACI assignments, calendar absences. A copilot that reports its own blind spots is one whose answers you can check.

**Plugs into your stack, not another silo.**
Pull people in from Outlook, attach documents straight from SharePoint, push milestones to your calendar, sync a two-way Jira project (plus optional read-only monitor projects), and fold actual Timelog bookings into your budget — so you accelerate your existing workflow instead of re-keying the same data into yet another tool.

**Own your data.**
It runs in your browser with no backend account. Bring your own API keys — they're encrypted at rest (AES-256-GCM, device-sealed). Your workspace lives in a local file, in-browser IndexedDB, or *your own* Turso database — never a vendor's. EUPL-1.2 open source.

**One cockpit for the whole engagement.**
Project-health RAG, RAID and change-control registers, a stakeholder register with RACI, resource capacity and budget with Earned Value, and a multi-project portfolio — in one surface, with a landing dashboard that opens on what needs you.

**A solo consultant and a regulated multi-workstream programme run the same tool.**
No two project leads track the same things, so the cockpit bends to fit: see work as a table, Kanban board or Gantt, toggle whole feature modules off, pick a Simple / Modular / Advanced **mode** that gates complexity, and start from a reusable **project template** that presets it all.

### Built to be trusted

Not a prototype, and not shelfware: the cockpit is **already in active friendly-user testing**, exercised against real projects by real project leads rather than sitting behind a demo. It is backed by a unit and component suite under coverage floors that are enforced rather than merely reported (lines, statements, functions and branches, plus tighter per-engine floors), a WCAG accessibility gate (axe across 17 views × 7 theme/scheme combinations), semgrep SAST, and duplication and file-size ratchets — all blocking in CI. `npm run test:coverage` reports the suite's own size and its coverage against those floors, so that figure stays a measurement rather than a number typed into a README. Local-first and bring-your-own-key by design: no server stores your data or credentials (the handful of API routes are stateless proxies to services you configure), so the browser profile is the security boundary (see [Security Model](#security-model)).

### See it in a minute

1. `npm install && npm run dev`, open [http://localhost:3000](http://localhost:3000), and click **Explore a demo project** to load a realistic workspace.
2. Add or import tasks; view them as a table, a Kanban board, or a Gantt chart.
3. Open the Dashboard for health, ranked top actions, and trends — then ask the copilot "What's next?".
4. Wire up Jira / Microsoft 365 / Timelog in Settings when you want it plugged into your stack.

---

## Full capability reference

The rest of this document is the in-depth reference: storage backends, integrations, automation, the sample workspace, and the security model. The complete feature list moved out to [docs/features.md](docs/features.md) — it is the bulk of what used to sit here. The register changes here on purpose — what follows is engineering documentation rather than a product page, written to be searched for the one section you need rather than read end to end.

## Features

Every feature the app ships is listed in **[docs/features.md](docs/features.md)** — one row each, with the full description folded away behind an expandable **Details** block.

## Quick Start

### Prerequisites

- **[Node.js](https://nodejs.org/en/download/current) ≥ 24** (the CI image is `node:24`). Check with `node --version`.
- **npm** (ships with Node.js).
- *(Optional)* **[Turso](https://turso.tech/)** account/database — only needed for multi-device or multi-project (portfolio) use; the app runs fully without it.

### Setup

```bash
npm install        # install dependencies
npm run dev        # start the development server
```

Open [http://localhost:3000](http://localhost:3000).

> **Note:** `npm run dev` is for **development only** (hot reload, unoptimized). For a production deployment, build first and then start the optimized server:
>
> ```bash
> npm run build      # type-check + production build → .next/
> npm run start      # serve the production build
> ```

No environment variables are required to run the app — every integration is configurable in-app via Settings. See [Environment Variables & Security](#environment-variables--security) for the optional build-time overrides.

### Deploying

The production build above is deployable as-is: it is a normal Next.js server
app, and since no backend holds accounts or project data, hosting it is just
serving the build. [docs/RUNBOOK.md](docs/RUNBOOK.md) carries the operational
side — the build and deploy steps, the hosting options that are known to work
(and the one that does not), the security headers, the post-deploy smoke test,
and rollback.

### Development Scripts

The handful you need to work on the app:

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies (run once, and after a dependency change) |
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Production build — type-check, then emit `.next/` |
| `npm run start` | Serve the production build (run `npm run build` first) |
| `npm run test:run` | Unit and component tests, single run |
| `npm run lint` | ESLint |

That is a curated subset. The **full script table is generated from
`package.json` and lives in [CONTRIBUTING.md](CONTRIBUTING.md#scripts)** — every
gate, checker and test runner in the repo, each with the caveat that bites when
you run it. It is the one authoritative copy; this list is a starting point, not
a second inventory to keep in sync.

## Storage Backends

The active backend is chosen in Settings → Integrations / Storage Configuration. Switching backends migrates the current workspace into the new one.

| Backend | Description | When to use |
|---------|-------------|-------------|
| Browser (default) | `IndexedDB` (schema v6) for workspace entities; `localStorage` for settings. | The zero-setup default. Use it for a single person on one machine — data survives page refresh but lives only in that browser profile. |
| Local JSON / CSV / Markdown | File System Access API — reads and writes a local file you pick. | When you want a portable file you control (commit to git, drop in a shared drive, diff by hand). Markdown/CSV are human-readable; JSON is the complete round-trip. |
| SharePoint JSON / CSV | Workspace as a single JSON or CSV blob in a SharePoint document library via Microsoft Graph; requires M365 sign-in. | When the team already lives in Microsoft 365 and you want the workspace stored alongside other project documents. |
| Turso (libSQL) | Relational schema (one table per entity) via the Turso HTTP `/v2/pipeline` API; works with Turso Cloud and a local/self-hosted `tursodb`. | For multi-device or multi-project use — relational queries, baseline/variance trends, and the shared multi-tenant database that backs the portfolio in Turso mode. |

### Browser support

The **Local JSON / CSV / Markdown** backend is built on the [File System Access
API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API),
which is Chromium-only — it is unavailable in Firefox and Safari, so the
pick-a-file backend cannot be used there. Every other backend is unaffected:
Browser (IndexedDB), SharePoint and Turso use no part of that API, and the
export/import paths work in any browser. On Firefox or Safari, stay on the
default Browser backend or configure Turso.

### Multi-tab editing

When two full browser tabs (not read-only pop-outs) point at the same Turso database, their saves are serialized through the [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) — one exclusive lock per database URL and project — so one tab's write never interleaves with another's. The model remains last-write-wins per table: the slower tab still overwrites the faster one, so simultaneously editing the same project in two tabs is not a supported workflow. A tab that cannot acquire the lock within 20 seconds fails that save with an error toast instead of waiting indefinitely.

### Emergency recovery

If a configuration change ever leaves the app stuck (for example a bad Turso
URL or a portfolio mode that won't load), you can recover without losing data:

- **Safe-mode boot:** open the app with `?safe=1` appended to the URL
  (e.g. `https://…/?safe=1`). The app boots on the local browser/file backend
  at the empty state and ignores your stored configuration in memory — nothing
  is changed on disk.
- **Recovery page:** open `/recovery`. From there you can **download** your
  current configuration, **reset** to a clean configuration, or **restore** the
  previous one. Reset only moves the configuration aside (it is recoverable) and
  never touches your projects, tasks, or any Turso cloud database.
- If the app shows an error screen, use its **Recover** button (it links to the
  same recovery page).
- **Data-loss guards:** a corrupt or partial workspace file is refused on load
  (rather than silently opening empty), and a save that would wipe or mass-delete
  a populated project is blocked unless you explicitly armed a clear-all.
  Previously-silent action failures now surface as a toast plus a diagnostics-log
  entry.

## Integrations

The first time you enable any integration or AI feature (AI, Jira, Microsoft 365, Turso, or Timelog), a one-time security & responsibility disclaimer is shown; once acknowledged on a device it is never shown again.

### Jira

All browser-to-Jira traffic is proxied through Next.js API routes rather than calling Atlassian directly from the browser. This sidesteps CORS restrictions and keeps credential handling on the server boundary: the site URL, email, and API token are sent in the POST body **per request** and are never persisted server-side.

| Route | Purpose |
|-------|---------|
| `POST /api/jira/test` | Verify credentials (`/rest/api/3/myself`) |
| `POST /api/jira/projects` | List accessible projects |
| `POST /api/jira/issue-types` | List issue types for a project |
| `POST /api/jira/users` | Search assignable users |
| `POST /api/jira/search` | Run a JQL query (paginated) |
| `POST /api/jira/create-issue` | Create a new Jira issue from a local task |
| `POST /api/jira/update-issue` | Push local task edits back to Jira |
| `POST /api/jira/transition-issue` | Change an issue's workflow status category |

Jira configuration lives inside Settings → Integrations; its fields appear only after **Enable Jira sync** is ticked. Bidirectional sync with conflict resolution is available from the Jira settings section. The API token is **encrypted at rest** (AES-256-GCM device-wrapped, like the Anthropic key and Turso token — see [Security Model](#security-model)); the site URL and email are stored in `localStorage` unencrypted (identifying, not secret). Credentials are sent only to your own Atlassian domain.

### Microsoft 365

Microsoft 365 features use MSAL (browser PKCE — no backend token exchange) and the Microsoft Graph API. The integration is off by default; enable it in Settings → Integrations.

| Feature | Graph scope | What it does |
|---------|-------------|--------------|
| Outlook contacts import | `Contacts.Read` | Imports personal contacts from `/me/contacts` into the Resource Directory and assignee address book via a preview-and-pick dialog; updates existing entries by email |
| Outlook calendar import | `Calendars.Read` | Imports all-day Out-of-Office events from `/me/calendarView` as Absences via a preview-and-pick dialog with a per-row absence-type selector |
| SharePoint storage | `Files.ReadWrite.All` | Stores the workspace as a single JSON or CSV blob in a SharePoint document library; URL configured in Settings → Integrations / Storage Configuration |
| SharePoint document links | `Files.ReadWrite.All` + `Sites.Read.All` (picker only) | Attaches SharePoint files/folders to workspace entities via a built-in Graph browser; links open in a new tab |
| Outlook calendar write-back | `Calendars.ReadWrite` | Pushes the current project's milestones into your Outlook calendar as all-day events (one-way, opt-in, manual "Push to Outlook" button on the Milestones view) |

#### Setup

1. Register an app in [Microsoft Entra admin center](https://entra.microsoft.com/) → **App registrations → New registration**.
2. Under **Authentication → Add a platform**, choose **Single-page application (SPA)** and add the redirect URI **`<origin>/msal-redirect`** — e.g. `http://localhost:3000/msal-redirect` for dev, `https://<your-host>/msal-redirect` for production. This exact path matters (see [How sign-in works](#how-sign-in-works)); a bare origin will fail with `AADSTS50011`. Add one URI per origin you serve from. It must be the **SPA** platform, not **Web** (Web expects a client secret and a query-code flow the browser can't complete).
3. Grant **delegated** Microsoft Graph permissions: `User.Read` (sign-in), plus `Contacts.Read`, `Calendars.Read`, `Calendars.ReadWrite` (calendar write-back/two-way sync), `Files.ReadWrite.All`, `Sites.Read.All` (or narrower equivalents — grant only the scopes for the features you use). Consent to each scope is requested incrementally on first use.
4. From the app registration **Overview**, copy the **Application (client) ID** and **Directory (tenant) ID** into Settings → Integrations → Microsoft 365, or provide them via the env vars below. No client secret is used or stored — MSAL runs a public-client PKCE flow entirely in the browser.

#### How sign-in works

Sign-in opens a Microsoft pop-up. On success Microsoft redirects the pop-up to the app's dedicated **`/msal-redirect`** route (not the main app), which uses the MSAL v5 [redirect-bridge](https://github.com/AzureAD/microsoft-authentication-library-for-js) (`broadcastResponseToMainFrame`) to hand the response back to the opener over a `BroadcastChannel` and close itself. This route is intentionally minimal so the full app never boots inside the pop-up. Runtime config (Client ID / Tenant ID) is read from Settings first and env vars second, so the integration works without a rebuild.

Troubleshooting (from `window.__aipmDiag()` diagnostics under `msauth.*`):

| Symptom / error | Cause | Fix |
|-----------------|-------|-----|
| `MSAL config not available` | No Client ID from Settings **or** env | Enter Client ID / Tenant ID in Settings → Integrations |
| `AADSTS50011: redirect URI … does not match` | The exact `<origin>/msal-redirect` URI isn't registered | Add it under Authentication → **SPA** (step 2) |
| Pop-up opens but shows the app and never closes | Redirect target isn't the `/msal-redirect` bridge route | Register `<origin>/msal-redirect` and ensure it's reachable |
| `interaction_in_progress`, pop-up won't open | A prior aborted sign-in left MSAL's lock set | Reload the page (the app auto-clears the stale lock on load), or clear `msal.*` keys in Local Storage |

### Timelog

Pull actual time bookings from a Timelog timekeeping account and compare them against the budget. All reads are proxied through a same-origin Next.js route (`/api/timelog`, SSRF-guarded and rate-limited); the host, tenant, and personal token are sent per request and never persisted server-side. The token is **encrypted at rest** (device-wrapped — see [Security Model](#security-model)).

Fetching is two-step so a large organisation stays under the rate limit: **Load people** pulls the Timelog directory only, a filter box narrows it and you tick who you need, then **Fetch bookings** pulls timesheets for the ticked people only. Lists page through all results and retry automatically on rate-limit responses; a loading window shows progress with a **Cancel** button, and **Clear all** resets the fetched data. **Load my projects** loads the projects you are Project Manager for (with an **Include closed projects** option, or a customer picker to load one client's projects) so you can match Timelog people and projects to your resources and budgets before any bookings are fetched. A resource's hours count as booked only when its Timelog user is linked to a resource **and** the booking's project is linked to a budget bucket; **Apply to budget** writes each person's hours into the allocation line they belong to — matched by the line's named resources, else by their role in the directory — so people on different roles are costed at their own rates; hours that match no line are withheld and reported rather than charged to another role, and the confirm step itemises every row it will write. Self-scoped to the token owner by default; org-wide reads require the relevant Timelog privilege.

## Automation / Notifications

The app fires reminders on page load once per session for approaching deadlines, stale RAID items, stakeholder communications, and team birthdays. All reminder types share a unified model: toasts fire by default; banners and pop-ups are opt-in via Settings → Notifications. Each channel (banner, toast, popup) has its own lead-time setting, or you can set a single global lead-time that overrides all channels.

### Task due-date reminders

Tasks approaching or past their due date trigger a reminder. The lead time is shifted to a working day — weekends, public holidays, and recorded absences are skipped forward so you are never reminded on a non-working day. Reminders can be snoozed for 1 hour or 1 day.

### RAID-review reminders

Active RAID items (Risks, Assumptions, Issues, Dependencies) that are past their target date or have not been updated within a configurable review interval trigger a RAID-review reminder. The modal links directly to the overdue item (`#raid/<id>`). Controlled by Settings → Notifications → RAID review; the review interval is configurable in days.

### Stakeholder-communication reminders

A quadrant-based policy maps each stakeholder's Influence/Interest position to a lead time and the categories of items that should prompt a communication nudge:

| Quadrant | Lead time | Sources |
|----------|-----------|---------|
| Manage Closely | 14 days | Milestones, RAID (Medium+), pending Changes |
| Keep Satisfied | 7 days | Milestones, RAID (High+), pending Changes |
| Keep Informed | 7 days | Milestones, pending Changes |
| Monitor | 3 days | Overdue milestones only |

Reminders are generated when: a milestone the stakeholder is RACI-linked to is overdue or within the lead window; an open RAID item linked to the stakeholder meets the severity threshold or is overdue; or a pending Change item is linked to the stakeholder. Requires the Stakeholders feature module to be enabled (Settings → Mode).

### Birthday reminders

Resources with a birthday stored in the address book trigger a toast when the birthday falls within the configured lead window, shifted to the nearest working day.

### Jira-token expiry reminders

When Jira integration is enabled and a token-expiry date is recorded, the app surfaces a sticky banner warning when the token is expiring soon, expired, or has been marked invalid. A separate settings toggle controls the Jira-token banner independently from the main notification channels.

## Sample Workspace

| File | Description |
|------|-------------|
| `sample-workspace-small.json` | Hand-curated demo workspace (master; tasks, RAID, milestones, stakeholders + RACI, budgets, resources, calendar events, a steering committee, dated note logs, a project document with one stored version, and a few demo document links). The source of truth. Descriptions are a deliberate **mix** of formatted HTML and legacy plain text — both shapes are valid at rest, so the sample covers the read-time upgrade path rather than pretending only one exists. |
| `sample-workspace-big.json` | Scaled demo dataset (3× the small content entities), generated via the pure `scaleWorkspace` helper — for testing larger workspaces. |
| `sample-workspace-huge.json` | Scaled demo dataset (10× the small content entities), same generator. |

Regenerate the `-big`/`-huge` tiers with `npx vite-node scripts/generate-sample-workspace.ts` after editing the small master.

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **UI**: React 19, Tailwind CSS 4
- **Language**: TypeScript 5
- **Testing**: Vitest 4 (unit/component, v8 coverage), Playwright (E2E)
- **AI**: Anthropic Claude API (key entered client-side in Settings; encrypted at rest)
- **Optional storage**: Turso (libSQL), Microsoft Graph / SharePoint

## AI Cost & Prompt Caching

This is a bring-your-own-key app — every assistant turn is billed to your own Anthropic account — so what the app sends, and how often it re-sends it, is a first-order design concern rather than an implementation detail.

The dominant cost is not your question. It is the fixed prefix in front of it: the tool definitions the assistant needs to read and write your register, plus the operating-guide text that grounds its answers. Measured on `claude-sonnet-5`, that prefix is 31,101 tokens before you have typed anything.

| Part of the fixed prefix | Tokens |
|---|---|
| Tool definitions | 17,796 |
| System block 0 — fixed instructions plus the always-on guides | 13,305 |
| **Total** | **31,101** |

Sent naively, you pay for all of that on every single turn. The app instead lays the request out so the provider serves the prefix from its prompt cache:

| Token class | Price, relative to base input |
|---|---|
| Input (uncached) | 1 |
| Cache write | 1.25 |
| **Cache read** | **0.1** |
| Output | 5 |

That 0.1 is the whole point. A cached prefix is not skipped — it is still read, and still billed — but at a tenth of a fresh input token, which turns the largest term in a turn into something close to a rounding error. Writing the cache costs 1.25, so the arrangement pays for itself on the second turn. These ratios hold across the model tiers the app supports, and they are also what the advisory usage caps weight by (see the AI assistant row in [docs/features.md](docs/features.md)).

### How the layout works

A cache hit needs a byte-identical prefix, and the provider matches it in a fixed order: tools, then system, then messages. Anything that varies per turn must therefore sit *after* everything you want cached — one per-turn value placed early makes the entire transcript uncacheable. So the prompt is split along that seam:

- `buildStableSystemBlocks` (`chat-api.ts`) returns the cacheable half of the system prompt. Block 0 — the fixed instructions plus the always-on leadership guide and app overview — is byte-identical whichever view you are in, and carries the cache marker. Block 1 is the current view's feature guide, present only when non-empty.
- `buildTurnContext` returns the volatile suffix — the current mode, view, groups and labels — as a plain string, rebuilt every turn.
- `buildWireMessages` (`chat-cache-layout.ts`) injects that turn context into the *outgoing copy* of the message array only. It is never persisted: storing it would rewrite the tail of the saved history on every send and break the byte-identical prefix the cache depends on.
- `toolsFor` returns one cached tool array per tool-flag combination, and `withCacheBreakpoint` marks only the last definition, so the tool block caches as a unit.

A request may carry four cache breakpoints, and this layout spends up to four: one on the tools, one on system block 0, and up to two in the messages — a moving boundary that follows the conversation, plus a fixed power-of-two anchor so a long conversation does not lose the cache to the provider's lookback window. The two land on the same message whenever the cached prefix length is itself a power of two, and are deduplicated into one there — so a request in that state spends three.

### What it bought, and what it cost

- **0.295.0 "Borges"** — the chat transcript is sent as a stable cacheable prefix instead of being rebuilt each turn, and the usage meter was corrected to count every billed token class rather than only input and output.
- **0.296.0 "McHugh"** — the always-on guides moved into their own cached block, so switching view mid-conversation no longer re-sends that text. Measured live: a view-switching conversation cost about **52% less** over the measured turns and **78% less** on the switch itself, while a conversation that never switches view cost about **0.5% more**. The extra block boundary is not free and the never-switching case pays for it; the trade was taken deliberately — half the cost on a realistic conversation, against a fraction of a percent on the ideal one.
- **0.298.0 "Malzberg"** — usage caps weight token classes by the real billing ratios above instead of counting every token equally.

### Prompt-quality harness

The remaining cost ideas all work by removing prompt text or relocating it, and every one of them risks the model quietly no longer reading something. Cheaper output that is also worse is not a saving. Until now the only evidence was a single hand-run evaluation that scored full marks on every probe — it had no headroom, and could only ever have caught a catastrophic regression.

The harness is a developer guard on future cost work, not something users interact with. It plants a unique nonsense token in one prompt block and a decoy in a different block, then asks the model to return the target, exactly as written; a hit is evidence that the block was actually read, and returning the decoy is a miss rather than an alternative answer. It runs interleaved arms — the current layout, a candidate layout, a negative control, and two drift references — so a score move can be attributed to the change rather than to the model shifting underneath the measurement. The candidate arm is at present a deliberate alias of the current layout: until a gated slice registers a real variant there is no second layout to compare against.

A full run is **65 requests** — that figure is measured. The cost, on the order of **$2** against a mostly-cached prefix, is modelled rather than measured: the app deliberately ships no price table, so nothing in this repo turns a run's token counts into a currency amount. A dry run is the default and spends nothing; spending requires an explicit opt-in, and the harness refuses to spend when it detects a CI environment. It exits **0** on pass, **1** on a real regression, and **2** when it could not do its job — the 1/2 split is deliberate, because a broken measurement must never be reported as a failure of the thing being measured, and a run that measured nothing must never report success.

**Status:** the harness has been run against the live API and carries a recorded baseline in `docs/baselines/ai-eval-runs.json` — read that artifact rather than this sentence, which cannot keep up with it. Any pass it records is an A/A self-test of the machinery and not evidence about a candidate layout, because the candidate arm is still an alias of the current one — it shows the harness measures what it claims to, not that any relocation is safe.

## Environment Variables & Security

No environment variables are **required** — all integrations work via in-app Settings. These optional build-time variables pre-configure integrations:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_MSAL_CLIENT_ID` | Microsoft Entra app client ID (overrides Settings → Integrations input) |
| `NEXT_PUBLIC_MSAL_TENANT_ID` | Microsoft Entra tenant ID (overrides Settings → Integrations input) |
| `NEXT_PUBLIC_TURSO_DATABASE_URL` | Turso database URL (overrides Settings → Integrations input) |
| `NEXT_PUBLIC_TURSO_AUTH_TOKEN` | Turso auth token (overrides Settings → Integrations input); **recommend a scoped token** |

> ⚠️ **Security:** When entered in Settings, the Anthropic API key and Turso auth token are **encrypted at rest** (AES-256-GCM; see [Security Model](#security-model)). A Turso token supplied via `NEXT_PUBLIC_TURSO_AUTH_TOKEN` is different — `NEXT_PUBLIC_*` env vars are **inlined into the build at compile time and are not secret**, so prefer a database/operation-scoped token there and rotate it if it may have been exposed. The Jira and Timelog API tokens are likewise **encrypted at rest**; their identifying fields (Jira site URL & email; Timelog host, tenant & email) are stored in `localStorage` unencrypted (identifying, not secret).

## Security Model

This is a **local-first, bring-your-own-key** application. There is no application server holding accounts or secrets: you supply your own credentials in Settings, and they stay in your browser. That makes the browser profile the security boundary — the trade-off is deliberate.

### What is stored where

| Data | Location |
|------|----------|
| **Anthropic API key, Turso auth token, Jira & Timelog API tokens** | **Encrypted at rest** — AES-256-GCM ciphertext in `localStorage["aipm-cockpit:secrets"]`; these fields are blanked from the settings blob before it is written. The wrapping key is a non-extractable WebCrypto **device key** in IndexedDB by default. The Anthropic key and Turso token additionally support a **per-secret passphrase** (PBKDF2, 600k iterations) that keeps the value sealed until you unlock it; the Jira and Timelog tokens are device-wrapped only |
| Jira site URL + email, Turso database URL, all other settings | `localStorage["aipm-cockpit:settings"]`, **unencrypted** (the Jira site URL and email are identifying, not secret) |
| Device key (wraps the secrets above) | IndexedDB DB `aipm-cockpit-secrets`, non-extractable |
| Workspace data (tasks, RAID, changes, milestones, stakeholders, …) | `IndexedDB` on the default Browser backend, or whichever storage backend you configure |

If WebCrypto / IndexedDB is unavailable the app degrades to holding the secrets in memory rather than crashing. Credentials are deliberately excluded from workspace exports (JSON/CSV/Markdown), the activity log, and console output; the secrets ciphertext is likewise excluded from exports and never written to Turso.

### What leaves the browser

- **AI chat** — chat messages, the workspace data the assistant reads, and your API key are sent directly from the browser to `api.anthropic.com`; there is no proxy in between.
- **Jira** — credentials and issue data go to the same-origin `/api/jira/*` proxy, which forwards them only to `*.atlassian.net` (SSRF allowlist) and persists nothing server-side.
- **Turso** — workspace data and the auth token go to your own Turso/libSQL database over HTTPS.
- **Microsoft 365** — Graph calls authenticate with MSAL-issued tokens; the app never handles your Microsoft password.

### Recommendations

- Use dedicated, minimally scoped credentials: an Anthropic API key with a spend limit, a Jira API token with an expiry date, and a Turso token scoped to a single database.
- Do not use this app with production credentials on shared or untrusted machines — anyone with access to the browser profile can read every stored credential.
- Rotate or revoke credentials when a machine changes hands or a key may have been exposed.

## Further reading

This README is the product overview and the operational reference. The documents
below carry the rest, and each owns its subject outright rather than restating
this one:

| Document | What it owns |
|----------|--------------|
| [docs/features.md](docs/features.md) | The complete feature list — every capability the app ships, one row each, with the full description behind an expandable **Details** block. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, the full script table, project layout, conventions, the testing layers, code style, and the pull-request checklist. |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Operations: build and deploy, hosting options, security headers, rollback, secrets, monitoring, and a symptom-indexed list of common issues. |
| [docs/CODEMAPS/](docs/CODEMAPS/) | Five layered overviews of the codebase — architecture, frontend, backend, data, and dependencies. |
| [AGENTS.md](AGENTS.md) | The always-loaded engineering reference: the hard CI-enforced constraints and the landmines that have already cost someone a debugging session. |

## License

European Union Public Licence v1.2 (EUPL-1.2) — see the [LICENSE](./LICENSE) file for the
full text, also available at the [European Commission](https://interoperable-europe.ec.europa.eu/collection/eupl/eupl-text-eupl-12).
