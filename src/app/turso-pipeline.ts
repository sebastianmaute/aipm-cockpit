// src/app/turso-pipeline.ts
//
// Shared Turso (libSQL) HTTP /v2/pipeline runner. Extracted from TursoBackend so
// the workspace backend AND the snapshot store share one transport with one
// place handling auth (401), unreachable networks, timeouts, and error results.

import { StorageNotReadyError } from "./workspace";
import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import { clearEnvTokenRejected, markEnvTokenRejected, type TursoConfig } from "./turso-config";
import { fetchTextWithTimeout } from "./fetch-with-timeout";

// A hung endpoint must not leave the debounced autosave pending forever: abort
// and surface the same "storage-unreachable" kind an unreachable host produces.
export const DEFAULT_PIPELINE_TIMEOUT_MS = 15_000;
// The LOAD bound lives in fetch-with-timeout.ts (shared with the SharePoint load); re-exported so the
// Turso backend and its tests keep importing it from here.
export { LOAD_TIMEOUT_MS } from "./fetch-with-timeout";
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

/** POST a pipeline request through `fetchTextWithTimeout`, which owns the timeout AND the rule that the
 *  response body is read inside the armed window — read its docstring (fetch-with-timeout.ts) before
 *  changing either. Every caller here catches whatever this rejects with. */
async function postPipeline(
  config: TursoConfig,
  stmts: SqlStmt[],
  timeoutMs: number,
): Promise<{ status: number; ok: boolean; text: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.authToken) {
    headers.Authorization = `Bearer ${config.authToken}`;
  }
  return fetchTextWithTimeout(
    `${config.httpUrl}/v2/pipeline`,
    { method: "POST", headers, body: JSON.stringify({ requests: stmts.map(execute) }) },
    timeoutMs,
  );
}

// Best-effort ROLLBACK after a mid-pipeline statement error so a concurrent
// reader cannot observe a half-written workspace while the server-side
// transaction stays open. Both thrown exceptions AND non-ok HTTP responses are
// deliberately discarded so the original statement error is never masked, and
// it goes straight to postPipeline, so it can never recurse back into
// runTursoPipeline.
async function rollbackBestEffort(config: TursoConfig): Promise<void> {
  try {
    await postPipeline(config, [{ sql: "ROLLBACK" }], ROLLBACK_TIMEOUT_MS);
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
  let res: { status: number; ok: boolean; text: string };
  try {
    res = await postPipeline(config, stmts, timeoutMs);
  } catch {
    // Network failure, or a timeout abort on either the headers or the body:
    // either way the host is unreachable.
    throw new StorageNotReadyError("storage-unreachable");
  }
  if (res.status === 401 || res.status === 403) {
    // §337 — flag it ONLY when the rejected token is the deployment's env
    // token, so a wrong Settings-typed token (which the user can just retype)
    // never trips the flag that makes Settings win over the env.
    if (config.authToken !== "" && config.authToken === process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN) {
      markEnvTokenRejected();
    }
    throw new StorageNotReadyError("turso-token-rejected");
  }
  if (!res.ok) {
    throw new Error(`Turso returned ${res.status}. Try again later.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(res.text);
  } catch {
    // A non-JSON 200 used to escape as a raw SyntaxError from `res.json()`.
    throw new Error("Turso returned an unexpected response shape.");
  }
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
  // §337 — a success using the env token proves the deployment is fixed, so a
  // stale rejection flag (and the Settings-wins-over-env precedence it grants)
  // does not outlive the incident that set it.
  if (config.authToken !== "" && config.authToken === process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN) {
    clearEnvTokenRejected();
  }
  return results;
}

/** Timeout for the Settings "Test connection" probe. Shorter than
 *  DEFAULT_PIPELINE_TIMEOUT_MS because a human is watching a spinner. */
export const TEST_CONNECTION_TIMEOUT_MS = 10_000;

/** Round-trip the smallest possible statement to prove a URL/token pair
 *  actually connects. Resolves on success; rejects with the error
 *  `runTursoPipeline` already discriminates — StorageNotReadyError for an
 *  absent config, an unreachable host or a rejected token, and a plain Error
 *  carrying the status for anything else.
 *
 *  ★ NOTHING IS PERSISTED FROM THIS. The caller keeps the outcome in transient
 *  component state, exactly as the Jira and Timelog test buttons do. A stored
 *  "connection confirmed" flag would be a new Settings field and therefore the
 *  six-write-paths case (open-followups §408). */
export async function testTursoConnection(config: TursoConfig | null): Promise<void> {
  await runTursoPipeline(config, [{ sql: "SELECT 1" }], TEST_CONNECTION_TIMEOUT_MS);
}
