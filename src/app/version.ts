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
export const APP_VERSION = "0.7.4";
export const APP_BUILD_DATE = "2026-05-20";
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
] as const;
