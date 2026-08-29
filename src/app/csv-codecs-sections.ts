// src/app/csv-codecs-sections.ts
//
// Section markers for the multi-section CSV format, used by `workspaceToCsv`
// (csv-codecs-config) and `csvToWorkspace` (csv-codecs-decode). The hash prefix
// isn't formal CSV, but every spreadsheet tool we care about treats a line whose
// only cell starts with "#" as a comment row.
//
// A LEAF: this module imports nothing, which keeps it safe for any importer and
// out of the one-way dep chain (sections <- core <- config <- decode). Split out
// of csv-codecs-core.ts when that file crossed the 800-line ratchet; the markers
// had drifted into two separate blocks at opposite ends of it, so consolidating
// them here also removes that split.
//
// ★ csv-codecs-core re-exports everything below, so existing
// `from "./csv-codecs-core"` imports keep working unchanged.
//
// ★★ A marker's STRING VALUE is a storage format constant, not a label. The
// decoder matches sections with `trimmed.startsWith(MARKER)`, and
// `golden-workspace.test` pins the exact emitted bytes — so editing one of these
// strings silently stops old files from decoding that section AND fails the
// byte-stability gate. Add new markers; do not reword existing ones.

export const CSV_SECTION_TASKS = "# TASKS";
export const CSV_SECTION_RAID = "# RAID";
export const CSV_SECTION_ABSENCES = "# ABSENCES";
export const CSV_SECTION_SHIFTS = "# SHIFTS";
export const CSV_SECTION_CALENDAR_EVENTS = "# CALENDAR EVENTS";

export const CSV_SECTION_BUDGETS = "# BUDGETS";
export const CSV_SECTION_FXRATES = "# FXRATES";
export const CSV_SECTION_MILESTONES = "# MILESTONES";
export const CSV_SECTION_CHANGES = "# CHANGES";
export const CSV_SECTION_STAKEHOLDERS = "# STAKEHOLDERS";

export const CSV_SECTION_RESOURCES = "# RESOURCES";
export const CSV_SECTION_ROLES = "# ROLES";
export const CSV_SECTION_DISCIPLINES = "# DISCIPLINES";
export const CSV_SECTION_GRADES = "# GRADES";
export const CSV_SECTION_PLAN = "# PLAN";
export const CSV_SECTION_STATUS = "# PROJECT STATUS";
export const CSV_SECTION_PROJECT = "# PROJECT META";

// Config-blob sections: one `config,<json>` row rather than a column table.
export const CSV_SECTION_FIELD_VIS = "# FIELD-VISIBILITY";
export const CSV_SECTION_FUNCTIONS = "# FUNCTIONS";
export const CSV_SECTION_STEERING = "# STEERING COMMITTEE";
export const CSV_SECTION_TIMELOG_LINKS = "# TIMELOG LINKS";
export const CSV_SECTION_KNOWLEDGE_ITEMS = "# KNOWLEDGE ITEMS";
export const CSV_SECTION_INSIGHTS = "# INSIGHTS";
export const CSV_SECTION_SETTINGS_OVERRIDES = "# SETTINGS OVERRIDES";
export const CSV_SECTION_DOCUMENTS = "# DOCUMENTS";
export const CSV_SECTION_DOCUMENT_VERSIONS = "# DOCUMENT VERSIONS";
export const CSV_SECTION_DOCUMENT_ASSETS = "# DOCUMENT ASSETS";
export const CSV_SECTION_ACTIVITY = "# ACTIVITY LOG";

/**
 * The sections a dropped IMPORT ROW can be attributed to — the answer to "which
 * part of my file lost data", which the flat `ImportDiag.droppedRows` cannot
 * give (§152).
 *
 * ★★★ NARROWER THAN THE MARKER LIST ABOVE, ON PURPOSE. Only a section whose
 * decoder can REJECT A ROW belongs here. The config-blob sections carry one
 * `config,<json>` row and either parse or do not; blank rows are skipped, not
 * counted; and dangling-dependency pruning drops FK entries rather than rows.
 * None of those bump the counter today and none may start to — a key existing
 * here is an invitation to make it fire.
 *
 * ★★★ DELIBERATELY NOT DERIVED FROM THE `CSV_SECTION_*` STRINGS, though the
 * plan for this slice said to derive it. Those values are STORAGE FORMAT bytes
 * pinned by `golden-workspace.test`, so keying a diagnostic on them would make
 * a marker reword a silent diagnostic break — and the banner above already
 * forbids rewording them for exactly that class of reason. These are workspace
 * SLICE names instead, which is also what `i18n` labels them by.
 *
 * ★ Both codec families use these: Markdown has no `# TASKS` marker at all
 * (it uses `# AIPM Tasks` headings), so a marker-derived union could not have
 * served it. This module imports nothing, which is what lets both import from
 * here without a cycle.
 */
export const IMPORT_SECTION_KEYS = [
  "tasks",
  "raid",
  "absences",
  "shifts",
  "calendarEvents",
  "documentAssets",
  "milestones",
  "changes",
  "stakeholders",
  "resources",
  "roles",
  "budgets",
  "disciplines",
  "grades",
] as const;

export type ImportSectionKey = (typeof IMPORT_SECTION_KEYS)[number];
