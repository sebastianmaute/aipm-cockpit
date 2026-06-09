# AIPM Project Management Tracker

[![Pipeline Status](https://gitlab.example.com/example-group/public-collab/lop-app/badges/main/pipeline.svg)](https://gitlab.example.com/example-group/public-collab/lop-app/-/commits/main)
[![coverage](https://gitlab.example.com/example-group/public-collab/lop-app/badges/main/coverage.svg)](https://gitlab.example.com/example-group/public-collab/lop-app/-/commits/main)

**v0.56.0 "Bradbury"** — AI-assisted project-status tracker for Acme project leads. Manage open points, track accountability, plan resource capacity and cost, keep a stakeholder register, manage RAID and change-control logs, and monitor project health — all in the browser, no backend account required.

---

## Automation: Reminders and Alerts

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

---

## Integrations

### Jira

The app includes a server-side proxy layer for Jira Cloud. All browser-to-Jira traffic goes through Next.js API routes — credentials are sent in the POST body per request and are never persisted server-side.

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

Bidirectional sync with conflict resolution is available from the Jira settings section. Credentials (site URL, email, API token) are stored in `localStorage` and sent only to your own Atlassian domain.

### Microsoft 365

Microsoft 365 features use MSAL (browser PKCE — no backend token exchange) and the Microsoft Graph API. The integration is off by default; enable it in Settings → Integrations.

| Feature | Graph scope | What it does |
|---------|-------------|--------------|
| Outlook contacts import | `Contacts.Read` | Imports personal contacts from `/me/contacts` into the Resource Directory and assignee address book via a preview-and-pick dialog; updates existing entries by email |
| Outlook calendar import | `Calendars.Read` | Imports all-day Out-of-Office events from `/me/calendarView` as Absences via a preview-and-pick dialog with a per-row absence-type selector |
| SharePoint storage | `Sites.ReadWrite.All` | Stores the workspace as a single JSON or CSV blob in a SharePoint document library; URL configured in Settings → Integrations / Storage Configuration |

#### Setup

1. Register an app in [Microsoft Entra admin center](https://entra.microsoft.com/) as a single-page application (SPA).
2. Add a redirect URI: `http://localhost:3000` for dev, or your production URL.
3. Grant API permissions: `Contacts.Read`, `Calendars.Read`, `Sites.ReadWrite.All` (or narrower equivalents).
4. Copy the **Client ID** and **Tenant ID** into Settings → Integrations, or provide them via the env vars below.

---

## What It Does

A single-page task manager built for project leads who maintain a "List of Open Points" (LOP). Core workflow:

1. Add tasks with assignee, due date, and priority
2. Filter, sort, and view tasks in a table or Gantt chart
3. Ask the integrated Claude AI chat to create, update, or summarize tasks in natural language
4. Send pre-filled status-inquiry emails to assignees with one click
5. Export the task list to CSV, Markdown, PDF, DOCX, XLSX, or PPTX
6. Optionally sync tasks bidirectionally with a Jira project
7. Track RAID items and create reports for the steering committee
8. Plan capacity, utilization, availability, and cost rates while accounting for holidays

All data is stored locally by default — no backend account required.

## Features

| Feature | Description |
|---------|-------------|
| Task management | Create, edit, delete, bulk-edit, filter by priority / assignee / group / label; effort fields (Original estimate & Time spent in w/d/h/m, Jira basis 1w=5d 1d=8h) with hideable/sortable Est./Spent columns and an inline effort progress bar |
| Gantt chart | Visual timeline with drag-and-drop reorder and dependency arrows; clicking a task name opens the task editor |
| Task dependencies | FS / SS / FF / SF predecessor relationships with cycle detection |
| Groups & labels | Categorize tasks freely; filter by group or label |
| AI chat (Claude) | Ask questions or create/update tasks in natural language (user-supplied API key, Settings → AI) |
| Voice commands | Speak commands in English or German (Web Speech API) |
| Reports | Summary view with overdue, due-soon, and completion stats |
| RAID register | Risks / Assumptions / Issues / Dependencies log with parent/child cycle detection and true deep-linking (`#raid/<id>`) |
| Change Log | RAID-sibling change-control register with 6-state approval workflow (Proposed → Implemented/Deferred), impact rating, schedule-day and cost figures, and a printable Change Report; feeds the Scope RAG on the dashboard |
| Stakeholder register | Sortable/filterable register with RACI matrix (per stakeholder × milestone), Influence/Interest grid, and engagement level tracking |
| Resource planner & address book | Address book (name, title, contact, birthday), two-dimensional roles (discipline × grade) with internal/external rates, absences, per-period utilization planning grid → capacity, cost, and margin rollup |
| Budget planner | PO-line budget buckets (T&M / fixed-price) with per-role allocations, CCI, win/loss with spillover, multi-currency via ECB rates |
| Dashboard | Project-health RAG status with lettered badges, burn-down charts, milestones, and Earned Value SPI/CPI that feed the Schedule/Budget RAGs |
| Activity log | Browser-local chronological record of task / RAID / absence / shift CRUD with text / wildcard / regex search |
| Baseline / variance trends (Turso) | Periodic KPI snapshots into append-only Turso tables; a Trends view shows baseline-vs-current variance, KPI trend charts, and the snapshot list |
| Layout & theme | Modern Dark-Blue sidebar layout (default) with grouped navigation and full-viewport single-view content; Classic single-scroll mode toggle (Settings → Appearance → Layout); Light / Dark / System theme |
| Input feedback | Character counters on capped text fields; on-blur clamp notices on numeric fields; save-time summary toast when entries were adjusted |
| Export | CSV, Markdown, PDF (print), DOCX, XLSX, PPTX |
| Localization | English (US / UK) and German |
| Printing | Scoped print — printing a report prints just that view (sidebar, banners, and other panes are hidden) |

## Storage Backends

| Backend | Description |
|---------|-------------|
| Browser (default) | `IndexedDB` (schema v6) for workspace entities; `localStorage` for settings — zero setup, survives page refresh |
| Local JSON / CSV / Markdown | File System Access API — reads and writes a local file you pick |
| SharePoint JSON / CSV | Workspace as a single JSON or CSV blob in a SharePoint document library via Microsoft Graph; requires M365 sign-in |
| Turso (libSQL) | Relational schema with one table per entity via the Turso HTTP `/v2/pipeline` API; works with Turso Cloud and a local/self-hosted `tursodb` |

### Sample workspace

| File | Description |
|------|-------------|
| `sample-workspace.md` / `.csv` | Hand-curated demo workspace (tasks, RAID, milestones, stakeholders + RACI, budgets, resources). The `.md` is the source of truth. |
| `sample-workspace.json` | Complete demo workspace generated from the `.md` (adds a demo change-log + RAID→stakeholder links) via `npx vite-node scripts/generate-sample-workspace.ts`. |
| `sample-workspace.sqlite3` | The same workspace as a Turso-compatible SQLite database (schema v9). Import with: `turso db create lop-demo --from-file sample-workspace.sqlite3`, then configure the URL and token in Settings → Integrations. |

## Commands

<!-- AUTO-GENERATED from package.json scripts -->
| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server with hot reload on http://localhost:3000 |
| `npm run build` | Production build — runs TypeScript type-check, then emits `.next/` |
| `npm run start` | Serve the production build (run `npm run build` first) |
| `npm run lint` | Run ESLint (`eslint-config-next` preset) |
| `npm run test` | Vitest unit/component tests in watch mode |
| `npm run test:run` | Vitest, single run (CI-friendly) |
| `npm run test:coverage` | Vitest + v8 coverage report (fails below 80%) |
| `npm run e2e` | Playwright E2E suite, headless |
| `npm run e2e:ui` | Playwright interactive UI mode |
| `npm run e2e:install` | One-time: download Chromium browser binary |
| `npm run docs:scripts` | Regenerate AUTO-GENERATED scripts tables in repo docs from `package.json` |
| `npm run docs:scripts:check` | Verify AUTO-GENERATED scripts tables are in sync; exit non-zero on drift (CI mode) |
<!-- END AUTO-GENERATED -->

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **UI**: React 19, Tailwind CSS 4
- **Language**: TypeScript 5
- **AI**: Anthropic Claude API (key stored client-side in Settings)

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables (optional)

No environment variables are **required** — all integrations work via in-app Settings. These optional build-time variables pre-configure integrations:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_MSAL_CLIENT_ID` | Microsoft Entra app client ID (overrides Settings → Integrations input) |
| `NEXT_PUBLIC_MSAL_TENANT_ID` | Microsoft Entra tenant ID (overrides Settings → Integrations input) |
| `NEXT_PUBLIC_TURSO_DATABASE_URL` | Turso database URL (overrides Settings → Integrations input) |
| `NEXT_PUBLIC_TURSO_AUTH_TOKEN` | Turso auth token (overrides Settings → Integrations input); **recommend a scoped token** |

The Claude API key and Jira credentials are entered in Settings and stored in `localStorage`.

**Security note**: Turso auth tokens live in the browser (`localStorage` or as `NEXT_PUBLIC_*` env vars, which are not secret). Use a token scoped to the minimum required database and operations; rotate if exposed.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
