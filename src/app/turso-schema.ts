// src/app/turso-schema.ts
//
// Pure relational mapping for the Turso backend. DDL/INSERT/SELECT are
// generated generically from a registry whose column sets + encoders +
// sanitizers are the SAME ones the CSV backend uses (exported from
// csv-codecs.ts / sanitize.ts) — so no per-field mapping is duplicated.

import {
  CSV_COLUMNS, RAID_CSV_COLUMNS, ABSENCES_CSV_COLUMNS, SHIFTS_CSV_COLUMNS,
  RESOURCES_CSV_COLUMNS, ROLES_CSV_COLUMNS, REF_CSV_COLUMNS, BUDGETS_CSV_COLUMNS,
  MILESTONES_CSV_COLUMNS, CHANGES_CSV_COLUMNS, STAKEHOLDERS_CSV_COLUMNS,
  fieldToString, raidFieldToString, absenceFieldToString, shiftFieldToString,
  resourceFieldToString, budgetFieldToString, milestoneFieldToString, buildTaskFromObj, buildRaidItemFromObj,
  buildMilestoneFromObj, changeFieldToString, buildChangeFromObj,
  stakeholderFieldToString, buildStakeholderFromObj,
  decodeRatesMap,
} from "./csv-codecs";
import {
  emptyWorkspace, migrateWorkspaceV9, sanitizeProjectStatus, type Workspace,
} from "./workspace";
import { sanitizeFieldVisibility } from "./field-visibility";
import { sanitizeFeatures } from "./feature-modules";
import {
  sanitizeResource, sanitizeRole, sanitizeBudgetBucket, sanitizeDiscipline,
  sanitizeGrade, sanitizeAbsence, sanitizeShift, sanitizeFxRates, sanitizePlan,
  sanitizeSteeringCommittee,
} from "./sanitize";
import { sanitizeTimelogLinks } from "./timelog-sanitize";
import type {
  Task, RaidItem, Absence, Shift, Resource, Role, Discipline, Grade, BudgetBucket, Milestone, ChangeItem, Stakeholder,
} from "./types";

interface SqlArg { type: "text" | "integer" | "null"; value?: string }
export interface SqlStmt { sql: string; args?: SqlArg[] }
export interface PipelineResultLike {
  type: "ok" | "error";
  response?: { type: string; result?: { cols?: { name?: string }[]; rows?: { value?: unknown }[][] } };
  error?: { message?: string };
}

export interface EntitySpec<T> {
  table: string;
  wsKey: keyof Workspace;
  columns: readonly string[];
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
  spec<Absence>({ table: "absences", wsKey: "absences", columns: ABSENCES_CSV_COLUMNS, get: (w) => w.absences, toRow: absenceFieldToString as unknown as (e: Absence, col: string) => string, fromObj: sanitizeAbsence }),
  spec<Shift>({ table: "shifts", wsKey: "shifts", columns: SHIFTS_CSV_COLUMNS, get: (w) => w.shifts, toRow: shiftFieldToString as unknown as (e: Shift, col: string) => string, fromObj: sanitizeShift }),
  spec<Resource>({ table: "resources", wsKey: "resources", columns: RESOURCES_CSV_COLUMNS, get: (w) => w.resources, toRow: resourceFieldToString, fromObj: sanitizeResource }),
  spec<Role>({ table: "roles", wsKey: "roles", columns: ROLES_CSV_COLUMNS, get: (w) => w.roles, toRow: anyToRow as (e: Role, col: string) => string, fromObj: sanitizeRole }),
  spec<Discipline>({ table: "disciplines", wsKey: "disciplines", columns: REF_CSV_COLUMNS, get: (w) => w.disciplines, toRow: anyToRow as (e: Discipline, col: string) => string, fromObj: sanitizeDiscipline }),
  spec<Grade>({ table: "grades", wsKey: "grades", columns: REF_CSV_COLUMNS, get: (w) => w.grades, toRow: anyToRow as (e: Grade, col: string) => string, fromObj: sanitizeGrade }),
  spec<BudgetBucket>({ table: "budget_buckets", wsKey: "budgets", columns: BUDGETS_CSV_COLUMNS, get: (w) => w.budgets ?? [], toRow: budgetFieldToString, fromObj: sanitizeBudgetBucket }),
  spec<Milestone>({ table: "milestones", wsKey: "milestones", columns: MILESTONES_CSV_COLUMNS, get: (w) => w.milestones ?? [], toRow: milestoneFieldToString as unknown as (e: Milestone, col: string) => string, fromObj: buildMilestoneFromObj }),
  spec<ChangeItem>({ table: "changes", wsKey: "changes", columns: CHANGES_CSV_COLUMNS, get: (w) => w.changes ?? [], toRow: changeFieldToString as unknown as (e: ChangeItem, col: string) => string, fromObj: buildChangeFromObj }),
  spec<Stakeholder>({ table: "stakeholders", wsKey: "stakeholders", columns: STAKEHOLDERS_CSV_COLUMNS, get: (w) => w.stakeholders ?? [], toRow: stakeholderFieldToString as unknown as (e: Stakeholder, col: string) => string, fromObj: buildStakeholderFromObj }),
] as unknown as EntitySpec<unknown>[];

export const PLAN_COLUMNS = ["startDate", "endDate", "granularity", "currency", "budgetFollowsPlan"] as const;
export const FX_COLUMNS = ["base", "date", "fetchedAt", "rates"] as const;

export function colDdl(columns: readonly string[]): string {
  return columns.map((c) => (c === "id" ? "id INTEGER PRIMARY KEY" : `"${c}" TEXT`)).join(", ");
}

