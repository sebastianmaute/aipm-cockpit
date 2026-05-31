<!-- Generated: 2026-05-31 | Files scanned: types.ts, storage.ts, sanitize.ts, raid.ts, activity-log.ts, contacts.ts, resource-foundation.ts, resource-capacity.ts, reminder-snooze.ts, use-settings.ts, jira-token-status.ts, duration.ts + msal-config.ts, turso-config.ts | Token estimate: ~1300 | Updated for 0.29.0–0.37.1: no data schema changes; storage backends remain client-side -->

# Data

No database. All persistence is browser-local: IndexedDB (schema v6) for
tasks / RAID / absences / shifts / resources / roles / disciplines / grades +
a `resource-plan` kv singleton + `budgets` + `fxRates`; localStorage for UI
prefs and lightweight stores (settings, contacts, activity log); optional local
file (CSV/MD/JSON) via the File System Access API.

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
  resourceId?     number                   (Resource Planner v2: stable link;
                                            `assignee` remains display + fallback join)
  originalEstimateMinutes? number          // 0.13.0 — effort tracking; Jira basis
  timeSpentMinutes?        number          //   1w=5d=2400 min, 1d=8h=480 min
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
  resourceId?     number                   // Resource Planner v2 stable link
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

// Resource Planner v2 — schema v5 -----------------------------------------

Discipline { id: number; name: string; localModifiedAt? }   // seeded with
Grade      { id: number; name: string; localModifiedAt? }   // PRESET_DISCIPLINES
                                                            // / PRESET_GRADES
PRESET_DISCIPLINES = ["Developer", "Business Analyst", "Consultant",
                      "Project Manager"]
PRESET_GRADES      = ["Junior", "Associate", "Consultant", "Senior",
                      "Lead", "Principal"]

Role {                                       // discipline × grade combo
  id              number                     // unique per (disciplineId, gradeId)
  disciplineId    number
  gradeId         number
  internalRate    number                     // per hour, in plan.currency
  externalRate    number                     // per hour, customer-billable
  localModifiedAt? ISO 8601 timestamp
}

Resource {                                   // first-class workspace entity
  id              number
  firstName       string                     // split from legacy `name`
  lastName        string                     // display = "firstName lastName" (trimmed)
  title?          string                     // job title
  businessPhone?  string
  location?       string
  department?     string
  email?          string
  company?        string
  birthday?       string                     // "MM-DD" (zero-padded month-day, no year)
  notes?          string                     // free text
  roleId          number | null              // FK → Role.id; null = unassigned
  utilizationMode "percent" | "hours"        // per resource
  utilization     Record<string, number>     // periodKey → value
                                             //   percent mode: 0..100
                                             //   hours   mode: hours
  absenceOverride? Record<string, number>    // periodKey → manual absence HOURS
                                             //   (else auto from Absence ranges)
  active?         boolean                    // soft archive; absent ≡ true
  localModifiedAt? ISO 8601 timestamp
}
// Period keys: month = "YYYY-MM" | ISO week = "GGGG-Www" (e.g. "2026-W07")
// `resourceDisplayName(r)` = `"${firstName} ${lastName}".trim()` (resource-foundation.ts)
// `splitName(str)` splits a free-text string into { firstName, lastName } (resource-foundation.ts)

ResourcePlan {                               // workspace singleton
  startDate       "YYYY-MM-DD"               // planning window start
  endDate         "YYYY-MM-DD"               // planning window end
  granularity     "week" | "month"           // canonical (editable) granularity
  currency        string                     // ISO 4217 (default "EUR")
}
DEFAULT_CURRENCY = "EUR"

// Budget Planner — schema v6 -----------------------------------------------

