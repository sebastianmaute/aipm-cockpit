// src/app/csv-codecs-config.ts
//
// CSV codec CONFIG/PROJECT layer: status / field-visibility / features /
// steering-committee config-blob codecs, the ProjectMeta key-value codecs, and
// the `workspaceToCsv` encoder assembler. Depends only on ./csv-codecs-core.
// Re-exported via the ./csv-codecs barrel.

import { encodeKnowledgeLinks, decodeKnowledgeLinks } from "./document-link";
import { sanitizeProjectMeta, sanitizeSteeringCommittee } from "./sanitize";
import { sanitizeTimelogLinks } from "./timelog-sanitize";
import type { TimelogLinks } from "./timelog-types";
import { sanitizeSettingsOverrides, hasAnyOverride } from "./settings-overrides";
import { sanitizeFeatures, type FeatureModuleId } from "./feature-modules";
import {
  type ContactPerson,
  type ProjectMeta,
  type ProjectStatus,
  type SteeringCommittee,
} from "./types";
import type { ExportConfig, SettingsOverrides } from "./settings-types";
import { EXPORT_SECTION_KEYS } from "./settings-types";
import { type Workspace, sanitizeProjectStatus } from "./workspace";
import { sanitizeFieldVisibility, type FieldVisibilityConfig } from "./field-visibility";
import {
  CSV_SECTION_ABSENCES,
  CSV_SECTION_BUDGETS,
  CSV_SECTION_CALENDAR_EVENTS,
  CSV_SECTION_CHANGES,
  CSV_SECTION_DISCIPLINES,
  CSV_SECTION_FIELD_VIS,
  CSV_SECTION_FUNCTIONS,
  CSV_SECTION_GRADES,
  CSV_SECTION_MILESTONES,
  CSV_SECTION_PROJECT,
  CSV_SECTION_RAID,
  CSV_SECTION_RESOURCES,
  CSV_SECTION_ROLES,
  CSV_SECTION_SHIFTS,
  CSV_SECTION_STAKEHOLDERS,
  CSV_SECTION_STATUS,
  CSV_SECTION_STEERING,
  CSV_SECTION_TIMELOG_LINKS,
  CSV_SECTION_KNOWLEDGE_ITEMS,
  CSV_SECTION_INSIGHTS,
  CSV_SECTION_SETTINGS_OVERRIDES,
  CSV_SECTION_TASKS,
  absencesToCsv,
  budgetsToCsv,
  calendarEventsToCsv,
  changesToCsv,
  csvCellEscape,
  fxRatesToCsvLine,
  milestonesToCsv,
  parseCsv,
  planToCsvLine,
  raidToCsv,
  refsToCsv,
  resourcesToCsv,
  rolesToCsv,
  shiftsToCsv,
  stakeholdersToCsv,
  tasksToCsv,
} from "./csv-codecs-core";
import { sanitizeKnowledgeItems, type KnowledgeItem } from "./document-link";
import { sanitizeInsights } from "./insights/sanitize-insights";
import type { Insight } from "./insights/insight";

// --- Project Status CSV encoder / decoder ------------------------------------

export const STATUS_FIELDS: readonly (keyof ProjectStatus)[] = [
  "ragOverride", "scheduleOverride", "budgetOverride", "scopeOverride",
  "narrative", "narrativeUpdatedAt",
];

export function statusToCsv(status: ProjectStatus, neutralize = false): string {
  const rows: string[] = ["field,value"];
  for (const f of STATUS_FIELDS) {
    const v = status[f];
    if (v != null && v !== "") rows.push(`${f},${csvCellEscape(String(v), neutralize)}`);
  }
  return rows.join("\r\n");
}

export function csvToStatus(text: string): ProjectStatus {
  const rows = parseCsv(text).filter((r) => r.length >= 2 && r[0] && !r[0].startsWith("#"));
  const map: Record<string, string> = {};
  for (const [k, v] of rows) {
    if (k === "field") continue; // header row
    map[k] = v;
  }
  return sanitizeProjectStatus(map);
}

// --- Field-visibility encoder / decoder --------------------------------------
//
// The per-project field-visibility config is small and shaped like a nested
// map, so it serializes as a single `config,<json>` row rather than a column
// table. Not a user-exportable section: emission is gated purely on the value
// being present (never routed through the export `enabled(...)` allowlist).

