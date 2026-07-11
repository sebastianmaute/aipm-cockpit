// src/app/markdown-codecs-decode.ts
//
// Markdown codec DECODE layer: splitMarkdownSections + the per-entity table
// decoders that the workspace round-trip needs, and the markdownToWorkspace
// assembler. Depends on ./markdown-codecs-core (row primitives, mdUnescape,
// config/project decoders) and the build*FromObj decoders from ./csv-codecs.
// Re-exported via the ./markdown-codecs barrel.

import { decodeDocumentLinks } from "./document-link";
import { migrateTaskStatus } from "./task-status";
import { defaultResourcePlan } from "./resource-foundation";
import {
  dropDanglingDependencies,
  parseDependenciesString,
  sanitizeAbsence,
  sanitizeBudgetBucket,
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
  fkIdOrUndefined,
} from "./sanitize";
import {
  type Absence,
  type BudgetBucket,
  type Discipline,
  type FxRates,
  type Grade,
  type Priority,
  type RaidItem,
  type Resource,
  type ResourcePlan,
  type Role,
  type Shift,
  type Task,
} from "./types";
import { type Workspace, migrateWorkspaceV9 } from "./workspace";
import { type ImportDiag, buildRaidItemFromObj, decodeRatesMap, parseHealthOverride } from "./csv-codecs";
import {
  decodeMdTable,
  markdownToChanges,
  markdownToFeatures,
  markdownToFieldVisibility,
  markdownToMilestones,
  markdownToProject,
  markdownToStakeholders,
  markdownToStatus,
  markdownToSteeringCommittee,
  markdownToTimelogLinks,
  mdUnescape,
  splitMdRow,
} from "./markdown-codecs-core";

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

const ABSENCE_ALIASES: Record<string, string> = {
  id: "id", assignee: "assignee", email: "assigneeEmail", assigneeemail: "assigneeEmail",
  start: "startDate", startdate: "startDate", end: "endDate", enddate: "endDate",
  type: "type", note: "note",
  localmodified: "localModifiedAt", localmodifiedat: "localModifiedAt",
  outlookeventid: "outlookEventId",
};

function markdownToAbsences(md: string, diag?: ImportDiag): Absence[] {
  return decodeMdTable(md, ABSENCE_ALIASES, sanitizeAbsence, diag);
}

const SHIFT_ALIASES: Record<string, string> = {
  id: "id", assignee: "assignee", email: "assigneeEmail", assigneeemail: "assigneeEmail",
  resourceid: "resourceId",
  sun: "sunHours", sunhours: "sunHours", mon: "monHours", monhours: "monHours",
  tue: "tueHours", tuehours: "tueHours", wed: "wedHours", wedhours: "wedHours",
  thu: "thuHours", thuhours: "thuHours", fri: "friHours", frihours: "friHours",
  sat: "satHours", sathours: "satHours", note: "note",
  localmodified: "localModifiedAt", localmodifiedat: "localModifiedAt",
};

function markdownToShifts(md: string, diag?: ImportDiag): Shift[] {
  return decodeMdTable(md, SHIFT_ALIASES, sanitizeShift, diag);
}



/** Map MD column labels to sanitizer field keys for resources. */
const RESOURCE_ALIASES: Record<string, string> = {
  id: "id", first: "firstName", firstname: "firstName", last: "lastName", lastname: "lastName",
  name: "name", // legacy single-name files
  title: "title", phone: "businessPhone", businessphone: "businessPhone",
  location: "location", department: "department", email: "email", company: "company",
  birthday: "birthday", notes: "notes", roleid: "roleId",
  mode: "utilizationMode", utilizationmode: "utilizationMode", utilization: "utilization",
  absenceoverride: "absenceOverride", active: "active",
  emails: "emails", external: "isExternal", isexternal: "isExternal",
  localmodified: "localModifiedAt", localmodifiedat: "localModifiedAt",
};

