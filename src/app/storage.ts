import { SharePointBackend } from "./sharepoint-backend";
import { TursoBackend } from "./turso-backend";
import { TursoTenantBackend } from "./turso-tenant-backend";
import type { TursoConfig } from "./turso-config";
import { riskSeverityFromMatrix } from "./raid";
import { encodeDocumentLinks, decodeDocumentLinks } from "./document-link";
import {
  backfillResources,
  defaultResourcePlan,
  seedDisciplines,
  seedGrades,
} from "./resource-foundation";
import {
  dropDanglingDependencies,
  encodeAllocations,
  encodeDisciplineAllocations,
  encodePeriodMap,
  parseDependenciesString,
  sanitizeAbsence,
  sanitizeBudgetBucket,
  sanitizeChangeItem,
  sanitizeDiscipline,
  sanitizeFxRates,
  sanitizeGrade,
  sanitizeGroup,
  sanitizeLabels,
  sanitizeMilestone,
  sanitizeOptionalMinutes,
  sanitizePlan,
  sanitizeResource,
  sanitizeRole,
  sanitizeShift,
  sanitizeStakeholder,
  sanitizeProjectMeta,
  encodeRaciMap,
  decodeRaciMap,
  serializeDependencies,
} from "./sanitize";
import {
  type Absence,
  type BudgetBucket,
  type ChangeItem,
  type Discipline,
  type FxRates,
  type Grade,
  type Milestone,
  type ContactPerson,
  type Priority,
  type ProjectMeta,
  type ProjectStatus,
  type RaidCategory,
  type RaidItem,
  type RaidSeverity,
  type RaidStatus,
  type Resource,
  type ResourcePlan,
  type RiskScale,
  type Role,
  type Shift,
  type Stakeholder,
  type Task,
} from "./types";
import type { ExportConfig } from "./settings-types";
import { EXPORT_SECTION_KEYS } from "./settings-types";

/** Top-level shape persisted to storage. JSON wraps it as an envelope; the
 *  CSV/MD encoders emit sections in one file. The browser backend keeps each
 *  entity type under a separate IndexedDB object store. */
export type Workspace = {
  tasks: Task[];
  raid: RaidItem[];
  absences: Absence[];
  shifts: Shift[]; // dormant
  resources: Resource[];
  roles: Role[];
  disciplines: Discipline[];
  grades: Grade[];
  plan: ResourcePlan;
  /** Budget planner buckets. Optional so older saved files and existing
   *  Workspace literals still satisfy the type; every load path defaults to
   *  [] (see migrateWorkspaceV6). */
  budgets?: BudgetBucket[];
  /** Cached ECB rate table; null/absent until first fetched. */
  fxRates?: FxRates | null;
  /** Project-level RAG overrides + PM narrative for the dashboard. Optional so
   *  older saved files still type-check; every load path defaults to {}. */
  status?: ProjectStatus;
  /** Project milestones (key dates). Optional for back-compat; load paths default to []. */
  milestones?: Milestone[];
  /** Change-control register. Optional for back-compat; load paths default to []. */
  changes?: ChangeItem[];
  /** Stakeholder register (incl. per-milestone RACI map). Optional for back-compat; load paths default to []. */
  stakeholders?: Stakeholder[];
  /** Top-level descriptor of the project this workspace tracks. Additive and
   *  optional: a workspace with `project === undefined` serializes byte-for-byte
   *  as it did before this field existed (no project block is emitted). */
  project?: ProjectMeta;
};

const SCHEMA_VERSION = 9;

/** A blank workspace with a default plan anchored to today. */
export function emptyWorkspace(): Workspace {
  return {
    tasks: [], raid: [], absences: [], shifts: [],
    resources: [], roles: [], disciplines: [], grades: [],
    plan: defaultResourcePlan(new Date().toISOString().slice(0, 10)),
    budgets: [],
    fxRates: null,
    status: {},
    milestones: [],
    changes: [],
    stakeholders: [],
  };
}

/**
 * Idempotent v5 migration over a loaded workspace:
 *   - seeds discipline/grade reference lists when empty,
 *   - ensures a plan exists,
 *   - backfills resources from task/absence assignees the first time
 *     (when no resources are present yet), stamping resourceId.
 * Pure — no IndexedDB. Returns a new workspace; reuses arrays unchanged.
 */
export function migrateWorkspaceV5(ws: Workspace): Workspace {
  const disciplines = ws.disciplines.length ? ws.disciplines : seedDisciplines();
  const grades = ws.grades.length ? ws.grades : seedGrades();
  const plan = ws.plan ?? defaultResourcePlan(new Date().toISOString().slice(0, 10));
  let { tasks, absences, resources } = ws;
  if (resources.length === 0) {
    const built = backfillResources(tasks, absences);
    resources = built.resources;
    tasks = built.tasks;
    absences = built.absences;
  }
  return { ...ws, tasks, absences, resources, roles: ws.roles, disciplines, grades, plan };
}

/**
 * v6 migration: ensures the budget planner fields exist. Runs after v5.
 * Idempotent — reuses arrays/values unchanged.
 */
export function migrateWorkspaceV6(ws: Workspace): Workspace {
  const base = migrateWorkspaceV5(ws);
  const budgets = Array.isArray(base.budgets) ? base.budgets : [];
  const fxRates = base.fxRates ?? null;
  const status = base.status && typeof base.status === "object" ? base.status : {};
  const milestones = Array.isArray(base.milestones) ? base.milestones : [];
  if (budgets === base.budgets && fxRates === base.fxRates && status === base.status && milestones === base.milestones) {
    return base;
  }
  return { ...base, budgets, fxRates, status, milestones };
}

/**
 * v7 migration: ensures the change-control register exists. Runs after v6.
 * Idempotent — reuses arrays/values unchanged.
 */
export function migrateWorkspaceV7(ws: Workspace): Workspace {
  const base = migrateWorkspaceV6(ws);
  const changes = Array.isArray(base.changes) ? base.changes : [];
  if (changes === base.changes) return base;
  return { ...base, changes };
}

/** v8: ensure the stakeholders array exists. Runs after v7. Idempotent. */
export function migrateWorkspaceV8(ws: Workspace): Workspace {
  const base = migrateWorkspaceV7(ws);
  return base.stakeholders ? base : { ...base, stakeholders: [] };
}

// --- Storage configuration -------------------------------------------------

export type StorageKind =
  | "browser"
  | "local-json"
  | "local-csv"
  | "local-md"
  | "sp-json"
  | "sp-csv"
  | "turso";

type LocalKind = "local-json" | "local-csv" | "local-md";

export type StorageConfig =
  | { kind: "browser" }
  | { kind: "local-json" }
  | { kind: "local-csv" }
  | { kind: "local-md" }
  | {
      kind: "sp-json";
      hostname: string;
      sitePath: string;
      itemPath: string;
    }
  | {
      kind: "sp-csv";
      hostname: string;
      sitePath: string;
      itemPath: string;
    }
  | { kind: "turso" };

export const defaultStorageConfig: StorageConfig = { kind: "browser" };

// --- Errors ----------------------------------------------------------------

export class StorageNotReadyError extends Error {
  constructor(public hint: string) {
    super(`Storage not ready: ${hint}`);
    this.name = "StorageNotReadyError";
  }
}

export class StorageNotImplementedError extends Error {
  constructor(public hint: string) {
    super(`Storage not implemented: ${hint}`);
    this.name = "StorageNotImplementedError";
  }
}

// --- Backend interface -----------------------------------------------------

export interface StorageBackend {
  readonly kind: StorageKind;
  load(): Promise<Workspace>;
  save(workspace: Workspace): Promise<void>;
  /** Optional: human-readable status (e.g., picked filename). */
  describe?(): Promise<string | null>;
  /** Whether this backend is configured to read/write right now. */
  isReady(): Promise<boolean>;
}

// --- IndexedDB key/value wrapper ------------------------------------------
//
// Schema:
//   - "kv"   — generic key/value store (legacy). Used by LocalFileBackend to
//              persist picked FsHandles. Created at version 1.
//   - "tasks" / "raid" — record-level storage for the BrowserBackend.
//              Created at version 2. keyPath:"id" pulls the key directly
//              from the stored record, so puts don't need an explicit key.
//   - "absences" — third workspace entity (Resource Planner v1). Created
//              at version 3. Same keyPath:"id" pattern as tasks/raid.
//   - "shifts"  — fourth workspace entity (Resource Planner Phase 4).
//              Created at version 4. Per-assignee weekly hours pattern.
//
// Bumping the version triggers `onupgradeneeded`, which adds missing stores
// idempotently — users coming from earlier versions keep their data and gain
// the new record stores additively.

const IDB_NAME = "lop-app";
const IDB_VERSION = 6;
const IDB_KV_STORE = "kv";
const IDB_TASKS_STORE = "tasks";
const IDB_RAID_STORE = "raid";
const IDB_ABSENCES_STORE = "absences";
const IDB_SHIFTS_STORE = "shifts";
const IDB_RESOURCES_STORE = "resources";
const IDB_ROLES_STORE = "roles";
const IDB_DISCIPLINES_STORE = "disciplines";
const IDB_GRADES_STORE = "grades";
const KV_PLAN_KEY = "resource-plan";
const IDB_BUDGETS_STORE = "budgets";
const KV_FXRATES_KEY = "fx-rates";
const KV_STATUS_KEY = "project-status";
const KV_MILESTONES_KEY = "milestones";
const KV_CHANGES_KEY = "changes";
const KV_STAKEHOLDERS_KEY = "stakeholders";
const KV_PROJECT_KEY = "project";

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_KV_STORE)) {
        db.createObjectStore(IDB_KV_STORE);
      }
      if (!db.objectStoreNames.contains(IDB_TASKS_STORE)) {
        db.createObjectStore(IDB_TASKS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IDB_RAID_STORE)) {
        db.createObjectStore(IDB_RAID_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IDB_ABSENCES_STORE)) {
        db.createObjectStore(IDB_ABSENCES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IDB_SHIFTS_STORE)) {
        db.createObjectStore(IDB_SHIFTS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IDB_RESOURCES_STORE)) {
        db.createObjectStore(IDB_RESOURCES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IDB_ROLES_STORE)) {
        db.createObjectStore(IDB_ROLES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IDB_DISCIPLINES_STORE)) {
        db.createObjectStore(IDB_DISCIPLINES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IDB_GRADES_STORE)) {
        db.createObjectStore(IDB_GRADES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(IDB_BUDGETS_STORE)) {
        db.createObjectStore(IDB_BUDGETS_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_KV_STORE, "readonly");
    const store = tx.objectStore(IDB_KV_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_KV_STORE, "readwrite");
    const store = tx.objectStore(IDB_KV_STORE);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_KV_STORE, "readwrite");
    const store = tx.objectStore(IDB_KV_STORE);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Reads every record from a record store. Used by BrowserBackend to load
 *  tasks/raid as arrays. Empty store → empty array. */
async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result ?? []) as T[]);
    req.onerror = () => reject(req.error);
  });
}

/**
 * One-transaction bulk update against a keyPath-keyed store:
 *   - `puts`  — records to insert/replace (key derived from each item's `id`)
 *   - `deleteIds` — keys to remove
 *
 * Both arrays may be empty; the function short-circuits when there's no work
 * so unchanged saves don't even open a transaction.
 */
