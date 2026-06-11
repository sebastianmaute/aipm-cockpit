// src/app/turso-backend.ts
//
// Turso (libSQL) storage backend. Stores the workspace relationally via
// Turso's HTTP pipeline API. Token is delegated via the resolved TursoConfig
// (env-or-settings). Last-write-wins; save() wraps the overwrite in a
// BEGIN/COMMIT transaction.
//
// The backend is parameterized by an optional `projectId`:
//   - projectId === undefined → single-tenant mode: the whole DB is one
//     workspace (plus the legacy single-blob import probe).
//   - projectId set → multi-tenant (portfolio) mode: reads/writes only the
//     slice of the shared DB tagged with `project_id = projectId`, using the
//     project-scoped statement builders from turso-tenant-schema.
//
// The schema modules are imported dynamically inside load() / save() (called
// only at runtime, never at module-init time) — a historical guard against the
// former storage → turso-backend → turso-schema → storage cycle, kept to defer
// loading the heavy codec layer until a Turso backend is actually used. The
// type-only imports below are erased at compile time.

import {
  emptyWorkspace,
  jsonToWorkspace,
  type StorageBackend,
  type Workspace,
} from "./workspace";
import { LOAD_TIMEOUT_MS, runTursoPipeline } from "./turso-pipeline";
import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";

const OLD_BLOB_DDL = "CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY, data TEXT NOT NULL)";
const OLD_BLOB_SELECT = "SELECT data FROM workspace WHERE id = 1";

/** Defensively read results[i].response.result.rows[0][0].value as a string. */
function firstRowText(results: PipelineResultLike[], i: number): string | null {
  const cell = results[i]?.response?.result?.rows?.[0]?.[0];
  return cell && typeof cell.value === "string" ? cell.value : null;
}

export class TursoBackend implements StorageBackend {
  readonly kind = "turso" as const;

  constructor(
    private config: TursoConfig | null,
    private projectId?: string,
  ) {}

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
    return this.projectId === undefined
      ? this.loadSingleTenant()
      : this.loadTenant(this.projectId);
  }

  async save(workspace: Workspace): Promise<void> {
    // Dynamic import breaks the storage → turso-backend → turso-schema → storage cycle.
    if (this.projectId === undefined) {
      const { workspaceToStatements } = await import("./turso-schema");
      await runTursoPipeline(this.config, workspaceToStatements(workspace));
      return;
    }
    const { tenantWorkspaceToStatements } = await import("./turso-tenant-schema");
    await runTursoPipeline(this.config, tenantWorkspaceToStatements(workspace, this.projectId));
  }

  private async loadSingleTenant(): Promise<Workspace> {
    // Dynamic import breaks the storage → turso-backend → turso-schema → storage cycle.
    const { SCHEMA_DDL, TABLE_NAMES, selectStatements, rowsToWorkspace } =
      await import("./turso-schema");

    const stmts: SqlStmt[] = [
      ...SCHEMA_DDL.map((sql) => ({ sql })),
      { sql: OLD_BLOB_DDL },
      ...selectStatements(),
      { sql: OLD_BLOB_SELECT },
    ];
    const results = await runTursoPipeline(this.config, stmts, LOAD_TIMEOUT_MS);
    const ddlCount = SCHEMA_DDL.length + 1; // schema DDL + old-blob DDL
    const selectCount = TABLE_NAMES.length;
    const relational = results.slice(ddlCount, ddlCount + selectCount);
    const blobResult = results[ddlCount + selectCount];
    const isEmpty = relational.every((r) => (r?.response?.result?.rows?.length ?? 0) === 0);
    if (isEmpty) {
      const blob = firstRowText([blobResult], 0);
      if (typeof blob === "string" && blob.length > 0) return jsonToWorkspace(blob);
      return emptyWorkspace();
    }
    return rowsToWorkspace(relational);
  }

  // NOTE: rowsToWorkspace does not populate ws.project (ProjectMeta is not in the
  // workspace tables under Turso), so tenant load() additionally fetches the
  // projects-table row for this id and sets ws.project from it.
  private async loadTenant(projectId: string): Promise<Workspace> {
    const { TABLE_NAMES, rowsToWorkspace } = await import("./turso-schema");
    const { tenantSchemaDdl, tenantSelectStatements, selectProjectStatement, rowsToProjectList } =
      await import("./turso-tenant-schema");
    const ddl = tenantSchemaDdl();
    const stmts = [
      ...ddl.map((sql) => ({ sql })),
      ...tenantSelectStatements(projectId),
      selectProjectStatement(projectId),
    ];
    const results = await runTursoPipeline(this.config, stmts, LOAD_TIMEOUT_MS);
    const relational = results.slice(ddl.length, ddl.length + TABLE_NAMES.length);
    const projectsResult = results[ddl.length + TABLE_NAMES.length];
    const isEmpty = relational.every((r) => (r?.response?.result?.rows?.length ?? 0) === 0);
    const ws = isEmpty ? emptyWorkspace() : rowsToWorkspace(relational);
    const meta = rowsToProjectList(projectsResult)[0]?.meta;
    return meta ? { ...ws, project: meta } : ws;
  }
}
