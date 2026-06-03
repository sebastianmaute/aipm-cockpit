<!-- Generated: 2026-06-03 | Files scanned: ~120 (src/app/*.tsx, *.ts, settings-sections/) | Token estimate: ~1600 | Updated for 0.29.0–0.50.0: modern sidebar layout + UI-consistency sweep + Health Dashboard + Milestones + Earned Value + budget/dashboard RAG + burn-down + UI refinements + baseline/variance trends + change-control Log -->

# Frontend

Single-page Next.js App Router client. One route, multiple layout modes
(modern sidebar / classic), full-page views, tabbed panels, and popout windows.

## Page tree (modern layout)

```
src/proxy.ts                 — middleware (per-request CSP nonce)
src/app/layout.tsx           — root layout, security headers, globals.css,
                               no-flash theme script, <ThemeProvider>
└── src/app/page.tsx         — await connection(); renders <TaskManager />
    └── src/app/task-manager.tsx   (~550 lines after hook extractions; god-component)
        ├── modern shell (v0.29.0+; default)
        │   └── src/app/modern-shell.tsx
        │       ├── src/app/sidebar.tsx (dark-blue, collapsible)
        │       │   └── src/app/sidebar-nav.tsx (nav groups)
        │       │       └── src/app/nav-icons.tsx (icon + label pairs)
        │       ├── src/app/top-bar.tsx (title + New task + Alerts + menus)
        │       │   └── src/app/action-menus.tsx (Voice·Export·Help·Version cluster)
        │       └── <main> (single active view + banners)
        │           ├── TaskEditView (full-page task editor; Phase 2)
        │           ├── SettingsView (full-page Settings; Phase 4B)
        │           ├── Open Points tab (task table + workspace section tabs)
        │           └── Workspace section (6 main tabs + 2 popout-only)
        │
        ├── classic shell (legacy; v0.28.0 and earlier)
        │   └── src/app/classic-shell.tsx [not current focus]
        │
        ├── TaskManager state & UI layers
        │   ├── task-manager-ui.tsx — render logic split out
        │   ├── task-form-context.tsx — form state (useTaskForm hook)
        │   ├── filters-context.tsx — search + column visibility state
        │   ├── workspace-tab-context.tsx — active tab + view (useWorkspaceTab)
        │   ├── workspace-context.tsx — workspace data (WorkspaceProvider)
        │   └── use-hash-view.ts — URL hash ↔ active view two-way sync
        │
        ├── Workspace section (9 main tabs + popouts)
        │   ├── workspace-section.tsx — tab strip + conditional mount
        │   ├── ChatPanel (chat-panel.tsx) — mounted; hidden when off
        │   ├── DashboardPanel (dashboard-panel.tsx) — conditional mount ★ (0.43.0+)
        │   ├── MilestonesPanel (milestones-panel.tsx) — conditional mount ★ (0.44.0+)
        │   ├── ReportsPanel (reports.tsx) — conditional mount ★
        │   ├── GanttPanel (gantt.tsx) — conditional mount ★
        │   ├── RaidPanel (raid-panel.tsx) — mounted; hidden when off ✚
        │   ├── ResourcesPanel (resources-panel.tsx) — conditional mount ★
        │   ├── BudgetPanel (budget-panel.tsx) — conditional mount ★
        │   ├── ActivityLogPanel (activity-log-panel.tsx) — conditional mount ★
        │   ├── ResourcesReportPanel (resources-report.tsx) — popout-only ★
        │   └── ResourceDirectory (resource-directory.tsx) — popout-only ★
        │
        ├── Open Points tab (task table)
        │   ├── task-manager-ui.tsx — table header + row loop
        │   ├── task-row.tsx — one row + inline actions
        │   ├── filters-context.tsx — search input, column visibility, bulk-edit bar
        │   └── filters (search, status, assignee, labels, group, health)
        │
        └── Modals (all scoped to task-manager state)
            ├── app-modals.tsx — modal wrapper (stacked z-index)
            ├── TaskEditView (Phase 2; in <main>, not a modal)
            ├── SettingsView (Phase 4B; in <main>, not a modal)
            ├── TaskFormModal (task-form-modal.tsx) — statically imported; null when closed
            ├── BulkEditModal (bulk-edit-modal.tsx) — statically imported; null when closed
            ├── RolesModal (roles-modal.tsx) — discipline × grade rate card
            ├── ResourceEditModal (resource-edit-modal.tsx) — address-book create/edit/delete
            ├── BudgetBucketModal (budget-bucket-modal.tsx) — edit bucket + allocations
            ├── JiraConflictsModal, AbsenceEditModal, ShiftEditModal — dynamic-imported
            └── All modals share ModalHeader (modal-header.tsx) + use-draggable.ts
```

★ = conditional mount (only when its tab is active)
✚ = `React.memo` wrapper + stable `useCallback` handlers

All workspace panels are loaded via `next/dynamic({ ssr: false })` —
browser-only APIs (window, IndexedDB, Web Speech, FS Access) cannot be
prerendered.

## Responsive layout (modern mode)

- **Desktop** — Sidebar always visible (w-64), toggle button in top bar
- **Tablet/mobile** — Sidebar collapse via `useMediaQuery('(max-width: 768px)')` + `useSidebarCollapsed()` hook stores preference in `lop-app:sidebar-collapsed`
- **Sidebar** — w-64 expanded, w-16 collapsed; animated transition; footer shrinks/expands

## State (all in TaskManager)

| State slice | Notes |
|---|---|
| `tasks: Task[]`, `raid: RaidItem[]`, `absences: Absence[]`, `shifts: Shift[]`, `resources: Resource[]`, `roles: Role[]`, `disciplines: Discipline[]`, `grades: Grade[]`, `plan: ResourcePlan` | Persisted via `StorageBackend.save()` (debounced 500 ms); record-level diff per IDB store; `plan` is a kv singleton. Lives in `WorkspaceContext` |
| `rolesModalOpen` | Roles & rates manager modal open/close (see `use-resource-planner.ts`) |
| `tasksRef.current` | Hand-mirrored copy of `tasks` for stable closures in `dispatcher` |
| `settings: Settings` | Language, holiday countries, Jira, AI, notifications. Persisted to `localStorage` (`SETTINGS_KEY`); **layout** field: `"modern" \| "classic"` |
| `contacts: ContactsMap` | Assignee↔email address book; persisted to `lop-app:contacts` |
| `activityLog: ActivityEntry[]` | Up to 500 most recent CRUD events; persisted to `lop-app:activity-log` |
| `colWidths`, `hiddenCols` | UI table prefs in `localStorage` (colWidths debounced 250 ms) |
| `search` + `searchDebounced` + `taskSearchIndex` | 150 ms search debounce + precomputed lowercase index |
| `selectedIds`, `bulkEdit`, `expandedNotes` | Per-session UI only |
| `activeTab` | `"open-points"` \| `"chat"` \| `"dashboard"` \| `"trends"` \| `"milestones"` \| `"reports"` \| `"gantt"` \| `"raid"` \| `"changes"` \| `"change-report"` \| `"budget"` \| `"resources"` \| `"activity"` \| `"resource-report"` \| `"address-book"` \| `"edit"` (last two in popouts or main); synced to URL hash via `useHashView` |
| `budgets: BudgetBucket[]`, `fxRates: FxRates \| null` | Persisted via `StorageBackend.save()`; lives in `WorkspaceContext`; `fxRates` refreshed on demand via `useFxRates` (Refresh ECB rates button) |
| `dueSnooze` / `birthdaySnooze` / `jiraTokenSnooze` | `useReminderSnooze("due")` / `useReminderSnooze("birthday")` / `useReminderSnooze("jiraToken")` — each yields `{ isSnoozed, snoozedUntil, snooze, clear }`; banners are gated on `!isSnoozed` |
| `raidFilterTaskId` | Cross-tab nav: jump from a task row to RAID pre-filtered for that task |
| `workspaceCollapsed`, `taskModalOpen`, `absenceDraft`, `shiftDraft` | Modal / collapse state |
| `hydrated`, `i18nReady` | Render gates; `i18nReady=false` returns null until lang dict loads |

## Key components

| File | Role | Notes |
|---|---|---|
| **Layout & Navigation** | | |
| `app-shell.tsx` | Routes between modern & classic based on `settings.layout` | ~12 lines; simple conditional |
| `modern-shell.tsx` | Modern layout shell: sidebar + top-bar + main pane + banners | Accepts slots for `editView`, `settingsView`, `workspace`, `tasksSection`, `topBarMenus`, `sidebarFooter` |
| `sidebar.tsx` | Dark-blue sidebar with logo, nav, collapse toggle, footer | Responsive w-64 / w-16 |
| `sidebar-nav.tsx` | Nav groups (Overview / Plan / Registers / System) + items | Renders icon + label pairs via nav-icons |
| `sidebar-footer.tsx` | Version + theme toggle in sidebar footer | Small slot |
| `top-bar.tsx` | Title + New task button + Alerts bell + menu cluster | Optional sidebar toggle button in `onToggleSidebar` prop |
| `nav-config.ts` | `AppView` union, `NAV_GROUPS`, slug↔view mapping | Pure config; no React |
| `nav-icons.tsx` | SVG icon map by `AppView` + Label lookup | icon(view) → JSX |
| `use-hash-view.ts` | Two-way sync: URL hash ↔ active view (modern mode only) | Listens to hashchange; updates hash on view change (skips "edit" view) |
| `use-media-query.ts` | `useMediaQuery(query) → boolean` for responsive breakpoints | |
| `use-sidebar-collapsed.ts` | `useSidebarCollapsed() → [collapsed, toggle]` persisted to localStorage | |
| **Views** | | |
| `task-edit-view.tsx` | Full-page task editor in `<main>` when `activeView === "edit"` | Reuses `TaskFormFields` (Phase 2) |
| `settings-view.tsx` | Full-page Settings in `<main>` when `activeView === "settings"` | Left nav rail (8 sections) + right panel (Phase 4B) |
| `settings-sections/appearance-section.tsx` | Theme selector (Light / Dark / System) | Wired to `useTheme()` |
| `settings-sections/localization-section.tsx` | Language + holiday countries | |
| `settings-sections/general-section.tsx` | General app settings | |
| `settings-sections/notifications-section.tsx` | Reminder preferences | |
| `settings-sections/ai-section.tsx` | Claude API key + model selection | |
| `settings-sections/jira-settings.tsx` | Jira URL / email / API token + test-connection | |
| `settings-sections/storage-config.tsx` | Backend picker (Browser / Local / SharePoint / Turso) | |
| `settings-sections/integrations-section.tsx` | M365 + Turso toggles + settings | |
| **Task Editor** | | |
| `task-form-modal.tsx` | Task create/edit modal (classic mode); returns null when closed | ~491 lines extracted from task-manager |
| `task-form-fields.tsx` | Shared form fields (5 sections via `TaskFormSection`) + validation | Consumed by both TaskFormModal and TaskEditView |
| `task-form-context.tsx` | `useTaskForm() → { form, setForm, editingId, taskModalOpen, ... }` | Manages form draft state |
| `task-row.tsx` | One row in the table; inline actions (complete, inquiry, Jira, etc.) | Memo-wrapped |
| **Shared Components** | | |
| `task-manager-ui.tsx` | Render logic: header + banner area + main content split | Extracted from task-manager to keep god-component readable |
| `app-modals.tsx` | Modal stacking container; renders all open modals in z-order | |
| `action-menus.tsx` | Shared Voice·Export·Help·Version menu cluster | Consumed by both classic & modern |
| `modal-header.tsx` | Shared drag-handle header for all modals | Wires `use-draggable.ts` |
| `use-draggable.ts` | `useDraggable(ref)` for repositionable modals | Pure DOM, no state library |
| `voice-command-context.tsx` | Context for in-modal voice command dispatch | |
| `segmented-control.tsx` | 2-segment toggle (used by ResourcesPanel, theme selector) | |
| `info-tooltip.tsx` | Accessible tooltip with icon | |
| `modal.tsx` | Styled `<Modal>` wrapper with backdrop + animations | |
| **Inputs & Forms** | | |
| `labels-input.tsx` | Typed-list input for task labels | |
| `combo-input.tsx` | Combobox for groups, priority, health override | |
| `contact-input.tsx` | Assignee name + email + datalist autocomplete | Survives task deletion via contacts.ts |
| `combobox-shared.tsx` | Shared combobox plumbing: `useCombobox` hook + UI components | Extracted refactor |
| `modal-edit-fields.tsx` | Shared modal edit pieces: `AssigneeField` + `ModalEditFooter` | Used by absence/shift/resource edit modals |
| `dependencies-editor.tsx` | FS/SS/FF/SF predecessor picker with cycle detection | |
| **Budget Panel** | | |
| `budget-panel.tsx` | Budget tab UI: bucket list/editor, allocations, CCI cards | |
| `budget-bucket-modal.tsx` | Modal for editing a bucket: name, PO, type, currency, dates, allocations | |
| `budget-report.ts` | Pure calc engine: CCI ×3, spillover, project rollup | No React |
| `budget-health.ts` | Pure RAG helpers for budget surfaces; gains `marginAmountHealth` (margin RAG, 0.48.0+) | No React; 0.47.0+ |
| `fx.ts` | Pure FX helpers: `resolveFxRate`, `convertAmount` | No React |
| `ecb.ts` | ECB XML parser: `parseEcbRates` | No React |
| `use-fx-rates.ts` | `useFxRates(workspace) → { rates, refresh }` — fetches `/api/ecb` | Client hook |
| **Resources Panel** | | |
| `resources-panel.tsx` | 4 views: Directory, Workload, Calendar, Planning | |
| `resource-directory.tsx` | Address-book table; can open as popout | |
| `resource-calendar.tsx` | 30-day grid (assignee × day) showing tasks/absences/shifts | |
| `resource-capacity.ts` | Pure capacity engine: periods, workdays, capacity calculations | No React; unit-tested |
| `resource-cost.ts` | Pure cost layer: `periodCost`, `formatCurrency` | No React |
| `resource-foundation.ts` | Pure helpers: `seedDisciplines`, `defaultResourcePlan`, etc. | No React |
| `resource-report.ts` | Pure aggregation: `computeResourceReport` | No React |
| `resources-report.tsx` | Read-only resources report; popout window | |
| `resource-edit-modal.tsx` | Address-book editor modal | |
| `resource-workload-rows.ts` | Pure `buildResourceWorkload` engine | No React |
| `roles-modal.tsx` | Discipline × grade rate card | Opened from ResourcesPanel header |
| `use-resource-planner.ts` | Resource planner state hook | |
| **RAID & Reports** | | |
| `raid-panel.tsx` | RAID log; **0.14.2:** sortable columns + severity ranking | Memo-wrapped |
| `raid-report-panel.tsx` | RAID report (summary tiles + 6 By-X tables) | |
| `reports.tsx` | Stats by group, label, status, on-time vs late; RAID + Budget reports present by default (0.48.0+) | Conditional mount |
| `raid.ts` | Pure RAID helpers: severity matrix, status options, cycle detection | No React |
| **Change Log** | | |
| `change-log.ts` | Pure change-control engine: `ChangeItem`/type/status enums, predicates, id/index helpers, `compareChange` comparator, `computeScopeStatus`, `selectTopChanges` | No React; 0.50.0+ |
| `change-panel.tsx` | Change Log view: sortable/filterable register table + add/edit wiring; feeds the `changes`/`change-report` AppView (Registers group) | Conditional mount; 0.50.0+ |
| `change-edit-modal.tsx` | Draggable modal editor for a ChangeItem (type, workflow status, impact, schedule/cost, requestor/approver, decision date, task/RAID link pickers) | Component; 0.50.0+ |
| `change-report-panel.tsx` | Printable Change Report (summary tiles + By-X tables over the change register) | Conditional mount; 0.50.0+ |
| `use-change-log.ts` | `useChangeLog()` hook — change CRUD over WorkspaceContext | Client hook; 0.50.0+ |
| **Chat & Voice** | | |
| `chat-panel.tsx` | Claude chat with tool calls via `dispatcher` | Conditional mount; history in TaskManager |
| `chat-tools.ts` | Tool dispatcher object; CRUD on tasks/RAID | Huge `useMemo` in TaskManager |
| `use-chat-dispatcher.ts` | Hook wrapping chat tools | |
| `voice-button.tsx` + `voice.ts` | Web Speech API integration | Lazy-imported |
| **Activity & Notifications** | | |
| `activity-log-panel.tsx` | Sortable/filterable/searchable CRUD log | Conditional mount |
| `notifications.tsx` | `DueBanner`, `BirthdayBanner`, `JiraTokenBanner` + toast/popup | |
| `reminder-snooze.ts` | localStorage-backed snooze store | Pure; no React |
| `use-reminder-snooze.ts` | `useReminderSnooze(kind) → { isSnoozed, snooze, clear }` | Client hook |
| `birthdays.ts` | `getUpcomingBirthdays` pure engine | No React |
| **Integrations** | | |
| `jira-settings.tsx` | Jira URL / email / token input + test-connection | |
| `jira-api.ts` | Jira client; `JiraApiError` + `classifyJiraError` | Lazy-imported |
| `jira-conflicts-modal.tsx` | Sync conflict resolution UI | Dynamic-imported |
| `adf.ts` | Plain-text ↔ ADF conversion | Shared with server routes |
| `msal-config.ts` | MSAL configuration resolver (M365) | Pure; 0.21.0+ |
| `use-ms-auth.ts` | `useMsAuth() → { isReady, getToken, acquireToken }` | Client hook; lazy-loads msal-browser |
| `sharepoint-backend.ts` | SharePoint storage backend (0.22.0) | Implements `StorageBackend` |
| `outlook-contacts.ts` | `importOutlookContacts(token, limit?) → Contact[]` | Pure; 0.23.0+ |
| `use-outlook-contacts.ts` | `useOutlookContacts() → { contacts, isLoading, error }` | Client hook |
| `outlook-import-modal.tsx` | Preview-and-pick dialog for Outlook contacts | Modal component; 0.23.0+ |
| `outlook-calendar.ts` | `importOutlookCalendar(token, startDate, endDate) → Absence[]` | Pure; 0.24.0+ |
| `use-outlook-calendar.ts` | `useOutlookCalendar() → { events, isLoading, error }` | Client hook; 0.24.0+ |
| `outlook-calendar-import-modal.tsx` | Preview-and-pick dialog for Outlook calendar | Modal component; 0.24.0+ |
| `turso-config.ts` | Turso configuration resolver | Pure; 0.25.0+ |
| `turso-backend.ts` | Turso HTTP `/v2/pipeline` storage backend | Implements `StorageBackend`; 0.25.0+ |
| `storage-config.tsx` | Backend picker UI; gates on auth readiness | |
| **Theme & UI Tokens** | | |
| `theme.ts` | Pure helpers: `resolveTheme`, `readStoredTheme` | 0.15.0+; no React |
| `use-theme.tsx` | `ThemeProvider` + `useTheme() → { theme, setTheme }` | 0.15.0+; reads `lop-theme` from localStorage |
| `globals.css` | AIPM 9-color palette tokens + Tailwind / print rules | Dark-blue sidebar, light/dark theme, `.print-root` scoping |
| `table-styles.ts` | `TABLE_HEAD_CLASS` Dark-Blue headers + LOP zebra | Shared constant (0.31.0+) |
| `view-styles.ts` | `VIEW_PANE_CLASS`, `INNER_TABLE_CLASS` pane chrome | Shared constants |
| **Dashboard & Milestones** | | |
| `dashboard.ts` | `computeDashboard(workspace, today) → HealthModel` with overall/schedule/budget/scope RAG + milestone contribution + EVM SPI/CPI folds; **0.50.0:** Scope RAG now computed from the pending-change backlog (`computeScopeStatus`) + a Changes subsection | Pure; 0.43.0+ |
| `milestones.ts` | `milestoneStatus(m, tasks, today)`, `partitionMilestones(milestones, tasks)` for on-track/at-risk/delayed bucketing | Pure; 0.44.0+ |
| `evm.ts` | `computeEvm(tasks, plan) → { SPI, CPI, SV, CV, ... }` Earned Value metrics; folds Schedule/Budget RAG calculations | Pure; 0.45.0+ |
| `dashboard-panel.tsx` | Health Dashboard view: health cards, milestone timeline, EVM charts | Conditional mount; 0.43.0+ |
| `dashboard-sections/` | Reusable dashboard subsections (HealthCard, MilestoneTimeline, EVMChart) | Components; 0.43.0+ |
| `milestones-panel.tsx` | Milestones view: list, add, edit, link to tasks | Conditional mount; 0.44.0+ |
| `milestone-edit-modal.tsx` | Modal editor for milestone name/date/description/linkedTaskIds | Component; 0.44.0+ |
| `version-info.tsx` | VersionInfo body + VersionInfoModal (reused by Version popover, sidebar version line, Settings footer) | Component; 0.46.0+ |
| `rag-badge.tsx` | `RagBadge` — lettered R/A/G badge pill shared by dashboard pills, budget bucket metrics, and the Budget Report status column | Component; 0.47.0+ |
| `burndown-chart.tsx` | `BurndownCharts` — dependency-free SVG twin remaining-hours + remaining-EUR burn-down charts; currency symbol + axis tick labels (0.48.0+); consumed by dashboard and Budget Report | Component; 0.47.0+ |
| **Baseline / Variance Trends** | | |
| `turso-pipeline.ts` | Shared Turso `/v2/pipeline` HTTP runner (`runTursoPipeline`) extracted from turso-backend; reused by the snapshot store | Pure; 0.49.0+ |
| `snapshot.ts` | Pure snapshot domain: `bucketKey`, `expectedBuckets`/`detectGaps`, `forecastEndDate`, `buildSnapshot`, `computeVariance` | Pure; 0.49.0+ |
| `snapshot-schema.ts` | Append-only snapshot Turso table DDL (disjoint from the workspace `TABLE_NAMES`) | Pure; 0.49.0+ |
| `snapshot-store.ts` | Append-only snapshot read/write over `runTursoPipeline` (separate from the workspace save cycle) | 0.49.0+ |
| `use-snapshots.ts` | `useSnapshots()` hook — load/capture snapshots, baseline flag, cadence auto-capture | Client hook; 0.49.0+ |
| `trend-chart.tsx` | Dependency-free SVG KPI trend chart (per-period series with gap markers) | Component; 0.49.0+ |
| `trends-panel.tsx` | Trends view (Overview group): baseline-vs-current variance table, KPI trend charts, snapshot list + manual capture | Conditional mount; 0.49.0+ |
| **Utilities** | | |
| `date-format.ts` | `localeFor(lang)`, `shortDateRange`, `formatExpiryDate` | Pure |
| `duration.ts` | `parseDuration`, `formatDuration`, `effortProgress` | Pure; Jira basis (1w=5d=2400m) |
| `contacts.ts` | localStorage address book; `Contact`, `ContactsMap` | Survives task deletion |
| `activity-log.ts` | localStorage CRUD audit log; `ActivityEntry`, `ActivityKind` | Capped 500 entries |
| `use-resizable.ts` | Corner-drag resize hook with localStorage persistence | |
| `read-only-guard.ts` | `makeEditGuard(isReadOnly, notify)` for popout mirrors | Pure |
| `read-only-mirror-banner.tsx` | Read-only state banner shown in popouts | |
| `jira-token-status.ts` | `getJiraTokenAlert(jira, today, leadDays)` alert derivation | Pure |
| `use-settings.ts` | Settings context hook (separate from workspace) | |
| `use-bulk-operations.ts` | Bulk-edit operations (e.g. apply field to selected) | |
| `markdown.tsx` | Renders chat / report markdown safely | |
| `export.ts`, `export-ooxml.ts` | Export engines (CSV/MD/JSON/DOCX/XLSX/PPTX) | Lazy-imported |
| `zip.ts` | Hand-rolled STORE-method ZIP writer | No external dep |
| `sanitize.ts` | Input validation for all inbound fields | Pure |
| `health.ts` | RAG status computation + color helpers; gains `healthText` (colorized overall text, 0.48.0+) | Pure |
| `due-dates.ts` | Due-date sorting + alertable task logic | Pure |
| `settings-types.ts` | `Settings` shape re-exported from settings-menu | Shared type |
| `types.ts` | `Task`, `RaidItem`, `Absence`, `Resource`, `Role`, etc. | Core data schemas |
| `storage.ts` | `StorageBackend` interface + IDB/File/SharePoint/Turso impls | ~1500 LOC |
| `i18n.ts` | Translation keys + function; lazy-loads `i18n.de.ts` | ~700 keys |

## Lazy-loaded modules

| Trigger | Module loaded | Saved KB (gzipped) |
|---|---|---|
| Tab first opened | `chat-panel`, `gantt`, `reports`, `raid-panel`, `resources-panel`, `activity-log-panel`, `resources-report` (all via `next/dynamic`) | varies |
| `?popout=address-book` opened | `resource-directory` (address-book popout window, live-synced via `BroadcastChannel`) | small |
| M365 toggle enabled first time | `@azure/msal-browser` (via `use-ms-auth.ts`) | ~50 KB |
| Outlook contacts/calendar import opened | `outlook-import-modal.tsx`, `outlook-calendar-import-modal.tsx` + hooks | small |
| Jira config first used | `jira-api.ts` (~400 LOC) | ~10 KB |
| User picks DOCX/XLSX/PPTX export | `export-ooxml.ts` (~1,300 lines, plus `zip.ts`) | ~45 KB |
| Active language is `de` | `i18n.de.ts` (~700 keys) | ~20 KB |
| User selects ≥1 holiday country | `date-holidays` (+ moment, moment-tz) | ~100 KB+ |
| User opens Absence or Shift editor | `absence-edit-modal`, `shift-edit-modal` | small |
| Jira sync conflict raised | `jira-conflicts-modal` | small |

## Routing

App Router with a single visible page (`/`). API routes under `/api/jira/*`
(see [backend.md](backend.md)) and `GET /api/ecb` (ECB FX rates proxy, cached).
Middleware `src/proxy.ts` runs on every HTML response.
URL hash (`#gantt`, `#raid`, etc.) drives the active view in modern mode via
`useHashView` (two-way sync).