export function fieldVisibilityToCsv(cfg: FieldVisibilityConfig, neutralize = false): string {
  return ["config", csvCellEscape(JSON.stringify(cfg), neutralize)].join(",");
}

export function csvToFieldVisibility(text: string): FieldVisibilityConfig | undefined {
  const rows = parseCsv(text).filter((r) => r.length >= 2 && r[0] === "config");
  if (rows.length === 0) return undefined;
  try {
    return sanitizeFieldVisibility(JSON.parse(rows[0][1]));
  } catch {
    return undefined;
  }
}

// --- Per-project feature-module list encoder / decoder -----------------------
//
// The per-project features list is small and shape-identical to the settings
// features array, so it serializes as a single `config,<json>` row (same
// approach as field-visibility). Emission is gated on PRESENCE (not length),
// so an explicit `[]` (Simple mode) round-trips correctly as `[]`.

export function featuresToCsv(features: readonly FeatureModuleId[], neutralize = false): string {
  return ["config", csvCellEscape(JSON.stringify(features), neutralize)].join(",");
}

export function csvToFeatures(text: string): FeatureModuleId[] | undefined {
  const rows = parseCsv(text).filter((r) => r.length >= 2 && r[0] === "config");
  if (rows.length === 0) return undefined;
  try {
    return sanitizeFeatures(JSON.parse(rows[0][1]));
  } catch {
    return undefined;
  }
}

// --- Steering-committee encoder / decoder ------------------------------------
//
// The steering committee is a single NESTED object (board membership, meetings,
// info-pack cadence), so — like field-visibility — it serializes as one
// `config,<json>` row rather than a column table. Storage-only, NOT a
// user-exportable section: emission is gated purely on the value being present.

export function steeringCommitteeToCsv(committee: SteeringCommittee, neutralize = false): string {
  return ["config", csvCellEscape(JSON.stringify(committee), neutralize)].join(",");
}

export function csvToSteeringCommittee(text: string): SteeringCommittee | undefined {
  const rows = parseCsv(text).filter((r) => r.length >= 2 && r[0] === "config");
  if (rows.length === 0) return undefined;
  try {
    return sanitizeSteeringCommittee(JSON.parse(rows[0][1]));
  } catch {
    return undefined;
  }
}

// --- Timelog-links encoder / decoder -----------------------------------------

export function timelogLinksToCsv(links: TimelogLinks, neutralize = false): string {
  return ["config", csvCellEscape(JSON.stringify(links), neutralize)].join(",");
}

export function csvToTimelogLinks(text: string): TimelogLinks | undefined {
  const rows = parseCsv(text).filter((r) => r.length >= 2 && r[0] === "config");
  if (rows.length === 0) return undefined;
  try {
    return sanitizeTimelogLinks(JSON.parse(rows[0][1]));
  } catch {
    return undefined;
  }
}

// --- Settings-overrides encoder / decoder ------------------------------------
//
// Per-project policy overrides — a single nested config blob (like the
// timelog/steering blobs), so it serializes as one `config,<json>` row.
// Storage-only, NOT a user-exportable section: emission is gated purely on the
// value being present + carrying >= 1 valid override.

export function settingsOverridesToCsv(overrides: SettingsOverrides, neutralize = false): string {
  return ["config", csvCellEscape(JSON.stringify(overrides), neutralize)].join(",");
}

export function csvToSettingsOverrides(text: string): SettingsOverrides | undefined {
  const rows = parseCsv(text).filter((r) => r.length >= 2 && r[0] === "config");
  if (rows.length === 0) return undefined;
  try {
    const o = sanitizeSettingsOverrides(JSON.parse(rows[0][1]));
    return hasAnyOverride(o) ? o : undefined;
  } catch {
    return undefined;
  }
}

// --- Standalone knowledge-items encoder / decoder ----------------------------
//
// Like the timelog/steering blobs this is a single `config,<json>` row, but —
// unlike them — it is a first-class EXPORTABLE section (gated by the
// `knowledgeItems` export key), not storage-only.

export function knowledgeItemsToCsv(items: readonly KnowledgeItem[], neutralize = false): string {
  return ["config", csvCellEscape(JSON.stringify(items), neutralize)].join(",");
}

