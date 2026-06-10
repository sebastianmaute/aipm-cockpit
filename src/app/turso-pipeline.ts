// src/app/turso-pipeline.ts
//
// Shared Turso (libSQL) HTTP /v2/pipeline runner. Extracted from TursoBackend so
// the workspace backend AND the snapshot store share one transport with one
// place handling auth (401), unreachable networks, timeouts, and error results.

import { StorageNotReadyError } from "./storage";
import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";

// A hung endpoint must not leave the debounced autosave pending forever: abort
// and surface the same "storage-unreachable" kind an unreachable host produces.
export const DEFAULT_PIPELINE_TIMEOUT_MS = 15_000;
// load() blocks the initial UI hydration, so backends fail loads faster than
// the save-oriented pipeline default above.
export const LOAD_TIMEOUT_MS = 10_000;
// Short budget for the best-effort ROLLBACK follow-up after a statement error.
const ROLLBACK_TIMEOUT_MS = 5_000;

function execute(stmt: SqlStmt) {
  return { type: "execute" as const, stmt };
}

// Transactional batches always start with BEGIN, so only the first statement
// is checked (avoids false positives on mid-batch matches).
function isTransactional(stmts: SqlStmt[]): boolean {
  return /^\s*BEGIN\b/i.test(stmts[0]?.sql ?? "");
}

/** POST a pipeline request with an AbortController-based timeout. */
async function postPipeline(
  config: TursoConfig,
  stmts: SqlStmt[],
  timeoutMs: number,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.authToken) {
    headers.Authorization = `Bearer ${config.authToken}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${config.httpUrl}/v2/pipeline`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requests: stmts.map(execute) }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Best-effort ROLLBACK after a mid-pipeline statement error so a concurrent
// reader cannot observe a half-written workspace while the server-side
// transaction stays open. Both thrown exceptions AND non-ok HTTP responses are
// deliberately discarded so the original statement error is never masked, and
// it goes straight to postPipeline, so it can never recurse back into
// runTursoPipeline.
async function rollbackBestEffort(config: TursoConfig): Promise<void> {
  try {
    const res = await postPipeline(config, [{ sql: "ROLLBACK" }], ROLLBACK_TIMEOUT_MS);
    if (!res.ok) {
      // Intentionally ignored: a failed ROLLBACK must not mask the original error.
    }
  } catch {
    // Intentionally swallowed: the caller is about to throw the original error.
  }
}

export async function runTursoPipeline(
  config: TursoConfig | null,
  stmts: SqlStmt[],
  timeoutMs: number = DEFAULT_PIPELINE_TIMEOUT_MS,
): Promise<PipelineResultLike[]> {
  if (!config) {
    throw new StorageNotReadyError("Configure the Turso URL and token in Settings.");
  }
  let res: Response;
  try {
    res = await postPipeline(config, stmts, timeoutMs);
  } catch {
    // Network failure or timeout abort: either way the host is unreachable.
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
      // Awaited so the ROLLBACK completes before the caller sees the rejection
      // (and before any debounced retry could start a new pipeline).
      if (isTransactional(stmts)) await rollbackBestEffort(config);
      throw new Error(`Turso error: ${r.error?.message ?? "unknown"}`);
    }
  }
  return results;
}
