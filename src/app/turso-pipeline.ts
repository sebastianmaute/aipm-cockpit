// src/app/turso-pipeline.ts
//
// Shared Turso (libSQL) HTTP /v2/pipeline runner. Extracted from TursoBackend so
// the workspace backend AND the snapshot store share one transport with one
// place handling auth (401), unreachable networks, and error results.

import { StorageNotReadyError } from "./storage";
import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";

function execute(stmt: SqlStmt) {
  return { type: "execute" as const, stmt };
}

export async function runTursoPipeline(
  config: TursoConfig | null,
  stmts: SqlStmt[],
): Promise<PipelineResultLike[]> {
  if (!config) {
    throw new StorageNotReadyError("Configure the Turso URL and token in Settings.");
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.authToken) {
    headers.Authorization = `Bearer ${config.authToken}`;
  }
  let res: Response;
  try {
    res = await fetch(`${config.httpUrl}/v2/pipeline`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requests: stmts.map(execute) }),
    });
  } catch {
    throw new StorageNotReadyError("storage-unreachable");
  }
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
