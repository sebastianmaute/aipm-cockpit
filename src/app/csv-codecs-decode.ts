// src/app/csv-codecs-decode.ts
//
// CSV codec DECODE layer: the `parseCsv`-backed section splitter, row→object
// helpers, per-entity decoders (csvToTasks / csvToRaid / …) and the
// `csvToWorkspace` assembler. Depends on ./csv-codecs-core (primitives +
// build*FromObj) and ./csv-codecs-config (config/project decoders).
// Re-exported via the ./csv-codecs barrel.

import { decodeDocumentLinks } from "./document-link";
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
  type ChangeItem,
  type Discipline,
  type FxRates,
  type Grade,
  type Milestone,
  type Priority,
  type RaidItem,
  type Resource,
  type ResourcePlan,
  type Role,
  type Shift,
  type Stakeholder,
  type Task,
} from "./types";
import { type Workspace, migrateWorkspaceV9 } from "./workspace";
import { migrateTaskStatus } from "./task-status";
import {
  CSV_SECTION_ABSENCES,
  CSV_SECTION_BUDGETS,
  CSV_SECTION_CHANGES,
  CSV_SECTION_DISCIPLINES,
  CSV_SECTION_FIELD_VIS,
  CSV_SECTION_FUNCTIONS,
  CSV_SECTION_FXRATES,
  CSV_SECTION_GRADES,
  CSV_SECTION_MILESTONES,
  CSV_SECTION_PLAN,
  CSV_SECTION_PROJECT,
  CSV_SECTION_RAID,
  CSV_SECTION_RESOURCES,
  CSV_SECTION_ROLES,
  CSV_SECTION_SHIFTS,
  CSV_SECTION_STAKEHOLDERS,
  CSV_SECTION_STATUS,
  CSV_SECTION_STEERING,
  CSV_SECTION_TASKS,
  CSV_SECTION_TIMELOG_LINKS,
  buildChangeFromObj,
  buildMilestoneFromObj,
  buildRaidItemFromObj,
  buildStakeholderFromObj,
  parseCsv,
  parseHealthOverride,
} from "./csv-codecs-core";
import {
  csvToFeatures,
  csvToFieldVisibility,
  csvToProject,
  csvToStatus,
  csvToSteeringCommittee,
  csvToTimelogLinks,
} from "./csv-codecs-config";


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
  fieldVisText: string;
  functionsText: string;
  steeringText: string;
  timelogLinksText: string;
} {
  const lines = csv.split(/\r?\n/);
  let mode: "tasks" | "raid" | "absences" | "shifts" | "resources" | "roles" | "disciplines" | "grades" | "plan" | "budgets" | "fxrates" | "status" | "milestones" | "changes" | "stakeholders" | "project" | "fieldVis" | "functions" | "steering" | "timelogLinks" | null = null;
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
  const fieldVisLines: string[] = [];
  const functionsLines: string[] = [];
  const steeringLines: string[] = [];
  const timelogLinksLines: string[] = [];
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
    if (trimmed.startsWith(CSV_SECTION_FIELD_VIS)) { mode = "fieldVis"; continue; }
    if (trimmed.startsWith(CSV_SECTION_FUNCTIONS)) { mode = "functions"; continue; }
    if (trimmed.startsWith(CSV_SECTION_STEERING)) { mode = "steering"; continue; }
    if (trimmed.startsWith(CSV_SECTION_TIMELOG_LINKS)) { mode = "timelogLinks"; continue; }
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
    else if (mode === "fieldVis") fieldVisLines.push(line);
    else if (mode === "functions") functionsLines.push(line);
    else if (mode === "steering") steeringLines.push(line);
    else if (mode === "timelogLinks") timelogLinksLines.push(line);
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
    fieldVisText: fieldVisLines.join("\r\n"),
    functionsText: functionsLines.join("\r\n"),
    steeringText: steeringLines.join("\r\n"),
    timelogLinksText: timelogLinksLines.join("\r\n"),
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

/**
 * Decode a section-marked CSV block into entities: skip blank/comment lines to
 * the header row, then map each data row (header-keyed) through `build`,
 * dropping rows `build` rejects (returns null). Shared by the per-entity section
 * decoders that follow this exact shape. `csvToTasks` diverges (extra handling)
 * and keeps its own loop.
 */
function decodeCsvSection<T>(
  csv: string,
  build: (obj: Record<string, string>) => T | null,
): T[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];
  // Find the header row — skip blank/comment lines that survived the section split.
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length > 0 && rows[i][0].trim() !== "" && !rows[i][0].startsWith("#")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return [];
  const headers = rows[headerIdx];
  const items: T[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 1 && row[0] === "") continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] ?? "";
    });
    const item = build(obj);
    if (item) items.push(item);
  }
  return items;
}

function csvToAbsences(csv: string): Absence[] {
  return decodeCsvSection(csv, sanitizeAbsence);
}

function csvToShifts(csv: string): Shift[] {
  return decodeCsvSection(csv, sanitizeShift);
}

function csvToMilestones(csv: string): Milestone[] {
  return decodeCsvSection(csv, buildMilestoneFromObj);
}

function csvToChanges(csv: string): ChangeItem[] {
  return decodeCsvSection(csv, buildChangeFromObj);
}

export function csvToStakeholders(csv: string): Stakeholder[] {
  return decodeCsvSection(csv, buildStakeholderFromObj);
}

function csvToRaid(csv: string): RaidItem[] {
  return decodeCsvSection(csv, buildRaidItemFromObj);
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
  if (s.fieldVisText.trim()) {
    const fv = csvToFieldVisibility(s.fieldVisText);
    if (fv) ws.fieldVisibility = fv;
  }
  if (s.functionsText.trim()) {
    const f = csvToFeatures(s.functionsText);
    if (f !== undefined) ws.features = f;
  }
  if (s.steeringText.trim()) {
    const sc = csvToSteeringCommittee(s.steeringText);
    if (sc) ws.steeringCommittee = sc;
  }
  if (s.timelogLinksText.trim()) {
    const tl = csvToTimelogLinks(s.timelogLinksText);
    if (tl) ws.timelogLinks = tl;
  }
  return migrateWorkspaceV9(ws);
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
  return migrateTaskStatus({
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
  });
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
