import type { KnowledgeLink } from "./document-link";

export type Priority = "Low" | "Medium" | "High" | "Urgent";

export const PRIORITY_RANK: Record<Priority, number> = {
  Low: 0,
  Medium: 1,
  High: 2,
  Urgent: 3,
};

/**
 * Classic project-planning dependency types between two tasks.
 *
 *   FS — Finish-to-Start  (this task starts when the predecessor finishes; most common)
 *   SS — Start-to-Start   (this task can start when the predecessor starts)
 *   FF — Finish-to-Finish (this task can finish when the predecessor finishes)
 *   SF — Start-to-Finish  (this task can finish when the predecessor starts; rare)
 *
 * Stored as a predecessor reference on the dependent task: `TaskDependency`
 * lives on Task B and points to Task A, meaning "B's <FS|SS|FF|SF> depends on A".
 */
export const DEPENDENCY_TYPES = ["FS", "SS", "FF", "SF"] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

export type TaskDependency = {
  /** Predecessor task id — the one this task is constrained by. */
  taskId: number;
  type: DependencyType;
};

/** A single dated note in an entity's running note log. `id` is stable within
 *  the entity's array (max+1). `html` is sanitized rich body; `text` is the
 *  plain-text projection (search/export/fallback). Author is best-effort. */
export type NoteLogEntry = {
  id: number;
  authorResourceId?: number;
  authorName?: string;
  /** ISO timestamp when the note was recorded. */
  timestamp: string;
  /** ISO timestamp of the last edit; absent until edited → renders "(edited)". */
  editedAt?: string;
  /** Sanitized rich HTML body. */
  html: string;
  /** Plain-text projection of html. */
  text: string;
};

export type Task = {
  id: number;
  taskName: string;
  assignee: string;
  assigneeEmail: string;
  /** Optional explicit start date (YYYY-MM-DD). When set, the Gantt chart
   *  anchors the left edge of the bar here instead of deriving it from
   *  predecessors or lastUpdateDate. Set automatically by Gantt drag-edits
   *  or manually via the task form. */
  startDate?: string;
  dueDate: string;
  lastUpdateDate: string;
  /** YYYY-MM-DD the task was created. Optional: absent on legacy data until the
   *  load migrator backfills it from `lastUpdateDate`. Date-only like every
   *  other Task date field — there is deliberately no instant precision here. */
  createdDate?: string;
  priority: Priority;
  /** Workflow status. Source of truth for "done": status==="Done" keeps the
   *  invariant completedDate-set; "Cancelled" is terminal but not completed. */
  status: TaskStatus;
  blockers: string;
  /** Rich free-text description (sanitized HTML). Renamed from the former
   *  plain `notes` field; the running dated log lives in `noteLog`. */
  description: string;
  /** YYYY-MM-DD when the task was marked complete; "" or absent when still open. */
  completedDate?: string;
  /** Total number of status-inquiry emails sent for this task. */
  inquiriesSent?: number;
  /** Optional Jira-style effort estimate, stored canonically in MINUTES.
   *  Entered in the form as "2w 3d 4h" (basis 1w=5d, 1d=8h, 1h=60m). */
  originalEstimateMinutes?: number;
  /** Optional time-spent so far, stored canonically in MINUTES (same basis). */
  timeSpentMinutes?: number;
  /** Single optional category/project this task belongs to. */
  group?: string;
  /** Free-form tags for cross-cutting filtering. */
  labels?: string[];
  /** Predecessor relationships for this task (local-only, not synced to Jira yet). */
  dependencies?: TaskDependency[];
  /** Jira issue key when this task is linked to a Jira issue (e.g. "LOP-42"). */
  jiraKey?: string;
  /** Jira issue type name (e.g. "Task", "Story"); informational. */
  jiraIssueType?: string;
  /** ISO timestamp of the last successful sync with Jira for this task. */
  lastSyncedAt?: string;
  /** ISO timestamp of the last local edit (used for sync conflict detection). */
  localModifiedAt?: string;
  /** Outlook calendar event id for this task (calendar write-back link). */
  outlookEventId?: string;
  /** Resource Planner v2: stable link to a Resource. Additive — the
   *  free-text `assignee` remains the display value and the fallback join. */
  resourceId?: number;
  /**
   * Manual RAG (Red/Amber/Green) override for steering-committee reporting.
   * When set, beats the auto-derived health rules (overdue/blocked/due-soon).
   * `undefined` (the default) means "auto".
   */
  healthOverride?: "R" | "A" | "G";
  /** SharePoint files/folders linked to this record. Always optional; absent
   *  on legacy data, defaults to [] at the editor boundary. */
  knowledgeLinks?: KnowledgeLink[];
  /** Running note log — dated free-text notes. Optional + sparse; absent on
   *  legacy data. Persisted as a JSON-in-cell array across the text backends. */
  noteLog?: NoteLogEntry[];
};

