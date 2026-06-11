// src/app/version-store.ts
// Async store for project_versions over the shared Turso pipeline. Independent
// of the workspace StorageBackend.save() cycle. Every call prepends VERSION_DDL
// (CREATE TABLE IF NOT EXISTS). No-ops when config is null (off-Turso). Mirrors
// snapshot-store.ts.

import { runTursoPipeline } from "./turso-pipeline";
import {
  VERSION_DDL, appendVersionStatements, versionListStatements,
  versionPayloadStatements, pruneStatements, deleteVersionStatements,
  rowsToVersionMeta, payloadFromResult,
} from "./version-schema";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import type { ProjectVersion, ProjectVersionMeta } from "./version-history";

const ddl = (): SqlStmt[] => VERSION_DDL.map((sql) => ({ sql }));

export async function listVersionMeta(config: TursoConfig | null, projectId: string): Promise<ProjectVersionMeta[]> {
  if (!config) return [];
  const results = await runTursoPipeline(config, [...ddl(), ...versionListStatements(projectId)]);
  return rowsToVersionMeta(results[VERSION_DDL.length]);
}

export async function loadVersionPayload(config: TursoConfig | null, id: string, projectId: string): Promise<string | null> {
  if (!config) return null;
  const results = await runTursoPipeline(config, [...ddl(), ...versionPayloadStatements(id, projectId)]);
  return payloadFromResult(results[VERSION_DDL.length]);
}

export async function appendVersion(config: TursoConfig | null, v: ProjectVersion, projectId: string): Promise<void> {
  if (!config) return;
  await runTursoPipeline(config, [...ddl(), ...appendVersionStatements(v, projectId)]);
}

export async function pruneVersions(config: TursoConfig | null, projectId: string, keep: number): Promise<void> {
  if (!config) return;
  await runTursoPipeline(config, [...ddl(), ...pruneStatements(projectId, keep)]);
}

export async function deleteVersion(config: TursoConfig | null, id: string, projectId: string): Promise<void> {
  if (!config) return;
  await runTursoPipeline(config, [...ddl(), ...deleteVersionStatements(id, projectId)]);
}
