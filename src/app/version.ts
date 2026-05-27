// 0.14.0 adds editable budget buckets: a new draggable BudgetBucketModal
// lets users edit a bucket's name, PO number, type (T&M / Fixed), currency,
// fixed-price amount, start/end dates, spillover successor, and manual FX-rate
// override — with validation. Role allocation lines (role + capacity) are
// managed inside the modal via a role picker. "Add bucket" now opens the editor
// on the new bucket (no more uneditable empty shells); each bucket card gained
// an Edit button; per-period hours are still edited in the panel grid.
// 0.13.0 polishes the UI across modals, resources, budget, and tasks:
//   - Draggable modal windows via a shared ModalHeader (use-draggable.ts).
//     Voice commands are now available inside every modal through
//     VoiceCommandContext (voice-command-context.tsx).
//   - Tab order: Budget sits between Resources and Activity.
//   - Assignee hover styling unified across Directory, Workload, and Task rows.
//   - Resource planning: explanatory tooltips on rollup totals and the
//     utilization input; the "weeks" view now derives week capacity from the
//     month-level entry (read-only when granularity is month).
//   - Roles & rates: sortable Discipline/Grade/Internal/External columns; a
//     visual divider between the rate card and the add-combo row; Discipline
//     and Grade selects show a "—" placeholder; Manage-roles and Report buttons
//     gained leading icons.
//   - Budget buckets: removable (calculations based on a removed bucket reset
//     to 0) and reorderable by drag (persisted `order` field).
//   - ECB "refresh rates" button restyled to match the Jira-sync button
//     (spinner while loading).
//   - Tasks: optional effort fields — Original estimate & Time spent — in
//     weeks/days/hours/minutes (Jira basis: 1w=5d, 1d=8h). Hideable, sortable
//     "Est." and "Spent" columns. New `duration.ts` helper: parse/format
//     duration strings, round-trip with Jira minute values.
// 0.12.0 adds a Project Budget Planner: named PO-line budget buckets (T&M or
// fixed-price, in EUR/USD/GBP) that span roles via per-role allocations (each
// naming a role + feeding resources + per-period budget/actual hours). Planned
// hours derive from the existing resource-capacity engine; actuals are entered
// per bucket/role/period. A three-value CCI panel (contribution margin, cost
// performance, consumption — each as amount + %) is computed at bucket and
// project level, together with win/loss in hours and currency. Closing a bucket
// spills its remaining budget (hours + amount) into a named successor (reversible
// on reopen). Multi-currency display is backed by ECB daily reference rates: a
// new /api/ecb route fetches and caches them in the workspace; a per-bucket
// manual rate override wins over the cached rate. Bucket end-date reminders fire
// via the existing reminder lead-time infrastructure. New modules: budget-report.ts
// (pure engine: active periods, planned hours, per-bucket report, CCI, spillover,
// project rollup, reminders), budget-panel.tsx (Budget tab UI), fx.ts + ecb.ts +
// api/ecb/route.ts + use-fx-rates.ts (ECB FX layer). Budget types added to
// types.ts; budget sanitizers in sanitize.ts; budgets + fxRates persisted in
// storage.ts (schema v6, additive migration from v5, full CSV/MD/JSON/IDB
// round-trip; budgets/fxRates are optional on Workspace for backward compat).
// 0.11.0 hardens pop-out windows, reworks control tooltips, and adds Jira
// token-expiry reminders.
//   - Pop-out windows are now read-only mirrors: they receive live state over
//     BroadcastChannel but never broadcast and never persist. This closes a
//     data-loss path where a pop-out's load broadcast its state to the main
//     window, which then triggered a redundant (and on Chrome sometimes
//     destructive) save of the local file. `useBroadcastSync` gained a
//     `canSend` flag (receive always; send gated), and `writeHandle` now
//     aborts the swap-temp on a blocked write so the original file can't be
//     deleted. Edit affordances are locked in pop-outs: commit handlers no-op
//     with a toast (`makeEditGuard`), the chat dispatcher refuses mutating
//     tools, the gantt "Add Task" is hidden, and a read-only banner shows.
//   - Tooltips: the workspace resize hint no longer leaks onto every
//     search/filter control — it lived as a `title` on the wrapping
//     `<section>`, which HTML shows on any title-less descendant. Removed in
//     favour of an inert corner glyph; every search/filter/sort control (and
//     the RAID edit-modal fields) now has its own descriptive tooltip, and the
//     tasks column headers match the resources directory hover. ~40 new EN+DE
//     strings; `SegmentedControl` gained a `title` passthrough.
//   - Jira: record the API token's expiry date (Settings → Jira) to get a
//     reminder banner before it expires and once it has (`getJiraTokenAlert`,
//     reusing the snooze/banner infra). Clicking Sync with an expired/invalid
//     token or no connection now shows a clear, actionable info message
//     (`classifyJiraError`): expired → paused, 401/403 → token rejected,
//     network → unreachable. A rejected token also raises the banner until a
//     successful sync/test clears it.
// 0.10.0 ships everything built on top of the Resource Utilization release:
// the Resource Address Book, a unified working-day-shifted reminder lead, and
// persisted reminder snooze, plus two data-integrity fixes and a project-wide
// lint pass.
//   - Address book: Resource splits `name` into firstName/lastName and gains
//     contact fields (title, business phone, location, department, email,
//     company, birthday MM-DD, notes). The Resources pane is now four sub-tabs
//     — Directory (address-book table; click a name to edit, "+ Add resource"),
//     Workload, Calendar, Planning — plus a pop-out address-book window.
//     Birthdays raise a banner + once-per-load toast.
//   - Task form: a "+" beside the assignee opens the address-book add-entry
//     modal seeded with the typed name/email; saving creates the resource and
//     fills the assignee.
//   - Reminders: a single "days ahead" lead (reminderLeadDays) replaces the
//     split birthday-leadDays / due-threshold settings; a reminder that would
//     land on a weekend, holiday, or absence day is shifted earlier to the
//     prior working day so it fires during the work week. Both reminder banners
//     gain a persisted Snooze (1 hour / 1 day) that also mutes the load toast
//     until it elapses.
//   - Fixes: pop-out windows no longer broadcast their initial (empty) state
//     (which could truncate the synced file); each local file format keeps its
//     own file-picker id so switching formats no longer sticks.
//   - Quality: project-wide ESLint pass to zero problems with no rule relaxed
//     (set-state-in-effect rewrites, render-time ref writes moved to effects,
//     test-mock typings).
// 0.9.0 lands the Resource Utilization feature: first-class Resource
// entities with two-dimensional Role (discipline × grade) carrying
// internal/external hourly rates; per-period utilization planning grid
// (week or month) computing capacity net of weekends, holidays, and
// absences; internal/external cost + margin columns; read-only
// week/month rollup view; per-cell absence-override editing; and a
// pop-out resources report (capacity, cost, margin; per-period /
// per-discipline / per-grade / per-role / per-resource breakdowns).
// Schema v5 with additive `resourceId` on tasks/absences and an
// idempotent migration that backfills resources from existing
// assignees and seeds preset disciplines/grades. Also: 2 long-standing
// test-file tsc errors fixed (project now type-checks fully clean).
// 0.8.4 extracts the modal layer (DueBanner, TaskFormModal, DueDatesModal,
// JiraConflictsModal, AbsenceEditModal, ShiftEditModal, footer, toast) from
// task-manager.tsx into AppModals. TasksSection builds rowContextValue
// internally (useSettings + useHolidaySet + tasksById from useWorkspace);
// receives 8 row-handler callbacks + jiraSiteUrl as explicit props instead of
// the compiled RowContextValue object. task-manager.tsx −~140 lines. Slice 16.
// 0.8.3 extracts WorkspaceTabContext (TopTab type + WorkspaceTabProvider +
// useWorkspaceTab hook) from task-manager.tsx. Also extracts AppHeader
// component (app <header> block, ~90 lines) and WorkspaceSection component
// (workspace <section> block, ~250 lines) from task-manager.tsx.
// useTaskRowHandlers now reads setActiveTab from WorkspaceTabContext instead
// of receiving it as a prop. task-manager.tsx −377 lines; now ~661 lines.
// Slice 15.
// 0.8.2 extracts 6 UI helper components (TabButton, Th, SortableTh,
// ResetSizeIcon, ResetColWidthsIcon, EraserIcon) to task-manager-ui.tsx
// and the entire tasks <section> JSX (~310 lines) to tasks-section.tsx.
// TasksSection reads useFilters(), useWorkspace(), and useTaskForm()
// internally; 31 explicit props for column manager, resizable table,
// row state, Jira, task actions, and bulk operations. 3 smoke tests.
// task-manager.tsx ~−520 lines; now ~1,049 lines. Slice 14.
// 0.8.1 extracts useTaskSubmit (~170 LoC) and useGanttHandlers (~25 LoC) from
// task-manager.tsx. Slice 13 of the decomposition: useTaskSubmit owns error
// state, handleSubmit (validation + create/update paths + Jira push via
// onPushToJiraRef forwarding-ref pattern), handleCancelEdit, and openEditModal.
// useGanttHandlers owns handleGanttBarUpdate (drag-edit with date clamping).
// ContactsMap type alignment; nextId retained in task-manager for TaskFormModal.
// 8 new unit tests. task-manager.tsx ~−165 lines; now ~1,705 lines.
// 0.8.0 extracts useHolidaySet (~25 LoC) and useTaskRowHandlers (~150 LoC)
// from task-manager.tsx. Slice 12 of the decomposition: useHolidaySet wraps
// the async holidaysForCountries utility with a cancellation guard.
// useTaskRowHandlers owns expandedNotes + pushingIds state and the 9 row
// callbacks (onToggleNoteExpanded, onJumpToRaid, onToggleComplete,
// onSendInquiry, onPushToJira, onEdit, onDelete, handleClearRaidTaskFilter,
// handleJumpToTaskFromRaid). handleEdit duplicate eliminated; openEditModal
// introduced as a stable useCallback in task-manager. TopTab exported.
// Dead settingsRef/todayRef removed. 9 new unit tests.
// task-manager.tsx ~−120 lines; now ~1,870 lines.
// 0.7.8 extracts useColumnManager (~110 LoC), useContacts (~45 LoC), and
// useWorkspaceCollapsed (~25 LoC) from task-manager.tsx. Slice 10 of the
// decomposition: all three are localStorage-backed UI-state hooks.
// useColumnManager owns column widths, hidden columns, the column-config
// dropdown, and the resize-drag interaction. useContacts owns the contacts
// address-book lifecycle (gated on hydrated + tasks for seeding).
// useWorkspaceCollapsed owns the workspace-panel collapsed boolean.
// 15 new unit tests. task-manager.tsx ~−175 lines; now ~2,010 lines.
// 0.7.7 extracts useSettings (~100 LoC) and useActivityLog (~50 LoC) from
// task-manager.tsx. Slice 9 of the decomposition: useSettings owns settings
// state, localStorage load/persist, i18n loading, and the hydrated + i18nReady
// gates. useActivityLog owns activityLog state, localStorage load/persist,
// logActivity, and handleClearActivityLog. 12 new unit tests. task-manager.tsx
// ~−150 lines; now ~2,145 lines.
// 0.7.6 extracts useResourcePlanner (~350 LoC) and useBulkOperations (~270 LoC)
// hooks from task-manager.tsx. Slice 8 of the decomposition: useResourcePlanner
// owns RAID CRUD, absence CRUD (with modal state), shift CRUD (with modal state),
// and handleCreateMitigationTaskFromRaid. useBulkOperations owns selectedIds state,
// bulk edit logic, handleCommand (voice dispatcher), handleClearAll, and
// handleBulkSendInquiry. 13 tests each covering modal state, CRUD ops, auto-issue
// on Risk→Realized, voice dispatch, and bulk inquiry. task-manager.tsx −518 net
// lines; now ~2,295 lines.
// 0.7.5 extracts useStorageBackend hook (~167 LoC) from task-manager.tsx.
// All storage, broadcast-sync, and file-handler logic now lives in the hook.
// WorkspaceContext widened (Phase A) to own raid, absences, and shifts state.
// 14 new unit tests in use-storage-backend.test.tsx; workspace-context.test.tsx
// gains assertions for new defaults. task-manager.tsx −164 net lines.
// 0.7.4 extracts the Jira sync logic (~315 LoC) out of task-manager.tsx into
// a new useJiraSync hook. handleJiraSync + handleResolveConflicts move into
// the hook with ref-based reactive reads (tasks, settings, lang, today).
// loadJiraApi lazy-load cache moves to use-jira-sync.ts and is re-exported.
// 12 new unit tests covering state-init, pull, push, conflict detection,
// create-issue, and conflict resolution paths. task-manager.tsx −303 lines.
// 0.7.3 extracts the Claude chat-tool dispatcher (~240 LoC) out of
// task-manager.tsx into a new useChatDispatcher hook with empty-deps useMemo
// + ref-based reactive reads. ChatPanel is now wrapped in React.memo; with
// the dispatcher's stable identity it no longer re-renders on task-form
// keystrokes. task-manager.tsx -228 lines. 15 new unit tests for the hook,
// including identity-stability pins. isValidEmail moved to sanitize.ts;
// greetingName moved to contacts.ts.
// 0.7.2 adds a confirm dialog before clearing the activity log, matching the
// existing confirm-before-delete pattern on "Delete all tasks" and single-task
// delete. Internal: TaskFormModal + BulkEditModal extracted from
// task-manager.tsx (slice 4 refactor, no user-visible change).
// 0.7.1 adds developer test scaffolding: Vitest + React Testing Library
// for unit/component tests (`src/**/*.test.ts(x)`) and Playwright for E2E
// (`e2e/**/*.spec.ts`). Coverage threshold set at 80%. Dev-only change —
// no user-visible behavior difference vs 0.7.0.
// 0.7.0 brings Resource Planner (per-assignee absences + weekly shift
// patterns + 30-day calendar view) and an Activity Log of task / RAID /
// resource changes. Also: persisted contacts address book, per-request
// Content-Security-Policy nonce via Next.js 16 middleware (`src/proxy.ts`),
// and SharePoint storage backend stubs (UI present, MSAL not yet wired).
// 0.6.0 captured the May 2026 performance refactor: lazy-loaded heavy
// modules (OOXML export, German dictionary, date-holidays), IndexedDB
// record-level storage for tasks/RAID, debounced search + colWidths,
// memoized RAID panel, and conditional mount of Gantt/Reports tabs.
// 0.5.0 was the prior feature-accretion milestone (Claude chat, voice
// commands, due-date notifications, reports, labels & groups, bulk edit,
// Jira bidirectional sync + push, ADF description ↔ notes, resizable +
// collapsible workspace, resizable tasks table, header "+" task modal).
// Date is the last build.
export const APP_VERSION = "0.14.2";
export const APP_BUILD_DATE = "2026-05-27"; // Atwood milestone
export const APP_REPO_URL = "https://www.example.com";

/** Translation keys for the high-level feature highlights shown in the
 *  Version popover. Update both EN and DE in i18n.ts when you add to this. */
export const APP_HIGHLIGHT_KEYS = [
  "versionHighlightChat",
  "versionHighlightVoice",
  "versionHighlightStorage",
  "versionHighlightJira",
  "versionHighlightReports",
  "versionHighlightGantt",
  "versionHighlightRaid",
  "versionHighlightResources",
  "versionHighlightActivity",
  "versionHighlightContacts",
  "versionHighlightExport",
  "versionHighlightNotifications",
  "versionHighlightWorkspace",
  "versionHighlightSecurity",
  "versionHighlightPerformance",
  "versionHighlightBudget",
  "versionHighlightPolish",
  "versionHighlightBudgetEdit",
] as const;