async function idbBulkUpdate<T extends { id: number }>(
  storeName: string,
  puts: readonly T[],
  deleteIds: readonly number[],
): Promise<void> {
  if (puts.length === 0 && deleteIds.length === 0) return;
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    for (const item of puts) store.put(item);
    for (const id of deleteIds) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- CSV serialization -----------------------------------------------------

export const CSV_COLUMNS: Array<keyof Task> = [
  "id",
  "taskName",
  "assignee",
  "assigneeEmail",
  "startDate",
  "dueDate",
  "lastUpdateDate",
  "priority",
  "blockers",
  "notes",
  "completedDate",
  "inquiriesSent",
  "group",
  "labels",
  "dependencies",
  "jiraKey",
  "jiraIssueType",
  "lastSyncedAt",
  "localModifiedAt",
  "healthOverride",
  "resourceId",
  "originalEstimateMinutes",
  "timeSpentMinutes",
  "documentLinks",
];

// Whitelist parser shared by CSV and Markdown deserialization. Anything that
// isn't "R" | "A" | "G" — including empty strings on legacy files — becomes
// undefined (= "auto").
function parseHealthOverride(s: string | undefined): "R" | "A" | "G" | undefined {
  return s === "R" || s === "A" || s === "G" ? s : undefined;
}

// --- RAID serialization helpers -------------------------------------------

// Columns persisted for RAID items in CSV and Markdown. Order matches the
// header row emitted by the encoder; the decoder reads by column name so
// reordering files by hand still works.
export const RAID_CSV_COLUMNS: Array<keyof RaidItem> = [
  "id",
  "category",
  "title",
  "description",
  "severity",
  "probability",
  "impact",
  "status",
  "owner",
  "ownerEmail",
  "mitigation",
  "linkedTaskIds",
  "raisedDate",
  "targetDate",
  "closedDate",
  "localModifiedAt",
  "causedByRaidIds",
  "stakeholderIds",
  "documentLinks",
];

const RAID_MD_COLUMNS: Array<{ key: keyof RaidItem; label: string }> = [
  { key: "id", label: "ID" },
  { key: "category", label: "Category" },
  { key: "title", label: "Title" },
  { key: "description", label: "Description" },
  { key: "severity", label: "Severity" },
  { key: "probability", label: "Probability" },
  { key: "impact", label: "Impact" },
  { key: "status", label: "Status" },
  { key: "owner", label: "Owner" },
  { key: "ownerEmail", label: "OwnerEmail" },
  { key: "mitigation", label: "Mitigation" },
  { key: "linkedTaskIds", label: "LinkedTasks" },
  { key: "raisedDate", label: "Raised" },
  { key: "targetDate", label: "Target" },
  { key: "closedDate", label: "Closed" },
  { key: "localModifiedAt", label: "LocalModified" },
  { key: "causedByRaidIds", label: "CausedByIds" },
  { key: "stakeholderIds", label: "StakeholderIds" },
  { key: "documentLinks", label: "DocumentLinks" },
];

// Columns persisted for Absence items in CSV and Markdown. Order matches
// the header row emitted by the encoder; the decoder reads by column name
// so reordering files by hand still works.
export const ABSENCES_CSV_COLUMNS: Array<keyof Absence> = [
  "id",
  "assignee",
  "assigneeEmail",
  "startDate",
  "endDate",
  "type",
  "note",
  "localModifiedAt",
  "resourceId",
];

const ABSENCES_MD_COLUMNS: Array<{ key: keyof Absence; label: string }> = [
  { key: "id", label: "ID" },
  { key: "assignee", label: "Assignee" },
  { key: "assigneeEmail", label: "Email" },
  { key: "startDate", label: "Start" },
  { key: "endDate", label: "End" },
  { key: "type", label: "Type" },
  { key: "note", label: "Note" },
  { key: "localModifiedAt", label: "LocalModified" },
  { key: "resourceId", label: "ResourceId" },
];

// Columns persisted for Shift items in CSV and Markdown. Per-weekday hours
// are flattened into 7 columns (Sun..Sat) so spreadsheets can show them
// side-by-side. Order matches the header row emitted by the encoder.
export const SHIFTS_CSV_COLUMNS: readonly string[] = [
  "id",
  "assignee",
  "assigneeEmail",
  "sunHours",
  "monHours",
  "tueHours",
  "wedHours",
  "thuHours",
  "friHours",
  "satHours",
  "note",
  "localModifiedAt",
];

const SHIFTS_MD_COLUMNS: readonly { col: string; label: string }[] = [
  { col: "id", label: "ID" },
  { col: "assignee", label: "Assignee" },
  { col: "assigneeEmail", label: "Email" },
  { col: "sunHours", label: "Sun" },
  { col: "monHours", label: "Mon" },
  { col: "tueHours", label: "Tue" },
  { col: "wedHours", label: "Wed" },
  { col: "thuHours", label: "Thu" },
  { col: "friHours", label: "Fri" },
  { col: "satHours", label: "Sat" },
  { col: "note", label: "Note" },
  { col: "localModifiedAt", label: "LocalModified" },
];

// --- Resource Planner v2 CSV column definitions ----------------------------

export const RESOURCES_CSV_COLUMNS = [
  "id", "firstName", "lastName", "title", "businessPhone", "location",
  "department", "email", "company", "birthday", "notes",
  "roleId", "utilizationMode", "utilization", "absenceOverride", "active", "localModifiedAt",
] as const;
export const ROLES_CSV_COLUMNS = ["id", "disciplineId", "gradeId", "internalRate", "externalRate", "localModifiedAt"] as const;
export const REF_CSV_COLUMNS = ["id", "name", "localModifiedAt"] as const;

export const MILESTONES_CSV_COLUMNS: Array<keyof Milestone> = [
  "id", "name", "date", "description", "achievedDate", "linkedTaskIds", "localModifiedAt",
];

export const BUDGETS_CSV_COLUMNS = [
  "id", "name", "poNumber", "type", "currency", "fixedPriceAmount",
  "startDate", "endDate", "successorId", "status", "closedDate",
  "fxRateOverride", "allocations", "localModifiedAt", "order",
  "planningMode", "disciplineAllocations", "rateOverrideInternal", "rateOverrideExternal",
] as const;

const CSV_SECTION_BUDGETS = "# BUDGETS";
const CSV_SECTION_FXRATES = "# FXRATES";
const CSV_SECTION_MILESTONES = "# MILESTONES";
const CSV_SECTION_CHANGES = "# CHANGES";
const CSV_SECTION_STAKEHOLDERS = "# STAKEHOLDERS";

// Section markers for the new entity sections in multi-section CSV files.
const CSV_SECTION_RESOURCES = "# RESOURCES";
const CSV_SECTION_ROLES = "# ROLES";
const CSV_SECTION_DISCIPLINES = "# DISCIPLINES";
const CSV_SECTION_GRADES = "# GRADES";
const CSV_SECTION_PLAN = "# PLAN";
const CSV_SECTION_STATUS = "# PROJECT STATUS";
const CSV_SECTION_PROJECT = "# PROJECT META";

// --- Resource Planner v2 Markdown column definitions -----------------------

const RESOURCES_MD_COLUMNS: readonly { col: string; label: string }[] = [
  { col: "id", label: "ID" },
  { col: "firstName", label: "First" },
  { col: "lastName", label: "Last" },
  { col: "title", label: "Title" },
  { col: "businessPhone", label: "Phone" },
  { col: "location", label: "Location" },
  { col: "department", label: "Department" },
  { col: "email", label: "Email" },
  { col: "company", label: "Company" },
  { col: "birthday", label: "Birthday" },
  { col: "notes", label: "Notes" },
  { col: "roleId", label: "RoleId" },
  { col: "utilizationMode", label: "Mode" },
  { col: "utilization", label: "Utilization" },
  { col: "absenceOverride", label: "AbsenceOverride" },
  { col: "active", label: "Active" },
  { col: "localModifiedAt", label: "LocalModified" },
];

const ROLES_MD_COLUMNS: readonly { col: string; label: string }[] = [
  { col: "id", label: "ID" },
  { col: "disciplineId", label: "DisciplineId" },
  { col: "gradeId", label: "GradeId" },
  { col: "internalRate", label: "InternalRate" },
  { col: "externalRate", label: "ExternalRate" },
  { col: "localModifiedAt", label: "LocalModified" },
];

const BUDGETS_MD_COLUMNS: readonly { col: string; label: string }[] = [
  { col: "id", label: "ID" },
  { col: "name", label: "Name" },
  { col: "poNumber", label: "PO" },
  { col: "type", label: "Type" },
  { col: "currency", label: "Currency" },
  { col: "fixedPriceAmount", label: "FixedPrice" },
  { col: "startDate", label: "Start" },
  { col: "endDate", label: "End" },
  { col: "successorId", label: "SuccessorId" },
  { col: "status", label: "Status" },
  { col: "closedDate", label: "Closed" },
  { col: "fxRateOverride", label: "FxOverride" },
  { col: "allocations", label: "Allocations" },
  { col: "localModifiedAt", label: "LocalModified" },
  { col: "order", label: "Order" },
  { col: "planningMode", label: "PlanningMode" },
  { col: "disciplineAllocations", label: "DisciplineAllocations" },
  { col: "rateOverrideInternal", label: "RateOverrideInternal" },
  { col: "rateOverrideExternal", label: "RateOverrideExternal" },
];

const REF_MD_COLUMNS: readonly { col: string; label: string }[] = [
  { col: "id", label: "ID" },
  { col: "name", label: "Name" },
  { col: "localModifiedAt", label: "LocalModified" },
];

export function shiftFieldToString(s: Shift, col: string): string {
  switch (col) {
    case "id":
      return String(s.id);
    case "assignee":
      return s.assignee;
    case "assigneeEmail":
      return s.assigneeEmail ?? "";
    case "sunHours":
      return String(s.hoursPerWeekday[0]);
    case "monHours":
      return String(s.hoursPerWeekday[1]);
    case "tueHours":
      return String(s.hoursPerWeekday[2]);
    case "wedHours":
      return String(s.hoursPerWeekday[3]);
    case "thuHours":
      return String(s.hoursPerWeekday[4]);
    case "friHours":
      return String(s.hoursPerWeekday[5]);
    case "satHours":
      return String(s.hoursPerWeekday[6]);
    case "note":
      return s.note ?? "";
    case "localModifiedAt":
      return s.localModifiedAt ?? "";
    default:
      return "";
  }
}

function parseRaidCategory(s: string | undefined): RaidCategory | null {
  return s === "R" || s === "A" || s === "I" || s === "D" ? s : null;
}

function parseRaidSeverity(s: string | undefined): RaidSeverity | undefined {
  if (s === "Low" || s === "Medium" || s === "High" || s === "Critical") return s;
  return undefined;
}

const VALID_RAID_STATUSES: ReadonlySet<RaidStatus> = new Set<RaidStatus>([
  "Open",
  "Mitigated",
  "Realized",
  "Closed",
  "Pending",
  "Validated",
  "Invalidated",
  "In Progress",
  "Resolved",
  "Delivered",
  "Blocked",
]);

function parseRaidStatus(s: string | undefined): RaidStatus | null {
  if (!s) return null;
  return VALID_RAID_STATUSES.has(s as RaidStatus) ? (s as RaidStatus) : null;
}

function parseRiskScale(s: string | undefined): RiskScale | undefined {
  const n = Number(s);
  return n === 1 || n === 2 || n === 3 || n === 4 || n === 5 ? (n as RiskScale) : undefined;
}

function parseLinkedTaskIds(s: string | undefined): number[] {
  if (!s) return [];
  return s
    .split("|")
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function raidFieldToString(r: RaidItem, c: keyof RaidItem): string {
  if (c === "linkedTaskIds")
    return Array.isArray(r.linkedTaskIds) ? r.linkedTaskIds.join("|") : "";
  if (c === "causedByRaidIds")
    return Array.isArray(r.causedByRaidIds)
      ? r.causedByRaidIds.join("|")
      : "";
  if (c === "stakeholderIds")
    return Array.isArray(r.stakeholderIds) ? r.stakeholderIds.join("|") : "";
  if (c === "documentLinks") return encodeDocumentLinks(r.documentLinks);
  return String(r[c] ?? "");
}

/**
 * Builds a RaidItem from a header→value object produced by the CSV / MD
 * parsers. Returns null if the row lacks the minimum required fields (id +
 * category + status + title).
 *
 * For risks (`category === "R"`) the cached `severity` is recomputed from
 * probability/impact when both are present — protects against stale values
 * in hand-edited files.
 */
export function buildRaidItemFromObj(obj: Record<string, string>): RaidItem | null {
  const id = Number(obj.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const category = parseRaidCategory(obj.category);
  if (!category) return null;
  const status = parseRaidStatus(obj.status);
  if (!status) return null;
  const title = obj.title?.trim() ?? "";
  if (!title) return null;

  const probability = parseRiskScale(obj.probability);
  const impact = parseRiskScale(obj.impact);
  let severity = parseRaidSeverity(obj.severity);
  if (category === "R" && probability !== undefined && impact !== undefined) {
    severity = riskSeverityFromMatrix(probability, impact);
  }

  // `causedByRaidIds` parsed as a pipe-joined list (matches linkedTaskIds).
  // Legacy single-value `causedByRaidId` column is migrated transparently.
  // Self-references are dropped here so a hand-edited file can't load a
  // cycle that the UI would refuse to create. Cross-file dangling refs
  // (parent id not present in this file) are left intact; consumers decide
  // how to render them.
  const causedByRaidIds: number[] = [];
  const seenCauses = new Set<number>();
  function pushCause(n: number) {
    if (Number.isFinite(n) && n > 0 && n !== id && !seenCauses.has(n)) {
      seenCauses.add(n);
      causedByRaidIds.push(n);
    }
  }
  if (obj.causedByRaidIds) {
    for (const part of obj.causedByRaidIds.split("|")) {
      pushCause(Number(part.trim()));
    }
  }
  if (obj.causedByRaidId) {
    pushCause(Number(obj.causedByRaidId));
  }

  return {
    id,
    category,
    title,
    description: obj.description || undefined,
    severity,
    probability,
    impact,
    status,
    owner: obj.owner || undefined,
    ownerEmail: obj.ownerEmail || undefined,
    mitigation: obj.mitigation || undefined,
    linkedTaskIds: parseLinkedTaskIds(obj.linkedTaskIds),
    raisedDate: obj.raisedDate ?? "",
    targetDate: obj.targetDate || undefined,
    closedDate: obj.closedDate || undefined,
    localModifiedAt: obj.localModifiedAt || undefined,
    causedByRaidIds,
    stakeholderIds: parseLinkedTaskIds(obj.stakeholderIds),
    documentLinks: decodeDocumentLinks(obj.documentLinks),
  };
}

export function milestoneFieldToString(m: Milestone, c: keyof Milestone): string {
  if (c === "linkedTaskIds") return Array.isArray(m.linkedTaskIds) ? m.linkedTaskIds.join("|") : "";
  return String(m[c] ?? "");
}

export function buildMilestoneFromObj(obj: Record<string, string>): Milestone | null {
  const id = Math.floor(Number(obj.id));
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = (obj.name?.trim() ?? "").slice(0, 200);
  if (!name) return null;
  const date = obj.date?.trim() ?? "";
  if (!date) return null;
  const m: Milestone = { id, name, date, linkedTaskIds: parseLinkedTaskIds(obj.linkedTaskIds) };
  if (obj.description) m.description = obj.description;
  if (obj.achievedDate) m.achievedDate = obj.achievedDate;
  if (obj.localModifiedAt) m.localModifiedAt = obj.localModifiedAt;
  return m;
}

export const CHANGES_CSV_COLUMNS: Array<keyof ChangeItem> = [
  "id", "title", "description", "type", "status", "impact", "impactDescription", "scheduleImpactDays",
  "costImpact", "requestedBy", "raisedDate", "decisionBy", "decisionDate", "resolutionNotes",
  "linkedTaskIds", "linkedRaidIds", "stakeholderIds", "localModifiedAt", "documentLinks",
];

export function changeFieldToString(c: ChangeItem, col: keyof ChangeItem): string {
  if (col === "linkedTaskIds") return Array.isArray(c.linkedTaskIds) ? c.linkedTaskIds.join("|") : "";
  if (col === "linkedRaidIds") return Array.isArray(c.linkedRaidIds) ? c.linkedRaidIds.join("|") : "";
  if (col === "stakeholderIds") return Array.isArray(c.stakeholderIds) ? c.stakeholderIds.join("|") : "";
  if (col === "documentLinks") return encodeDocumentLinks(c.documentLinks);
  const v = c[col];
  return v === undefined || v === null ? "" : String(v);
}

export function buildChangeFromObj(obj: Record<string, string>): ChangeItem | null {
  return sanitizeChangeItem({
    ...obj,
    id: obj.id ? Number(obj.id) : undefined,
    scheduleImpactDays: obj.scheduleImpactDays ? Number(obj.scheduleImpactDays) : undefined,
    costImpact: obj.costImpact ? Number(obj.costImpact) : undefined,
    linkedTaskIds: parseLinkedTaskIds(obj.linkedTaskIds),
    linkedRaidIds: parseLinkedTaskIds(obj.linkedRaidIds),
    stakeholderIds: parseLinkedTaskIds(obj.stakeholderIds),
    documentLinks: decodeDocumentLinks(obj.documentLinks),
  });
}

export const STAKEHOLDERS_CSV_COLUMNS: Array<keyof Stakeholder> = [
  "id", "name", "organization", "title", "email", "category",
  "influence", "interest", "notes", "resourceId", "raci", "localModifiedAt",
];

export function stakeholderFieldToString(s: Stakeholder, col: keyof Stakeholder): string {
  if (col === "raci") return encodeRaciMap(s.raci);
  if (col === "resourceId") return s.resourceId == null ? "" : String(s.resourceId);
  const v = s[col];
  return v === undefined || v === null ? "" : String(v);
}

export function buildStakeholderFromObj(obj: Record<string, string>): Stakeholder | null {
  return sanitizeStakeholder({
    ...obj,
    id: obj.id ? Number(obj.id) : undefined,
    resourceId: obj.resourceId ? Number(obj.resourceId) : null,
    raci: decodeRaciMap(obj.raci),
  });
}

function csvEscape(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Neutralize spreadsheet formula injection (OWASP CSV injection).
 * Prefixes a single-quote when the value starts with `= + - @ \t \r`,
 * forcing spreadsheet apps to treat it as text rather than a formula.
 *
 * Applied ONLY on the document-export path (config provided to
 * workspaceToCsv). The storage round-trip path must NOT apply this so
 * re-import stays byte-identical.
 */
export function neutralizeCsvFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

/** Combines formula neutralization (export-only) with CSV quoting. */
function csvCellEscape(value: string, neutralize: boolean): string {
  return csvEscape(neutralize ? neutralizeCsvFormula(value) : value);
}

export function fieldToString(t: Task, c: keyof Task): string {
  if (c === "labels") return Array.isArray(t.labels) ? t.labels.join("|") : "";
  if (c === "dependencies") return serializeDependencies(t.dependencies);
  if (c === "documentLinks") return encodeDocumentLinks(t.documentLinks);
  return String(t[c] ?? "");
}

function tasksToCsv(tasks: Task[], neutralize = false): string {
  const header = CSV_COLUMNS.join(",");
  const lines: string[] = [header];
  for (const t of tasks) {
    lines.push(CSV_COLUMNS.map((c) => csvCellEscape(fieldToString(t, c), neutralize)).join(","));
  }
  return lines.join("\r\n");
}

function raidToCsv(raid: readonly RaidItem[], neutralize = false): string {
  const lines: string[] = [RAID_CSV_COLUMNS.join(",")];
  for (const r of raid) {
    lines.push(
      RAID_CSV_COLUMNS.map((c) => csvCellEscape(raidFieldToString(r, c), neutralize)).join(","),
    );
  }
  return lines.join("\r\n");
}

function milestonesToCsv(milestones: readonly Milestone[], neutralize = false): string {
  const lines: string[] = [MILESTONES_CSV_COLUMNS.join(",")];
  for (const m of milestones) {
    lines.push(
      MILESTONES_CSV_COLUMNS.map((c) => csvCellEscape(milestoneFieldToString(m, c), neutralize)).join(","),
    );
  }
  return lines.join("\r\n");
}

function changesToCsv(changes: readonly ChangeItem[], neutralize = false): string {
  const lines: string[] = [CHANGES_CSV_COLUMNS.join(",")];
  for (const c of changes) {
    lines.push(
      CHANGES_CSV_COLUMNS.map((col) => csvCellEscape(changeFieldToString(c, col), neutralize)).join(","),
    );
  }
  return lines.join("\r\n");
}

export function stakeholdersToCsv(stakeholders: readonly Stakeholder[], neutralize = false): string {
  const lines: string[] = [STAKEHOLDERS_CSV_COLUMNS.join(",")];
  for (const s of stakeholders) {
    lines.push(
      STAKEHOLDERS_CSV_COLUMNS.map((col) => csvCellEscape(stakeholderFieldToString(s, col), neutralize)).join(","),
    );
  }
  return lines.join("\r\n");
}

export function absenceFieldToString(a: Absence, c: keyof Absence): string {
  return String(a[c] ?? "");
}

function absencesToCsv(absences: readonly Absence[], neutralize = false): string {
  const lines: string[] = [ABSENCES_CSV_COLUMNS.join(",")];
  for (const a of absences) {
    lines.push(
      ABSENCES_CSV_COLUMNS.map((c) =>
        csvCellEscape(absenceFieldToString(a, c), neutralize),
      ).join(","),
    );
  }
  return lines.join("\r\n");
}

function shiftsToCsv(shifts: readonly Shift[], neutralize = false): string {
  const lines: string[] = [SHIFTS_CSV_COLUMNS.join(",")];
  for (const s of shifts) {
    lines.push(
      SHIFTS_CSV_COLUMNS.map((c) => csvCellEscape(shiftFieldToString(s, c), neutralize)).join(
        ",",
      ),
    );
  }
  return lines.join("\r\n");
}

// --- Resource CSV encoders -------------------------------------------------

export function resourceFieldToString(r: Resource, c: string): string {
  switch (c) {
    case "id": return String(r.id);
    case "firstName": return r.firstName;
    case "lastName": return r.lastName;
    case "title": return r.title ?? "";
    case "businessPhone": return r.businessPhone ?? "";
    case "location": return r.location ?? "";
    case "department": return r.department ?? "";
    case "email": return r.email ?? "";
    case "company": return r.company ?? "";
    case "birthday": return r.birthday ?? "";
    case "notes": return r.notes ?? "";
    case "roleId": return r.roleId == null ? "" : String(r.roleId);
    case "utilizationMode": return r.utilizationMode;
    case "utilization": return encodePeriodMap(r.utilization);
    case "absenceOverride": return encodePeriodMap(r.absenceOverride);
    case "active": return r.active === false ? "false" : "";
    case "localModifiedAt": return r.localModifiedAt ?? "";
    default: return "";
  }
}

function rowsToCsv(header: readonly string[], rows: string[][], neutralize = false): string {
  return [header.join(","), ...rows.map((r) => r.map((v) => csvCellEscape(v, neutralize)).join(","))].join("\r\n");
}

function resourcesToCsv(rs: readonly Resource[], neutralize = false): string {
  return rowsToCsv(
    RESOURCES_CSV_COLUMNS,
    rs.map((r) => RESOURCES_CSV_COLUMNS.map((c) => resourceFieldToString(r, c))),
    neutralize,
  );
}

export function budgetFieldToString(b: BudgetBucket, c: string): string {
  switch (c) {
    case "id": return String(b.id);
    case "name": return b.name;
    case "poNumber": return b.poNumber ?? "";
    case "type": return b.type;
    case "currency": return b.currency;
    case "fixedPriceAmount": return b.fixedPriceAmount == null ? "" : String(b.fixedPriceAmount);
    case "startDate": return b.startDate;
    case "endDate": return b.endDate;
    case "successorId": return b.successorId == null ? "" : String(b.successorId);
    case "status": return b.status;
    case "closedDate": return b.closedDate ?? "";
    case "fxRateOverride": return b.fxRateOverride == null ? "" : String(b.fxRateOverride);
    case "allocations": return encodeAllocations(b.allocations);
    case "localModifiedAt": return b.localModifiedAt ?? "";
    case "order": return b.order == null ? "" : String(b.order);
    case "planningMode": return b.planningMode ?? "";
    case "disciplineAllocations": return encodeDisciplineAllocations(b.disciplineAllocations);
    case "rateOverrideInternal": return b.rateOverrideInternal == null ? "" : String(b.rateOverrideInternal);
    case "rateOverrideExternal": return b.rateOverrideExternal == null ? "" : String(b.rateOverrideExternal);
    default: return "";
  }
}

function budgetsToCsv(bs: readonly BudgetBucket[], neutralize = false): string {
  return rowsToCsv(BUDGETS_CSV_COLUMNS, bs.map((b) => BUDGETS_CSV_COLUMNS.map((c) => budgetFieldToString(b, c))), neutralize);
}

function encodeRatesMap(rates: Record<string, number>): string {
  return Object.entries(rates).filter(([, v]) => Number.isFinite(v)).map(([k, v]) => `${k}=${v}`).join("|");
}

function fxRatesToCsvLine(fx: FxRates): string {
  return [CSV_SECTION_FXRATES, [fx.base, fx.date, fx.fetchedAt, encodeRatesMap(fx.rates)].map(csvEscape).join(",")].join("\r\n");
}

function rolesToCsv(rs: readonly Role[], neutralize = false): string {
  return rowsToCsv(
    ROLES_CSV_COLUMNS,
    rs.map((r) => ROLES_CSV_COLUMNS.map((c) => String((r as Record<string, unknown>)[c] ?? ""))),
    neutralize,
  );
}

function refsToCsv(rs: readonly { id: number; name: string; localModifiedAt?: string }[]): string {
  return rowsToCsv(REF_CSV_COLUMNS, rs.map((r) => [String(r.id), r.name, r.localModifiedAt ?? ""]));
}

function planToCsvLine(p: ResourcePlan): string {
  return [CSV_SECTION_PLAN, [p.startDate, p.endDate, p.granularity, p.currency].map(csvEscape).join(",")].join("\r\n");
}

// Section markers used by `workspaceToCsv` / `csvToWorkspace`. The hash
// prefix isn't formal CSV but every spreadsheet tool we care about treats
// a line whose only cell starts with "#" as a comment row.
const CSV_SECTION_TASKS = "# TASKS";
const CSV_SECTION_RAID = "# RAID";
const CSV_SECTION_ABSENCES = "# ABSENCES";
const CSV_SECTION_SHIFTS = "# SHIFTS";

/** Serialize a workspace to the JSON envelope (schemaVersion + entity arrays). */
export function workspaceToJson(ws: Workspace): string {
  return JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      tasks: ws.tasks, raid: ws.raid, absences: ws.absences, shifts: ws.shifts,
      resources: ws.resources, roles: ws.roles, disciplines: ws.disciplines,
      grades: ws.grades, plan: ws.plan, budgets: ws.budgets ?? [], fxRates: ws.fxRates ?? null,
      status: ws.status ?? {},
      milestones: ws.milestones ?? [],
      changes: ws.changes ?? [],
      stakeholders: ws.stakeholders ?? [],
      // Additive: only present when a project is set, so legacy/no-project files
      // stay free of a `project` key.
      ...(ws.project ? { project: ws.project } : {}),
    },
    null,
    2,
  );
}

/** Defensive: whitelist the six known ProjectStatus fields from untrusted JSON. */
export function sanitizeProjectStatus(raw: unknown): ProjectStatus {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const rag = (v: unknown): "R" | "A" | "G" | undefined =>
    v === "R" || v === "A" || v === "G" ? v : undefined;
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const out: ProjectStatus = {};
  const ragOverride = rag(r.ragOverride); if (ragOverride) out.ragOverride = ragOverride;
  const scheduleOverride = rag(r.scheduleOverride); if (scheduleOverride) out.scheduleOverride = scheduleOverride;
  const budgetOverride = rag(r.budgetOverride); if (budgetOverride) out.budgetOverride = budgetOverride;
  const scopeOverride = rag(r.scopeOverride); if (scopeOverride) out.scopeOverride = scopeOverride;
  const narrative = str(r.narrative); if (narrative) out.narrative = narrative;
  const narrativeUpdatedAt = str(r.narrativeUpdatedAt); if (narrativeUpdatedAt) out.narrativeUpdatedAt = narrativeUpdatedAt;
  return out;
}

/** Parse a JSON envelope back to a workspace. Tolerates legacy files (pre-v6)
 *  by defaulting budgets -> [] and fxRates -> null. Returns an empty workspace
 *  on malformed input. */
export function jsonToWorkspace(text: string): Workspace {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyWorkspace();
    const p = parsed as Record<string, unknown>;
    if (!Array.isArray(p.tasks) || !Array.isArray(p.raid)) return emptyWorkspace();
    const raw: Workspace = {
      tasks: p.tasks as Task[],
      raid: p.raid as RaidItem[],
      absences: ((p.absences as unknown[]) ?? []).map((a) => sanitizeAbsence(a)).filter((a): a is Absence => a !== null),
      shifts: ((p.shifts as unknown[]) ?? []).map((s) => sanitizeShift(s)).filter((s): s is Shift => s !== null),
      resources: ((p.resources as unknown[]) ?? []).map((r) => sanitizeResource(r)).filter((r): r is Resource => r !== null),
      roles: ((p.roles as unknown[]) ?? []).map((r) => sanitizeRole(r)).filter((r): r is Role => r !== null),
      disciplines: ((p.disciplines as unknown[]) ?? []).map((d) => sanitizeDiscipline(d)).filter((d): d is Discipline => d !== null),
      grades: ((p.grades as unknown[]) ?? []).map((g) => sanitizeGrade(g)).filter((g): g is Grade => g !== null),
      plan: sanitizePlan(p.plan ?? {}, new Date().toISOString().slice(0, 10)),
      budgets: ((p.budgets as unknown[]) ?? []).map((b) => sanitizeBudgetBucket(b)).filter((b): b is BudgetBucket => b !== null),
      fxRates: sanitizeFxRates(p.fxRates),
      status: sanitizeProjectStatus(p.status),
      milestones: ((p.milestones as unknown[]) ?? []).map((m) => sanitizeMilestone(m)).filter((m): m is Milestone => m !== null),
      changes: ((p.changes as unknown[]) ?? []).map((c) => sanitizeChangeItem(c)).filter((c): c is ChangeItem => c !== null),
      stakeholders: ((p.stakeholders as unknown[]) ?? []).map((s) => sanitizeStakeholder(s)).filter((s): s is Stakeholder => s !== null),
    };
    // Additive: sanitize an incoming project when present; otherwise leave the
    // key off so no-project files round-trip without a `project` field.
    if (p.project !== undefined) {
      const project = sanitizeProjectMeta(p.project);
      if (project) raw.project = project;
    }
    return migrateWorkspaceV8(raw);
  } catch {
    return emptyWorkspace();
  }
}

// --- Project Status CSV encoder / decoder ------------------------------------

const STATUS_FIELDS: readonly (keyof ProjectStatus)[] = [
  "ragOverride", "scheduleOverride", "budgetOverride", "scopeOverride",
  "narrative", "narrativeUpdatedAt",
];

export function statusToCsv(status: ProjectStatus, neutralize = false): string {
  const rows: string[] = ["field,value"];
  for (const f of STATUS_FIELDS) {
    const v = status[f];
    if (v != null && v !== "") rows.push(`${f},${csvCellEscape(String(v), neutralize)}`);
  }
  return rows.join("\r\n");
}

/** Serializes status as "## Project Status" + "- field: value" bullets. The
 *  narrative is a single list item; embedded newlines are not preserved. */
export function statusToMarkdown(status: ProjectStatus): string {
  const lines = ["## Project Status", ""];
  for (const f of STATUS_FIELDS) {
    const v = status[f];
    if (v != null && v !== "") lines.push(`- ${f}: ${String(v)}`);
  }
  return lines.join("\n") + "\n";
}

export function markdownToStatus(md: string): ProjectStatus {
  const map: Record<string, string> = {};
  for (const line of md.split(/\r?\n/)) {
    const m = /^- (\w+):\s*(.*)$/.exec(line.trim());
    if (m) map[m[1]] = m[2].trim();
  }
  return sanitizeProjectStatus(map);
}

export function csvToStatus(text: string): ProjectStatus {
  const rows = parseCsv(text).filter((r) => r.length >= 2 && r[0] && !r[0].startsWith("#"));
  const map: Record<string, string> = {};
  for (const [k, v] of rows) {
    if (k === "field") continue; // header row
    map[k] = v;
  }
  return sanitizeProjectStatus(map);
}

// --- Project metadata encoder / decoder --------------------------------------
//
// ProjectMeta is a SINGLE object (like ProjectStatus), so it serializes as a
// `field,value` key-value block — NOT a row table. Both CSV and Markdown share
// the same per-field string form produced by `projectFieldToString`, so every
// emitted value is a single line (newlines/pipes/backslashes are escaped) which
// keeps the Markdown `- field: value` bullet parser robust.

/** All ProjectMeta fields, in a fixed serialization order. */
export const PROJECT_CSV_COLUMNS: Array<keyof ProjectMeta> = [
  "name", "code", "description",
  "sponsor", "projectManager", "keyStakeholdersInternal", "keyStakeholdersExternal",
  "customer", "naceSection", "identityTypes", "identityCount",
  "products", "platform", "deployment", "startDate", "endDate",
  "profitCenter", "quotes", "salesforceUrl", "sharepointUrl", "confluenceUrl",
  "contactPersons", "docRepoLocation", "regulatory", "notes",
];

/** The list delimiter used across this file for joined string arrays. */
const PROJECT_LIST_DELIM = "|";

/** Reversible single-line escape for an arbitrary scalar value. Escapes the
 *  backslash first, then encodes newlines so the value never spans lines (the
 *  Markdown bullet parser is line-oriented). */
function encodeProjectScalar(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function decodeProjectScalar(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "\\" && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === "n") { out += "\n"; i++; continue; }
      if (next === "r") { out += "\r"; i++; continue; }
      if (next === "\\") { out += "\\"; i++; continue; }
    }
    out += c;
  }
  return out;
}

