# AIPM Project Management Tracker

[![Pipeline Status](https://gitlab.example.com/example-group/public-collab/lop-app/badges/main/pipeline.svg)](https://gitlab.example.com/example-group/public-collab/lop-app/-/commits/main)
[![coverage](https://gitlab.example.com/example-group/public-collab/lop-app/badges/main/coverage.svg)](https://gitlab.example.com/example-group/public-collab/lop-app/-/commits/main)
[![version](https://img.shields.io/badge/version-v0.124.0_%22Pratchett%22-2e7d32)](./CHANGELOG.md)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

> A project-command surface for project leads with a context-aware Claude copilot that knows your current view and is grounded in your operating guides. It plugs into Microsoft 365 (Outlook contacts & calendar, SharePoint documents) and syncs bidirectionally with Jira — so it accelerates your existing workflow instead of becoming another place to maintain data. Local-first; no backend account required.

---

## Overview

A single-page Project Management Tracker built for project leads who maintain a "List of Open Points" (LOP). Manage open points and track accountability, plan resource capacity and cost, keep a stakeholder register, run RAID and change-control logs, manage a portfolio of projects, and monitor project health — all in the browser. **All data is stored locally by default — no backend account required.**

Core workflow:

1. Add tasks with assignee, due date, and priority
2. Filter, sort, and view tasks in a table or Gantt chart
3. Ask the integrated Claude AI assistant to create, update, or summarize tasks in natural language
4. Send pre-filled status-inquiry emails to assignees with one click
5. Export the task list to CSV, Markdown, PDF, DOCX, XLSX, or PPTX
6. Optionally sync tasks bidirectionally with a Jira project
7. Track RAID and change-control items and create reports for the steering committee
8. Plan capacity, utilization, availability, and cost rates while accounting for holidays
9. Run a portfolio of projects, each with its own workspace and metadata header

### A copilot that knows your project — not another data silo

Two things set the tracker apart: it has an AI copilot that understands the project you're looking at, and it plugs into the stack you already use instead of becoming one more place to maintain data.

**(1) An AI copilot that knows your project.** A context-aware Claude assistant that knows your current view and mode and is grounded in your operating guides — so it gives advice that fits *this* project, not generic chatbot answers. Per-view **"Ask Claude"** suggestions and one-tap foundational prompts ("What's next?", a status overview, "prioritize") mean the tool tells you what to do next, and it can act on it: create, update, and summarize across the whole register (tasks, RAID, changes, milestones, stakeholders) in natural language via tool calls, with a live token-usage panel, a Stop button, and a pop-out mirror. The AI reaches further into the workflow too — **describe a project** (or import one from a file, SharePoint, or a Confluence page) to pre-fill the create wizard, **"Analyze with AI"** in the Action Center for a triage of the queue, and opt-in **scheduled portfolio-analysis jobs**. The **Action Center** complements this by ranking live project data into next-best-actions, and that ranking **learns** from how you respond (act / snooze / dismiss).

**(2) Plugs into your existing stack (M365 + Jira).** It pulls people in from your Outlook contacts, imports calendar events as absences and pushes milestones back to Outlook, attaches documents straight from SharePoint, and keeps tasks in lockstep with Jira through **bidirectional sync** — so you accelerate your existing workflow instead of re-keying the same data into yet another tool.

## Features

Each row keeps a one-line summary. Expand **Details** for the full description.

| Feature | Description |
|---------|-------------|
| Multi-project portfolio | Manage many projects from one app — each project is a full, independent workspace with a metadata header.<br><details><summary>Details</summary>Every project carries its own header (client, NACE sector, deployment model, identity types, regulatory requirements, internal/external key stakeholders). Switch projects from the top-bar switcher; create, edit, archive/restore, and permanently delete them. Hard-delete requires typing the project name into a confirm dialog. **File mode** keeps a local registry of per-project files; **Turso mode** stores every project in one shared multi-tenant database (the database is the source of truth for the project list). The global File ↔ Turso switch lives in Settings → Integrations. Export operates on the current project.</details> |
| Task management | Create, edit, delete, bulk-edit, and filter by priority / assignee / group / label, with a workflow status and a Table/Board (Kanban) toggle.<br><details><summary>Details</summary>Effort fields (Original estimate & Time spent in w/d/h/m, Jira basis 1w=5d 1d=8h) with hideable/sortable Est./Spent columns and an inline effort progress bar. Per-field inline validation reveals errors on blur/submit and disables Save until the form is valid. A six-state **workflow status** (To Do / In Progress / On Hold / In Review / Cancelled / Done) is the source of truth for completion (`completedDate` is auto-managed); Cancelled tasks are terminal but excluded from overdue flags and metrics, and a "Hide finished" toggle hides Done + Cancelled. Switch the Open Points view between a sortable table and a **Kanban board** — drag a card between status columns or use the per-card status select; Jira-synced tasks derive their status from the Jira status category and are read-only until the next sync.</details> |
| Gantt chart | Visual timeline with drag-and-drop reorder and dependency arrows.<br><details><summary>Details</summary>Clicking a task name opens the task editor. Milestone overlays appear when the Milestones module is enabled; an inline add-milestone control creates milestones directly on the chart.</details> |
| Task dependencies | FS / SS / FF / SF predecessor relationships with cycle detection.<br><details><summary>Details</summary>Dependencies are validated on save — circular chains are rejected before they can be persisted.</details> |
| Groups & labels | Categorize tasks freely; filter by group or label. |
| AI assistant (Claude) | Context-aware Claude assistant — knows your current view/mode, is grounded in operating guides, and offers per-view "Ask Claude" prompts; ask questions or create/update tasks in natural language (user-supplied API key, Settings → AI).<br><details><summary>Details</summary>Per-view "Ask Claude" suggestions and one-tap foundational prompts (what's next, status overview, prioritize); the assistant is grounded in your operating guides and the current view/mode. Includes a live token-usage panel, a Stop button to interrupt a running response, and a pop-out window. The pop-out is a read-only mirror — its tools cannot mutate data. Claude can create, update, delete, and summarize across the whole register — tasks, RAID items, change-control items, milestones, and stakeholders — via tool calls, each routed through its sanitizer. **Document ingestion:** attach a PDF, image, or text file and Claude reads it natively (no parsing dependency) to extract and create records on request.</details> |
| AI project assistance | Describe-to-create projects, create-from-source import, Action Center "Analyze with AI", scheduled portfolio-analysis jobs, and AI-suggested next-action weights.<br><details><summary>Details</summary>**Use AI** (create wizard): write a plain-language brief and Claude proposes the project setup (name, dates, products, feature modules) plus optional starter content, pre-filling the 3-step wizard for review — nothing is written until you create. **Create from a source:** upload a file (PDF/image/text), pick a SharePoint document, or paste a Confluence page URL (fetched via a same-origin proxy reusing your Atlassian credentials) and Claude pre-fills the details. **Analyze with AI** (Action Center): one Claude call returns a triage summary of the action queue plus net-new advisory actions — advisory only, the deterministic engine is unchanged. **Scheduled jobs:** opt-in recurring portfolio-analysis jobs (daily/weekly) that run while the app is open (on load, re-focus, and a light interval) and catch up on next open; results surface as a desktop notification and a per-job run history (no server cron; advisory only; each run is a billed call, so off by default). **Suggest with AI** (next-actions settings): proposes confidence-weight (and optionally threshold) adjustments from your project, snapshot trends, and act/snooze/dismiss history — review each row's rationale and Accept; values are always clamped to safe bounds.</details> |
| Steering committee | Record the committee name, its members (linked to resources), the meeting schedule, and information-pack rules.<br><details><summary>Details</summary>Each meeting carries a date, title, agenda, and location; "information schedule" rules set how many working days before each meeting a pack should circulate. The resulting pack reminders appear in the Action Center, and the committee's meetings plus reminder due-dates can be pushed to your Outlook calendar (re-pushing never duplicates).</details> |
| Timezones | Per-project operating timezone and a per-device default, with timezone-aware day-boundary logic and timestamp display in a chosen zone.<br><details><summary>Details</summary>Set a per-project timezone and a per-device default (plus a list of additional zones); what counts as overdue, due today, or due soon follows the resolved timezone instead of UTC. A top-bar switcher renders timestamps in the activity log, version history, and trends in a display timezone (Default / UTC / your additional zones); the choice applies for the session and resets on reload. The Calendar view shows a live multi-timezone "world clock" strip when extra zones are configured.</details> |
| Guided tour & demo | A first-run walkthrough of the main areas, a one-click "Explore a demo project", and a "Take the tour" Help-menu entry to replay it.<br><details><summary>Details</summary>Per-device; the tour runs in the modern layout only (not classic or pop-outs). "Explore a demo project" loads the sample workspace so you can try the app with realistic data.</details> |
| Installable PWA | Install the tracker as a standalone desktop/mobile app via a web manifest + minimal service worker.<br><details><summary>Details</summary>The service worker does no caching — every request goes to the network, so installed copies never serve stale bundles. Periodic Background Sync (running scheduled jobs while closed) is intentionally not included; the baseline runs due jobs when you next open the app.</details> |
| Voice commands | Speak commands in English or German (Web Speech API). |
| Reports | Summary view with overdue, due-soon, and completion stats.<br><details><summary>Details</summary>Addable report cards (Stakeholder, RAID, Resource, Budget, and more) built on a shared sortable/filterable/resizable report table; each card prints on its own.</details> |
| RAID register | Risks / Assumptions / Issues / Dependencies log with parent/child cycle detection and true deep-linking (`#raid/<id>`).<br><details><summary>Details</summary>Sortable/filterable table, severity and status tracking, optional links to stakeholders, and RAID-review reminders for stale or overdue items.</details> |
| Change Log | RAID-sibling change-control register with a 6-state approval workflow.<br><details><summary>Details</summary>Proposed → Implemented / Deferred, with impact rating, schedule-day and cost figures, an optional Change → RAID link, optional stakeholder links, and a printable Change Report that feeds the Scope RAG on the dashboard.</details> |
| Stakeholder register | Sortable/filterable register with a RACI matrix (per stakeholder × milestone), Influence/Interest grid, and engagement-level tracking.<br><details><summary>Details</summary>A quadrant-based engagement policy drives stakeholder-communication reminders from due-soon milestones, open RAID items, and pending changes the stakeholder is linked to (see Automation / Notifications).</details> |
| Resource planner & address book | Address book (name, title, contact, birthday), two-dimensional roles (discipline × grade) with internal/external rates, absences, and a per-period utilization planning grid.<br><details><summary>Details</summary>Rolls up into capacity, cost, and margin. Sub-views: Directory, Workload, Calendar, Planning, and Manage Roles. Birthdays drive optional reminders; absences feed working-day calculations across the app.</details> |
| Budget planner | PO-line budget buckets (T&M / fixed-price) with per-role allocations, CCI, and win/loss with spillover.<br><details><summary>Details</summary>Detailed (per-role) or blended (per-discipline, average grade rate) planning per bucket; multi-currency via ECB FX rates with per-rate EUR overrides; a dedicated read-only Budget Report.</details> |
| Milestones | Timeline of project milestones with status classification, name/status filters, and resizable columns.<br><details><summary>Details</summary>Milestones overlay the Gantt chart, anchor the RACI matrix, and feed Schedule-RAG and stakeholder-communication reminders.</details> |
| Dashboard | Project-health RAG status with lettered badges, burn-down charts, milestones, and Earned Value SPI/CPI.<br><details><summary>Details</summary>EVM indices feed the Schedule/Budget RAGs (CPI fills the Budget pill even without budget buckets). Configurable thresholds, print-friendly RAG captions, and a Clear button. Module-specific pills hide when their feature module is disabled.</details> |
| Action Center | Ranked next-best-actions derived from live project data, each with an executable CTA.<br><details><summary>Details</summary>The engine turns due tasks, at-risk RAID, milestone drift, schedule/budget slippage, and stakeholder-comms signals into a ranked queue. Each row carries a one-click CTA — create task, assign owner, draft message, escalate, or re-baseline — plus optional desktop notifications. An **opt-in learning layer** adapts the ranking from how you respond to each kind of action (act / snooze / dismiss); the bias is bounded and safety-floored so urgent items are never hidden, and a Learning Insights view shows what has been learned. Learning is off by default and resettable.</details> |
| Activity log | Browser-local chronological record of task / RAID / absence / shift CRUD with text / wildcard / regex search.<br><details><summary>Details</summary>Includes a "general" activity group for events that don't belong to a specific entity, plus a Clear-with-confirm action and a print button.</details> |
| Baseline / variance trends (Turso) | Periodic KPI snapshots into append-only Turso tables; a Trends view shows baseline-vs-current variance and KPI trend charts.<br><details><summary>Details</summary>Snapshots are scoped per project under Turso multi-tenancy. The Trends view shows the snapshot list, lets you set a baseline, and surfaces a config-incomplete warning when capture cannot run.</details> |
| Version history (Turso) | Per-project, append-only history of full-workspace versions; a History view lets you compare versions and selectively restore.<br><details><summary>Details</summary>Versions are captured automatically (idle-debounced; rapid autosaves coalesce, identical payloads are skipped) plus on-demand named checkpoints. Compare a version against the current data, or tick two versions to diff them against each other — a field-level diff grouped by entity type (tasks, RAID, milestones, resources, budget, …), each record expanding before→after. From a "compared with current" view, tick whole records or individual fields and Restore selected; restore is non-destructive (it applies to current data, is captured as a new version, and is recorded in the activity log). Auto-versions are pruned to a configurable retention (Settings → "Version history: keep N versions"; minimum 50, steps of 10); named checkpoints are never pruned. Turso backend only, and shown only while the History feature module is enabled.</details> |
| Information flows | A diagram of information flows between stakeholders and the project. |
| Feature modes | Simple / Modular / Advanced mode gates navigation, automation, dashboard, and reports via toggleable feature modules.<br><details><summary>Details</summary>Ten feature modules can be switched on or off (Settings → Features); Save applies the set and reloads. Disabled modules retain their data but pause automation and hide their UI.</details> |
| Layout & theme | Modern Dark-Blue sidebar layout (default) with grouped navigation and full-viewport content; Classic single-scroll mode toggle; Light / Dark / System theme.<br><details><summary>Details</summary>Drag-resizable panes throughout, a centered half-size chat pane, and an icon rail for narrow viewports. Toggle layout in Settings → Appearance → Layout.</details> |
| Field visibility | Per-editor Simple / Advanced / Full field views with a cog to show or hide individual fields (default Advanced).<br><details><summary>Details</summary>Every entity editor (task, RAID, change, milestone, stakeholder, resource, absence, budget) carries its own view switch and per-field overrides, persisted per project across all storage backends. Required fields are always shown, and hiding a field never deletes its data.</details> |
| Project templates | A cross-project library of reusable project templates (3 built-in starters + save-current-as-template) bundling a feature mode, field-visibility config, and optional starter content.<br><details><summary>Details</summary>Manage saved templates (list, rename, duplicate, delete) in Settings → Templates; built-ins are read-only. "Apply template" from the actions menu sets the project's field visibility and optionally appends the template's starter content with re-id'd entities — applying is non-destructive, so existing items are kept. User templates are persisted in settings.</details> |
| Per-project functions | Each project keeps its own set of enabled functions (modules), switchable without a page reload.<br><details><summary>Details</summary>Enabled modules are stored on the project, not globally; switching projects applies that project's functions reactively so the navigation and automation update instantly. Configure them in Settings → Mode (applies to the current project) or in the 3-step project-creation wizard (Details → Template → Functions), where a template can preset them. Persisted across the default IndexedDB backend and multi-project Turso mode.</details> |
| Template suggestion | When creating a project, the wizard recommends and preselects the best-fit template by scoring the project's team size, regulatory needs, deployment, timeline, and scale, and shows why it fits — you can still pick any other template or start Blank. |
| Input feedback | Character counters on capped text fields; on-blur clamp notices on numeric fields; a save-time summary toast when entries were adjusted. |
| Export | Configurable multi-section export to CSV, Markdown, PDF (print), DOCX, XLSX, and PPTX.<br><details><summary>Details</summary>Per-section toggles (tasks, RAID, changes, milestones, stakeholders, budgets, resources, project metadata) control what each export contains; PDF renders all enabled sections. The storage round-trip (load/save) stays byte-identical regardless of export configuration.</details> |
| Localization | English (US / UK) and German. |
| Printing | Scoped print — printing a report prints just that view (sidebar, banners, and other panes are hidden). |
| SharePoint document links | Attach SharePoint files and folders to tasks, RAID items, changes, stakeholders, milestones, and projects via a built-in browser.<br><details><summary>Details</summary>A custom Microsoft Graph browser (search sites, navigate libraries/folders, pick a file or folder) replaces blind URL paste. Links open in a new tab and round-trip losslessly across all storage backends. Requires M365 sign-in; the "Browse…" button also appears in the SharePoint storage-backend config.</details> |
| Documents tab | A single view that aggregates every linked document across the project.<br><details><summary>Details</summary>Lists every link carried by tasks, RAID items, changes, milestones, stakeholders, and the project header in one table: open a link in a new tab, jump to its source item's editor, remove it, or attach a new one to any item via the same SharePoint picker / paste-URL field. Links stay on their source items (no separate store), so removing a link here is identical to removing it from that item's editor.</details> |
| Encrypted secrets at rest | The Anthropic API key, Turso auth token, and Jira API token are encrypted in the browser with AES-256-GCM rather than stored in plain text.<br><details><summary>Details</summary>Ciphertext lives in `localStorage["lop-app:secrets"]` and each field is blanked from the settings blob before it is persisted. The wrapping key is a non-extractable WebCrypto **device key** kept in IndexedDB by default; the Anthropic key and Turso token can optionally take a **passphrase** (PBKDF2, 600k iterations) so the value stays sealed until you unlock it (the Jira token is device-wrapped only). The ciphertext is excluded from workspace exports and never written to Turso. See [Security Model](#security-model).</details> |

## Quick Start

### Prerequisites

- **Node.js ≥ 20.9.0** (the CI image is `node:20`). Check with `node --version`.
- **npm** (ships with Node.js).

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

### Development Scripts

<!-- AUTO-GENERATED from package.json scripts -->
| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server with hot reload on http://localhost:3000 |
| `npm run build` | Production build — runs TypeScript type-check, then emits `.next/` |
| `npm run start` | Serve the production build (run `npm run build` first) |
| `npm run lint` | Run ESLint (`eslint-config-next` preset) |
| `npm run test` | Vitest unit/component tests in watch mode |
| `npm run test:run` | Vitest, single run (CI-friendly) |
| `npm run test:coverage` | Vitest + v8 coverage report (thresholds: lines 90 / statements 87 / functions 89 / branches 78) |
| `npm run e2e` | Playwright functional E2E (smoke + app nav + a11y), headless — the CI suite |
| `npm run e2e:ui` | Playwright interactive UI mode |
| `npm run e2e:smoke` | Standalone smoke driver (scripts/e2e-smoke.mjs): seeds a project, walks every view, fails on any console/page error. Needs a running server |
| `npm run e2e:visual` | Playwright visual-regression snapshots (opt-in; baselines are per-platform — generate CI's in the Linux container) |
| `npm run e2e:visual:update` | Regenerate visual snapshot baselines for the current platform |
| `npm run e2e:install` | One-time: download Chromium browser binary |
| `npm run docs:scripts` | Regenerate AUTO-GENERATED scripts tables in repo docs from `package.json` |
| `npm run docs:scripts:check` | Verify AUTO-GENERATED scripts tables are in sync; exit non-zero on drift (CI mode) |
<!-- END AUTO-GENERATED -->

## Storage Backends

The active backend is chosen in Settings → Integrations / Storage Configuration. Switching backends migrates the current workspace into the new one.

| Backend | Description | When to use |
|---------|-------------|-------------|
| Browser (default) | `IndexedDB` (schema v6) for workspace entities; `localStorage` for settings. | The zero-setup default. Use it for a single person on one machine — data survives page refresh but lives only in that browser profile. |
| Local JSON / CSV / Markdown | File System Access API — reads and writes a local file you pick. | When you want a portable file you control (commit to git, drop in a shared drive, diff by hand). Markdown/CSV are human-readable; JSON is the complete round-trip. |
| SharePoint JSON / CSV | Workspace as a single JSON or CSV blob in a SharePoint document library via Microsoft Graph; requires M365 sign-in. | When the team already lives in Microsoft 365 and you want the workspace stored alongside other project documents. |
| Turso (libSQL) | Relational schema (one table per entity) via the Turso HTTP `/v2/pipeline` API; works with Turso Cloud and a local/self-hosted `tursodb`. | For multi-device or multi-project use — relational queries, baseline/variance trends, and the shared multi-tenant database that backs the portfolio in Turso mode. |

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

## Integrations

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

Bidirectional sync with conflict resolution is available from the Jira settings section. The API token is **encrypted at rest** (AES-256-GCM device-wrapped, like the Anthropic key and Turso token — see [Security Model](#security-model)); the site URL and email are stored in `localStorage` unencrypted (identifying, not secret). Credentials are sent only to your own Atlassian domain.

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

1. Register an app in [Microsoft Entra admin center](https://entra.microsoft.com/) as a single-page application (SPA).
2. Add a redirect URI: `http://localhost:3000` for dev, or your production URL.
3. Grant API permissions: `Contacts.Read`, `Calendars.Read`, `Calendars.ReadWrite` (milestone write-back), `Files.ReadWrite.All`, `Sites.Read.All` (or narrower equivalents — grant only the scopes for the features you use).
4. Copy the **Client ID** and **Tenant ID** into Settings → Integrations, or provide them via the env vars below.

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

Reminders are generated when: a milestone the stakeholder is RACI-linked to is overdue or within the lead window; an open RAID item linked to the stakeholder meets the severity threshold or is overdue; or a pending Change item is linked to the stakeholder. Requires the Stakeholders feature module to be enabled (Settings → Features).

### Birthday reminders

Resources with a birthday stored in the address book trigger a toast when the birthday falls within the configured lead window, shifted to the nearest working day.

### Jira-token expiry reminders

When Jira integration is enabled and a token-expiry date is recorded, the app surfaces a sticky banner warning when the token is expiring soon, expired, or has been marked invalid. A separate settings toggle controls the Jira-token banner independently from the main notification channels.

## Sample Workspace

| File | Description |
|------|-------------|
| `sample-workspace-small.md` / `.csv` | Hand-curated demo workspace (tasks, RAID, milestones, stakeholders + RACI, budgets, resources, and a few demo document links). The `.md` is the source of truth. |
| `sample-workspace-small.json` | Complete demo workspace generated from the `.md` (adds a demo change-log + RAID→stakeholder links) via `npx vite-node scripts/generate-sample-workspace.ts`. |
| `sample-workspace-small.sqlite3` | The same workspace as a Turso-compatible SQLite database (multi-tenant, schema v12). Import with `turso db create lop-demo --from-file sample-workspace-small.sqlite3`, then configure the URL and token in Settings → Integrations. |
| `sample-workspace-big.{json,sqlite3}` | Scaled demo dataset (3× the small content entities) generated by the same script via the pure `scaleWorkspace` helper — for testing larger workspaces. |
| `sample-workspace-huge.{json,sqlite3}` | Scaled demo dataset (10× the small content entities), same generator. |

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **UI**: React 19, Tailwind CSS 4
- **Language**: TypeScript 5
- **Testing**: Vitest 4 (unit/component, v8 coverage), Playwright (E2E)
- **AI**: Anthropic Claude API (key entered client-side in Settings; encrypted at rest)
- **Optional storage**: Turso (libSQL), Microsoft Graph / SharePoint

## Environment Variables & Security

No environment variables are **required** — all integrations work via in-app Settings. These optional build-time variables pre-configure integrations:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_MSAL_CLIENT_ID` | Microsoft Entra app client ID (overrides Settings → Integrations input) |
| `NEXT_PUBLIC_MSAL_TENANT_ID` | Microsoft Entra tenant ID (overrides Settings → Integrations input) |
| `NEXT_PUBLIC_TURSO_DATABASE_URL` | Turso database URL (overrides Settings → Integrations input) |
| `NEXT_PUBLIC_TURSO_AUTH_TOKEN` | Turso auth token (overrides Settings → Integrations input); **recommend a scoped token** |

> ⚠️ **Security:** When entered in Settings, the Anthropic API key and Turso auth token are **encrypted at rest** (AES-256-GCM; see [Security Model](#security-model)). A Turso token supplied via `NEXT_PUBLIC_TURSO_AUTH_TOKEN` is different — `NEXT_PUBLIC_*` env vars are **inlined into the build at compile time and are not secret**, so prefer a database/operation-scoped token there and rotate it if it may have been exposed. The Jira API token is likewise **encrypted at rest**; the Jira site URL and email are stored in `localStorage` unencrypted (identifying, not secret).

## Security Model

This is a **local-first, bring-your-own-key** application. There is no application server holding accounts or secrets: you supply your own credentials in Settings, and they stay in your browser. That makes the browser profile the security boundary — the trade-off is deliberate.

### What is stored where

| Data | Location |
|------|----------|
| **Anthropic API key, Turso auth token, Jira API token** | **Encrypted at rest** — AES-256-GCM ciphertext in `localStorage["lop-app:secrets"]`; these fields are blanked from the settings blob before it is written. The wrapping key is a non-extractable WebCrypto **device key** in IndexedDB by default. The Anthropic key and Turso token additionally support a **per-secret passphrase** (PBKDF2, 600k iterations) that keeps the value sealed until you unlock it; the Jira token is device-wrapped only |
| Jira site URL + email, Turso database URL, all other settings | `localStorage["lop-app:settings"]`, **unencrypted** (the Jira site URL and email are identifying, not secret) |
| Device key (wraps the secrets above) | IndexedDB DB `lop-app-secrets`, non-extractable |
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

## License

Apache 2.0 — see the [LICENSE](./LICENSE) file for the full text.
