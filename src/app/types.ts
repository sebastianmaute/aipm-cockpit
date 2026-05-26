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
  priority: Priority;
  blockers: string;
  notes: string;
  /** YYYY-MM-DD when the task was marked complete; "" or absent when still open. */
  completedDate?: string;
  /** Total number of status-inquiry emails sent for this task. */
  inquiriesSent?: number;
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
  /** Resource Planner v2: stable link to a Resource. Additive — the
   *  free-text `assignee` remains the display value and the fallback join. */
  resourceId?: number;
  /**
   * Manual RAG (Red/Amber/Green) override for steering-committee reporting.
   * When set, beats the auto-derived health rules (overdue/blocked/due-soon).
   * `undefined` (the default) means "auto".
   */
  healthOverride?: "R" | "A" | "G";
};

export const PRIORITIES: Priority[] = ["Low", "Medium", "High", "Urgent"];

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
  /** Cost per hour in the plan currency. */
  internalRate: number;
  /** Customer-billable per hour. */
  externalRate: number;
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
  company?: string;
  birthday?: string;   // "MM-DD" (zero-padded month-day, no year)
  notes?: string;      // free text (may contain commas, pipes, newlines)
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
  allocations: BucketAllocation[];
  localModifiedAt?: string;
};

/** Cached ECB reference rates (EUR base), one table per workspace. */
export type FxRates = {
  base: "EUR";
  date: string;      // ECB publication date (YYYY-MM-DD)
  fetchedAt: string; // ISO timestamp of the fetch
  rates: Record<string, number>; // currency code → units per 1 EUR
};
