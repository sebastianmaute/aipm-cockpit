// open-followups §204 — the side tables that carry a `project_id` but are
// deliberately OUTSIDE TABLE_NAMES (a workspace save's per-table DELETE sweep
// would otherwise wipe them), so the tenant hard-delete transaction never
// reaches them. `hardDeleteProject` sweeps these in ONE separate, non-fatal
// pipeline. `turso-side-tables.guard.test.ts` fails on any project-keyed table
// missing from both lists.
import { CHAT_THREADS_DDL } from "./chat-threads-schema";
import { MEETING_REPORT_VERSION_DDL } from "./committee-report-versions-schema";
import { DOCUMENT_ASSET_DATA_DDL } from "./document-assets-schema";
import { SNAPSHOT_DDL } from "./snapshot-schema";
import { VERSION_DDL } from "./version-schema";
import { txt, type SqlStmt } from "./turso-schema";

export interface ProjectSideTable { table: string; ddl: readonly string[] }

export const PROJECT_SCOPED_SIDE_TABLES: readonly ProjectSideTable[] = [
  { table: "chat_threads", ddl: CHAT_THREADS_DDL },
  { table: "committee_report_versions", ddl: MEETING_REPORT_VERSION_DDL },
  { table: "document_asset_data", ddl: DOCUMENT_ASSET_DATA_DDL },
  { table: "snapshot", ddl: SNAPSHOT_DDL },
  { table: "snapshot_series", ddl: SNAPSHOT_DDL },
  { table: "project_versions", ddl: VERSION_DDL },
];

/** Create-if-missing DDL for every entry (so a never-used side table does not
 *  fail the DELETE), then one project-scoped DELETE per entry. */
export function projectSideTableSweepStatements(projectId: string): SqlStmt[] {
  const seen = new Set<string>();
  const out: SqlStmt[] = [];
  for (const { ddl } of PROJECT_SCOPED_SIDE_TABLES) {
    for (const sql of ddl) {
      if (seen.has(sql)) continue;
      seen.add(sql);
      out.push({ sql });
    }
  }
  for (const { table } of PROJECT_SCOPED_SIDE_TABLES) {
    out.push({ sql: `DELETE FROM ${table} WHERE project_id = ?`, args: [txt(projectId)] });
  }
  return out;
}
