import { SharePointBackend } from "./sharepoint-backend";
import { TursoBackend } from "./turso-backend";
import type { TursoConfig } from "./turso-config";
import { decodeDocumentLinks } from "./document-link";
import { defaultResourcePlan } from "./resource-foundation";
import { dropDanglingDependencies, parseDependenciesString, sanitizeAbsence, sanitizeBudgetBucket, sanitizeDiscipline, sanitizeFxRates, sanitizeGrade, sanitizeGroup, sanitizeLabels, sanitizeOptionalMinutes, sanitizePlan, sanitizeResource, sanitizeRole, sanitizeShift, sanitizeProjectMeta } from "./sanitize";
import { type Absence, type BudgetBucket, type ChangeItem, type Discipline, type FxRates, type Grade, type Milestone, type Priority, type ProjectMeta, type ProjectStatus, type RaidItem, type Resource, type ResourcePlan, type Role, type Shift, type Stakeholder, type Task } from "./types";
import type { ExportConfig } from "./settings-types";
import { EXPORT_SECTION_KEYS } from "./settings-types";
import { type Workspace, emptyWorkspace, migrateWorkspaceV8, type LocalKind, type StorageConfig, StorageNotReadyError, type StorageBackend, workspaceToJson, sanitizeProjectStatus, jsonToWorkspace } from "./workspace"; // facade-internal
import { IDB_TASKS_STORE, IDB_RAID_STORE, IDB_ABSENCES_STORE, IDB_SHIFTS_STORE, IDB_RESOURCES_STORE, IDB_ROLES_STORE, IDB_DISCIPLINES_STORE, IDB_GRADES_STORE, KV_PLAN_KEY, IDB_BUDGETS_STORE, KV_FXRATES_KEY, KV_STATUS_KEY, KV_MILESTONES_KEY, KV_CHANGES_KEY, KV_STAKEHOLDERS_KEY, KV_PROJECT_KEY, idbGet, idbSet, idbDelete, idbGetAll, idbBulkUpdate } from "./idb"; // facade-internal
import { type FilePickType, type FsHandle, pickSaveFile, pickOpenFile, hasGrantedPermission, tryGrantPermission, readHandle, writeHandle } from "./fs-access"; // facade-internal
import { parseHealthOverride, shiftFieldToString, raidFieldToString, buildRaidItemFromObj, milestoneFieldToString, buildMilestoneFromObj, changeFieldToString, buildChangeFromObj, stakeholderFieldToString, buildStakeholderFromObj, fieldToString, absenceFieldToString, resourceFieldToString, budgetFieldToString, encodeRatesMap, STATUS_FIELDS, PROJECT_CSV_COLUMNS, projectFieldToString, buildProjectFromObj, workspaceToCsv, decodeRatesMap, csvToWorkspace } from "./csv-codecs"; // facade-internal

export * from "./workspace";
export * from "./fs-access";
export * from "./csv-codecs";

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


// --- CSV serialization -----------------------------------------------------


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
  { key: "documentLinks", label: "DocumentLinks" },
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
      else if (norm === "documentlinks") mapped["documentLinks"] = val;
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
  { key: "documentLinks", label: "DocumentLinks" },
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
      else if (norm === "documentlinks") mapped["documentLinks"] = val;
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
   *  createBackend returns a per-project (tenant-mode) TursoBackend (Phase 2
   *  multi-tenant portfolio mode). Otherwise single-tenant mode is used. */
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
        return new TursoBackend(deps.tursoConfig ?? null, tursoProjectId);
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

