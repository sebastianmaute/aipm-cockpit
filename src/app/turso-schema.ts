// src/app/turso-schema.ts
//
// Pure relational mapping for the Turso backend. DDL/INSERT/SELECT are
// generated generically from a registry whose column sets + encoders +
// sanitizers are the SAME ones the CSV backend uses (exported from
// csv-codecs.ts / sanitize.ts) — so no per-field mapping is duplicated.

import {
  CSV_COLUMNS, RAID_CSV_COLUMNS, ABSENCES_CSV_COLUMNS, SHIFTS_CSV_COLUMNS,
  RESOURCES_CSV_COLUMNS, ROLES_CSV_COLUMNS, REF_CSV_COLUMNS, BUDGETS_CSV_COLUMNS,
  MILESTONES_CSV_COLUMNS, CHANGES_CSV_COLUMNS, STAKEHOLDERS_CSV_COLUMNS, EVENTS_CSV_COLUMNS,
  fieldToString, raidFieldToString, absenceFieldToString, shiftFieldToString,
  resourceFieldToString, budgetFieldToString, milestoneFieldToString, buildTaskFromObj, buildRaidItemFromObj,
  buildMilestoneFromObj, changeFieldToString, buildChangeFromObj, buildAbsenceFromObj,
  stakeholderFieldToString, buildStakeholderFromObj,
  calendarEventFieldToString, buildCalendarEventFromObj,
  decodeRatesMap,
  DOCUMENT_ASSETS_CSV_COLUMNS, documentAssetFieldToString, buildDocumentAssetFromObj,
} from "./csv-codecs";
import {
  emptyWorkspace, migrateWorkspaceV10, sanitizeProjectStatus, type Workspace,
} from "./workspace";
import { sanitizeActivityLog } from "./activity-log";
import { sanitizeBudgetHistory } from "./budget-history";
import { sanitizeFieldVisibility } from "./field-visibility";
import { sanitizeFeatures } from "./feature-modules";
import {
  sanitizeResource, sanitizeRole, sanitizeLoadedBudgetBucket, sanitizeDiscipline,
  sanitizeGrade, sanitizeShift, sanitizeLoadedFxRates, sanitizePlan,
  sanitizeSteeringCommittee, sanitizeLoadedProjectMeta,
} from "./sanitize";
import { sanitizeTimelogLinks } from "./timelog-sanitize";
import { sanitizeKnowledgeItems } from "./document-link";
import { sanitizeInsights } from "./insights/sanitize-insights";
import { sanitizeProjectDocumentsWithDiag, type DocTruncationDiag } from "./document-model";
import { sanitizeDocumentRichFields } from "./document-rich-fields";
import { sanitizeDocumentVersionsWithDiag } from "./document-versions";
import { sanitizeSettingsOverrides, hasAnyOverride } from "./settings-overrides";
import { logDiag } from "./diagnostics";
import { noteDecodeFailure, sanitizedToNothing } from "./meta-slice-decode";
import { rethrowIfDomUnavailable } from "./dom-unavailable-error";
import type {
  Task, RaidItem, Absence, Shift, Resource, Role, Discipline, Grade, BudgetBucket, Milestone, ChangeItem, Stakeholder,
} from "./types";
import type { CalendarEvent } from "./calendar-event";
import type { DocumentAsset } from "./document-asset";

interface SqlArg { type: "text" | "integer" | "null"; value?: string }
export interface SqlStmt { sql: string; args?: SqlArg[] }
export interface PipelineResultLike {
  type: "ok" | "error";
  response?: { type: string; result?: { cols?: { name?: string }[]; rows?: { value?: unknown }[][] } };
  error?: { message?: string };
}

