<!-- Generated: 2026-05-15 | Files scanned: types.ts, storage.ts, sanitize.ts, raid.ts | Token estimate: ~700 -->

# Data

No database. All persistence is browser-local: IndexedDB for tasks/RAID,
localStorage for UI preferences, optional local file (CSV/MD/JSON) via the
File System Access API.

## Core schemas (`src/app/types.ts`)

```
Task {
  id              number   (positive int)
  taskName        string
  assignee        string
  assigneeEmail   string
  startDate?      "YYYY-MM-DD"
  dueDate         "YYYY-MM-DD"
  lastUpdateDate  "YYYY-MM-DD"
  priority        "Low" | "Medium" | "High" | "Urgent"
  blockers        string
  notes           string
  completedDate?  "YYYY-MM-DD"
  inquiriesSent?  number
  group?          string
  labels?         string[]
  dependencies?   { taskId: number, type: "FS"|"SS"|"FF"|"SF" }[]
  jiraKey?        string                  (e.g. "LOP-42")
  jiraIssueType?  string
  lastSyncedAt?   ISO 8601 timestamp
  localModifiedAt? ISO 8601 timestamp
  healthOverride? "R" | "A" | "G"          (manual RAG override)
}

RaidItem {
  id              number
  category        "R" | "A" | "I" | "D"   (Risk/Assumption/Issue/Dependency)
  title           string
  description?    string
  owner?          string
  ownerEmail?     string
  severity?       "Low" | "Medium" | "High" | "Critical"
  probability?    1..5     (Risks only — drives severity)
  impact?         1..5     (Risks only)
  status          per-category enum (e.g. Risks: Open/Mitigated/Realized/Closed)
  mitigation?     string
  linkedTaskIds   number[]
  raisedDate      "YYYY-MM-DD"
  targetDate?     "YYYY-MM-DD"
  closedDate?     "YYYY-MM-DD"
  localModifiedAt? ISO 8601 timestamp
  causedByRaidIds number[]                (parent RAID items)
}
```

## IndexedDB layout (`storage.ts`)

```
Database: lop-app  (version 2)
├── object store "kv"    (created v1)   — FsHandle storage for LocalFileBackend
├── object store "tasks" (created v2)   — keyPath: "id", value: Task
└── object store "raid"  (created v2)   — keyPath: "id", value: RaidItem
```

Saves are **record-level**: `BrowserBackend.save(ws)` diffs `ws.tasks` /
`ws.raid` against an in-memory baseline using reference equality (relies on
the codebase's immutable-update convention) and emits only `put` for changed
records + `delete` for removed ids. Baseline is refreshed after each
successful save.

One-time migration: on first load with empty IDB stores and present legacy
keys (`lop-app:tasks`, `lop-app:raid`), records are copied into IDB and
legacy keys are removed.

## localStorage keys

| Key | Shape |
|---|---|
| `lop-app:settings` | JSON envelope: `{ language, holidayCountries, ai, jira, notifications }` |
| `lop-app:workspace-collapsed` | `"1"` or absent |
| `lop-app:col-widths` | `Record<string, number>` |
| `lop-app:hidden-cols` | `string[]` |
| `lop-app:task-table-size`, `lop-app:workspace-size`, `lop-app:task-modal-size` | Resizable element sizes |
| `lop-app:tasks`, `lop-app:raid` | **Legacy** — removed after first successful IDB save |

## File-backend formats

`LocalFileBackend` reads/writes one of three formats; round-trips lossless
inside the supported field set.

| Kind | Sections |
|---|---|
| JSON | `{ schemaVersion: 2, tasks: Task[], raid: RaidItem[] }` |
| CSV  | `# TASKS` section + optional `# RAID` section, RFC-style escaping |
| Markdown | `# LOP Tasks` H1 + pipe table; optional `# RAID Log` H1 + pipe table |

## Sanitization (`sanitize.ts`)

All inbound fields from files, CSV, Markdown, Jira, and chat tool calls pass
through `sanitize.ts` helpers: `sanitizeTaskName`, `sanitizeAssignee`,
`sanitizeEmail`, `sanitizeIsoDate`, `sanitizeNotes`, `sanitizeBlockers`,
`sanitizeGroup`, `sanitizeLabels`, `parseDependenciesString`,
`serializeDependencies`, plus `dropDanglingDependencies` for cleanup after
parses.

## RAID derivations (`raid.ts`)

- `riskSeverityFromMatrix(prob, impact)` — 5×5 matrix → 4-level severity.
- `nextRaidId(list)` — `max(id)+1`, used by both UI and migration paths.
- `buildRaidByTaskIndex(raid)` — reverse-lookup `Map<taskId, RaidItem[]>` so task rows can render RAID-reference badges.
