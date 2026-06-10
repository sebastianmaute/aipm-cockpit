// src/app/turso-tenant-backend.ts
//
// Per-project Turso (libSQL) StorageBackend. Reads/writes only the slice of the
// shared DB tagged with `projectId`. Reuses the shared pipeline transport (so the
// existing tursoErrorKind classification + storage banner keep working) and the
// project-scoped statement builders. The dynamic import inside load()/save()
// mirrors TursoBackend's pattern of breaking the storage -> backend -> schema ->
// storage module cycle.
//
// NOTE: rowsToWorkspace does not populate ws.project (ProjectMeta is not in the
// workspace tables under Turso), so load() additionally fetches the projects-table
// row for this id and sets ws.project from it.

import {
  emptyWorkspace,
  type StorageBackend,
  type Workspace,
} from "./storage";
import { LOAD_TIMEOUT_MS, runTursoPipeline } from "./turso-pipeline";
import type { TursoConfig } from "./turso-config";

export class TursoTenantBackend implements StorageBackend {
  readonly kind = "turso" as const;

  constructor(private config: TursoConfig | null, private projectId: string) {}

  async isReady(): Promise<boolean> {
    return this.config !== null;
  }

  async describe(): Promise<string | null> {
    if (!this.config) return null;
    try {
      return `Turso: ${new URL(this.config.httpUrl).host}`;
    } catch {
      return "Turso";
    }
  }

  async load(): Promise<Workspace> {
    const { TABLE_NAMES, rowsToWorkspace } = await import("./turso-schema");
    const { tenantSchemaDdl, tenantSelectStatements, selectProjectStatement, rowsToProjectList } =
      await import("./turso-tenant-schema");
    const ddl = tenantSchemaDdl();
    const stmts = [
      ...ddl.map((sql) => ({ sql })),
      ...tenantSelectStatements(this.projectId),
      selectProjectStatement(this.projectId),
    ];
    const results = await runTursoPipeline(this.config, stmts, LOAD_TIMEOUT_MS);
    const relational = results.slice(ddl.length, ddl.length + TABLE_NAMES.length);
    const projectsResult = results[ddl.length + TABLE_NAMES.length];
    const isEmpty = relational.every((r) => (r?.response?.result?.rows?.length ?? 0) === 0);
    const ws = isEmpty ? emptyWorkspace() : rowsToWorkspace(relational);
    const meta = rowsToProjectList(projectsResult)[0]?.meta;
    return meta ? { ...ws, project: meta } : ws;
  }

  async save(workspace: Workspace): Promise<void> {
    const { tenantWorkspaceToStatements } = await import("./turso-tenant-schema");
    await runTursoPipeline(this.config, tenantWorkspaceToStatements(workspace, this.projectId));
  }
}
