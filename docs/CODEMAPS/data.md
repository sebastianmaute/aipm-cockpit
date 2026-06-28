<!-- Generated: 2026-06-11 | Files scanned: types.ts, storage.ts, sanitize.ts, raid.ts, activity-log.ts, contacts.ts, resource-foundation.ts, resource-capacity.ts, reminder-snooze.ts, use-settings.ts, jira-token-status.ts, duration.ts + msal-config.ts, turso-config.ts, project-options.ts, nace-sections.ts, portfolio-mode.ts, projects-registry.ts, project-file-handles.ts, turso-tenant-schema.ts, feature-modules.ts, document-link.ts | Token estimate: ~1500 | Updated for 0.29.0–0.60.0: ProjectStatus + Milestone[] persisted (v6 additive, no schema bump); budget-health + budget-burndown pure modules; ChangeItem[] change-control register persisted (schema v7 additive); RaidItem/ChangeItem gained `stakeholderIds` stakeholder-communication links (v0.55); Settings.features feature-module map (Simple/Modular/Advanced); ProjectMeta multi-project header persisted (Workspace schema v9 additive; Phase 1); Turso multi-tenancy (one shared DB, `project_id` on every table, tenant schema v10); snapshot tables scoped per project_id; sample-workspace.json + sample-workspace.sqlite3 generated from the curated .md (Turso import, sqlite now multi-tenant v10); DocumentLink[] on all six entities (workspace schema v10, turso single-tenant v10, turso multi-tenant v11); data version history (`version-history.ts` ProjectVersion/ProjectVersionMeta types + `Settings.versionHistoryRetention`; append-only `project_versions` table kept out of TABLE_NAMES, Turso-only) [0.66.0–0.69.0]; Task.status enum + completedDate invariant (`task-status.ts`) [0.107.0]; tasksViewMode [0.108.0]; Workspace.steeringCommittee (`SteeringCommittee`/`CommitteeMeeting`/`InfoSchedule`) [0.111.0]; settings.tourSeen [0.112.0]; ProjectMeta.operatingTimezone + settings.timezone/additionalTimezones [0.113.0–0.115.0]; AI config ai.scheduledJobs/actionSuggestions/suggestAllNextActionThresholds + global scheduled_jobs store [0.97.0–0.110.0] -->

# Data

No traditional database. Default persistence is browser-local: IndexedDB
(store version v6 — distinct from the logical Workspace `SCHEMA_VERSION = 9`)
for tasks / RAID / absences / shifts / resources / roles / disciplines / grades +
a `resource-plan` kv singleton + `budgets` + `fxRates` + `project`; localStorage
for UI prefs and lightweight stores (settings, contacts, activity log, the
portfolio mode + project registry); optional local file (CSV/MD/JSON) via the
File System Access API; optional remote backends (SharePoint, Turso). Multi-project
(v0.58 Phase 1, file-based) and Turso multi-tenancy (v0.59 Phase 2) layer a
portfolio of full workspaces on top — each carries a `ProjectMeta` header.

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
  status          TaskStatus               // 0.107.0 — "To Do"|"In Progress"|"On Hold"|
                                           //   "In Review"|"Cancelled"|"Done"; SOURCE OF TRUTH
                                           //   for "done". Invariant: status==="Done" ⟺ completedDate
                                           //   set. Sole writer is applyStatusChange (task-status.ts);
                                           //   migrateTaskStatus backfills on all six load paths.
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
  stakeholderIds  number[]                (v0.55: FK → Stakeholder.id; drives the
                                           stakeholder-communication reminder engine; always [])
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

ProjectStatus {                              // 0.43.0: per-workspace PM health override
  overall         "R" | "A" | "G"           // Red/Amber/Green override; null = auto from Schedule
  schedule        "R" | "A" | "G"           // Folded into Schedule RAG (from milestones + EVM SPI)
  budget          "R" | "A" | "G"           // Folded into Budget RAG (from EVM CPI)
  scope           "R" | "A" | "G"           // User-set scope health
  narrative?      string                    // Free-text PM summary
  narrativeUpdatedAt? ISO 8601 timestamp
}

Milestone {                                  // 0.44.0: project milestone with earned value
  id              number
  name            string
  date            "YYYY-MM-DD"              // planned milestone date
  description?    string
  achievedDate?   "YYYY-MM-DD"              // null = not yet achieved
  linkedTaskIds   number[]                  // tasks that feed this milestone
  outlookEventId? string                    // 0.96.0: Graph calendar-event link for write-back
                                            // (six write paths); event tagged `AIPM:<projectId>`
  localModifiedAt? ISO 8601 timestamp
}