export const PRIORITIES: Priority[] = ["Low", "Medium", "High", "Urgent"];

export type TaskStatus =
  | "To Do" | "In Progress" | "On Hold" | "In Review" | "Cancelled" | "Done";
export const TASK_STATUSES: TaskStatus[] = [
  "To Do", "In Progress", "On Hold", "In Review", "Cancelled", "Done",
];
export const DEFAULT_TASK_STATUS: TaskStatus = "To Do";

// ----------------------------------------------------------------------------
// RAID log: Risks, Assumptions, Issues, Dependencies
//
// One record type with a `category` discriminator. Per-category status enums
// (validated at the UI boundary; the union below permits all four). Risks
// carry an extra probability×impact pair that derives the cached `severity`
// for sorting/filtering; A/I/D use the 4-level severity directly.
//
// Tasks remain the primary entity. RAID items reference tasks they're
// mitigated/resolved/delivered-by via `linkedTaskIds` — tasks don't know
// about RAID, the reverse lookup happens at render time.

export type RaidCategory = "R" | "A" | "I" | "D";
export const RAID_CATEGORIES: RaidCategory[] = ["R", "A", "I", "D"];

export type RiskScale = 1 | 2 | 3 | 4 | 5;
export const RISK_SCALES: RiskScale[] = [1, 2, 3, 4, 5];

export type RaidSeverity = "Low" | "Medium" | "High" | "Critical";
export const RAID_SEVERITIES: RaidSeverity[] = [
  "Low",
  "Medium",
  "High",
  "Critical",
];

// Union of all per-category status values. The picker scopes options to the
// row's category via `statusOptionsFor()` in raid.ts.
export type RaidStatus =
  | "Open"
  | "Mitigated"
  | "Realized"
  | "Closed"
  | "Pending"
  | "Validated"
  | "Invalidated"
  | "In Progress"
  | "Resolved"
  | "Delivered"
  | "Blocked";

export const RISK_STATUSES: RaidStatus[] = [
  "Open",
  "Mitigated",
  "Realized",
  "Closed",
];
export const ASSUMPTION_STATUSES: RaidStatus[] = [
  "Pending",
  "Validated",
  "Invalidated",
];
export const ISSUE_STATUSES: RaidStatus[] = [
  "Open",
  "In Progress",
  "Resolved",
  "Closed",
];
export const DEPENDENCY_STATUSES: RaidStatus[] = [
  "Open",
  "In Progress",
  "Delivered",
  "Blocked",
];

