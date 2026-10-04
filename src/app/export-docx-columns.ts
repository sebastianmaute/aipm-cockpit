// src/app/export-docx-columns.ts — which columns the WORD export prints, and how wide.
//
// open-followups §512 (a). The workspace exporter builds ONE set of sections for CSV, XLSX and
// Word (`buildExportSections`), each carrying every exported field. That is right for the data
// formats and unreadable in Word, where 30 task columns share a landscape page at equal width. So
// the Word paths (the workspace export and a document's data-section block) project each section
// down to a curated list of reader-facing fields here, and size the columns to their content.
// CSV and XLSX are untouched.
//
// Pure and i18n-free: the labels are already on the section (§304), so a projection keeps them.

import { cellText, EXPORT_SECTION_FIELDS, type ExportCell, type ExportSection } from "./export-sections";
import type { ExportSectionKey } from "./settings-types";

/** The fields the Word export prints per register, in print order. A section with no entry here
 *  (the key/value project and status sections, calendar events, knowledge items, insights) is
 *  already narrow and prints whole. Never bookkeeping: no sync stamps, calendar ids, link lists or
 *  linked-row id lists — each is a number or id a reader of a document cannot use. */
export const DOCX_SECTION_FIELDS: Readonly<Partial<Record<ExportSectionKey, readonly string[]>>> = {
  tasks: ["id", "taskName", "assignee", "status", "priority", "startDate", "dueDate", "completedDate", "group", "blockers", "description"],
  raid: ["id", "category", "title", "severity", "status", "owner", "targetDate", "description", "mitigation"],
  milestones: ["id", "name", "date", "achievedDate", "description"],
  changes: ["id", "title", "type", "status", "impact", "requestedBy", "raisedDate", "decisionDate", "description"],
  stakeholders: ["name", "organization", "title", "email", "category", "influence", "interest"],
  budgets: ["name", "poNumber", "type", "currency", "fixedPriceAmount", "startDate", "endDate", "status", "percentComplete"],
  resources: ["firstName", "lastName", "title", "department", "company", "email", "location", "isExternal"],
  roles: ["id", "disciplineId", "gradeId", "internalRate", "externalRate", "internalRateDay", "externalRateDay", "rateBasis"],
  absences: ["assignee", "startDate", "endDate", "type", "note"],
  shifts: ["assignee", "monHours", "tueHours", "wedHours", "thuHours", "friHours", "satHours", "sunHours", "note"],
};

/** The section with only its curated Word columns, in curated order; the section itself when it
 *  has no curated list or is not shaped like an exported section. Never modifies its input. */
export function docxSection(section: ExportSection): ExportSection {
  const curated = DOCX_SECTION_FIELDS[section.key];
  if (!curated) return section;
  const fields = EXPORT_SECTION_FIELDS[section.key];
  // Only a section shaped like `buildExportSections` builds it — one column per exported field —
  // can be projected by field. Any other shape prints as given rather than misaligned.
  if (section.columns.length !== fields.length) return section;
  const picks = curated.map((f) => fields.indexOf(f)).filter((i) => i >= 0);
  return {
    ...section,
    columns: picks.map((i) => section.columns[i]),
    rows: section.rows.map((row) => picks.map((i) => row[i] ?? "")),
  };
}

/** Bounds on a column's weight, in characters: a floor so an id column stays legible, and a cap
 *  so one long text column cannot squeeze the rest to nothing (the widest is at most 10x the
 *  narrowest). Long text wraps inside its cell, which Word does anyway. */
const MIN_CHARS = 4;
const MAX_CHARS = 40;
/** Rows sampled per column. Enough to see a column's shape; a 5,000-row export stays cheap. */
const SAMPLE_ROWS = 200;

function longestWord(label: string): number {
  return label.split(/\s+/).reduce((n, w) => Math.max(n, w.length), 0);
}

/** Column widths in twips that sum to exactly `contentWidth`, each in proportion to its content:
 *  the longest cell text among the first rows, or the longest WORD of the header (a header wraps at
 *  spaces, so its longest word is the narrowest it can get without breaking a word), clamped to
 *  [MIN_CHARS, MAX_CHARS]. */
export function docxColumnWidths(columns: readonly string[], rows: readonly (readonly ExportCell[])[], contentWidth: number): number[] {
  if (columns.length === 0) return [];
  const weights = columns.map((label, i) => {
    let chars = longestWord(label);
    for (const row of rows.slice(0, SAMPLE_ROWS)) {
      const cell = row[i];
      if (cell !== undefined) chars = Math.max(chars, String(cellText(cell)).length);
    }
    return Math.min(MAX_CHARS, Math.max(MIN_CHARS, chars));
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.floor((contentWidth * w) / total));
  // Flooring loses a few twips; give them to the widest column so the table fills the page exactly.
  const widest = weights.indexOf(Math.max(...weights));
  widths[widest] += contentWidth - widths.reduce((a, b) => a + b, 0);
  return widths;
}
