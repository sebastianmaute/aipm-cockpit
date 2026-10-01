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
function execute(stmt: SqlStmt) {
  return { type: "execute" as const, stmt };
}

const BEGIN_RE = /^\s*BEGIN\b/i;

// A transactional statement list starts with BEGIN and ends with COMMIT.
function isTransactional(stmts: SqlStmt[]): boolean {
  return BEGIN_RE.test(stmts[0]?.sql ?? "") && /^\s*COMMIT\b/i.test(stmts[stmts.length - 1]?.sql ?? "");
}

// ★★ A BEGIN that is not the first statement, or a list that starts with BEGIN
// but does not end with COMMIT, would go out as separate `execute` requests and
// commit around a failing statement — the §637 failure, silently. Every such
// list is a caller bug (a DDL prefix before BEGIN was one), so it is refused
// before anything is sent.
function assertWellFormedTransaction(stmts: SqlStmt[]): void {
  const misplaced = stmts.some((s, i) => i > 0 && BEGIN_RE.test(s.sql));
  if (misplaced || (BEGIN_RE.test(stmts[0]?.sql ?? "") && !isTransactional(stmts))) {
    throw new Error("A Turso transaction must start with BEGIN and end with COMMIT, with nothing before BEGIN.");
  }
}

// ★★★ §637: a transactional list goes out as ONE Hrana `batch` request, never
// as separate `execute` requests. The server runs every `execute` in a
// pipeline even after one fails, so COMMIT used to commit everything that
// succeeded around a rejected row while the save reported failure (measured
// against a live database; AGENTS.md's `idKind` bullet). In the batch each
// step runs only if the step before it succeeded, so a failure skips the rest
// and COMMIT with it, and the trailing ROLLBACK step runs whenever COMMIT did
// not succeed. A failed save therefore writes nothing — per the Hrana protocol;
// the live-database check (e2e, §637) has not run yet.
type BatchCondition = { type: "ok"; step: number } | { type: "not"; cond: BatchCondition };

function atomicBatch(stmts: SqlStmt[]) {
  const steps: { stmt: SqlStmt; condition?: BatchCondition }[] = stmts.map((stmt, i) =>
    i === 0 ? { stmt } : { stmt, condition: { type: "ok", step: i - 1 } },
  );
  steps.push({ stmt: { sql: "ROLLBACK" }, condition: { type: "not", cond: { type: "ok", step: stmts.length - 1 } } });
  return { type: "batch" as const, batch: { steps } };
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
  const requests = isTransactional(stmts) ? [atomicBatch(stmts)] : stmts.map(execute);
  return fetchTextWithTimeout(
    `${config.httpUrl}/v2/pipeline`,
    { method: "POST", headers, body: JSON.stringify({ requests }) },
    timeoutMs,
  );
}

const SHAPE_ERROR = "Turso returned an unexpected response shape.";

/** §4 — a transactional statement failed; `stepIndex` is its index in the list the caller passed (the
 *  batch's own trailing ROLLBACK is never it). Lets a caller tell WHICH statement failed without reading
 *  the server's error text. The message is the same `Turso error: …` every caller already reads. */
export class TursoStepError extends Error {
  constructor(public readonly stepIndex: number, serverMessage: string) {
    super(`Turso error: ${serverMessage}`);
    this.name = "TursoStepError";
  }
}

type StepResult = NonNullable<PipelineResultLike["response"]>["result"];
interface BatchAnswer { step_results?: (StepResult | null)[]; step_errors?: ({ message?: string } | null)[] }

/** Unpacks a batch answer into the one-result-per-statement shape every caller reads. Throws the first
 *  statement's error (the ROLLBACK step's own error only follows it), and treats a statement that neither
 *  ran nor failed as a shape error: every statement must have run for the COMMIT to have run. */
function batchResults(results: PipelineResultLike[], count: number): PipelineResultLike[] {
  const [only] = results;
  if (only?.type === "error") throw new Error(`Turso error: ${only.error?.message ?? "unknown"}`);
  const answer = (only?.response as { result?: BatchAnswer } | undefined)?.result;
  const stepResults = answer?.step_results;
  const stepErrors = answer?.step_errors ?? [];
  if (only?.response?.type !== "batch" || !Array.isArray(stepResults)) throw new Error(SHAPE_ERROR);
  const failedAt = stepErrors.slice(0, count).findIndex((e) => e);
  if (failedAt >= 0) throw new TursoStepError(failedAt, stepErrors[failedAt]?.message ?? "unknown");
  return Array.from({ length: count }, (_, i) => {
    const result = stepResults[i];
    if (!result) throw new Error(SHAPE_ERROR);
    return { type: "ok" as const, response: { type: "execute", result } };
  });
}

export async function runTursoPipeline(
  config: TursoConfig | null,
  stmts: SqlStmt[],
  timeoutMs: number = DEFAULT_PIPELINE_TIMEOUT_MS,
): Promise<PipelineResultLike[]> {
  if (!config) {
    throw new StorageNotReadyError("Configure the Turso URL and token in Settings.");
  }
  assertWellFormedTransaction(stmts);
  let res: { status: number; ok: boolean; text: string };
  try {
    res = await postPipeline(config, stmts, timeoutMs);
  } catch {
    // Network failure, or a timeout abort on either the headers or the body:
    // either way the host is unreachable.
    throw new StorageNotReadyError("storage-unreachable");
  }
  if (res.status === 401 || res.status === 403) {
    // §337 — a DISTINCT hint, not just the flag, so the classifier attributes
    // THIS rejection by what was actually rejected, never by a flag some
    // earlier, unrelated call may have left set. Controller ruling: blaming
    // the env token via the global flag alone mislabelled a rejected
    // Settings-typed token as "auth-env" whenever the flag happened to
    // already be set. The flag is still recorded here (so the field/Apply
    // reappear), but it is no longer what `storage-error.ts` reads.
    const isEnvToken = config.authToken !== "" && config.authToken === process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;
    if (isEnvToken) {
      markEnvTokenRejected();
      throw new StorageNotReadyError("turso-env-token-rejected");
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
    throw new Error(SHAPE_ERROR);
  }
  if (!raw || typeof raw !== "object" || !("results" in raw)) {
    throw new Error(SHAPE_ERROR);
  }
  const rawResults = (raw as { results?: PipelineResultLike[] }).results ?? [];
  const results = isTransactional(stmts) ? batchResults(rawResults, stmts.length) : rawResults;
  // Only the `execute` path can still carry an error here: `batchResults` has already thrown on one.
  for (const r of results) {
    if (r.type === "error") {
      throw new Error(`Turso error: ${r.error?.message ?? "unknown"}`);
    }
  }
  // §337 — a success using the env token proves the deployment is fixed, so a
  // stale rejection flag (and the Settings-wins-over-env precedence it grants)
  // does not outlive the incident that set it.
  // ★ Minor 5 (controller ruling): this ONLY fires when `config.authToken` IS
  // the env token — and while the flag is set AND a non-empty Settings token
  // exists, `getTursoConfig`'s `preferSettings` sends the SETTINGS token on
  // every call, never the env one. So a stale, still-populated Settings token
  // does not merely "linger" after the flag clears — it PREVENTS the flag from
  // ever clearing on its own, because no call can use the env token while it
  // is in the way. The flag only clears once the Settings token is emptied (or
  // the field is otherwise driven back to using the env token) AND that
  // env-token call succeeds. Do not read this as "clears automatically once
  // the deployment is fixed" — it clears once the deployment is fixed AND
  // nothing in Settings is still overriding it.
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
