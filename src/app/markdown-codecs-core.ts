// src/app/markdown-codecs-core.ts
//
// Markdown codec CORE: mdEscape/mdUnescape, the per-entity table encoders,
// the config/project markdown codecs, the three self-contained table
// decoders (milestones/changes/stakeholders), the workspaceToMarkdown
// encoder assembler, and the shared row primitives (splitMdRow,
// markdownTableToObjects). The *_MD_COLUMNS registries themselves live in
// markdown-columns.ts, a leaf both this file and the decode sibling import
// from. Leaf otherwise — no imports from the decode sibling. Re-exported via
// the ./markdown-codecs barrel.

import { sanitizeFieldVisibility, type FieldVisibilityConfig } from "./field-visibility";
import { sanitizeFeatures, type FeatureModuleId } from "./feature-modules";
import { sanitizeSteeringCommittee } from "./sanitize";
import { sanitizeTimelogLinks } from "./timelog-sanitize";
import { sanitizeKnowledgeItems, type KnowledgeItem } from "./document-link";
import { sanitizeProjectDocuments, type DocTruncationDiag, type ProjectDocument } from "./document-model";
import { sanitizeDocumentRichFields } from "./document-rich-fields";
import { sanitizeDocumentVersions, type DocVersion } from "./document-versions";
import { sanitizeInsights } from "./insights/sanitize-insights";
import type { Insight } from "./insights/insight";
import type { TimelogLinks } from "./timelog-types";
import { sanitizeSettingsOverrides, hasAnyOverride } from "./settings-overrides";
import type { SettingsOverrides } from "./settings-types";
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
import type { CalendarEvent } from "./calendar-event";
import type { ExportConfig } from "./settings-types";
import { EXPORT_SECTION_KEYS } from "./settings-types";
import { type Workspace, sanitizeProjectStatus } from "./workspace";
import { sanitizeActivityLog } from "./activity-log";
import type { ActivityEntry } from "./activity-log";
import {
  type ImportDiag,
  PROJECT_CSV_COLUMNS,
  STATUS_FIELDS,
  absenceFieldToString,
  budgetFieldToString,
  buildChangeFromObj,
  buildMilestoneFromObj,
  buildProjectFromObj,
  buildStakeholderFromObj,
  calendarEventFieldToString,
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
import {
  MD_COLUMNS,
  RAID_MD_COLUMNS,
  ABSENCES_MD_COLUMNS,
  EVENTS_MD_COLUMNS,
  SHIFTS_MD_COLUMNS,
  RESOURCES_MD_COLUMNS,
  ROLES_MD_COLUMNS,
  BUDGETS_MD_COLUMNS,
  REF_MD_COLUMNS,
  MILESTONES_MD_COLUMNS,
  CHANGES_MD_COLUMNS,
  STAKEHOLDERS_MD_COLUMNS,
} from "./markdown-columns";

/** Serializes status as "## Project Status" + "- field: value" bullets.
 *
 *  ★ Each field is ONE list item and `markdownToStatus` reads it back with a
 *  single-line regex, so a newline in a value would silently cut everything
 *  after it away. That is this codec's own structural constraint, so it is
 *  honoured HERE for every value rather than trusted to each upstream writer:
 *  the rich-text narrative is normalized on the editor's save path, but an
 *  imported, AI-written or backend-converted status never passes through it.
 *  Collapsing to a space is lossless for HTML (inter-tag whitespace) and for
 *  the prose the other fields hold. */
export function statusToMarkdown(status: ProjectStatus): string {
  const lines = ["## Project Status", ""];
  for (const f of STATUS_FIELDS) {
    const v = status[f];
    if (v != null && v !== "") lines.push(`- ${f}: ${String(v).replace(/\r\n|[\r\n]/g, " ")}`);
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

export function knowledgeItemsToMarkdown(items: readonly KnowledgeItem[]): string {
  return ["## Knowledge Items", "", "```json", JSON.stringify(items, null, 2), "```", ""].join("\n");
}

export function markdownToKnowledgeItems(md: string): KnowledgeItem[] | undefined {
  const m = /## Knowledge Items\s*\n+```json\s*\n([\s\S]*?)\n```/.exec(md);
  if (!m) return undefined;
  try {
    const items = sanitizeKnowledgeItems(JSON.parse(m[1]));
    return items.length ? items : undefined;
  } catch {
    return undefined;
  }
}

/** Documents persist as a fenced json blob, the knowledgeItems/insights
 *  precedent — NOT a table. A document holds a nested block array, which
 *  cannot survive a pipe-delimited row, and noteLog (the only JSON-in-cell
 *  precedent in this repo) is deliberately absent from the markdown columns
 *  entirely, so there is no table pattern to copy.
 *
 *  ★★ FENCE COLLISION is harmless BY CONSTRUCTION, not by luck. JSON.stringify
 *  does not escape a backtick, so a user's title or paragraph HTML can carry a
 *  literal triple-backtick — but {@link markdownToDocuments} only recognises a
 *  closing fence at the START OF A LINE, and JSON.stringify escapes U+000A
 *  inside a string as the two characters \ and n. No character a user can type
 *  therefore puts a fence at column 0. Pinned by markdown-codecs.documents.test.ts,
 *  which counts the column-0 fence lines rather than trusting the argument. */
export function documentsToMarkdown(docs: readonly ProjectDocument[]): string {
  return ["## Documents", "", "```json", JSON.stringify(docs, null, 2), "```", ""].join("\n");
}

export function markdownToDocuments(
  md: string,
  diag?: DocTruncationDiag,
): ProjectDocument[] | undefined {
  const m = /## Documents\s*\n+```json\s*\n([\s\S]*?)\n```/.exec(md);
  if (!m) return undefined;
  try {
    // ★★★ TWO PASSES, and the second one is not optional. sanitizeProjectDocuments
    // is DOM-FREE BY CONTRACT, so it enforces STRUCTURE and cannot strip markup;
    // sanitizeDocumentRichFields applies the paragraph HTML allow-list. Markdown
    // and CSV were the only two of the six load paths missing this, which left
    // the same document decoding to different in-memory HTML depending on the
    // backend it came from — and a Markdown→JSON migration then WROTE the
    // unfiltered markup into a backend that would have cleaned it.
    // ★★ THIS MAKES THE DECODE PATH DOM-DEPENDENT, and the failure mode is
    // SILENT. Measured both ways with the generator's exact arrangement: with
    // JSDOM installed first, documents decode and come back sanitized; with no
    // DOM the DOMPurify call throws, the catch below swallows it, and documents
    // decode to UNDEFINED — dropped whole, no error, no diagnostic. Today the
    // only DOM-free importer is scripts/generate-sample-workspace.ts, which
    // installs JSDOM into globalThis BEFORE it dynamically imports
    // src/app/storage (see its header). A NEW bare-node importer of this module
    // must do the same or it will silently lose every document.
    const docs = sanitizeProjectDocuments(JSON.parse(m[1]), diag).map(sanitizeDocumentRichFields);
    return docs.length ? docs : undefined;
  } catch {
    return undefined;
  }
}

/** Document version history persists the same way as documents just above —
 *  a fenced json blob, not a table — for the same reason: a version carries a
 *  nested block array, and there is no table pattern to copy. STORAGE-ONLY,
 *  gated by `config === undefined` at the emit site below: version history
 *  exists to back AI-write undo, not to be read, so it must never leak into a
 *  user-facing markdown export.
 *
 *  ★★ Same fence-collision argument as documentsToMarkdown, pinned by the same
 *  shape of test in markdown-codecs.documents.test.ts: JSON.stringify escapes
 *  U+000A as the two characters \ and n, so no character a user types can put
 *  a ``` at column 0, and the decoder below only recognises a closing fence at
 *  the start of a line. */
export function documentVersionsToMarkdown(versions: readonly DocVersion[]): string {
  return ["## Document versions", "", "```json", JSON.stringify(versions, null, 2), "```", ""].join("\n");
}

export function markdownToDocumentVersions(
  md: string,
  diag?: DocTruncationDiag,
): DocVersion[] | undefined {
  const m = /## Document versions\s*\n+```json\s*\n([\s\S]*?)\n```/.exec(md);
  if (!m) return undefined;
  try {
    // Same two-pass shape as markdownToDocuments just above: sanitizeDocumentVersions
    // enforces structure (DOM-free), then each version's blocks get the paragraph
    // HTML allow-list via sanitizeDocumentRichFields. A version has no independent
    // createdAt/updatedAt, so it is passed through a synthetic ProjectDocument-shaped
    // wrapper with savedAt standing in for both.
    const versions = sanitizeDocumentVersions(JSON.parse(m[1]), diag).map((v) => ({
      ...v,
      blocks: sanitizeDocumentRichFields({
        id: v.documentId,
        title: v.title,
        blocks: v.blocks,
        createdAt: v.savedAt,
        updatedAt: v.savedAt,
      }).blocks,
    }));
    return versions.length ? versions : undefined;
  } catch {
    return undefined;
  }
}

export function insightsToMarkdown(insights: readonly Insight[]): string {
  return ["## Insights", "", "```json", JSON.stringify(insights, null, 2), "```", ""].join("\n");
}

export function markdownToInsights(md: string): Insight[] | undefined {
  const m = /## Insights\s*\n+```json\s*\n([\s\S]*?)\n```/.exec(md);
  if (!m) return undefined;
  try {
    const ins = sanitizeInsights(JSON.parse(m[1]));
    return ins.length ? ins : undefined;
  } catch {
    return undefined;
  }
}

/** Activity log persists the same way as documents/insights above — a fenced
 *  json blob, not a table — for the same reason: an entry is a flat but
 *  internal-shape record with no table pattern to copy.
 *
 *  ★ STORAGE-ONLY, unlike insightsToMarkdown just above: an entry's `changes`
 *  carries old/new values for up to 12 fields per update, an internal audit
 *  trail that does not belong in a document handed to a client. There is no
 *  `activityLog` key in EXPORT_SECTION_KEYS and none should be added — gated
 *  by `config === undefined` at the emit site below, same as documents.
 *
 *  ★★ Same fence-collision argument as documentsToMarkdown: JSON.stringify
 *  escapes U+000A as the two characters \ and n, so no character a user's
 *  args/change values can contain puts a ``` at column 0. */
export function activityLogToMarkdown(log: readonly ActivityEntry[]): string {
  return ["## Activity Log", "", "```json", JSON.stringify(log, null, 2), "```", ""].join("\n");
}

export function markdownToActivityLog(md: string): ActivityEntry[] | undefined {
  const m = /## Activity Log\s*\n+```json\s*\n([\s\S]*?)\n```/.exec(md);
  if (!m) return undefined;
  try {
    // sanitizeActivityLog (activity-log.ts) is DOM-free — no second rich-field
    // pass needed, unlike markdownToDocuments above.
    const log = sanitizeActivityLog(JSON.parse(m[1]));
    return log.length ? log : undefined;
  } catch {
    return undefined;
  }
}

export function settingsOverridesToMarkdown(overrides: SettingsOverrides): string {
  return ["## Settings Overrides", "", "```json", JSON.stringify(overrides, null, 2), "```", ""].join("\n");
}

export function markdownToSettingsOverrides(md: string): SettingsOverrides | undefined {
  const m = /## Settings Overrides\s*\n+```json\s*\n([\s\S]*?)\n```/.exec(md);
  if (!m) return undefined;
  try {
    const o = sanitizeSettingsOverrides(JSON.parse(m[1]));
    return hasAnyOverride(o) ? o : undefined;
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
  const lines = ["# AIPM Tasks", "", header, sep];
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

// Reuses calendarEventFieldToString (csv-codecs-core.ts, re-exported via the
// ./csv-codecs barrel like every other fieldToString helper this file
// imports) rather than re-deriving cell values, so CSV and Markdown can't
// drift on what a column contains.
function calendarEventsToMarkdown(events: readonly CalendarEvent[]): string {
  const header = `| ${EVENTS_MD_COLUMNS.map((c) => c.label).join(" | ")} |`;
  const sep = `| ${EVENTS_MD_COLUMNS.map(() => "---").join(" | ")} |`;
  const lines = ["## Calendar Events", "", header, sep];
  for (const e of events) {
    const row = EVENTS_MD_COLUMNS.map((c) =>
      mdEscape(calendarEventFieldToString(e, c.key)),
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

const MILESTONE_ALIASES: Record<string, string> = {
  id: "id", name: "name", date: "date", description: "description",
  achieved: "achievedDate", achieveddate: "achievedDate",
  linkedtasks: "linkedTaskIds", linkedtaskids: "linkedTaskIds",
  localmodified: "localModifiedAt", localmodifiedat: "localModifiedAt",
  documentlinks: "knowledgeLinks", knowledgelinks: "knowledgeLinks", outlookeventid: "outlookEventId",
};

export function markdownToMilestones(md: string, diag?: ImportDiag): Milestone[] {
  return decodeMdTable(md, MILESTONE_ALIASES, buildMilestoneFromObj, diag);
}

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

const CHANGE_ALIASES: Record<string, string> = {
  id: "id", title: "title", description: "description", type: "type",
  status: "status", impact: "impact", impactdescription: "impactDescription",
  scheduleimpactdays: "scheduleImpactDays", costimpact: "costImpact",
  requestedby: "requestedBy", raiseddate: "raisedDate", decisionby: "decisionBy",
  decisiondate: "decisionDate", resolutionnotes: "resolutionNotes",
  linkedtasks: "linkedTaskIds", linkedtaskids: "linkedTaskIds",
  linkedraid: "linkedRaidIds", linkedraidids: "linkedRaidIds",
  stakeholderids: "stakeholderIds", stakeholders: "stakeholderIds",
  localmodified: "localModifiedAt", localmodifiedat: "localModifiedAt",
  documentlinks: "knowledgeLinks", knowledgelinks: "knowledgeLinks", outlookeventid: "outlookEventId",
};

export function markdownToChanges(md: string, diag?: ImportDiag): ChangeItem[] {
  return decodeMdTable(md, CHANGE_ALIASES, buildChangeFromObj, diag);
}

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

const STAKEHOLDER_ALIASES: Record<string, string> = {
  id: "id", name: "name", organization: "organization", title: "title",
  email: "email", category: "category", influence: "influence",
  interest: "interest", notes: "notes", resourceid: "resourceId", raci: "raci",
  localmodified: "localModifiedAt", localmodifiedat: "localModifiedAt",
  documentlinks: "knowledgeLinks", knowledgelinks: "knowledgeLinks",
};

export function markdownToStakeholders(md: string, diag?: ImportDiag): Stakeholder[] {
  return decodeMdTable(md, STAKEHOLDER_ALIASES, buildStakeholderFromObj, diag);
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
  const cells = [p.startDate, p.endDate, p.granularity, p.currency];
  if (p.budgetFollowsPlan) cells.push("true");
  return `## Plan\n\n${cells.join(",")}\n`;
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
  // Calendar events are a first-class ExportSectionKey (default ON) — same
  // enabled()-gated pattern as raid/absences/shifts above, and matching the
  // CSV codec's gate (csv-codecs-config.ts).
  if (enabled("calendarEvents") && ws.calendarEvents && ws.calendarEvents.length > 0)
    mdParts.push(calendarEventsToMarkdown(ws.calendarEvents));
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
  // Settings overrides — storage-only, same byte-stability gate; absent/empty
  // emits nothing so override-less workspaces round-trip byte-identically.
  if (config === undefined && ws.settingsOverrides && hasAnyOverride(ws.settingsOverrides))
    mdParts.push(settingsOverridesToMarkdown(ws.settingsOverrides));
  // Standalone knowledge items — EXPORTABLE (gated by the export key), emitted
  // only when present so legacy workspaces round-trip byte-identically.
  if (enabled("knowledgeItems") && ws.knowledgeItems && ws.knowledgeItems.length)
    mdParts.push(knowledgeItemsToMarkdown(ws.knowledgeItems));
  // Insights — EXPORTABLE (gated by the export key), emitted only when present
  // so insight-less workspaces round-trip byte-identically.
  if (enabled("insights") && ws.insights && ws.insights.length)
    mdParts.push(insightsToMarkdown(ws.insights));
  // Documents — STORAGE-ONLY, like settingsOverrides/timelogLinks/steering
  // above: this function serves both the markdown storage backend and the
  // user-facing markdown EXPORT, and a raw JSON blob fenced into the middle of
  // a document someone means to read is not an export. Emitted only when
  // present, so a document-less workspace serializes byte-for-byte as it did
  // before the field existed (the golden fixtures pin those bytes).
  if (config === undefined && ws.documents && ws.documents.length)
    mdParts.push(documentsToMarkdown(ws.documents));
  // Document version history — STORAGE-ONLY, same gate as documents just
  // above: it backs AI-write undo, not a user-facing export, so a workspace
  // with no history must serialize byte-for-byte as it did before the field
  // existed (the golden fixtures pin those bytes).
  if (config === undefined && ws.documentVersions && ws.documentVersions.length)
    mdParts.push(documentVersionsToMarkdown(ws.documentVersions));
  // Activity log — STORAGE-ONLY, same gate as documents/documentVersions above:
  // an entry's `changes` is an internal audit trail, not a user-facing export.
  // Emitted only when present, so a log-less workspace serializes byte-for-byte
  // as it did before the field existed (the golden fixtures pin those bytes).
  if (config === undefined && ws.activityLog && ws.activityLog.length)
    mdParts.push(activityLogToMarkdown(ws.activityLog));
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

/**
 * Decode a markdown table into entities: read each row (label→value, already
 * mdUnescaped by markdownTableToObjects), remap column labels to canonical
 * sanitizer field keys via `aliases` (normalized label → field), then run each
 * mapped row through `build`, dropping rows `build` rejects (null). Collapses
 * the per-entity decoders that share this exact shape.
 */
export function decodeMdTable<T>(
  md: string,
  aliases: Record<string, string>,
  build: (obj: Record<string, string>) => T | null,
  diag?: ImportDiag,
): T[] {
  const out: T[] = [];
  for (const row of markdownTableToObjects(md)) {
    const mapped: Record<string, string> = {};
    for (const [label, val] of Object.entries(row)) {
      const canonical = aliases[label.toLowerCase().replace(/\s+/g, "")];
      if (canonical) mapped[canonical] = val;
    }
    const item = build(mapped);
    if (item !== null) out.push(item);
    else if (diag) diag.droppedRows++;
  }
  return out;
}
