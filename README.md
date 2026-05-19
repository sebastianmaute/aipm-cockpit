# List of Open Points Tracker

**v0.7.2** — Track open project items and draft status-inquiry emails for delayed tasks.

## What It Does

A single-page task manager built for project leads who maintain a "List of Open Points" (LOP). Core workflow:

1. Add tasks with assignee, due date, and priority
2. Filter, sort, and view tasks in a table or Gantt chart
3. Send pre-filled status-inquiry emails to assignees with one click
4. Export the task list to CSV, Markdown, PDF, DOCX, XLSX, or PPTX
5. Optionally sync tasks bidirectionally with a Jira project

All data is stored locally by default — no backend account required.

## Features

| Feature | Description |
|---------|-------------|
| Task management | Create, edit, delete, bulk-edit, filter by priority / assignee / group / label |
| Gantt chart | Visual timeline with drag-and-drop reorder and dependency arrows |
| Task dependencies | FS / SS / FF / SF predecessor relationships with cycle detection |
| Groups & labels | Categorize tasks freely; filter by group or label |
| AI chat (Claude) | Ask questions or create/update tasks in natural language |
| Voice commands | Speak commands in English or German (Web Speech API) |
| Due-date notifications | Banner, toast, and popup alerts for approaching deadlines |
| Reports | Summary view with overdue, due-soon, and completion stats |
| RAID register | Risks / Assumptions / Issues / Dependencies log with parent/child cycle detection |
| Resource planner | Per-assignee absences (vacation / sick / training / other), weekly shift patterns, and a 30-day calendar view |
| Activity log | Browser-local chronological record of task / RAID / absence / shift CRUD with text / wildcard / regex search |
| Jira sync | Pull from and push to a Jira Cloud project (bidirectional, with conflict resolution) |
| Export | CSV, Markdown, PDF (print), DOCX, XLSX, PPTX |
| Localization | English (US / UK) and German |

## Screenshots

[Main Screen](./public/Main.png)
[New task](./public/Newtask.png)
[Reports](./public/Reports.png)
[Gantt](./public/Gantt.png)
[RAID](./public/RAID.png)
[Resources](./public/Resources.png)
[Configuration](./public/Configuration.png)

## Storage Backends

The app persists tasks in one of several backends, switchable in Settings:

| Backend | Description |
|---------|-------------|
| Browser (default) | `IndexedDB` for tasks & RAID (record-level writes, legacy `localStorage` data migrates on first load); `localStorage` for settings — zero setup, survives page refresh |
| Local JSON / CSV / Markdown | File System Access API — reads and writes a local file you pick |
| SharePoint JSON / CSV | Coming soon |

The Jira integration stores credentials (site URL, email, API token) in `localStorage`. They are never sent to any server other than your own Atlassian domain via the local proxy routes below.

## API Routes

All routes are CORS proxy endpoints — the browser calls them, they call Atlassian, and forward the response. Credentials are sent in the POST body and are never persisted server-side.

| Route | Purpose |
|-------|---------|
| `POST /api/jira/test` | Verify credentials (calls `/rest/api/3/myself`) |
| `POST /api/jira/projects` | List accessible projects |
| `POST /api/jira/issue-types` | List issue types for a project |
| `POST /api/jira/users` | Search assignable users |
| `POST /api/jira/search` | Run a JQL query (paginated) |
| `POST /api/jira/create-issue` | Create a new Jira issue from a local task |
| `POST /api/jira/update-issue` | Push local task edits back to Jira |
| `POST /api/jira/transition-issue` | Change the issue's workflow status category |

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

No environment variables are required. The Claude API key and Jira credentials are entered in the in-app Settings panel and stored in `localStorage`.