/** Join a string array with the list delimiter, escaping the delimiter (and
 *  backslash, carriage-return, newline) within each item so the split is
 *  lossless and the result is always single-line (the Markdown bullet parser
 *  is line-oriented). Escape order: `\\` first, then `|`, then `\r`, then
 *  `\n` — keeps the encoding unambiguous. */
export function encodeProjectList(items: readonly string[]): string {
  return items
    .map((s) =>
      s
        .replace(/\\/g, "\\\\")
        .replace(/\|/g, "\\|")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n"),
    )
    .join(PROJECT_LIST_DELIM);
}

export function decodeProjectList(text: string): string[] {
  if (text === "") return [];
  const parts: string[] = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === "|") { buf += "|"; i++; continue; }
      if (next === "\\") { buf += "\\"; i++; continue; }
      if (next === "n") { buf += "\n"; i++; continue; }
      if (next === "r") { buf += "\r"; i++; continue; }
    }
    if (c === PROJECT_LIST_DELIM) { parts.push(buf); buf = ""; continue; }
    buf += c;
  }
  parts.push(buf);
  return parts;
}

/** Reversible encoder for contactPersons. Each entry is `name;email;synced`
 *  with `\`, `;` and `|` escaped within sub-fields; entries are joined with the
 *  list delimiter. */
export function encodeContactPersons(people: readonly ContactPerson[]): string {
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/\|/g, "\\|");
  return people
    .map((p) => `${esc(p.name)};${esc(p.email)};${p.synced ? "1" : "0"}`)
    .join(PROJECT_LIST_DELIM);
}

export function decodeContactPersons(text: string): ContactPerson[] {
  if (text === "") return [];
  // Split into entries on the un-escaped list delimiter.
  const entries: string[] = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length) { buf += c + text[i + 1]; i++; continue; }
    if (c === PROJECT_LIST_DELIM) { entries.push(buf); buf = ""; continue; }
    buf += c;
  }
  entries.push(buf);

  const unescape = (s: string) => {
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "\\" && i + 1 < s.length) {
        const next = s[i + 1];
        if (next === ";" || next === "|" || next === "\\") { out += next; i++; continue; }
      }
      out += c;
    }
    return out;
  };

  const splitFields = (entry: string): string[] => {
    const fields: string[] = [];
    let f = "";
    for (let i = 0; i < entry.length; i++) {
      const c = entry[i];
      if (c === "\\" && i + 1 < entry.length) { f += c + entry[i + 1]; i++; continue; }
      if (c === ";") { fields.push(f); f = ""; continue; }
      f += c;
    }
    fields.push(f);
    return fields;
  };

  const people: ContactPerson[] = [];
  for (const entry of entries) {
    const [name = "", email = "", synced = "0"] = splitFields(entry);
    people.push({
      name: unescape(name),
      email: unescape(email),
      synced: synced === "1",
    });
  }
  return people;
}

const PROJECT_ARRAY_COLUMNS = new Set<keyof ProjectMeta>([
  "keyStakeholdersInternal", "keyStakeholdersExternal", "identityTypes", "regulatory",
]);

/** Single-line, reversible string form for one ProjectMeta field. */
export function projectFieldToString(p: ProjectMeta, col: keyof ProjectMeta): string {
  if (col === "contactPersons") return encodeContactPersons(p.contactPersons);
  if (PROJECT_ARRAY_COLUMNS.has(col)) {
    const arr = p[col] as string[] | undefined;
    return Array.isArray(arr) ? encodeProjectList(arr) : "";
  }
  const v = p[col];
  if (v === undefined || v === null) return "";
  return encodeProjectScalar(String(v));
}

/** Decode a `field -> raw string` map (as produced by the CSV/MD parsers, or a
 *  Turso `projects` row) into the loose pre-sanitize ProjectMeta-shaped object.
 *  Shared by the strict `buildProjectFromObj` and the lenient
 *  `buildProjectFromObjLenient` so the per-field decode logic lives once. */
function decodeProjectObj(obj: Record<string, string>): Record<string, unknown> {
  const scalar = (key: string): string | undefined =>
    obj[key] !== undefined ? decodeProjectScalar(obj[key]) : undefined;
  return {
    name: scalar("name"),
    code: scalar("code"),
    description: scalar("description"),
    sponsor: scalar("sponsor"),
    projectManager: scalar("projectManager"),
    keyStakeholdersInternal: decodeProjectList(obj.keyStakeholdersInternal ?? ""),
    keyStakeholdersExternal: decodeProjectList(obj.keyStakeholdersExternal ?? ""),
    customer: scalar("customer"),
    naceSection: scalar("naceSection"),
    identityTypes: decodeProjectList(obj.identityTypes ?? ""),
    identityCount: obj.identityCount !== undefined && obj.identityCount !== ""
      ? obj.identityCount
      : undefined,
    products: scalar("products"),
    platform: scalar("platform"),
    deployment: scalar("deployment"),
    startDate: scalar("startDate"),
    endDate: scalar("endDate"),
    profitCenter: scalar("profitCenter"),
    quotes: scalar("quotes"),
    salesforceUrl: scalar("salesforceUrl"),
    sharepointUrl: scalar("sharepointUrl"),
    confluenceUrl: scalar("confluenceUrl"),
    contactPersons: decodeContactPersons(obj.contactPersons ?? ""),
    docRepoLocation: scalar("docRepoLocation"),
    regulatory: decodeProjectList(obj.regulatory ?? ""),
    notes: scalar("notes"),
  };
}

