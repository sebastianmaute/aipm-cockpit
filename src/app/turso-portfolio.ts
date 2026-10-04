// src/app/turso-portfolio.ts
//
// Portfolio-level operations over a shared multi-tenant Turso DB: the project
// list (source of truth) + create/update-meta/archive/restore/hard-delete.
// Every call ensures the schema exists (tenantSchemaDdl, CREATE IF NOT EXISTS)
// so a brand-new DB initializes on first use. Errors propagate from
// runTursoPipeline so the caller's tursoErrorKind classification drives the
// storage banner.

import { runTursoPipeline } from "./turso-pipeline";
import {
  tenantSchemaDdl, listProjectsStatement, listArchivedProjectsStatement,
  upsertProjectStatement, archiveProjectStatement, restoreProjectStatement,
  hardDeleteProjectStatements, rowsToProjectList, type ProjectListEntry,
} from "./turso-tenant-schema";
import { projectSideTableSweepStatements } from "./project-side-tables";
import { logDiag } from "./diagnostics";
import { rowObjects, type SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import type { ProjectMeta } from "./types";
import { sanitizeActivityLog, type ActivityEntry } from "./activity-log";
import type { ActivityAuditSource } from "./activity-audit";

const ddl = (): SqlStmt[] => tenantSchemaDdl().map((sql) => ({ sql }));

async function listWith(config: TursoConfig | null, select: SqlStmt): Promise<ProjectListEntry[]> {
  const stmts = [...ddl(), select];
  const results = await runTursoPipeline(config, stmts);
  return rowsToProjectList(results[results.length - 1]);
}

export function listProjects(config: TursoConfig | null): Promise<ProjectListEntry[]> {
  return listWith(config, listProjectsStatement());
}

export function listArchivedProjects(config: TursoConfig | null): Promise<ProjectListEntry[]> {
  return listWith(config, listArchivedProjectsStatement());
}

export async function createProject(config: TursoConfig | null, meta: ProjectMeta, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), upsertProjectStatement(meta, id, false)]);
}

export async function updateProjectMeta(config: TursoConfig | null, meta: ProjectMeta, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), upsertProjectStatement(meta, id, false)]);
}

export async function archiveProject(config: TursoConfig | null, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), archiveProjectStatement(id)]);
}

export async function restoreProject(config: TursoConfig | null, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), restoreProjectStatement(id)]);
}

export async function hardDeleteProject(config: TursoConfig | null, id: string): Promise<void> {
  // The DDL goes INSIDE the transaction, after BEGIN: `runTursoPipeline` sends a
  // list as one all-or-nothing batch only when BEGIN is its FIRST statement and
  // COMMIT its LAST (§637), and a DDL prefix used to make these deletes commit
  // around a failing one. SQLite DDL is transactional.
  const [begin, ...deletes] = hardDeleteProjectStatements(id);
  await runTursoPipeline(config, [begin, ...ddl(), ...deletes]);
  // open-followups §204 — every project-scoped side table lives OUTSIDE
  // TABLE_NAMES (a workspace save's per-table DELETE would wipe it), so the
  // transaction above never reaches them. ONE separate, non-fatal pipeline:
  // leaked rows are recoverable, a half-deleted project is not. ★ A libSQL
  // pipeline does not abort on a failing statement, so a sweep can be partial;
  // it is logged and re-runnable.
  try {
    await runTursoPipeline(config, projectSideTableSweepStatements(id));
  } catch (err) {
    logDiag("warn", "storage.projectSideTableSweepFailed", { id, message: err instanceof Error ? err.message : String(err) });
  }
}

/** §510 — every project's stored activity log, one row per project that has one. The log rides
 *  `meta` under the `activityLog` key (turso-tenant-schema.ts), scoped by `project_id`. */
export function activityLogsStatement(): SqlStmt {
  return { sql: `SELECT project_id, value FROM meta WHERE key = 'activityLog'` };
}

type DecodedLog = Pick<ActivityAuditSource, "log" | "logUnreadable" | "entriesDropped">;

function decodeLog(projectId: string, raw: string | undefined): DecodedLog {
  // No row, or a SQL NULL (which `rowObjects` reads as ""): the project has no stored log.
  if (raw === undefined || raw === "") return { log: [] };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    const log: ActivityEntry[] = sanitizeActivityLog(parsed); // drops malformed entries AND caps at ACTIVITY_MAX_ENTRIES
    return parsed.length > log.length ? { log, entriesDropped: parsed.length - log.length } : { log };
  } catch (err) {
    // One unreadable log must not sink the download of every other project's: it is listed empty,
    // FLAGGED so the file cannot read as "no activity", and logged.
    // The error NAME only: a JSON.parse message quotes part of the input, i.e. audit data (old and new
    // field values), and the diagnostics ring is a support channel.
    logDiag("warn", "storage.activityAuditLogUnreadable", { projectId, error: err instanceof Error ? err.name : typeof err });
    return { log: [], logUnreadable: true };
  }
}

/** §510 — the activity log of every project in the portfolio, archived ones included and flagged, for
 *  the internal audit download (activity-audit.ts). Changes no data: two project lists and one SELECT,
 *  after the same CREATE-IF-NOT-EXISTS schema prefix every portfolio call sends. A `meta` row whose
 *  project is gone (hard-deleted) is not listed: the projects table is the list. */
export async function readPortfolioActivityLogs(config: TursoConfig | null): Promise<ActivityAuditSource[]> {
  const results = await runTursoPipeline(config, [...ddl(), listProjectsStatement(), listArchivedProjectsStatement(), activityLogsStatement()]);
  const n = results.length;
  const projects = [...rowsToProjectList(results[n - 3]), ...rowsToProjectList(results[n - 2])];
  const logs = new Map(rowObjects(results[n - 1]).map((o) => [o.project_id, o.value]));
  return projects.map((p) => ({ id: p.id, name: p.meta.name, archived: p.archived, ...decodeLog(p.id, logs.get(p.id)) }));
}
