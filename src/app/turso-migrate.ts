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
// TWO kinds of ALTER, in this order: `ALTER TABLE … RENAME COLUMN … TO …` for a
// legacy column whose replacement the table expects (`columnRenameAlters` —
// applied FIRST, so the data moves in place instead of being stranded beside a
// fresh empty column), then `ALTER TABLE … ADD COLUMN … TEXT` for any spec
// column still missing (`missingColumnAlters`). ★★ Describing only the ADD half
// is an under-statement this header carried for a long time, and it is not
// harmless: it reads as licence to drop a rename and let the add pass "handle"
// it, which silently loses the old column's data. `buildColumnEnsureAlters`
// composes both.
//
// All entity columns are TEXT except `id`, which comes in TWO kinds (turso-schema's
// EntitySpec.idKind): `id INTEGER PRIMARY KEY` for the entities that mint a
// number, and `id TEXT PRIMARY KEY` for those that mint a string
// (`document_assets`, a crypto.randomUUID()). In the tenant schema both drop
// the single-column PK (`id INTEGER` / `id TEXT` inside a composite PK). Either
// way `id` is created WITH the table and so always pre-exists, which is why the
// ADD/RENAME passes never touch `id`. The ONE exception is `idKindRebuild`
// (§211): a single-tenant table a pre-fix build created with the wrong `id`
// TYPE, which no `ALTER` can repair, so it is rebuilt instead.
//
// The module is pure + i18n-free: it builds SqlStmt arrays and parses PRAGMA
// results. The backend (turso-backend.ts) runs the resulting statements.