export function csvToKnowledgeItems(text: string): KnowledgeItem[] | undefined {
  const rows = parseCsv(text).filter((r) => r.length >= 2 && r[0] === "config");
  if (rows.length === 0) return undefined;
  try {
    const items = sanitizeKnowledgeItems(JSON.parse(rows[0][1]));
    return items.length ? items : undefined;
  } catch {
    return undefined;
  }
}

// --- Insights encoder / decoder ----------------------------------------------
//
// Same single `config,<json>` row shape as knowledge items; a first-class
// EXPORTABLE section (gated by the `insights` export key).

export function insightsToCsv(insights: readonly Insight[], neutralize = false): string {
  return ["config", csvCellEscape(JSON.stringify(insights), neutralize)].join(",");
}

export function csvToInsights(text: string): Insight[] | undefined {
  const rows = parseCsv(text).filter((r) => r.length >= 2 && r[0] === "config");
  if (rows.length === 0) return undefined;
  try {
    const ins = sanitizeInsights(JSON.parse(rows[0][1]));
    return ins.length ? ins : undefined;
  } catch {
    return undefined;
  }
}

// --- Project metadata encoder / decoder --------------------------------------
//
// ProjectMeta is a SINGLE object (like ProjectStatus), so it serializes as a
// `field,value` key-value block — NOT a row table. Both CSV and Markdown share
// the same per-field string form produced by `projectFieldToString`, so every
// emitted value is a single line (newlines/pipes/backslashes are escaped) which
// keeps the Markdown `- field: value` bullet parser robust.

/** All ProjectMeta fields, in a fixed serialization order. */
export const PROJECT_CSV_COLUMNS: Array<keyof ProjectMeta> = [
  "name", "code", "description",
  "sponsor", "projectManager", "keyStakeholdersInternal", "keyStakeholdersExternal",
  "customer", "naceSection", "identityTypes", "identityCount", "stakeholderCount",
  "products", "platform", "deployment", "startDate", "endDate",
  "profitCenter", "quotes", "salesforceUrl", "sharepointUrl", "confluenceUrl", "jiraUrl",
  "operatingTimezone",
  "contactPersons", "docRepoLocation", "regulatory", "notes",
  "knowledgeLinks",
];

/** The list delimiter used across this file for joined string arrays. */
const PROJECT_LIST_DELIM = "|";

/** Reversible single-line escape for an arbitrary scalar value. Escapes the
 *  backslash first, then encodes newlines so the value never spans lines (the
 *  Markdown bullet parser is line-oriented). */
function encodeProjectScalar(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function decodeProjectScalar(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "\\" && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === "n") { out += "\n"; i++; continue; }
      if (next === "r") { out += "\r"; i++; continue; }
      if (next === "\\") { out += "\\"; i++; continue; }
    }
    out += c;
  }
  return out;
}

/** Join a string array with the list delimiter, escaping the delimiter (and
 *  backslash, carriage-return, newline) within each item so the split is
 *  lossless and the result is always single-line (the Markdown bullet parser
 *  is line-oriented). Escape order: `\\` first, then `|`, then `\r`, then
 *  `\n` — keeps the encoding unambiguous. */
export function encodeProjectList(items: readonly string[]): string {
  return items
    .map((s) =>
      s
        .replace(/\\/g, "\\\\")
        .replace(/\|/g, "\\|")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n"),
    )
    .join(PROJECT_LIST_DELIM);
}

export function decodeProjectList(text: string): string[] {
  if (text === "") return [];
  const parts: string[] = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === "|") { buf += "|"; i++; continue; }
      if (next === "\\") { buf += "\\"; i++; continue; }
      if (next === "n") { buf += "\n"; i++; continue; }
      if (next === "r") { buf += "\r"; i++; continue; }
    }
    if (c === PROJECT_LIST_DELIM) { parts.push(buf); buf = ""; continue; }
    buf += c;
  }
  parts.push(buf);
  return parts;
}

/** Reversible encoder for contactPersons. Each entry is `name;email;synced`
 *  with `\`, `;` and `|` escaped within sub-fields; entries are joined with the
 *  list delimiter. */
export function encodeContactPersons(people: readonly ContactPerson[]): string {
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/\|/g, "\\|");
  return people
    .map((p) => {
      const base = `${esc(p.name)};${esc(p.email)};${p.synced ? "1" : "0"}`;
      return typeof p.resourceId === "number" ? `${base};${p.resourceId}` : base;
    })
    .join(PROJECT_LIST_DELIM);
}