BudgetBucket {
  id               number
  name             string
  poNumber?        string
  type             "tm" | "fixed"
  currency         "EUR" | "USD" | "GBP"
  fixedPriceAmount? number                  // fixed-price contract amount (bucket currency)
  startDate        "YYYY-MM-DD"
  endDate          "YYYY-MM-DD"
  successorId?     number | null            // spillover target on close
  status           "open" | "closed"
  closedDate?      "YYYY-MM-DD"
  fxRateOverride?  number                   // EUR→currency; overrides cached ECB while set
  allocations      BucketAllocation[]
  order?           number                  // 0.13.0 — drag-reorder position (persisted)
  localModifiedAt? string
}

BucketAllocation {                          // one role line within a bucket
  roleId          number                    // FK → Role.id (supplies internal/external rates)
  resourceIds     number[]                  // feeding resources; their capacity = PLAN hours
  budgetHours     Record<string, number>    // periodKey → budgeted hours
  actualHours     Record<string, number>    // periodKey → actual/booked hours
}

FxRates {                                   // one cached table per workspace
  base            "EUR"
  date            "YYYY-MM-DD"              // ECB publication date
  fetchedAt       string                    // ISO timestamp of the fetch
  rates           Record<string, number>    // currency code → units per 1 EUR
}
```

## Workspace envelope (`storage.ts`)

```
type Workspace = {
  tasks: Task[];
  raid: RaidItem[];
  absences: Absence[];
  shifts: Shift[];                          // dormant after Resource Planner v2
  resources: Resource[];
  roles: Role[];
  disciplines: Discipline[];
  grades: Grade[];
  plan: ResourcePlan;                       // singleton
  budgets?: BucketBucket[];                 // schema v6; optional for compat
  fxRates?: FxRates | null;                // schema v6; optional for compat
};

type StorageKind =
  | "browser"
  | "local-json" | "local-csv" | "local-md"
  | "sp-json" | "sp-csv"                   // 0.22.0: SharePoint backends
  | "turso";                                // 0.25.0: Turso database backend

type StorageConfig =
  | { kind: "browser" }
  | { kind: "local-json" | "local-csv" | "local-md" }
  | { kind: "sp-json" | "sp-csv"; hostname, sitePath, itemPath }
  | { kind: "turso" };

type CreateBackendDeps = {
  acquireToken?: (scopes: string[], options?: {interactive?: boolean}) => Promise<string>;
  tursoConfig?: { databaseUrl?: string; authToken?: string };
  // ... Jira + other deps
};