export type RaidItem = {
  id: number;
  category: RaidCategory;
  title: string;
  description?: string;
  owner?: string;
  ownerEmail?: string;
  /** Stable link to a Resource (see Task.resourceId / Absence.resourceId).
   *  Optional + additive; back-filled by the V9 migration from `ownerEmail`. */
  ownerResourceId?: number | null;
  /** 4-level severity. For category "R" this is cached from
   *  `riskSeverityFromMatrix(probability, impact)`. */
  severity?: RaidSeverity;
  /** Risk-matrix axes — only set when category === "R". */
  probability?: RiskScale;
  impact?: RiskScale;
  status: RaidStatus;
  mitigation?: string;
  /** Open-point task ids that address this item. Tasks don't track the
   *  reverse — the panel computes it at render time. */
  linkedTaskIds: number[];
  raisedDate: string;
  targetDate?: string;
  closedDate?: string;
  localModifiedAt?: string;
  /** Predecessor RAID items that caused this one (e.g., an Issue caused by
   *  one or more Realized Risks). Cross-category allowed. Self-refs are
   *  rejected at the UI boundary and on parse; transitive cycles are
   *  detected by walking the ancestor closure of each proposed parent.
   *
   *  Always an array — defaults to `[]` for items with no parent. Older
   *  saves used the singular `causedByRaidId`; storage.ts migrates them on
   *  parse and emits the plural form going forward. */
  causedByRaidIds: number[];
  /** Stakeholders explicitly associated with this item (FK -> Stakeholder.id).
   *  Drives the communication-reminder engine. Always an array; defaults to []. */
  stakeholderIds: number[];
  /** SharePoint files/folders linked to this record. Always optional; absent
   *  on legacy data, defaults to [] at the editor boundary. */
  knowledgeLinks?: KnowledgeLink[];
  /** Outlook calendar event id for this item's review date (calendar write-back
   *  link, keyed on targetDate). App-managed; users never enter it. */
  outlookEventId?: string;
  /** Total number of status-inquiry emails sent for this item (mirrors
   *  Task.inquiriesSent). Optional + sparse; absent/0 on legacy data. */
  inquiriesSent?: number;
  /** Running note log — dated rich notes. Optional + sparse; absent on legacy
   *  data. Persisted as a JSON-in-cell array across the text backends. */
  noteLog?: NoteLogEntry[];
};

/** A zero-duration key date, distinct from a task. `achievedDate` is a manual
 *  sign-off (absent = pending). `linkedTaskIds` are the tasks that gate it —
 *  they drive the Gantt edges and the "at risk" signal. */
export type Milestone = {
  id: number;
  name: string;
  date: string;            // YYYY-MM-DD target
  description?: string;
  achievedDate?: string;   // YYYY-MM-DD manual sign-off
  linkedTaskIds: number[];
  localModifiedAt?: string;
  /** Outlook calendar event id for this milestone (calendar write-back link). */
  outlookEventId?: string;
  /** SharePoint files/folders linked to this record. Always optional; absent
   *  on legacy data, defaults to [] at the editor boundary. */
  knowledgeLinks?: KnowledgeLink[];
};

// ----------------------------------------------------------------------------
// Steering committee — board membership, scheduled meetings, and the cadence
// of information packs sent ahead of meetings. Optional nested Workspace field.

/** A per-meeting status report (current version). Rides the steeringCommittee
 *  JSON blob — no new write path. `html` is sanitized rich text. */
export interface MeetingReport {
  html: string;
  updatedAt: string;
  sentAt?: string;
}

export interface CommitteeMeeting {
  id: number;
  date: string;
  title: string;
  agenda?: string;
  location?: string;
  outlookEventId?: string;
  report?: MeetingReport;
}

export interface InfoSchedule {
  id: number;
  label: string;
  leadDays: number;
}

export interface SteeringCommittee {
  name: string;
  memberResourceIds: number[];
  meetings: CommitteeMeeting[];
  infoSchedules: InfoSchedule[];
  infoReminderEventIds?: Record<string, string>;
  /** Outlook event ids of meetings that were DELETED in the panel while still
   *  carrying a pushed event. A deleted meeting leaves `meetings` (so the
   *  reconcile can no longer see its id), so the panel stashes the orphaned id
   *  here for the next Outlook push to delete + clear. */
  pendingDeleteEventIds?: string[];
}

// ----------------------------------------------------------------------------
// Change control register — tracks change requests through their lifecycle.

