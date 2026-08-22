// src/app/csv-codecs-decode.ts
//
// CSV codec DECODE layer: the `parseCsv`-backed section splitter, row→object
// helpers, per-entity decoders (csvToTasks / csvToRaid / …) and the
// `csvToWorkspace` assembler. Depends on ./csv-codecs-core (primitives +
// build*FromObj) and ./csv-codecs-config (config/project decoders).
// Re-exported via the ./csv-codecs barrel.

import { splitCsvLines } from "./csv-line-scan";
import { decodeKnowledgeLinks } from "./document-link";
import type { DocTruncationDiag } from "./document-model";
import { decodeNoteLog } from "./note-log";
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
import type { CalendarEvent } from "./calendar-event";
import type { DocumentAsset } from "./document-asset";
import { type Workspace, migrateWorkspaceV10 } from "./workspace";
import { migrateTask } from "./task-status";
import {
  CSV_SECTION_ABSENCES,
  CSV_SECTION_BUDGETS,
  CSV_SECTION_CALENDAR_EVENTS,
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
  CSV_SECTION_KNOWLEDGE_ITEMS,
  CSV_SECTION_INSIGHTS,
  CSV_SECTION_SETTINGS_OVERRIDES,
  CSV_SECTION_DOCUMENTS,
  CSV_SECTION_DOCUMENT_VERSIONS,
  CSV_SECTION_DOCUMENT_ASSETS,
  CSV_SECTION_ACTIVITY,
  buildCalendarEventFromObj,
  buildChangeFromObj,
  buildMilestoneFromObj,
  buildRaidItemFromObj,
  buildStakeholderFromObj,
  parseCsv,
  parseHealthOverride,
} from "./csv-codecs-core";
import { buildDocumentAssetFromObj } from "./document-asset-codecs";
import {
  csvToFeatures,
  csvToFieldVisibility,
  csvToProject,
  csvToStatus,
  csvToSteeringCommittee,
  csvToTimelogLinks,
  csvToKnowledgeItems,
  csvToInsights,
  csvToSettingsOverrides,
  csvToDocuments,
  csvToDocumentVersions,
  csvToActivityLog,
} from "./csv-codecs-config";


/**
 * Optional import diagnostics accumulator. Threaded (opt-in) through the CSV /
 * Markdown row-table decoders so a malformed row a `build*FromObj`/`sanitizeX`
 * rejects can be counted and surfaced to the user, instead of silently dropped.
 * Only rows a decoder actively REJECTS (returns null) are counted — blank rows,
 * dangling-dependency pruning, and config-blob decoders are not.
 *
 * ★ It also carries the DOCUMENT CAP counters via {@link DocTruncationDiag}.
 * Those are a different kind of loss from `droppedRows` — a rejected row was
 * malformed, whereas a capped document was perfectly valid and simply went
 * unread — but they travel the same path, so extending this interface lets the
 * accumulator every CSV/Markdown caller already builds carry both with no new
 * plumbing at those call sites. The import is TYPE-ONLY and therefore erased:
 * `document-model.ts` must gain no runtime dependency on a codec module (see
 * the import cycle recorded in open-followups §92), which is also why the
 * counters are DECLARED there and merely re-exposed here.
 */
export interface ImportDiag extends DocTruncationDiag {
  droppedRows: number;
  /** True when the document ended INSIDE a quoted cell. Our own encoder always
   *  balances quotes, so this can only fire on a hand-edited, truncated or
   *  foreign file — which is the remaining silent-loss vector now that §105's
   *  mid-row section switch is fixed. Rows there are ABSORBED into one giant
   *  cell rather than rejected, so `droppedRows` cannot see them. */
  unterminatedQuote?: boolean;
}

/**
 * Splits a marker-segmented CSV into its sections. A "marker" is a line whose
 * first cell starts with one of the known "# ..." section constants.
 */
