// src/app/chat-threads-store.ts — async CRUD for per-project AI chat threads
// over the shared Turso pipeline. Every call prepends the DDL (CREATE IF NOT
// EXISTS) after healing an older table once per database (the owner and key
// columns). Rows are sealed and opened by chat-thread-codec.ts; this module
// never writes a plaintext row. Mirrors committee-report-versions-store.ts.
import { runTursoPipeline } from "./turso-pipeline";
import {
  CHAT_THREADS_DDL, CHAT_THREADS_TABLE, CHAT_THREAD_CAP, chatThreadsHealAlters, threadsSelect,
  upsertThreadStatements, updateStoredThreadStatements, deleteThreadStatements, pruneThreadsStatements,
  deleteOwnerThreadsStatements, expireThreadsStatements, legacyThreadIdsSelect, allThreadIdsSelect, threadPresentSelect,
  ownerThreadsSelect,
} from "./chat-threads-schema";
import { decodeThreadRows, encodeThreadRow, type ChatIdentity } from "./chat-thread-codec";
import { pragmaStatements } from "./turso-migrate";
import type { ChatThread } from "./chat-threads";
import { rowObjects, type SqlStmt } from "./turso-schema";
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

/** Create the table and bring an older one up to the current columns (once per database), for a
 *  caller that runs its own chat_threads statements (adoption, chat-passphrase.ts). */
export function ensureChatThreadsColumns(config: TursoConfig | null): Promise<void> {
  return ensureColumns(config);
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

/** What a save did: wrote the row; or changed nothing because the id is held by another owner
 *  (or another project) — the owner-guarded upsert then matches no row, or a stored thread's row was
 *  taken over by another owner ("not-owned"); or, for a thread known to be stored, changed nothing
 *  because its row is gone ("gone") — it is never inserted again; or changed nothing and the read that
 *  tells those two apart failed ("unconfirmed") — treated like gone, without saying it was deleted. */
export type SaveThreadOutcome = "saved" | "not-owned" | "gone" | "unconfirmed";

/** `stored`: the thread is known to be in the database (loaded from it, or saved earlier in this
 *  session). Such a thread is only ever UPDATEd, so an erased chat cannot come back. */
export interface SaveThreadOptions {
  stored?: boolean;
}

/** Seal and write `th` as `id`'s thread, then prune `id`'s threads in that
 *  project beyond the cap. Without an identity or a recovery key it refuses
 *  before any network call — there is no plaintext write path. A thread never
 *  stored is upserted ("not-owned" when the server says that changed no row); a
 *  stored one is updated in place only ("gone" when that changed no row). */
export async function saveThread(
  config: TursoConfig | null,
  th: ChatThread,
  id: ChatIdentity,
  recoverySpki: string,
  options: SaveThreadOptions = {},
): Promise<SaveThreadOutcome> {
  if (!id?.ownerId || !recoverySpki) {
    throw new Error("saveThread: a chat identity and a recovery key are required");
  }
  const row = await encodeThreadRow(th, id, recoverySpki);
  const write = options.stored ? updateStoredThreadStatements(row) : upsertThreadStatements(row);
  const results = await run(config, [
    ...write,
    ...pruneThreadsStatements(th.projectId, id.ownerId, CHAT_THREAD_CAP),
  ]);
  if (results[CHAT_THREADS_DDL.length]?.response?.result?.affected_row_count !== 0) return "saved";
  if (!options.stored) return "not-owned";
  // A stored thread's UPDATE matched nothing: its row is gone, or another owner took it over (a legacy
  // row adopted elsewhere). One id-only read tells them apart; no content is read.
  try {
    return (await threadPresent(config, th.id, th.projectId)) ? "not-owned" : "gone";
  } catch {
    return "unconfirmed";
  }
}

/** Whether a row with this id exists in this project, whoever owns it. Reads no content. */
async function threadPresent(config: TursoConfig | null, id: string, projectId: string): Promise<boolean> {
  const results = await run(config, threadPresentSelect(id, projectId));
  return rowObjects(results[CHAT_THREADS_DDL.length]).length > 0;
}

/** Delete one thread of `ownerId` (or a legacy owner-less one). Without an
 *  owner it refuses before any network call. */
export async function deleteThread(
  config: TursoConfig | null,
  id: string,
  projectId: string,
  ownerId: string,
): Promise<void> {
  if (!ownerId) throw new Error("deleteThread: an owner id is required");
  await run(config, deleteThreadStatements(id, projectId, ownerId));
}

/** Delete every thread of `ownerId`, in every project of the database. */
export async function deleteOwnerThreads(config: TursoConfig | null, ownerId: string): Promise<void> {
  await run(config, deleteOwnerThreadsStatements(ownerId));
}

/** Every thread of `id`'s owner, in every project of the database, opened with its chat key (a row that
 *  will not open is skipped). */
export async function loadOwnerThreads(config: TursoConfig | null, id: ChatIdentity): Promise<ChatThread[]> {
  const results = await run(config, ownerThreadsSelect(id.ownerId));
  return decodeThreadRows(results[CHAT_THREADS_DDL.length], id);
}

/** The ids of the legacy owner-less threads in every project of the database. */
export async function loadLegacyThreadIds(config: TursoConfig | null): Promise<string[]> {
  const results = await run(config, legacyThreadIdsSelect());
  return rowObjects(results[CHAT_THREADS_DDL.length]).map((r) => r.id).filter((id) => !!id);
}

/** The id of every thread in the database (every project, every owner). */
export async function loadAllThreadIds(config: TursoConfig | null): Promise<string[]> {
  const results = await run(config, allThreadIdsSelect());
  return rowObjects(results[CHAT_THREADS_DDL.length]).map((r) => r.id).filter((id) => !!id);
}

/** Delete threads not updated for `days` days by the database clock (and any without a usable date). */
export async function expireThreads(config: TursoConfig | null, days: number, projectId?: string): Promise<void> {
  await run(config, expireThreadsStatements(days, projectId));
}
