<!-- Generated: 2026-05-25 | Files scanned: ~74 source files | Token estimate: ~820 -->

# Architecture

Browser-first task tracker built as a Next.js 16 App Router app. Almost all
logic runs client-side; the Next runtime only ships static assets, a thin set
of Jira proxy routes that the in-browser Jira integration cannot reach
directly (CORS), and a request-time middleware that issues a per-request CSP
nonce.

## Project type

Single Next.js app — no monorepo, no workspace packages, no separate
frontend/backend repos.

```
                     ┌────────────────────────────────────────┐
   Browser           │  Next.js dev/build server              │
   ┌──────────────┐  │  ┌──────────────────────────────────┐  │   ┌──────────────┐
   │ <TaskManager>│──┼─▶│ /api/jira/*  (8 POST routes)     │──┼──▶│ Atlassian    │
   │              │  │  │  CORS proxy + rate-limit         │  │   │ Cloud REST   │
   └──────┬───────┘  │  └──────────────────────────────────┘  │   └──────────────┘
          │          │  ┌──────────────────────────────────┐  │
          │          │  │ src/proxy.ts (middleware)        │  │
          │          │  │  per-request CSP nonce on HTML   │  │
          │          │  └──────────────────────────────────┘  │
          │          └────────────────────────────────────────┘
          │                                                    ┌──────────────┐
          ├───── direct HTTPS (no proxy) ──────────────────────│ api.anthropic│
          │                                                    │ .com         │
          ▼                                                    └──────────────┘
   ┌──────────────┐
   │ IndexedDB    │ tasks, raid, absences, shifts, resources, roles,
   │ (schema v5)  │ disciplines, grades + resource-plan kv (record-level)
   │ localStorage │ settings, contacts, activity log, UI prefs,
   │              │ reminder-snooze:due, reminder-snooze:birthday
   │ FS Access    │ optional local JSON/CSV/MD workspace file
   └──────────────┘
```

## Entry points

- `src/proxy.ts` — Next.js 16 middleware. Sets per-request `nonce-{uuid}` in `Content-Security-Policy` and forwards as `x-nonce` request header so SSR can attach the same nonce to scripts and SSR-injected `<style>` blocks. Skips `/api/*`, `/_next/static`, `/_next/image`, favicon, and router-prefetches.
- `src/app/layout.tsx` — root layout, self-hosted Titillium Web via `next/font/google`, globals.css. Static security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) come from `next.config.ts:headers()`.
- `src/app/page.tsx` — calls `await connection()` to opt the route into dynamic rendering (so the CSP nonce matches at SSR time), then renders `<TaskManager />`.
- `src/app/task-manager.tsx` — orchestrator (~550 lines after hook extractions); owns all client state and mounts child panels.

## Service boundaries

| Boundary | Crosses | Auth |
|---|---|---|
| Browser → Next runtime (`/api/jira/*`) | localhost during dev / Vercel during prod | Credentials supplied per-request in POST body; never persisted server-side |
| Next runtime → `api.atlassian.com` | Public Atlassian REST | Basic auth from forwarded body |
| Browser → `api.anthropic.com` | Direct (user-supplied API key in localStorage) | Bearer key on each call |
| Browser → File System Access API | Local disk | OS picker grant |
| Browser → SharePoint (`sp-json`/`sp-csv`) | **Not yet implemented** — factory returns a stub backend whose `load`/`save` throw `StorageNotImplementedError("sharepoint-coming-soon")` | Planned: MSAL |

## Top-level data flow

```
                          load()             save() (debounced 500ms)
   IndexedDB ─────────────────────▶ Workspace ─────────────▶ IndexedDB
                                  │     │                    (record-level diff per store)
                                  │     │
                                  ▼     ▼
                          TaskManager (god-component)
                            │     │     │     │
                            ▼     ▼     ▼     ▼
                         Chat Tasks Reports / Gantt / RAID / Resources / Activity
                         (mounted) (mounted)  (conditionally mounted)
                            │
                            ▼
                       dispatcher (chat-tools.ts) → CRUD on tasks/raid
```

`Workspace = { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan }` (schema v5). The `plan` singleton holds the planning window + canonical granularity + currency; `resources` carry per-period utilization + optional absence overrides + address-book contact fields (`firstName`/`lastName`/`birthday`/…); `roles` are discipline × grade combos with internal/external hourly rates.

Pop-out windows (`?popout=resource-report`, `?popout=address-book`) are separate browser windows that load the same Next.js page. They stay in sync with the main window via `BroadcastChannel` (`broadcast-sync.ts`). Pop-outs no longer broadcast their initial state on mount (fixed in 0.10.0) so they cannot overwrite the main window's data.

## Cross-cutting concerns

- **i18n** — `src/app/i18n.ts` (en-US/en-GB baked in) + `i18n.de.ts` (lazy-loaded for German users); both dictionaries carry the same ~700-key surface, including Resource Planner + Activity Log labels.
- **Holidays** — `src/app/holidays.ts` lazy-imports `date-holidays` (and its moment-tz cost) only when at least one country is selected.
- **Health / due-dates** — `health.ts` + `due-dates.ts` compute RAG status and alertable lists from `Task[] × today × holidaySet`. `due-dates.ts` also exports `shiftToWorkingDay` (shifts a date earlier past weekends, holidays, and absence days) and `absenceDayMap` (builds a per-assignee set of absent ISO dates) used by both due-date and birthday reminder logic.
- **Reminders & snooze** — `getAlertableTasks` (due-dates.ts) and `getUpcomingBirthdays` (birthdays.ts) each apply `shiftToWorkingDay` so triggers never fall on non-working days. Both reminder banners (`DueBanner`, `BirthdayBanner` in notifications.tsx) accept an `onSnooze` prop wired to `useReminderSnooze` in TaskManager; snooze state is persisted per-kind to `localStorage` keys `lop-app:reminder-snooze:due` and `lop-app:reminder-snooze:birthday` (epoch-ms) via `reminder-snooze.ts`. The hook auto-clears state after the snooze elapses.
- **Export** — `export.ts` + `export-ooxml.ts` (lazy-imported for DOCX/XLSX/PPTX) + `export-menu.tsx` + `zip.ts` (hand-rolled STORE-method ZIP writer; no DEFLATE).
- **Voice commands** — Web Speech API via `voice.ts` + `voice-button.tsx`.
- **Activity log** — `activity-log.ts` + `activity-log-panel.tsx`; chronological CRUD record persisted to `lop-app:activity-log` (capped 500 entries), never written to exports. "Clear log" is gated behind `window.confirm` (matches `handleClearAll` / `handleDelete` precedent).
- **Contacts** — `contacts.ts`; assignee↔email address book in `lop-app:contacts`, survives task deletion and Jira churn.
- **Jira ADF** — `adf.ts`; lossy plain-text ↔ Atlassian Document Format conversion for issue descriptions.
- **Testing** — Vitest + RTL for unit/component (`src/**/*.test.{ts,tsx}`, `vitest.config.ts`, 80% v8 coverage threshold). Playwright for E2E (`e2e/**/*.spec.ts`, `playwright.config.ts`, Chromium-only, auto-starts `npm run dev`). Neither runner integrates with Next's build pipeline. See [dependencies.md](dependencies.md#testing-stack).

See [backend.md](backend.md), [frontend.md](frontend.md), [data.md](data.md),
[dependencies.md](dependencies.md) for per-layer detail.
