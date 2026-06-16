// src/app/turso-migrate.ts
//
// Generic, idempotent column-ensure migration for the Turso backend.
//
// SCHEMA_DDL uses `CREATE TABLE IF NOT EXISTS`, which is a no-op against a DB
// whose tables already exist. So when a NEW column is added to an ENTITY_SPEC
// (e.g. `outlookEventId` on milestones), an existing Turso database does NOT
// gain the column — and the next save emits a named-column INSERT that SQLite
// rejects with "table X has no column named …", failing every save.
//
// This module reads each table's actual columns via PRAGMA table_info and emits
// `ALTER TABLE … ADD COLUMN … TEXT` for any spec column the DB is missing. All
// entity columns are TEXT except `id INTEGER PRIMARY KEY` (always pre-exists),
// so we only ever ADD TEXT columns and never touch `id`.
//
// The module is pure + i18n-free: it builds SqlStmt arrays and parses PRAGMA
// results. The backend (turso-backend.ts) runs the resulting statements.

import {
  ENTITY_SPECS, type SqlStmt, type PipelineResultLike,
} from "./turso-schema";

/** Column added to every workspace table in multi-tenant mode (see
 *  turso-tenant-schema.ts tenantColDdl). Included in the tenant expected-column
 *  set so an old tenant DB self-heals the same way as the entity columns. */
const TENANT_PROJECT_ID_COLUMN = "project_id";

export interface TableColumns {
  table: string;
  columns: readonly string[];
}

/** Entity tables only (NOT plan/fx_rates/meta — those have stable column sets
 *  and the singleton/meta rows are re-written wholesale). The column-ensure
 *  fix targets the entity tables, whose column sets grow as features are added. */
function entityTableColumns(): TableColumns[] {
  return ENTITY_SPECS.map((s) => ({ table: s.table, columns: s.columns }));
}

/** Single-tenant expected columns: each ENTITY_SPEC's own columns. */
export function singleTenantTableColumns(): TableColumns[] {
  return entityTableColumns();
}

/** Multi-tenant expected columns: the entity columns PLUS the `project_id`
 *  column the tenant DDL appends to every workspace table. */
export function tenantTableColumns(): TableColumns[] {
  return entityTableColumns().map((t) => ({
    table: t.table,
    columns: [...t.columns, TENANT_PROJECT_ID_COLUMN],
  }));
}

/** One `PRAGMA table_info("<table>")` statement per table, in input order. */
export function pragmaStatements(tables: readonly string[]): SqlStmt[] {
  return tables.map((t) => ({ sql: `PRAGMA table_info("${t}")` }));
}

/**
 * Extract the column names from a single PRAGMA table_info result.
 *
 * table_info returns rows of (cid, name, type, notnull, dflt_value, pk). The
 * `name` is normally the 2nd column, but we look it up by the result's own
 * `cols` metadata (robust to column ordering) and fall back to index 1.
 * An empty/missing result (table does not exist yet) yields [].
 */
export function existingColumnsFromPragma(res: PipelineResultLike | undefined): string[] {
  const cols = res?.response?.result?.cols ?? [];
  const rows = res?.response?.result?.rows ?? [];
  let nameIdx = cols.findIndex((c) => c?.name === "name");
  if (nameIdx < 0) nameIdx = 1; // table_info's canonical column order
  const out: string[] = [];
  for (const row of rows) {
    const cell = row[nameIdx];
    const value = cell?.value;
    if (value != null) out.push(String(value));
  }
  return out;
}

/**
 * For each `expected` column NOT already present in `existing`, emit an
 * `ALTER TABLE "<table>" ADD COLUMN "<col>" TEXT`. The `id` column is never
 * altered — it is a pre-existing INTEGER PRIMARY KEY (or composite-PK member),
 * so it always exists by the time any column is added.
 */
export function missingColumnAlters(
  table: string,
  existing: readonly string[],
  expected: readonly string[],
): SqlStmt[] {
  const present = new Set(existing);
  const out: SqlStmt[] = [];
  for (const col of expected) {
    if (col === "id") continue;
    if (present.has(col)) continue;
    out.push({ sql: `ALTER TABLE "${table}" ADD COLUMN "${col}" TEXT` });
  }
  return out;
}

/**
 * Combine the per-table (table, expectedColumns) list with the PRAGMA results
 * (parallel by index) into all the ALTER statements needed to bring every table
 * up to its expected column set. Returns [] when nothing is missing — the
 * common case for fresh / up-to-date databases.
 */
export function buildColumnEnsureAlters(
  specs: readonly TableColumns[],
  pragmaResults: readonly (PipelineResultLike | undefined)[],
): SqlStmt[] {
  const out: SqlStmt[] = [];
  specs.forEach((spec, i) => {
    const existing = existingColumnsFromPragma(pragmaResults[i]);
    out.push(...missingColumnAlters(spec.table, existing, spec.columns));
  });
  return out;
}
