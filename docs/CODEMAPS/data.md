<!-- Generated: 2026-05-17 | Files scanned: types.ts, storage.ts, sanitize.ts, raid.ts, activity-log.ts, contacts.ts | Token estimate: ~900 -->

# Data

No database. All persistence is browser-local: IndexedDB for tasks / RAID /
absences / shifts, localStorage for UI prefs and lightweight stores (settings,
contacts, activity log), optional local file (CSV/MD/JSON) via the File
System Access API.

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
  causedByRaidIds number[]                (parent RAID items; always an array,
                                           legacy singular causedByRaidId migrated on parse)
}

Absence {                                  // Resource Planner v1
  id              number
  assignee        string                   // free-text; joined to Task.assignee
  assigneeEmail?  string
  startDate       "YYYY-MM-DD"             // inclusive
  endDate         "YYYY-MM-DD"             // inclusive; >= startDate
  type            "vacation" | "sick" | "training" | "other"
  note?           string
  localModifiedAt? ISO 8601 timestamp
}

Shift {                                    // Resource Planner Phase 4
  id              number
  assignee        string                   // case-fold join with Task/Absence
  assigneeEmail?  string
  hoursPerWeekday WeekHours                // tuple [Sun, Mon, ..., Sat] of 0..24
  note?           string
  localModifiedAt? ISO 8601 timestamp
}
// Default when no Shift: DEFAULT_WEEK_HOURS = [0, 8, 8, 8, 8, 8, 0]
// Bound: MAX_HOURS_PER_DAY = 24
```

## Workspace envelope (`storage.ts`)

```
type Workspace = {
  tasks: Task[];
  raid: RaidItem[];
  absences: Absence[];
  shifts: Shift[];
};
const SCHEMA_VERSION = 4;
```

## IndexedDB layout (`storage.ts`)

```
Database: lop-app  (version 4)
├── object store "kv"        (v1)  — FsHandle storage for LocalFileBackend
├── object store "tasks"     (v2)  — keyPath: "id", value: Task
├── object store "raid"      (v2)  — keyPath: "id", value: RaidItem
├── object store "absences"  (v3)  — keyPath: "id", value: Absence
└── object store "shifts"    (v4)  — keyPath: "id", value: Shift
```

`onupgradeneeded` adds missing stores idempotently — upgraders keep their
data and gain the new stores additively.

Saves are **record-level**: `BrowserBackend.save(ws)` diffs each of `tasks`,
`raid`, `absences`, `shifts` against an in-memory baseline using reference
equality (relies on the codebase's immutable-update convention) and emits
only `put` for changed records + `delete` for removed ids per store. One
transaction per store, short-circuited when there is no work. Baseline is
refreshed after each successful save.

One-time migration: on first load with empty IDB stores and present legacy
keys (`lop-app:tasks`, `lop-app:raid`), records are copied into IDB and
legacy keys are removed.

## localStorage keys

| Key | Shape |
|---|---|
| `lop-app:settings` | JSON envelope: `{ language, holidayCountries, ai, jira, notifications, storage }` |
| `lop-app:contacts` | `Record<normalizedName, { name, email }>`, capped at 500 entries |
| `lop-app:activity-log` | `ActivityEntry[]`, capped at 500 (oldest dropped on overflow) |
| `lop-app:workspace-collapsed` | `"1"` or absent |
| `lop-app:col-widths` | `Record<string, number>` (debounced 250 ms) |
| `lop-app:hidden-cols` | `string[]` |
| `lop-app:task-table-size`, `lop-app:workspace-size`, `lop-app:task-modal-size`, `lop-app:gantt-size`, `lop-app:conflicts-modal-size`, `lop-app:due-modal-size`, `lop-app:help-size`, `lop-app:help-pos` | Resizable element sizes / positions |
| `lop-app:gantt-prefs` | Gantt zoom/scale prefs |
| `lop-app:tasks`, `lop-app:raid` | **Legacy** — removed after first successful IDB save |

## File-backend formats

`LocalFileBackend` reads/writes one of three formats; round-trips lossless
inside the supported field set. The CSV and Markdown encoders both emit four
sections (tasks, raid, absences, shifts) in a single file.

| Kind | Sections |
|---|---|
| JSON | `{ schemaVersion: 4, tasks: Task[], raid: RaidItem[], absences: Absence[], shifts: Shift[] }` |
| CSV  | `# TASKS` + `# RAID` + `# ABSENCES` + `# SHIFTS` sections, RFC-style escaping |
| Markdown | `# LOP Tasks` + `# RAID Log` + `# Absences` + `# Shifts` H1s, each with a pipe table |

SharePoint backends (`sp-json`, `sp-csv`) are declared in `StorageConfig` but
not yet implemented — the factory returns a `SharePointBackend` stub whose
`load`/`save` throw `StorageNotImplementedError`.

## Sanitization (`sanitize.ts`)

All inbound fields from files, CSV, Markdown, Jira, and chat tool calls pass
through `sanitize.ts` helpers: `sanitizeTaskName`, `sanitizeAssignee`,
`sanitizeEmail`, `sanitizeIsoDate`, `sanitizePriority`, `sanitizeNonNegInt`,
`sanitizeNotes`, `sanitizeBlockers`, `sanitizeGroup`, `sanitizeLabel(s)`,
`parseDependenciesString`, `serializeDependencies`, `sanitizeDependencies`,
`wouldCreateDependencyCycle`, `dropDanglingDependencies`,
`sanitizeVoiceTranscript`, plus the Resource Planner additions
`sanitizeAbsence` and `sanitizeShift` (validate types, clamp dates, enforce
`endDate >= startDate`, clamp weekly hours into `[0, MAX_HOURS_PER_DAY]`).

## RAID derivations (`raid.ts`)

- `riskSeverityFromMatrix(prob, impact)` — 5×5 matrix → 4-level severity.
- `statusOptionsFor(category)` / `defaultStatusForCategory(category)` — scoped per category.
- `isTerminalStatus(category, status)` — closed/realized/etc.
- `severityRag(severity)` — severity → RAG color.
- `nextRaidId(list)` — `max(id)+1`, shared by UI and migration paths.
- `buildRaidByTaskIndex(raid)` — reverse-lookup `Map<taskId, RaidItem[]>` so task rows can render RAID-reference badges.
- `buildRaidCausesIndex(raid)` / `wouldCreateCycle(...)` — parent/child cycle detection for `causedByRaidIds`.
- `countByCategory(raid)` — totals per R/A/I/D for badges.

## Activity log (`activity-log.ts`)

`ActivityEntry { id, timestamp, kind, args }` with 21 `ActivityKind` values
covering task / raid / bulk / jira / absence / shift CRUD. Persisted to
`lop-app:activity-log` only — explicitly excluded from any export path
("non-persistent, not written to file, just local storage"). Capped at
`ACTIVITY_MAX_ENTRIES = 500`; oldest entries dropped on overflow. Render-time
templating goes through `ACTIVITY_KIND_TO_KEY` → i18n.

## Contacts (`contacts.ts`)

`Contact { name, email }` keyed by `normalizedName` (trimmed lowercase) in a
`ContactsMap`. Capped at `CONTACTS_MAX = 500`. Persisted to `lop-app:contacts`
independently of the tasks list so suggestions survive task deletion, Clear
All, and Jira sync churn.