/** Decode a `field -> raw string` map (as produced by the CSV/MD parsers) back
 *  into a sanitized ProjectMeta. Returns null when the data is invalid. */
export function buildProjectFromObj(obj: Record<string, string>): ProjectMeta | null {
  return sanitizeProjectMeta(decodeProjectObj(obj));
}

/** Lenient decode for an ALREADY-PERSISTED project row (e.g. a Turso `projects`
 *  table row, the multi-tenant source of truth). Decodes the raw column map via
 *  `decodeProjectObj`, then runs the SAME `sanitizeProjectMeta` as the strict
 *  path but with `lenientRequiredArrays: true`. That flag skips ONLY the three
 *  empty-required-array rejections (keyStakeholdersInternal, keyStakeholdersExternal,
 *  regulatory) while still enforcing all required scalars (name, code, etc.),
 *  required enums (naceSection, deployment), required dates, and all per-field
 *  sanitization. Why lenient? A project already stored in the DB must never be
 *  silently dropped on read solely because, e.g., it has no external stakeholders. */
export function buildProjectFromObjLenient(obj: Record<string, string>): ProjectMeta | null {
  return sanitizeProjectMeta(decodeProjectObj(obj), { lenientRequiredArrays: true });
}

/** Serializes ProjectMeta as a `field,value` CSV block (mirrors statusToCsv).
 *  Only non-empty fields are emitted, so absent optionals round-trip cleanly. */
export function projectToCsv(project: ProjectMeta, neutralize = false): string {
  const rows: string[] = ["field,value"];
  for (const col of PROJECT_CSV_COLUMNS) {
    const v = projectFieldToString(project, col);
    if (v !== "") rows.push(`${col},${csvCellEscape(v, neutralize)}`);
  }
  return rows.join("\r\n");
}

export function csvToProject(text: string): ProjectMeta | null {
  const rows = parseCsv(text).filter((r) => r.length >= 2 && r[0] && !r[0].startsWith("#"));
  const map: Record<string, string> = {};
  for (const [k, v] of rows) {
    if (k === "field") continue; // header row
    map[k] = v;
  }
  return buildProjectFromObj(map);
}

/** Serializes ProjectMeta as "## Project Meta" + "- field: value" bullets
 *  (mirrors statusToMarkdown). Values are single-line via projectFieldToString. */
export function projectToMarkdown(project: ProjectMeta): string {
  const lines = ["## Project Meta", ""];
  for (const col of PROJECT_CSV_COLUMNS) {
    const v = projectFieldToString(project, col);
    if (v !== "") lines.push(`- ${col}: ${v}`);
  }
  return lines.join("\n") + "\n";
}

export function markdownToProject(md: string): ProjectMeta | null {
  const map: Record<string, string> = {};
  for (const line of md.split(/\r?\n/)) {
    const m = /^- (\w+):\s*(.*)$/.exec(line.trim());
    // No .trim() (unlike markdownToStatus): the encoded value may end in escaped chars that decodeProjectScalar must receive verbatim.
    if (m) map[m[1]] = m[2];
  }
  return buildProjectFromObj(map);
}

/** Multi-section CSV: tasks then (optionally) raid, absences, and shifts,
 *  separated by marker lines. Used by file backends for round-trip;
 *  `tasksToCsv` remains the marker-less variant that the Export menu uses
 *  for one-way downloads.
 *
 *  @param config When provided (document export), only sections enabled in the
 *  config are emitted and storage-only sections (disciplines, grades, fxRates,
 *  plan) are omitted. When undefined (default), ALL sections are emitted for
 *  full round-trip storage fidelity. */
export function workspaceToCsv(ws: Workspace, config?: ExportConfig): string {
  const enabled = (key: (typeof EXPORT_SECTION_KEYS)[number]) =>
    config === undefined || config[key];
  // neutralize = true only on the document-export path (config provided).
  // The storage path (config === undefined) must stay byte-identical.
  const neutralize = config !== undefined;

  const parts: string[] = [];
  const csvPush = (...items: string[]) => {
    if (parts.length > 0) parts.push("");
    parts.push(...items);
  };
  if (!config || config.tasks) csvPush(CSV_SECTION_TASKS, tasksToCsv(ws.tasks, neutralize));
  if (enabled("raid") && ws.raid.length > 0) csvPush(CSV_SECTION_RAID, raidToCsv(ws.raid, neutralize));
  if (enabled("absences") && ws.absences.length > 0) csvPush(CSV_SECTION_ABSENCES, absencesToCsv(ws.absences, neutralize));
  if (enabled("shifts") && ws.shifts.length > 0) csvPush(CSV_SECTION_SHIFTS, shiftsToCsv(ws.shifts, neutralize));
  if (config === undefined) {
    // Storage-only sections — omitted from document exports.
    if (ws.disciplines.length > 0) csvPush(CSV_SECTION_DISCIPLINES, refsToCsv(ws.disciplines));
    if (ws.grades.length > 0) csvPush(CSV_SECTION_GRADES, refsToCsv(ws.grades));
  }
  if (enabled("roles") && ws.roles.length > 0) csvPush(CSV_SECTION_ROLES, rolesToCsv(ws.roles, neutralize));
  if (enabled("resources") && ws.resources.length > 0) csvPush(CSV_SECTION_RESOURCES, resourcesToCsv(ws.resources, neutralize));
  if (enabled("budgets") && (ws.budgets ?? []).length > 0) csvPush(CSV_SECTION_BUDGETS, budgetsToCsv(ws.budgets ?? [], neutralize));
  if (config === undefined && ws.fxRates) csvPush(fxRatesToCsvLine(ws.fxRates));
  if (enabled("status") && ws.status && Object.keys(ws.status).length > 0) csvPush(CSV_SECTION_STATUS, statusToCsv(ws.status, neutralize));
  if (enabled("milestones") && (ws.milestones ?? []).length > 0) csvPush(CSV_SECTION_MILESTONES, milestonesToCsv(ws.milestones ?? [], neutralize));
  if (enabled("changes") && (ws.changes ?? []).length > 0) csvPush(CSV_SECTION_CHANGES, changesToCsv(ws.changes ?? [], neutralize));
  if (enabled("stakeholders") && (ws.stakeholders ?? []).length > 0) csvPush(CSV_SECTION_STAKEHOLDERS, stakeholdersToCsv(ws.stakeholders ?? [], neutralize));
  if (config === undefined) csvPush(planToCsvLine(ws.plan));
  // Project metadata — additive, storage-only for now (document export wires it
  // in later). Emitted last so a no-project workspace's bytes are an exact
  // prefix of a with-project one. Only when a project is present.
  if (config === undefined && ws.project) csvPush(CSV_SECTION_PROJECT, projectToCsv(ws.project, neutralize));
  return parts.join("\r\n");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let buf = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        buf += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      buf += c;
      i++;
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ",") {
        row.push(buf);
        buf = "";
        i++;
        continue;
      }
      if (c === "\r" && text[i + 1] === "\n") {
        row.push(buf);
        rows.push(row);
        row = [];
        buf = "";
        i += 2;
        continue;
      }
      if (c === "\n" || c === "\r") {
        row.push(buf);
        rows.push(row);
        row = [];
        buf = "";
        i++;
        continue;
      }
      buf += c;
      i++;
    }
  }
  if (buf.length > 0 || row.length > 0) {
    row.push(buf);
    rows.push(row);
  }
  return rows;
}

/**
 * Splits a marker-segmented CSV into its sections. A "marker" is a line whose
 * first cell starts with one of the known "# ..." section constants.
 */
function splitCsvSections(csv: string): {
  tasksText: string;
  raidText: string;
  absencesText: string;
  shiftsText: string;
  resourcesText: string;
  rolesText: string;
  disciplinesText: string;
  gradesText: string;
  planText: string;
  budgetsText: string;
  fxRatesText: string;
  statusText: string;
  milestonesText: string;
  changesText: string;
  stakeholdersText: string;
  projectText: string;
} {
  const lines = csv.split(/\r?\n/);
  let mode: "tasks" | "raid" | "absences" | "shifts" | "resources" | "roles" | "disciplines" | "grades" | "plan" | "budgets" | "fxrates" | "status" | "milestones" | "changes" | "stakeholders" | "project" | null = null;
  const tasksLines: string[] = [];
  const raidLines: string[] = [];
  const absencesLines: string[] = [];
  const shiftsLines: string[] = [];
  const resourcesLines: string[] = [];
  const rolesLines: string[] = [];
  const disciplinesLines: string[] = [];
  const gradesLines: string[] = [];
  const planLines: string[] = [];
  const budgetsLines: string[] = [];
  const fxRatesLines: string[] = [];
  const statusLines: string[] = [];
  const milestonesLines: string[] = [];
  const changesLines: string[] = [];
  const stakeholdersLines: string[] = [];
  const projectLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith(CSV_SECTION_BUDGETS)) { mode = "budgets"; continue; }
    if (trimmed.startsWith(CSV_SECTION_FXRATES)) { mode = "fxrates"; continue; }
    if (trimmed.startsWith(CSV_SECTION_RESOURCES)) { mode = "resources"; continue; }
    if (trimmed.startsWith(CSV_SECTION_ROLES)) { mode = "roles"; continue; }
    if (trimmed.startsWith(CSV_SECTION_DISCIPLINES)) { mode = "disciplines"; continue; }
    if (trimmed.startsWith(CSV_SECTION_GRADES)) { mode = "grades"; continue; }
    if (trimmed.startsWith(CSV_SECTION_PLAN)) { mode = "plan"; continue; }
    if (trimmed.startsWith(CSV_SECTION_TASKS)) { mode = "tasks"; continue; }
    if (trimmed.startsWith(CSV_SECTION_RAID)) { mode = "raid"; continue; }
    if (trimmed.startsWith(CSV_SECTION_ABSENCES)) { mode = "absences"; continue; }
    if (trimmed.startsWith(CSV_SECTION_SHIFTS)) { mode = "shifts"; continue; }
    if (trimmed.startsWith(CSV_SECTION_PROJECT)) { mode = "project"; continue; }
    if (trimmed.startsWith(CSV_SECTION_STATUS)) { mode = "status"; continue; }
    if (trimmed.startsWith(CSV_SECTION_MILESTONES)) { mode = "milestones"; continue; }
    if (trimmed.startsWith(CSV_SECTION_CHANGES)) { mode = "changes"; continue; }
    if (trimmed.startsWith(CSV_SECTION_STAKEHOLDERS)) { mode = "stakeholders"; continue; }
    if (mode === "resources") resourcesLines.push(line);
    else if (mode === "roles") rolesLines.push(line);
    else if (mode === "disciplines") disciplinesLines.push(line);
    else if (mode === "grades") gradesLines.push(line);
    else if (mode === "plan") planLines.push(line);
    else if (mode === "shifts") shiftsLines.push(line);
    else if (mode === "absences") absencesLines.push(line);
    else if (mode === "raid") raidLines.push(line);
    else if (mode === "tasks") tasksLines.push(line);
    else if (mode === "budgets") budgetsLines.push(line);
    else if (mode === "fxrates") fxRatesLines.push(line);
    else if (mode === "status") statusLines.push(line);
    else if (mode === "milestones") milestonesLines.push(line);
    else if (mode === "changes") changesLines.push(line);
    else if (mode === "stakeholders") stakeholdersLines.push(line);
    else if (mode === "project") projectLines.push(line);
    // (else: line before the first marker — drop it.)
  }
  return {
    tasksText: tasksLines.join("\r\n"),
    raidText: raidLines.join("\r\n"),
    absencesText: absencesLines.join("\r\n"),
    shiftsText: shiftsLines.join("\r\n"),
    resourcesText: resourcesLines.join("\r\n"),
    rolesText: rolesLines.join("\r\n"),
    disciplinesText: disciplinesLines.join("\r\n"),
    gradesText: gradesLines.join("\r\n"),
    planText: planLines.join("\r\n"),
    budgetsText: budgetsLines.join("\r\n"),
    fxRatesText: fxRatesLines.join("\r\n"),
    statusText: statusLines.join("\r\n"),
    milestonesText: milestonesLines.join("\r\n"),
    changesText: changesLines.join("\r\n"),
    stakeholdersText: stakeholdersLines.join("\r\n"),
    projectText: projectLines.join("\r\n"),
  };
}

// --- Resource CSV decoders -------------------------------------------------

/** Generic header-mapped CSV reader: returns one object per data row. */
function csvRowsToObjects(csv: string): Record<string, string>[] {
  const rows = parseCsv(csv);
  let h = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length && rows[i][0].trim() !== "" && !rows[i][0].startsWith("#")) {
      h = i;
      break;
    }
  }
  if (h < 0) return [];
  const headers = rows[h];
  const out: Record<string, string>[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    if (rows[i].length === 1 && rows[i][0] === "") continue;
    const obj: Record<string, string> = {};
    headers.forEach((key, idx) => { obj[key] = rows[i][idx] ?? ""; });
    out.push(obj);
  }
  return out;
}

function csvToResources(csv: string): Resource[] {
  return csvRowsToObjects(csv).map((o) => sanitizeResource(o)).filter((r): r is Resource => r !== null);
}

function csvToRoles(csv: string): Role[] {
  return csvRowsToObjects(csv).map((o) => sanitizeRole(o)).filter((r): r is Role => r !== null);
}

function csvToBudgets(csv: string): BudgetBucket[] {
  return csvRowsToObjects(csv).map((o) => sanitizeBudgetBucket(o)).filter((b): b is BudgetBucket => b !== null);
}

export function decodeRatesMap(s: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of s.split("|")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = Number(part.slice(eq + 1).trim());
    if (k && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function parseFxRatesLine(line: string): FxRates | null {
  const cells = parseCsv(line)[0];
  if (!cells || cells.length < 4) return null;
  return sanitizeFxRates({ base: cells[0], date: cells[1], fetchedAt: cells[2], rates: decodeRatesMap(cells[3]) });
}

function csvToDisciplines(csv: string): Discipline[] {
  return csvRowsToObjects(csv).map((o) => sanitizeDiscipline(o)).filter((d): d is Discipline => d !== null);
}

function csvToGrades(csv: string): Grade[] {
  return csvRowsToObjects(csv).map((o) => sanitizeGrade(o)).filter((g): g is Grade => g !== null);
}

function parsePlanLine(line: string): ResourcePlan | null {
  const cells = parseCsv(line)[0];
  if (!cells || cells.length < 4) return null;
  const today = new Date().toISOString().slice(0, 10);
  return sanitizePlan({ startDate: cells[0], endDate: cells[1], granularity: cells[2], currency: cells[3] }, today);
}

function csvToAbsences(csv: string): Absence[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];
  // Find the header row — skip blank/comment lines that survived the
  // section split.
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length > 0 && rows[i][0].trim() !== "" && !rows[i][0].startsWith("#")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return [];
  const headers = rows[headerIdx];
  const items: Absence[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 1 && row[0] === "") continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] ?? "";
    });
    const sanitized = sanitizeAbsence(obj);
    if (sanitized) items.push(sanitized);
  }
  return items;
}

function csvToShifts(csv: string): Shift[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (
      rows[i].length > 0 &&
      rows[i][0].trim() !== "" &&
      !rows[i][0].startsWith("#")
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return [];
  const headers = rows[headerIdx];
  const items: Shift[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 1 && row[0] === "") continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] ?? "";
    });
    const sanitized = sanitizeShift(obj);
    if (sanitized) items.push(sanitized);
  }
  return items;
}

function csvToMilestones(csv: string): Milestone[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length > 0 && rows[i][0].trim() !== "" && !rows[i][0].startsWith("#")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return [];
  const headers = rows[headerIdx];
  const items: Milestone[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 1 && row[0] === "") continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = rows[i][idx] ?? ""; });
    const item = buildMilestoneFromObj(obj);
    if (item) items.push(item);
  }
  return items;
}

function csvToChanges(csv: string): ChangeItem[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length > 0 && rows[i][0].trim() !== "" && !rows[i][0].startsWith("#")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return [];
  const headers = rows[headerIdx];
  const items: ChangeItem[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 1 && row[0] === "") continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = rows[i][idx] ?? ""; });
    const item = buildChangeFromObj(obj);
    if (item) items.push(item);
  }
  return items;
}

export function csvToStakeholders(csv: string): Stakeholder[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length > 0 && rows[i][0].trim() !== "" && !rows[i][0].startsWith("#")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return [];
  const headers = rows[headerIdx];
  const items: Stakeholder[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 1 && row[0] === "") continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = rows[i][idx] ?? ""; });
    const item = buildStakeholderFromObj(obj);
    if (item) items.push(item);
  }
  return items;
}

