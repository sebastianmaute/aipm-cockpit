import { riskSeverityFromMatrix } from "./raid";
import {
  backfillResources,
  defaultResourcePlan,
  seedDisciplines,
  seedGrades,
} from "./resource-foundation";
import {
  dropDanglingDependencies,
  encodeAllocations,
  encodePeriodMap,
  parseDependenciesString,
  sanitizeAbsence,
  sanitizeBudgetBucket,
  sanitizeDiscipline,
  sanitizeFxRates,
  sanitizeGrade,
  sanitizeGroup,
  sanitizeLabels,
  sanitizePlan,
  sanitizeResource,
  sanitizeRole,
  sanitizeShift,
  serializeDependencies,
} from "./sanitize";
import {
  type Absence,
  type BudgetBucket,
  type Discipline,
  type FxRates,
  type Grade,
  type Priority,
  type RaidCategory,
  type RaidItem,
  type RaidSeverity,
  type RaidStatus,
  type Resource,
  type ResourcePlan,
  type RiskScale,
  type Role,
  type Shift,
  type Task,
} from "./types";

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
};

const SCHEMA_VERSION = 6;

/** A blank workspace with a default plan anchored to today. */
export function emptyWorkspace(): Workspace {
  return {
    tasks: [], raid: [], absences: [], shifts: [],
    resources: [], roles: [], disciplines: [], grades: [],
    plan: defaultResourcePlan(new Date().toISOString().slice(0, 10)),
    budgets: [],
    fxRates: null,
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
  if (budgets === base.budgets && fxRates === base.fxRates) return base;
  return { ...base, budgets, fxRates };
}

// --- Storage configuration -------------------------------------------------

export type StorageKind =
  | "browser"
  | "local-json"
  | "local-csv"
  | "local-md"
  | "sp-json"
  | "sp-csv";

type LocalKind = "local-json" | "local-csv" | "local-md";

export type StorageConfig =
  | { kind: "browser" }
  | { kind: "local-json" }
  | { kind: "local-csv" }
  | { kind: "local-md" }
  | {
      kind: "sp-json";
      clientId: string;
      tenantId: string;
      siteUrl: string;
      filePath: string;
    }
  | {
      kind: "sp-csv";
      clientId: string;
      tenantId: string;
      siteUrl: string;
      filePath: string;
    };

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
const IDB_VERSION = 5;
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

const CSV_COLUMNS: Array<keyof Task> = [
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
const RAID_CSV_COLUMNS: Array<keyof RaidItem> = [
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
];

// Columns persisted for Absence items in CSV and Markdown. Order matches
// the header row emitted by the encoder; the decoder reads by column name
// so reordering files by hand still works.
const ABSENCES_CSV_COLUMNS: Array<keyof Absence> = [
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
const SHIFTS_CSV_COLUMNS: readonly string[] = [
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

const RESOURCES_CSV_COLUMNS = [
  "id", "firstName", "lastName", "title", "businessPhone", "location",
  "department", "email", "company", "birthday", "notes",
  "roleId", "utilizationMode", "utilization", "absenceOverride", "active", "localModifiedAt",
] as const;
const ROLES_CSV_COLUMNS = ["id", "disciplineId", "gradeId", "internalRate", "externalRate", "localModifiedAt"] as const;
const REF_CSV_COLUMNS = ["id", "name", "localModifiedAt"] as const;

const BUDGETS_CSV_COLUMNS = [
  "id", "name", "poNumber", "type", "currency", "fixedPriceAmount",
  "startDate", "endDate", "successorId", "status", "closedDate",
  "fxRateOverride", "allocations", "localModifiedAt",
] as const;

const CSV_SECTION_BUDGETS = "# BUDGETS";
const CSV_SECTION_FXRATES = "# FXRATES";

// Section markers for the new entity sections in multi-section CSV files.
const CSV_SECTION_RESOURCES = "# RESOURCES";
const CSV_SECTION_ROLES = "# ROLES";
const CSV_SECTION_DISCIPLINES = "# DISCIPLINES";
const CSV_SECTION_GRADES = "# GRADES";
const CSV_SECTION_PLAN = "# PLAN";

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

const REF_MD_COLUMNS: readonly { col: string; label: string }[] = [
  { col: "id", label: "ID" },
  { col: "name", label: "Name" },
  { col: "localModifiedAt", label: "LocalModified" },
];

function shiftFieldToString(s: Shift, col: string): string {
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

function raidFieldToString(r: RaidItem, c: keyof RaidItem): string {
  if (c === "linkedTaskIds")
    return Array.isArray(r.linkedTaskIds) ? r.linkedTaskIds.join("|") : "";
  if (c === "causedByRaidIds")
    return Array.isArray(r.causedByRaidIds)
      ? r.causedByRaidIds.join("|")
      : "";
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
function buildRaidItemFromObj(obj: Record<string, string>): RaidItem | null {
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
  };
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

function fieldToString(t: Task, c: keyof Task): string {
  if (c === "labels") return Array.isArray(t.labels) ? t.labels.join("|") : "";
  if (c === "dependencies") return serializeDependencies(t.dependencies);
  return String(t[c] ?? "");
}

function tasksToCsv(tasks: Task[]): string {
  const lines: string[] = [CSV_COLUMNS.join(",")];
  for (const t of tasks) {
    lines.push(CSV_COLUMNS.map((c) => csvEscape(fieldToString(t, c))).join(","));
  }
  return lines.join("\r\n");
}

function raidToCsv(raid: readonly RaidItem[]): string {
  const lines: string[] = [RAID_CSV_COLUMNS.join(",")];
  for (const r of raid) {
    lines.push(
      RAID_CSV_COLUMNS.map((c) => csvEscape(raidFieldToString(r, c))).join(","),
    );
  }
  return lines.join("\r\n");
}

function absenceFieldToString(a: Absence, c: keyof Absence): string {
  return String(a[c] ?? "");
}

function absencesToCsv(absences: readonly Absence[]): string {
  const lines: string[] = [ABSENCES_CSV_COLUMNS.join(",")];
  for (const a of absences) {
    lines.push(
      ABSENCES_CSV_COLUMNS.map((c) =>
        csvEscape(absenceFieldToString(a, c)),
      ).join(","),
    );
  }
  return lines.join("\r\n");
}

function shiftsToCsv(shifts: readonly Shift[]): string {
  const lines: string[] = [SHIFTS_CSV_COLUMNS.join(",")];
  for (const s of shifts) {
    lines.push(
      SHIFTS_CSV_COLUMNS.map((c) => csvEscape(shiftFieldToString(s, c))).join(
        ",",
      ),
    );
  }
  return lines.join("\r\n");
}

// --- Resource CSV encoders -------------------------------------------------

function resourceFieldToString(r: Resource, c: string): string {
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

function rowsToCsv(header: readonly string[], rows: string[][]): string {
  return [header.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\r\n");
}

function resourcesToCsv(rs: readonly Resource[]): string {
  return rowsToCsv(
    RESOURCES_CSV_COLUMNS,
    rs.map((r) => RESOURCES_CSV_COLUMNS.map((c) => resourceFieldToString(r, c))),
  );
}

function budgetFieldToString(b: BudgetBucket, c: string): string {
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
    default: return "";
  }
}

function budgetsToCsv(bs: readonly BudgetBucket[]): string {
  return rowsToCsv(BUDGETS_CSV_COLUMNS, bs.map((b) => BUDGETS_CSV_COLUMNS.map((c) => budgetFieldToString(b, c))));
}

function encodeRatesMap(rates: Record<string, number>): string {
  return Object.entries(rates).filter(([, v]) => Number.isFinite(v)).map(([k, v]) => `${k}=${v}`).join("|");
}

function fxRatesToCsvLine(fx: FxRates): string {
  return [CSV_SECTION_FXRATES, [fx.base, fx.date, fx.fetchedAt, encodeRatesMap(fx.rates)].map(csvEscape).join(",")].join("\r\n");
}

function rolesToCsv(rs: readonly Role[]): string {
  return rowsToCsv(
    ROLES_CSV_COLUMNS,
    rs.map((r) => ROLES_CSV_COLUMNS.map((c) => String((r as Record<string, unknown>)[c] ?? ""))),
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

/** Multi-section CSV: tasks then (optionally) raid, absences, and shifts,
 *  separated by marker lines. Used by file backends for round-trip;
 *  `tasksToCsv` remains the marker-less variant that the Export menu uses
 *  for one-way downloads. */
export function workspaceToCsv(ws: Workspace): string {
  const parts: string[] = [CSV_SECTION_TASKS, tasksToCsv(ws.tasks)];
  if (ws.raid.length > 0) {
    parts.push("", CSV_SECTION_RAID, raidToCsv(ws.raid));
  }
  if (ws.absences.length > 0) {
    parts.push("", CSV_SECTION_ABSENCES, absencesToCsv(ws.absences));
  }
  if (ws.shifts.length > 0) {
    parts.push("", CSV_SECTION_SHIFTS, shiftsToCsv(ws.shifts));
  }
  if (ws.disciplines.length > 0) parts.push("", CSV_SECTION_DISCIPLINES, refsToCsv(ws.disciplines));
  if (ws.grades.length > 0) parts.push("", CSV_SECTION_GRADES, refsToCsv(ws.grades));
  if (ws.roles.length > 0) parts.push("", CSV_SECTION_ROLES, rolesToCsv(ws.roles));
  if (ws.resources.length > 0) parts.push("", CSV_SECTION_RESOURCES, resourcesToCsv(ws.resources));
  if ((ws.budgets ?? []).length > 0) parts.push("", CSV_SECTION_BUDGETS, budgetsToCsv(ws.budgets ?? []));
  if (ws.fxRates) parts.push("", fxRatesToCsvLine(ws.fxRates));
  parts.push("", planToCsvLine(ws.plan));
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
} {
  const lines = csv.split(/\r?\n/);
  let mode: "tasks" | "raid" | "absences" | "shifts" | "resources" | "roles" | "disciplines" | "grades" | "plan" | "budgets" | "fxrates" | null = null;
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

function decodeRatesMap(s: string): Record<string, number> {
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
  };
  return migrateWorkspaceV6(ws);
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
    });
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

/** Combined markdown workspace. Each entity section is its own heading + table. */
export function workspaceToMarkdown(ws: Workspace): string {
  let out = tasksToMarkdown(ws.tasks);
  if (ws.raid.length > 0) out += "\n" + raidToMarkdown(ws.raid);
  if (ws.absences.length > 0) out += "\n" + absencesToMarkdown(ws.absences);
  if (ws.shifts.length > 0) out += "\n" + shiftsToMarkdown(ws.shifts);
  if (ws.disciplines.length > 0) out += "\n" + refsToMarkdown("Disciplines", ws.disciplines);
  if (ws.grades.length > 0) out += "\n" + refsToMarkdown("Grades", ws.grades);
  if (ws.roles.length > 0) out += "\n" + rolesToMarkdown(ws.roles);
  if (ws.resources.length > 0) out += "\n" + resourcesToMarkdown(ws.resources);
  out += "\n" + planToMarkdown(ws.plan);
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
  };
  return migrateWorkspaceV5(ws);
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

    const raw: Workspace = { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan };
    const ws = migrateWorkspaceV5(raw);

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
    if (this.format === "json") {
      try {
        const parsed = JSON.parse(text);
        // Envelope shape: { schemaVersion, tasks, raid, ... }.
        // Require only tasks + raid (present since v1); the newer fields
        // default to [] / seeded so older files still load.
        if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          Array.isArray((parsed as { tasks?: unknown }).tasks) &&
          Array.isArray((parsed as { raid?: unknown }).raid)
        ) {
          const p = parsed as {
            tasks: Task[];
            raid: RaidItem[];
            absences?: unknown[];
            shifts?: unknown[];
            resources?: unknown[];
            roles?: unknown[];
            disciplines?: unknown[];
            grades?: unknown[];
            plan?: unknown;
          };
          const raw: Workspace = {
            tasks: p.tasks,
            raid: p.raid,
            absences: (p.absences ?? [])
              .map((a) => sanitizeAbsence(a))
              .filter((a): a is Absence => a !== null),
            shifts: (p.shifts ?? [])
              .map((s) => sanitizeShift(s))
              .filter((s): s is Shift => s !== null),
            resources: (p.resources ?? [])
              .map((r) => sanitizeResource(r))
              .filter((r): r is Resource => r !== null),
            roles: (p.roles ?? [])
              .map((r) => sanitizeRole(r))
              .filter((r): r is Role => r !== null),
            disciplines: (p.disciplines ?? [])
              .map((d) => sanitizeDiscipline(d))
              .filter((d): d is Discipline => d !== null),
            grades: (p.grades ?? [])
              .map((g) => sanitizeGrade(g))
              .filter((g): g is Grade => g !== null),
            plan: sanitizePlan(p.plan ?? {}, new Date().toISOString().slice(0, 10)),
          };
          return migrateWorkspaceV5(raw);
        }
        return emptyWorkspace();
      } catch {
        return emptyWorkspace();
      }
    }
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
    if (this.format === "json") {
      content = JSON.stringify(
        {
          schemaVersion: SCHEMA_VERSION,
          tasks: ws.tasks,
          raid: ws.raid,
          absences: ws.absences,
          shifts: ws.shifts,
          resources: ws.resources,
          roles: ws.roles,
          disciplines: ws.disciplines,
          grades: ws.grades,
          plan: ws.plan,
        },
        null,
        2,
      );
    } else if (this.format === "csv") content = workspaceToCsv(ws);
    else content = workspaceToMarkdown(ws);
    await writeHandle(handle, content);
  }
}

class SharePointBackend implements StorageBackend {
  readonly kind: "sp-json" | "sp-csv";

  constructor(kind: "sp-json" | "sp-csv") {
    this.kind = kind;
  }

  async isReady(): Promise<boolean> {
    return false;
  }

  async describe(): Promise<string> {
    return "Coming soon";
  }

  async load(): Promise<Workspace> {
    throw new StorageNotImplementedError("sharepoint-coming-soon");
  }

  async save(): Promise<void> {
    throw new StorageNotImplementedError("sharepoint-coming-soon");
  }
}

// --- Factory ---------------------------------------------------------------

export function createBackend(config: StorageConfig): StorageBackend {
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
      return new SharePointBackend("sp-json");
    case "sp-csv":
      return new SharePointBackend("sp-csv");
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

