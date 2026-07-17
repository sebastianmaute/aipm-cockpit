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
  ENTITY_SPECS, PLAN_COLUMNS, type SqlStmt, type PipelineResultLike,
} from "./turso-schema";
import { PROJECT_CSV_COLUMNS } from "./csv-codecs";

/** Column added to every workspace table in multi-tenant mode (see
 *  turso-tenant-schema.ts tenantColDdl). Included in the tenant expected-column
 *  set so an old tenant DB self-heals the same way as the entity columns. */
const TENANT_PROJECT_ID_COLUMN = "project_id";

/** The shared multi-tenant `projects` table (ProjectMeta rows). Mirrors
 *  turso-tenant-schema.ts PROJECTS_TABLE; duplicated as a local literal to keep
 *  this pure module free of a tenant-schema import cycle. */
const PROJECTS_TABLE = "projects";

/**
 * Legacy→new column renames applied BEFORE the add-missing pass. When a table
 * carries the OLD column and NOT the new one, `ALTER TABLE … RENAME COLUMN …`
 * moves the data in place with zero loss (SQLite ≥3.25 / libSQL both support
 * RENAME COLUMN). Gated on the new name being an EXPECTED column of that table,
 * so a coincidental legacy column on an unrelated table is never touched.
 *
 * Idempotent: after the rename the old column is gone and the new one present,
 * so a second migration run finds nothing to rename and the add-missing pass
 * sees the column already there — no duplicate ADD, no data churn.
 *
 * `documentLinks` → `knowledgeLinks`: the per-entity KnowledgeLink[] JSON-in-cell
 * column, renamed when the Documents view became Knowledge. It lives on the five
 * entity tables (tasks/raid/changes/milestones/stakeholders) AND the tenant
 * `projects` table (ProjectMeta), all of which now expect `knowledgeLinks`.
 */
const COLUMN_RENAMES: readonly { readonly from: string; readonly to: string }[] = [
  { from: "documentLinks", to: "knowledgeLinks" },
];

export interface TableColumns {
  table: string;
  columns: readonly string[];
}

/** Entity tables only (NOT fx_rates/meta — those have stable column sets and
 *  the singleton/meta rows are re-written wholesale). The column-ensure fix
 *  targets tables whose column sets grow as features are added.
 *
 *  NOTE: `plan` is NOT stable — a TEXT column (e.g. `budgetFollowsPlan`) was
 *  added to PLAN_COLUMNS + both plan INSERTs, so an existing DB's 4-column plan
 *  table must self-heal too. It is included separately (via PLAN_COLUMNS) in the
 *  single-tenant/tenant spec builders below, since it is not an ENTITY_SPEC. */
function entityTableColumns(): TableColumns[] {
  return ENTITY_SPECS.map((s) => ({ table: s.table, columns: s.columns }));
}

/** Single-tenant expected columns: each ENTITY_SPEC's own columns, plus the
 *  `plan` singleton table's columns (all TEXT — safe to ALTER-add). */
export function singleTenantTableColumns(): TableColumns[] {
  return [...entityTableColumns(), { table: "plan", columns: PLAN_COLUMNS }];
}

/** Multi-tenant expected columns: the entity + plan columns PLUS the
 *  `project_id` column the tenant DDL appends to every workspace table, PLUS the
 *  shared `projects` table (ProjectMeta rows — NOT project_id-scoped) so its
 *  column set self-heals too. Including `projects` here is what lets an existing
 *  tenant DB pick up the documentLinks→knowledgeLinks rename (and any newly
 *  added ProjectMeta column) instead of erroring on the next project upsert. */
export function tenantTableColumns(): TableColumns[] {
  const scoped = singleTenantTableColumns().map((t) => ({
    table: t.table,
    columns: [...t.columns, TENANT_PROJECT_ID_COLUMN],
  }));
  scoped.push({ table: PROJECTS_TABLE, columns: ["id", ...(PROJECT_CSV_COLUMNS as readonly string[])] });
  return scoped;
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
 * An empty/missing result for a known shape (table does not exist yet) yields [].
 *
 * Returns `null` as an "unknown schema" sentinel when the result carries NO
 * `cols` metadata AND no `"name"` column could be located — i.e. the PRAGMA
 * shape drifted and we cannot trust the parse. Callers must treat `null` as
 * "do not ALTER" rather than "no columns → ALTER everything" (which would
 * spuriously re-add existing columns and fail the save with a duplicate column).
 */
export function existingColumnsFromPragma(res: PipelineResultLike | undefined): string[] | null {
  const cols = res?.response?.result?.cols ?? [];
  const rows = res?.response?.result?.rows ?? [];
  const namedIdx = cols.findIndex((c) => c?.name === "name");
  if (cols.length === 0 && namedIdx < 0) return null; // unknown schema — do not infer columns
  const nameIdx = namedIdx < 0 ? 1 : namedIdx; // table_info's canonical column order
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
 * For each configured rename whose NEW name is an expected column of `table`,
 * the OLD column is present and the NEW column is absent, emit an
 * `ALTER TABLE "<table>" RENAME COLUMN "<from>" TO "<to>"`. Returns the alters
 * plus the set of new column names that were renamed-into, so the add-missing
 * pass can treat them as already present (and not spuriously ADD a fresh empty
 * column over the just-renamed data).
 */
export function columnRenameAlters(
  table: string,
  existing: readonly string[],
  expected: readonly string[],
): { alters: SqlStmt[]; renamed: Set<string> } {
  const present = new Set(existing);
  const want = new Set(expected);
  const alters: SqlStmt[] = [];
  const renamed = new Set<string>();
  for (const { from, to } of COLUMN_RENAMES) {
    if (want.has(to) && present.has(from) && !present.has(to)) {
      alters.push({ sql: `ALTER TABLE "${table}" RENAME COLUMN "${from}" TO "${to}"` });
      renamed.add(to);
    }
  }
  return { alters, renamed };
}

/**
 * Combine the per-table (table, expectedColumns) list with the PRAGMA results
 * (parallel by index) into all the ALTER statements needed to bring every table
 * up to its expected column set. Renames run FIRST (preserving data in place),
 * then any genuinely-missing column is ADDed. Returns [] when nothing is missing
 * — the common case for fresh / up-to-date databases.
 */
export function buildColumnEnsureAlters(
  specs: readonly TableColumns[],
  pragmaResults: readonly (PipelineResultLike | undefined)[],
): SqlStmt[] {
  const out: SqlStmt[] = [];
  specs.forEach((spec, i) => {
    const existing = existingColumnsFromPragma(pragmaResults[i]);
    if (existing === null) return; // unknown schema for this table — do not ALTER
    const { alters, renamed } = columnRenameAlters(spec.table, existing, spec.columns);
    out.push(...alters);
    // A just-renamed column now holds its data under the new name; treat it as
    // present so missingColumnAlters does not ADD an empty column over it.
    const effectiveExisting = renamed.size ? [...existing, ...renamed] : existing;
    out.push(...missingColumnAlters(spec.table, effectiveExisting, spec.columns));
  });
  return out;
}