/** How an entity's `id` column is typed in SQLite AND bound on the wire.
 *
 *  ★★★ THE TWO MUST AGREE. `id INTEGER PRIMARY KEY` is a rowid ALIAS, which is
 *  the one column type SQLite enforces — a non-numeric value is rejected with
 *  "datatype mismatch", and every workspace save then reports failure. So an
 *  entity minting a non-numeric id (`document_assets`, a crypto.randomUUID())
 *  must declare "text", which switches BOTH the DDL and the arg binding.
 *
 *  ★★★ A libSQL /v2/pipeline sent as separate `execute` requests does NOT
 *  abort at a failing statement: it errors that ONE statement and keeps going,
 *  so COMMIT used to commit everything that succeeded around the rejected row
 *  while the save reported failure (measured against a live database; the e2e
 *  spec named in AGENTS.md's idKind bullet). Since §637 `runTursoPipeline`
 *  sends a BEGIN…COMMIT list as ONE conditional Hrana `batch`, so the failing
 *  row now skips COMMIT and the save writes nothing (per the Hrana protocol;
 *  the live-database check is owed). Every save still reports failure until
 *  the DDL is fixed.
 *
 *  "text", which switches BOTH the DDL and the arg binding. The tenant DDL
 *  emits a plain `id INTEGER` (composite PK), whose affinity SQLite does NOT
 *  enforce — but the Hrana wire type still must, since `{type:"integer"}`
 *  carries a decimal i64 as a string. */
export type EntityIdKind = "integer" | "text";

export interface EntitySpec<T> {
  table: string;
  wsKey: keyof Workspace;
  columns: readonly string[];
  /** Defaults to "integer" — every entity but `document_assets` mints a number. */
  idKind?: EntityIdKind;
  get: (ws: Workspace) => readonly T[];
  toRow: (e: T, col: string) => string;
  fromObj: (obj: Record<string, string>) => T | null;
}
function spec<T>(s: EntitySpec<T>): EntitySpec<T> { return s; }
const anyToRow = (r: unknown, c: string) =>
  String((r as Record<string, unknown>)[c] ?? "");

// Heterogeneous registry: each spec's wsKey MUST point to a `T[]` field on
// Workspace (enforced structurally by spec<T>() before the union-erasing cast
// below). rowsToWorkspace assigns the sanitized T[] back to ws[wsKey].
export const ENTITY_SPECS: EntitySpec<unknown>[] = [
  spec<Task>({ table: "tasks", wsKey: "tasks", columns: CSV_COLUMNS, get: (w) => w.tasks, toRow: fieldToString as unknown as (e: Task, col: string) => string, fromObj: buildTaskFromObj }),
  spec<RaidItem>({ table: "raid", wsKey: "raid", columns: RAID_CSV_COLUMNS, get: (w) => w.raid, toRow: raidFieldToString as unknown as (e: RaidItem, col: string) => string, fromObj: buildRaidItemFromObj }),
  spec<Absence>({ table: "absences", wsKey: "absences", columns: ABSENCES_CSV_COLUMNS, get: (w) => w.absences, toRow: absenceFieldToString as unknown as (e: Absence, col: string) => string, fromObj: buildAbsenceFromObj }),
  spec<Shift>({ table: "shifts", wsKey: "shifts", columns: SHIFTS_CSV_COLUMNS, get: (w) => w.shifts, toRow: shiftFieldToString as unknown as (e: Shift, col: string) => string, fromObj: sanitizeShift }),
  spec<Resource>({ table: "resources", wsKey: "resources", columns: RESOURCES_CSV_COLUMNS, get: (w) => w.resources, toRow: resourceFieldToString, fromObj: sanitizeResource }),
  spec<Role>({ table: "roles", wsKey: "roles", columns: ROLES_CSV_COLUMNS, get: (w) => w.roles, toRow: anyToRow as (e: Role, col: string) => string, fromObj: sanitizeRole }),
  spec<Discipline>({ table: "disciplines", wsKey: "disciplines", columns: REF_CSV_COLUMNS, get: (w) => w.disciplines, toRow: anyToRow as (e: Discipline, col: string) => string, fromObj: sanitizeDiscipline }),
  spec<Grade>({ table: "grades", wsKey: "grades", columns: REF_CSV_COLUMNS, get: (w) => w.grades, toRow: anyToRow as (e: Grade, col: string) => string, fromObj: sanitizeGrade }),
  spec<BudgetBucket>({ table: "budget_buckets", wsKey: "budgets", columns: BUDGETS_CSV_COLUMNS, get: (w) => w.budgets ?? [], toRow: budgetFieldToString, fromObj: sanitizeLoadedBudgetBucket }),
  spec<Milestone>({ table: "milestones", wsKey: "milestones", columns: MILESTONES_CSV_COLUMNS, get: (w) => w.milestones ?? [], toRow: milestoneFieldToString as unknown as (e: Milestone, col: string) => string, fromObj: buildMilestoneFromObj }),
  spec<ChangeItem>({ table: "changes", wsKey: "changes", columns: CHANGES_CSV_COLUMNS, get: (w) => w.changes ?? [], toRow: changeFieldToString as unknown as (e: ChangeItem, col: string) => string, fromObj: buildChangeFromObj }),
  spec<Stakeholder>({ table: "stakeholders", wsKey: "stakeholders", columns: STAKEHOLDERS_CSV_COLUMNS, get: (w) => w.stakeholders ?? [], toRow: stakeholderFieldToString as unknown as (e: Stakeholder, col: string) => string, fromObj: buildStakeholderFromObj }),
  spec<CalendarEvent>({ table: "calendar_events", wsKey: "calendarEvents", columns: EVENTS_CSV_COLUMNS, get: (w) => w.calendarEvents ?? [], toRow: calendarEventFieldToString as unknown as (e: CalendarEvent, col: string) => string, fromObj: buildCalendarEventFromObj }),
  spec<DocumentAsset>({ table: "document_assets", wsKey: "documentAssets", columns: DOCUMENT_ASSETS_CSV_COLUMNS, idKind: "text", get: (w) => w.documentAssets ?? [], toRow: documentAssetFieldToString, fromObj: buildDocumentAssetFromObj }),
] as unknown as EntitySpec<unknown>[];

