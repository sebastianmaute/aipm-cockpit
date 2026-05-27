<!-- Generated: 2026-05-27 | Files scanned: ~78 (src/app/*.tsx, *.ts) | Token estimate: ~1520 -->
<!-- Updated: 2026-05-27 —  0.14.2 RAID header sorting -->
<!-- Updated: 2026-05-27 —  0.15.0 Light/Dark/System theme -->

# Frontend

Single-page Next.js App Router client. One route, one god-component, six
tabbed panels, two popout windows, and a network of inputs / menus.

## Page tree

```
src/proxy.ts                 — middleware (per-request CSP nonce)
src/app/layout.tsx           — root layout, security headers, globals.css. 0.15.0: inlines a no-flash <script> that reads lop-theme and sets .dark on <html> before React hydrates; wraps the tree in <ThemeProvider>
└── src/app/page.tsx         — await connection(); renders <TaskManager />
    └── src/app/task-manager.tsx   (~550 lines after hook extractions; container for everything)
        ├── header (+ button → task modal, ExportMenu, HelpMenu,
        │           VersionMenu, SettingsMenu, VoiceCommandButton)
        ├── banner / due-modal / jira-token-banner  (notifications.tsx)
        ├── workspace section (resizable, collapsible) — 6 tabs + 2 popout-only (read-only mirrors)
        │   ├── tab strip (chat | reports | gantt | raid | budget | resources | activity)
        │   ├── ChatPanel          (chat-panel.tsx)        — mounted; hidden when off
        │   ├── ReportsPanel       (reports.tsx)           — conditional mount  ★
        │   ├── GanttPanel         (gantt.tsx)             — conditional mount  ★
        │   ├── RaidPanel          (raid-panel.tsx)        — mounted; hidden when off  ✚
        │   ├── ResourcesPanel     (resources-panel.tsx)   — conditional mount  ★
        │   ├── BudgetPanel        (budget-panel.tsx)      — conditional mount  ★
        │   ├── ActivityLogPanel   (activity-log-panel.tsx)— conditional mount  ★
        │   ├── ResourcesReportPanel (resources-report.tsx)— popout-only via ?popout=resource-report  ★
        │   └── ResourceDirectory  (resource-directory.tsx)— popout-only via ?popout=address-book  ★
        └── tasks table (always mounted)
            ├── filters / sort / bulk-edit bar
            ├── colgroup / sticky thead
            ├── tbody (non-virtualized; full render of filteredSortedTasks)
            └── per-row actions (mark complete, send inquiry, Jira push…)

Modals:
  TaskFormModal      (task-form-modal.tsx)   — statically imported; renders null when closed
  BulkEditModal      (bulk-edit-modal.tsx)   — statically imported; renders null when closed
  RolesModal         (roles-modal.tsx)       — discipline × grade rate card; opened from ResourcesPanel header
  ResourceEditModal  (resource-edit-modal.tsx) — address-book create/edit/delete; opened from ResourceDirectory
  BudgetBucketModal  (budget-bucket-modal.tsx) — edit a bucket's name, PO, type, currency, fixed amount,
                       dates, spillover successor, FX-rate override, and role allocations (role picker);
                       opened by the Edit button on each bucket card and by "Add bucket" on the new shell
  JiraConflictsModal, AbsenceEditModal, ShiftEditModal — dynamic-imported, only mounted while open

All modals share ModalHeader (modal-header.tsx) which renders a drag handle
and wires use-draggable.ts so every modal window is repositionable. Voice
commands inside modals are wired via VoiceCommandContext
(voice-command-context.tsx) — the context is provided above the modal layer,
so the same dispatcher that handles the main view also handles modal-scoped
commands.
```

★ = conditional mount (only when its tab is active)
✚ = `React.memo` wrapper + stable `useCallback` handlers

All workspace panels are loaded via `next/dynamic({ ssr: false })` —
browser-only APIs (window, IndexedDB, Web Speech, FS Access) cannot be
prerendered.

## State (all in TaskManager)

| State slice | Notes |
|---|---|
| `tasks: Task[]`, `raid: RaidItem[]`, `absences: Absence[]`, `shifts: Shift[]`, `resources: Resource[]`, `roles: Role[]`, `disciplines: Discipline[]`, `grades: Grade[]`, `plan: ResourcePlan` | Persisted via `StorageBackend.save()` (debounced 500 ms); record-level diff per IDB store; `plan` is a kv singleton. Lives in `WorkspaceContext` |
| `rolesModalOpen` | Roles & rates manager modal open/close (see `use-resource-planner.ts`) |
| `tasksRef.current` | Hand-mirrored copy of `tasks` for stable closures in `dispatcher` |
| `settings: Settings` | Language, holiday countries, Jira, AI, notifications. Persisted to `localStorage` (`SETTINGS_KEY`) |
| `contacts: ContactsMap` | Assignee↔email address book; persisted to `lop-app:contacts` |
| `activityLog: ActivityEntry[]` | Up to 500 most recent CRUD events; persisted to `lop-app:activity-log` |
| `colWidths`, `hiddenCols` | UI table prefs in `localStorage` (colWidths debounced 250 ms) |
| `search` + `searchDebounced` + `taskSearchIndex` | 150 ms search debounce + precomputed lowercase index |
| `selectedIds`, `bulkEdit`, `expandedNotes` | Per-session UI only |
| `activeTab` | `"chat"` \| `"reports"` \| `"gantt"` \| `"raid"` \| `"budget"` \| `"resources"` \| `"activity"` \| `"resource-report"` \| `"address-book"` (last two are popout-only) |
| `budgets: BudgetBucket[]`, `fxRates: FxRates \| null` | Persisted via `StorageBackend.save()`; lives in `WorkspaceContext`; `fxRates` refreshed on demand via `useFxRates` (Refresh ECB rates button) |
| `dueSnooze` / `birthdaySnooze` / `jiraTokenSnooze` | `useReminderSnooze("due")` / `useReminderSnooze("birthday")` / `useReminderSnooze("jiraToken")` — each yields `{ isSnoozed, snoozedUntil, snooze, clear }`; banners are gated on `!isSnoozed` |
| `raidFilterTaskId` | Cross-tab nav: jump from a task row to RAID pre-filtered for that task |
| `workspaceCollapsed`, `taskModalOpen`, `absenceDraft`, `shiftDraft` | Modal / collapse state |
| `hydrated`, `i18nReady` | Render gates; `i18nReady=false` returns null until lang dict loads |

## Child component map

| File | Role | Notes |
|---|---|---|
| `task-form-modal.tsx` | Task create/edit form inside a `<Modal>`; reads `form`, `setForm`, `editingId`, `taskModalOpen` from `useTaskForm()` | ~491 lines extracted from task-manager in slice 4; returns null when closed |
| `effort-progress-bar.tsx` | `EffortProgressBar` — fills left→right proportional to time-spent vs original estimate; turns red and shows the percentage when over-budget; greyed when no estimate is set. Ratio via `effortProgress` (`duration.ts`). Rendered inside `task-form-modal.tsx` beneath the estimate/spent row. | 0.13.1 |
| `bulk-edit-modal.tsx` | Bulk-edit dialog (apply field to N selected tasks); reads `bulkEdit`, `setBulkEdit`, `bulkEditOpen` from `useTaskForm()` | ~354 lines extracted from task-manager in slice 4; returns null when closed |
| `gantt.tsx` | Visual timeline with bar drag, dependency arrows, critical path | conditional mount; consumes `absences` to grey out off-days |
| `raid-panel.tsx` | Risks/Assumptions/Issues/Dependencies log | `memo()`-wrapped; mounted-but-hidden. **0.14.2:** column headers are clickable and cycle ascending → descending → off; off restores default order (closed/terminal items stay at bottom). Severity sorted by rank (Low→Critical); missing target dates sort last. Sort comparator: `compareRaid` in `raid.ts`. |
| `reports.tsx` | Stats by group, label, status, on-time vs late | conditional mount |
| `chat-panel.tsx` | Claude chat with tool calls via `dispatcher` | conditional mount; chat history kept in TaskManager state to survive tab switches |
| `chat-tools.ts` | Tool dispatcher object passed to ChatPanel | Huge `useMemo` inside TaskManager |
| `resources-panel.tsx` | Resource Planner: **4 views** — Directory (address-book table; delegates to `resource-directory.tsx`), Workload (per-resource open/overdue counts + upcoming absences; delegates to `resource-workload.tsx`, data built by `buildResourceWorkload`), Calendar (delegates to `resource-calendar.tsx`), and Planning (per-period utilization grid with capacity, internal/external cost, margin, week/month rollup, planning-window control, per-cell absence override). Header buttons open the Roles modal, the Report popout, and the Address Book popout. **0.13.0:** the "weeks" view derives week capacity from the month entry when granularity is set to month (read-only display fix); rollup total cells and the utilization input gained descriptive tooltips. **0.14.1:** planning header gained a percent/hours segmented toggle (next to month/week) wired to `onSetAllUtilizationMode`; switches all resources between modes and converts entered values via `convertUtilization`. The never-used per-resource `onSetUtilizationMode` prop chain was removed. **0.14.3:** assignee names in the Planning grid are clickable (same hover style as Directory/Workload) — calls `onEditResource`. | conditional mount |
| `resource-calendar.tsx` | 30-day grid (assignee × day) showing tasks, absences, shift hours. **0.14.3:** assignee names are clickable — a matched name calls `onEditResource`; an unmatched name calls `onAddResource` prefilled via `splitName` (same hover style as Directory/Workload). | rendered inside ResourcesPanel |
| `budget-panel.tsx` | Budget tab UI: bucket list/editor, per-role allocation grid, CCI cards (margin / cost-performance / consumption), win/loss, spillover controls, reminder surfacing. **0.13.0:** buckets are removable and reorderable by drag (persisted via `BudgetBucket.order`); ECB "Refresh rates" button uses a spinner matching the Jira-sync button style. **0.14.0:** each bucket card has an Edit button that opens `BudgetBucketModal`; "Add bucket" opens the modal on the new shell instead of leaving an uneditable placeholder; per-period hours are still edited in the panel grid. | conditional mount |
| `budget-bucket-modal.tsx` | `BudgetBucketModal` — draggable modal for editing a bucket: name, PO number, type (T&M / Fixed), currency, fixed-price amount, start/end dates, spillover successor, manual FX-rate override (with validation), and role allocation lines (role picker: add/remove roles, assign resources/capacity per role). Opened by the Edit button on each bucket card and by "Add bucket" on the freshly created shell. | 0.14.0 |
| `budget-report.ts` | **Pure** calc engine: `getActivePeriods`, `plannedHoursForAllocation`, `computeBucketReport` (CCI ×3, win/loss, spillover), `computeProjectBudgetRollup`, `getBucketReminders` | no React |
| `fx.ts` | **Pure** FX helpers: `resolveFxRate(bucket, fxRates)` (manual override → cached ECB rate → 1.0 fallback) + `convertAmount` | no React |
| `ecb.ts` | ECB XML parser: `parseEcbRates(xml) → Record<string,number>` (EUR-base daily reference rates) | no React |
| `use-fx-rates.ts` | `useFxRates(workspace) → { rates, refresh }` — fetches `/api/ecb`, caches in workspace `fxRates`; stale-while-revalidate | client hook |
| `resource-capacity.ts` | **Pure** capacity engine: `generatePeriods`, `workdaysInRange`, `absencesForResource`, `absenceWorkdays`, `periodCapacityHours` (percent/hours modes, override absences), `displayCapacityHours` (read-only week↔month rollup), `convertUtilization` (percent↔hours per-period conversion) | Unit-tested against Excel golden fixtures |
| `resource-cost.ts` | **Pure** cost layer: `periodCost(hours, role)` = `{ internal, external, margin }`; `formatCurrency(amount, currency, locale)` with Intl + fallback | |
| `resource-foundation.ts` | **Pure** helpers: `seedDisciplines`/`seedGrades`, `defaultResourcePlan`, `backfillResources` (one-time assignee → resource migration), `nextId`, `findRoleByCombo`, `roleLabel` | |
| `resource-report.ts` | **Pure** aggregation: `computeResourceReport(...) → { totals, perPeriod, perDiscipline, perGrade, perCombo, perResource }`. Unassigned resources counted in capacity, excluded from breakdowns/cost | Feeds the report panel |
| `resources-report.tsx` | Read-only resources report (Tile / Section / Table) — summary tiles + per-period / per-discipline / per-grade / per-combo / per-resource breakdowns. Opens as a popout window | dynamic-imported when `?popout=resource-report` |
| `resource-directory.tsx` | Address-book table for the Directory tab (and the `?popout=address-book` window). One row per `Resource`; clicking the name cell opens `ResourceEditModal`. Exports `ResourceDirectory` (`memo`-wrapped). Header contains "+ Add resource" and optional "Open address book" buttons | rendered inside ResourcesPanel; also mounted as popout |
| `resource-edit-modal.tsx` | Address-book editor modal (`ResourceEditModal`). Create / edit / delete a `Resource` with all contact fields (firstName, lastName, title, company, department, location, businessPhone, email, birthday MM/DD selects, notes). Mirrors `AbsenceEditModal`'s local-draft-state pattern | opened from ResourceDirectory on name click, or "+ Add resource" |
| `resource-workload-rows.ts` | **Pure** `buildResourceWorkload(resources, tasks, absences, shifts, today) → { managed: ManagedWorkloadRow[], unlinked: UnlinkedWorkloadRow[] }`. Managed rows are keyed to `Resource` entities (join by `resourceId` then case-folded display name); unlinked rows collect assignees with no matching resource | feeds `resource-workload.tsx` |
| `roles-modal.tsx` | Discipline × grade rate card; add/rename disciplines & grades; on-demand `Role` creation. **0.13.0:** Discipline/Grade/Internal/External columns are sortable; a divider separates the rate card from the add-combo row; Discipline and Grade selects show a "—" placeholder; Manage-roles and Report buttons have leading icons. | opened from ResourcesPanel header |
| `absence-edit-modal.tsx` | Add/edit Absence (vacation/sick/training/other) | dynamic-imported; opened on demand |
| `shift-edit-modal.tsx` | Add/edit weekly working-hours pattern per assignee | dynamic-imported; opened on demand |
| `activity-log-panel.tsx` | Sortable/filterable/searchable CRUD log (text, wildcard, regex search) | conditional mount; `memo()`-wrapped |
| `modal-header.tsx` | `ModalHeader` — shared drag-handle header rendered at the top of every modal. Wires `use-draggable.ts` to make the modal window repositionable. | 0.13.0 |
| `use-draggable.ts` | Custom hook `useDraggable(ref)` — attaches `pointerdown` drag logic to a handle element and updates a `{ x, y }` offset via CSS `transform`. Pure DOM, no state library. | 0.13.0 |
| `voice-command-context.tsx` | `VoiceCommandContext` + `VoiceCommandProvider` — React context that exposes the voice dispatcher to the modal layer, enabling in-modal voice commands without prop-drilling through every modal. | 0.13.0 |
| `segmented-control.tsx` | Reusable 2-segment toggle (used by ResourcesPanel). Accepts optional `title` prop forwarded to root element | |
| `jira-settings.tsx` / `jira-conflicts-modal.tsx` / `jira-api.ts` | Jira UI + client. `jira-settings.tsx` includes a "Token expires on" date field; test-connection sets/clears `tokenInvalidAt`. `jira-api.ts` exports `JiraApiError` and `classifyJiraError(err): "auth"\|"network"\|"other"` | Calls `/api/jira/*`; `jira-api.ts` lazy-imported via `loadJiraApi()` |
| `adf.ts` | Plain-text ↔ ADF conversion (extracted from `_helpers.ts`) | Shared between client paths and the Jira proxy routes |
| `theme.ts` | **Pure** theme helpers: `resolveTheme(stored, systemDark) → "light"\|"dark"`, `readStoredTheme() → "light"\|"dark"\|"system"`. No React, no side-effects. | 0.15.0 |
| `use-theme.tsx` | `ThemeProvider` + `useTheme()` — reads `lop-theme` from localStorage, watches `prefers-color-scheme`, toggles `.dark` on `<html>`, and exposes `{ theme, setTheme }`. Persists choice, follows system when set to `"system"`. | 0.15.0 |
| `settings-menu.tsx` | Language, holidays, AI, notifications, Jira, storage backend. **0.15.0:** theme control (Light / Dark / System segmented toggle) added at the top of the Settings panel, wired to `useTheme()`. | |
| `help-menu.tsx`, `version-menu.tsx` | Header dropdowns | |
| `version.ts` | `APP_VERSION`, `APP_BUILD_DATE`, `APP_HIGHLIGHT_KEYS` (i18n keys for the Version popover) | |
| `export-menu.tsx` | DOCX/XLSX/PPTX export trigger | `await import("./export-ooxml")` lazy |
| `zip.ts` | Hand-rolled STORE-method ZIP writer used by OOXML export | Pulled out of `export-ooxml.ts` |
| `voice.ts` + `voice-button.tsx` | Web Speech API integration | Browser support varies |
| `dependencies-editor.tsx` | FS/SS/FF/SF predecessor picker with cycle detection | |
| `labels-input.tsx`, `combo-input.tsx`, `contact-input.tsx` | Typed-list and combobox inputs | |
| `contacts.ts` | Persisted address book (`lop-app:contacts`); feeds ContactInput suggestions | Survives task deletion and Jira churn |
| `markdown.tsx` | Renders chat / report markdown safely | |
| `notifications.tsx` | `DueBanner`, `BirthdayBanner`, `JiraTokenBanner` — each embeds a `SnoozeMenu` and accepts an `onSnooze: (ms: number) => void` prop. `JiraTokenBanner` covers expiring/expired/invalid token states with snooze + dismiss. Banners gated on `!isSnoozed` in TaskManager. Also: toast, popup alerts | |
| `reminder-snooze.ts` | localStorage-backed snooze store. `ReminderKind = "due" \| "birthday" \| "jiraToken"`. Key pattern: `lop-app:reminder-snooze:<kind>` (epoch-ms). Exports `getSnoozedUntil`, `setSnoozedUntil`, `clearSnooze`, `SNOOZE_1H` (3 600 000 ms), `SNOOZE_1D` (86 400 000 ms). Elapsed snoozes are cleared on read | pure; no React |
| `use-reminder-snooze.ts` | `useReminderSnooze(kind: ReminderKind) → { isSnoozed, snoozedUntil, snooze(durationMs), clear }`. Schedules a one-shot `setTimeout` to auto-reshow the banner when the snooze elapses, without requiring a reload | client hook |
| `birthdays.ts` | `getUpcomingBirthdays(resources, today, leadDays, holidays, absences) → UpcomingBirthday[]`. Year-wrap aware (birthday on Jan 2, today Dec 30 → next occurrence is in 3 days). Trigger is working-day-shifted via `shiftToWorkingDay`. Sorted by `daysUntil` asc. `UpcomingBirthday = { resource: Resource; daysUntil: number }` | pure |
| `date-format.ts` | Shared date-formatting helpers. `localeFor(lang) → string`, `shortDateRange(absence, lang) → string`, `formatExpiryDate(isoDate, lang) → string` (Jira token expiry display) | pure |
| `storage-config.tsx` | File-backend / SharePoint picker UI | SharePoint options are flagged `comingSoon` |
| `use-resizable.ts` | Custom hook for corner-drag resize with localStorage persistence | |
| `read-only-guard.ts` | `makeEditGuard(isReadOnly, notify)` — wraps a commit handler to no-op (with a toast) when `isReadOnly` is true; preserves the handler's return value | pure; no React |
| `read-only-mirror-banner.tsx` | `ReadOnlyMirrorBanner` — shown inside popout windows to indicate read-only mirror state | rendered by task-manager in popouts |
| `jira-token-status.ts` | `getJiraTokenAlert(jira, today, leadDays) → { kind: "invalid"\|"expired"\|"expiring"\|null, daysUntil? }` — client-side derivation of Jira token alert state | pure; no React |

## Lazy-loaded modules

| Trigger | Module loaded | Saved KB (gzipped) |
|---|---|---|
| Tab first opened | `chat-panel`, `gantt`, `reports`, `raid-panel`, `resources-panel`, `activity-log-panel`, `resources-report` (all via `next/dynamic`) | varies |
| `?popout=address-book` opened | `resource-directory` (address-book popout window, live-synced via `BroadcastChannel`) | small |
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