function splitCsvSections(csv: string, diag?: ImportDiag): {
  tasksText: string;
  raidText: string;
  absencesText: string;
  calendarEventsText: string;
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
  knowledgeItemsText: string;
  insightsText: string;
  settingsOverridesText: string;
  documentsText: string;
  documentVersionsText: string;
  documentAssetsText: string;
  activityLogText: string;
} {
  // ★★★ QUOTE-AWARE, NOT `csv.split(/\r?\n/)`. A raw split breaks a quoted
  // cell across physical lines, and a continuation that begins with a section
  // marker then switched `mode` MID-ROW — silently destroying every later row
  // in the section (open-followups §105). Do not "simplify" this back.
  const scan = splitCsvLines(csv);
  if (diag) diag.unterminatedQuote = scan.unterminatedQuote;
  // ★★★ AND YET: ON AN UNBALANCED QUOTE WE DELIBERATELY FALL BACK TO THE OLD
  // PHYSICAL SPLIT FOR ROUTING. Quote state in a quote-aware scan carries across
  // the WHOLE FILE, where the physical split reset it at every line — so ONE
  // stray unclosed `"` in an EARLY section swallows every later section marker
  // into a single giant cell, and every following section decodes as absent
  // (measured: raid and milestones both dropped to 0 rows).
  //
  // An unbalanced quote is PROOF the file is malformed: `csvEscape`
  // (csv-codecs-core.ts) quotes a cell on `, " \n \r` and DOUBLES every `"`, so
  // our own encoder cannot emit one. It can only fire on a hand-edited,
  // truncated or foreign file.
  //
  // ★★★ MALFORMED DOES NOT IMPLY CONTAINED, AND THIS COMMENT USED TO CLAIM IT
  // DID. Two sentences stood here — that the physical split's containment is
  // "strictly better", and that this branch "CANNOT REGRESS §105" because a
  // well-formed file never reaches it. BOTH ARE FALSE. §105's damage is a
  // property of a CELL (a marker-shaped continuation inside a properly CLOSED
  // quoted cell), not of the FILE, so one unrelated stray quote ANYWHERE flips
  // this flag and re-enables §105 for EVERY such cell in the document. This is a
  // TRADE-OFF and neither branch dominates.
  //
  // Measured on one fixture — 3 tasks where task 2's `taskName` is
  // `"T2\n# RAID\nstill T2"`, plus 1 milestone — with a stray `"` injected:
  //
  //   stray at the END of the file   fallback ON : 2 tasks, names ["T1","T2"]
  //                                  fallback OFF: 3 tasks, names intact
  //   stray in the FIRST task row    fallback ON : 1 task, 1 milestone
  //                                  fallback OFF: 1 task, 0 milestones
  //
  // So an EARLY stray is contained BY the fallback (it recovers every later
  // section), and a LATE stray sitting after a §105-shaped cell is made WORSE by
  // it (one task destroyed and another truncated). We keep it as a JUDGEMENT,
  // not because it wins: the loss it prevents is UNBOUNDED (every section after
  // the stray), the loss it causes is BOUNDED (the §105-shaped cells). Do not
  // read that as a claim about which case is more common — nothing here measured
  // that. Note in particular that a genuinely TRUNCATED file carries its
  // unclosed quote at the very END, so nothing follows for the quote-aware scan
  // to swallow and this branch can only COST on one (or tie).
  //
  // ★ ROUTING ONLY. `diag.unterminatedQuote` is still reported above, before
  // and regardless of the fallback: the file is still malformed and the caller
  // still warns. This changes which lines land in which section, not the
  // diagnostic.
  //
  // ★★★ THE ROWS IT LOSES ARE UNCOUNTED, AND THAT IS MEASURED, NOT ASSUMED: in
  // the late-stray case `diag` came back `{"droppedRows":0,"unterminatedQuote":
  // true}` — a task VANISHED and nothing counted it, because an absorbed row is
  // swallowed INTO a cell rather than REJECTED, and `droppedRows` counts only
  // rejections. DO NOT "fix" that with a row-count delta. Two cheap detectors
  // were measured over the fixture above and BOTH report a number that is not
  // the loss (actual rows lost: 1 late, 2 early):
  //   (1) `csv.split(/\r?\n/).length - scan.lines.length` .......... 2 / 2 / 9
  //   (2) marker-shaped lines the aware scan places inside a quote .. 1 / 1 / 4
  //       (readings over: a WELL-FORMED §105 file / late stray / early stray)
  // Each reads IDENTICALLY on a well-formed file and on a file that really lost
  // a row, and each PEAKS on the early-stray file — the one where the fallback
  // cost nothing and in fact recovered a milestone the quote-aware routing
  // dropped. Feeding either into `droppedRows` was tried as a mutant and reports
  // 2 on the late file where 1 task was lost, and would report 9 on the early
  // one this branch handled as well as it can be handled: a fabricated number in
  // a diagnostic, which is worse than the silence it replaces.
  //
  // The only counter that would be CORRECT is (records under the quote-aware
  // routing − records under this one), and it is deliberately NOT built: it
  // needs the whole workspace decoded TWICE from inside the splitter, it is
  // SIGNED (measured +1 late, −1 early — this branch loses a record in the one
  // case and GAINS one in the other) so it is not a "rows lost" count in both
  // directions, and it must not land in `droppedRows` anyway — that field
  // is documented above as rows a decoder actively REJECTS, and a second loss
  // class travelling under one name is the exact conflation the
  // {@link DocTruncationDiag} note warns against. It would need its own counter
  // AND a consumer to surface it. A mere BOOLEAN adds nothing: this branch is
  // taken IF AND ONLY IF `unterminatedQuote` is true, which is already reported.
  //
  // ★★ DO NOT extend this into a "the two splits disagree" warning. A
  // well-formed file legitimately carrying a marker-shaped line inside a quoted
  // cell — precisely the §105 shape this module fixes — produces exactly that
  // divergence (measured: detector (1) reads 2 on a clean file), so such a
  // warning would fire on the file we just fixed.
  // Likewise, a BALANCED pair of stray quotes is not detectable at all: a
  // legitimately quoted cell containing marker-shaped text and a stray quote
  // that swallowed a real marker are BYTE-IDENTICAL, so no parser can tell them
  // apart. That case stays open and is deliberately not guessed at.
  //
  // ★ THE `\r?\n` IS LOAD-BEARING, not decoration. Sections are re-joined with
  // `"\r\n"` below, so a `/\n/` split leaves every line carrying a trailing
  // `\r` that then DOUBLES at each break absorbed into a cell (`\r\r\n`). Pinned
  // by "the fallback split consumes CRLF, not LF alone" in
  // csv-section-split.test.ts — the outcome assertions there all survive the
  // mutation, so only that one closes it.
  const lines = scan.unterminatedQuote ? csv.split(/\r?\n/) : scan.lines;
  let mode: "tasks" | "raid" | "absences" | "calendarEvents" | "shifts" | "resources" | "roles" | "disciplines" | "grades" | "plan" | "budgets" | "fxrates" | "status" | "milestones" | "changes" | "stakeholders" | "project" | "fieldVis" | "functions" | "steering" | "timelogLinks" | "knowledgeItems" | "insights" | "settingsOverrides" | "documents" | "documentVersions" | "documentAssets" | "activityLog" | null = null;
  const tasksLines: string[] = [];
  const raidLines: string[] = [];
  const absencesLines: string[] = [];
  const calendarEventsLines: string[] = [];
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
  const knowledgeItemsLines: string[] = [];
  const insightsLines: string[] = [];
  const settingsOverridesLines: string[] = [];
  const documentsLines: string[] = [];
  const documentVersionsLines: string[] = [];
  const documentAssetsLines: string[] = [];
  const activityLogLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    // ★★ ORDER IS LOAD-BEARING because these are `startsWith` tests, not
    // equality tests: if one marker were a strict PREFIX of another, whichever
    // is checked FIRST would swallow the other's section into its own buffer —
    // silently, since the loser's lines simply land under the wrong mode and
    // its slice decodes as absent. `# DOCUMENTS` / `# DOCUMENT VERSIONS` are
    // the near miss (they diverge at index 10, "S" vs " "), and today NO marker
    // is a prefix of any other. Do NOT rely on reading this chain to keep it
    // that way — a rename to `# DOCUMENT` would reintroduce the hazard with no
    // test failure from the outcome tests alone. The invariant is pinned in
    // csv-codecs.documents.test.ts ("no section marker is a prefix of another"),
    // which reads the marker list reflectively, so a NEW marker is covered
    // without touching the test. Add a longer marker AFTER its shorter
    // namesake, or make them non-overlapping.
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
    if (trimmed.startsWith(CSV_SECTION_CALENDAR_EVENTS)) { mode = "calendarEvents"; continue; }
    if (trimmed.startsWith(CSV_SECTION_SHIFTS)) { mode = "shifts"; continue; }
    if (trimmed.startsWith(CSV_SECTION_FIELD_VIS)) { mode = "fieldVis"; continue; }
    if (trimmed.startsWith(CSV_SECTION_FUNCTIONS)) { mode = "functions"; continue; }
    if (trimmed.startsWith(CSV_SECTION_STEERING)) { mode = "steering"; continue; }
    if (trimmed.startsWith(CSV_SECTION_TIMELOG_LINKS)) { mode = "timelogLinks"; continue; }
    if (trimmed.startsWith(CSV_SECTION_KNOWLEDGE_ITEMS)) { mode = "knowledgeItems"; continue; }
    if (trimmed.startsWith(CSV_SECTION_INSIGHTS)) { mode = "insights"; continue; }
    if (trimmed.startsWith(CSV_SECTION_SETTINGS_OVERRIDES)) { mode = "settingsOverrides"; continue; }
    if (trimmed.startsWith(CSV_SECTION_DOCUMENTS)) { mode = "documents"; continue; }
    if (trimmed.startsWith(CSV_SECTION_DOCUMENT_VERSIONS)) { mode = "documentVersions"; continue; }
    if (trimmed.startsWith(CSV_SECTION_DOCUMENT_ASSETS)) { mode = "documentAssets"; continue; }
    if (trimmed.startsWith(CSV_SECTION_ACTIVITY)) { mode = "activityLog"; continue; }
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
    else if (mode === "calendarEvents") calendarEventsLines.push(line);
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
    else if (mode === "knowledgeItems") knowledgeItemsLines.push(line);
    else if (mode === "insights") insightsLines.push(line);
    else if (mode === "settingsOverrides") settingsOverridesLines.push(line);
    else if (mode === "documents") documentsLines.push(line);
    else if (mode === "documentVersions") documentVersionsLines.push(line);
    else if (mode === "documentAssets") documentAssetsLines.push(line);
    else if (mode === "activityLog") activityLogLines.push(line);
    // (else: line before the first marker — drop it.)
  }
  return {
    tasksText: tasksLines.join("\r\n"),
    raidText: raidLines.join("\r\n"),
    absencesText: absencesLines.join("\r\n"),
    calendarEventsText: calendarEventsLines.join("\r\n"),
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
    knowledgeItemsText: knowledgeItemsLines.join("\r\n"),
    insightsText: insightsLines.join("\r\n"),
    settingsOverridesText: settingsOverridesLines.join("\r\n"),
    // ★ CRLF: CSV is CRLF-delimited in this repo (markdown is LF), and the
    // split above accepts both — so the join must restore "\r\n" or a quoted
    // multi-line cell would come back with its breaks rewritten.
    documentsText: documentsLines.join("\r\n"),
    documentVersionsText: documentVersionsLines.join("\r\n"),
    documentAssetsText: documentAssetsLines.join("\r\n"),
    activityLogText: activityLogLines.join("\r\n"),
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

/**
 * Map header-keyed rows through `build`, keeping non-null results and (when a
 * `diag` is supplied) counting the rows `build` rejects. Shared by the
 * `csvRowsToObjects`-based reference/resource decoders.
 */
function collectRows<T>(
  rows: Record<string, string>[],
  build: (obj: Record<string, string>) => T | null,
  diag?: ImportDiag,
): T[] {
  const out: T[] = [];
  for (const o of rows) {
    const item = build(o);
    if (item) out.push(item);
    else if (diag) diag.droppedRows++;
  }
  return out;
}

function csvToResources(csv: string, diag?: ImportDiag): Resource[] {
  return collectRows(csvRowsToObjects(csv), sanitizeResource, diag);
}

function csvToRoles(csv: string, diag?: ImportDiag): Role[] {
  return collectRows(csvRowsToObjects(csv), sanitizeRole, diag);
}

function csvToBudgets(csv: string, diag?: ImportDiag): BudgetBucket[] {
  return collectRows(csvRowsToObjects(csv), sanitizeBudgetBucket, diag);
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

function csvToDisciplines(csv: string, diag?: ImportDiag): Discipline[] {
  return collectRows(csvRowsToObjects(csv), sanitizeDiscipline, diag);
}

function csvToGrades(csv: string, diag?: ImportDiag): Grade[] {
  return collectRows(csvRowsToObjects(csv), sanitizeGrade, diag);
}

function parsePlanLine(line: string): ResourcePlan | null {
  const cells = parseCsv(line)[0];
  if (!cells || cells.length < 4) return null;
  const today = new Date().toISOString().slice(0, 10);
  return sanitizePlan({ startDate: cells[0], endDate: cells[1], granularity: cells[2], currency: cells[3], budgetFollowsPlan: cells[4] }, today);
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
  diag?: ImportDiag,
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
    else if (diag) diag.droppedRows++;
  }
  return items;
}

function csvToAbsences(csv: string, diag?: ImportDiag): Absence[] {
  return decodeCsvSection(csv, sanitizeAbsence, diag);
}

/** Decodes a `# CALENDAR EVENTS` section into CalendarEvent[]. Mirrors
 *  `csvToStakeholders`'s shape: reuses the shared `decodeCsvSection` header-row
 *  reader rather than a second parser, and — like every other section decoder
 *  here — drops just the rows `buildCalendarEventFromObj` rejects (a malformed
 *  row never takes the rest of the section down with it). */
export function csvToCalendarEvents(csv: string, diag?: ImportDiag): CalendarEvent[] {
  return decodeCsvSection(csv, buildCalendarEventFromObj, diag);
}

function csvToShifts(csv: string, diag?: ImportDiag): Shift[] {
  return decodeCsvSection(csv, sanitizeShift, diag);
}

/** Decodes a `# DOCUMENT ASSETS` section into DocumentAsset[]. Same
 *  row-table shape as `csvToCalendarEvents` — a header row keyed by
 *  {@link DOCUMENT_ASSETS_CSV_COLUMNS} — NOT the single `config,<json>` blob
 *  shape `documents`/`documentVersions`/`activityLog` use (those hold a whole
 *  document/version list per cell; asset metadata is one row per asset,
 *  matching calendarEvents). Bytes never appear here — only metadata. */
function csvToDocumentAssets(csv: string, diag?: ImportDiag): DocumentAsset[] {
  return decodeCsvSection(csv, buildDocumentAssetFromObj, diag);
}

function csvToMilestones(csv: string, diag?: ImportDiag): Milestone[] {
  return decodeCsvSection(csv, buildMilestoneFromObj, diag);
}

function csvToChanges(csv: string, diag?: ImportDiag): ChangeItem[] {
  return decodeCsvSection(csv, buildChangeFromObj, diag);
}

export function csvToStakeholders(csv: string, diag?: ImportDiag): Stakeholder[] {
  return decodeCsvSection(csv, buildStakeholderFromObj, diag);
}

function csvToRaid(csv: string, diag?: ImportDiag): RaidItem[] {
  return decodeCsvSection(csv, buildRaidItemFromObj, diag);
}

/** Parses all sections out of a (possibly section-marked) CSV string. Pass an
 *  optional {@link ImportDiag} to count rows rejected as malformed. */
export function csvToWorkspace(csv: string, diag?: ImportDiag): Workspace {
  const s = splitCsvSections(csv, diag);
  const ws: Workspace = {
    tasks: csvToTasks(s.tasksText, diag),
    raid: s.raidText.trim() ? csvToRaid(s.raidText, diag) : [],
    absences: s.absencesText.trim() ? csvToAbsences(s.absencesText, diag) : [],
    calendarEvents: s.calendarEventsText.trim() ? csvToCalendarEvents(s.calendarEventsText, diag) : undefined,
    shifts: s.shiftsText.trim() ? csvToShifts(s.shiftsText, diag) : [],
    resources: s.resourcesText.trim() ? csvToResources(s.resourcesText, diag) : [],
    roles: s.rolesText.trim() ? csvToRoles(s.rolesText, diag) : [],
    disciplines: s.disciplinesText.trim() ? csvToDisciplines(s.disciplinesText, diag) : [],
    grades: s.gradesText.trim() ? csvToGrades(s.gradesText, diag) : [],
    plan: (s.planText.trim() && parsePlanLine(s.planText)) || defaultResourcePlan(new Date().toISOString().slice(0, 10)),
    budgets: s.budgetsText.trim() ? csvToBudgets(s.budgetsText, diag) : [],
    fxRates: s.fxRatesText.trim() ? parseFxRatesLine(s.fxRatesText.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#")) ?? "") : null,
    status: s.statusText.trim() ? csvToStatus(s.statusText) : {},
    milestones: s.milestonesText.trim() ? csvToMilestones(s.milestonesText, diag) : [],
    changes: s.changesText.trim() ? csvToChanges(s.changesText, diag) : [],
    stakeholders: s.stakeholdersText.trim() ? csvToStakeholders(s.stakeholdersText, diag) : [],
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
  if (s.knowledgeItemsText.trim()) {
    const ki = csvToKnowledgeItems(s.knowledgeItemsText);
    if (ki) ws.knowledgeItems = ki;
  }
  if (s.insightsText.trim()) {
    const ins = csvToInsights(s.insightsText);
    if (ins) ws.insights = ins;
  }
  if (s.settingsOverridesText.trim()) {
    const so = csvToSettingsOverrides(s.settingsOverridesText);
    if (so) ws.settingsOverrides = so;
  }
  if (s.documentsText.trim()) {
    const docs = csvToDocuments(s.documentsText, diag);
    if (docs) ws.documents = docs;
  }
  if (s.documentVersionsText.trim()) {
    const versions = csvToDocumentVersions(s.documentVersionsText, diag);
    if (versions) ws.documentVersions = versions;
  }
  // Assign only when the decoded list is non-empty — same "stay free of the
  // key" shape as documents/documentVersions above, so an asset-less
  // workspace round-trips without ever gaining a `documentAssets` key.
  if (s.documentAssetsText.trim()) {
    const assets = csvToDocumentAssets(s.documentAssetsText, diag);
    if (assets.length) ws.documentAssets = assets;
  }
  if (s.activityLogText.trim()) {
    const log = csvToActivityLog(s.activityLogText);
    if (log) ws.activityLog = log;
  }
  return migrateWorkspaceV10(ws);
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
  return migrateTask({
    id,
    taskName: obj.taskName ?? "",
    assignee: obj.assignee ?? "",
    assigneeEmail: obj.assigneeEmail ?? "",
    startDate: obj.startDate || undefined,
    dueDate: obj.dueDate ?? "",
    lastUpdateDate: obj.lastUpdateDate ?? "",
    createdDate: obj.createdDate || undefined,
    priority: ((obj.priority as Priority) || "Medium") as Priority,
    status: obj.status as Task["status"],
    blockers: obj.blockers ?? "",
    description: obj.description ?? "",
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
    knowledgeLinks: decodeKnowledgeLinks(obj.knowledgeLinks ?? obj.documentLinks),
    noteLog: (() => {
      const nl = decodeNoteLog(obj.noteLog);
      return nl.length ? nl : undefined;
    })(),
  });
}

function csvToTasks(csv: string, diag?: ImportDiag): Task[] {
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
    else if (diag) diag.droppedRows++;
  }
  // Final pass: now that we know every id that survived parsing, drop any
  // dependency entries that point at missing or self ids. Older CSV files
  // without a `dependencies` column hit this with empty arrays and become
  // no-ops.
  return dropDanglingDependencies(tasks);
}
