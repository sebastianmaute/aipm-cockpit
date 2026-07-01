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
import { buildRaidItemFromObj, decodeRatesMap, parseHealthOverride } from "./csv-codecs";
import {
  markdownTableToObjects,
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
    else if (norm === "resourceid") colMap[idx] = "resourceId";
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
    else if (norm === "ownerresourceid") colMap[idx] = "ownerResourceId";
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
    else if (norm === "outlookeventid") colMap[idx] = "outlookEventId";
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
    if (!Number.isFinite(id) || id <= 0) continue;
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