export function decodeContactPersons(text: string): ContactPerson[] {
  if (text === "") return [];
  // Split into entries on the un-escaped list delimiter.
  const entries: string[] = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length) { buf += c + text[i + 1]; i++; continue; }
    if (c === PROJECT_LIST_DELIM) { entries.push(buf); buf = ""; continue; }
    buf += c;
  }
  entries.push(buf);

  const unescape = (s: string) => {
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "\\" && i + 1 < s.length) {
        const next = s[i + 1];
        if (next === ";" || next === "|" || next === "\\") { out += next; i++; continue; }
      }
      out += c;
    }
    return out;
  };

  const splitFields = (entry: string): string[] => {
    const fields: string[] = [];
    let f = "";
    for (let i = 0; i < entry.length; i++) {
      const c = entry[i];
      if (c === "\\" && i + 1 < entry.length) { f += c + entry[i + 1]; i++; continue; }
      if (c === ";") { fields.push(f); f = ""; continue; }
      f += c;
    }
    fields.push(f);
    return fields;
  };

  const people: ContactPerson[] = [];
  for (const entry of entries) {
    const [name = "", email = "", synced = "0", rid = ""] = splitFields(entry);
    people.push({
      name: unescape(name),
      email: unescape(email),
      synced: synced === "1",
      ...(rid !== "" ? { resourceId: Number(rid) } : {}),
    });
  }
  return people;
}

const PROJECT_ARRAY_COLUMNS = new Set<keyof ProjectMeta>([
  "keyStakeholdersInternal", "keyStakeholdersExternal", "identityTypes", "regulatory",
]);

/** Single-line, reversible string form for one ProjectMeta field. */
export function projectFieldToString(p: ProjectMeta, col: keyof ProjectMeta): string {
  if (col === "knowledgeLinks") return encodeKnowledgeLinks(p.knowledgeLinks);
  if (col === "contactPersons") return encodeContactPersons(p.contactPersons);
  if (PROJECT_ARRAY_COLUMNS.has(col)) {
    const arr = p[col] as string[] | undefined;
    return Array.isArray(arr) ? encodeProjectList(arr) : "";
  }
  const v = p[col];
  if (v === undefined || v === null) return "";
  return encodeProjectScalar(String(v));
}

/** Decode a `field -> raw string` map (as produced by the CSV/MD parsers, or a
 *  Turso `projects` row) into the loose pre-sanitize ProjectMeta-shaped object.
 *  Shared by the strict `buildProjectFromObj` and the lenient
 *  `buildProjectFromObjLenient` so the per-field decode logic lives once. */
function decodeProjectObj(obj: Record<string, string>): Record<string, unknown> {
  const scalar = (key: string): string | undefined =>
    obj[key] !== undefined ? decodeProjectScalar(obj[key]) : undefined;
  return {
    name: scalar("name"),
    code: scalar("code"),
    description: scalar("description"),
    sponsor: scalar("sponsor"),
    projectManager: scalar("projectManager"),
    keyStakeholdersInternal: decodeProjectList(obj.keyStakeholdersInternal ?? ""),
    keyStakeholdersExternal: decodeProjectList(obj.keyStakeholdersExternal ?? ""),
    customer: scalar("customer"),
    naceSection: scalar("naceSection"),
    identityTypes: decodeProjectList(obj.identityTypes ?? ""),
    identityCount: obj.identityCount !== undefined && obj.identityCount !== ""
      ? obj.identityCount
      : undefined,
    stakeholderCount: obj.stakeholderCount !== undefined && obj.stakeholderCount !== ""
      ? obj.stakeholderCount
      : undefined,
    products: scalar("products"),
    platform: scalar("platform"),
    deployment: scalar("deployment"),
    startDate: scalar("startDate"),
    endDate: scalar("endDate"),
    profitCenter: scalar("profitCenter"),
    quotes: scalar("quotes"),
    salesforceUrl: scalar("salesforceUrl"),
    sharepointUrl: scalar("sharepointUrl"),
    confluenceUrl: scalar("confluenceUrl"),
    jiraUrl: scalar("jiraUrl"),
    operatingTimezone: scalar("operatingTimezone"),
    contactPersons: decodeContactPersons(obj.contactPersons ?? ""),
    docRepoLocation: scalar("docRepoLocation"),
    regulatory: decodeProjectList(obj.regulatory ?? ""),
    notes: scalar("notes"),
    knowledgeLinks: decodeKnowledgeLinks(obj.knowledgeLinks ?? obj.documentLinks ?? ""),
  };
}