import {
  ENTITY_SPECS, PLAN_COLUMNS, colDdl, type SqlStmt, type PipelineResultLike,
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
 *
 * `notes` → `description`: the tasks table's rich free-text field, renamed
 * alongside `Task.notes`→`Task.description`. Only the `tasks` ENTITY_SPEC
 * expects `description` (resources keep their own `notes` column), so the
 * `want.has(to)` gate above scopes this rename to that table alone.
 */
const COLUMN_RENAMES: readonly { readonly from: string; readonly to: string }[] = [
  { from: "documentLinks", to: "knowledgeLinks" },
  { from: "notes", to: "description" },
];

export interface TableColumns {
  table: string;
  columns: readonly string[];
  /** §211 — set on a SINGLE-TENANT table whose `id` must be `TEXT PRIMARY KEY`:
   *  the column list it is CREATEd with, so an old table still carrying the
   *  pre-fix `id INTEGER PRIMARY KEY` can be rebuilt (see `idKindRebuild`). */
  textIdDdl?: string;
}

/** Single-tenant expected columns: each ENTITY_SPEC's own columns, plus the
 *  `plan` singleton table's columns (all TEXT — safe to ALTER-add). */
export function singleTenantTableColumns(): TableColumns[] {
  const entities = ENTITY_SPECS.map((s): TableColumns =>
    s.idKind === "text"
      ? { table: s.table, columns: s.columns, textIdDdl: colDdl(s.columns, "text") }
      : { table: s.table, columns: s.columns });
  return [...entities, { table: "plan", columns: PLAN_COLUMNS }];
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
 *
 * Returns `null` as an "unknown schema" sentinel in TWO cases, both meaning
 * "do not ALTER" rather than "no columns → ALTER everything" (which would
 * spuriously re-add existing columns and fail the save with a duplicate column):
 *
 *  1. the result carries NO `cols` metadata AND no `"name"` column could be
 *     located — the PRAGMA shape drifted and the parse cannot be trusted;
 *  2. the result carries full metadata but ZERO ROWS. A table that exists
 *     always has at least one column, so zero rows means the table does NOT
 *     exist — and ALTERing a nonexistent table errors outright. This branch
 *     used to return `[]`, which was masked only because both load paths
 *     prepend the full CREATE-TABLE DDL before any save; it became
 *     load-bearing once a genuinely NEW table (`document_assets`) shipped.
 */
export function existingColumnsFromPragma(res: PipelineResultLike | undefined): string[] | null {
  const cols = res?.response?.result?.cols ?? [];
  const rows = res?.response?.result?.rows ?? [];
  const namedIdx = cols.findIndex((c) => c?.name === "name");
  if (cols.length === 0 && namedIdx < 0) return null; // unknown schema — do not infer columns
  if (rows.length === 0) return null; // table absent — ALTER would error, and DDL creates it
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

/** The `id` row of a PRAGMA table_info result, as (declared type, pk flag), or
 *  null when the shape cannot be read — which means "do not rebuild". */
export function idColumnFromPragma(res: PipelineResultLike | undefined): { type: string; pk: boolean } | null {
  const cols = res?.response?.result?.cols ?? [];
  const rows = res?.response?.result?.rows ?? [];
  const at = (name: string) => cols.findIndex((c) => c?.name === name);
  const [nameIdx, typeIdx, pkIdx] = [at("name"), at("type"), at("pk")];
  if (nameIdx < 0 || typeIdx < 0 || pkIdx < 0) return null;
  const row = rows.find((r) => r[nameIdx]?.value === "id");
  if (!row) return null;
  return { type: String(row[typeIdx]?.value ?? ""), pk: String(row[pkIdx]?.value ?? "0") !== "0" };
}

/**
 * §211 — rebuild a single-tenant table created before `idKind: "text"` existed.
 *
 * A pre-fix build created `document_assets` with `id INTEGER PRIMARY KEY`: a
 * ROWID ALIAS, the one column type SQLite ENFORCES, so every UUID id the app
 * mints is refused with `datatype mismatch` and every save after the first
 * image upload reports failure — forever, because `CREATE TABLE IF NOT EXISTS`
 * never re-runs on an existing table and no `ALTER` can change a column's type.
 *
 * SQLite's documented way to change a column type is to rebuild the table:
 * rename the old one aside, create the corrected one, copy every column both
 * share, drop the old. It runs inside the caller's BEGIN…COMMIT, so a failure
 * leaves the old table in place. ★ Nothing can be lost by the copy: a rowid
 * alias can only ever have held INTEGER ids, which the TEXT column keeps (as
 * their text), and every column the new table expects that the old one lacked
 * starts empty, exactly as the ADD pass would have left it.
 * ★ Gated on the PRAGMA saying `INTEGER` AND primary key — a table already TEXT
 *   (every database created since the fix) produces nothing, so this is a
 *   one-shot self-heal like the rest of this module.
 */
export function idKindRebuild(
  spec: TableColumns,
  existing: readonly string[],
  pragma: PipelineResultLike | undefined,
): SqlStmt[] | null {
  if (spec.textIdDdl === undefined) return null;
  const id = idColumnFromPragma(pragma);
  if (!id || !id.pk || id.type.toUpperCase() !== "INTEGER") return null;
  const old = `${spec.table}__pre_text_id`;
  const shared = spec.columns.filter((c) => existing.includes(c)).map((c) => `"${c}"`).join(", ");
  return [
    { sql: `ALTER TABLE "${spec.table}" RENAME TO "${old}"` },
    { sql: `CREATE TABLE "${spec.table}" (${spec.textIdDdl})` },
    { sql: `INSERT INTO "${spec.table}" (${shared}) SELECT ${shared} FROM "${old}"` },
    { sql: `DROP TABLE "${old}"` },
  ];
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
    // §211 — a rebuild CREATEs the full corrected column set, so it replaces
    // the rename/add passes for that table rather than following them.
    const rebuild = idKindRebuild(spec, existing, pragmaResults[i]);
    if (rebuild) {
      out.push(...rebuild);
      return;
    }
    const { alters, renamed } = columnRenameAlters(spec.table, existing, spec.columns);
    out.push(...alters);
    // A just-renamed column now holds its data under the new name; treat it as
    // present so missingColumnAlters does not ADD an empty column over it.
    const effectiveExisting = renamed.size ? [...existing, ...renamed] : existing;
    out.push(...missingColumnAlters(spec.table, effectiveExisting, spec.columns));
  });
  return out;
}
