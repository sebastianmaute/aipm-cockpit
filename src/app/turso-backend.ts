// src/app/turso-backend.ts
//
// Turso (libSQL) storage backend. Stores the workspace relationally via
// Turso's HTTP pipeline API. Token is delegated via the resolved TursoConfig
// (env-or-settings). Last-write-wins; save() wraps the overwrite in a
// BEGIN/COMMIT transaction.
//
// turso-schema.ts imports heavily from storage.ts. To avoid the circular
// dependency  storage → turso-backend → turso-schema → storage  the schema
// module is imported dynamically inside load() / save() (called only at
// runtime, never at module-init time). The type-only imports below are erased
// at compile time and do not create a runtime cycle.

import {
  StorageNotReadyError,
  emptyWorkspace,
  jsonToWorkspace,
  type StorageBackend,
  type Workspace,
} from "./storage";
import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";

const OLD_BLOB_DDL = "CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY, data TEXT NOT NULL)";
const OLD_BLOB_SELECT = "SELECT data FROM workspace WHERE id = 1";

function execute(stmt: SqlStmt) {
  return { type: "execute" as const, stmt };
}

/** Defensively read results[i].response.result.rows[0][0].value as a string. */
function firstRowText(results: PipelineResultLike[], i: number): string | null {
  const cell = results[i]?.response?.result?.rows?.[0]?.[0];
  return cell && typeof cell.value === "string" ? cell.value : null;
}

export class TursoBackend implements StorageBackend {
  readonly kind = "turso" as const;

  constructor(private config: TursoConfig | null) {}

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

  private async runPipeline(stmts: SqlStmt[]): Promise<PipelineResultLike[]> {
    if (!this.config) {
      throw new StorageNotReadyError("Configure the Turso URL and token in Settings.");
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    // Only authenticate when a token is configured — a loopback (local) tursodb
    // typically needs none.
    if (this.config.authToken) {
      headers.Authorization = `Bearer ${this.config.authToken}`;
    }
    const res = await fetch(`${this.config.httpUrl}/v2/pipeline`, {
      method: "POST",
      headers,
      // No trailing { type: "close" } frame: the classic Hrana endpoint
      // auto-closes a baton-less stream, and newer engines (local tursodb)
      // reject the "close" request variant outright.
      body: JSON.stringify({ requests: stmts.map(execute) }),
    });
    if (res.status === 401) {
      throw new StorageNotReadyError("Turso auth token rejected. Check the token in Settings.");
    }
    if (!res.ok) {
      throw new Error(`Turso returned ${res.status}. Try again later.`);
    }
    const raw: unknown = await res.json();
    if (!raw || typeof raw !== "object" || !("results" in raw)) {
      throw new Error("Turso returned an unexpected response shape.");
    }
    const results = (raw as { results?: PipelineResultLike[] }).results ?? [];
    for (const r of results) {
      if (r.type === "error") {
        throw new Error(`Turso error: ${r.error?.message ?? "unknown"}`);
      }
    }
    return results;
  }

  async load(): Promise<Workspace> {
    // Dynamic import breaks the storage → turso-backend → turso-schema → storage cycle.
    const { SCHEMA_DDL, TABLE_NAMES, selectStatements, rowsToWorkspace } =
      await import("./turso-schema");

    const stmts: SqlStmt[] = [
      ...SCHEMA_DDL.map((sql) => ({ sql })),
      { sql: OLD_BLOB_DDL },
      ...selectStatements(),
      { sql: OLD_BLOB_SELECT },
    ];
    const results = await this.runPipeline(stmts);
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

  async save(workspace: Workspace): Promise<void> {
    // Dynamic import breaks the storage → turso-backend → turso-schema → storage cycle.
    const { workspaceToStatements } = await import("./turso-schema");
    await this.runPipeline(workspaceToStatements(workspace));
  }
}