/** Decode a `field -> raw string` map (as produced by the CSV/MD parsers) back
 *  into a sanitized ProjectMeta. Returns null when the data is invalid. */
export function buildProjectFromObj(obj: Record<string, string>): ProjectMeta | null {
  return sanitizeProjectMeta(decodeProjectObj(obj));
}

/** Lenient decode for an ALREADY-PERSISTED project row (e.g. a Turso `projects`
 *  table row, the multi-tenant source of truth). Decodes the raw column map via
 *  `decodeProjectObj`, then runs the SAME `sanitizeProjectMeta` as the strict
 *  path but with `lenientRequiredArrays: true`. That flag skips ONLY the three
 *  empty-required-array rejections (keyStakeholdersInternal, keyStakeholdersExternal,
 *  regulatory) while still enforcing all required scalars (name, code, etc.),
 *  required enums (naceSection, deployment), required dates, and all per-field
 *  sanitization. Why lenient? A project already stored in the DB must never be
 *  silently dropped on read solely because, e.g., it has no external stakeholders. */
export function buildProjectFromObjLenient(obj: Record<string, string>): ProjectMeta | null {
  return sanitizeProjectMeta(decodeProjectObj(obj), { lenientRequiredArrays: true });
}

/** Serializes ProjectMeta as a `field,value` CSV block (mirrors statusToCsv).
 *  Only non-empty fields are emitted, so absent optionals round-trip cleanly. */
export function projectToCsv(project: ProjectMeta, neutralize = false): string {
  const rows: string[] = ["field,value"];
  for (const col of PROJECT_CSV_COLUMNS) {
    const v = projectFieldToString(project, col);
    if (v !== "") rows.push(`${col},${csvCellEscape(v, neutralize)}`);
  }
  return rows.join("\r\n");
}

export function csvToProject(text: string): ProjectMeta | null {
  const rows = parseCsv(text).filter((r) => r.length >= 2 && r[0] && !r[0].startsWith("#"));
  const map: Record<string, string> = {};
  for (const [k, v] of rows) {
    if (k === "field") continue; // header row
    map[k] = v;
  }
  return buildProjectFromObj(map);
}

/** Multi-section CSV: tasks then (optionally) raid, absences, and shifts,
 *  separated by marker lines. Used by file backends for round-trip;
 *  `tasksToCsv` remains the marker-less variant that the Export menu uses
 *  for one-way downloads.
 *
 *  @param config When provided (document export), only sections enabled in the
 *  config are emitted and storage-only sections (disciplines, grades, fxRates,
 *  plan) are omitted. When undefined (default), ALL sections are emitted for
 *  full round-trip storage fidelity. */