export const SCHEMA_DDL: string[] = [
  ...ENTITY_SPECS.map((s) => `CREATE TABLE IF NOT EXISTS ${s.table} (${colDdl(s.columns)})`),
  `CREATE TABLE IF NOT EXISTS plan (id INTEGER PRIMARY KEY, ${PLAN_COLUMNS.map((c) => `"${c}" TEXT`).join(", ")})`,
  `CREATE TABLE IF NOT EXISTS fx_rates (id INTEGER PRIMARY KEY, ${FX_COLUMNS.map((c) => `"${c}" TEXT`).join(", ")})`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
];

export const TABLE_NAMES: readonly string[] = [...ENTITY_SPECS.map((s) => s.table), "plan", "fx_rates", "meta"];

export function selectStatements(): SqlStmt[] {
  return TABLE_NAMES.map((t) => ({ sql: `SELECT * FROM ${t}` }));
}

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

/** Assemble a Workspace from selectStatements() results (TABLE_NAMES order). */
export function rowsToWorkspace(results: PipelineResultLike[]): Workspace {
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
    ws.fxRates = sanitizeFxRates({ base: fxRow.base, date: fxRow.date, fetchedAt: fxRow.fetchedAt, rates: decodeRatesMap(fxRow.rates ?? "") });
  }
  const statusRow = rowObjects(byTable.get("meta")).find((r) => r.key === "project_status");
  if (statusRow?.value) {
    try {
      ws.status = sanitizeProjectStatus(JSON.parse(statusRow.value));
    } catch {
      // malformed — leave the emptyWorkspace() default
    }
  }
  const fvRow = rowObjects(byTable.get("meta")).find((r) => r.key === "field_visibility");
  if (fvRow?.value) {
    try {
      const fv = sanitizeFieldVisibility(JSON.parse(fvRow.value));
      if (fv) ws.fieldVisibility = fv;
    } catch {
      // malformed — leave default (undefined)
    }
  }
  const fnRow = rowObjects(byTable.get("meta")).find((r) => r.key === "features");
  if (fnRow?.value) {
    try {
      const f = sanitizeFeatures(JSON.parse(fnRow.value));
      if (f !== undefined) ws.features = f;
    } catch {
      // malformed — leave undefined
    }
  }
  const scRow = rowObjects(byTable.get("meta")).find((r) => r.key === "steering_committee");
  if (scRow?.value) {
    try {
      const sc = sanitizeSteeringCommittee(JSON.parse(scRow.value));
      if (sc) ws.steeringCommittee = sc;
    } catch {
      // malformed — leave undefined
    }
  }
  const tlRow = rowObjects(byTable.get("meta")).find((r) => r.key === "timelog_links");
  if (tlRow?.value) {
    try {
      const tl = sanitizeTimelogLinks(JSON.parse(tlRow.value));
      if (tl) ws.timelogLinks = tl;
    } catch {
      // malformed — leave undefined
    }
  }
  return migrateWorkspaceV9(ws);
}

// Bump on any schema/column change. NOTE: there is no ALTER-migration runner —
// adding a column means existing Turso databases (created before this column)
// need re-creation / sample re-import (as with documentLinks/resource-fk columns).
const SCHEMA_VERSION = "12";

function insertStmt(table: string, columns: readonly string[], values: string[]): SqlStmt {
  const colList = columns.map((c) => `"${c}"`).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  return {
    sql: `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`,
    args: columns.map((c, i) => (c === "id" ? { type: "integer", value: values[i] } : { type: "text", value: values[i] })),
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
 * `ws.project` is DELIBERATELY excluded: save() never persists it in either
 * mode — the tenant projects row is written only via turso-portfolio.ts's
 * upsert path. If project persistence is ever added to a builder, this diff
 * must learn about it or project-only edits would be silently skipped.
 */
export function dirtyWorkspaceTables(prev: Workspace, next: Workspace): Set<string> {
  const dirty = new Set<string>();
  for (const s of ENTITY_SPECS) {
    if (prev[s.wsKey] !== next[s.wsKey]) dirty.add(s.table);
  }
  if (prev.plan !== next.plan) dirty.add("plan");
  if (prev.fxRates !== next.fxRates) dirty.add("fx_rates");
  if (prev.status !== next.status) dirty.add("meta");
  if (prev.fieldVisibility !== next.fieldVisibility) dirty.add("meta");
  if (prev.features !== next.features) dirty.add("meta");
  if (prev.steeringCommittee !== next.steeringCommittee) dirty.add("meta");
  if (prev.timelogLinks !== next.timelogLinks) dirty.add("meta");
  return dirty;
}

/**
 * Ordered statements that OVERWRITE the workspace, transactionally.
 *
 * When `dirtyTables` is provided, DELETE+INSERT are emitted only for those
 * tables (the others are untouched in the DB); the CREATE TABLE IF NOT EXISTS
 * set and BEGIN/COMMIT are ALWAYS emitted — DDL is cheap and guards the first
 * write against a fresh database. Omitting the param keeps the historical
 * full-rewrite behavior.
 */
export function workspaceToStatements(ws: Workspace, dirtyTables?: ReadonlySet<string>): SqlStmt[] {
  const isDirty = (table: string) => dirtyTables === undefined || dirtyTables.has(table);
  const out: SqlStmt[] = [{ sql: "BEGIN" }];
  for (const ddl of SCHEMA_DDL) out.push({ sql: ddl });
  for (const name of TABLE_NAMES) {
    if (isDirty(name)) out.push({ sql: `DELETE FROM ${name}` });
  }
  for (const s of ENTITY_SPECS) {
    if (!isDirty(s.table)) continue;
    for (const e of s.get(ws)) {
      out.push(insertStmt(s.table, s.columns, s.columns.map((c) => s.toRow(e, c))));
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
  }
  out.push({ sql: "COMMIT" });
  return out;
}
