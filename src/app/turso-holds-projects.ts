// open-followups §790 — "does this Turso database hold projects?", asked before a storage
// conversion writes the live workspace into Turso.
//
// ★★★ The conversion target is ALWAYS a single-project `TursoBackend` (no project id), whose
// forced full rewrite sends an unscoped `DELETE FROM <table>` for every workspace table. Into a
// database that holds several projects, that deletes every project. A database CREATED for
// several projects is protected only by accident — its `plan` table has no `id`, so the
// single-project `plan` INSERT fails and the §637 batch rolls back. A database begun
// single-project and later written for several projects by a pre-§637 build keeps the `id`, and
// there the write COMMITS (pinned by `turso-holds-projects.execute.test.ts`). So the switch
// asks this first and refuses when the answer is yes.
//
// ★ "Holds projects" is decided by DATA, never by layout: a row in `projects`, or a workspace
// row whose `project_id` is set. A single-project database can carry an empty `projects` table,
// and an empty multi-project layout has nothing in it to lose.
//
// Two round trips, because SQL cannot name a column that may not exist: the PRAGMAs say which
// tables have a `project_id` column (and whether `projects` exists at all), and one SELECT then
// checks only those.
import type { TursoConfig } from "./turso-config";
import { LOAD_TIMEOUT_MS, runTursoPipeline } from "./turso-pipeline";
import { existingColumnsFromPragma, pragmaStatements } from "./turso-migrate";
import { TABLE_NAMES, rowObjects, type PipelineResultLike, type SqlStmt } from "./turso-schema";
import { PROJECTS_TABLE } from "./turso-tenant-schema";

/** The tables the probe inspects, in the order its PRAGMA results come back. */
export function holdsProjectsProbeTables(): string[] {
  return [...TABLE_NAMES, PROJECTS_TABLE];
}

const UNREADABLE = "The Turso database could not be read to check whether it holds projects.";

/** The one SELECT that answers the question, built from the PRAGMA results for
 *  {@link holdsProjectsProbeTables}; `null` when no table could hold a project row at all.
 *  ★★ Throws on a PRAGMA answer without column metadata. `existingColumnsFromPragma` answers
 *  `null` for that AND for an absent table, because for the migration both mean "do not ALTER";
 *  here the first would skip the table and turn an unread database into a "no". */
export function holdsProjectsStatement(
  tables: readonly string[],
  pragmaResults: readonly (PipelineResultLike | undefined)[],
): SqlStmt | null {
  const checks: string[] = [];
  tables.forEach((table, i) => {
    if ((pragmaResults[i]?.response?.result?.cols ?? []).length === 0) throw new Error(UNREADABLE);
    const columns = existingColumnsFromPragma(pragmaResults[i]);
    if (columns === null) return; // metadata but no rows: the table does not exist
    if (table === PROJECTS_TABLE) checks.push(`EXISTS (SELECT 1 FROM "${table}")`);
    else if (columns.includes("project_id")) checks.push(`EXISTS (SELECT 1 FROM "${table}" WHERE project_id IS NOT NULL)`);
  });
  return checks.length === 0 ? null : { sql: `SELECT (${checks.join(" OR ")}) AS held` };
}

/** Reads the answer of {@link holdsProjectsStatement}; throws when the answer has no row. */
export function holdsProjectsFromResult(res: PipelineResultLike | undefined): boolean {
  const row = rowObjects(res)[0];
  if (row === undefined || !("held" in row)) throw new Error(UNREADABLE);
  return row.held !== "" && row.held !== "0";
}

/** Whether the database behind `config` holds any project. Throws when it cannot be read: a
 *  caller about to overwrite the database must not take an unanswered question for a no. */
export async function tursoDatabaseHoldsProjects(config: TursoConfig): Promise<boolean> {
  const tables = holdsProjectsProbeTables();
  const pragma = await runTursoPipeline(config, pragmaStatements(tables), LOAD_TIMEOUT_MS);
  const stmt = holdsProjectsStatement(tables, pragma);
  if (stmt === null) return false;
  const [res] = await runTursoPipeline(config, [stmt], LOAD_TIMEOUT_MS);
  return holdsProjectsFromResult(res);
}