export const CHANGE_TYPES = ["Scope", "Schedule", "Cost", "Quality", "Other"] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const CHANGE_STATUSES = [
  "Proposed", "Under Review", "Approved", "Rejected", "Implemented", "Deferred",
] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

/** Impact rating reuses the RAID severity scale + its RAG palette. */
export type ChangeImpact = RaidSeverity;

export type ChangeItem = {
  id: number;
  title: string;
  description: string;
  type: ChangeType;
  status: ChangeStatus;
  impact?: ChangeImpact;
  impactDescription?: string;
  scheduleImpactDays?: number;
  costImpact?: number;
  requestedBy?: string;
  raisedDate: string;          // YYYY-MM-DD
  decisionBy?: string;
  decisionDate?: string;       // YYYY-MM-DD; auto-filled when status leaves the pending set
  resolutionNotes?: string;
  linkedTaskIds: number[];
  linkedRaidIds: number[];
  /** Stakeholders explicitly associated with this item (FK -> Stakeholder.id).
   *  Drives the communication-reminder engine. Always an array; defaults to []. */
  stakeholderIds: number[];
  localModifiedAt?: string;
  /** SharePoint files/folders linked to this record. Always optional; absent
   *  on legacy data, defaults to [] at the editor boundary. */
  knowledgeLinks?: KnowledgeLink[];
  /** Outlook calendar event id for this change's decision-date write-back
   *  (SP3). Set by the push; absent until first synced. */
  outlookEventId?: string;
};

// ----------------------------------------------------------------------------
// Stakeholder register + RACI.
//
// A first-class workspace entity (sibling to RaidItem / ChangeItem). Optional
// `resourceId` links an internal stakeholder to a Resource. RACI assignments
// are embedded as a per-milestone map (milestoneId -> letter), serialized the
// same way Resource.utilization is (no second entity).

export const RACI_ROLES = ["R", "A", "C", "I"] as const; // Responsible / Accountable / Consulted / Informed
export type RaciRole = (typeof RACI_ROLES)[number];

export const STAKEHOLDER_CATEGORIES = [
  "Internal", "Customer", "Vendor", "Sponsor", "Regulator", "Other",
] as const;
export type StakeholderCategory = (typeof STAKEHOLDER_CATEGORIES)[number];

export type InfluenceInterest = "Low" | "Medium" | "High";
export const INFLUENCE_INTEREST_LEVELS: InfluenceInterest[] = ["Low", "Medium", "High"];

export type Stakeholder = {
  id: number;
  name: string;
  organization?: string;
  title?: string;
  email?: string;
  category: StakeholderCategory;
  influence: InfluenceInterest;
  interest: InfluenceInterest;
  notes?: string;
  /** Optional FK -> Resource.id; null/absent for purely-external stakeholders. */
  resourceId?: number | null;
  /** milestoneId (string key) -> RACI letter. Sparse; orphan keys filtered at render. */
  raci: Record<string, RaciRole>;
  localModifiedAt?: string;
  /** SharePoint files/folders linked to this record. Always optional; absent
   *  on legacy data, defaults to [] at the editor boundary. */
  knowledgeLinks?: KnowledgeLink[];
};

/** Project-level status overrides + PM narrative for the health dashboard.
 *  RAG fields use the same "R" | "A" | "G" literal as Task.healthOverride to
 *  avoid a circular import with health.ts. Absent override = use the computed
 *  value. */
export type ProjectStatus = {
  ragOverride?: "R" | "A" | "G";
  scheduleOverride?: "R" | "A" | "G";
  budgetOverride?: "R" | "A" | "G";
  scopeOverride?: "R" | "A" | "G";
  narrative?: string;
  narrativeUpdatedAt?: string; // ISO 8601
};

// ----------------------------------------------------------------------------
// Absences — Resource Planner v1.
//
// Third workspace entity alongside Task and RaidItem. Tracks per-assignee
// time-off windows. Joins on `Task.assignee` (free-text string match — the
// Resources panel normalizes case for grouping but preserves the original
// casing for display).

