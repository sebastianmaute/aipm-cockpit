// src/app/chat-threads-store.ts — async CRUD for per-project AI chat threads
// over the shared Turso pipeline. Every call prepends the DDL (CREATE IF NOT
// EXISTS) after healing an older table once per database (the owner and key
// columns). Rows are sealed and opened by chat-thread-codec.ts; this module
// never writes a plaintext row. Mirrors committee-report-versions-store.ts.
import { runTursoPipeline } from "./turso-pipeline";
import {
  CHAT_THREADS_DDL, CHAT_THREADS_TABLE, CHAT_THREAD_CAP, chatThreadsHealAlters, threadsSelect,
  upsertThreadStatements, deleteThreadStatements, pruneThreadsStatements,
  deleteOwnerThreadsStatements, expireThreadsStatements,
} from "./chat-threads-schema";
import { decodeThreadRows, encodeThreadRow, type ChatIdentity } from "./chat-thread-codec";
import { pragmaStatements } from "./turso-migrate";
import type { ChatThread } from "./chat-threads";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";

const ddl = (): SqlStmt[] => CHAT_THREADS_DDL.map((sql) => ({ sql }));

/** One heal per database (keyed by `httpUrl`); a failed heal is forgotten so the next call retries. */
const healed = new Map<string, Promise<void>>();

async function runHeal(config: TursoConfig | null): Promise<void> {
  const results = await runTursoPipeline(config, [...ddl(), ...pragmaStatements([CHAT_THREADS_TABLE])]);
  const alters = chatThreadsHealAlters(results[CHAT_THREADS_DDL.length]);
  if (alters.length === 0) return;
  await runTursoPipeline(config, [{ sql: "BEGIN" }, ...alters, { sql: "COMMIT" }]);
}

function ensureColumns(config: TursoConfig | null): Promise<void> {
  const key = config?.httpUrl ?? "";
  const known = healed.get(key);
  if (known) return known;
  const run = runHeal(config).catch((err: unknown) => {
    healed.delete(key);
    throw err;
  });
  healed.set(key, run);
  return run;
}

/** Test seam: forget every remembered heal. */
export function __resetChatThreadsHealForTests(): void {
  healed.clear();
}

async function run(config: TursoConfig | null, stmts: SqlStmt[]) {
  await ensureColumns(config);
  return runTursoPipeline(config, [...ddl(), ...stmts]);
}

/** One project's threads `id` may read: its own (opened) and the legacy
 *  plaintext ones. With `id` null, the legacy ones only. */
export async function loadThreads(
  config: TursoConfig | null,
  projectId: string,
  id: ChatIdentity | null,
): Promise<ChatThread[]> {
  const results = await run(config, threadsSelect(projectId, id?.ownerId ?? null));
  return decodeThreadRows(results[CHAT_THREADS_DDL.length], id);
}

/** Seal and upsert `th` as `id`'s thread, then prune `id`'s threads in that
 *  project beyond the cap. Without an identity or a recovery key it refuses
 *  before any network call — there is no plaintext write path. */
export async function saveThread(
  config: TursoConfig | null,
  th: ChatThread,
  id: ChatIdentity | null,
  recoverySpki: string | null,
): Promise<void> {
  if (id === null || !recoverySpki) {
    throw new Error("saveThread: a chat identity and a recovery key are required");
  }
  const row = await encodeThreadRow(th, id, recoverySpki);
  await run(config, [
    ...upsertThreadStatements(row),
    ...pruneThreadsStatements(th.projectId, id.ownerId, CHAT_THREAD_CAP),
  ]);
}

/** Delete one thread of `ownerId` (or a legacy owner-less one). Without an
 *  owner it refuses before any network call. */
export async function deleteThread(
  config: TursoConfig | null,
  id: string,
  projectId: string,
  ownerId: string | null,
): Promise<void> {
  if (!ownerId) throw new Error("deleteThread: an owner id is required");
  await run(config, deleteThreadStatements(id, projectId, ownerId));
}

/** Delete every thread of `ownerId`, in every project of the database. */
export async function deleteOwnerThreads(config: TursoConfig | null, ownerId: string): Promise<void> {
  await run(config, deleteOwnerThreadsStatements(ownerId));
}

/** Delete threads last updated before `cutoffIso` (and any without a date). */
export async function expireThreads(config: TursoConfig | null, cutoffIso: string, projectId?: string): Promise<void> {
  await run(config, expireThreadsStatements(cutoffIso, projectId));
}
