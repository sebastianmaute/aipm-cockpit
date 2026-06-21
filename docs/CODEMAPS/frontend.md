<!-- Generated: 2026-06-11 | Files scanned: ~150 (src/app/*.tsx, *.ts, settings-sections/, dashboard-sections/) | Token estimate: ~1850 | Updated for 0.29.0–0.60.0: modern sidebar layout + UI-consistency sweep + Health Dashboard + Milestones + Earned Value + budget/dashboard RAG + burn-down + UI refinements + baseline/variance trends + change-control Log + stakeholder report + influence/interest matrix + Simple/Modular/Advanced mode + stakeholder communication reminders + input sanitization feedback + configurable multi-section export + AI usage panel + information-flows diagram + multi-project portfolio (file & Turso) + SharePoint picker + document links on 6 entities + data version history (capture/compare/selective restore, Turso) [0.66.0–0.69.0] + standalone Documents tab aggregating links across entities + project [0.81.0]; AI orchestration SP0–SP5 (Ask-Claude top-bar menu, operating-guide grounding, write tools, doc ingestion, AI project creation/import via step0-import-panel, Action-Center "Analyze with AI", scheduled jobs, next-actions weight suggestions) [0.97.0–0.110.0]; Task.status + Kanban Table/Board toggle (`task-kanban-board.tsx`, `task-status-*`) [0.107.0–0.108.0]; steering-committee view + Outlook push [0.111.0]; guided tour overlay [0.112.0]; timezones — operating tz, display-tz switcher, calendar world-clock strip [0.113.0–0.115.0] -->

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
        │       ├── src/app/top-bar.tsx (ProjectSwitcher + title + New task + Alerts + AI pop-out + menus)
        │       │   └── src/app/action-menus.tsx (Voice·Export·Help·Version cluster)
        │       └── <main> (single active view + banners)
        │           ├── ProjectsPanel (portfolio mgmt; `projects` view)
        │           ├── ProjectEmptyState (modal when 0 projects)
        │           ├── TaskEditView (full-page task editor; Phase 2)
        │           ├── SettingsView (full-page Settings; Phase 4B)
        │           ├── Open Points tab (task table + workspace section tabs)
        │           └── Workspace section (main tabs + popout-only)
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
        │   ├── SteeringCommitteePanel (steering-committee-panel.tsx) — conditional mount ★ (0.111.0+)
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
| `activeTab` (`AppView`, nav-config.ts) | `"projects"` (Portfolio group) \| `"open-points"` \| `"chat"` \| `"dashboard"` \| `"trends"` \| `"milestones"` \| `"gantt"` \| `"resources"` (+ sub-views `"directory"` \| `"workload"` \| `"calendar"` \| `"planning"` \| `"manage-roles"`) \| `"budget"` \| `"budget-report"` \| `"raid"` \| `"raid-report"` \| `"changes"` \| `"change-report"` \| `"stakeholders"` \| `"raci"` \| `"stakeholder-map"` \| `"steering-committee"` (0.111.0+) \| `"documents"` \| `"reports"` \| `"activity"` \| `"actions"` \| `"history"` \| `"settings"` \| `"edit"` (main-only); synced to URL hash via `useHashView`. Nav groups: **Portfolio** (projects) / Overview / Plan / Registers / System |
| `budgets: BudgetBucket[]`, `fxRates: FxRates \| null` | Persisted via `StorageBackend.save()`; lives in `WorkspaceContext`; `fxRates` refreshed on demand via `useFxRates` (Refresh ECB rates button) |
| `dueSnooze` / `birthdaySnooze` / `jiraTokenSnooze` | `useReminderSnooze("due")` / `useReminderSnooze("birthday")` / `useReminderSnooze("jiraToken")` — each yields `{ isSnoozed, snoozedUntil, snooze, clear }`; banners are gated on `!isSnoozed` |
| `raidFilterTaskId` | Cross-tab nav: jump from a task row to RAID pre-filtered for that task |
| `workspaceCollapsed`, `taskModalOpen`, `absenceDraft`, `shiftDraft` | Modal / collapse state |
| `hydrated`, `i18nReady` | Render gates; `i18nReady=false` returns null until lang dict loads |

## Key components

| File | Role | Notes |
|---|---|---|
| **Layout & Navigation** | | |
| `modern-shell.tsx` | Modern layout shell: sidebar + top-bar + main pane + banners | Accepts slots for `editView`, `settingsView`, `workspace`, `tasksSection`, `topBarMenus`, `sidebarFooter` |
| `sidebar.tsx` | Dark-blue sidebar with logo, nav, collapse toggle, footer | Responsive w-64 / w-16 |
| `sidebar-nav.tsx` | Nav groups (Overview / Plan / Registers / System) + items | Renders icon + label pairs via nav-icons |
| `sidebar-footer.tsx` | Version + theme toggle in sidebar footer | Small slot |
| `top-bar.tsx` | Title + New task button + Alerts bell + menu cluster | Optional sidebar toggle button in `onToggleSidebar` prop |
| `nav-config.ts` | `AppView` union, `NAV_GROUPS`, slug↔view mapping | Pure config; no React |
| `nav-icons.tsx` | SVG icon map by `AppView` + Label lookup | icon(view) → JSX |
| `use-hash-view.ts` | Two-way sync: URL hash ↔ active view (modern mode only). Hash grammar: `#<view>` navigates to a view; `#<view>/<id>` additionally queues a consume-once open of that item (e.g. `#raid/42` opens the RAID register and highlights item 42). | Listens to hashchange; updates hash on view change (skips "edit" view) |
| `use-media-query.ts` | `useMediaQuery(query) → boolean` for responsive breakpoints | |
| `use-sidebar-collapsed.ts` | `useSidebarCollapsed() → [collapsed, toggle]` persisted to localStorage | |
| **Views** | | |
| `task-edit-view.tsx` | Full-page task editor in `<main>` when `activeView === "edit"` | Reuses `TaskFormFields` (Phase 2) |
| `settings-view.tsx` | Full-page Settings in `<main>` when `activeView === "settings"` | Left nav rail (11 sections: Mode / Appearance / Localization / General / Notifications / AI / Jira / Storage / Integrations / Export / Information flows) + right panel (Phase 4B) |
| `settings-sections/appearance-section.tsx` | Theme selector (Light / Dark / System) | Wired to `useTheme()` |
| `settings-sections/localization-section.tsx` | Language + holiday countries | |
| `settings-sections/general-section.tsx` | General app settings | |
| `settings-sections/notifications-section.tsx` | Reminder preferences | |
| `settings-sections/ai-section.tsx` | Claude API key + model selection + session/weekly token-cap inputs + consent grant/revoke; embeds `AiUsagePanel` | |
| `settings-sections/ai-usage-panel.tsx` | `AiUsagePanel` — session + weekly token-usage bars (green < 80 %, pink ≥ 80 %) + next-reset label; reads `AiUsageProvider` | Component; 0.57.0+ |
| `settings-sections/export-section.tsx` | Configurable multi-section export: per-section toggle checkboxes (project / tasks / RAID / changes / milestones / stakeholders / budgets / resources / roles / absences / shifts / status) writing `settings.export` (`ExportConfig`) | 0.57.0+ |
| `settings-sections/information-flows-section.tsx` | Information-flows diagram: inline SVG showing the PWA at centre wired to local storage, Turso, Jira, M365 (Graph + MSAL), and the Anthropic API, plus a legend | 0.57.0+ |
| `settings-sections/jira-settings.tsx` | Jira URL / email / API token + test-connection | |
| `settings-sections/storage-config.tsx` | Backend picker (Browser / Local / SharePoint / Turso) | |
| `settings-sections/integrations-section.tsx` | M365 + Turso toggles + settings; snapshot recording cadence; hosts the portfolio-mode **File \| Turso** selector (persists to localStorage + reloads, 0.59.0+) | |
| `settings-sections/mode-section.tsx` | Simple / Modular / Advanced mode selector: preset buttons, per-module checkboxes, derived mode badge. Now **per-project**: commits write the current project's `Workspace.features` (no Save & reload — `useFeaturesSync` mirrors it into reactive `settings.features`) | `Settings.features` gates nav/automation/reports by mode; per-project 0.72.0+; 0.54.0+ |
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
| **Stakeholders** | | |
| `stakeholders.ts` | Pure stakeholder engine: `Stakeholder`/`RaciEntry` types, engagement/influence/interest enums, id helpers, `computeRaciWarnings` (zero/multiple Accountable per milestone) | No React; 0.52.0+ |
| `stakeholders-panel.tsx` | Stakeholder register view: sortable/filterable table + add/edit wiring; `stakeholders` AppView (Registers group) | Conditional mount; 0.52.0+ |
| `raci-panel.tsx` | RACI matrix: stakeholder × milestone grid (R/A/C/I cells) with Accountable-count soft warnings; `raci` AppView (Registers group) | Conditional mount; 0.52.0+ |
| `stakeholder-map-panel.tsx` | Influence/Interest grid: 2-D scatter plot with colour-coded quadrants (Manage Closely / Keep Satisfied / Keep Informed / Monitor); `stakeholder-map` AppView (Registers group) | Conditional mount; 0.52.0+ |
| `stakeholder-edit-modal.tsx` | Draggable modal editor for a Stakeholder (name, role, org, contact, engagement, influence/interest scores, Resource link) | Component; 0.52.0+ |
| `use-stakeholders.ts` | `useStakeholders()` hook — stakeholder + RACI CRUD over WorkspaceContext | Client hook; 0.52.0+ |
| `influence-interest-matrix.tsx` | Clickable 3×3 influence/interest grid used by the stakeholder editor (replaces the two dropdowns; one click sets both axes) | Component; 0.53.0+ |
| `stakeholder-report-panel.tsx` | Read-only stakeholder report (summary tiles, quadrant grid, RACI coverage with missing/multiple-Accountable warnings, register table), embedded in Reports | Conditional mount; 0.53.0+ |
| `stakeholder-comms.ts` | Pure communication-reminder engine: quadrant engagement policy → "reach out" items for manage-closely stakeholders ahead of due-soon milestones, open RAID items, and pending changes (via `stakeholderIds` links) | No React; 0.55.0+ |
| `use-stakeholder-comms.ts` | `useStakeholderComms()` hook — computes comms reminder items + banner/modal state, mode-gated by stakeholders/milestones/RAID/changes flags | Client hook; 0.55.0+ |
| **Version history (Turso)** | | |
| `history-panel.tsx` | History view (`history` AppView, System group, Turso + History module only): version timeline with per-row change summary, compare (vs current / two-version), and selective restore (tick records or fields → Restore selected) | Conditional mount; 0.66.0+ |
| `version-diff-view.tsx` | Field-level diff grouped by entity type (tasks, RAID, milestones, resources, budget, …); each record expands before→after, with optional restore checkboxes | Component; 0.66.0+ |
| `use-version-history.ts` | `useVersionHistory()` hook — capture (auto idle-debounced + manual checkpoints), compare, selective restore, and retention prune over `version-store.ts` | Client hook; 0.66.0+ |
| `milestones.ts` | Pure milestone helpers: `filterMilestones` (name + status filter) + milestone status classification | No React; 0.55.0+ |
| **Action Center learning (0.95.0+)** | | |
| `action-learning.ts` | Pure learning model: per-kind outcome stats → time-decayed `bias` (evidence-gated) + explicit overrides; no React, no i18n | Pure; 0.95.0+ |
| `use-action-learning.ts` | `useActionLearning(...) → { bias, state, overrides, record, setOverride, reset }` — gated capture hook; persists to the picked store (local or Turso), serialized saves, load-failure guard | Client hook; 0.95.0+ |
| `learning-insights.tsx` | `LearningInsights` view: per-kind learned bias + evidence counts (what the loop has learned); reachable from the Action Center | Component; 0.95.0+ |
| `action-row.tsx` (learning hint) | Per-row learning hint badge showing whether an action kind was nudged up/down by the learned bias (`learning: { bias, moved }` on the ranked action) | 0.95.0+ |
| `settings-sections/next-actions-section.tsx` (learning controls) | Next-actions settings: opt-in learning toggle, store choice (local / Turso), and "Reset learned data" | 0.95.0+ |
| **Documents** | | |
| `documents.ts` | Pure aggregator: `collectDocuments({tasks,raid,changes,milestones,stakeholders,project})` → flat `DocRef[]` (one per link) with its source `{kind,id,name,view}` and array index | No React; 0.81.0+ |
| `documents-panel.tsx` | Documents view (`documents` AppView, Registers group): one table of every linked file across the 5 entities + project — open link, jump to source editor (`requestOpen`), remove, or attach a new link to any target via `DocumentLinksFieldGated` | Conditional mount; 0.81.0+ |
| **Task status & Kanban (0.107.0–0.108.0)** | | |
| `task-status.ts` | Pure i18n-free status engine: `TaskStatus` enum, `applyStatusChange(task,next,today)` (SOLE writer of status+completedDate, keeps the `Done ⟺ completedDate` invariant), `migrateTaskStatus` (run on all six load paths), `isTaskFinished` (Done\|Cancelled) | Pure; 0.107.0+ |
| `task-status-ui.ts` | UI label/colour map for each status (AIPM palette tokens only) | Pure; 0.107.0+ |
| `task-status-badge.tsx` / `task-status-select.tsx` | Status badge + the shared `TaskStatusSelect` dropdown (keyboard path; disabled for Jira-synced tasks); used by both the table row and Kanban cards | Components; 0.107.0+ |
| `task-kanban.ts` | Pure board engine: column grouping + ordering by status | Pure; 0.108.0+ |
| `task-kanban-board.tsx` | Board view (Table/Board toggle on the tasks pane via `settings.tasksViewMode`): native HTML5 DnD columns; renders cards via `task-kanban-card.tsx`. Renders OUTSIDE `RowContextProvider` — cards take everything as props. NOT in the axe `A11Y_VIEWS` (table view is the gated one) | Component; 0.108.0+ |
| `task-kanban-card.tsx` | One Kanban card: title, badges, per-card `TaskStatusSelect` | Component; 0.108.0+ |
| `task-raid-badge.tsx` | `RaidBadge` — RAID-link badge taking `lang` + `onJumpToRaid` as props (extracted so the prop-only Kanban card can render it without `useTaskRowContext`) | Component; 0.108.0+ |
| **Steering committee (0.111.0+)** | | |
| `steering-committee-panel.tsx` | Steering-committee view (`steering-committee` AppView, Registers group): committee name, member-resource picker, meeting schedule (date/title/agenda/location), and "information schedule" lead-day rules; "Push to Outlook" pushes meetings + reminder due-dates | Conditional mount; 0.111.0+ |
| `steering-reminders.ts` | Pure engine: `dueInfoReminders(committee, today)` → tiered (`now`/`soon`/`upcoming`) pack reminders | Pure; 0.111.0+ |
| `committee-calendar-reconcile.ts` | Pure reconcile planner: `planCommitteeReconcile(committee, today)` diffs committee meetings + reminder due-dates vs pushed Outlook events → create/update/delete plan (idempotent re-push) | Pure; 0.111.0+ |
| `use-committee-outlook-push.ts` | `useCommitteeOutlookPush()` — wires `acquireToken(Calendars.ReadWrite)` + reconcile plan to push committee meetings/reminders; opt-in, M365-gated | Client hook; 0.111.0+ |
| `next-actions/providers/committee-info.ts` | Next-actions provider surfacing committee pack reminders into the Action Center | Pure; 0.111.0+ |
| **Guided tour (0.112.0+)** | | |
| `app-tour.ts` | Pure tour model: `TOUR_STEPS` / `TOUR_ANCHORS` / `visibleSteps(features)` / `clampStep` | Pure; 0.112.0+ |
| `tour-overlay.tsx` | `TourOverlay` — first-run modern-layout walkthrough (spotlight + modal steps) + "Explore a demo project" + Help-menu replay; never in classic layout / popouts | Component; 0.112.0+ |
| `use-tour.ts` | `useTour()` — drives step progression; persists seen state to `settings.tourSeen` (per-device) | Client hook; 0.112.0+ |
| **Timezones (0.113.0–0.115.0)** | | |
| `timezone.ts` | Pure tz core: `isValidTimeZone`, `browserTimeZone`, `tzZones`, `todayInZone(now,tz)`, `formatInZone`, `resolveTimezone(overrideTz, projectTz)` — makes day-boundary logic follow the resolved IANA zone instead of UTC | Pure; 0.113.0+ |
| `settings-sections/timezone-settings-section.tsx` | Settings → Timezone: per-project operating tz + per-device default (`settings.timezone`) + additional zones (`settings.additionalTimezones`) | Component; 0.113.0+ |
| `tz-display.ts` | `formatDisplayTimestamp(...)` — renders a timestamp in the chosen display zone with the zone shown next to the time | Pure; 0.114.0+ |
| `display-timezone-context.tsx` | `DisplayTimezoneProvider` + hook: session display-zone state (Default / UTC / additional zones), resets on reload | Context; 0.114.0+ |
| `display-tz-switcher.tsx` | `DisplayTzSwitcher` top-bar control selecting the display zone for activity log / version history / trends timestamps | Component; 0.114.0+ |
| `tz-clock.ts` | `formatZoneClock(iso, tz, lang)` — current time + date for a zone | Pure; 0.115.0+ |
| `tz-clock-strip.tsx` | `TzClockStrip` — Calendar world-clock strip showing the live time in the default + each additional zone (rendered only when extra zones are configured) | Component; 0.115.0+ |
| **AI orchestration (0.97.0–0.110.0)** | | |
| `ask-claude-menu.tsx` / `ask-claude-prompts.ts` | Per-view "Ask Claude" top-bar menu (mirrors ExportMenu); pure i18n-free prompt-key model; pick → switch to chat + auto-send via the `requestChat` channel | Component + pure; 0.98.0+ |
| `use-action-analysis.ts` / `action-ai.ts` | Action-Center "Analyze with AI": ONE forced-tool `report_analysis` call; pure `action-ai.ts` validates untrusted model output + `groundEntity` re-validates ids vs the live workspace before any deep-link. Advisory only (no write tool); hook lives ABOVE the view so the result survives remounts; popout-disabled | Hook + pure; SP4 |
| `ai-action-row.tsx` | Separate row component for AI-suggested actions (above the now/soon/monitor tiers) | Component; SP4 |
| `scheduled-job-analysis.ts` | Non-hook `runJobAnalysis` (SP4's call extracted) the scheduled-jobs runner loops; `use-action-analysis` delegates to it | Pure-ish; SP5 |
| `use-scheduled-job-runner.ts` / `use-scheduled-jobs.ts` | Runner lives ABOVE the view: runs DUE jobs on mount/visibility/5-min tick, serial + overlap-guarded, fail-once-per-slot; CRUD hook over `scheduled-jobs-store.ts`. Gated on key + `ai.scheduledJobs === true` (opt-in) | Client hooks; SP5 |
| `weight-suggestion-ai.ts` / `weight-suggestion-call.ts` / `next-actions-tuning.ts` / `use-weight-suggestions.ts` | "Suggest with AI" in next-actions settings: ONE forced-tool `suggest_weights` call (`weight-suggestion-call.ts` mirrors the scheduled-job security exactly); every proposed value passes `parseWeightSuggestions` → the shared `NEXT_ACTIONS_FIELD_COERCE` validators before reaching `settings.nextActions`; per-row Accept. Opt-in widen via `ai.suggestAllNextActionThresholds` | Pure + hook; SP-C (0.109.0) |
| `step0-import-panel.tsx` / `confluence-api.ts` | Create-wizard Step 0 import (Upload-file / SharePoint / Confluence-URL) feeding `useProjectProposal().generate(string \| ContentBlock[])`; `confluence-api.ts` is the pure browser helper hitting `/api/confluence/page` | Component + pure; SP-D (0.110.0) |
| **Input Feedback** | | |
| `sanitize-report.ts` | Pure adjustment-descriptor module: `TextCapAdjustment`, `ClampAdjustment`, `LabelStripAdjustment` — describes what sanitize.ts changed so editors can surface it | No React; 0.56.0+ |
| `field-feedback.tsx` | `CharCounter` (approaches-cap counter badge), `FieldNotice` (inline on-blur notice), `useAdjustmentTracker` (accumulates per-save adjustment list for the toast) | Components + hook; 0.56.0+ |
| `toast-context.tsx` | `ToastContext` + `useToast()` — shared imperative toast access so editor modals can fire the save-time "fields adjusted" toast without prop-drilling | Context; 0.56.0+ |
| **Chat & Voice** | | |
| `chat-panel.tsx` | "AI Assistant": Claude chat with tool calls via `dispatcher`; suggested-prompt chips, Stop button (aborts the in-flight turn), centered resizable pane, consent screen; records token usage to AiUsageProvider. Top-bar exposes a pop-out button (0.57+) | Conditional mount; history in TaskManager |
| `chat-tools.ts` | `runTool` routing + `ToolDispatcher` type; CRUD on tasks/RAID/Changes/Milestones/Stakeholders. Tool SCHEMAS live in pure `chat-tool-defs.ts` (re-exported here); tools are IMPLEMENTED in `use-chat-dispatcher.ts` | Barrel-ish; dispatcher `useMemo` in TaskManager |
| `use-chat-dispatcher.ts` | Hook wrapping chat tools | |
| `voice-button.tsx` + `voice.ts` | Web Speech API integration | Lazy-imported |
| **Activity & Notifications** | | |
| `activity-log-panel.tsx` | Sortable/filterable/searchable CRUD log | Conditional mount |
| `notifications.tsx` | `DueBanner`, `BirthdayBanner`, `JiraTokenBanner` + toast/popup | |
| `raid-review.ts` | Pure logic flagging active RAID items overdue for review (past target date or stale beyond the configured interval) | No React; 0.51.0+ |
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
| `outlook-calendar-write.ts` | Graph calendar client (`Calendars.ReadWrite`): list/create/update/delete all-day milestone events on `/me/events`, events tagged `AIPM:<projectId>` | Pure; 0.96.0+ |
| `calendar-reconcile.ts` | Pure reconcile planner: diffs current project milestones vs existing tagged events → create/update/delete plan (idempotent re-push) | No React; 0.96.0+ |
| `use-outlook-calendar-push.ts` | `useOutlookCalendarPush()` hook — wires `acquireToken(Calendars.ReadWrite)` + reconcile plan to push milestones; opt-in (Settings → Integrations → M365) | Client hook; 0.96.0+ |
| `turso-config.ts` | Turso configuration resolver | Pure; 0.25.0+ |
| `turso-backend.ts` | Turso HTTP `/v2/pipeline` storage backend; optional `projectId` switches to multi-tenant mode (reads/writes only the `projectId` slice of the shared DB; tenant `load()` also fetches the `projects`-table row to set `ws.project`) | Implements `StorageBackend`; 0.25.0+, tenant mode 0.59.0+ |
| `storage-config.tsx` | Backend picker UI; gates on auth readiness | |
| **Multi-project / Portfolio** | | |
| `projects-panel.tsx` | Projects management view (`projects` AppView, Portfolio group): registered-project list with per-row Switch / Edit / Export / Delete; in Turso mode the destructive action is Archive plus a "Show archived" subsection (Restore + permanent-delete). Purely presentational — all side-effects delegated to callback props | Conditional mount; 0.58.0+ |
| `project-switcher.tsx` | `ProjectSwitcher` — current-project indicator + dropdown switcher (list + Load-from-file + New); rendered by both classic `AppHeader` and modern `TopBar`; `readOnly` non-interactive variant for popouts | Component; 0.58.0+ |
| `project-empty-state.tsx` | Non-dismissable onboarding modal shown when the registry has zero projects: Create-project (reveals `CreateProjectForm`) or Load-from-file | Component; 0.58.0+ |
| `create-project-form.tsx` | `CreateProjectForm` — file-format selector (json/csv/md) above the shared `ProjectForm` (create mode); hosted by the panel modal and the empty-state; `hideFormat` for Turso mode | Component; 0.58.0+ |
| `create-project-wizard.tsx` | `CreateProjectWizard` — 3-step create flow: **(1) Details** (reuses `CreateProjectForm`, captures meta+format and advances), **(2) Template** (pick a built-in/user template or Blank; seeds the function set from `template.features`), **(3) Functions** (mode presets + per-module checkboxes, same UI shape as `ModeSection`, plus optional "include starter content"). Assembles `NewProjectOpts` ({ template?, features, includeSeed }) handed to the host's `onCreate` | Component; 0.72.0+ |
| `use-features-sync.ts` | `useFeaturesSync(setSettings)` — bridge effect mirroring the current project's `Workspace.features` into reactive `settings.features` (the source the module consumers read). Makes per-project functions + mode commits reactive **without a page reload**; `undefined` (legacy / no override) leaves settings untouched; identity-guarded so it never loops | Hook; 0.72.0+ |
| `project-form.tsx` | Shared create/edit `ProjectForm` container: holds the draft, runs `validateProjectMeta` to gate Save, reveals per-field errors on blur/submit, sanitizes via `sanitizeProjectMeta` on submit | Component; 0.58.0+ |
| `project-form-fields.tsx` | Presentational two-group field layout (Identity + People, Customer) for `ProjectForm`; controlled inputs, errors passed in pre-resolved | Component; 0.58.0+ |
| `project-validation.ts` | Pure `ProjectDraft` type + `validateProjectMeta` / `hasProjectErrors` (i18n message keys per field) — single source for submit, display, and Save gating (mirrors task-validation) | Pure; 0.58.0+ |
| `project-options.ts` | Static option sets: identity types (B2E/B2B/B2C/NHI), deployments, regulatory requirements + lookup sets | Pure; 0.58.0+ |
| `nace-sections.ts` | Static `NACE_SECTIONS` list (NACE Rev 2.1 industry sections A–U) | Pure; 0.58.0+ |
| `projects-registry.ts` | Pure registry core (`addProject`/`removeProject`/`setCurrentProject`/… immutable, id-supplied) + guarded localStorage IO (`lop-app:projects`); file-mode source of truth | Pure + IO; 0.58.0+ |
| `project-file-handles.ts` | Dedicated IndexedDB DB (`lop-app-project-handles`) storing per-project `FileSystemFileHandle`s out-of-line, keyed by projectId; avoids touching storage.ts's IDB schema | 0.58.0+ |
| `use-project-switch.ts` | Pure switch/create/load helpers (format→local-kind map, name-from-filename, registry-entry builder); stateful flows live in `use-storage-backend.ts` (persistence core; project flows extracted to `use-storage-file-ops` / `use-storage-turso-ops` hook factories) | Pure; 0.58.0+ |
| `portfolio-mode.ts` | Global portfolio mode (`"file" \| "turso"`) + last-selected Turso project id in localStorage; guarded IO | Pure + IO; 0.59.0+ |
| `turso-portfolio.ts` | Turso project CRUD over the shared DB's `projects` table (list/listArchived/create/updateMeta/archive/restore/hardDelete); ensures schema on every call | 0.59.0+ |
| `type-to-confirm-dialog.tsx` | `TypeToConfirmDialog` — reusable destructive confirm modal; confirm button stays disabled until the exact value (e.g. project name) is typed; used for hard-delete | Component; 0.59.0+ |
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
| `dashboard-sections/health-pill.tsx` | `HealthPill` — RAG dot + label + colour-name span; used across the dashboard health band | Component; 0.43.0+ |
| `dashboard-sections/registers-band.tsx` | `RegistersBand` — Top-RAID / overdue + due-soon tasks / milestones cards with deep-link buttons; `showRaid`/`showMilestones` mode gates | Component; 0.43.0+ |
| `milestones-panel.tsx` | Milestones view: list, add, edit, link to tasks; **"Push to Outlook"** button (0.96.0+) reconciles milestones into the Outlook calendar via `use-outlook-calendar-push.ts` (opt-in, M365-gated) | Conditional mount; 0.44.0+ |
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
| `help-search.ts` | Pure helpers for the Help full-text search (section matching + match-highlight segmentation) | Pure; 0.51.0+ |
| `export.ts`, `export-ooxml.ts` | Export engines (CSV/MD/JSON/PDF/DOCX/XLSX/PPTX); honour `ExportConfig` per-section toggles (0.57+). `export-ooxml.ts` is a barrel re-exporting `buildDocx`/`buildXlsx`/`buildPptx` from `export-docx`/`-xlsx`/`-pptx` over `export-ooxml-shared` | Lazy-imported |
| `export-sections.ts` | Pure generic export-sections model + `buildExportSections(ws, cfg, lang)`: derives ordered `ExportSection[]` (title/columns/rows per entity) from the same CSV column constants + field-to-string helpers; gated by `ExportConfig` toggles AND non-empty data. Single source of truth consumed by all format builders | Pure; 0.57.0+ |
| `zip.ts` | Hand-rolled STORE-method ZIP writer | No external dep |
| `sanitize.ts` | Input validation for all inbound fields. Barrel (`export *`) over `sanitize-core` (primitives + caps) / `sanitize-entities` / `sanitize-records` | Pure |
| `health.ts` | RAG status computation + color helpers; gains `healthText` (colorized overall text, 0.48.0+) | Pure |
| `due-dates.ts` | Due-date sorting + alertable task logic | Pure |
| `feature-modules.ts` | Module registry (`FEATURE_MODULES`, `FeatureModuleId`, `ALL_MODULE_IDS`) + pure helpers: `sanitizeFeatures()`, `deriveMode()`, `isModuleEnabled()` / `isViewEnabled()`, `enabledNavViews()`, `visibleReports()`, and `disabledViewRedirect(active, features, layout, isPopout)` — where the app lands when the active view's module is disabled (applied by the redirect effect in task-manager, deps include `settings.features`) | Pure; `Settings.features` gates nav/automation/reports by mode; 0.54.0+ |
| `new-project-workspace.ts` | `buildNewProjectWorkspace` — assembles a fresh `Workspace` from `NewProjectOpts` ({ template?, features, includeSeed }): applies the chosen template, stamps per-project `Workspace.features`, and optionally seeds starter content | Pure; 0.72.0+ |
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
| User picks DOCX/XLSX/PPTX export | `export-ooxml.ts` barrel → `export-docx`/`-xlsx`/`-pptx` + `export-ooxml-shared`, plus `zip.ts` | ~45 KB |
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

## SharePoint picker + document links (0.60.0+)

| Module | Description | Notes |
|--------|-------------|-------|
| `sharepoint-picker-modal.tsx` | Custom Microsoft Graph file/folder browser: search sites, navigate libraries and folders, select a file or folder. Returns a `DocumentLink`. | Lazy-loaded; requires M365 sign-in |
| `document-links-field.tsx` | `DocumentLinksField` — renders the list of `DocumentLink[]` attachments with add/remove/open controls; hosts the picker trigger | Shared across all 6 editors |
| `document-links-field-gated.tsx` | Thin gate wrapper: renders `DocumentLinksField` only when M365 integration is enabled; no-ops otherwise | Used by each entity editor |
| `use-sharepoint-browser.ts` | Hook encapsulating Graph site-search + drive/folder navigation state for the picker modal | Pure hook, no JSX |

The gated field is embedded in the task editor (`task-edit-view.tsx` / `task-form-modal.tsx`), RAID editor (`raid-edit-modal.tsx`), change editor (`change-edit-modal.tsx`), stakeholder editor (`stakeholder-edit-modal.tsx`), milestone editor (`milestone-edit-modal.tsx`), and project form (`project-edit-form.tsx`).

## Modal field visibility (Simple / Advanced / Full)

Per-modal field-visibility tiers let users hide rarely-used fields in the 8 edit
modals (task, RAID, change, milestone, stakeholder, resource, absence, budget).
Config is persisted per-project on `Workspace.fieldVisibility`; the default tier
is **Advanced** (`undefined` config resolves to it). Required/validated fields are
always shown and locked.

| Module | Description | Notes |
|--------|-------------|-------|
| `modal-fields.ts` | Registry: `MODAL_FIELDS` (per-modal field list with `id`/`labelKey`/`tier`/`required`), `MODAL_IDS`, `ModalId` / `FieldTier` types | Pure; tiers nest (simple ⊂ advanced ⊂ full); required fields are pinned to the simple tier |
| `field-visibility.ts` | Pure resolver: `applyTier`, `tierFields`, `visibleFields`, `toggleField`, `tierOf`, `sanitizeFieldVisibility` over a `FieldVisibilityConfig`; `DEFAULT_TIER = "advanced"` | Pure; byte-stable serialization (registry order); sanitize re-adds required ids + drops unknowns |
| `use-modal-visibility.ts` | `useModalVisibility(modalId) → { mode, isVisible, setMode, toggleField, reset }` hook over `Workspace.fieldVisibility` | Client hook |
| `modal-field-controls.tsx` | Header control: Simple/Advanced/Full tier switch + a cog popover (per-field checklist; required fields locked) | Component; rendered by each of the 8 edit modals |

## Templates (0.71.0+)

Project templates bundle a `FieldVisibilityConfig`, a set of feature-module toggles, and optional seed content into a reusable `ProjectTemplate`. Applying a template replaces field-visibility wholesale and non-destructively appends re-id'd seed rows to the workspace — existing content is never overwritten.

| Module | Description | Notes |
|--------|-------------|-------|
| `templates.ts` | `ProjectTemplate` / `TemplateSeed` types; `sanitizeTemplate` / `sanitizeTemplates`; `templateFromWorkspace` (snapshot the current workspace state into a new template) | Pure |
| `templates-builtin.ts` | Three in-code starter templates: **builtin-minimal** (bare task list), **builtin-standard** (phased tasks + Gantt + milestones + RAID + change control), **builtin-full** (every module + full delivery skeleton). `builtIn: true` is set in code only — never decoded from stored data | Pure constants |
| `template-apply.ts` | `applyTemplate(ws, tpl, opts)` — pure apply; `remapSeed(ws, seed)` — re-ids every entity in the seed relative to the target workspace and rewires all internal references (task deps, `linkedTaskIds`, `causedByRaidIds`, `stakeholderIds`); out-of-seed refs are dropped, person FKs cleared | Pure |
| `use-templates.ts` | `useTemplates()` — merges built-ins with `Settings.templates[]` (user-saved); exposes `addTemplate`, `updateTemplate`, `removeTemplate`, `duplicateTemplate` CRUD (user templates only; built-ins are immutable) | Client hook; persists via `useSettings` → localStorage |
| `template-suggest.ts` | Pure deterministic heuristic: `complexityScore(meta)` tallies team size, regulated flag, deployment complexity, duration, and identity scale → `suggestTemplate(meta, templates)` returns a `TemplateSuggestion` (templateId + `SuggestTier` + i18n reasons); preselects and badges the recommended template in the creation wizard's Step 2 | Pure; 0.73.0+ |

User templates are persisted in `Settings.templates[]` (localStorage). The Settings view exposes a Templates section (list + save/delete/duplicate). The actions-menu "Save as template" entry calls `templateFromWorkspace`; "Apply template" calls `applyTemplate`.
