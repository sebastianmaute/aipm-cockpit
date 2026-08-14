// src/app/chat-threads-schema.ts — pure SQL builders + row decoder for the
// GLOBAL chat_threads table (per-project, multi-thread AI chat persistence).
// MUST stay OUT of turso-schema's TABLE_NAMES (guard test in
// chat-threads-store.test.ts) so the workspace save's per-table DELETE never
// touches it — chat threads are Turso-only, not a Workspace field, and need no
// CSV/MD/JSON codec. Mirrors committee-report-versions-schema.ts.
import { rowObjects, txt, int, type PipelineResultLike, type SqlStmt } from "./turso-schema";
import type { ChatThread } from "./chat-threads";

export const CHAT_THREADS_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS chat_threads (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, created_at TEXT, updated_at TEXT, history_json TEXT, display_json TEXT)`,
];

/** Retention cap: keep at most this many threads per project (oldest by
 *  updated_at pruned on each save beyond the cap). Higher than the committee
 *  report cap (25) — chat threads are casual/frequent, not formal snapshots. */
export const CHAT_THREAD_CAP = 50;

export const threadsSelect = (projectId: string): SqlStmt[] => [
  { sql: `SELECT * FROM chat_threads WHERE project_id = ? ORDER BY updated_at DESC`, args: [txt(projectId)] },
];

/** Upsert as ONE atomic `INSERT OR REPLACE`, never a delete-then-insert pair.
 *  `runTursoPipeline` only opens a server-side transaction when the pipeline's
 *  FIRST statement is literally `BEGIN` (see its `isTransactional` check) —
 *  every other statement list, this one included, autocommits statement by
 *  statement. A standalone DELETE followed by a separate INSERT would leave a
 *  real window where the thread is gone if the INSERT then failed. */
export function upsertThreadStatements(th: ChatThread): SqlStmt[] {
  return [
    {
      sql: `INSERT OR REPLACE INTO chat_threads (id,project_id,name,created_at,updated_at,history_json,display_json) VALUES (?,?,?,?,?,?,?)`,
      args: [
        txt(th.id), txt(th.projectId), txt(th.name), txt(th.createdAt), txt(th.updatedAt),
        txt(JSON.stringify(th.history)), txt(JSON.stringify(th.display)),
      ],
    },
  ];
}

/** An id alone must never be sufficient to delete a thread across projects — every id
 *  reaching this today comes from a project-scoped list (`threadsSelect`), so nothing
 *  is exploitable yet, but a future caller (a bulk-cleanup script, a new AI tool, a
 *  recovery path) could delete cross-project by construction if the id-only shape were
 *  the only one on offer. `projectId` is OPTIONAL only so the one existing call site
 *  (`use-chat-threads.ts`, owned elsewhere as of this fix) keeps typechecking without a
 *  migration — pass it at every NEW call site, and prefer migrating the old one too. */
export function deleteThreadStatements(id: string, projectId?: string): SqlStmt[] {
  return projectId === undefined
    ? [{ sql: `DELETE FROM chat_threads WHERE id = ?`, args: [txt(id)] }]
    : [{ sql: `DELETE FROM chat_threads WHERE id = ? AND project_id = ?`, args: [txt(id), txt(projectId)] }];
}

/** Delete all but the newest `keep` threads for one project (by updated_at). */
export function pruneThreadsStatements(projectId: string, keep: number): SqlStmt[] {
  return [{
    sql: `DELETE FROM chat_threads WHERE project_id = ? AND id NOT IN (SELECT id FROM chat_threads WHERE project_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?)`,
    args: [txt(projectId), txt(projectId), int(keep)],
  }];
}

function parseJsonArray<T>(raw: string | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function rowsToThreads(res: PipelineResultLike | undefined): ChatThread[] {
  return rowObjects(res)
    .filter((r) => r.id)
    .map((r): ChatThread => ({
      id: r.id,
      projectId: r.project_id ?? "",
      name: r.name ?? "",
      createdAt: r.created_at ?? "",
      updatedAt: r.updated_at ?? "",
      history: parseJsonArray(r.history_json),
      display: parseJsonArray(r.display_json),
    }));
}
