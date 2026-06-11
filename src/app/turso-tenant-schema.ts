// src/app/turso-tenant-schema.ts
//
// Project-scoped (multi-tenant) relational mapping. Every workspace table gains
// a `project_id TEXT` column; a `projects` table holds one ProjectMeta row per
// project (the source of truth for the Turso project list). Built generically
// from the SAME column registries + encoders the single-tenant turso-schema uses
// (reuses ENTITY_SPECS/PLAN_COLUMNS/FX_COLUMNS/colDdl), plus Phase 1's
// PROJECT_CSV_COLUMNS / projectFieldToString / buildProjectFromObj for the
// projects table. Decoding reuses rowsToWorkspace (its fromObj builders ignore
// the extra project_id column) and buildProjectFromObj.
//
// meta / plan / fx_rates drop the single-tenant fixed PK and are scoped by
// project_id (multiple projects each keep their own row(s)). Because every
// SELECT is `WHERE project_id = ?`, the existing rowsToWorkspace first-row /
// find-status logic still works.

import {
  ENTITY_SPECS, PLAN_COLUMNS, FX_COLUMNS, rowObjects, TABLE_NAMES,
  type SqlStmt, type PipelineResultLike,
} from "./turso-schema";
import {
  PROJECT_CSV_COLUMNS, projectFieldToString, buildProjectFromObjLenient,
} from "./csv-codecs";
import type { Workspace } from "./workspace";
import type { ProjectMeta } from "./types";

export const PROJECTS_TABLE = "projects";
// Multi-tenant schema version. Intentionally distinct from the single-tenant
// turso-schema.ts version ("9"); the two schemas evolve independently.
const SCHEMA_VERSION = "12";

const text = (value: string): { type: "text"; value: string } => ({ type: "text", value });

export interface ProjectListEntry {
  id: string;
  meta: ProjectMeta;
  archived: boolean;
}

// --- DDL ------------------------------------------------------------------

/** Like colDdl but renders `id` as a plain INTEGER (no single-column PK) so the
 *  composite PRIMARY KEY (id, project_id) can make ids unique PER PROJECT in the
 *  shared multi-tenant DB. */
function tenantColDdl(columns: readonly string[]): string {
  return columns.map((c) => (c === "id" ? "id INTEGER" : `"${c}" TEXT`)).join(", ");
}

export function tenantSchemaDdl(): string[] {
  const out: string[] = [];
  for (const s of ENTITY_SPECS) {
    const hasId = s.columns.includes("id");
    const pk = hasId ? ", PRIMARY KEY (id, project_id)" : "";
    out.push(`CREATE TABLE IF NOT EXISTS ${s.table} (${tenantColDdl(s.columns)}, project_id TEXT${pk})`);
  }
  out.push(`CREATE TABLE IF NOT EXISTS plan (${PLAN_COLUMNS.map((c) => `"${c}" TEXT`).join(", ")}, project_id TEXT)`);
  out.push(`CREATE TABLE IF NOT EXISTS fx_rates (${FX_COLUMNS.map((c) => `"${c}" TEXT`).join(", ")}, project_id TEXT)`);
  out.push(`CREATE TABLE IF NOT EXISTS meta (key TEXT, value TEXT, project_id TEXT)`);
  out.push(
    `CREATE TABLE IF NOT EXISTS ${PROJECTS_TABLE} (id TEXT PRIMARY KEY, "archived" TEXT, ` +
      PROJECT_CSV_COLUMNS.map((c) => `"${c}" TEXT`).join(", ") +
      `)`,
  );
  return out;
}

// --- SELECT (load) --------------------------------------------------------

export function tenantSelectStatements(projectId: string): SqlStmt[] {
  return TABLE_NAMES.map((t) => ({
    sql: `SELECT * FROM ${t} WHERE project_id = ?`,
    args: [text(projectId)],
  }));
}

// --- INSERT helpers -------------------------------------------------------

function tenantInsert(table: string, columns: readonly string[], values: string[], projectId: string): SqlStmt {
  const cols = [...columns, "project_id"];
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const placeholders = cols.map(() => "?").join(", ");
  const args = [
    ...columns.map((c, i) => (c === "id" ? { type: "integer" as const, value: values[i] } : text(values[i]))),
    text(projectId),
  ];
  return { sql: `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`, args };
}

// --- DELETE+INSERT (save) -------------------------------------------------

/**
 * Like workspaceToStatements: when `dirtyTables` is provided, the scoped
 * DELETE+INSERT pairs are emitted only for those tables; DDL and BEGIN/COMMIT
 * are always emitted. Omitting the param keeps the full project overwrite.
 */