export function workspaceToCsv(ws: Workspace, config?: ExportConfig): string {
  const enabled = (key: (typeof EXPORT_SECTION_KEYS)[number]) =>
    config === undefined || config[key];
  // neutralize = true only on the document-export path (config provided).
  // The storage path (config === undefined) must stay byte-identical.
  const neutralize = config !== undefined;

  const parts: string[] = [];
  const csvPush = (...items: string[]) => {
    if (parts.length > 0) parts.push("");
    parts.push(...items);
  };
  if (!config || config.tasks) csvPush(CSV_SECTION_TASKS, tasksToCsv(ws.tasks, neutralize));
  if (enabled("raid") && ws.raid.length > 0) csvPush(CSV_SECTION_RAID, raidToCsv(ws.raid, neutralize));
  if (enabled("absences") && ws.absences.length > 0) csvPush(CSV_SECTION_ABSENCES, absencesToCsv(ws.absences, neutralize));
  // Calendar events are a first-class ExportSectionKey (default ON) — same
  // enabled()-gated pattern as raid/absences/shifts above.
  if (enabled("calendarEvents") && ws.calendarEvents && ws.calendarEvents.length > 0)
    csvPush(CSV_SECTION_CALENDAR_EVENTS, calendarEventsToCsv(ws.calendarEvents, neutralize));
  if (enabled("shifts") && ws.shifts.length > 0) csvPush(CSV_SECTION_SHIFTS, shiftsToCsv(ws.shifts, neutralize));
  if (config === undefined) {
    // Storage-only sections — omitted from document exports.
    if (ws.disciplines.length > 0) csvPush(CSV_SECTION_DISCIPLINES, refsToCsv(ws.disciplines));
    if (ws.grades.length > 0) csvPush(CSV_SECTION_GRADES, refsToCsv(ws.grades));
  }
  if (enabled("roles") && ws.roles.length > 0) csvPush(CSV_SECTION_ROLES, rolesToCsv(ws.roles, neutralize));
  if (enabled("resources") && ws.resources.length > 0) csvPush(CSV_SECTION_RESOURCES, resourcesToCsv(ws.resources, neutralize));
  if (enabled("budgets") && (ws.budgets ?? []).length > 0) csvPush(CSV_SECTION_BUDGETS, budgetsToCsv(ws.budgets ?? [], neutralize));
  if (config === undefined && ws.fxRates) csvPush(fxRatesToCsvLine(ws.fxRates));
  if (enabled("status") && ws.status && Object.keys(ws.status).length > 0) csvPush(CSV_SECTION_STATUS, statusToCsv(ws.status, neutralize));
  if (enabled("milestones") && (ws.milestones ?? []).length > 0) csvPush(CSV_SECTION_MILESTONES, milestonesToCsv(ws.milestones ?? [], neutralize));
  if (enabled("changes") && (ws.changes ?? []).length > 0) csvPush(CSV_SECTION_CHANGES, changesToCsv(ws.changes ?? [], neutralize));
  if (enabled("stakeholders") && (ws.stakeholders ?? []).length > 0) csvPush(CSV_SECTION_STAKEHOLDERS, stakeholdersToCsv(ws.stakeholders ?? [], neutralize));
  if (config === undefined) csvPush(planToCsvLine(ws.plan));
  // Project metadata — additive, storage-only for now (document export wires it
  // in later). Emitted last so a no-project workspace's bytes are an exact
  // prefix of a with-project one. Only when a project is present.
  if (config === undefined && ws.project) csvPush(CSV_SECTION_PROJECT, projectToCsv(ws.project, neutralize));
  // Field-visibility — storage-only, NOT a user-exportable section. Gated only
  // on the value being present so an empty/undefined config emits nothing and
  // the byte-stable storage round-trip is preserved.
  if (ws.fieldVisibility && Object.keys(ws.fieldVisibility).length > 0)
    csvPush(CSV_SECTION_FIELD_VIS, fieldVisibilityToCsv(ws.fieldVisibility, neutralize));
  if (ws.features !== undefined)
    csvPush(CSV_SECTION_FUNCTIONS, featuresToCsv(ws.features, neutralize));
  // Steering committee — storage-only, emitted last so it never shifts existing
  // fixture bytes; absent emits nothing (byte-stability for committee-less files).
  if (config === undefined && ws.steeringCommittee)
    csvPush(CSV_SECTION_STEERING, steeringCommitteeToCsv(ws.steeringCommittee, neutralize));
  // Timelog links — storage-only, same byte-stability gate as steering.
  if (config === undefined && ws.timelogLinks)
    csvPush(CSV_SECTION_TIMELOG_LINKS, timelogLinksToCsv(ws.timelogLinks, neutralize));
  // Settings overrides — storage-only, same byte-stability gate; absent/empty
  // emits nothing so override-less files round-trip byte-identically.
  if (config === undefined && ws.settingsOverrides && hasAnyOverride(ws.settingsOverrides))
    csvPush(CSV_SECTION_SETTINGS_OVERRIDES, settingsOverridesToCsv(ws.settingsOverrides, neutralize));
  // Standalone knowledge items — EXPORTABLE (gated by the export key), emitted
  // only when present so committee-less/legacy files stay byte-stable.
  if (enabled("knowledgeItems") && ws.knowledgeItems && ws.knowledgeItems.length)
    csvPush(CSV_SECTION_KNOWLEDGE_ITEMS, knowledgeItemsToCsv(ws.knowledgeItems, neutralize));
  // Insights — EXPORTABLE (gated by the export key), emitted only when present
  // so insight-less files stay byte-stable.
  if (enabled("insights") && ws.insights && ws.insights.length)
    csvPush(CSV_SECTION_INSIGHTS, insightsToCsv(ws.insights, neutralize));
  return parts.join("\r\n");
}