export type AbsenceType = "vacation" | "sick" | "training" | "other";
export const ABSENCE_TYPES: AbsenceType[] = [
  "vacation",
  "sick",
  "training",
  "other",
];

export type Absence = {
  id: number;
  /** Free-text assignee, expected to match Task.assignee values. */
  assignee: string;
  /** Optional; populated from contacts.ts when available. */
  assigneeEmail?: string;
  /** "YYYY-MM-DD" inclusive. */
  startDate: string;
  /** "YYYY-MM-DD" inclusive; must be >= startDate. */
  endDate: string;
  type: AbsenceType;
  note?: string;
  /** ISO 8601 — set on every save for sync/conflict detection. */
  localModifiedAt?: string;
  /** Resource Planner v2: stable link to a Resource (see Task.resourceId). */
  resourceId?: number;
  /** Outlook calendar event id for the pushed absence event (SP4 write-back). */
  outlookEventId?: string;
};

// ----------------------------------------------------------------------------
// Shifts — Resource Planner Phase 4.
//
// Per-assignee working pattern: how many hours they work on each weekday.
// One Shift per case-folded assignee identity; absent assignees fall back
// to DEFAULT_WEEK_HOURS (Mon–Fri 8h). Joins on Task.assignee / Absence.assignee
// the same way absences do.

/** Hours worked on each weekday, indexed by JS Date.getDay() (0 = Sunday … 6 = Saturday). */
export type WeekHours = readonly [
  number, // Sun
  number, // Mon
  number, // Tue
  number, // Wed
  number, // Thu
  number, // Fri
  number, // Sat
];

/** Default working week applied when an assignee has no explicit Shift. */
export const DEFAULT_WEEK_HOURS: WeekHours = [0, 8, 8, 8, 8, 8, 0];

/** Upper bound enforced by sanitization — guards against hand-edited
 *  workspace files with absurd values. */
export const MAX_HOURS_PER_DAY = 24;

export type Shift = {
  id: number;
  /** Free-text assignee, joined case-fold against Task.assignee / Absence.assignee. */
  assignee: string;
  assigneeEmail?: string;
  /** Length-7 tuple of weekday hours, 0 ≤ h ≤ 24. */
  hoursPerWeekday: WeekHours;
  note?: string;
  /** Stable link to a Resource (see Task.resourceId / Absence.resourceId).
   *  Optional + additive; back-filled by the V9 migration from `assigneeEmail`. */
  resourceId?: number | null;
  /** ISO 8601 — set on every save for sync/conflict detection. */
  localModifiedAt?: string;
};

// ----------------------------------------------------------------------------
// Resource Planner v2 — Resources, Roles (discipline × grade), planning window.
//
// First-class workspace entities. A Resource links to tasks/absences by
// `resourceId` (stable) and carries per-period utilization. A Role is a
// concrete discipline × grade combination that carries internal/external
// hourly rates. Discipline and Grade are editable, seeded reference lists.

export type Discipline = { id: number; name: string; localModifiedAt?: string };
export type Grade = { id: number; name: string; localModifiedAt?: string };

export const PRESET_DISCIPLINES = [
  "Developer",
  "Business Analyst",
  "Consultant",
  "Project Manager",
] as const;

export const PRESET_GRADES = [
  "Junior",
  "Associate",
  "Consultant",
  "Senior",
  "Lead",
  "Principal",
] as const;

export type Role = {
  id: number;
  disciplineId: number;
  gradeId: number;
  /**
   * Cost per hour in the plan currency. Remains the cost-math source consumed
   * everywhere (periodCost/budget/EVM/reports); when `rateBasis === "day"` it is
   * a DERIVED value materialized from `internalRateDay`.
   */
  internalRate: number;
  /** Customer-billable per hour. Same derived/authoritative rule as internalRate. */
  externalRate: number;
  /** Internal day rate (plan currency). Authoritative when `rateBasis === "day"`. */
  internalRateDay?: number;
  /** External/billing day rate. Authoritative when `rateBasis === "day"`. */
  externalRateDay?: number;
  /**
   * Which unit the user edits — the other is auto-derived and locked.
   * Absent ⇒ "hour" (legacy roles keep their exact hourly as authoritative).
   */
  rateBasis?: "day" | "hour";
  /** Manual rate-card row order (ascending); absent ⇒ fall back to array index. */
  order?: number;
  localModifiedAt?: string;
};