// Stakeholder register — schema v8 ----------------------------------------
Stakeholder {                                // 0.52.0: project stakeholder entity
  id                number
  name              string
  role?             string                   // job title / project role
  organisation?     string
  email?            string
  phone?            string
  engagementLevel   "Unaware" | "Resistant" | "Neutral" | "Supportive" | "Leading"
  influence         1..5                     // power/influence score
  interest          1..5                     // interest/salience score
  notes?            string
  resourceId?       number | null            // optional FK → Resource.id
  localModifiedAt?  ISO 8601 timestamp
}

RaciEntry {                                  // 0.52.0: one cell in the RACI matrix
  stakeholderId     number                   // FK → Stakeholder.id
  milestoneId       number                   // FK → Milestone.id
  role              "R" | "A" | "C" | "I"   // Responsible / Accountable / Consulted / Informed
}

// Change-control register — schema v7 -------------------------------------
ChangeItem {                                 // 0.50.0: RAID-sibling change request
  id                number
  title             string
  description       string
  type              "Scope" | "Schedule" | "Cost" | "Quality" | "Other"
  status            "Proposed" | "Under Review" | "Approved" | "Rejected" | "Implemented" | "Deferred"
  impact?           RiskScale                 // reuses the RAID severity scale + RAG palette
  impactDescription? string
  scheduleImpactDays? number                  // optional schedule impact (± days)
  costImpact?       number                    // optional cost impact
  requestedBy?      string                    // requestor
  raisedDate        "YYYY-MM-DD"
  decisionBy?       string                    // approver
  decisionDate?     "YYYY-MM-DD"             // auto-filled when status leaves the pending set
  resolutionNotes?  string
  linkedTaskIds     number[]                  // linked tasks
  linkedRaidIds     number[]                  // linked RAID items
  stakeholderIds    number[]                  // v0.55: FK → Stakeholder.id; drives the
                                              //   stakeholder-communication reminder engine; always []
  localModifiedAt?  ISO 8601 timestamp
}

// Multi-project / portfolio — schema v9 -----------------------------------
// ProjectMeta is the top-level descriptor of the project a workspace tracks
// (Phase 1, v0.58). Additive: a workspace with `project === undefined`
// serializes byte-for-byte as before (no project block emitted).

IdentityType   = "B2E" | "B2B" | "B2C" | "NHI"                 // project-options.ts
Deployment     = "Cloud" | "On-premise" | "Hybrid"
RegulatoryRequirement =
  "Not applicable" | "GDPR / data protection regulation" | "DORA" | "MaRisk"
  | "BAIT" | "NIS2" | "HIPAA" | "SOX" | "EU AI Act"
  | "Export control / sanctions compliance"
// NACE section = single letter "A".."U" (NACE Rev 2.1, 21 sections A–U;
//   nace-sections.ts NACE_SECTIONS / NACE_SECTION_SET)

ContactPerson {
  name            string
  email           string
  synced          boolean                  // true = copied from address book; false = manual, never synced back
}

ProjectMeta {
  // Identity
  name                    string
  code                    string
  description?            string
  // People — internal group
  sponsor?                string
  projectManager          string
  keyStakeholdersInternal string[]         // OPTIONAL since the contacts overhaul (0.74); may be []
  keyStakeholdersExternal string[]         // OPTIONAL since the contacts overhaul (0.74); may be []
  // Customer group
  customer                string
  naceSection             string           // NACE section letter, e.g. "C" (validated A–U)
  identityTypes           IdentityType[]
  identityCount?          number
  products                string
  platform?               string
  deployment              Deployment
  startDate               "YYYY-MM-DD"
  endDate?                "YYYY-MM-DD"      // OPTIONAL since 0.74; when present must be ≥ startDate
  profitCenter            string
  quotes?                 string
  salesforceUrl?          string
  sharepointUrl?          string
  confluenceUrl?          string
  jiraUrl?                string            // 0.74: "Link to Jira"
  contactPersons          ContactPerson[]  // MANDATORY at the form layer (≥1) since 0.74; sanitize
                                           //   stays lenient so legacy projects without contacts decode
  docRepoLocation?        string
  regulatory              RegulatoryRequirement[]  // required (non-empty unless lenient);
                                                   //   "Not applicable" collapses the rest
  operatingTimezone?      string           // 0.113.0: IANA operating tz (e.g. "Asia/Kolkata");
                                           //   drives day-boundary logic via resolveTimezone
  notes?                  string
}

