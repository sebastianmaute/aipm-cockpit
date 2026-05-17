<!-- Generated: 2026-05-15 | Files scanned: ~45 source files | Token estimate: ~600 -->

# Architecture

Browser-first task tracker built as a Next.js 16 App Router app. Almost all
logic runs client-side; the Next runtime only ships static assets and a thin
set of Jira proxy routes that the in-browser Jira integration cannot reach
directly (CORS).

## Project type

Single Next.js app — no monorepo, no workspace packages, no separate
frontend/backend repos.

```
                     ┌────────────────────────────────────┐
   Browser           │  Next.js dev/build server          │
   ┌──────────────┐  │  ┌──────────────────────────────┐  │   ┌──────────────┐
   │ <TaskManager>│──┼─▶│ /api/jira/*  (8 POST routes) │──┼──▶│ Atlassian    │
   │              │  │  │  CORS proxy + rate-limit     │  │   │ Cloud REST   │
   └──────┬───────┘  │  └──────────────────────────────┘  │   └──────────────┘
          │          └────────────────────────────────────┘
          │                                                    ┌──────────────┐
          ├───── direct HTTPS (no proxy) ──────────────────────│ api.anthropic│
          │                                                    │ .com         │
          ▼                                                    └──────────────┘
   ┌──────────────┐
   │ IndexedDB    │ tasks, raid object stores (record-level)
   │ localStorage │ settings, col widths, hidden cols (UI prefs only)
   └──────────────┘
```

## Entry points

- `src/app/layout.tsx` — root layout, security headers, globals.css.
- `src/app/page.tsx` — renders `<TaskManager />` (the single visible page).
- `src/app/task-manager.tsx` — god-component (~3,900 lines); orchestrates all client state and child panels.

## Service boundaries

| Boundary | Crosses | Auth |
|---|---|---|
| Browser → Next runtime (`/api/jira/*`) | localhost during dev / Vercel during prod | Credentials supplied per-request in POST body; never persisted server-side |
| Next runtime → `api.atlassian.com` | Public Atlassian REST | Basic auth from forwarded body |
| Browser → `api.anthropic.com` | Direct (user-supplied API key in localStorage) | Bearer key on each call |
| Browser → File System Access API | Local disk | OS picker grant |

## Top-level data flow

```
                          load()             save() (debounced 500ms)
   IndexedDB ─────────────────────▶ tasks/raid ─────────────▶ IndexedDB
                                  │     │                    (record-level diff)
                                  │     │
                                  ▼     ▼
                          TaskManager (god-component)
                            │     │     │
                            ▼     ▼     ▼
                         Chat  Tasks  Reports / Gantt / RAID
                         (mounted) (mounted)  (conditionally mounted)
                            │
                            ▼
                       dispatcher (chat-tools.ts) → CRUD on tasks/raid
```

## Cross-cutting concerns

- **i18n** — `src/app/i18n.ts` (en-US/en-GB baked in) + `i18n.de.ts` (lazy-loaded for German users).
- **Holidays** — `src/app/holidays.ts` lazy-imports `date-holidays` (and its moment-tz cost) only when at least one country is selected.
- **Health / due-dates** — `health.ts` + `due-dates.ts` compute RAG status and alertable lists from `Task[] × today × holidaySet`.
- **Export** — `export.ts` + `export-ooxml.ts` (lazy-imported for DOCX/XLSX/PPTX) + `export-menu.tsx`.
- **Voice commands** — Web Speech API via `voice.ts` + `voice-button.tsx`.

See [backend.md](backend.md), [frontend.md](frontend.md), [data.md](data.md),
[dependencies.md](dependencies.md) for per-layer detail.
