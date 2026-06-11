import { riskSeverityFromMatrix } from "./raid";
import { encodeDocumentLinks, decodeDocumentLinks } from "./document-link";
import { defaultResourcePlan } from "./resource-foundation";
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
import { type Workspace, migrateWorkspaceV8, sanitizeProjectStatus } from "./workspace";

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
export function parseHealthOverride(s: string | undefined): "R" | "A" | "G" | undefined {
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

export const RESOURCES_CSV_COLUMNS = [
  "id", "firstName", "lastName", "title", "businessPhone", "location",
  "department", "email", "company", "birthday", "notes",
  "roleId", "utilizationMode", "utilization", "absenceOverride", "active", "localModifiedAt",
] as const;
export const ROLES_CSV_COLUMNS = ["id", "disciplineId", "gradeId", "internalRate", "externalRate", "localModifiedAt"] as const;
export const REF_CSV_COLUMNS = ["id", "name", "localModifiedAt"] as const;

export const MILESTONES_CSV_COLUMNS: Array<keyof Milestone> = [
  "id", "name", "date", "description", "achievedDate", "linkedTaskIds", "localModifiedAt", "documentLinks",
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
  if (c === "documentLinks") return encodeDocumentLinks(m.documentLinks);
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
  const dl = decodeDocumentLinks(obj.documentLinks); if (dl.length) m.documentLinks = dl;
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
  "influence", "interest", "notes", "resourceId", "raci", "localModifiedAt", "documentLinks",
];

export function stakeholderFieldToString(s: Stakeholder, col: keyof Stakeholder): string {
  if (col === "raci") return encodeRaciMap(s.raci);
  if (col === "resourceId") return s.resourceId == null ? "" : String(s.resourceId);
  if (col === "documentLinks") return encodeDocumentLinks(s.documentLinks);
  const v = s[col];
  return v === undefined || v === null ? "" : String(v);
}

export function buildStakeholderFromObj(obj: Record<string, string>): Stakeholder | null {
  return sanitizeStakeholder({
    ...obj,
    id: obj.id ? Number(obj.id) : undefined,
    resourceId: obj.resourceId ? Number(obj.resourceId) : null,
    raci: decodeRaciMap(obj.raci),
    documentLinks: decodeDocumentLinks(obj.documentLinks),
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

export function encodeRatesMap(rates: Record<string, number>): string {
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


// --- Project Status CSV encoder / decoder ------------------------------------

export const STATUS_FIELDS: readonly (keyof ProjectStatus)[] = [
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
  "documentLinks",
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
  if (col === "documentLinks") return encodeDocumentLinks(p.documentLinks);
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
    documentLinks: decodeDocumentLinks(obj.documentLinks ?? ""),
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