export const PLAN_COLUMNS = ["startDate", "endDate", "granularity", "currency", "budgetFollowsPlan"] as const;
export const FX_COLUMNS = ["base", "date", "fetchedAt", "rates"] as const;

export function colDdl(columns: readonly string[], idKind: EntityIdKind = "integer"): string {
  const idDdl = idKind === "text" ? "id TEXT PRIMARY KEY" : "id INTEGER PRIMARY KEY";
  return columns.map((c) => (c === "id" ? idDdl : `"${c}" TEXT`)).join(", ");
}

export const SCHEMA_DDL: string[] = [
  ...ENTITY_SPECS.map((s) => `CREATE TABLE IF NOT EXISTS ${s.table} (${colDdl(s.columns, s.idKind)})`),
  `CREATE TABLE IF NOT EXISTS plan (id INTEGER PRIMARY KEY, ${PLAN_COLUMNS.map((c) => `"${c}" TEXT`).join(", ")})`,
  `CREATE TABLE IF NOT EXISTS fx_rates (id INTEGER PRIMARY KEY, ${FX_COLUMNS.map((c) => `"${c}" TEXT`).join(", ")})`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
];

export const TABLE_NAMES: readonly string[] = [...ENTITY_SPECS.map((s) => s.table), "plan", "fx_rates", "meta"];

export function selectStatements(): SqlStmt[] {
  return TABLE_NAMES.map((t) => ({ sql: `SELECT * FROM ${t}` }));
}

/** SqlArg builders shared by the out-of-TABLE_NAMES schema modules (comm-templates,
 *  comm/committee-report versions, learning, operating-guides, snapshots, version
 *  history, color-schemes). Single-source the text/integer arg shape so a booking
 *  in any of them can't drift from the workspace codec. */
export const txt = (value: string) => ({ type: "text" as const, value });
export const int = (value: number) => ({ type: "integer" as const, value: String(value) });

export function rowObjects(res: PipelineResultLike | undefined): Record<string, string>[] {
  const names = (res?.response?.result?.cols ?? []).map((c) => c?.name ?? "");
  const rows = res?.response?.result?.rows ?? [];
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    names.forEach((n, i) => {
      const cell = row[i];
      obj[n] = cell == null || cell.value == null ? "" : String(cell.value);
    });
    return obj;
  });
}

/** Assemble a Workspace from selectStatements() results (TABLE_NAMES order).
 *
 *  ★★ This decoder serves BOTH Turso modes — single-tenant and multi-tenant
 *  (turso-tenant-schema only builds the project-scoped SELECTs) — so the
 *  optional `diag` covers two of the six write paths at once. It is an
 *  accumulator the caller owns: the document and document-version sanitizers
 *  record into it what a load-time CAP silently discarded, so the backend can
 *  report the loss instead of truncating in silence. Omitting it decodes
 *  exactly as before. */