const SCHEMA_VERSION = 6;
```

`migrateWorkspaceV5(ws)` is **idempotent**: seeds `disciplines`/`grades` when
empty, ensures `plan` exists, and runs `backfillResources` once (when
`resources.length === 0`) to create a Resource per distinct case-folded
`assignee` across tasks + absences and stamp `resourceId` on those records.
Re-running over a populated workspace is a no-op (reference equality).

`migrateWorkspaceV6(ws)` is **idempotent**: ensures `budgets: []` and
`fxRates: undefined` exist when absent. Safe to run over a v5 or v6 workspace.

## IndexedDB layout (`storage.ts`)

```
Database: lop-app  (version 6)
├── object store "kv"           (v1)  — FsHandle + "resource-plan" singleton
│                                       + "budgets" array + "fxRates" object (v6)
├── object store "tasks"        (v2)  — keyPath: "id", value: Task
├── object store "raid"         (v2)  — keyPath: "id", value: RaidItem
├── object store "absences"     (v3)  — keyPath: "id", value: Absence
├── object store "shifts"       (v4)  — keyPath: "id", value: Shift (dormant)
├── object store "resources"    (v5)  — keyPath: "id", value: Resource
├── object store "roles"        (v5)  — keyPath: "id", value: Role
├── object store "disciplines"  (v5)  — keyPath: "id", value: Discipline
└── object store "grades"       (v5)  — keyPath: "id", value: Grade
```

`onupgradeneeded` adds missing stores idempotently — upgraders keep their
data and gain the new stores additively. The `plan` singleton is stored in
the existing `kv` store under key `"resource-plan"`.

On first load post-upgrade, `BrowserBackend.load()` runs `migrateWorkspaceV5`
and persists only what migration changed (reference-equality check per
array + plan kv), so seeds + backfilled `resourceId`s survive reload while a
no-op migration writes nothing.

`writeHandle` guards `write()`/`close()` and calls `abort()` on failure so a blocked write cannot delete the original file (`local-file-write-blocked` guard).

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
| `lop-theme` | `"light"` \| `"dark"` \| `"system"` — persisted theme preference. Default `"system"` (absent = system). Read by the no-flash inline script in `layout.tsx` before hydration and by `use-theme.tsx` at runtime. Separate from the workspace `Settings` object. |
| `lop-app:settings` | JSON envelope: `{ language, holidayCountries, ai, jira, notifications, storage, integrations?, layout? }`. The `layout` field: `"modern" \| "classic"` (default modern). The `jira` sub-object includes `tokenExpiresAt` + `tokenInvalidAt`. **0.21.0+** `integrations` sub-object: `{ m365Enabled: boolean, m365ClientId?: string, m365TenantId?: string, tursoEnabled: boolean, tursoDbUrl?: string, tursoAuthToken?: string }` (Settings → Integrations inputs); overridden by `NEXT_PUBLIC_*` env vars. The `notifications` sub-object: `{ reminderLeadDays, banner: {enabled}, toast: {enabled}, popup: {enabled}, birthday: {enabled} }`. |
| `lop-app:reminder-snooze:due` | Epoch-ms timestamp (stored as decimal string) until which the due-date reminder banner is snoozed; absent or elapsed = not snoozed |
| `lop-app:reminder-snooze:birthday` | Epoch-ms timestamp until which the birthday reminder banner is snoozed; absent or elapsed = not snoozed |
| `lop-app:reminder-snooze:jiraToken` | Epoch-ms timestamp until which the Jira token expiry banner is snoozed; absent or elapsed = not snoozed |
| `lop-app:contacts` | `Record<normalizedName, { name, email }>`, capped at 500 entries |
| `lop-app:activity-log` | `ActivityEntry[]`, capped at 500 (oldest dropped on overflow) |
| `lop-app:workspace-collapsed` | `"1"` or absent |
| `lop-app:sidebar-collapsed` | `"1"` or absent (modern mode only; v0.29.0+) |
| `lop-app:col-widths` | `Record<string, number>` (debounced 250 ms) |
| `lop-app:hidden-cols` | `string[]` |
| `lop-app:task-table-size`, `lop-app:workspace-size`, `lop-app:task-modal-size`, `lop-app:gantt-size`, `lop-app:conflicts-modal-size`, `lop-app:due-modal-size`, `lop-app:help-size`, `lop-app:help-pos` | Resizable element sizes / positions |
| `lop-app:gantt-prefs` | Gantt zoom/scale prefs |
| `lop-app:tasks`, `lop-app:raid` | **Legacy** — removed after first successful IDB save |

## File-backend formats

`LocalFileBackend` reads/writes one of three formats; round-trips lossless
inside the supported field set. Each path runs `migrateWorkspaceV5` + `migrateWorkspaceV6` on parse
so older files self-heal.

| Kind | Sections |
|---|---|
| JSON | `{ schemaVersion: 6, tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates }` |
| CSV  | `# TASKS` + `# RAID` + `# ABSENCES` + `# SHIFTS` + `# DISCIPLINES` + `# GRADES` + `# ROLES` + `# RESOURCES` + `# PLAN` + `# BUDGETS` + `# FX_RATES`, RFC-style escaping |
| Markdown | `# LOP Tasks` + `# RAID Log` + `# Absences` + `# Shifts` + `# Disciplines` + `# Grades` + `# Roles` + `# Resources` + `# Plan` + `# Budgets` + `# FX Rates` H1s, each with a pipe table |

