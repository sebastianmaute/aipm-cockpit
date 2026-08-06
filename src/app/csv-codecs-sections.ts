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