export function rowsToWorkspace(
  results: PipelineResultLike[],
  diag?: DocTruncationDiag,
): Workspace {
  if (results.length < TABLE_NAMES.length) {
    throw new Error(`rowsToWorkspace: expected at least ${TABLE_NAMES.length} results, got ${results.length}`);
  }
  const byTable = new Map<string, PipelineResultLike>();
  TABLE_NAMES.forEach((t, i) => byTable.set(t, results[i]));

  const ws = emptyWorkspace();
  for (const s of ENTITY_SPECS) {
    const items = rowObjects(byTable.get(s.table))
      .map((o) => s.fromObj(o))
      .filter((x): x is NonNullable<typeof x> => x !== null);
    (ws[s.wsKey] as unknown) = items;
  }
  const planRow = rowObjects(byTable.get("plan"))[0];
  if (planRow) ws.plan = sanitizePlan(planRow, new Date().toISOString().slice(0, 10));
  const fxRow = rowObjects(byTable.get("fx_rates"))[0];
  if (fxRow) {
    ws.fxRates = sanitizeLoadedFxRates({ base: fxRow.base, date: fxRow.date, fetchedAt: fxRow.fetchedAt, rates: decodeRatesMap(fxRow.rates ?? "") });
  }
  // ★★ NOT silent, and NOT a rethrow. The diagnostics ring is the channel for
  //    this loss, exactly as `jsonToWorkspace` does for the same class of
  //    failure on `documents` ("a user who opens a file and finds no
  //    documents has something to find"). Rethrowing would let ONE corrupt
  //    slice discard the whole workspace — the load already proceeds with
  //    whatever entity tables came back, so silently dropping this slice is
  //    the failure the diagnostic exists to surface instead.
  //
  //    Reports to BOTH channels, always: the diagnostics ring for an operator
  //    reading logs, and the `diag` accumulator for the caller — the ring is
  //    not reachable from the save-time load guard, and the accumulator is
  //    not visible to an operator reading logs.
  const reportUnreadableSlice = (slice: string, err: unknown): void => {
    logDiag("error", "turso.metaSliceUnreadable", {
      slice,
      message: err instanceof Error ? err.message : String(err),
    });
    noteDecodeFailure(slice, diag);
  };
  const metaRows = rowObjects(byTable.get("meta"));
  /** §617 — parse and sanitize ONE meta row. A throw is reported as before; a
   *  value that HAD content but sanitized to nothing is now reported too,
   *  instead of being dropped silently (for `project_meta` the next save then
   *  deleted the row for good). Reporting pauses saving, which is what keeps the
   *  stored row. `undefined` = assign nothing. */
  const decodeMeta = <T>(key: string, sanitize: (raw: unknown) => T): T | undefined => {
    const row = metaRows.find((r) => r.key === key);
    if (!row?.value) return undefined;
    try {
      const raw: unknown = JSON.parse(row.value);
      const out = sanitize(raw);
      if (sanitizedToNothing(raw, out)) {
        reportUnreadableSlice(key, new Error("parsed, but sanitized to nothing"));
        return undefined;
      }
      return out;
    } catch (err) {
      // §97 — a missing DOM is not an unreadable slice: fail the load.
      rethrowIfDomUnavailable(err);
      reportUnreadableSlice(key, err);
      return undefined;
    }
  };
  const status = decodeMeta("project_status", sanitizeProjectStatus);
  if (status !== undefined) ws.status = status;
  // §538 — single-tenant is the ONLY Turso layout with no projects row, so
  // project meta rides the meta table here; `rowsToWorkspace` reads
  // `project_meta` for single-tenant DBs only (see the NOTE above
  // `loadTenant` in turso-backend.ts — the tenant path overwrites `ws.project`
  // from the projects row afterwards, and the tenant builder never writes
  // `project_meta`, so tenant behaviour is unchanged).
  const pm = decodeMeta("project_meta", sanitizeLoadedProjectMeta);
  if (pm) ws.project = pm;
  const fv = decodeMeta("field_visibility", sanitizeFieldVisibility);
  if (fv) ws.fieldVisibility = fv;
  const features = decodeMeta("features", sanitizeFeatures);
  if (features !== undefined) ws.features = features;
  const sc = decodeMeta("steering_committee", sanitizeSteeringCommittee);
  if (sc) ws.steeringCommittee = sc;
  const tl = decodeMeta("timelog_links", sanitizeTimelogLinks);
  if (tl) ws.timelogLinks = tl;
  const ki = decodeMeta("knowledge_items", sanitizeKnowledgeItems);
  if (ki?.length) ws.knowledgeItems = ki;
  const ins = decodeMeta("insights", sanitizeInsights);
  if (ins?.length) ws.insights = ins;
  const log = decodeMeta("activityLog", sanitizeActivityLog);
  if (log?.length) ws.activityLog = log;
  const history = decodeMeta("budgetHistory", sanitizeBudgetHistory);
  if (history?.length) ws.budgetHistory = history;
  // Documents ride `meta` as one JSON blob — no table of their own, so
  // TABLE_NAMES stays untouched. TWO passes, in this order: the structural
  // sanitizer is DOM-FREE and cannot strip markup, so the rich-field allow-list
  // has to follow it or a stored `<script>` reaches the render sink. (One
  // argument, so it is safe as a bare .map callback — see document-rich-fields.)
  const docs = decodeMeta("documents", (raw) =>
    sanitizeProjectDocumentsWithDiag(raw, diag).map(sanitizeDocumentRichFields));
  if (docs?.length) ws.documents = docs;
  // documentVersions ride `meta` too — same two-pass shape as documents just
  // above. A version has no independent createdAt/updatedAt, so it is passed
  // through a synthetic ProjectDocument-shaped wrapper with savedAt standing
  // in for both (mirrors workspace.ts's JSON path and browser-backend.ts's
  // IndexedDB path).
  const versions = decodeMeta("documentVersions", (raw) =>
    sanitizeDocumentVersionsWithDiag(raw, diag).map((v) => ({
      ...v,
      blocks: sanitizeDocumentRichFields({
        id: v.documentId,
        title: v.title,
        blocks: v.blocks,
        createdAt: v.savedAt,
        updatedAt: v.savedAt,
      }).blocks,
    })));
  if (versions?.length) ws.documentVersions = versions;
  const so = decodeMeta("settings_overrides", sanitizeSettingsOverrides);
  if (so && hasAnyOverride(so)) ws.settingsOverrides = so;
  return migrateWorkspaceV10(ws);
}