export type UtilizationMode = "percent" | "hours";

export type Resource = {
  id: number;
  firstName: string;
  lastName: string;
  title?: string;
  businessPhone?: string;
  location?: string;
  department?: string;
  email?: string;
  /** Additional email addresses beyond the primary `email`. */
  emails?: string[];
  company?: string;
  birthday?: string;   // "MM-DD" (zero-padded month-day, no year)
  notes?: string;      // free text (may contain commas, pipes, newlines)
  /** External resource: planned/capacity-tracked but excluded from all cost figures. */
  isExternal?: boolean;
  /** FK -> Role.id; null when unassigned. */
  roleId: number | null;
  utilizationMode: UtilizationMode;
  /** periodKey ("2026-01" | "2026-W03") -> value (percent 0..100 or hours). */
  utilization: Record<string, number>;
  /** periodKey -> manual absence-hours override (auto-derived otherwise). */
  absenceOverride?: Record<string, number>;
  /** Soft archive; treated as true when absent. */
  active?: boolean;
  localModifiedAt?: string;
};

export type PlanGranularity = "week" | "month";

export type ResourcePlan = {
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  granularity: PlanGranularity; // canonical (editable) granularity
  currency: string; // ISO 4217
  /** When true, budget-hours cells for allocations WITH assigned resources
   *  mirror planned capacity (read-only). Absent ⇒ false (manual entry). */
  budgetFollowsPlan?: boolean;
};

/** Default plan currency when none is set. */
export const DEFAULT_CURRENCY = "EUR";

// ----------------------------------------------------------------------------
// Project Budget Planner.
//
// A single project-level budget = all BudgetBuckets in the workspace. A bucket
// is a named PO/contract line (T&M or fixed-price) in a currency. It spans one
// or more roles via per-role ALLOCATIONS: each allocation names a role + the
// resources whose capacity forms its PLAN, plus per-period budget & actual
// hours. Closing a bucket spills its remaining budget into a successor.

export const BUDGET_TYPES = ["tm", "fixed"] as const;
export type BudgetType = (typeof BUDGET_TYPES)[number]; // time-&-material | fixed-price

export const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP"] as const;
export type BudgetCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isBudgetCurrency(v: unknown): v is BudgetCurrency {
  return typeof v === "string" && (SUPPORTED_CURRENCIES as readonly string[]).includes(v);
}

export type BucketStatus = "open" | "closed";

/** One role line within a bucket. `resourceIds` feed the PLAN (their capacity);
 *  `budgetHours`/`actualHours` are periodKey → hours maps (aligned to the plan). */
export type BucketAllocation = {
  roleId: number;
  resourceIds: number[];
  budgetHours: Record<string, number>;
  actualHours: Record<string, number>;
};

export const PLANNING_MODES = ["detailed", "blended"] as const;
/** "detailed" = per-role (discipline×grade) allocations; "blended" = per-discipline
 *  allocations using the mixed average rate of that discipline's grades. */
export type PlanningMode = (typeof PLANNING_MODES)[number];

/** One discipline line within a blended-mode bucket. `resourceIds` feed the PLAN
 *  (their capacity), exactly like BucketAllocation; budget/actual hours are
 *  periodKey → hours maps aligned to the plan. */
export type DisciplineAllocation = {
  disciplineId: number;
  resourceIds: number[];
  budgetHours: Record<string, number>;
  actualHours: Record<string, number>;
};

