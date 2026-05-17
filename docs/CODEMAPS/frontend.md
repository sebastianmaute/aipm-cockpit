<!-- Generated: 2026-05-15 | Files scanned: ~35 (src/app/*.tsx, *.ts) | Token estimate: ~900 -->

# Frontend

Single-page Next.js App Router client. One route, one god-component, four
tabbed panels, and a network of inputs / menus.

## Page tree

```
src/app/layout.tsx           — root layout, security headers, globals.css
└── src/app/page.tsx         — renders <TaskManager />
    └── src/app/task-manager.tsx   (~3,900 lines; container for everything)
        ├── header (+ button → task modal, ExportMenu, HelpMenu,
        │           VersionMenu, SettingsMenu, VoiceCommandButton)
        ├── banner / due-modal     (notifications.tsx)
        ├── workspace section (resizable, collapsible)
        │   ├── tab strip
        │   ├── ChatPanel          (chat-panel.tsx) — always mounted
        │   ├── ReportsPanel       (reports.tsx)    — conditional mount  ★
        │   ├── GanttPanel         (gantt.tsx)      — conditional mount  ★
        │   └── RaidPanel          (raid-panel.tsx, React.memo)          ✚
        └── tasks table (always mounted)
            ├── filters / sort / bulk-edit bar
            ├── colgroup / sticky thead
            ├── tbody (non-virtualized; full render of filteredSortedTasks)
            └── per-row actions (mark complete, send inquiry, Jira push…)
```

★ = lazy-mounted (Phase A)
✚ = `React.memo` wrapper + stable `useCallback` handlers (Phase C)

## State (all in TaskManager)

| State slice | Notes |
|---|---|
| `tasks: Task[]`, `raid: RaidItem[]` | Persisted via `StorageBackend.save()` (debounced 500 ms) |
| `tasksRef.current` | Hand-mirrored copy of `tasks` for stable closures in `dispatcher` |
| `settings: Settings` | Language, holiday countries, Jira, AI, notifications. Persisted to `localStorage` (`SETTINGS_KEY`) |
| `colWidths`, `hiddenCols` | UI table prefs in `localStorage` (colWidths debounced 250 ms) |
| `search` + `searchDebounced` + `taskSearchIndex` | 150 ms search debounce + precomputed lowercase index (Phase D) |
| `selectedIds`, `bulkEdit`, `expandedNotes` | Per-session UI only |
| `hydrated`, `i18nReady` | Render gates; `i18nReady=false` returns null until lang dict loads |

## Child component map

| File | Role | Notes |
|---|---|---|
| `gantt.tsx` | Visual timeline with bar drag, dependency arrows, critical path | 1,625 lines; conditional mount |
| `raid-panel.tsx` | Risks/Assumptions/Issues/Dependencies log | 1,254 lines; `memo()`-wrapped |
| `reports.tsx` | Stats by group, label, status, on-time vs late | 665 lines; conditional mount |
| `chat-panel.tsx` | Claude chat with tool calls via `dispatcher` | Always mounted (preserves history) |
| `chat-tools.ts` | Tool dispatcher object passed to ChatPanel | Huge useMemo inside TaskManager |
| `jira-settings.tsx` / `jira-conflicts-modal.tsx` / `jira-api.ts` | Jira UI + client | Calls `/api/jira/*` |
| `settings-menu.tsx` | Language, holidays, AI, notifications, Jira | |
| `help-menu.tsx`, `version-menu.tsx` | Header dropdowns | |
| `export-menu.tsx` | DOCX/XLSX/PPTX export trigger | `await import("./export-ooxml")` lazy |
| `voice.ts` + `voice-button.tsx` | Web Speech API integration | Browser support varies |
| `dependencies-editor.tsx` | FS/SS/FF/SF predecessor picker with cycle detection | |
| `labels-input.tsx`, `combo-input.tsx`, `contact-input.tsx` | Typed-list and combobox inputs | |
| `markdown.tsx` | Renders chat / report markdown safely | |
| `notifications.tsx` | Banner, toast, popup alerts | |
| `storage-config.tsx` | File-backend picker UI | |
| `use-resizable.ts` | Custom hook for corner-drag resize with localStorage persistence | |

## Lazy-loaded modules

| Trigger | Module loaded | Saved KB (gzipped) |
|---|---|---|
| User picks DOCX/XLSX/PPTX export | `export-ooxml.ts` (1,260 lines) | ~45 KB |
| Active language is `de` | `i18n.de.ts` | ~17 KB |
| User selects ≥1 holiday country | `date-holidays` (+ moment, moment-tz) | ~100 KB+ |

## Routing

App Router with a single visible page (`/`). API routes under `/api/jira/*`
(see [backend.md](backend.md)).
