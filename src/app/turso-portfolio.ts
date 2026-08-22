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
import { deleteAllAssetDataForProject } from "./document-assets-store";
import { logDiag } from "./diagnostics";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import type { ProjectMeta } from "./types";

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
  await runTursoPipeline(config, [...ddl(), ...hardDeleteProjectStatements(id)]);
  // document_asset_data lives OUTSIDE TABLE_NAMES (a workspace save's per-table
  // DELETE sweep would otherwise wipe the whole image library on every save),
  // so hardDeleteProjectStatements' loop over TABLE_NAMES never touches it —
  // nothing else ever cleans it up. Non-fatal: a failure here must not abort
  // the project deletion the user asked for. Leaked bytes are recoverable; a
  // half-deleted project is not.
  try {
    await deleteAllAssetDataForProject(config, id);
  } catch (err) {
    logDiag("warn", "storage.projectAssetCleanupFailed", { id, message: err instanceof Error ? err.message : String(err) });
  }
}
