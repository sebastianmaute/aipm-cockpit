// src/app/markdown-codecs-core.ts
//
// Markdown codec CORE: *_MD_COLUMNS registries, mdEscape/mdUnescape, the
// per-entity table encoders, the config/project markdown codecs, the three
// self-contained table decoders (milestones/changes/stakeholders), the
// workspaceToMarkdown encoder assembler, and the shared row primitives
// (splitMdRow, markdownTableToObjects). Leaf — no imports from the decode
// sibling. Re-exported via the ./markdown-codecs barrel.

import { sanitizeFieldVisibility, type FieldVisibilityConfig } from "./field-visibility";
import { sanitizeFeatures, type FeatureModuleId } from "./feature-modules";
import { sanitizeSteeringCommittee } from "./sanitize";
import { sanitizeTimelogLinks } from "./timelog-sanitize";
import type { TimelogLinks } from "./timelog-types";
import {
  type Absence,
  type BudgetBucket,
  type ChangeItem,
  type FxRates,
  type Milestone,
  type ProjectMeta,
  type ProjectStatus,
  type RaidItem,
  type Resource,
  type ResourcePlan,
  type Role,
  type Shift,
  type Stakeholder,
  type SteeringCommittee,
  type Task,
} from "./types";
import type { ExportConfig } from "./settings-types";
import { EXPORT_SECTION_KEYS } from "./settings-types";
import { type Workspace, sanitizeProjectStatus } from "./workspace";
import {
  PROJECT_CSV_COLUMNS,
  STATUS_FIELDS,
  absenceFieldToString,
  budgetFieldToString,
  buildChangeFromObj,
  buildMilestoneFromObj,
  buildProjectFromObj,
  buildStakeholderFromObj,
  changeFieldToString,
  encodeRatesMap,
  fieldToString,
  milestoneFieldToString,
  projectFieldToString,
  raidFieldToString,
  resourceFieldToString,
  shiftFieldToString,
  stakeholderFieldToString,
} from "./csv-codecs";

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
  { key: "ownerResourceId", label: "OwnerResourceId" },
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
  { col: "resourceId", label: "ResourceId" },
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


/** Serializes the per-project field-visibility config as JSON inside a fenced
 *  block under "## Field Visibility" (JSON sidesteps Markdown table escaping). */
export function fieldVisibilityToMarkdown(cfg: FieldVisibilityConfig): string {
  return ["## Field Visibility", "", "```json", JSON.stringify(cfg, null, 2), "```", ""].join("\n");
}

export function markdownToFieldVisibility(md: string): FieldVisibilityConfig | undefined {
  const m = /## Field Visibility\s*\n+```json\s*\n([\s\S]*?)\n```/.exec(md);
  if (!m) return undefined;
  try {
    return sanitizeFieldVisibility(JSON.parse(m[1]));
  } catch {
    return undefined;
  }
}

/** Serializes the per-project feature list as JSON inside a fenced
 *  block under "## Functions" (presence-gated: explicit [] still emits). */
export function featuresToMarkdown(features: readonly FeatureModuleId[]): string {
  return ["## Functions", "", "```json", JSON.stringify(features, null, 2), "```", ""].join("\n");
}

export function markdownToFeatures(md: string): FeatureModuleId[] | undefined {
  const m = /## Functions\s*\n+```json\s*\n([\s\S]*?)\n```/.exec(md);
  if (!m) return undefined;
  try {
    return sanitizeFeatures(JSON.parse(m[1]));
  } catch {
    return undefined;
  }
}

/** Serializes the steering committee (nested object) as JSON inside a fenced
 *  block under "## Steering Committee" (JSON sidesteps Markdown table escaping;
 *  same approach as field-visibility/functions). Emitted only when present. */
export function steeringCommitteeToMarkdown(committee: SteeringCommittee): string {
  return ["## Steering Committee", "", "```json", JSON.stringify(committee, null, 2), "```", ""].join("\n");
}

export function markdownToSteeringCommittee(md: string): SteeringCommittee | undefined {
  const m = /## Steering Committee\s*\n+```json\s*\n([\s\S]*?)\n```/.exec(md);
  if (!m) return undefined;
  try {
    return sanitizeSteeringCommittee(JSON.parse(m[1]));
  } catch {
    return undefined;
  }
}

export function timelogLinksToMarkdown(links: TimelogLinks): string {
  return ["## Timelog Links", "", "```json", JSON.stringify(links, null, 2), "```", ""].join("\n");
}

export function markdownToTimelogLinks(md: string): TimelogLinks | undefined {
  const m = /## Timelog Links\s*\n+```json\s*\n([\s\S]*?)\n```/.exec(md);
  if (!m) return undefined;
  try {
    return sanitizeTimelogLinks(JSON.parse(m[1]));
  } catch {
    return undefined;
  }
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
  { key: "status", label: "Status" },
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
  { key: "outlookEventId", label: "OutlookEventId" },
];

function mdEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

export function mdUnescape(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\\|/g, "|")
    .replace(/\\\\/g, "\\");
}

function tasksToMarkdown(tasks: readonly Task[]): string {
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
  { key: "outlookEventId", label: "OutlookEventId" },
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

export function markdownToMilestones(md: string): Milestone[] {
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
      else if (norm === "outlookeventid") mapped["outlookEventId"] = val;
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

export function markdownToChanges(md: string): ChangeItem[] {
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

export function markdownToStakeholders(md: string): Stakeholder[] {
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
  // Field-visibility config — storage-only, emitted last so it never shifts
  // existing fixture bytes; absent/empty emits nothing (byte-stability).
  if (config === undefined && ws.fieldVisibility && Object.keys(ws.fieldVisibility).length > 0)
    mdParts.push(fieldVisibilityToMarkdown(ws.fieldVisibility));
  if (config === undefined && ws.features !== undefined)
    mdParts.push(featuresToMarkdown(ws.features));
  // Steering committee — storage-only, emitted last (byte-stability); absent
  // emits nothing so committee-less workspaces round-trip unchanged.
  if (config === undefined && ws.steeringCommittee)
    mdParts.push(steeringCommitteeToMarkdown(ws.steeringCommittee));
  // Timelog links — storage-only, same byte-stability gate as steering.
  if (config === undefined && ws.timelogLinks)
    mdParts.push(timelogLinksToMarkdown(ws.timelogLinks));
  const out = mdParts.join("\n");
  return out;
}


export function splitMdRow(line: string): string[] {
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

/** Generic MD table → array of string-keyed objects (label→value). */
export function markdownTableToObjects(md: string): Record<string, string>[] {
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