function markdownToResources(md: string, diag?: ImportDiag): Resource[] {
  return decodeMdTable(md, RESOURCE_ALIASES, sanitizeResource, diag);
}

/** Map MD column labels to sanitizer field keys for roles. */
const ROLE_ALIASES: Record<string, string> = {
  id: "id", disciplineid: "disciplineId", gradeid: "gradeId",
  internalrate: "internalRate", externalrate: "externalRate",
  internalrateday: "internalRateDay", externalrateday: "externalRateDay",
  ratebasis: "rateBasis",
  order: "order",
  localmodified: "localModifiedAt", localmodifiedat: "localModifiedAt",
};

function markdownToRoles(md: string, diag?: ImportDiag): Role[] {
  return decodeMdTable(md, ROLE_ALIASES, sanitizeRole, diag);
}

const BUDGET_ALIASES: Record<string, string> = {
  id: "id", name: "name", po: "poNumber", ponumber: "poNumber", type: "type",
  currency: "currency", fixedprice: "fixedPriceAmount", fixedpriceamount: "fixedPriceAmount",
  start: "startDate", startdate: "startDate", end: "endDate", enddate: "endDate",
  successorid: "successorId", status: "status",
  closed: "closedDate", closeddate: "closedDate",
  fxoverride: "fxRateOverride", fxrateoverride: "fxRateOverride",
  allocations: "allocations",
  localmodified: "localModifiedAt", localmodifiedat: "localModifiedAt",
  order: "order", planningmode: "planningMode",
  disciplineallocations: "disciplineAllocations",
  rateoverrideinternal: "rateOverrideInternal", rateoverrideexternal: "rateOverrideExternal",
};

function markdownToBudgets(md: string, diag?: ImportDiag): BudgetBucket[] {
  return decodeMdTable(md, BUDGET_ALIASES, sanitizeBudgetBucket, diag);
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
const REF_ALIASES: Record<string, string> = {
  id: "id", name: "name",
  localmodified: "localModifiedAt", localmodifiedat: "localModifiedAt",
};

function markdownToRefs<T extends Discipline | Grade>(
  md: string,
  sanitize: (input: unknown) => T | null,
  diag?: ImportDiag,
): T[] {
  return decodeMdTable(md, REF_ALIASES, sanitize, diag);
}

function parsePlanMarkdown(md: string): ResourcePlan | null {
  for (const line of md.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("|")) continue;
    const cells = t.split(",").map((s) => s.trim());
    if (cells.length < 4) continue;
    const today = new Date().toISOString().slice(0, 10);
    return sanitizePlan({ startDate: cells[0], endDate: cells[1], granularity: cells[2], currency: cells[3], budgetFollowsPlan: cells[4] }, today);
  }
  return null;
}

const RAID_ALIASES: Record<string, string> = {
  id: "id", category: "category", title: "title", description: "description",
  severity: "severity", probability: "probability", impact: "impact", status: "status",
  owner: "owner", owneremail: "ownerEmail", ownerresourceid: "ownerResourceId",
  mitigation: "mitigation",
  linkedtasks: "linkedTaskIds", linkedtaskids: "linkedTaskIds",
  raised: "raisedDate", raiseddate: "raisedDate",
  target: "targetDate", targetdate: "targetDate",
  closed: "closedDate", closeddate: "closedDate",
  localmodified: "localModifiedAt", localmodifiedat: "localModifiedAt",
  causedbyids: "causedByRaidIds", causedbyraidids: "causedByRaidIds",
  causedby: "causedByRaidIds", causedbyraidid: "causedByRaidIds",
  stakeholderids: "stakeholderIds", stakeholders: "stakeholderIds",
  documentlinks: "documentLinks", outlookeventid: "outlookEventId",
};

function markdownToRaid(md: string, diag?: ImportDiag): RaidItem[] {
  return decodeMdTable(md, RAID_ALIASES, buildRaidItemFromObj, diag);
}