function csvToRaid(csv: string): RaidItem[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];
  // Find the header row — skip blank/comment lines that survived the
  // section split.
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length > 0 && rows[i][0].trim() !== "" && !rows[i][0].startsWith("#")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return [];
  const headers = rows[headerIdx];
  const items: RaidItem[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 1 && row[0] === "") continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] ?? "";
    });
    const item = buildRaidItemFromObj(obj);
    if (item) items.push(item);
  }
  return items;
}

/** Parses all sections out of a (possibly section-marked) CSV string. */
export function csvToWorkspace(csv: string): Workspace {
  const s = splitCsvSections(csv);
  const ws: Workspace = {
    tasks: csvToTasks(s.tasksText),
    raid: s.raidText.trim() ? csvToRaid(s.raidText) : [],
    absences: s.absencesText.trim() ? csvToAbsences(s.absencesText) : [],
    shifts: s.shiftsText.trim() ? csvToShifts(s.shiftsText) : [],
    resources: s.resourcesText.trim() ? csvToResources(s.resourcesText) : [],
    roles: s.rolesText.trim() ? csvToRoles(s.rolesText) : [],
    disciplines: s.disciplinesText.trim() ? csvToDisciplines(s.disciplinesText) : [],
    grades: s.gradesText.trim() ? csvToGrades(s.gradesText) : [],
    plan: (s.planText.trim() && parsePlanLine(s.planText)) || defaultResourcePlan(new Date().toISOString().slice(0, 10)),
    budgets: s.budgetsText.trim() ? csvToBudgets(s.budgetsText) : [],
    fxRates: s.fxRatesText.trim() ? parseFxRatesLine(s.fxRatesText.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#")) ?? "") : null,
    status: s.statusText.trim() ? csvToStatus(s.statusText) : {},
    milestones: s.milestonesText.trim() ? csvToMilestones(s.milestonesText) : [],
    changes: s.changesText.trim() ? csvToChanges(s.changesText) : [],
    stakeholders: s.stakeholdersText.trim() ? csvToStakeholders(s.stakeholdersText) : [],
  };
  const project = s.projectText.trim() ? csvToProject(s.projectText) : null;
  if (project) ws.project = project;
  return migrateWorkspaceV8(ws);
}

/**
 * Builds a Task from a header→value object produced by the CSV / MD parsers.
 * Returns null if the row lacks a valid positive integer id.
 * Mirrors the shape of buildRaidItemFromObj for the Task entity.
 */
export function buildTaskFromObj(obj: Record<string, string>): Task | null {
  const id = Number(obj.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const inq = Number(obj.inquiriesSent);
  return {
    id,
    taskName: obj.taskName ?? "",
    assignee: obj.assignee ?? "",
    assigneeEmail: obj.assigneeEmail ?? "",
    startDate: obj.startDate || undefined,
    dueDate: obj.dueDate ?? "",
    lastUpdateDate: obj.lastUpdateDate ?? "",
    priority: ((obj.priority as Priority) || "Medium") as Priority,
    blockers: obj.blockers ?? "",
    notes: obj.notes ?? "",
    completedDate: obj.completedDate || undefined,
    inquiriesSent: Number.isFinite(inq) && inq > 0 ? inq : 0,
    group: sanitizeGroup(obj.group),
    labels: sanitizeLabels(obj.labels),
    dependencies: parseDependenciesString(obj.dependencies),
    jiraKey: obj.jiraKey || undefined,
    jiraIssueType: obj.jiraIssueType || undefined,
    lastSyncedAt: obj.lastSyncedAt || undefined,
    localModifiedAt: obj.localModifiedAt || undefined,
    healthOverride: parseHealthOverride(obj.healthOverride),
    resourceId: Number(obj.resourceId) || undefined,
    originalEstimateMinutes: sanitizeOptionalMinutes(obj.originalEstimateMinutes),
    timeSpentMinutes: sanitizeOptionalMinutes(obj.timeSpentMinutes),
    documentLinks: decodeDocumentLinks(obj.documentLinks),
  };
}

function csvToTasks(csv: string): Task[] {
  // Tolerate an optional leading "# TASKS" marker — files written by
  // `workspaceToCsv` always carry one, even when raid is empty.
  const stripped = csv.replace(/^\s*#\s*TASKS\s*\r?\n/, "");
  const rows = parseCsv(stripped);
  if (rows.length === 0) return [];
  const headers = rows[0];
  const tasks: Task[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 1 && row[0] === "") continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] ?? "";
    });
    const task = buildTaskFromObj(obj);
    if (task) tasks.push(task);
  }
  // Final pass: now that we know every id that survived parsing, drop any
  // dependency entries that point at missing or self ids. Older CSV files
  // without a `dependencies` column hit this with empty arrays and become
  // no-ops.
  return dropDanglingDependencies(tasks);
}

// --- Markdown serialization ------------------------------------------------

const MD_COLUMNS: Array<{ key: keyof Task; label: string }> = [
  { key: "id", label: "ID" },
  { key: "taskName", label: "Task" },
  { key: "assignee", label: "Assignee" },
  { key: "assigneeEmail", label: "Email" },
  { key: "startDate", label: "Start" },
  { key: "dueDate", label: "Due" },
  { key: "lastUpdateDate", label: "Last update" },
  { key: "priority", label: "Priority" },
  { key: "blockers", label: "Blockers" },
  { key: "notes", label: "Notes" },
  { key: "completedDate", label: "Completed" },
  { key: "inquiriesSent", label: "Inquiries" },
  { key: "group", label: "Group" },
  { key: "labels", label: "Labels" },
  { key: "dependencies", label: "Dependencies" },
  { key: "jiraKey", label: "Jira" },
  { key: "jiraIssueType", label: "JiraType" },
  { key: "lastSyncedAt", label: "LastSynced" },
  { key: "localModifiedAt", label: "LocalModified" },
  { key: "healthOverride", label: "Health" },
  { key: "resourceId", label: "ResourceId" },
  { key: "originalEstimateMinutes", label: "OrigEstimateMin" },
  { key: "timeSpentMinutes", label: "TimeSpentMin" },
  { key: "documentLinks", label: "DocumentLinks" },
];

function mdEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function mdUnescape(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\\|/g, "|")
    .replace(/\\\\/g, "\\");
}

function tasksToMarkdown(tasks: Task[]): string {
  const header = `| ${MD_COLUMNS.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${MD_COLUMNS.map(() => "---").join(" | ")} |`;
  const lines = ["# LOP Tasks", "", header, sep];
  for (const t of tasks) {
    const row = MD_COLUMNS.map((c) =>
      mdEscape(fieldToString(t, c.key)),
    ).join(" | ");
    lines.push(`| ${row} |`);
  }
  return lines.join("\n") + "\n";
}

function raidToMarkdown(raid: readonly RaidItem[]): string {
  const header = `| ${RAID_MD_COLUMNS.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${RAID_MD_COLUMNS.map(() => "---").join(" | ")} |`;
  const lines = ["# RAID Log", "", header, sep];
  for (const r of raid) {
    const row = RAID_MD_COLUMNS.map((c) =>
      mdEscape(raidFieldToString(r, c.key)),
    ).join(" | ");
    lines.push(`| ${row} |`);
  }
  return lines.join("\n") + "\n";
}

function absencesToMarkdown(absences: readonly Absence[]): string {
  const header = `| ${ABSENCES_MD_COLUMNS.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${ABSENCES_MD_COLUMNS.map(() => "---").join(" | ")} |`;
  const lines = ["# Absences", "", header, sep];
  for (const a of absences) {
    const row = ABSENCES_MD_COLUMNS.map((c) =>
      mdEscape(absenceFieldToString(a, c.key)),
    ).join(" | ");
    lines.push(`| ${row} |`);
  }
  return lines.join("\n") + "\n";
}

function shiftsToMarkdown(shifts: readonly Shift[]): string {
  const header = `| ${SHIFTS_MD_COLUMNS.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${SHIFTS_MD_COLUMNS.map(() => "---").join(" | ")} |`;
  const lines = ["# Shifts", "", header, sep];
  for (const s of shifts) {
    const row = SHIFTS_MD_COLUMNS.map((c) =>
      mdEscape(shiftFieldToString(s, c.col)),
    ).join(" | ");
    lines.push(`| ${row} |`);
  }
  return lines.join("\n") + "\n";
}

function resourcesToMarkdown(rs: readonly Resource[]): string {
  const header = `| ${RESOURCES_MD_COLUMNS.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${RESOURCES_MD_COLUMNS.map(() => "---").join(" | ")} |`;
  const lines = ["# Resources", "", header, sep];
  for (const r of rs) {
    const row = RESOURCES_MD_COLUMNS.map((c) =>
      mdEscape(resourceFieldToString(r, c.col)),
    ).join(" | ");
    lines.push(`| ${row} |`);
  }
  return lines.join("\n") + "\n";
}

function rolesToMarkdown(rs: readonly Role[]): string {
  const header = `| ${ROLES_MD_COLUMNS.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${ROLES_MD_COLUMNS.map(() => "---").join(" | ")} |`;
  const lines = ["# Roles", "", header, sep];
  for (const r of rs) {
    const row = ROLES_MD_COLUMNS.map((c) =>
      mdEscape(String((r as Record<string, unknown>)[c.col] ?? "")),
    ).join(" | ");
    lines.push(`| ${row} |`);
  }
  return lines.join("\n") + "\n";
}

function budgetsToMarkdown(bs: readonly BudgetBucket[]): string {
  const header = `| ${BUDGETS_MD_COLUMNS.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${BUDGETS_MD_COLUMNS.map(() => "---").join(" | ")} |`;
  const lines = ["# Budgets", "", header, sep];
  for (const b of bs) {
    lines.push(`| ${BUDGETS_MD_COLUMNS.map((c) => mdEscape(budgetFieldToString(b, c.col))).join(" | ")} |`);
  }
  return lines.join("\n") + "\n";
}

const MILESTONES_MD_COLUMNS: Array<{ key: keyof Milestone; label: string }> = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "date", label: "Date" },
  { key: "description", label: "Description" },
  { key: "achievedDate", label: "Achieved" },
  { key: "linkedTaskIds", label: "LinkedTasks" },
  { key: "localModifiedAt", label: "LocalModified" },
];

function milestonesToMarkdown(milestones: readonly Milestone[]): string {
  const header = `| ${MILESTONES_MD_COLUMNS.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${MILESTONES_MD_COLUMNS.map(() => "---").join(" | ")} |`;
  const lines = ["## Milestones", "", header, sep];
  for (const m of milestones) {
    const row = MILESTONES_MD_COLUMNS.map((c) =>
      mdEscape(milestoneFieldToString(m, c.key)),
    ).join(" | ");
    lines.push(`| ${row} |`);
  }
  return lines.join("\n") + "\n";
}

function markdownToMilestones(md: string): Milestone[] {
  return markdownTableToObjects(md).map((row) => {
    const mapped: Record<string, string> = {};
    for (const [label, val] of Object.entries(row)) {
      const norm = label.toLowerCase().replace(/\s+/g, "");
      if (norm === "id") mapped["id"] = val;
      else if (norm === "name") mapped["name"] = val;
      else if (norm === "date") mapped["date"] = val;
      else if (norm === "description") mapped["description"] = val;
      else if (norm === "achieved" || norm === "achieveddate") mapped["achievedDate"] = val;
      else if (norm === "linkedtasks" || norm === "linkedtaskids") mapped["linkedTaskIds"] = val;
      else if (norm === "localmodified" || norm === "localmodifiedat") mapped["localModifiedAt"] = val;
    }
    return buildMilestoneFromObj(mapped);
  }).filter((m): m is Milestone => m !== null);
}

const CHANGES_MD_COLUMNS: readonly { key: keyof ChangeItem; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "description", label: "Description" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "impact", label: "Impact" },
  { key: "impactDescription", label: "ImpactDescription" },
  { key: "scheduleImpactDays", label: "ScheduleImpactDays" },
  { key: "costImpact", label: "CostImpact" },
  { key: "requestedBy", label: "RequestedBy" },
  { key: "raisedDate", label: "RaisedDate" },
  { key: "decisionBy", label: "DecisionBy" },
  { key: "decisionDate", label: "DecisionDate" },
  { key: "resolutionNotes", label: "ResolutionNotes" },
  { key: "linkedTaskIds", label: "LinkedTasks" },
  { key: "linkedRaidIds", label: "LinkedRaid" },
  { key: "stakeholderIds", label: "StakeholderIds" },
  { key: "localModifiedAt", label: "LocalModified" },
  { key: "documentLinks", label: "DocumentLinks" },
];

function changesToMarkdown(changes: readonly ChangeItem[]): string {
  const header = `| ${CHANGES_MD_COLUMNS.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${CHANGES_MD_COLUMNS.map(() => "---").join(" | ")} |`;
  const lines = ["## Changes", "", header, sep];
  for (const c of changes) {
    const row = CHANGES_MD_COLUMNS.map((col) =>
      mdEscape(changeFieldToString(c, col.key)),
    ).join(" | ");
    lines.push(`| ${row} |`);
  }
  return lines.join("\n") + "\n";
}

function markdownToChanges(md: string): ChangeItem[] {
  return markdownTableToObjects(md).map((row) => {
    const mapped: Record<string, string> = {};
    for (const [label, val] of Object.entries(row)) {
      const norm = label.toLowerCase().replace(/\s+/g, "");
      if (norm === "id") mapped["id"] = val;
      else if (norm === "title") mapped["title"] = val;
      else if (norm === "description") mapped["description"] = val;
      else if (norm === "type") mapped["type"] = val;
      else if (norm === "status") mapped["status"] = val;
      else if (norm === "impact") mapped["impact"] = val;
      else if (norm === "impactdescription") mapped["impactDescription"] = val;
      else if (norm === "scheduleimpactdays") mapped["scheduleImpactDays"] = val;
      else if (norm === "costimpact") mapped["costImpact"] = val;
      else if (norm === "requestedby") mapped["requestedBy"] = val;
      else if (norm === "raiseddate") mapped["raisedDate"] = val;
      else if (norm === "decisionby") mapped["decisionBy"] = val;
      else if (norm === "decisiondate") mapped["decisionDate"] = val;
      else if (norm === "resolutionnotes") mapped["resolutionNotes"] = val;
      else if (norm === "linkedtasks" || norm === "linkedtaskids") mapped["linkedTaskIds"] = val;
      else if (norm === "linkedraid" || norm === "linkedraidids") mapped["linkedRaidIds"] = val;
      else if (norm === "stakeholderids" || norm === "stakeholders") mapped["stakeholderIds"] = val;
      else if (norm === "localmodified" || norm === "localmodifiedat") mapped["localModifiedAt"] = val;
      else if (norm === "documentlinks") mapped["documentLinks"] = val;
    }
    return buildChangeFromObj(mapped);
  }).filter((c): c is ChangeItem => c !== null);
}

const STAKEHOLDERS_MD_COLUMNS: readonly { key: keyof Stakeholder; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "organization", label: "Organization" },
  { key: "title", label: "Title" },
  { key: "email", label: "Email" },
  { key: "category", label: "Category" },
  { key: "influence", label: "Influence" },
  { key: "interest", label: "Interest" },
  { key: "notes", label: "Notes" },
  { key: "resourceId", label: "ResourceId" },
  { key: "raci", label: "RACI" },
  { key: "localModifiedAt", label: "LocalModified" },
];

function stakeholdersToMarkdown(stakeholders: readonly Stakeholder[]): string {
  const header = `| ${STAKEHOLDERS_MD_COLUMNS.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${STAKEHOLDERS_MD_COLUMNS.map(() => "---").join(" | ")} |`;
  const lines = ["## Stakeholders", "", header, sep];
  for (const s of stakeholders) {
    const row = STAKEHOLDERS_MD_COLUMNS.map((col) =>
      mdEscape(stakeholderFieldToString(s, col.key)),
    ).join(" | ");
    lines.push(`| ${row} |`);
  }
  return lines.join("\n") + "\n";
}

function markdownToStakeholders(md: string): Stakeholder[] {
  return markdownTableToObjects(md).map((row) => {
    const mapped: Record<string, string> = {};
    for (const [label, val] of Object.entries(row)) {
      const norm = label.toLowerCase().replace(/\s+/g, "");
      if (norm === "id") mapped["id"] = val;
      else if (norm === "name") mapped["name"] = val;
      else if (norm === "organization") mapped["organization"] = val;
      else if (norm === "title") mapped["title"] = val;
      else if (norm === "email") mapped["email"] = val;
      else if (norm === "category") mapped["category"] = val;
      else if (norm === "influence") mapped["influence"] = val;
      else if (norm === "interest") mapped["interest"] = val;
      else if (norm === "notes") mapped["notes"] = val;
      else if (norm === "resourceid") mapped["resourceId"] = val;
      else if (norm === "raci") mapped["raci"] = val;
      else if (norm === "localmodified" || norm === "localmodifiedat") mapped["localModifiedAt"] = val;
    }
    return buildStakeholderFromObj(mapped);
  }).filter((s): s is Stakeholder => s !== null);
}

