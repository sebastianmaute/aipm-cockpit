<!-- Generated: 2026-05-19 | Files scanned: ~58 (src/app/*.tsx, *.ts) | Token estimate: ~1060 -->

# Frontend

Single-page Next.js App Router client. One route, one god-component, six
tabbed panels, and a network of inputs / menus.

## Page tree

```
src/proxy.ts                 — middleware (per-request CSP nonce)
src/app/layout.tsx           — root layout, security headers, globals.css
└── src/app/page.tsx         — await connection(); renders <TaskManager />
    └── src/app/task-manager.tsx   (~3,517 lines; container for everything)
        ├── header (+ button → task modal, ExportMenu, HelpMenu,
        │           VersionMenu, SettingsMenu, VoiceCommandButton)
        ├── banner / due-modal     (notifications.tsx)
        ├── workspace section (resizable, collapsible) — 6 tabs
        │   ├── tab strip (chat | reports | gantt | raid | resources | activity)
        │   ├── ChatPanel          (chat-panel.tsx)        — mounted; hidden when off
        │   ├── ReportsPanel       (reports.tsx)           — conditional mount  ★
        │   ├── GanttPanel         (gantt.tsx)             — conditional mount  ★
        │   ├── RaidPanel          (raid-panel.tsx)        — mounted; hidden when off  ✚
        │   ├── ResourcesPanel     (resources-panel.tsx)   — conditional mount  ★
        │   └── ActivityLogPanel   (activity-log-panel.tsx)— conditional mount  ★
        └── tasks table (always mounted)
            ├── filters / sort / bulk-edit bar
            ├── colgroup / sticky thead
            ├── tbody (non-virtualized; full render of filteredSortedTasks)
            └── per-row actions (mark complete, send inquiry, Jira push…)

Modals:
  TaskFormModal      (task-form-modal.tsx)   — statically imported; renders null when closed
  BulkEditModal      (bulk-edit-modal.tsx)   — statically imported; renders null when closed
  JiraConflictsModal, AbsenceEditModal, ShiftEditModal — dynamic-imported, only mounted while open
```

★ = conditional mount (only when its tab is active)
✚ = `React.memo` wrapper + stable `useCallback` handlers

All workspace panels are loaded via `next/dynamic({ ssr: false })` —
browser-only APIs (window, IndexedDB, Web Speech, FS Access) cannot be
prerendered.

## State (all in TaskManager)

| State slice | Notes |
|---|---|
| `tasks: Task[]`, `raid: RaidItem[]`, `absences: Absence[]`, `shifts: Shift[]` | Persisted via `StorageBackend.save()` (debounced 500 ms); record-level diff per IDB store |
| `tasksRef.current` | Hand-mirrored copy of `tasks` for stable closures in `dispatcher` |
| `settings: Settings` | Language, holiday countries, Jira, AI, notifications. Persisted to `localStorage` (`SETTINGS_KEY`) |
| `contacts: ContactsMap` | Assignee↔email address book; persisted to `lop-app:contacts` |
| `activityLog: ActivityEntry[]` | Up to 500 most recent CRUD events; persisted to `lop-app:activity-log` |
| `colWidths`, `hiddenCols` | UI table prefs in `localStorage` (colWidths debounced 250 ms) |
| `search` + `searchDebounced` + `taskSearchIndex` | 150 ms search debounce + precomputed lowercase index |
| `selectedIds`, `bulkEdit`, `expandedNotes` | Per-session UI only |
| `activeTab` | `"chat"` \| `"reports"` \| `"gantt"` \| `"raid"` \| `"resources"` \| `"activity"` |
| `raidFilterTaskId` | Cross-tab nav: jump from a task row to RAID pre-filtered for that task |
| `workspaceCollapsed`, `taskModalOpen`, `absenceDraft`, `shiftDraft` | Modal / collapse state |
| `hydrated`, `i18nReady` | Render gates; `i18nReady=false` returns null until lang dict loads |

## Child component map

| File | Role | Notes |
|---|---|---|
| `task-form-modal.tsx` | Task create/edit form inside a `<Modal>`; reads `form`, `setForm`, `editingId`, `taskModalOpen` from `useTaskForm()` | ~491 lines extracted from task-manager in slice 4; returns null when closed |
| `bulk-edit-modal.tsx` | Bulk-edit dialog (apply field to N selected tasks); reads `bulkEdit`, `setBulkEdit`, `bulkEditOpen` from `useTaskForm()` | ~354 lines extracted from task-manager in slice 4; returns null when closed |
| `gantt.tsx` | Visual timeline with bar drag, dependency arrows, critical path | conditional mount; consumes `absences` to grey out off-days |
| `raid-panel.tsx` | Risks/Assumptions/Issues/Dependencies log | `memo()`-wrapped; mounted-but-hidden |
| `reports.tsx` | Stats by group, label, status, on-time vs late | conditional mount |
| `chat-panel.tsx` | Claude chat with tool calls via `dispatcher` | conditional mount; chat history kept in TaskManager state to survive tab switches |
| `chat-tools.ts` | Tool dispatcher object passed to ChatPanel | Huge `useMemo` inside TaskManager |
| `resources-panel.tsx` | Resource Planner: list view (stats per assignee) + calendar view (delegates to `resource-calendar.tsx`); switched by SegmentedControl | conditional mount |
| `resource-calendar.tsx` | 30-day grid (assignee × day) showing tasks, absences, shift hours | rendered inside ResourcesPanel |
| `absence-edit-modal.tsx` | Add/edit Absence (vacation/sick/training/other) | dynamic-imported; opened on demand |
| `shift-edit-modal.tsx` | Add/edit weekly working-hours pattern per assignee | dynamic-imported; opened on demand |
| `activity-log-panel.tsx` | Sortable/filterable/searchable CRUD log (text, wildcard, regex search) | conditional mount; `memo()`-wrapped |
| `segmented-control.tsx` | Reusable 2-segment toggle (used by ResourcesPanel) | |
| `jira-settings.tsx` / `jira-conflicts-modal.tsx` / `jira-api.ts` | Jira UI + client | Calls `/api/jira/*`; `jira-api.ts` lazy-imported via `loadJiraApi()` |
| `adf.ts` | Plain-text ↔ ADF conversion (extracted from `_helpers.ts`) | Shared between client paths and the Jira proxy routes |
| `settings-menu.tsx` | Language, holidays, AI, notifications, Jira, storage backend | |
| `help-menu.tsx`, `version-menu.tsx` | Header dropdowns | |
| `version.ts` | `APP_VERSION`, `APP_BUILD_DATE`, `APP_HIGHLIGHT_KEYS` (i18n keys for the Version popover) | |
| `export-menu.tsx` | DOCX/XLSX/PPTX export trigger | `await import("./export-ooxml")` lazy |
| `zip.ts` | Hand-rolled STORE-method ZIP writer used by OOXML export | Pulled out of `export-ooxml.ts` |
| `voice.ts` + `voice-button.tsx` | Web Speech API integration | Browser support varies |
| `dependencies-editor.tsx` | FS/SS/FF/SF predecessor picker with cycle detection | |
| `labels-input.tsx`, `combo-input.tsx`, `contact-input.tsx` | Typed-list and combobox inputs | |
| `contacts.ts` | Persisted address book (`lop-app:contacts`); feeds ContactInput suggestions | Survives task deletion and Jira churn |
| `markdown.tsx` | Renders chat / report markdown safely | |
| `notifications.tsx` | Banner, toast, popup alerts | |
| `storage-config.tsx` | File-backend / SharePoint picker UI | SharePoint options are flagged `comingSoon` |
| `use-resizable.ts` | Custom hook for corner-drag resize with localStorage persistence | |

## Lazy-loaded modules

| Trigger | Module loaded | Saved KB (gzipped) |
|---|---|---|
| Tab first opened | `chat-panel`, `gantt`, `reports`, `raid-panel`, `resources-panel`, `activity-log-panel` (all six via `next/dynamic`) | varies |
| Jira config first used | `jira-api.ts` (~400 LOC) | ~10 KB |
| User picks DOCX/XLSX/PPTX export | `export-ooxml.ts` (~1,300 lines, plus `zip.ts`) | ~45 KB |
| Active language is `de` | `i18n.de.ts` (~700 keys) | ~20 KB |
| User selects ≥1 holiday country | `date-holidays` (+ moment, moment-tz) | ~100 KB+ |
| User opens Absence or Shift editor | `absence-edit-modal`, `shift-edit-modal` | small |
| Jira sync conflict raised | `jira-conflicts-modal` | small |

## Routing

App Router with a single visible page (`/`). API routes under `/api/jira/*`
(see [backend.md](backend.md)). Middleware `src/proxy.ts` runs on every
HTML response.