The `utilization` and `absenceOverride` maps serialize into a single
encoded cell each via `encodePeriodMap` / `decodePeriodMap` — format
`"YYYY-MM=80|2026-W07=12"` (period keys validated by `PERIOD_KEY_RE`).

## SharePoint & Turso backends (0.22.0+, 0.25.0+)

**SharePoint** (`sp-json`, `sp-csv`):
- Implemented in `sharepoint-backend.ts`
- Stores entire Workspace as a single JSON/CSV blob in a SharePoint Sites document library
- Calls `parseSharePointFileUrl(url)` to extract site path and item path from the file URL
- Requires MSAL sign-in; acquires Graph token with `Sites.ReadWrite.All` scope
- Reads/writes via Graph `/me/drive/items/{itemId}/content` endpoints

**Turso** (`turso`):
- Implemented in `turso-backend.ts`
- Stores entire Workspace as a single JSON blob in a Turso table row
- Calls Turso HTTP `/v2/pipeline` API (raw fetch, no `@libsql/client` dependency)
- EXECUTE statement for write, SELECT for read
- Configured via Settings → Integrations or `NEXT_PUBLIC_TURSO_DATABASE_URL` / `NEXT_PUBLIC_TURSO_AUTH_TOKEN` env vars
- Recommend scoped Turso tokens (minimal permissions)

## Sanitization (`sanitize.ts`)

All inbound fields from files, CSV, Markdown, Jira, and chat tool calls pass
through `sanitize.ts` helpers: `sanitizeTaskName`, `sanitizeAssignee`,
`sanitizeEmail`, `sanitizeIsoDate`, `sanitizePriority`, `sanitizeNonNegInt`,
`sanitizeNotes`, `sanitizeBlockers`, `sanitizeGroup`, `sanitizeLabel(s)`,
`parseDependenciesString`, `serializeDependencies`, `sanitizeDependencies`,
`wouldCreateDependencyCycle`, `dropDanglingDependencies`,
`sanitizeVoiceTranscript`, plus the Resource Planner v1 additions
`sanitizeAbsence` / `sanitizeShift` (validate types, clamp dates, enforce
`endDate >= startDate`, clamp weekly hours into `[0, MAX_HOURS_PER_DAY]`),
and the Resource Planner v2 additions `sanitizeResource`, `sanitizeRole`,
`sanitizeDiscipline`, `sanitizeGrade`, `sanitizePlan`,
`sanitizeUtilizationMode`, plus the `encodePeriodMap` / `decodePeriodMap`
codec (clamps percent to 0..100 or hours to `HOURS_MAP_MAX`; accepts both
object and CSV-string map forms).

Budget sanitizers (schema v6) add `sanitizeBudgetBucket` and `sanitizeFxRates` to the same module, plus `encodeAllocations`/`decodeAllocations` (the CSV/MD allocation codec); allocations are validated inside `sanitizeBudgetBucket`.

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

## Duration helper (`duration.ts`)

`parseDuration(str) → number | null` — parses a `w/d/h/m` string (e.g.
`"2w 3d 4h"`) into total minutes using the Jira basis (1w = 5d = 2 400 min,
1d = 8h = 480 min, 1h = 60 min, 1m = 1 min). Returns `null` for empty /
invalid input. `formatDuration(minutes) → string` — round-trips back to the
shortest canonical representation (omits zero-valued units). Both functions
are pure with no React dependency; used by the task form and sanitizer for
`originalEstimateMinutes` / `timeSpentMinutes`. **0.13.1:** `effortProgress(spent, estimate) → number | null` — returns the spent-vs-estimate ratio (0..n, where >1 means over budget); returns `null` when estimate is absent or zero. Used by `EffortProgressBar`.

## Contacts (`contacts.ts`)

`Contact { name, email }` keyed by `normalizedName` (trimmed lowercase) in a
`ContactsMap`. Capped at `CONTACTS_MAX = 500`. Persisted to `lop-app:contacts`
independently of the tasks list so suggestions survive task deletion, Clear
All, and Jira sync churn.
