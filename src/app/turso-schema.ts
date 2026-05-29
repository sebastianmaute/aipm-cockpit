// src/app/turso-schema.ts
//
// Pure relational mapping for the Turso backend. DDL/INSERT/SELECT are
// generated generically from a registry whose column sets + encoders +
// sanitizers are the SAME ones the CSV backend uses (exported from
// storage.ts / sanitize.ts) — so no per-field mapping is duplicated.

import {
  CSV_COLUMNS, RAID_CSV_COLUMNS, ABSENCES_CSV_COLUMNS, SHIFTS_CSV_COLUMNS,
  RESOURCES_CSV_COLUMNS, ROLES_CSV_COLUMNS, REF_CSV_COLUMNS, BUDGETS_CSV_COLUMNS,
  fieldToString, raidFieldToString, absenceFieldToString, shiftFieldToString,
  resourceFieldToString, budgetFieldToString, buildTaskFromObj, buildRaidItemFromObj,
  decodeRatesMap, emptyWorkspace, migrateWorkspaceV6, type Workspace,
} from "./storage";
import {
  sanitizeResource, sanitizeRole, sanitizeBudgetBucket, sanitizeDiscipline,
  sanitizeGrade, sanitizeAbsence, sanitizeShift, sanitizeFxRates, sanitizePlan,
} from "./sanitize";
import type {
  Task, RaidItem, Absence, Shift, Resource, Role, Discipline, Grade, BudgetBucket,
} from "./types";

export interface SqlArg { type: "text" | "integer" | "null"; value?: string }
export interface SqlStmt { sql: string; args?: SqlArg[] }
export interface PipelineResultLike {
  type: "ok" | "error";
  response?: { type: string; result?: { cols?: { name?: string }[]; rows?: { value?: unknown }[][] } };
}

interface EntitySpec<T> {
  table: string;
  wsKey: keyof Workspace;
  columns: readonly string[];
  get: (ws: Workspace) => T[];
  toRow: (e: T, col: string) => string;
  fromObj: (obj: Record<string, string>) => T | null;
}
function spec<T>(s: EntitySpec<T>): EntitySpec<T> { return s; }
const anyToRow = (r: unknown, c: string) =>
  String((r as Record<string, unknown>)[c] ?? "");

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
] as unknown as EntitySpec<unknown>[];

const PLAN_COLUMNS = ["startDate", "endDate", "granularity", "currency"] as const;
const FX_COLUMNS = ["base", "date", "fetchedAt", "rates"] as const;

function colDdl(columns: readonly string[]): string {
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

// Re-export internal pieces Tasks 3 & 4 build on (kept module-local until then).
export { PLAN_COLUMNS, FX_COLUMNS };

// Re-export workspace utilities used by downstream tasks.
export { decodeRatesMap, emptyWorkspace, migrateWorkspaceV6, sanitizeFxRates, sanitizePlan };