export type BudgetBucket = {
  id: number;
  name: string;
  poNumber?: string;
  type: BudgetType;
  currency: BudgetCurrency;
  /** Fixed-price contract amount in the bucket currency; only when type === "fixed". */
  fixedPriceAmount?: number;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  /** Successor bucket id that receives this bucket's remaining budget on close. */
  successorId?: number | null;
  status: BucketStatus;
  closedDate?: string;
  /** Manual EUR → currency rate override; wins over cached ECB while present. */
  fxRateOverride?: number;
  /** Planning granularity. Absent ⇒ "detailed" (back-compat for existing buckets). */
  planningMode?: PlanningMode;
  /** Per-discipline allocations; consulted only when planningMode === "blended". */
  disciplineAllocations?: DisciplineAllocation[];
  /** Per-bucket rate overrides (plan currency, per hour). When finite and >= 0,
   *  override the role/blended rate for ALL rows in this bucket. */
  rateOverrideInternal?: number;
  rateOverrideExternal?: number;
  allocations: BucketAllocation[];
  /** Display/sort position among buckets (0-based, contiguous). Optional and
   *  back-compatible — when absent the engine falls back to sorting by `id`. */
  order?: number;
  localModifiedAt?: string;
  /** Tasks whose completion drives this bucket's earned value. Empty/absent =>
   *  no derived progress. */
  taskIds?: number[];
  /** Manual completion override (0-100). WINS over the linked-task derivation
   *  whenever set — a PM's assessment beats a task count. */
  percentComplete?: number;
};

/** Cached ECB reference rates (EUR base), one table per workspace. */
export type FxRates = {
  base: "EUR";
  date: string;      // ECB publication date (YYYY-MM-DD)
  fetchedAt: string; // ISO timestamp of the fetch
  rates: Record<string, number>; // currency code → units per 1 EUR
};

// ----------------------------------------------------------------------------
// Project metadata — top-level descriptor for the project this workspace tracks.

export type IdentityType = "B2E" | "B2B" | "B2C" | "NHI";
export type Deployment = "Cloud" | "On-premise" | "Hybrid";
export type RegulatoryRequirement =
  | "Not applicable"
  | "GDPR / data protection regulation"
  | "DORA" | "MaRisk" | "BAIT" | "NIS2" | "HIPAA" | "SOX"
  | "EU AI Act"
  | "Export control / sanctions compliance";

export type ContactPerson = {
  name: string;
  email: string;
  /** true = copied from the address book; false = manual, never synced back. */
  synced: boolean;
  /** Optional FK -> Resource.id; null/absent for an external (unlinked) contact. */
  resourceId?: number | null;
};

export type ProjectMeta = {
  // Identity
  name: string;
  code: string;
  description?: string;
  // People — internal group
  sponsor?: string;
  projectManager: string;
  keyStakeholdersInternal: string[];
  keyStakeholdersExternal: string[];
  // Customer group
  customer: string;
  naceSection: string;            // NACE section letter, e.g. "C"
  identityTypes: IdentityType[];
  identityCount?: number;
  stakeholderCount?: number;       // 0.74: replaces internal/external key-stakeholder lists in the form
  products: string;
  platform?: string;
  deployment: Deployment;
  startDate: string;              // ISO YYYY-MM-DD
  endDate: string;                // ISO YYYY-MM-DD
  profitCenter: string;
  quotes?: string;
  salesforceUrl?: string;
  sharepointUrl?: string;
  confluenceUrl?: string;
  jiraUrl?: string;
  /** IANA operating timezone for this project (e.g. "Asia/Kolkata"). Drives the
   *  effective zone for day-boundary logic when no per-device override is set. */
  operatingTimezone?: string;
  contactPersons: ContactPerson[];
  docRepoLocation?: string;
  regulatory: RegulatoryRequirement[];
  notes?: string;
  /** SharePoint files/folders linked to this record. Always optional; absent
   *  on legacy data, defaults to [] at the editor boundary. */
  knowledgeLinks?: KnowledgeLink[];
};