function fxRatesToMarkdown(fx: FxRates): string {
  return `## FX Rates\n\n${fx.base},${fx.date},${fx.fetchedAt},${encodeRatesMap(fx.rates)}\n`;
}

function refsToMarkdown(heading: string, rs: readonly { id: number; name: string; localModifiedAt?: string }[]): string {
  const header = `| ${REF_MD_COLUMNS.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${REF_MD_COLUMNS.map(() => "---").join(" | ")} |`;
  const lines = [`# ${heading}`, "", header, sep];
  for (const r of rs) {
    const row = [String(r.id), mdEscape(r.name), r.localModifiedAt ?? ""].join(" | ");
    lines.push(`| ${row} |`);
  }
  return lines.join("\n") + "\n";
}

function planToMarkdown(p: ResourcePlan): string {
  return `## Plan\n\n${p.startDate},${p.endDate},${p.granularity},${p.currency}\n`;
}

/** Combined markdown workspace. Each entity section is its own heading + table.
 *
 *  @param config When provided (document export), only sections enabled in the
 *  config are emitted and storage-only sections (disciplines, grades, fxRates,
 *  plan) are omitted. When undefined (default), ALL sections are emitted for
 *  full round-trip storage fidelity. */
export function workspaceToMarkdown(ws: Workspace, config?: ExportConfig): string {
  const enabled = (key: (typeof EXPORT_SECTION_KEYS)[number]) =>
    config === undefined || config[key];

  const mdParts: string[] = [];
  if (!config || config.tasks) mdParts.push(tasksToMarkdown(ws.tasks));
  if (enabled("raid") && ws.raid.length > 0) mdParts.push(raidToMarkdown(ws.raid));
  if (enabled("absences") && ws.absences.length > 0) mdParts.push(absencesToMarkdown(ws.absences));
  if (enabled("shifts") && ws.shifts.length > 0) mdParts.push(shiftsToMarkdown(ws.shifts));
  if (config === undefined) {
    // Storage-only sections — omitted from document exports.
    if (ws.disciplines.length > 0) mdParts.push(refsToMarkdown("Disciplines", ws.disciplines));
    if (ws.grades.length > 0) mdParts.push(refsToMarkdown("Grades", ws.grades));
  }
  if (enabled("roles") && ws.roles.length > 0) mdParts.push(rolesToMarkdown(ws.roles));
  if (enabled("resources") && ws.resources.length > 0) mdParts.push(resourcesToMarkdown(ws.resources));
  if (enabled("budgets") && (ws.budgets ?? []).length > 0) mdParts.push(budgetsToMarkdown(ws.budgets ?? []));
  if (config === undefined && ws.fxRates) mdParts.push(fxRatesToMarkdown(ws.fxRates));
  if (enabled("status") && ws.status && Object.keys(ws.status).length > 0) mdParts.push(statusToMarkdown(ws.status));
  if (enabled("milestones") && (ws.milestones ?? []).length > 0) mdParts.push(milestonesToMarkdown(ws.milestones ?? []));
  if (enabled("changes") && (ws.changes ?? []).length > 0) mdParts.push(changesToMarkdown(ws.changes ?? []));
  if (enabled("stakeholders") && (ws.stakeholders ?? []).length > 0) mdParts.push(stakeholdersToMarkdown(ws.stakeholders ?? []));
  if (config === undefined) mdParts.push(planToMarkdown(ws.plan));
  // Project metadata — additive, storage-only for now, emitted last (see CSV).
  if (config === undefined && ws.project) mdParts.push(projectToMarkdown(ws.project));
  const out = mdParts.join("\n");
  return out;
}

function splitMdRow(line: string): string[] {
  const cells: string[] = [];
  let buf = "";
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === "\\" && i + 1 < line.length) {
      buf += line[i] + line[i + 1];
      i += 2;
      continue;
    }
    if (c === "|") {
      cells.push(buf);
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  cells.push(buf);
  if (cells.length > 0 && cells[0].trim() === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

/**
 * Splits a workspace markdown into its entity sections by heading.
 * Sections absent from the file produce empty strings.
 */
function splitMarkdownSections(md: string): {
  tasksMd: string;
  raidMd: string;
  absencesMd: string;
  shiftsMd: string;
  resourcesMd: string;
  rolesMd: string;
  disciplinesMd: string;
  gradesMd: string;
  planMd: string;
  budgetsMd: string;
  fxRatesMd: string;
  statusMd: string;
  milestonesMd: string;
  changesMd: string;
  stakeholdersMd: string;
  projectMd: string;
} {
  const lines = md.split(/\r?\n/);
  const tasksLines: string[] = [];
  const raidLines: string[] = [];
  const absencesLines: string[] = [];
  const shiftsLines: string[] = [];
  const resourcesLines: string[] = [];
  const rolesLines: string[] = [];
  const disciplinesLines: string[] = [];
  const gradesLines: string[] = [];
  const planLines: string[] = [];
  const budgetsLines: string[] = [];
  const fxRatesLines: string[] = [];
  const statusLines: string[] = [];
  const milestonesLines: string[] = [];
  const changesLines: string[] = [];
  const stakeholdersLines: string[] = [];
  const projectLines: string[] = [];
  let target = tasksLines;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#\s+RAID\s+Log\b/i.test(trimmed)) { target = raidLines; target.push(line); continue; }
    if (/^#\s+LOP\s+Tasks\b/i.test(trimmed)) { target = tasksLines; target.push(line); continue; }
    if (/^#\s+Absences\b/i.test(trimmed)) { target = absencesLines; target.push(line); continue; }
    if (/^#\s+Shifts\b/i.test(trimmed)) { target = shiftsLines; target.push(line); continue; }
    if (/^#\s+Resources\b/i.test(trimmed)) { target = resourcesLines; target.push(line); continue; }
    if (/^#\s+Roles\b/i.test(trimmed)) { target = rolesLines; target.push(line); continue; }
    if (/^#\s+Disciplines\b/i.test(trimmed)) { target = disciplinesLines; target.push(line); continue; }
    if (/^#\s+Grades\b/i.test(trimmed)) { target = gradesLines; target.push(line); continue; }
    if (/^##\s+Plan\b/i.test(trimmed)) { target = planLines; continue; }
    if (/^#\s+Budgets\b/i.test(trimmed)) { target = budgetsLines; target.push(line); continue; }
    if (/^##\s+FX\s+Rates\b/i.test(trimmed)) { target = fxRatesLines; continue; }
    if (/^##\s+Project\s+Meta\b/i.test(trimmed)) { target = projectLines; continue; }
    if (/^##\s+Project\s+Status\b/i.test(trimmed)) { target = statusLines; continue; }
    if (/^##\s+Milestones\b/i.test(trimmed)) { target = milestonesLines; continue; }
    if (/^##\s+Changes\b/i.test(trimmed)) { target = changesLines; continue; }
    if (/^##\s+Stakeholders\b/i.test(trimmed)) { target = stakeholdersLines; continue; }
    target.push(line);
  }
  return {
    tasksMd: tasksLines.join("\n"),
    raidMd: raidLines.join("\n"),
    absencesMd: absencesLines.join("\n"),
    shiftsMd: shiftsLines.join("\n"),
    resourcesMd: resourcesLines.join("\n"),
    rolesMd: rolesLines.join("\n"),
    disciplinesMd: disciplinesLines.join("\n"),
    gradesMd: gradesLines.join("\n"),
    planMd: planLines.join("\n"),
    budgetsMd: budgetsLines.join("\n"),
    fxRatesMd: fxRatesLines.join("\n"),
    statusMd: statusLines.join("\n"),
    milestonesMd: milestonesLines.join("\n"),
    changesMd: changesLines.join("\n"),
    stakeholdersMd: stakeholdersLines.join("\n"),
    projectMd: projectLines.join("\n"),
  };
}

function markdownToAbsences(md: string): Absence[] {
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith("|") && line.includes("|", 1)) {
      const next = (lines[i + 1] ?? "").trim();
      if (/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(next)) break;
    }
    i++;
  }
  if (i + 2 > lines.length) return [];
  const headers = splitMdRow(lines[i]);
  const idIdx = headers.findIndex((h) => h.toLowerCase() === "id");
  if (idIdx < 0) return [];

  const colMap: Record<string, keyof Absence | undefined> = {};
  headers.forEach((h, idx) => {
    const norm = h.toLowerCase().replace(/\s+/g, "");
    if (norm === "id") colMap[idx] = "id";
    else if (norm === "assignee") colMap[idx] = "assignee";
    else if (norm === "email" || norm === "assigneeemail")
      colMap[idx] = "assigneeEmail";
    else if (norm === "start" || norm === "startdate") colMap[idx] = "startDate";
    else if (norm === "end" || norm === "enddate") colMap[idx] = "endDate";
    else if (norm === "type") colMap[idx] = "type";
    else if (norm === "note") colMap[idx] = "note";
    else if (norm === "localmodified" || norm === "localmodifiedat")
      colMap[idx] = "localModifiedAt";
  });

  const items: Absence[] = [];
  for (let j = i + 2; j < lines.length; j++) {
    const raw = lines[j];
    if (!raw.trim().startsWith("|")) continue;
    const cells = splitMdRow(raw);
    const obj: Record<string, string> = {};
    cells.forEach((cell, idx) => {
      const field = colMap[idx];
      if (field) obj[field] = mdUnescape(cell);
    });
    const sanitized = sanitizeAbsence(obj);
    if (sanitized) items.push(sanitized);
  }
  return items;
}

function markdownToShifts(md: string): Shift[] {
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith("|") && line.includes("|", 1)) {
      const next = (lines[i + 1] ?? "").trim();
      if (/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(next)) break;
    }
    i++;
  }
  if (i + 2 > lines.length) return [];
  const headers = splitMdRow(lines[i]);
  const idIdx = headers.findIndex((h) => h.toLowerCase() === "id");
  if (idIdx < 0) return [];

  const colMap: Record<number, string | undefined> = {};
  headers.forEach((h, idx) => {
    const norm = h.toLowerCase().replace(/\s+/g, "");
    if (norm === "id") colMap[idx] = "id";
    else if (norm === "assignee") colMap[idx] = "assignee";
    else if (norm === "email" || norm === "assigneeemail")
      colMap[idx] = "assigneeEmail";
    else if (norm === "sun" || norm === "sunhours") colMap[idx] = "sunHours";
    else if (norm === "mon" || norm === "monhours") colMap[idx] = "monHours";
    else if (norm === "tue" || norm === "tuehours") colMap[idx] = "tueHours";
    else if (norm === "wed" || norm === "wedhours") colMap[idx] = "wedHours";
    else if (norm === "thu" || norm === "thuhours") colMap[idx] = "thuHours";
    else if (norm === "fri" || norm === "frihours") colMap[idx] = "friHours";
    else if (norm === "sat" || norm === "sathours") colMap[idx] = "satHours";
    else if (norm === "note") colMap[idx] = "note";
    else if (norm === "localmodified" || norm === "localmodifiedat")
      colMap[idx] = "localModifiedAt";
  });

  const items: Shift[] = [];
  for (let j = i + 2; j < lines.length; j++) {
    const raw = lines[j];
    if (!raw.trim().startsWith("|")) continue;
    const cells = splitMdRow(raw);
    const obj: Record<string, string> = {};
    cells.forEach((cell, idx) => {
      const field = colMap[idx];
      if (field) obj[field] = mdUnescape(cell);
    });
    const sanitized = sanitizeShift(obj);
    if (sanitized) items.push(sanitized);
  }
  return items;
}

/** Generic MD table → array of string-keyed objects (label→value). */
function markdownTableToObjects(md: string): Record<string, string>[] {
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith("|") && line.includes("|", 1)) {
      const next = (lines[i + 1] ?? "").trim();
      if (/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(next)) break;
    }
    i++;
  }
  if (i + 2 > lines.length) return [];
  const headers = splitMdRow(lines[i]);
  const out: Record<string, string>[] = [];
  for (let j = i + 2; j < lines.length; j++) {
    const raw = lines[j];
    if (!raw.trim().startsWith("|")) continue;
    const cells = splitMdRow(raw);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = mdUnescape(cells[idx] ?? ""); });
    out.push(obj);
  }
  return out;
}

/** Map MD column labels to sanitizer field keys for resources. */
function markdownToResources(md: string): Resource[] {
  return markdownTableToObjects(md).map((row) => {
    const mapped: Record<string, string> = {};
    for (const [label, val] of Object.entries(row)) {
      const norm = label.toLowerCase().replace(/\s+/g, "");
      if (norm === "id") mapped["id"] = val;
      else if (norm === "first" || norm === "firstname") mapped["firstName"] = val;
      else if (norm === "last" || norm === "lastname") mapped["lastName"] = val;
      else if (norm === "name") mapped["name"] = val; // legacy single-name files
      else if (norm === "title") mapped["title"] = val;
      else if (norm === "phone" || norm === "businessphone") mapped["businessPhone"] = val;
      else if (norm === "location") mapped["location"] = val;
      else if (norm === "department") mapped["department"] = val;
      else if (norm === "email") mapped["email"] = val;
      else if (norm === "company") mapped["company"] = val;
      else if (norm === "birthday") mapped["birthday"] = val;
      else if (norm === "notes") mapped["notes"] = val;
      else if (norm === "roleid") mapped["roleId"] = val;
      else if (norm === "mode" || norm === "utilizationmode") mapped["utilizationMode"] = val;
      else if (norm === "utilization") mapped["utilization"] = val;
      else if (norm === "absenceoverride") mapped["absenceOverride"] = val;
      else if (norm === "active") mapped["active"] = val;
      else if (norm === "localmodified" || norm === "localmodifiedat") mapped["localModifiedAt"] = val;
    }
    return sanitizeResource(mapped);
  }).filter((r): r is Resource => r !== null);
}

/** Map MD column labels to sanitizer field keys for roles. */
function markdownToRoles(md: string): Role[] {
  return markdownTableToObjects(md).map((row) => {
    const mapped: Record<string, string> = {};
    for (const [label, val] of Object.entries(row)) {
      const norm = label.toLowerCase().replace(/\s+/g, "");
      if (norm === "id") mapped["id"] = val;
      else if (norm === "disciplineid") mapped["disciplineId"] = val;
      else if (norm === "gradeid") mapped["gradeId"] = val;
      else if (norm === "internalrate") mapped["internalRate"] = val;
      else if (norm === "externalrate") mapped["externalRate"] = val;
      else if (norm === "localmodified" || norm === "localmodifiedat") mapped["localModifiedAt"] = val;
    }
    return sanitizeRole(mapped);
  }).filter((r): r is Role => r !== null);
}

function markdownToBudgets(md: string): BudgetBucket[] {
  return markdownTableToObjects(md).map((row) => {
    const mapped: Record<string, string> = {};
    for (const [label, val] of Object.entries(row)) {
      const norm = label.toLowerCase().replace(/\s+/g, "");
      if (norm === "id") mapped["id"] = val;
      else if (norm === "name") mapped["name"] = val;
      else if (norm === "po" || norm === "ponumber") mapped["poNumber"] = val;
      else if (norm === "type") mapped["type"] = val;
      else if (norm === "currency") mapped["currency"] = val;
      else if (norm === "fixedprice" || norm === "fixedpriceamount") mapped["fixedPriceAmount"] = val;
      else if (norm === "start" || norm === "startdate") mapped["startDate"] = val;
      else if (norm === "end" || norm === "enddate") mapped["endDate"] = val;
      else if (norm === "successorid") mapped["successorId"] = val;
      else if (norm === "status") mapped["status"] = val;
      else if (norm === "closed" || norm === "closeddate") mapped["closedDate"] = val;
      else if (norm === "fxoverride" || norm === "fxrateoverride") mapped["fxRateOverride"] = val;
      else if (norm === "allocations") mapped["allocations"] = val;
      else if (norm === "localmodified" || norm === "localmodifiedat") mapped["localModifiedAt"] = val;
      else if (norm === "order") mapped["order"] = val;
      else if (norm === "planningmode") mapped["planningMode"] = val;
      else if (norm === "disciplineallocations") mapped["disciplineAllocations"] = val;
      else if (norm === "rateoverrideinternal") mapped["rateOverrideInternal"] = val;
      else if (norm === "rateoverrideexternal") mapped["rateOverrideExternal"] = val;
    }
    return sanitizeBudgetBucket(mapped);
  }).filter((b): b is BudgetBucket => b !== null);
}

function parseFxRatesMarkdown(md: string): FxRates | null {
  for (const line of md.split(/\r?\n/)) {
    const tline = line.trim();
    if (!tline || tline.startsWith("#") || tline.startsWith("|")) continue;
    const cells = tline.split(",").map((s) => s.trim());
    if (cells.length < 4) continue;
    return sanitizeFxRates({ base: cells[0], date: cells[1], fetchedAt: cells[2], rates: decodeRatesMap(cells.slice(3).join(",")) });
  }
  return null;
}

/** Map MD column labels to sanitizer field keys for disciplines/grades. */
function markdownToRefs<T extends Discipline | Grade>(
  md: string,
  sanitize: (input: unknown) => T | null,
): T[] {
  return markdownTableToObjects(md).map((row) => {
    const mapped: Record<string, string> = {};
    for (const [label, val] of Object.entries(row)) {
      const norm = label.toLowerCase().replace(/\s+/g, "");
      if (norm === "id") mapped["id"] = val;
      else if (norm === "name") mapped["name"] = val;
      else if (norm === "localmodified" || norm === "localmodifiedat") mapped["localModifiedAt"] = val;
    }
    return sanitize(mapped);
  }).filter((r): r is T => r !== null);
}

function parsePlanMarkdown(md: string): ResourcePlan | null {
  for (const line of md.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("|")) continue;
    const cells = t.split(",").map((s) => s.trim());
    if (cells.length < 4) continue;
    const today = new Date().toISOString().slice(0, 10);
    return sanitizePlan({ startDate: cells[0], endDate: cells[1], granularity: cells[2], currency: cells[3] }, today);
  }
  return null;
}

function markdownToRaid(md: string): RaidItem[] {
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith("|") && line.includes("|", 1)) {
      const next = (lines[i + 1] ?? "").trim();
      if (/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(next)) break;
    }
    i++;
  }
  if (i + 2 > lines.length) return [];
  const headers = splitMdRow(lines[i]);
  const idIdx = headers.findIndex((h) => h.toLowerCase() === "id");
  if (idIdx < 0) return [];

  const colMap: Record<string, keyof RaidItem | undefined> = {};
  headers.forEach((h, idx) => {
    const norm = h.toLowerCase().replace(/\s+/g, "");
    if (norm === "id") colMap[idx] = "id";
    else if (norm === "category") colMap[idx] = "category";
    else if (norm === "title") colMap[idx] = "title";
    else if (norm === "description") colMap[idx] = "description";
    else if (norm === "severity") colMap[idx] = "severity";
    else if (norm === "probability") colMap[idx] = "probability";
    else if (norm === "impact") colMap[idx] = "impact";
    else if (norm === "status") colMap[idx] = "status";
    else if (norm === "owner") colMap[idx] = "owner";
    else if (norm === "owneremail") colMap[idx] = "ownerEmail";
    else if (norm === "mitigation") colMap[idx] = "mitigation";
    else if (norm === "linkedtasks" || norm === "linkedtaskids")
      colMap[idx] = "linkedTaskIds";
    else if (norm === "raised" || norm === "raiseddate")
      colMap[idx] = "raisedDate";
    else if (norm === "target" || norm === "targetdate")
      colMap[idx] = "targetDate";
    else if (norm === "closed" || norm === "closeddate")
      colMap[idx] = "closedDate";
    else if (norm === "localmodified" || norm === "localmodifiedat")
      colMap[idx] = "localModifiedAt";
    else if (
      norm === "causedbyids" ||
      norm === "causedbyraidids" ||
      norm === "causedby" ||
      norm === "causedbyraidid"
    )
      colMap[idx] = "causedByRaidIds";
    else if (norm === "stakeholderids" || norm === "stakeholders")
      colMap[idx] = "stakeholderIds";
    else if (norm === "documentlinks") colMap[idx] = "documentLinks";
  });

  const items: RaidItem[] = [];
  for (let j = i + 2; j < lines.length; j++) {
    const raw = lines[j];
    if (!raw.trim().startsWith("|")) continue;
    const cells = splitMdRow(raw);
    const obj: Record<string, string> = {};
    cells.forEach((cell, idx) => {
      const field = colMap[idx];
      if (field) obj[field] = mdUnescape(cell);
    });
    const item = buildRaidItemFromObj(obj);
    if (item) items.push(item);
  }
  return items;
}

/** Parses all sections out of a (possibly multi-section) markdown string. */
export function markdownToWorkspace(md: string): Workspace {
  const s = splitMarkdownSections(md);
  const ws: Workspace = {
    tasks: markdownToTasks(s.tasksMd || md),
    raid: s.raidMd.trim() ? markdownToRaid(s.raidMd) : [],
    absences: s.absencesMd.trim() ? markdownToAbsences(s.absencesMd) : [],
    shifts: s.shiftsMd.trim() ? markdownToShifts(s.shiftsMd) : [],
    resources: s.resourcesMd.trim() ? markdownToResources(s.resourcesMd) : [],
    roles: s.rolesMd.trim() ? markdownToRoles(s.rolesMd) : [],
    disciplines: s.disciplinesMd.trim() ? markdownToRefs(s.disciplinesMd, sanitizeDiscipline) : [],
    grades: s.gradesMd.trim() ? markdownToRefs(s.gradesMd, sanitizeGrade) : [],
    plan: (s.planMd.trim() && parsePlanMarkdown(s.planMd)) || defaultResourcePlan(new Date().toISOString().slice(0, 10)),
    budgets: s.budgetsMd.trim() ? markdownToBudgets(s.budgetsMd) : [],
    fxRates: s.fxRatesMd.trim() ? parseFxRatesMarkdown(s.fxRatesMd) : null,
    status: s.statusMd.trim() ? markdownToStatus(s.statusMd) : {},
    milestones: s.milestonesMd.trim() ? markdownToMilestones(s.milestonesMd) : [],
    changes: s.changesMd.trim() ? markdownToChanges(s.changesMd) : [],
    stakeholders: s.stakeholdersMd.trim() ? markdownToStakeholders(s.stakeholdersMd) : [],
  };
  const project = s.projectMd.trim() ? markdownToProject(s.projectMd) : null;
  if (project) ws.project = project;
  return migrateWorkspaceV8(ws);
}

function markdownToTasks(md: string): Task[] {
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith("|") && line.includes("|", 1)) {
      const next = (lines[i + 1] ?? "").trim();
      if (/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(next)) break;
    }
    i++;
  }
  if (i + 2 > lines.length) return [];
  const headers = splitMdRow(lines[i]);
  const idIdx = headers.findIndex((h) => h.toLowerCase() === "id");
  if (idIdx < 0) return [];

  const colMap: Record<string, keyof Task | undefined> = {};
  headers.forEach((h, idx) => {
    const norm = h.toLowerCase().replace(/\s+/g, "");
    if (norm === "id") colMap[idx] = "id";
    else if (norm === "task" || norm === "taskname") colMap[idx] = "taskName";
    else if (norm === "assignee") colMap[idx] = "assignee";
    else if (norm === "email" || norm === "assigneeemail")
      colMap[idx] = "assigneeEmail";
    else if (norm === "start" || norm === "startdate") colMap[idx] = "startDate";
    else if (norm === "due" || norm === "duedate") colMap[idx] = "dueDate";
    else if (norm === "lastupdate" || norm === "lastupdatedate")
      colMap[idx] = "lastUpdateDate";
    else if (norm === "priority") colMap[idx] = "priority";
    else if (norm === "blockers") colMap[idx] = "blockers";
    else if (norm === "notes") colMap[idx] = "notes";
    else if (norm === "completed" || norm === "completeddate")
      colMap[idx] = "completedDate";
    else if (norm === "inquiries" || norm === "inquiriessent")
      colMap[idx] = "inquiriesSent";
    else if (norm === "group") colMap[idx] = "group";
    else if (norm === "labels") colMap[idx] = "labels";
    else if (norm === "dependencies" || norm === "deps")
      colMap[idx] = "dependencies";
    else if (norm === "jira" || norm === "jirakey") colMap[idx] = "jiraKey";
    else if (norm === "jiratype" || norm === "jiraissuetype")
      colMap[idx] = "jiraIssueType";
    else if (norm === "lastsynced" || norm === "lastsyncedat")
      colMap[idx] = "lastSyncedAt";
    else if (norm === "localmodified" || norm === "localmodifiedat")
      colMap[idx] = "localModifiedAt";
    else if (norm === "health" || norm === "healthoverride")
      colMap[idx] = "healthOverride";
    else if (norm === "resourceid") colMap[idx] = "resourceId";
    else if (norm === "origestimatemin" || norm === "originalestimateminutes")
      colMap[idx] = "originalEstimateMinutes";
    else if (norm === "timespentmin" || norm === "timespentminutes")
      colMap[idx] = "timeSpentMinutes";
    else if (norm === "documentlinks") colMap[idx] = "documentLinks";
  });

  const tasks: Task[] = [];
  for (let j = i + 2; j < lines.length; j++) {
    const raw = lines[j];
    if (!raw.trim().startsWith("|")) continue;
    const cells = splitMdRow(raw);
    const obj: Record<string, string> = {};
    cells.forEach((cell, idx) => {
      const field = colMap[idx];
      if (field) obj[field] = mdUnescape(cell);
    });
    const id = Number(obj.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const inq = Number(obj.inquiriesSent);
    tasks.push({
      id,
      taskName: obj.taskName ?? "",
      assignee: obj.assignee ?? "",
      assigneeEmail: obj.assigneeEmail ?? "",
      startDate: obj.startDate || undefined,
      dueDate: obj.dueDate ?? "",
      lastUpdateDate: obj.lastUpdateDate ?? "",
      priority: ((obj.priority as Priority) || "Medium") as Priority,
      blockers: obj.blockers ?? "",
      notes: obj.notes ?? "",
      completedDate: obj.completedDate || undefined,
      inquiriesSent: Number.isFinite(inq) && inq > 0 ? inq : 0,
      group: sanitizeGroup(obj.group),
      labels: sanitizeLabels(obj.labels),
      dependencies: parseDependenciesString(obj.dependencies),
      jiraKey: obj.jiraKey || undefined,
      jiraIssueType: obj.jiraIssueType || undefined,
      lastSyncedAt: obj.lastSyncedAt || undefined,
      localModifiedAt: obj.localModifiedAt || undefined,
      healthOverride: parseHealthOverride(obj.healthOverride),
      resourceId: Number(obj.resourceId) || undefined,
      originalEstimateMinutes: sanitizeOptionalMinutes(obj.originalEstimateMinutes),
      timeSpentMinutes: sanitizeOptionalMinutes(obj.timeSpentMinutes),
      documentLinks: decodeDocumentLinks(obj.documentLinks),
    });
  }
  return dropDanglingDependencies(tasks);
}

// --- File System Access API helpers ---------------------------------------

export function isFileSystemAccessSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "showSaveFilePicker" in window;
}

type FilePickType = "json" | "csv" | "md";

/** Public alias for the three file formats a local project can be created in.
 *  Re-exported so callers (e.g. the project switcher) can talk about formats
 *  without depending on the internal `FilePickType`. */
export type LocalStorageFormat = FilePickType;

// `id` gives each format its own remembered directory + filename in the
// browser's File System Access pickers. Without distinct ids, every format
// shares one remembered location, so opening the CSV picker lands on the
// last-picked .md file (and vice versa). Allowed: [A-Za-z0-9_-], <=32 chars.
const PICK_OPTS: Record<
  FilePickType,
  {
    id: string;
    suggestedName: string;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }
> = {
  json: {
    id: "lopfile_json",
    suggestedName: "lop-app-tasks.json",
    types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
  },
  csv: {
    id: "lopfile_csv",
    suggestedName: "lop-app-tasks.csv",
    types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }],
  },
  md: {
    id: "lopfile_md",
    suggestedName: "lop-app-tasks.md",
    types: [
      {
        description: "Markdown",
        accept: { "text/markdown": [".md", ".markdown"] },
      },
    ],
  },
};

export interface FsHandle {
  queryPermission(opts: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(opts: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: string | Blob): Promise<void>;
    close(): Promise<void>;
  }>;
  name?: string;
}

async function pickSaveFile(type: FilePickType): Promise<FsHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new StorageNotReadyError("file-system-access-unsupported");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handle = await (window as any).showSaveFilePicker(PICK_OPTS[type]);
  return handle as FsHandle;
}

