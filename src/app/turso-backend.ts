// src/app/turso-backend.ts
//
// Turso (libSQL) storage backend. Stores the whole Workspace as a single
// JSON blob row (id=1) via Turso's HTTP pipeline API. Token is delegated
// via the resolved TursoConfig (env-or-settings). Last-write-wins.

import {
  StorageNotReadyError,
  emptyWorkspace,
  jsonToWorkspace,
  workspaceToJson,
  type StorageBackend,
  type Workspace,
} from "./storage";
import type { TursoConfig } from "./turso-config";

const TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY, data TEXT NOT NULL)";
const SELECT_SQL = "SELECT data FROM workspace WHERE id = 1";
const UPSERT_SQL =
  "INSERT INTO workspace (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data";

interface TextArg {
  type: "text";
  value: string;
}
interface PipelineStmt {
  sql: string;
  args?: TextArg[];
}
interface Cell {
  type?: string;
  value?: unknown;
}
interface PipelineResult {
  type: "ok" | "error";
  response?: { type: string; result?: { rows?: Cell[][] } };
  error?: { message?: string };
}

function execute(stmt: PipelineStmt) {
  return { type: "execute" as const, stmt };
}

/** Defensively read results[i].response.result.rows[0][0].value as a string. */
function firstRowText(results: PipelineResult[], i: number): string | null {
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

  private async runPipeline(stmts: PipelineStmt[]): Promise<PipelineResult[]> {
    if (!this.config) {
      throw new StorageNotReadyError("Configure the Turso URL and token in Settings.");
    }
    const res = await fetch(`${this.config.httpUrl}/v2/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [...stmts.map(execute), { type: "close" }],
      }),
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
    const results = (raw as { results?: PipelineResult[] }).results ?? [];
    for (const r of results) {
      if (r.type === "error") {
        throw new Error(`Turso error: ${r.error?.message ?? "unknown"}`);
      }
    }
    return results;
  }

  async load(): Promise<Workspace> {
    const results = await this.runPipeline([{ sql: TABLE_DDL }, { sql: SELECT_SQL }]);
    if (results.length < 2) {
      throw new Error("Turso pipeline returned fewer results than expected.");
    }
    // results[0] = DDL, results[1] = SELECT.
    const text = firstRowText(results, 1);
    if (text === null) return emptyWorkspace();
    return jsonToWorkspace(text);
  }

  async save(workspace: Workspace): Promise<void> {
    await this.runPipeline([
      { sql: TABLE_DDL },
      { sql: UPSERT_SQL, args: [{ type: "text", value: workspaceToJson(workspace) }] },
    ]);
  }
}