// --- §4 revision ------------------------------------------------------------
//
// One `meta` row, key "revision" (tenant: per project_id), holding the integer
// count of saves. No row reads as "0". A save carries a GUARD statement that
// raises an SQLite error when the stored revision is not the one the saving
// instance last loaded or wrote; inside §637's conditional batch that error
// skips every later step, COMMIT included, and the batch rolls back — so the
// compare and the write are ONE atomic step against every writer, other devices
// included. The row is not a table, so TABLE_NAMES is untouched. A dirty `meta`
// DELETE spares it, and every save bumps it IN SQL (stored + 1), so even a blind
// write stamps past a value another device wrote after this window last read.
// ★ An empty stored value reads as "0" on BOTH sides — the loader and the guard.

export const REVISION_KEY = "revision";
/** In the guard's error message, followed by the stored revision. A readable detail only: a conflict is
 *  recognised by the failing STEP (`isRevisionGuard`), never by this text. */
export const REVISION_CONFLICT_MARKER = "turso-revision-conflict:";

/** How a save treats the revision. `expected` is the revision the guard demands; `null` =
 *  a blind write with no guard (`forceNextSave()`), which reads back the value it stamped. */
export interface RevisionStamp { expected: string | null }

/** The stored value as a count: NULL (no row) and "" both read as 0, matching `revisionFromMetaRows`. */
const STORED_COUNT = "coalesce(nullif(value, ''), '0')";

// Tagged by IDENTITY, so a caller finds the guard's step without matching its text.
const GUARDS = new WeakSet<SqlStmt>();
const READBACKS = new WeakSet<SqlStmt>();
export const isRevisionGuard = (s: SqlStmt): boolean => GUARDS.has(s);
export const isRevisionReadback = (s: SqlStmt): boolean => READBACKS.has(s);