/** Parses all sections out of a (possibly multi-section) markdown string. Pass
 *  an optional {@link ImportDiag} to count rows rejected as malformed. */
export function markdownToWorkspace(md: string, diag?: ImportDiag): Workspace {
  const s = splitMarkdownSections(md);
  const ws: Workspace = {
    tasks: markdownToTasks(s.tasksMd || md, diag),
    raid: s.raidMd.trim() ? markdownToRaid(s.raidMd, diag) : [],
    absences: s.absencesMd.trim() ? markdownToAbsences(s.absencesMd, diag) : [],
    shifts: s.shiftsMd.trim() ? markdownToShifts(s.shiftsMd, diag) : [],
    resources: s.resourcesMd.trim() ? markdownToResources(s.resourcesMd, diag) : [],
    roles: s.rolesMd.trim() ? markdownToRoles(s.rolesMd, diag) : [],
    disciplines: s.disciplinesMd.trim() ? markdownToRefs(s.disciplinesMd, sanitizeDiscipline, diag) : [],
    grades: s.gradesMd.trim() ? markdownToRefs(s.gradesMd, sanitizeGrade, diag) : [],
    plan: (s.planMd.trim() && parsePlanMarkdown(s.planMd)) || defaultResourcePlan(new Date().toISOString().slice(0, 10)),
    budgets: s.budgetsMd.trim() ? markdownToBudgets(s.budgetsMd, diag) : [],
    fxRates: s.fxRatesMd.trim() ? parseFxRatesMarkdown(s.fxRatesMd) : null,
    status: s.statusMd.trim() ? markdownToStatus(s.statusMd) : {},
    milestones: s.milestonesMd.trim() ? markdownToMilestones(s.milestonesMd, diag) : [],
    changes: s.changesMd.trim() ? markdownToChanges(s.changesMd, diag) : [],
    stakeholders: s.stakeholdersMd.trim() ? markdownToStakeholders(s.stakeholdersMd, diag) : [],
  };
  const project = s.projectMd.trim() ? markdownToProject(s.projectMd) : null;
  if (project) ws.project = project;
  const fv = markdownToFieldVisibility(md);
  if (fv) ws.fieldVisibility = fv;
  const fns = markdownToFeatures(md);
  if (fns !== undefined) ws.features = fns;
  const sc = markdownToSteeringCommittee(md);
  if (sc) ws.steeringCommittee = sc;
  const tl = markdownToTimelogLinks(md);
  if (tl) ws.timelogLinks = tl;
  return migrateWorkspaceV9(ws);
}

function markdownToTasks(md: string, diag?: ImportDiag): Task[] {
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
    else if (norm === "status") colMap[idx] = "status";
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
    else if (norm === "outlookeventid") colMap[idx] = "outlookEventId";
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
    if (!Number.isFinite(id) || id <= 0) {
      if (diag) diag.droppedRows++;
      continue;
    }
    const inq = Number(obj.inquiriesSent);
    tasks.push(migrateTaskStatus({
      id,
      taskName: obj.taskName ?? "",
      assignee: obj.assignee ?? "",
      assigneeEmail: obj.assigneeEmail ?? "",
      startDate: obj.startDate || undefined,
      dueDate: obj.dueDate ?? "",
      lastUpdateDate: obj.lastUpdateDate ?? "",
      priority: ((obj.priority as Priority) || "Medium") as Priority,
      status: obj.status as Task["status"],
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
      outlookEventId: obj.outlookEventId || undefined,
      healthOverride: parseHealthOverride(obj.healthOverride),
      resourceId: fkIdOrUndefined(obj.resourceId),
      originalEstimateMinutes: sanitizeOptionalMinutes(obj.originalEstimateMinutes),
      timeSpentMinutes: sanitizeOptionalMinutes(obj.timeSpentMinutes),
      documentLinks: decodeDocumentLinks(obj.documentLinks),
    }));
  }
  return dropDanglingDependencies(tasks);
}
