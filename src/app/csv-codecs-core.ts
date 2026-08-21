// src/app/csv-codecs-core.ts
//
// CSV codec CORE: per-entity column registries (*_CSV_COLUMNS), the parse
// helpers, field encoders (fieldToString family) and build*FromObj decoders
// shared with the markdown codec and the Turso schema mapping, the csv
// escaping / formula neutralization primitives, the per-section entity
// encoders, and the low-level `parseCsv` tokenizer. Pure leaf — no imports
// from the config/decode siblings. Re-exported via the ./csv-codecs barrel.
//
// The `CSV_SECTION_*` markers moved to ./csv-codecs-sections when this file
// crossed the 800-line ratchet. They are re-exported below, so every existing
// `from "./csv-codecs-core"` import of a marker keeps working unchanged.

import { riskSeverityFromMatrix } from "./raid";
import { withStoredNoteLog } from "./change-log";
// `export *` does not bind names locally, so the two markers this module USES
// are imported explicitly as well.
import { CSV_SECTION_FXRATES, CSV_SECTION_PLAN } from "./csv-codecs-sections";
import { quoteStep } from "./csv-line-scan";

export * from "./csv-codecs-sections";
import { encodeKnowledgeLinks, decodeKnowledgeLinks } from "./document-link";
import { encodeNoteLog, decodeNoteLog } from "./note-log";
import {
  type CalendarEvent,
  sanitizeCalendarEvent,
  encodeRecurrence,
  decodeRecurrence,
  encodeExceptions,
  decodeExceptions,
  encodeAttendees,
  decodeAttendees,
} from "./calendar-event";
import {
  encodeAllocations,
  encodeDisciplineAllocations,
  encodePeriodMap,
  sanitizeChangeItem,
  sanitizeStakeholder,
  encodeRaciMap,
  decodeRaciMap,
  serializeDependencies,
  fkIdOrUndefined,
} from "./sanitize";
import {
  type Absence,
  type BudgetBucket,
  type ChangeItem,
  type FxRates,
  type Milestone,
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

export const CSV_COLUMNS: Array<keyof Task> = [
  "id",
  "taskName",
  "assignee",
  "assigneeEmail",
  "startDate",
  "dueDate",
  "lastUpdateDate",
  "createdDate",
  "priority",
  "status",
  "blockers",
  "description",
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
  "knowledgeLinks",
  "outlookEventId",
  "noteLog",
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
  "ownerResourceId",
  "mitigation",
  "linkedTaskIds",
  "raisedDate",
  "targetDate",
  "closedDate",
  "localModifiedAt",
  "causedByRaidIds",
  "stakeholderIds",
  "knowledgeLinks",
  "outlookEventId",
  "inquiriesSent",
  "noteLog",
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
  "outlookEventId",
];

// Columns persisted for CalendarEvent items in CSV and Turso (single + tenant).
// Order matches the header row emitted by the encoder; the decoder reads by
// column name so reordering files by hand still works. `recurrence` /
// `exceptions` / `attendeeResourceIds` are JSON-in-cell (see calendar-event.ts).
export const EVENTS_CSV_COLUMNS: Array<keyof CalendarEvent> = [
  "id",
  "title",
  "startDate",
  "startTime",
  "durationMinutes",
  "location",
  "notes",
  "recurrence",
  "exceptions",
  "attendeeResourceIds",
  "sendInvitations",
  "localModifiedAt",
  "outlookEventId",
];

// DOCUMENT_ASSETS_CSV_COLUMNS / documentAssetFieldToString /
// buildDocumentAssetFromObj / documentAssetsToCsv moved to
// ./document-asset-codecs.ts when this file crossed the 800-line file-size
// ratchet — re-exported via the ./csv-codecs barrel, NOT from here (a
// re-export back into this file would create a core -> document-asset-codecs
// -> core cycle). A caller importing them directly from this file must
// switch to "./document-asset-codecs" or the "./csv-codecs" barrel.

// Columns persisted for Shift items in CSV and Markdown. Per-weekday hours
// are flattened into 7 columns (Sun..Sat) so spreadsheets can show them
// side-by-side. Order matches the header row emitted by the encoder.
export const SHIFTS_CSV_COLUMNS: readonly string[] = [
  "id",
  "assignee",
  "assigneeEmail",
  "resourceId",
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
  "emails", "isExternal",
] as const;
export const ROLES_CSV_COLUMNS = ["id", "disciplineId", "gradeId", "internalRate", "externalRate", "internalRateDay", "externalRateDay", "rateBasis", "localModifiedAt", "order"] as const;
export const REF_CSV_COLUMNS = ["id", "name", "localModifiedAt"] as const;

export const MILESTONES_CSV_COLUMNS: Array<keyof Milestone> = [
  "id", "name", "date", "description", "achievedDate", "linkedTaskIds", "localModifiedAt", "knowledgeLinks", "outlookEventId",
];

export const BUDGETS_CSV_COLUMNS = [
  "id", "name", "poNumber", "type", "currency", "fixedPriceAmount",
  "startDate", "endDate", "successorId", "status", "closedDate",
  "fxRateOverride", "allocations", "localModifiedAt", "order",
  "planningMode", "disciplineAllocations", "rateOverrideInternal", "rateOverrideExternal",
  "taskIds", "percentComplete",
] as const;

export function shiftFieldToString(s: Shift, col: string): string {
  switch (col) {
    case "id":
      return String(s.id);
    case "assignee":
      return s.assignee;
    case "assigneeEmail":
      return s.assigneeEmail ?? "";
    case "resourceId":
      return s.resourceId == null ? "" : String(s.resourceId);
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
  if (c === "knowledgeLinks") return encodeKnowledgeLinks(r.knowledgeLinks);
  if (c === "noteLog") return encodeNoteLog(r.noteLog);
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
    ownerResourceId: fkIdOrUndefined(obj.ownerResourceId),
    mitigation: obj.mitigation || undefined,
    linkedTaskIds: parseLinkedTaskIds(obj.linkedTaskIds),
    raisedDate: obj.raisedDate ?? "",
    targetDate: obj.targetDate || undefined,
    closedDate: obj.closedDate || undefined,
    localModifiedAt: obj.localModifiedAt || undefined,
    causedByRaidIds,
    stakeholderIds: parseLinkedTaskIds(obj.stakeholderIds),
    knowledgeLinks: decodeKnowledgeLinks(obj.knowledgeLinks ?? obj.documentLinks),
    outlookEventId: obj.outlookEventId || undefined,
    // Sparse: absent/0/negative -> undefined so legacy rows stay byte-identical.
    inquiriesSent: (() => {
      const n = Number(obj.inquiriesSent);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
    })(),
    noteLog: (() => {
      const nl = decodeNoteLog(obj.noteLog);
      return nl.length ? nl : undefined;
    })(),
  };
}

export function milestoneFieldToString(m: Milestone, c: keyof Milestone): string {
  if (c === "linkedTaskIds") return Array.isArray(m.linkedTaskIds) ? m.linkedTaskIds.join("|") : "";
  if (c === "knowledgeLinks") return encodeKnowledgeLinks(m.knowledgeLinks);
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
  const dl = decodeKnowledgeLinks(obj.knowledgeLinks ?? obj.documentLinks); if (dl.length) m.knowledgeLinks = dl;
  if (obj.outlookEventId) m.outlookEventId = obj.outlookEventId;
  return m;
}

export const CHANGES_CSV_COLUMNS: Array<keyof ChangeItem> = [
  "id", "title", "description", "type", "status", "impact", "impactDescription", "scheduleImpactDays",
  "costImpact", "requestedBy", "raisedDate", "decisionBy", "decisionDate", "resolutionNotes",
  "linkedTaskIds", "linkedRaidIds", "stakeholderIds", "localModifiedAt", "knowledgeLinks", "outlookEventId",
  "noteLog",
];

export function changeFieldToString(c: ChangeItem, col: keyof ChangeItem): string {
  if (col === "linkedTaskIds") return Array.isArray(c.linkedTaskIds) ? c.linkedTaskIds.join("|") : "";
  if (col === "linkedRaidIds") return Array.isArray(c.linkedRaidIds) ? c.linkedRaidIds.join("|") : "";
  if (col === "stakeholderIds") return Array.isArray(c.stakeholderIds) ? c.stakeholderIds.join("|") : "";
  if (col === "knowledgeLinks") return encodeKnowledgeLinks(c.knowledgeLinks);
  if (col === "noteLog") return encodeNoteLog(c.noteLog);
  const v = c[col];
  return v === undefined || v === null ? "" : String(v);
}

export function buildChangeFromObj(obj: Record<string, string>): ChangeItem | null {
  const item = sanitizeChangeItem({
    ...obj,
    id: obj.id ? Number(obj.id) : undefined,
    scheduleImpactDays: obj.scheduleImpactDays ? Number(obj.scheduleImpactDays) : undefined,
    costImpact: obj.costImpact ? Number(obj.costImpact) : undefined,
    linkedTaskIds: parseLinkedTaskIds(obj.linkedTaskIds),
    linkedRaidIds: parseLinkedTaskIds(obj.linkedRaidIds),
    stakeholderIds: parseLinkedTaskIds(obj.stakeholderIds),
    knowledgeLinks: decodeKnowledgeLinks(obj.knowledgeLinks ?? obj.documentLinks),
  });
  // sanitizeChangeItem drops noteLog (it is DOM-free and cannot run
  // sanitizeNoteLog), so re-attach it here. decodeNoteLog has ALREADY
  // sanitized the entries, which is what makes re-attaching safe.
  return item === null ? null : withStoredNoteLog(item, decodeNoteLog(obj.noteLog));
}

export const STAKEHOLDERS_CSV_COLUMNS: Array<keyof Stakeholder> = [
  "id", "name", "organization", "title", "email", "category",
  "influence", "interest", "notes", "resourceId", "raci", "localModifiedAt", "knowledgeLinks",
];

export function stakeholderFieldToString(s: Stakeholder, col: keyof Stakeholder): string {
  if (col === "raci") return encodeRaciMap(s.raci);
  if (col === "resourceId") return s.resourceId == null ? "" : String(s.resourceId);
  if (col === "knowledgeLinks") return encodeKnowledgeLinks(s.knowledgeLinks);
  const v = s[col];
  return v === undefined || v === null ? "" : String(v);
}

export function buildStakeholderFromObj(obj: Record<string, string>): Stakeholder | null {
  return sanitizeStakeholder({
    ...obj,
    id: obj.id ? Number(obj.id) : undefined,
    resourceId: obj.resourceId ? Number(obj.resourceId) : null,
    raci: decodeRaciMap(obj.raci),
    knowledgeLinks: decodeKnowledgeLinks(obj.knowledgeLinks ?? obj.documentLinks),
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
export function csvCellEscape(value: string, neutralize: boolean): string {
  return csvEscape(neutralize ? neutralizeCsvFormula(value) : value);
}

export function fieldToString(t: Task, c: keyof Task): string {
  if (c === "labels") return Array.isArray(t.labels) ? t.labels.join("|") : "";
  if (c === "dependencies") return serializeDependencies(t.dependencies);
  if (c === "knowledgeLinks") return encodeKnowledgeLinks(t.knowledgeLinks);
  if (c === "noteLog") return encodeNoteLog(t.noteLog);
  return String(t[c] ?? "");
}

export function tasksToCsv(tasks: readonly Task[], neutralize = false): string {
  const header = CSV_COLUMNS.join(",");
  const lines: string[] = [header];
  for (const t of tasks) {
    lines.push(CSV_COLUMNS.map((c) => csvCellEscape(fieldToString(t, c), neutralize)).join(","));
  }
  return lines.join("\r\n");
}

export function raidToCsv(raid: readonly RaidItem[], neutralize = false): string {
  const lines: string[] = [RAID_CSV_COLUMNS.join(",")];
  for (const r of raid) {
    lines.push(
      RAID_CSV_COLUMNS.map((c) => csvCellEscape(raidFieldToString(r, c), neutralize)).join(","),
    );
  }
  return lines.join("\r\n");
}

export function milestonesToCsv(milestones: readonly Milestone[], neutralize = false): string {
  const lines: string[] = [MILESTONES_CSV_COLUMNS.join(",")];
  for (const m of milestones) {
    lines.push(
      MILESTONES_CSV_COLUMNS.map((c) => csvCellEscape(milestoneFieldToString(m, c), neutralize)).join(","),
    );
  }
  return lines.join("\r\n");
}

export function changesToCsv(changes: readonly ChangeItem[], neutralize = false): string {
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

export function absencesToCsv(absences: readonly Absence[], neutralize = false): string {
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

export function calendarEventFieldToString(e: CalendarEvent, col: string): string {
  switch (col) {
    case "recurrence":
      return encodeRecurrence(e.recurrence);
    case "exceptions":
      return encodeExceptions(e.exceptions);
    case "attendeeResourceIds":
      return encodeAttendees(e.attendeeResourceIds);
    case "sendInvitations":
      return e.sendInvitations ? "true" : "";
    default: {
      const v = (e as unknown as Record<string, unknown>)[col];
      return v == null ? "" : String(v);
    }
  }
}

/**
 * Builds a CalendarEvent from a header→value object produced by the CSV / MD
 * parsers. Runs the three JSON-in-cell decoders on the matching columns, then
 * defers to `sanitizeCalendarEvent` for everything else — mirrors
 * `buildChangeFromObj`/`buildStakeholderFromObj`. Shared by both the CSV and
 * Markdown decoders, so a fix here (or in the sanitizer it calls) covers both
 * formats at once.
 *
 * Every scalar column — including `localModifiedAt`/`outlookEventId`/
 * `location`/`notes` — round-trips an unset value as a raw `""` cell, and
 * `sanitizeCalendarEvent` normalizes each of those empty->undefined on its
 * own (`sanitizeText(...) || undefined`), so nothing needs pre-normalizing
 * here. (This function used to also strip `localModifiedAt` before handing
 * it off, working around a since-fixed gap in the sanitizer's own arm for
 * that field — removed once the fix landed there, to keep one mechanism.)
 */
export function buildCalendarEventFromObj(obj: Record<string, string>): CalendarEvent | null {
  return sanitizeCalendarEvent({
    ...obj,
    recurrence: decodeRecurrence(obj.recurrence ?? ""),
    exceptions: decodeExceptions(obj.exceptions ?? ""),
    attendeeResourceIds: decodeAttendees(obj.attendeeResourceIds ?? ""),
    sendInvitations: obj.sendInvitations === "true",
  });
}

export function calendarEventsToCsv(events: readonly CalendarEvent[], neutralize = false): string {
  const lines: string[] = [EVENTS_CSV_COLUMNS.join(",")];
  for (const e of events) {
    lines.push(
      EVENTS_CSV_COLUMNS.map((c) =>
        csvCellEscape(calendarEventFieldToString(e, c), neutralize),
      ).join(","),
    );
  }
  return lines.join("\r\n");
}

export function shiftsToCsv(shifts: readonly Shift[], neutralize = false): string {
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
    case "emails": return (r.emails ?? []).join("; ");
    case "isExternal": return r.isExternal === true ? "true" : "";
    default: return "";
  }
}

function rowsToCsv(header: readonly string[], rows: string[][], neutralize = false): string {
  return [header.join(","), ...rows.map((r) => r.map((v) => csvCellEscape(v, neutralize)).join(","))].join("\r\n");
}

export function resourcesToCsv(rs: readonly Resource[], neutralize = false): string {
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
    case "taskIds": return Array.isArray(b.taskIds) ? b.taskIds.join(";") : "";
    case "percentComplete": return b.percentComplete == null ? "" : String(b.percentComplete);
    default: return "";
  }
}

export function budgetsToCsv(bs: readonly BudgetBucket[], neutralize = false): string {
  return rowsToCsv(BUDGETS_CSV_COLUMNS, bs.map((b) => BUDGETS_CSV_COLUMNS.map((c) => budgetFieldToString(b, c))), neutralize);
}

export function encodeRatesMap(rates: Record<string, number>): string {
  return Object.entries(rates).filter(([, v]) => Number.isFinite(v)).map(([k, v]) => `${k}=${v}`).join("|");
}

export function fxRatesToCsvLine(fx: FxRates): string {
  return [CSV_SECTION_FXRATES, [fx.base, fx.date, fx.fetchedAt, encodeRatesMap(fx.rates)].map(csvEscape).join(",")].join("\r\n");
}

export function rolesToCsv(rs: readonly Role[], neutralize = false): string {
  return rowsToCsv(
    ROLES_CSV_COLUMNS,
    rs.map((r) => ROLES_CSV_COLUMNS.map((c) => String((r as Record<string, unknown>)[c] ?? ""))),
    neutralize,
  );
}

export function refsToCsv(rs: readonly { id: number; name: string; localModifiedAt?: string }[]): string {
  return rowsToCsv(REF_CSV_COLUMNS, rs.map((r) => [String(r.id), r.name, r.localModifiedAt ?? ""]));
}

export function planToCsvLine(p: ResourcePlan): string {
  const cells = [p.startDate, p.endDate, p.granularity, p.currency];
  if (p.budgetFollowsPlan) cells.push("true");
  return [CSV_SECTION_PLAN, cells.map(csvEscape).join(",")].join("\r\n");
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let buf = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const step = quoteStep(text, i, inQuotes);
    if (step) {
      // A doubled quote inside quotes is the only case that CONTRIBUTES a
      // character; opening and closing contribute nothing to the cell.
      if (inQuotes && step.inQuotes) buf += '"';
      inQuotes = step.inQuotes;
      i = step.next;
      continue;
    }
    if (inQuotes) {
      buf += c;
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
  if (buf.length > 0 || row.length > 0) {
    row.push(buf);
    rows.push(row);
  }
  return rows;
}