const revisionWhere = (projectId?: string): { sql: string; args: SqlArg[] } =>
  projectId === undefined
    ? { sql: `key = '${REVISION_KEY}'`, args: [] }
    : { sql: `key = '${REVISION_KEY}' AND project_id = ?`, args: [txt(projectId)] };

/** ★ Raises on mismatch by handing `json_extract` a path that is not a JSON path
 *  (it must start with `$`). The path is built from the STORED value, so it is not
 *  a constant SQLite could evaluate up front, and the error names that value. */
export function revisionGuardStatement(expected: string, projectId?: string): SqlStmt {
  const where = revisionWhere(projectId);
  const guard: SqlStmt = {
    sql: `SELECT CASE WHEN r = ? THEN 1 ELSE json_extract('{}', '${REVISION_CONFLICT_MARKER}' || r) END ` +
      `FROM (SELECT coalesce(nullif((SELECT value FROM meta WHERE ${where.sql}), ''), '0') AS r)`,
    args: [txt(expected), ...where.args],
  };
  GUARDS.add(guard);
  return guard;
}

/** stored + 1, computed by the database inside the batch; the INSERT seeds 1 where there is no row. */
export function revisionStampStatements(projectId?: string): SqlStmt[] {
  const where = revisionWhere(projectId);
  const absent = `WHERE NOT EXISTS (SELECT 1 FROM meta WHERE ${where.sql})`;
  return [
    { sql: `UPDATE meta SET value = CAST(${STORED_COUNT} AS INTEGER) + 1 WHERE ${where.sql}`, args: where.args },
    projectId === undefined
      ? { sql: `INSERT INTO meta (key, value) SELECT '${REVISION_KEY}', '1' ${absent}`, args: [] }
      : { sql: `INSERT INTO meta (key, value, project_id) SELECT '${REVISION_KEY}', '1', ? ${absent}`, args: [txt(projectId), ...where.args] },
  ];
}

export function selectRevisionStatement(projectId?: string): SqlStmt {
  const where = revisionWhere(projectId);
  return { sql: `SELECT value FROM meta WHERE ${where.sql}`, args: where.args };
}

/** The stored revision in a `meta` SELECT result (all keys, or just the revision row); "0" when absent. */
export function revisionFromMetaRows(res: PipelineResultLike | undefined): string {
  const rows = rowObjects(res);
  const row = rows.find((r) => r.key === REVISION_KEY) ?? (rows.length && !("key" in rows[0]) ? rows[0] : undefined);
  return row?.value || "0";
}

/** The revision a save stamps after `rev`. A value that is not a count restarts at 1. */
export function nextRevision(rev: string): string {
  return String((/^\d+$/.test(rev) ? Number(rev) : 0) + 1);
}

/** BEGIN, the DDL, then the guard — before the first write, and after the DDL so a
 *  fresh database already has the `meta` table the guard reads. The stamp goes last, and a
 *  blind write then reads back what it stamped, still inside the transaction: that is the value this
 *  batch wrote, where a read after COMMIT could already see a later writer's. A guarded write needs
 *  no read — its guard proved stored = expected, so the stamp is expected + 1. */
export function withRevision(stmts: SqlStmt[], ddlCount: number, stamp: RevisionStamp | undefined, projectId?: string): SqlStmt[] {
  if (!stamp) return stmts;
  const head = stmts.slice(0, 1 + ddlCount);
  const body = stmts.slice(1 + ddlCount, -1);
  const guard = stamp.expected === null ? [] : [revisionGuardStatement(stamp.expected, projectId)];
  const readback: SqlStmt[] = [];
  if (stamp.expected === null) {
    const read = selectRevisionStatement(projectId);
    READBACKS.add(read);
    readback.push(read);
  }
  return [...head, ...guard, ...body, ...revisionStampStatements(projectId), ...readback, stmts[stmts.length - 1]];
}

// Bump on any schema/column change. NOTE: there is no ALTER-migration runner —
// adding a column means existing Turso databases (created before this column)
// need re-creation / sample re-import (as with documentLinks/resource-fk columns).
const SCHEMA_VERSION = "12";