async function pickOpenFile(type: FilePickType): Promise<FsHandle> {
  if (
    typeof window === "undefined" ||
    !("showOpenFilePicker" in window)
  ) {
    throw new StorageNotReadyError("file-system-access-unsupported");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [handle] = await (window as any).showOpenFilePicker({
    multiple: false,
    id: PICK_OPTS[type].id,
    types: PICK_OPTS[type].types,
  });
  return handle as FsHandle;
}

async function hasGrantedPermission(
  handle: FsHandle,
  mode: "read" | "readwrite",
): Promise<boolean> {
  try {
    return (await handle.queryPermission({ mode })) === "granted";
  } catch {
    return false;
  }
}

/**
 * Attempts to upgrade to the requested permission level. Must be called from
 * a user-gesture context (a click handler or the picker's resolution) — the
 * File System Access API throws SecurityError otherwise. Returns true only on
 * "granted"; never throws (SecurityError, AbortError, etc. all become false).
 */
async function tryGrantPermission(
  handle: FsHandle,
  mode: "read" | "readwrite",
): Promise<boolean> {
  if (await hasGrantedPermission(handle, mode)) return true;
  try {
    return (await handle.requestPermission({ mode })) === "granted";
  } catch {
    return false;
  }
}

async function readHandle(handle: FsHandle): Promise<string> {
  const file = await handle.getFile();
  return await file.text();
}

export async function writeHandle(handle: FsHandle, content: string): Promise<void> {
  let writable: {
    write(data: BlobPart): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  };
  try {
    writable = await handle.createWritable();
  } catch {
    // createWritable() throws AbortError / SecurityError when Chrome's security
    // policy blocks the path (corporate policy, externally-modified file, certain
    // NTFS zones). queryPermission() reports "granted" but the actual write is
    // still blocked — surface a targeted message instead of the raw DOMException.
    throw new StorageNotReadyError("local-file-write-blocked");
  }
  try {
    await writable.write(content);
    await writable.close();
  } catch {
    // The write/close failed AFTER the writable opened — e.g. the browser
    // blocked the atomic swap. Abort so the .crswap temp is discarded and the
    // rename over the original never runs, leaving the original file intact.
    // Without this, a blocked close can delete the original (data loss).
    try {
      await writable.abort?.();
    } catch {
      // abort is best-effort; ignore secondary failures.
    }
    throw new StorageNotReadyError("local-file-write-blocked");
  }
}

// --- Backends --------------------------------------------------------------

/**
 * Browser-local persistence backed by IndexedDB record stores (one row per
 * Task / RaidItem). Replaces the previous "stringify the whole array into
 * localStorage" approach, which:
 *   - allocated a fresh ~N×KB JSON string on every debounced save,
 *   - hit the localStorage ~5–10 MB hard limit at scale, and
 *   - kept a duplicate string copy resident in the browser's localStorage
 *     map for the lifetime of the tab.
 *
 * Saves diff against an in-memory baseline (the last-loaded/last-saved
 * snapshot) and only write records whose reference identity changed, plus
 * the ids that were removed. The codebase follows an immutable-update
 * convention, so reference inequality reliably implies content change.
 *
 * Legacy localStorage data is migrated transparently on the first load
 * after upgrade — see `migrateLegacyIfNeeded`.
 */
class BrowserBackend implements StorageBackend {
  readonly kind = "browser" as const;
  // Old key names — only read during the one-time migration on first load.
  private static LEGACY_TASKS_KEY = "lop-app:tasks";
  private static LEGACY_RAID_KEY = "lop-app:raid";

  // Baseline of what IDB currently holds, indexed by id. Populated by
  // `load()` and refreshed at the end of each successful `save()`. Used by
  // `save()` to compute the minimal puts + deletes.
  private tasksBaseline = new Map<number, Task>();
  private raidBaseline = new Map<number, RaidItem>();
  private absencesBaseline = new Map<number, Absence>();
  private shiftsBaseline = new Map<number, Shift>();
  private resourcesBaseline = new Map<number, Resource>();
  private rolesBaseline = new Map<number, Role>();
  private disciplinesBaseline = new Map<number, Discipline>();
  private gradesBaseline = new Map<number, Grade>();
  private budgetsBaseline = new Map<number, BudgetBucket>();

  async load(): Promise<Workspace> {
    if (typeof window === "undefined") return emptyWorkspace();

    let tasks: Task[] = [];
    let raid: RaidItem[] = [];
    let absences: Absence[] = [];
    let shifts: Shift[] = [];
    let resources: Resource[] = [];
    let roles: Role[] = [];
    let disciplines: Discipline[] = [];
    let grades: Grade[] = [];
    let plan: ResourcePlan = defaultResourcePlan(new Date().toISOString().slice(0, 10));
    let budgets: BudgetBucket[] = [];
    let fxRates: FxRates | null = null;
    let status: ProjectStatus = {};
    let milestones: Milestone[] = [];
    let changes: ChangeItem[] = [];
    let stakeholders: Stakeholder[] = [];
    let project: ProjectMeta | undefined;
    try {
      tasks = await idbGetAll<Task>(IDB_TASKS_STORE);
      raid = await idbGetAll<RaidItem>(IDB_RAID_STORE);
      absences = await idbGetAll<Absence>(IDB_ABSENCES_STORE);
      shifts = await idbGetAll<Shift>(IDB_SHIFTS_STORE);
      resources = await idbGetAll<Resource>(IDB_RESOURCES_STORE);
      roles = await idbGetAll<Role>(IDB_ROLES_STORE);
      disciplines = await idbGetAll<Discipline>(IDB_DISCIPLINES_STORE);
      grades = await idbGetAll<Grade>(IDB_GRADES_STORE);
      plan = (await idbGet<ResourcePlan>(KV_PLAN_KEY)) ?? plan;
      budgets = await idbGetAll<BudgetBucket>(IDB_BUDGETS_STORE);
      fxRates = (await idbGet<FxRates>(KV_FXRATES_KEY)) ?? null;
      status = (await idbGet<ProjectStatus>(KV_STATUS_KEY)) ?? {};
      milestones = (await idbGet<Milestone[]>(KV_MILESTONES_KEY)) ?? [];
      changes = (await idbGet<ChangeItem[]>(KV_CHANGES_KEY)) ?? [];
      stakeholders = (await idbGet<Stakeholder[]>(KV_STAKEHOLDERS_KEY)) ?? [];
      project = sanitizeProjectMeta(await idbGet(KV_PROJECT_KEY)) ?? undefined;
    } catch {
      // IDB unavailable or upgrade failed. Fall through — the legacy
      // migration block below will still try localStorage, and if that's
      // also empty we just hand back blank state.
    }

    if (tasks.length === 0 && raid.length === 0) {
      const migrated = await this.migrateLegacyIfNeeded();
      tasks = migrated.tasks;
      raid = migrated.raid;
      // Legacy localStorage never stored absences/shifts/resources — leave as-is
      // from the (possibly successful) idbGetAll attempts above.
    }

    const raw: Workspace = { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates, status, milestones, changes, stakeholders };
    if (project) raw.project = project;
    const ws = migrateWorkspaceV8(raw);

    try {
      if (ws.resources !== raw.resources) await idbBulkUpdate(IDB_RESOURCES_STORE, ws.resources, []);
      if (ws.disciplines !== raw.disciplines) await idbBulkUpdate(IDB_DISCIPLINES_STORE, ws.disciplines, []);
      if (ws.grades !== raw.grades) await idbBulkUpdate(IDB_GRADES_STORE, ws.grades, []);
      if (ws.tasks !== raw.tasks) await idbBulkUpdate(IDB_TASKS_STORE, ws.tasks, []); // resourceId stamped
      if (ws.absences !== raw.absences) await idbBulkUpdate(IDB_ABSENCES_STORE, ws.absences, []);
      if (ws.plan !== raw.plan) await idbSet(KV_PLAN_KEY, ws.plan);
    } catch { /* non-fatal: retried next load */ }

    this.tasksBaseline = new Map(ws.tasks.map((t) => [t.id, t]));
    this.raidBaseline = new Map(ws.raid.map((r) => [r.id, r]));
    this.absencesBaseline = new Map(ws.absences.map((a) => [a.id, a]));
    this.shiftsBaseline = new Map(ws.shifts.map((s) => [s.id, s]));
    this.resourcesBaseline = new Map(ws.resources.map((r) => [r.id, r]));
    this.rolesBaseline = new Map(ws.roles.map((r) => [r.id, r]));
    this.disciplinesBaseline = new Map(ws.disciplines.map((d) => [d.id, d]));
    this.gradesBaseline = new Map(ws.grades.map((g) => [g.id, g]));
    this.budgetsBaseline = new Map((ws.budgets ?? []).map((b) => [b.id, b]));
    return ws;
  }

  /**
   * One-time migration from the pre-IDB localStorage layout. Runs only when
   * the IDB record stores are empty AND the legacy keys hold data. On
   * success, copies records into IDB and removes the legacy keys so the
   * migration doesn't fire again. Failures leave the legacy data intact so
   * the user keeps a recoverable copy.
   *
   * Absences were introduced in schema v3 and shifts in v4; neither ever
   * had a localStorage representation, so this migration always returns
   * `absences: []` and `shifts: []`.
   */
  private async migrateLegacyIfNeeded(): Promise<Workspace> {
    const legacyTasks = this.readLegacyArray<Task>(
      BrowserBackend.LEGACY_TASKS_KEY,
    );
    const legacyRaid = this.readLegacyArray<RaidItem>(
      BrowserBackend.LEGACY_RAID_KEY,
    );
    if (legacyTasks.length === 0 && legacyRaid.length === 0) {
      return emptyWorkspace();
    }
    try {
      await idbBulkUpdate(IDB_TASKS_STORE, legacyTasks, []);
      await idbBulkUpdate(IDB_RAID_STORE, legacyRaid, []);
      try {
        window.localStorage.removeItem(BrowserBackend.LEGACY_TASKS_KEY);
        window.localStorage.removeItem(BrowserBackend.LEGACY_RAID_KEY);
      } catch {
        /* non-fatal */
      }
    } catch {
      // IDB write failed — return what we read so the UI still works this
      // session; next load will retry the migration.
    }
    return {
      ...emptyWorkspace(),
      tasks: legacyTasks,
      raid: legacyRaid,
    };
  }

  private readLegacyArray<T>(key: string): T[] {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  async save(ws: Workspace): Promise<void> {
    if (typeof window === "undefined") return;

    const taskDelta = this.diff(this.tasksBaseline, ws.tasks);
    const raidDelta = this.diff(this.raidBaseline, ws.raid);
    const absenceDelta = this.diff(this.absencesBaseline, ws.absences);
    const shiftDelta = this.diff(this.shiftsBaseline, ws.shifts);

    await idbBulkUpdate(IDB_TASKS_STORE, taskDelta.puts, taskDelta.deletes);
    await idbBulkUpdate(IDB_RAID_STORE, raidDelta.puts, raidDelta.deletes);
    await idbBulkUpdate(
      IDB_ABSENCES_STORE,
      absenceDelta.puts,
      absenceDelta.deletes,
    );
    await idbBulkUpdate(
      IDB_SHIFTS_STORE,
      shiftDelta.puts,
      shiftDelta.deletes,
    );

    const resourceDelta = this.diff(this.resourcesBaseline, ws.resources);
    const roleDelta = this.diff(this.rolesBaseline, ws.roles);
    const discDelta = this.diff(this.disciplinesBaseline, ws.disciplines);
    const gradeDelta = this.diff(this.gradesBaseline, ws.grades);
    await idbBulkUpdate(IDB_RESOURCES_STORE, resourceDelta.puts, resourceDelta.deletes);
    await idbBulkUpdate(IDB_ROLES_STORE, roleDelta.puts, roleDelta.deletes);
    await idbBulkUpdate(IDB_DISCIPLINES_STORE, discDelta.puts, discDelta.deletes);
    await idbBulkUpdate(IDB_GRADES_STORE, gradeDelta.puts, gradeDelta.deletes);
    await idbSet(KV_PLAN_KEY, ws.plan);

    const budgetDelta = this.diff(this.budgetsBaseline, ws.budgets ?? []);
    await idbBulkUpdate(IDB_BUDGETS_STORE, budgetDelta.puts, budgetDelta.deletes);
    await idbSet(KV_FXRATES_KEY, ws.fxRates ?? null);
    await idbSet(KV_STATUS_KEY, ws.status ?? {});
    await idbSet(KV_MILESTONES_KEY, ws.milestones ?? []);
    await idbSet(KV_CHANGES_KEY, ws.changes ?? []);
    await idbSet(KV_STAKEHOLDERS_KEY, ws.stakeholders ?? []);
    if (ws.project) await idbSet(KV_PROJECT_KEY, ws.project);
    else await idbDelete(KV_PROJECT_KEY);

    // Refresh baselines so the next save's diff is computed against what's
    // actually in IDB. Rebuilding the maps is O(N) but only runs after a
    // successful write, not on every render.
    this.tasksBaseline = new Map(ws.tasks.map((t) => [t.id, t]));
    this.raidBaseline = new Map(ws.raid.map((r) => [r.id, r]));
    this.absencesBaseline = new Map(ws.absences.map((a) => [a.id, a]));
    this.shiftsBaseline = new Map(ws.shifts.map((s) => [s.id, s]));
    this.resourcesBaseline = new Map(ws.resources.map((r) => [r.id, r]));
    this.rolesBaseline = new Map(ws.roles.map((r) => [r.id, r]));
    this.disciplinesBaseline = new Map(ws.disciplines.map((d) => [d.id, d]));
    this.gradesBaseline = new Map(ws.grades.map((g) => [g.id, g]));
    this.budgetsBaseline = new Map((ws.budgets ?? []).map((b) => [b.id, b]));
  }

  /**
   * Reference-equality diff against the baseline. Unchanged rows in an
   * immutable codebase keep their object identity across renders, so a
   * fast `===` check separates "needs writing" from "nothing changed".
   * `deletes` are ids present in baseline but absent from the new list.
   */
  private diff<T extends { id: number }>(
    baseline: Map<number, T>,
    next: readonly T[],
  ): { puts: T[]; deletes: number[] } {
    const puts: T[] = [];
    const seen = new Set<number>();
    for (const item of next) {
      seen.add(item.id);
      if (baseline.get(item.id) !== item) {
        puts.push(item);
      }
    }
    const deletes: number[] = [];
    for (const id of baseline.keys()) {
      if (!seen.has(id)) deletes.push(id);
    }
    return { puts, deletes };
  }

  async isReady(): Promise<boolean> {
    return typeof window !== "undefined" && typeof indexedDB !== "undefined";
  }

  async describe(): Promise<string> {
    return "IndexedDB";
  }
}

class LocalFileBackend implements StorageBackend {
  readonly kind: LocalKind;
  private readonly idbKey: string;
  private readonly format: FilePickType;

  constructor(kind: LocalKind) {
    this.kind = kind;
    this.format =
      kind === "local-json" ? "json" : kind === "local-csv" ? "csv" : "md";
    this.idbKey = `file-handle:${kind}`;
  }

  private async getHandle(): Promise<FsHandle | null> {
    const handle = await idbGet<FsHandle>(this.idbKey);
    return handle ?? null;
  }

  /**
   * Non-interactive handle hydration. Persists a previously-obtained
   * FileSystemFileHandle into this backend's IndexedDB slot so the next
   * load()/save() targets that file WITHOUT showing a picker. Used by the
   * project switcher, which keeps a per-project handle store and needs to
   * point the active backend at the target project's file.
   *
   * The handle's existing read/write permission may be in the "prompt" state
   * after a page reload; callers should re-grant via requestWriteAccess() from
   * a user gesture if needed.
   */
  async setHandle(handle: FsHandle): Promise<void> {
    await idbSet(this.idbKey, handle);
  }

  /** Reads back the handle currently bound to this backend (after a pick/open),
   *  so callers can mirror it into a per-project handle store. */
  async readHandle(): Promise<FsHandle | null> {
    return this.getHandle();
  }

  async pickFile(): Promise<void> {
    // showSaveFilePicker grants readwrite implicitly when the user picks a file.
    const handle = await pickSaveFile(this.format);
    await idbSet(this.idbKey, handle);
  }

  async openFile(): Promise<void> {
    const handle = await pickOpenFile(this.format);
    // showOpenFilePicker returns a read-only handle. We're still in the
    // user-gesture context from the click that triggered the picker, so
    // request readwrite now while it's allowed. If the user dismisses or
    // the browser denies, we store the handle anyway and surface a clearer
    // "grant access" toast the next time save() runs.
    await tryGrantPermission(handle, "readwrite");
    await idbSet(this.idbKey, handle);
  }

  /**
   * Explicit upgrade to readwrite, intended to be called from a click handler.
   * Returns whether write access is now granted.
   */
  async requestWriteAccess(): Promise<boolean> {
    const handle = await this.getHandle();
    if (!handle) return false;
    return await tryGrantPermission(handle, "readwrite");
  }

  async clearFile(): Promise<void> {
    await idbDelete(this.idbKey);
  }

  async describe(): Promise<string | null> {
    const handle = await this.getHandle();
    return handle?.name ?? null;
  }

  async isReady(): Promise<boolean> {
    const handle = await this.getHandle();
    if (!handle) return false;
    return await hasGrantedPermission(handle, "readwrite");
  }

  async load(): Promise<Workspace> {
    const handle = await this.getHandle();
    if (!handle) throw new StorageNotReadyError("local-file-not-picked");
    if (!(await hasGrantedPermission(handle, "read"))) {
      throw new StorageNotReadyError("local-file-permission-needed");
    }
    const text = await readHandle(handle);
    if (!text.trim()) return emptyWorkspace();
    if (this.format === "json") return jsonToWorkspace(text);
    if (this.format === "csv") return csvToWorkspace(text);
    return markdownToWorkspace(text);
  }

  async save(ws: Workspace): Promise<void> {
    const handle = await this.getHandle();
    if (!handle) throw new StorageNotReadyError("local-file-not-picked");
    // Query only — never call requestPermission here. This path runs from a
    // debounced auto-save effect, which has no user activation, so requesting
    // permission would throw SecurityError. The user re-grants explicitly via
    // the picker buttons or the "Grant write access" button.
    if (!(await hasGrantedPermission(handle, "readwrite"))) {
      throw new StorageNotReadyError("local-file-permission-needed");
    }
    let content: string;
    if (this.format === "json") content = workspaceToJson(ws);
    else if (this.format === "csv") content = workspaceToCsv(ws);
    else content = workspaceToMarkdown(ws);
    await writeHandle(handle, content);
  }
}

// --- Factory ---------------------------------------------------------------

export interface CreateBackendDeps {
  acquireToken?: (
    scopes: readonly string[],
    options?: { interactive?: boolean },
  ) => Promise<string | null>;
  tursoConfig?: TursoConfig | null;
  /** Active Turso project id. When kind="turso" AND this is a non-empty string,
   *  createBackend returns a per-project TursoTenantBackend (Phase 2 multi-tenant
   *  portfolio mode). Otherwise the single-tenant TursoBackend is used. */
  tursoProjectId?: string | null;
}

export function createBackend(
  config: StorageConfig,
  deps: CreateBackendDeps = {},
): StorageBackend {
  switch (config.kind) {
    case "browser":
      return new BrowserBackend();
    case "local-json":
      return new LocalFileBackend("local-json");
    case "local-csv":
      return new LocalFileBackend("local-csv");
    case "local-md":
      return new LocalFileBackend("local-md");
    case "sp-json":
    case "sp-csv": {
      const acquireToken = deps.acquireToken ?? (async () => null);
      return new SharePointBackend(
        {
          kind: config.kind,
          hostname: config.hostname,
          sitePath: config.sitePath,
          itemPath: config.itemPath,
        },
        acquireToken,
      );
    }
    case "turso": {
      const tursoProjectId = deps.tursoProjectId;
      if (typeof tursoProjectId === "string" && tursoProjectId.length > 0) {
        return new TursoTenantBackend(deps.tursoConfig ?? null, tursoProjectId);
      }
      return new TursoBackend(deps.tursoConfig ?? null);
    }
  }
}

export function pickFileForBackend(
  backend: StorageBackend,
): Promise<void> | null {
  if (backend instanceof LocalFileBackend) return backend.pickFile();
  return null;
}

export function openFileForBackend(
  backend: StorageBackend,
): Promise<void> | null {
  if (backend instanceof LocalFileBackend) return backend.openFile();
  return null;
}

export function requestWriteAccessForBackend(
  backend: StorageBackend,
): Promise<boolean> | null {
  if (backend instanceof LocalFileBackend) return backend.requestWriteAccess();
  return null;
}

/**
 * Hydrate a file-based backend with an already-known FileSystemFileHandle,
 * without an interactive picker. Returns the persistence promise for local
 * backends, or null for non-file backends (browser / SharePoint / Turso),
 * mirroring the pick/open/requestWriteAccess helpers above.
 *
 * The project switcher uses this to point the active LocalFileBackend at the
 * target project's stored handle before triggering a load.
 */
export function setBackendFileHandle(
  backend: StorageBackend,
  handle: FsHandle,
): Promise<void> | null {
  if (backend instanceof LocalFileBackend) return backend.setHandle(handle);
  return null;
}

/**
 * Read the FileSystemFileHandle a file-based backend is currently bound to
 * (after a pick/open). Returns null for non-file backends or when none is set.
 * The project switcher uses this to mirror the just-picked handle into its
 * per-project handle store.
 */
export function getBackendFileHandle(
  backend: StorageBackend,
): Promise<FsHandle | null> | null {
  if (backend instanceof LocalFileBackend) return backend.readHandle();
  return null;
}