// Steering committee — 0.111.0 --------------------------------------------
CommitteeMeeting { id: number; date: "YYYY-MM-DD"; title: string;
                   agenda?: string; location?: string; outlookEventId? }
InfoSchedule     { id: number; label: string; leadDays: number }  // working days before
                                                                   //   a meeting a pack circulates
SteeringCommittee {
  name                  string
  memberResourceIds     number[]           // FK → Resource.id
  meetings              CommitteeMeeting[]
  infoSchedules         InfoSchedule[]
  infoReminderEventIds? Record<string,string>   // pushed Outlook event ids per reminder
  pendingDeleteEventIds? string[]                // orphaned ids of deleted meetings, cleared on next push
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
  status?: ProjectStatus;                   // 0.43.0+; optional for compat
  milestones?: Milestone[];                 // 0.44.0+; optional for compat
  changes?: ChangeItem[];                   // schema v7 (0.50.0+); optional for compat
  stakeholders?: Stakeholder[];             // schema v8 (0.52.0+); optional for compat
  project?: ProjectMeta;                    // schema v9 (0.58.0+); top-level project header.
                                            //   Additive: undefined ⇒ no project block emitted
                                            //   (byte-identical to pre-field serialization)
  features?: FeatureModuleId[];             // per-project enabled modules (functions).
                                            //   Present-only: undefined ⇒ no override; [] ⇒ Simple
  steeringCommittee?: SteeringCommittee;    // 0.111.0+; optional. Committee + meetings +
                                            //   info-schedule rules; persisted across all backends
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

const SCHEMA_VERSION = 9;          // logical Workspace version (≠ IndexedDB store version 6)
```

`migrateWorkspaceV5(ws)` is **idempotent**: seeds `disciplines`/`grades` when
empty, ensures `plan` exists, and runs `backfillResources` once (when
`resources.length === 0`) to create a Resource per distinct case-folded
`assignee` across tasks + absences and stamp `resourceId` on those records.
Re-running over a populated workspace is a no-op (reference equality).

`migrateWorkspaceV6(ws)` is **idempotent**: ensures `budgets: []` and
`fxRates: undefined` exist when absent. Safe to run over a v5 or v6 workspace.
Backfill for `status` (0.43.0+) and `milestones` (0.44.0+) is additive — old
workspaces auto-populate these as empty/null when first loaded and persisted.

`migrateWorkspaceV7(ws)` (schema v7, 0.50.0+) runs `migrateWorkspaceV6` first,
then ensures `changes: []` exists when absent (idempotent — a no-op via
reference equality when already present). `SCHEMA_VERSION` is now `7`; all
load paths (JSON / CSV / Markdown / Turso) run it on parse so old workspaces
auto-populate an empty change register.

`migrateWorkspaceV8(ws)` (schema v8, 0.52.0+) runs `migrateWorkspaceV7` first,
then ensures `stakeholders: []` exists when absent (idempotent). `SCHEMA_VERSION`
is now `8`; all load paths run it on parse so old workspaces auto-populate an
empty stakeholder register. The Turso backend gains a `stakeholders` table
(columns: id, name, role, organisation, email, phone, engagementLevel, influence,
interest, notes, resourceId, localModifiedAt) added by an additive migration.

**Schema v9 (0.58.0+)** bumps `SCHEMA_VERSION` to `9` for the additive
`Workspace.project` (`ProjectMeta`) field. There is **no dedicated
`migrateWorkspaceV9` function** — `migrateWorkspaceV8` remains the tail of the
chain (V8 → V7 → V6 → V5). Instead, every load path decodes `project` on its own:
when a `project` block is present it is run through `sanitizeProjectMeta` and
attached; when absent the key is simply left off, so a no-project workspace stays
byte-identical to pre-v9 output. The `BrowserBackend` reads/writes it via the
`kv` key `"project"`; CSV/Markdown/JSON gate emission on `ws.project` being set
(and, for the dual-use document exports, on `config === undefined`).

**Per-project functions** — `Workspace.features?` (`FeatureModuleId[]`) records the
modules enabled for a project. It is serialized like `fieldVisibility`: a
present-only field carried across JSON / CSV / Markdown / Turso (single-tenant
plus the tenant meta-KV). Semantics are additive and migration-free: `undefined`
means *no override* (legacy projects inherit the global default, i.e. all
modules) and `[]` means *Simple mode* (no modules). On load the workspace value
is mirrored into the reactive `settings.features` — see `useFeaturesSync` in
frontend.md — so a project switch re-renders the enabled function set without a
page reload.

## IndexedDB layout (`storage.ts`)

```
Database: lop-app  (version 6)
├── object store "kv"           (v1)  — FsHandle + "resource-plan" singleton
│                                       + "budgets" array + "fxRates" object (v6)
│                                       + "status" object (0.43.0+) + "milestones" array (0.44.0+)
│                                       + "changes" array (schema v7, 0.50.0+)
│                                       + "stakeholders" array (schema v8, 0.52.0+)
│                                       + "project" object (schema v9, 0.58.0+; absent ⇒ no project)
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

**Per-project file handles** (v0.58 Phase 1) live in a **separate** IndexedDB
database `lop-app-project-handles` (version 1, single out-of-line store
`handles`; `project-file-handles.ts`) so storing `FileSystemFileHandle`s per
project never touches the main `lop-app` DB's schema version. Records are keyed
by the project id via `put(handle, projectId)`; all ops are no-ops when
IndexedDB is unavailable (SSR).

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
| `lop-app:settings` | JSON envelope: `{ language, holidayCountries, ai, jira, notifications, storage, integrations?, layout?, reports?, popout?, resources?, snapshots?, features?, export? }`. The `layout` field: `"modern" \| "classic"` (default modern). The `jira` sub-object includes `tokenExpiresAt` + `tokenInvalidAt`. **0.21.0+** `integrations` sub-object: `{ m365Enabled: boolean, m365ClientId?: string, m365TenantId?: string, tursoEnabled: boolean, tursoDbUrl?: string, tursoAuthToken?: string }` (Settings → Integrations inputs); overridden by `NEXT_PUBLIC_*` env vars. The `notifications` sub-object: `{ reminderLeadDays, banner: {enabled}, toast: {enabled}, popup: {enabled}, birthday: {enabled} }`. **0.54.0+** `features`: `FeatureModuleId[]` (the enabled feature modules — `dashboard`, `trends`, `gantt`, `milestones`, `resources`, `budget`, `raid`, `changes`, `stakeholders`, `history` (0.66.0+, Turso version history); `feature-modules.ts`). `sanitizeFeatures(undefined) ⇒ all modules` (legacy migration); `[] ⇒ Simple`, all ⇒ Advanced, partial ⇒ Modular (`deriveMode`). Gates nav / automation / dashboard / reports. **0.97.0+** `ai` sub-object grew master `groundInGuides` (default ON) + `actionSuggestions?` (Action-Center "Analyze with AI", default ON) + `scheduledJobs?` (recurring billed analysis, default OFF/opt-in) + `suggestAllNextActionThresholds?` (AI weight suggestions, default OFF). **0.108.0+** `tasksViewMode: "table" \| "board"` (per-device Kanban toggle). **0.112.0+** `tourSeen?: boolean` (guided-tour seen flag). **0.113.0+** `timezone?: string` (per-device display/operating tz override; undefined = follow project/browser) + `additionalTimezones?: string[]` (extra zones for the display switcher + calendar clock strip). |
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
| `lop-app:portfolio-mode` | `"file" \| "turso"` — global portfolio storage mode (v0.58/0.59; `portfolio-mode.ts`). Absent / anything but `"turso"` ⇒ `"file"`. |
| `lop-app:turso-current-project` | Turso-mode last-selected project id (string); absent = none. The Turso `projects` table is the source of truth — this only caches the selection (`portfolio-mode.ts`). |
| `lop-app:projects` | File-mode project registry (v0.58 Phase 1; `projects-registry.ts`): `{ projects: ProjectRegistryEntry[], currentProjectId: string \| null }` where `ProjectRegistryEntry = { id, name, code, storageConfig }`. Malformed entries dropped on load; dangling `currentProjectId` coerced to `null`. |
| `lop-app:action-learning` | **0.95.0+** Action Center learning store (local backend): per-kind outcome stats (`acted` / `snoozed` / `dismissed` / `last_at`) + explicit overrides. Opt-in; absent until the learning layer records its first outcome. Manual reset = delete this key. The alternative backend is the global Turso `action_learning` table (see below). |
| `lop-app:scheduled-jobs` | **0.97.0+ (SP5)** AI scheduled-jobs store (local backend): `ScheduledJob[]` (`{ id, cadence, lastRunAt?, runs: ScheduledJobRun[] }`, history capped at `JOB_HISTORY_CAP = 10`). Opt-in (`ai.scheduledJobs`); used when `tursoConfig === null`. The cross-device backend is the global Turso `scheduled_jobs` table (see below). |
| `lop-app:timelog-actuals` | **0.144.0+** Timelog per-device cache (`timelog-actuals-store.ts`): the fetched Timelog people + project refs (so the matching tables survive a view switch) alongside the optional aggregated actuals. Per-device only — **not** a `Workspace` field (no new persisted Workspace field this release), excluded from exports/Turso, cleared by `clearAppConfig`. |
| `lop-app:tasks`, `lop-app:raid` | **Legacy** — removed after first successful IDB save |

## File-backend formats

`LocalFileBackend` reads/writes one of three formats; round-trips lossless
inside the supported field set. Each path runs `migrateWorkspaceV8` on parse
(which chains `migrateWorkspaceV7` → `migrateWorkspaceV6` → `migrateWorkspaceV5`)
so older files self-heal; `project` is decoded separately via
`sanitizeProjectMeta` (no migration step — see schema v9 above).

| Kind | Sections |
|---|---|
| JSON | `{ schemaVersion: 9, tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, milestones, changes, stakeholders, project? }` (`project` key emitted only when set) |
| CSV  | `# TASKS` + `# RAID` + `# ABSENCES` + `# SHIFTS` + `# DISCIPLINES` + `# GRADES` + `# ROLES` + `# RESOURCES` + `# PLAN` + `# BUDGETS` + `# FX_RATES` + `# PROJECT STATUS` + `# MILESTONES` + `# CHANGES` (+ a project section when `ws.project` set and `config === undefined`), RFC-style escaping |
| Markdown | `# LOP Tasks` + `# RAID Log` + `# Absences` + `# Shifts` + `# Disciplines` + `# Grades` + `# Roles` + `# Resources` + `# Plan` + `# Budgets` + `# FX Rates` H1s + `## Project Status` (field bullets) + `## Milestones` (pipe table) + `## Changes` (pipe table) H2s (+ a project block when `ws.project` set and `config === undefined`) |

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
- Single-tenant relational mapping lives in `turso-schema.ts` (`SCHEMA_VERSION = "9"`)

## Turso multi-tenancy (schema v10, 0.59.0+)

`turso-tenant-schema.ts` implements the v0.59 "Gibson" portfolio Phase 2:
**one shared Turso database holds every project**. Built generically from the
SAME column registries + encoders the single-tenant `turso-schema.ts` uses
(`ENTITY_SPECS` / `PLAN_COLUMNS` / `FX_COLUMNS`), plus Phase 1's
`PROJECT_CSV_COLUMNS` / `projectFieldToString` / `buildProjectFromObjLenient`
for the projects table.

- **`project_id TEXT` on every table.** Each workspace entity table gains a
  `project_id` column. For tables with an `id`, the single-column PK is dropped
  in favour of a composite `PRIMARY KEY (id, project_id)` (`tenantColDdl`
  renders `id` as plain `INTEGER`), so ids are unique **per project** within the
  shared DB.
- **`projects` table = authoritative project list.** `CREATE TABLE projects
  (id TEXT PRIMARY KEY, "archived" TEXT, …PROJECT_CSV_COLUMNS)` — one
  `ProjectMeta` row per project. `archived` is `"0"` / `"1"` (soft archive);
  hard-delete removes the row + every `WHERE project_id = ?` table slice.
- **`meta` / `plan` / `fx_rates` are project_id-scoped and unkeyed** — they drop
  the single-tenant fixed PK so multiple projects each keep their own row(s).
  Every load `SELECT … WHERE project_id = ?`, so `rowsToWorkspace`'s first-row /
  find-status logic still works.
- `tenantWorkspaceToStatements(ws, projectId)` saves via a `BEGIN` → DDL →
  per-table `DELETE … WHERE project_id` → re-INSERT → `COMMIT` batch; `meta`
  stores `schema_version` + `project_status` per project. `load()` also runs
  `selectProjectStatement(id)` to populate `ws.project` (rowsToWorkspace does
  not carry `ProjectMeta`). Project CRUD: `list/listArchived/upsert/archive/
  restore/hardDelete` statements + `rowsToProjectList`.
- **`SCHEMA_VERSION = "10"`** — intentionally distinct from the single-tenant
  `turso-schema.ts` `"9"`; the two schemas evolve independently.

**Snapshots** (`snapshot-schema.ts`, Turso-only Trends): snapshot tables now
carry a `project_id` column (scoped per project) and stay **out of** the
workspace `TABLE_NAMES` (guard test), so a workspace save's clear-all
(`DELETE … WHERE project_id`) never wipes them.

**Version history** (`version-history.ts` types + `version-schema.ts` DDL,
Turso-only, 0.66.0+): an append-only `project_versions` table stores the full
workspace JSON payload per version (`ProjectVersion extends ProjectVersionMeta`
— id, projectId, `trigger: "auto" | "manual"`, label, timestamp + payload).
Like the snapshot tables it is kept **out of** the workspace `TABLE_NAMES`, so
a workspace save's clear-all never wipes it; auto-versions are pruned to
`Settings.versionHistoryRetention` (`settings-types.ts`; `sanitizeVersionRetention`
clamps to min 50 / max 1000 in steps of 10, default 50), named checkpoints are
exempt.

**Action Center learning** (`learning-schema.ts` DDL + `learning-store-turso.ts`,
opt-in, 0.95.0+): a **global** (cross-project, NOT project-scoped) `action_learning`
table — `(kind TEXT PRIMARY KEY, acted, snoozed, dismissed, last_at, override)` —
holds the per-kind learning state for the Turso store backend (the local backend
uses the `lop-app:action-learning` localStorage key instead). Like the snapshot
and version tables it is kept **out of** the workspace `TABLE_NAMES`, so a
workspace save's clear-all never touches it; a manual reset is
`DELETE FROM action_learning`. Writes are a full rewrite (DELETE then re-insert)
of the table.

**AI scheduled jobs** (`scheduled-jobs-store.ts`, opt-in, SP5): a **global**
(cross-project) `scheduled_jobs` table storing the `ScheduledJob[]` as a JSON
blob row. Like the snapshot / version / learning tables it is kept **out of**
the workspace `TABLE_NAMES` (guard test), so a workspace save's clear-all never
wipes it; writes are a full rewrite (DELETE then re-insert, no per-id diffing).
Selected only when `tursoConfig !== null`; otherwise the local
`lop-app:scheduled-jobs` key is the backend.

## Sanitization (`sanitize.ts`)

`sanitize.ts` is a barrel (`export *`) over `sanitize-core` (primitives + length
caps), `sanitize-entities`, and `sanitize-records` (one-way deps core ← entities
← records); importers keep using `./sanitize`. All inbound fields from files,
CSV, Markdown, Jira, and chat tool calls pass through its helpers:
`sanitizeTaskName`, `sanitizeAssignee`,
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

Multi-project (schema v9) adds `sanitizeProjectMeta(input, { lenientRequiredArrays? })`:
validates required short-text fields (name, code, projectManager, customer,
products, profitCenter), required enums (`naceSection` ∈ A–U, `deployment` ∈
`DEPLOYMENT_SET`), required `startDate` (`endDate` is optional since 0.74),
filters `identityTypes` / `regulatory` to their known sets (de-duped;
`"Not applicable"` collapses the rest), and keeps valid `contactPersons`.
Returns `null` on any failure. `keyStakeholdersInternal` /
`keyStakeholdersExternal` are accepted as-is (OPTIONAL since the 0.74 contacts
overhaul — sanitize no longer rejects empty stakeholder arrays). The default
(strict) mode still rejects empty `regulatory`; the **lenient** variant
(`{ lenientRequiredArrays: true }`) relaxes that and is used by the Turso
projects-row decode (`buildProjectFromObjLenient`) where a partial row should
still yield a usable `ProjectMeta`. NOTE: the **mandatory contact (≥1)** rule is
enforced only at the form layer (`validateProjectMeta`), NOT in `sanitizeProjectMeta`,
so projects saved before 0.74 (no contacts) still decode.

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

## Budget health (`budget-health.ts`)

Pure RAG-threshold module (0.47.0+). `bucketHealthRag(report)` maps a bucket's
consumption ratio (Amber ≥90 %, Red >100 %), cost-performance index (CPI bands
0.8/0.9 matching EVM), and contribution margin (Green ≥15 %, Red <0) to
`"R" | "A" | "G"`. No React dependency; used by `budget-panel.tsx` and
`budget-report-panel.tsx`.

## Budget burn-down (`budget-burndown.ts`)

Pure series module (0.47.0+). `buildBurndownSeries(report, fxRates)` derives
per-period remaining hours and EUR across all open buckets, producing two
`BurndownPoint[]` arrays (hours + currency) for the SVG `BurndownCharts`
component. No React dependency.

## RAID review reminders (`raid-review.ts`)

Pure logic (0.51.0+) flagging active RAID items overdue for review — past their
`targetDate` or not reviewed within the configured interval (`reviewIntervalDays`,
default 14) measured against `localModifiedAt`. No React dependency; feeds the
RAID review banner / modal / toast nudge.

## Contacts (`contacts.ts`)

`Contact { name, email }` keyed by `normalizedName` (trimmed lowercase) in a
`ContactsMap`. Capped at `CONTACTS_MAX = 500`. Persisted to `lop-app:contacts`
independently of the tasks list so suggestions survive task deletion, Clear
All, and Jira sync churn.

## Sample workspace

| File | Description |
|---|---|
| `sample-workspace-small.md` | Hand-curated master (Markdown pipe-table, all entities incl. blended budgets) — the source of truth |
| `sample-workspace-small.csv` | Hand-curated CSV companion (partial by format design: no budgets/changes) |
| `sample-workspace-small.json` | Generated full JSON envelope (`schemaVersion: 9`, all entities + a demo `project` ProjectMeta + demo enrichment) |
| `sample-workspace-small.sqlite3` | Generated SQLite database mirroring the **multi-tenant** Turso relational schema (schema v10: one `projects` row + `project_id` on every table; WAL journal mode); import with `turso db create lop-demo --from-file sample-workspace-small.sqlite3` |
| `sample-workspace-big.{json,sqlite3}` | Generated 3× scale-up of the small workspace (pure `scaleWorkspace`: id-offset + full FK remap; reference data not replicated) — for testing larger projects |
| `sample-workspace-huge.{json,sqlite3}` | Generated 10× scale-up of the small workspace, same method |

`scripts/generate-sample-workspace.ts` parses the curated `sample-workspace-small.md`,
enriches it with a demo change-log + RAID→stakeholder links + a synthesized
`ProjectMeta` (with a stable id `sample-project-0001`), and emits the two
COMPLETE, faithfully-round-tripping formats (`.json` + `.sqlite3`) via
`npx vite-node scripts/generate-sample-workspace.ts`. The `.sqlite3` is built
through `tenantWorkspaceToStatements` + `upsertProjectStatement`
(`turso-tenant-schema.ts`), so it is the multi-tenant v10 schema (one `projects`
row, `project_id` on every table) and must be WAL journal mode for
`turso db create --from-file`. It does NOT overwrite the `.md`/`.csv` masters:
`workspaceToMarkdown` does not `\|`-escape the pipe-delimited blended-budget
cell, so re-emitting the MD would corrupt the blended bucket. The dataset
includes tasks, RAID items with `stakeholderIds` links, milestones, stakeholders
with RACI assignments, change-log entries, budget buckets, resources, and the
project header.

## Document links (`document-link.ts`) — 0.60.0+

`DocumentLink { id, name, url, type: "file" | "folder", webUrl? }` — a
SharePoint file or folder reference attached to a workspace entity. Pure
module with type definition, `sanitizeDocumentLink` (field-length caps +
URL validation), and a `documentLinkToCell` / `documentLinkFromCell`
JSON-in-cell codec used by the CSV/Markdown backends.

All six workspace entities gained an optional `documentLinks?: DocumentLink[]`
field in 0.60.0:

| Entity | Schema version |
|--------|---------------|
| `Task` (workspace JSON) | workspace v9 → **v10** |
| `RaidItem` | workspace v9 → **v10** |
| `ChangeItem` | workspace v9 → **v10** |
| `Stakeholder` | workspace v9 → **v10** |
| `Milestone` | workspace v9 → **v10** |
| `ProjectMeta` | workspace v9 → **v10** |
| Turso single-tenant | turso schema v9 → **v10** |
| Turso multi-tenant | turso-tenant schema v10 → **v11** |

The field is optional on read (old snapshots decode cleanly); every serializer
encodes it as a JSON-in-cell string so no column explosion occurs in CSV/MD.