function insertStmt(table: string, columns: readonly string[], values: string[], idKind: EntityIdKind = "integer"): SqlStmt {
  const colList = columns.map((c) => `"${c}"`).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  return {
    sql: `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`,
    // The id column keeps its historical verbatim pass-through on the integer
    // path (no Number() round-trip) — only the ARG TYPE is decided here.
    args: columns.map((c, i) => (c === "id" && idKind !== "text" ? { type: "integer", value: values[i] } : txt(values[i]))),
  };
}

/**
 * Table-level reference diff between two workspaces — the same trick
 * BrowserBackend.diff uses at row level: the codebase follows an
 * immutable-update convention, so a changed section gets a NEW reference and
 * `!==` reliably means "content changed". Maps each changed Workspace section
 * to its Turso table name (singletons: plan → plan, fxRates → fx_rates,
 * status → meta).
 *
 * `ws.project` dirties `meta`: single-tenant saves it as the `project_meta`
 * row (§538). The tenant builder ignores it (the projects row is written via
 * turso-portfolio.ts), so there the flag costs one meta rewrite and nothing
 * else.
 */
export function dirtyWorkspaceTables(prev: Workspace, next: Workspace): Set<string> {
  const dirty = new Set<string>();
  for (const s of ENTITY_SPECS) {
    if (prev[s.wsKey] !== next[s.wsKey]) dirty.add(s.table);
  }
  if (prev.plan !== next.plan) dirty.add("plan");
  if (prev.fxRates !== next.fxRates) dirty.add("fx_rates");
  if (prev.status !== next.status) dirty.add("meta");
  if (prev.project !== next.project) dirty.add("meta");
  if (prev.fieldVisibility !== next.fieldVisibility) dirty.add("meta");
  if (prev.features !== next.features) dirty.add("meta");
  if (prev.steeringCommittee !== next.steeringCommittee) dirty.add("meta");
  if (prev.timelogLinks !== next.timelogLinks) dirty.add("meta");
  if (prev.knowledgeItems !== next.knowledgeItems) dirty.add("meta");
  if (prev.insights !== next.insights) dirty.add("meta");
  if (prev.activityLog !== next.activityLog) dirty.add("meta");
  if (prev.budgetHistory !== next.budgetHistory) dirty.add("meta");
  if (prev.documents !== next.documents) dirty.add("meta");
  if (prev.documentVersions !== next.documentVersions) dirty.add("meta");
  if (prev.settingsOverrides !== next.settingsOverrides) dirty.add("meta");
  return dirty;
}

/**
 * Ordered statements that OVERWRITE the workspace, transactionally.
 *
 * When `dirtyTables` is provided, DELETE+INSERT are emitted only for those
 * tables (the others are untouched in the DB); the CREATE TABLE IF NOT EXISTS
 * set and BEGIN/COMMIT are ALWAYS emitted — DDL is cheap and guards the first
 * write against a fresh database. Omitting the param keeps the historical
 * full-rewrite behavior. §4: `stamp` adds the revision guard and re-stamps the
 * revision row (see `withRevision`); omitting it leaves the revision alone.
 */
