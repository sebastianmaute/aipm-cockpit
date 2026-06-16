<!-- Generated: 2026-06-11 | Files scanned: ~100 source files | Token estimate: ~850 | Updated for 0.29.0–0.59.0: modern sidebar layout + UI-consistency sweep + Health Dashboard + Milestones + Earned Value + Simple/Modular/Advanced mode + stakeholder comms + input feedback + configurable export + multi-project portfolio (file + Turso multi-tenancy) + data version history (capture/compare/selective restore, Turso) [0.66.0–0.69.0] -->

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
   │              │  │  ├──────────────────────────────────┤  │   └──────────────┘
   │              │  │  │ GET /api/ecb  (ECB FX rates)     │──┼──▶│ ECB XML feed │
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
   │ (store v6)   │ disciplines, grades + resource-plan kv, budgets kv,
   │              │ fxRates kv (record-level)
   │ localStorage │ settings, contacts, activity log, UI prefs, reminder
   │              │ snooze, portfolio-mode + projects registry
   │ FS Access    │ optional local JSON/CSV/MD workspace file (per project)
   │ Turso (HTTP) │ single-tenant DB, OR one shared multi-tenant DB holding
   │              │ all projects (project_id column everywhere)
   └──────────────┘
```

## Entry points

- `src/proxy.ts` — Next.js 16 middleware. Sets per-request `nonce-{uuid}` in `Content-Security-Policy` and forwards as `x-nonce` request header so SSR can attach the same nonce to scripts and SSR-injected `<style>` blocks. Skips `/api/*`, `/_next/static`, `/_next/image`, favicon, and router-prefetches.
- `src/app/layout.tsx` — root layout, self-hosted Titillium Web via `next/font/google`, globals.css. Static security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) come from `next.config.ts:headers()`.
- `src/app/page.tsx` — calls `await connection()` to opt the route into dynamic rendering (so the CSP nonce matches at SSR time), then renders `<TaskManager />`.
- `src/app/task-manager.tsx` — orchestrator (~550 lines after hook extractions); owns all client state and mounts child panels.

## Layout modes (settings.layout)

- **modern** (default, v0.29.0+): `<ModernShell>` with dark-blue sidebar, top bar, centered content pane, full-page editor & settings views. Sidebar responsive collapse on mobile via `useMediaQuery` + `useSidebarCollapsed`.
- **classic** (legacy toggle): pre-v0.29.0 layout with horizontal AppHeader, left-side task table, floating right-side workspace panels.

A ternary in `task-manager.tsx` picks between them at runtime based on `settings.layout`.

## Service boundaries

| Boundary | Crosses | Auth |
|---|---|---|
| Browser → Next runtime (`/api/jira/*`) | localhost during dev / Vercel during prod | Credentials supplied per-request in POST body; never persisted server-side |
| Next runtime → `api.atlassian.com` | Public Atlassian REST | Basic auth from forwarded body |
| Browser → `api.anthropic.com` | Direct (user-supplied API key in localStorage) | Bearer key on each call |
| Browser → File System Access API | Local disk | OS picker grant |
| Browser → Microsoft Graph (`graph.microsoft.com`) | Outlook contacts/calendar import; SharePoint storage | MSAL-acquired access token (Bearer), stored in browser localStorage or env var |
| Browser → Turso HTTP API (`api.turso.io`) | Workspace storage via `/v2/pipeline` | Bearer auth token (env var or Settings); **recommend scoped token** |

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

`Workspace = { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets?, fxRates?, status?, milestones?, changes?, stakeholders?, project? }` (logical schema v9; the IndexedDB object-store layout is a distinct concept at store version v6). The `plan` singleton holds the planning window + canonical granularity + currency; `resources` carry per-period utilization + optional absence overrides + address-book contact fields; `roles` are discipline × grade combos with internal/external hourly rates; `budgets` are PO-line budget buckets; `fxRates` is the cached ECB rate map; `status` is the dashboard RAG overrides + PM narrative; `milestones`/`changes`/`stakeholders` are the milestone, change-control, and stakeholder registers; `project` is the per-project `ProjectMeta` header (multi-project Phase 1). All these fields are optional for backward compat (each load path defaults them).

The active storage backend depends on the global **portfolio mode** (`portfolio-mode.ts`, "file" | "turso", chosen in Settings). In file mode each project is a standalone workspace file (Phase 1). In Turso mode `createBackend` returns a tenant-mode `TursoBackend(config, projectId)` — a multi-tenant slice of one shared DB — selected by the active project id; with no project id the same `TursoBackend` falls back to single-tenant mode.

Pop-out windows (`?popout=resource-report`, `?popout=address-book`) are separate browser windows that load the same Next.js page. They stay in sync with the main window via `BroadcastChannel` (`broadcast-sync.ts`). Pop-outs are **read-only mirrors**: `useBroadcastSync` is called with `canSend={false}` in popouts so they receive updates but never broadcast — preventing overwrite of the main window's data. Edit affordances are locked (via `makeEditGuard`), a `ReadOnlyMirrorBanner` is shown, and mutating chat tools are refused.

## Cross-cutting concerns

- **i18n** — `src/app/i18n.ts` (en-US/en-GB baked in) + `i18n.de.ts` (lazy-loaded for German users); both dictionaries carry the same ~700-key surface, including Resource Planner + Activity Log labels.
- **Holidays** — `src/app/holidays.ts` lazy-imports `date-holidays` (and its moment-tz cost) only when at least one country is selected.
- **Health / due-dates** — `health.ts` + `due-dates.ts` compute RAG status and alertable lists from `Task[] × today × holidaySet`. `due-dates.ts` also exports `shiftToWorkingDay` (shifts a date earlier past weekends, holidays, and absence days) and `absenceDayMap` (builds a per-assignee set of absent ISO dates) used by both due-date and birthday reminder logic.
- **Reminders & snooze** — `getAlertableTasks` (due-dates.ts) and `getUpcomingBirthdays` (birthdays.ts) each apply `shiftToWorkingDay` so triggers never fall on non-working days. Reminder banners (`DueBanner`, `BirthdayBanner`, `JiraTokenBanner` in notifications.tsx) accept an `onSnooze` prop wired to `useReminderSnooze` in TaskManager; snooze state is persisted per-kind via `reminder-snooze.ts` (`ReminderKind = "due" | "birthday" | "jiraToken"`). The hook auto-clears state after the snooze elapses.
- **Budget planner** — `budget-report.ts` (pure engine: CCI ×3, spillover, project rollup, reminders) + `budget-panel.tsx` (Budget tab) + `fx.ts` + `ecb.ts` + `use-fx-rates.ts` + `api/ecb/route.ts` (ECB FX). `budgets`/`fxRates` added to `Workspace` (optional); full CSV/MD/JSON/IDB round-trip.
- **Project Health Dashboard** — `dashboard.ts` (pure engine: consolidates milestones + EVM SPI/CPI into overall/schedule/budget/scope RAG) + `dashboard-panel.tsx` (Dashboard tab, 0.43.0+) + `dashboard-sections/` (subsections). `status` added to `Workspace` (0.43.0+, optional).
- **Milestones** — `milestones.ts` (pure engine: status + bucketing) + `milestones-panel.tsx` (Milestones tab, 0.44.0+) + `milestone-edit-modal.tsx`. `milestones[]` added to `Workspace` (0.44.0+, optional); Gantt integrates milestone diamond rows.
- **Earned Value Management** — `evm.ts` (pure engine: task-effort PV/EV/AC → SPI/CPI/SV/CV, 0.45.0+). EVM metrics fold into Dashboard + Schedule/Budget RAGs.
- **Feature modes** — `feature-modules.ts` + `settings-sections/mode-section.tsx`; Simple/Modular/Advanced gating (0.54.0+) toggles 10 feature-modules (incl. `history`, 0.66.0+) that gate nav, automation, dashboard pills, and reports. `Settings.features` is the source of truth; default Advanced (all on), legacy settings migrate to all-on.
- **Stakeholder communication reminders** — `stakeholder-comms.ts` (pure quadrant engine) + `use-stakeholder-comms.ts` (0.55.0+); derives "reach out" reminders from due-soon milestones, open RAID, and pending changes via stakeholder engagement policy, surfaced as banner/modal/toast/settings toggle. Silent when a source module is off.
- **Export** — `export.ts` + `export-ooxml.ts` (lazy-imported for DOCX/XLSX/PPTX) + `export-menu.tsx` + `zip.ts` (hand-rolled STORE-method ZIP writer; no DEFLATE). Configurable multi-section export (`export-sections.ts` + `ExportConfig`, 0.57.0+) lets users pick which sections each document includes (default Tasks + RAID); the no-config storage round-trip stays byte-identical.
- **Multi-project portfolio** — file mode (Phase 1, 0.58.0): a localStorage registry (`projects-registry.ts`) tracks projects, each a full Workspace + `ProjectMeta` header, with per-project file handles in a dedicated IndexedDB store (`project-file-handles.ts`). Turso mode (Phase 2, 0.59.0): one shared DB holds all projects (`turso-tenant-schema.ts` tenant DDL with a `project_id` column + composite `(id, project_id)` PKs + authoritative `projects` table; `turso-backend.ts` projectId-parameterized backend; `turso-portfolio.ts` project-list ops). `portfolio-mode.ts` selects the active world; `type-to-confirm-dialog.tsx` gates hard-delete.
- **Voice commands** — Web Speech API via `voice.ts` + `voice-button.tsx`.
- **Activity log** — `activity-log.ts` + `activity-log-panel.tsx`; chronological CRUD record persisted to `lop-app:activity-log` (capped 500 entries), never written to exports. "Clear log" is gated behind `window.confirm` (matches `handleClearAll` / `handleDelete` precedent).
- **Data version history** (Turso-only, 0.66.0+) — per-project capture → compare → selective restore. Pure engines `version-diff.ts` (field-level diff + `COLLECTION_SPECS` registry + `summarizeDiff`) and `version-restore.ts` (`applyRestore`) drive `use-version-history.ts` over `version-store.ts`/`version-schema.ts` (append-only `project_versions` table, kept out of `TABLE_NAMES`). Captures are auto idle-debounced + manual named checkpoints, pruned to `Settings.versionHistoryRetention`; restore is non-destructive and logged as `history.restore`. Surfaced as the `history` AppView, a 10th feature module gated on Turso + the History module.
- **Action Center learning loop** (0.95.0+) — a closed feedback loop on the ranked next-actions queue: the surface **captures** CTA / snooze / dismiss outcomes per action kind → the pure `action-learning.ts` model derives a time-**decayed bias** (and explicit overrides, evidence-gated) → the next-actions engine folds in a **safety-floored bias term** (`applyLearnedBias`, never demoting an intrinsically-now item out of the now tier) → a Learning Insights view surfaces what was learned. Opt-in (off by default), persisted to the local store (`lop-app:action-learning`) or the global Turso `action_learning` table; ignored in safe-mode and never blocks boot.
- **Contacts** — `contacts.ts`; assignee↔email address book in `lop-app:contacts`, survives task deletion and Jira churn.
- **Jira ADF** — `adf.ts`; lossy plain-text ↔ Atlassian Document Format conversion for issue descriptions.
- **Testing** — Vitest + RTL for unit/component (`src/**/*.test.{ts,tsx}`, `vitest.config.ts`, 80% v8 coverage threshold). Playwright for E2E (`e2e/**/*.spec.ts`, `playwright.config.ts`, Chromium-only, auto-starts `npm run dev`). Neither runner integrates with Next's build pipeline. See [dependencies.md](dependencies.md#testing-stack).

See [backend.md](backend.md), [frontend.md](frontend.md), [data.md](data.md),
[dependencies.md](dependencies.md) for per-layer detail.
