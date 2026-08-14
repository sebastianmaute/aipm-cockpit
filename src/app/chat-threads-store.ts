// src/app/chat-threads-store.ts — async CRUD for per-project AI chat threads
// over the shared Turso pipeline. Every call prepends the DDL (CREATE IF NOT
// EXISTS). Mirrors committee-report-versions-store.ts.
import { runTursoPipeline } from "./turso-pipeline";
import {
  CHAT_THREADS_DDL, CHAT_THREAD_CAP, threadsSelect, upsertThreadStatements,
  deleteThreadStatements, pruneThreadsStatements, rowsToThreads,
} from "./chat-threads-schema";
import type { ChatThread } from "./chat-threads";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";

const ddl = (): SqlStmt[] => CHAT_THREADS_DDL.map((sql) => ({ sql }));

export async function loadThreads(config: TursoConfig | null, projectId: string): Promise<ChatThread[]> {
  const results = await runTursoPipeline(config, [...ddl(), ...threadsSelect(projectId)]);
  return rowsToThreads(results[CHAT_THREADS_DDL.length]);
}

export async function saveThread(config: TursoConfig | null, th: ChatThread): Promise<void> {
  await runTursoPipeline(config, [
    ...ddl(),
    ...upsertThreadStatements(th),
    ...pruneThreadsStatements(th.projectId, CHAT_THREAD_CAP),
  ]);
}

export async function deleteThread(config: TursoConfig | null, id: string, projectId?: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...deleteThreadStatements(id, projectId)]);
}