export function workspaceToStatements(ws: Workspace, dirtyTables?: ReadonlySet<string>, stamp?: RevisionStamp): SqlStmt[] {
  const isDirty = (table: string) => dirtyTables === undefined || dirtyTables.has(table);
  const out: SqlStmt[] = [{ sql: "BEGIN" }];
  for (const ddl of SCHEMA_DDL) out.push({ sql: ddl });
  for (const name of TABLE_NAMES) {
    // §4 — the meta DELETE spares the revision row, which the stamp bumps from its stored value.
    if (isDirty(name)) out.push({ sql: name === "meta" ? `DELETE FROM meta WHERE key IS NOT '${REVISION_KEY}'` : `DELETE FROM ${name}` });
  }
  for (const s of ENTITY_SPECS) {
    if (!isDirty(s.table)) continue;
    for (const e of s.get(ws)) {
      out.push(insertStmt(s.table, s.columns, s.columns.map((c) => s.toRow(e, c)), s.idKind));
    }
  }
  if (isDirty("plan")) {
    const p = ws.plan;
    out.push(insertStmt("plan", ["id", ...PLAN_COLUMNS], ["1", p.startDate, p.endDate, p.granularity, p.currency, p.budgetFollowsPlan ? "true" : ""]));
  }
  if (ws.fxRates && isDirty("fx_rates")) {
    const fx = ws.fxRates;
    const rates = Object.entries(fx.rates).map(([k, v]) => `${k}=${v}`).join("|");
    out.push(insertStmt("fx_rates", ["id", ...FX_COLUMNS], ["1", fx.base, fx.date, fx.fetchedAt, rates]));
  }
  if (isDirty("meta")) {
    out.push({ sql: `INSERT INTO meta (key, value) VALUES ('schema_version', ?)`, args: [{ type: "text", value: SCHEMA_VERSION }] });
    out.push({
      sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
      args: [
        { type: "text", value: "project_status" },
        { type: "text", value: JSON.stringify(ws.status ?? {}) },
      ],
    });
    // §538 — single-tenant is the ONLY Turso layout with no projects row, so
    // project meta rides the meta table here. This builder is single-tenant-only
    // (TursoBackend.save calls tenantWorkspaceToStatements whenever a projectId
    // is set), so no mode flag is needed.
    if (ws.project) {
      out.push({
        sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
        args: [
          { type: "text", value: "project_meta" },
          { type: "text", value: JSON.stringify(ws.project) },
        ],
      });
    }
    if (ws.fieldVisibility && Object.keys(ws.fieldVisibility).length > 0) {
      out.push({
        sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
        args: [
          { type: "text", value: "field_visibility" },
          { type: "text", value: JSON.stringify(ws.fieldVisibility) },
        ],
      });
    }
    if (ws.features !== undefined) {
      out.push({
        sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
        args: [
          { type: "text", value: "features" },
          { type: "text", value: JSON.stringify(ws.features) },
        ],
      });
    }
    if (ws.steeringCommittee) {
      out.push({
        sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
        args: [
          { type: "text", value: "steering_committee" },
          { type: "text", value: JSON.stringify(ws.steeringCommittee) },
        ],
      });
    }
    if (ws.timelogLinks) {
      out.push({
        sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
        args: [
          { type: "text", value: "timelog_links" },
          { type: "text", value: JSON.stringify(ws.timelogLinks) },
        ],
      });
    }
    if (ws.knowledgeItems && ws.knowledgeItems.length) {
      out.push({
        sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
        args: [
          { type: "text", value: "knowledge_items" },
          { type: "text", value: JSON.stringify(ws.knowledgeItems) },
        ],
      });
    }
    if (ws.insights && ws.insights.length) {
      out.push({
        sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
        args: [
          { type: "text", value: "insights" },
          { type: "text", value: JSON.stringify(ws.insights) },
        ],
      });
    }
    if (ws.activityLog && ws.activityLog.length) {
      out.push({
        sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
        args: [
          { type: "text", value: "activityLog" },
          { type: "text", value: JSON.stringify(ws.activityLog) },
        ],
      });
    }
    // budgetHistory: meta-blob sibling of activityLog (tenant writer mirrors it).
    if (ws.budgetHistory && ws.budgetHistory.length) {
      out.push({
        sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
        args: [
          { type: "text", value: "budgetHistory" },
          { type: "text", value: JSON.stringify(ws.budgetHistory) },
        ],
      });
    }
    if (ws.documents && ws.documents.length) {
      out.push({
        sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
        args: [
          { type: "text", value: "documents" },
          { type: "text", value: JSON.stringify(ws.documents) },
        ],
      });
    }
    if (ws.documentVersions && ws.documentVersions.length) {
      out.push({
        sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
        args: [
          { type: "text", value: "documentVersions" },
          { type: "text", value: JSON.stringify(ws.documentVersions) },
        ],
      });
    }
    if (ws.settingsOverrides && hasAnyOverride(ws.settingsOverrides)) {
      out.push({
        sql: `INSERT INTO meta (key, value) VALUES (?, ?)`,
        args: [
          { type: "text", value: "settings_overrides" },
          { type: "text", value: JSON.stringify(ws.settingsOverrides) },
        ],
      });
    }
  }
  out.push({ sql: "COMMIT" });
  return withRevision(out, SCHEMA_DDL.length, stamp);
}
