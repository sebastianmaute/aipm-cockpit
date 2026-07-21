<!-- Generated: 2026-06-11 | Files scanned: ~100 source files | Token estimate: ~850 | Updated for 0.29.0–0.59.0: modern sidebar layout + UI-consistency sweep + Health Dashboard + Milestones + Earned Value + Simple/Modular/Advanced mode + stakeholder comms + input feedback + configurable export + multi-project portfolio (file + Turso multi-tenancy) + data version history (capture/compare/selective restore, Turso) [0.66.0–0.69.0]; AI orchestration SP0–SP5 (operating-guide grounding, Ask-Claude prompts, write tools, doc ingestion, AI project creation/import, Action-Center analysis, scheduled jobs, weight suggestions) [0.97.0–0.110.0]; Task.status model + Kanban board [0.107.0–0.108.0]; steering committee [0.111.0]; guided tour [0.112.0]; timezones (operating tz, display tz, calendar clock strip) [0.113.0–0.115.0]; inline "Ask Claude" task edit [0.165.0]; codebase-audit campaign [0.167.0]: global search over budgets+resources, activity-log per-field diffs, branded ConfirmDialog, keyboard-a11y shell (calendar role=grid, collapsed-sidebar flyout, mobile off-canvas drawer + focus-trap, focus-follows-view), workload actionable (util edit + overdue triage), render-perf (precomputed search index, split row-lookup context), data-integrity guards; 0.177.0 "Aldiss": AI call-layer hardening (pure `ai-errors.ts` failure classifier + advisory usage-limit notices, bounded chat turns via `maxChatTurns`, token-multiplier caps), role rate-card day/hour materialization (`role-rates.ts`, `Role.internalRateDay`/`externalRateDay`/`rateBasis`), shared `Tile` `hint` prop -->

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
- **Activity log** — `activity-log.ts` + `activity-log-panel.tsx`; chronological CRUD record persisted to `aipm-cockpit:activity-log` (capped 500 entries), never written to exports. "Clear log" is gated behind `window.confirm` (matches `handleClearAll` / `handleDelete` precedent).
- **Data version history** (Turso-only, 0.66.0+) — per-project capture → compare → selective restore. Pure engines `version-diff.ts` (field-level diff + `COLLECTION_SPECS` registry + `summarizeDiff`) and `version-restore.ts` (`applyRestore`) drive `use-version-history.ts` over `version-store.ts`/`version-schema.ts` (append-only `project_versions` table, kept out of `TABLE_NAMES`). Captures are auto idle-debounced + manual named checkpoints, pruned to `Settings.versionHistoryRetention`; restore is non-destructive and logged as `history.restore`. Surfaced as the `history` AppView, a 10th feature module gated on Turso + the History module.
- **Action Center learning loop** (0.95.0+) — a closed feedback loop on the ranked next-actions queue: the surface **captures** CTA / snooze / dismiss outcomes per action kind → the pure `action-learning.ts` model derives a time-**decayed bias** (and explicit overrides, evidence-gated) → the next-actions engine folds in a **safety-floored bias term** (`applyLearnedBias`, never demoting an intrinsically-now item out of the now tier) → a Learning Insights view surfaces what was learned. Opt-in (off by default), persisted to the local store (`aipm-cockpit:action-learning`) or the global Turso `action_learning` table; ignored in safe-mode and never blocks boot.
- **AI orchestration** (0.97.0–0.110.0) — Claude is woven through the app as a senior-PM copilot. `chat-panel.tsx` calls `api.anthropic.com` directly (browser); `buildSystemPrompt` returns prefix-cacheable `SystemBlock[]` grounded in the operating-guide library (`operating_guides` global store, mode/module/view scoped, master `ai.groundInGuides`). Write tools live in `chat-tools.ts` + `use-chat-dispatcher.ts` (Tasks/RAID/Changes/Milestones/Stakeholders CRUD, each through its `sanitizeX`); doc ingestion via pure `chat-attachments.ts` (native multimodal, no parsing lib). One-shot forced-tool calls drive AI project creation (`use-project-proposal.ts` + `ai-project-proposal.ts`), source import (`step0-import-panel.tsx` + `confluence-api.ts` + `api/confluence/page/route.ts`, reusing the hardened Jira `_helpers`), Action-Center analysis (`use-action-analysis.ts` + `action-ai.ts`, advisory only), scheduled jobs (`scheduled-jobs/` engine + `use-scheduled-job-runner.ts` + `scheduled-job-analysis.ts`, opt-in recurring portfolio analysis), and next-actions weight suggestions (`weight-suggestion-*.ts` + `next-actions-tuning.ts`). All advisory paths are read-only in popouts and never log/echo the API key or body. **0.177.0** hardens the call layer: a pure `ai-errors.ts` classifier (`classifyAiError` / `AiHttpError` / `safeAiErrorType`, reading ONLY the safe `error.type` token — never the body message) lets all 6 AI call sites surface a distinct "usage limit reached" notice; the chat agentic loop is bounded by `AiConfig.maxChatTurns` (`clampMaxChatTurns`, 1–50) and token usage is scaled by `AiConfig.tokenMultiplier` before the session/weekly caps, with an advisory 100 %-of-cap toast.
- **Inline "Ask Claude" task edit** (0.165.0+) — a per-item natural-language edit popover on a task row/Kanban card (✨ hover trigger, gated AI-enabled + non-popout + non-Jira-synced). One bounded, non-agentic `callClaude` call scoped to the single task (`inline-ai-edit-call.ts`); the pure `inline-ai-edit/plan.ts` translates the model's tool-use response into a previewable plan-then-apply diff (field updates / creates / deletes), rejecting anything out of scope (wrong task, unknown id, bad enum value); on confirm, `use-inline-ai-edit.ts` applies the plan through the SAME chat-tool dispatcher (`runTool` in `chat-tools.ts`) the chat panel already uses. No new backend route, no new persisted `Workspace` field, no new secret/token — it reuses the existing Anthropic call path and CRUD tools end-to-end. Logs an `ai.inlineEdit` activity entry.
- **Task status model + Kanban** (0.107.0–0.108.0) — `Task.status` (To Do/In Progress/On Hold/In Review/Cancelled/Done) is the source of truth for "done", with `completedDate` auto-managed to keep the invariant `status==="Done" ⟺ completedDate set`. Pure i18n-free `task-status.ts` owns it (`applyStatusChange` is the sole writer; `migrateTaskStatus` runs on all six load paths); UI labels via `task-status-ui.ts`/`task-status-badge.tsx`/`task-status-select.tsx`. The tasks pane has a Table/Board toggle (`settings.tasksViewMode`); `task-kanban-board.tsx` (native HTML5 DnD) renders cards via `task-kanban-card.tsx` over the pure `task-kanban.ts` engine. Jira-synced tasks are read-only.
- **Steering committee** (0.111.0+) — `steering-committee-panel.tsx` records committee name, member resources, meeting schedule, and "information schedule" lead-day rules on `Workspace.steeringCommittee`. Pure `steering-reminders.ts` derives pack reminders (surfaced via `next-actions/providers/committee-info.ts` into the Action Center); `committee-calendar-reconcile.ts` + `use-committee-outlook-push.ts` push meetings + reminder due-dates to Outlook (idempotent, never duplicates).
- **Guided tour** (0.112.0+) — pure `app-tour.ts` (`TOUR_STEPS`/`TOUR_ANCHORS`/`visibleSteps`) drives `tour-overlay.tsx` via `use-tour.ts`; a first-run walkthrough of the modern layout + "Explore a demo project" + Help-menu replay. Per-device (`settings.tourSeen`); never runs in classic layout or popouts.
- **Timezones** (0.113.0–0.115.0) — pure `timezone.ts` (`todayInZone`/`formatInZone`/`resolveTimezone`/`tzZones`/`browserTimeZone`) makes day-boundary logic (overdue/due-today/due-soon) follow a resolved IANA zone instead of UTC. `ProjectMeta.operatingTimezone` + per-device `settings.timezone`/`additionalTimezones` (configured in `settings-sections/timezone-settings-section.tsx`). Display layer: `tz-display.ts` (`formatDisplayTimestamp`) + `display-timezone-context.tsx` + `display-tz-switcher.tsx` (session display-zone switcher for activity log / version history / trends), and `tz-clock.ts` (`formatZoneClock`) + `tz-clock-strip.tsx` (Calendar world-clock strip).
- **Accessibility shell + audit campaign** (0.167.0) — a codebase-audit improvement roll-up. Keyboard/screen-reader shell patterns: **focus-follows-view** (`modern-shell.tsx` moves focus to `#main-content`/`tabIndex={-1}` on view change), a first reusable **focus trap** (`use-focus-trap.ts`, driving the modern-shell mobile off-canvas drawer), a **roving 2-D grid** (`resource-calendar.tsx` `role="grid"`), a collapsed-sidebar child **flyout** (`CollapsedNavFlyout`), and a branded Promise-based **ConfirmDialog** (`confirm-dialog.tsx`, replacing `window.confirm`). Also: global search now indexes budgets + resources (`buildSearchIndex`); the activity log records per-field diffs (`diffFields` → `ActivityEntry.changes`); the workload view is actionable (inline utilization edit + overdue-task reassign/reschedule, `resource-workload-triage.tsx`); render-perf via a precomputed search index + a split row-lookup context; plus data-integrity save guards.
- **Correctness batch** (0.194.0 "Stapledon") — no new entity, field, or backend write path; four defects in existing flows plus a UI batch. **Timelog actuals attribute per role line** (`timelog-apply.ts`): cells carry an optional `byResource` breakdown and each person routes by their line's `resourceIds`, else their directory role (blended: its discipline); unroutable hours are withheld and reported, never charged to another role. The apply confirm itemises every row it writes (`timelog-apply-confirm.tsx`) because `actualHours` is hand-editable, and freezes both the overlay and the budget baseline. **Digest email reports truthfully** (`digest/digest-mail-sender.ts` resolves only on an accepted Graph send) and `generate()`'s three concerns — cadence / notification / billed AI narrative — are independent flags. **`resolveEffectiveFilters`** (`task-filters.ts`) resolves an orphaned Open-Points filter to "All" from one source feeding both the rows and the control. **`buildResourceWorkload` must receive the complete resource list** — display filtering moved onto the built rows, because a pre-filtered input re-surfaced people as *unlinked*, where a Clear control deletes absences and shifts.
- **Contacts** — `contacts.ts`; assignee↔email address book in `aipm-cockpit:contacts`, survives task deletion and Jira churn.
- **Jira ADF** — `adf.ts`; lossy plain-text ↔ Atlassian Document Format conversion for issue descriptions.
- **Testing** — Vitest + RTL for unit/component (`src/**/*.test.{ts,tsx}`, `vitest.config.ts`, 80% v8 coverage threshold). Playwright for E2E (`e2e/**/*.spec.ts`, `playwright.config.ts`, Chromium-only, auto-starts `npm run dev`). Neither runner integrates with Next's build pipeline. See [dependencies.md](dependencies.md#testing-stack).
- **Module decompositions (barrels)** — several oversized modules have been split into focused sub-modules behind a re-export **barrel that preserves the original import path** (no behavior / public-API / serialized-byte change; importers are untouched). Re-export barrels: `csv-codecs.ts` → `csv-codecs-core` (registries + field codecs + `parseCsv`) / `-config` (status/project/config-blob codecs + `workspaceToCsv`) / `-decode` (`csvToWorkspace`); `markdown-codecs.ts` → `-core` / `-decode`; `sanitize.ts` → `sanitize-core` / `-entities` / `-records`; `export-ooxml.ts` → `export-docx` / `-xlsx` / `-pptx` / `export-ooxml-shared`; `chat-tools.ts` re-exports `TOOL_DEFS` from `chat-tool-defs.ts`. Orchestrators slimmed by extracting pieces (same import surface): `gantt.tsx` (→ `gantt-engine` / `gantt-chrome` / `gantt-rows` / `use-gantt-*`), `reports.tsx` (→ `reports-stats` / `reports-tables`), `raid-edit-modal.tsx` (→ `raid-risk-matrix` / `raid-edit-fields`), `workspace-section.tsx` (→ `workspace-panels` / `workspace-section-types`), `use-storage-backend.ts` (→ `use-storage-file-ops` / `use-storage-turso-ops` hook factories). Detailed per-file maps live in **AGENTS.md** ("module map" entries).

See [backend.md](backend.md), [frontend.md](frontend.md), [data.md](data.md),
[dependencies.md](dependencies.md) for per-layer detail.