export function tenantWorkspaceToStatements(ws: Workspace, projectId: string, dirtyTables?: ReadonlySet<string>): SqlStmt[] {
  const isDirty = (table: string) => dirtyTables === undefined || dirtyTables.has(table);
  const out: SqlStmt[] = [{ sql: "BEGIN" }];
  for (const ddl of tenantSchemaDdl()) out.push({ sql: ddl });
  for (const name of TABLE_NAMES) {
    if (!isDirty(name)) continue;
    out.push({ sql: `DELETE FROM ${name} WHERE project_id = ?`, args: [text(projectId)] });
  }
  for (const s of ENTITY_SPECS) {
    if (!isDirty(s.table)) continue;
    for (const e of s.get(ws)) {
      out.push(tenantInsert(s.table, s.columns, s.columns.map((c) => s.toRow(e, c)), projectId));
    }
  }
  if (isDirty("plan")) {
    const p = ws.plan;
    out.push(tenantInsert("plan", PLAN_COLUMNS, [p.startDate, p.endDate, p.granularity, p.currency], projectId));
  }
  if (ws.fxRates && isDirty("fx_rates")) {
    const fx = ws.fxRates;
    const rates = Object.entries(fx.rates).map(([k, v]) => `${k}=${v}`).join("|");
    out.push(tenantInsert("fx_rates", FX_COLUMNS, [fx.base, fx.date, fx.fetchedAt, rates], projectId));
  }
  if (isDirty("meta")) {
    out.push(tenantInsert("meta", ["key", "value"], ["schema_version", SCHEMA_VERSION], projectId));
    out.push(tenantInsert("meta", ["key", "value"], ["project_status", JSON.stringify(ws.status ?? {})], projectId));
  }
  out.push({ sql: "COMMIT" });
  return out;
}

// --- projects table CRUD --------------------------------------------------

export function listProjectsStatement(): SqlStmt {
  return { sql: `SELECT * FROM ${PROJECTS_TABLE} WHERE "archived" = '0'` };
}

/** SELECT the single projects-table row for this project id (for load() to
 *  populate ws.project, since rowsToWorkspace does not carry ProjectMeta). */
export function selectProjectStatement(id: string): SqlStmt {
  return { sql: `SELECT * FROM ${PROJECTS_TABLE} WHERE id = ?`, args: [text(id)] };
}

export function listArchivedProjectsStatement(): SqlStmt {
  return { sql: `SELECT * FROM ${PROJECTS_TABLE} WHERE "archived" = '1'` };
}

export function upsertProjectStatement(meta: ProjectMeta, id: string, archived: boolean): SqlStmt {
  const cols = ["id", "archived", ...PROJECT_CSV_COLUMNS];
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const placeholders = cols.map(() => "?").join(", ");
  const args = [
    text(id),
    text(archived ? "1" : "0"),
    ...PROJECT_CSV_COLUMNS.map((c) => text(projectFieldToString(meta, c))),
  ];
  return { sql: `INSERT OR REPLACE INTO ${PROJECTS_TABLE} (${colList}) VALUES (${placeholders})`, args };
}

export function archiveProjectStatement(id: string): SqlStmt {
  return { sql: `UPDATE ${PROJECTS_TABLE} SET "archived" = '1' WHERE id = ?`, args: [text(id)] };
}

export function restoreProjectStatement(id: string): SqlStmt {
  return { sql: `UPDATE ${PROJECTS_TABLE} SET "archived" = '0' WHERE id = ?`, args: [text(id)] };
}

export function hardDeleteProjectStatements(id: string): SqlStmt[] {
  const out: SqlStmt[] = [{ sql: "BEGIN" }];
  for (const name of TABLE_NAMES) {
    out.push({ sql: `DELETE FROM ${name} WHERE project_id = ?`, args: [text(id)] });
  }
  out.push({ sql: `DELETE FROM ${PROJECTS_TABLE} WHERE id = ?`, args: [text(id)] });
  out.push({ sql: "COMMIT" });
  return out;
}

// --- decode projects ------------------------------------------------------

export function rowsToProjectList(res: PipelineResultLike | undefined): ProjectListEntry[] {
  return rowObjects(res)
    .map((o): ProjectListEntry | null => {
      const id = o.id ?? "";
      if (!id) return null;
      const meta = buildProjectFromObjLenient(o);
      if (!meta) return null;
      return { id, meta, archived: o.archived === "1" };
    })
    .filter((x): x is ProjectListEntry => x !== null);
}
