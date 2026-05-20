# Changelog

All notable changes to **List of Open Points Tracker** are recorded here.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/);
versioning follows [Semantic Versioning](https://semver.org/).

Authoritative source for version + build date: [`src/app/version.ts`](src/app/version.ts).
This file is seeded from that module's milestone comment plus the
post-release changes captured in [`.reports/codemap-diff.txt`](.reports/codemap-diff.txt).

## [Unreleased]

_No unreleased changes._

## [0.7.3] "Adams" — 2026-05-20

Internal refactor + a visible performance win. Slice 5 of the
`task-manager.tsx` decomposition extracts the Claude chat-tool dispatcher
into its own custom hook with a stable identity, which lets us memoize
`ChatPanel`. The chat panel no longer re-renders on every task-form
keystroke.

### Changed (internal — single user-visible side effect)

- **`useChatDispatcher` hook** (`src/app/use-chat-dispatcher.ts`): consumes
  `useWorkspace` / `useTaskForm` / `useFilters` directly. Four internal
  refs (`tasksRef`, `settingsRef`, `todayRef`, `editingIdRef`) absorb every
  reactive value the dispatcher reads, so the `useMemo<ToolDispatcher>`
  has empty deps and its identity never changes after first render. The
  dispatcher synchronously updates `tasksRef.current` before calling
  `setTasks` so back-to-back chat tool calls in one turn see each other's
  writes.
- **`task-manager.tsx`** now calls `useChatDispatcher({ settings, today,
  setSelectedIds, setSettings })` instead of inlining ~240 lines of refs,
  helpers, and the dispatcher `useMemo`. Net: −228 lines (3517 → 3289).
- **`ChatPanel` wrapped in `React.memo`** (`src/app/chat-panel.tsx`).
  Combined with a `useCallback` for `onAcceptConsent` and the now-stable
  dispatcher, all four `ChatPanel` props are reference-stable for any
  parent re-render that doesn't change `lang` or `settings.ai` — so the
  Chat tab skips re-renders during, e.g., task-form input. **This is the
  visible performance win.**

### Added

- **`src/app/test-providers.tsx`** — small test helper composing
  `FiltersProvider` → `WorkspaceProvider` → `TaskFormProvider`, with a
  one-shot `Seeder` child for initial tasks. Used by the new hook tests.
- **15 unit tests for `useChatDispatcher`** covering each of the 10
  dispatcher methods plus two identity-stability tests that pin the
  empty-deps invariant the slice is designed around. Test count: 69 → 84.

### Moved (small refactor opportunities exposed by extraction)

- `isValidEmail` moved from a private function in `task-manager.tsx` to
  an exported member of `src/app/sanitize.ts`. Behaviour identical at all
  10 existing call sites.
- `greetingName` moved from a private function in `task-manager.tsx` to
  an exported member of `src/app/contacts.ts` (also pulled in
  `isValidEmail` from `./sanitize`). Behaviour identical at all 3
  existing call sites.

### Fixed

- The "ChatPanel memoization (gated on dispatcher useMemo deps audit)"
  open item in `.reports/codemap-diff.txt` is now closed. The dispatcher's
  `editingId` dep — the last reactive value preventing identity
  stability — is routed through `editingIdRef.current`.

## [0.7.2] "Banks" — 2026-05-19

Activity-log confirm dialog, three Rules-of-Hooks / hydration bug fixes,
and a large internal refactor that cut `task-manager.tsx` by ~700 lines
without changing any user-visible behaviour.

### Added

- **Activity log — confirm before clear**: "Clear log" now shows a native
  `window.confirm` dialog with the entry count before wiping. Consistent
  with the existing confirm-before-delete pattern on "Delete all tasks"
  (`handleClearAll`) and single-task delete (`handleDelete`). Help text
  updated in EN and DE.
- **Next.js 16 error boundaries** (`src/app/error.tsx`,
  `src/app/global-error.tsx`): React 19 render-error boundaries.

### Fixed

- **Rules of Hooks — `TaskManagerInner`**: `rowContextValue useMemo` was
  declared after the `!i18nReady` early return; moved before the gate so
  the hook count is stable across renders.
- **Rules of Hooks — `ReportsPanel`**: `groupHealth useMemo` was declared
  after the `stats.total === 0` early return; same fix.
- **Hydration mismatch on `<html>`**: added `suppressHydrationWarning` to
  `layout.tsx` to silence false mismatches when browser extensions (e.g.
  LanguageTool) inject attributes before React hydrates.

### Changed (internal — no user-visible behaviour change)

- **Slice 4 — modal extraction**: `TaskFormModal` (~491 lines) and
  `BulkEditModal` (~354 lines) extracted from `task-manager.tsx` into
  standalone files with component-level tests. Net −707 lines from the
  god-component.
- **Slices 1–3 — context extraction**: `FiltersProvider`,
  `WorkspaceProvider`, and `TaskFormProvider` pulled out of
  `task-manager.tsx` into dedicated context files, each with full test
  coverage.
- **Slice 2b — `TaskRow` extraction**: the per-row `<tr>` and its
  sub-components (`TaskActions`, `NotesCell`, `DependencyChips`,
  `RaidBadge`) extracted into `src/app/task-row.tsx` with `React.memo`
  isolation.
- **Shared `<Modal>` shell** extracted from duplicated modal JSX into
  `src/app/modal.tsx`.
- **`useDebounce` hook** extracted into `src/app/use-debounce.ts`.

## [0.7.1] "Kennedy" — 2026-05-17

Developer test scaffolding. Dev-only change — no user-visible behavior
difference vs 0.7.0.

### Added

- **Vitest** unit/component test runner. Config: `vitest.config.ts` (jsdom env, `@` path alias, `@vitejs/plugin-react`); setup: `vitest.setup.ts` (registers `@testing-library/jest-dom` matchers, RTL cleanup). Tests live alongside their sources as `src/**/*.test.{ts,tsx}`. v8 coverage threshold at 80% for lines / functions / branches / statements.
- **Sample unit tests**: `src/app/sanitize.test.ts` (14 cases), `src/app/due-dates.test.ts` (6 cases), `src/app/segmented-control.test.tsx` (3 cases).
- **Playwright** E2E runner. Config: `playwright.config.ts` (Chromium-only by default; Firefox / WebKit commented in). Auto-starts `npm run dev` on port 3000; reuses an existing local dev server. Traces, screenshots, and video retained on failure. Tests live in `e2e/**/*.spec.ts`.
- **Sample E2E test**: `e2e/smoke.spec.ts` — root page loads, title matches, `<main>` visible.
- **Scripts**: `npm run test`, `test:run`, `test:coverage`, `e2e`, `e2e:ui`, `e2e:install`.
- **`.gitignore`**: `/test-results`, `/playwright-report`, `/playwright/.cache`, `/blob-report`.
- **8 new devDependencies**: `vitest`, `@vitest/coverage-v8`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `@playwright/test`. No runtime deps added.

### Changed

- `README.md` and `CONTRIBUTING.md` scripts tables extended with the six new commands.
- `CONTRIBUTING.md` "Testing" section rewritten from "there is currently no test suite" to describe the new Vitest + Playwright setup.
- `src/app/version.ts` comment block prepended with a 0.7.1 entry; `APP_BUILD_DATE` unchanged (already today).

### Not changed (intentional)

- In-app `HelpMenu` and `APP_HIGHLIGHT_KEYS`. Test infrastructure is developer-facing; end-user help and version popover stay focused on user features.

## [0.7.0] "Heinlein" — 2026-05-17

Resource Planner + Activity Log release. Adds per-assignee absences and
shift patterns, a chronological CRUD audit log, a persisted contacts
address book, and a per-request CSP nonce middleware. Also lands
SharePoint storage backend stubs (UI present, MSAL not yet wired).

### Added

- **Resource planner** (Phases 1–4): per-assignee absences (vacation / sick / training / other), weekly shift patterns, and a 30-day calendar view. New `Absence` and `Shift` types in `src/app/types.ts`; new IndexedDB stores `absences` (v3) and `shifts` (v4).
- **Activity log**: chronological CRUD record for tasks, RAID, absences, and shifts. 21 `ActivityKind` values; capped at 500 entries; persisted to `localStorage` key `lop-app:activity-log` and explicitly excluded from any file export.
- **Contacts address book**: persisted to `localStorage` key `lop-app:contacts`; capped at 500 entries; survives task deletion and Jira sync churn.
- **Per-request Content-Security-Policy nonce** via Next.js 16 middleware (`src/proxy.ts`). `script-src` and `style-src-elem` are nonce-strict in production; `style-src-attr 'unsafe-inline'` is retained for React inline `style={{...}}` props. `connect-src` whitelists `https://api.anthropic.com`.
- **SharePoint storage backend stubs** (`sp-json`, `sp-csv`). Surfaced as "Coming soon" in Settings; factory returns a stub that throws `StorageNotImplementedError("sharepoint-coming-soon")`. No MSAL/Graph SDK pulled in yet.

### Changed

- ADF (Atlassian Document Format) ↔ plain-text conversion extracted from the Jira proxy helpers into `src/app/adf.ts` so the client-side import/export paths can share it without dragging server-only code into the browser bundle.
- Hand-rolled STORE-method ZIP writer extracted from `export-ooxml.ts` into `src/app/zip.ts`.
- Version metadata (`APP_VERSION`, `APP_BUILD_DATE`, `APP_HIGHLIGHT_KEYS`) extracted from `version-menu.tsx` into a dedicated `src/app/version.ts`.
- `src/app/page.tsx` now `await connection()` so the CSP nonce attached at SSR matches the runtime middleware header.
- `next.config.ts` now only emits the static security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`); the CSP moved out to `src/proxy.ts` because per-request nonces aren't supported in static `headers()`.
- All six workspace panels (Chat, Reports, Gantt, RAID, Resources, Activity) now load via `next/dynamic({ ssr: false })`; modals (`JiraConflictsModal`, `AbsenceEditModal`, `ShiftEditModal`) also dynamic-imported.

## [0.6.0] "Asimov" — 2026-05-15

May 2026 performance refactor. (Quoted from `src/app/version.ts`:
"0.6.0 captures the May 2026 performance refactor".)

### Changed

- **Lazy-loaded heavy modules**: OOXML export, German i18n dictionary, `date-holidays` (+ moment / moment-tz).
- **IndexedDB record-level storage** for tasks and RAID — saves diff per record against an in-memory baseline using reference equality; only changed records are written. One-time migration from legacy `localStorage` keys (`lop-app:tasks`, `lop-app:raid`).
- **Debounced search** (150 ms) with a precomputed lowercase task index; **column-width writes debounced 250 ms**.
- **Memoized RAID panel** (`React.memo` + stable `useCallback` handlers).
- **Conditional mount of Gantt and Reports tabs** instead of always-mounted.

## [0.5.0] "Clarke"

Prior feature-accretion milestone. (Quoted from `src/app/version.ts`:
"0.5.0 was the prior feature-accretion milestone".)

### Added

- Claude chat panel with tool calls for task CRUD.
- Voice commands via Web Speech API (English + German).
- Due-date notifications: banner, toast, and popup alerts.
- Reports tab.
- Labels and groups on tasks; bulk edit.
- Bidirectional Jira sync (pull + push) with conflict resolution.
- ADF (Atlassian Document Format) ↔ notes round-tripping.
- Resizable + collapsible workspace, resizable tasks table, header "+" task modal.

[Unreleased]: https://gitlab.example.com/example-group/public-collab/lop-app/-/compare/v0.7.3...main
[0.7.3]: https://gitlab.example.com/example-group/public-collab/lop-app/-/compare/v0.7.2...v0.7.3
[0.7.2]: https://gitlab.example.com/example-group/public-collab/lop-app/-/compare/v0.7.1...v0.7.2
[0.7.1]: https://gitlab.example.com/example-group/public-collab/lop-app/-/compare/v0.7.0...v0.7.1
[0.7.0]: # (no tag)
[0.6.0]: # (no tag)
[0.5.0]: # (no tag)
