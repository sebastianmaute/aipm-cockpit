// src/app/chat-threads-schema.ts — pure SQL builders + row decoder for the
// GLOBAL chat_threads table (per-project, multi-thread AI chat persistence).
// MUST stay OUT of turso-schema's TABLE_NAMES (guard test in
// chat-threads-store.test.ts) so the workspace save's per-table DELETE never
// touches it — chat threads are Turso-only, not a Workspace field, and need no
// CSV/MD/JSON codec. Mirrors committee-report-versions-schema.ts.
//
// A row is either OWNED (`owner_id` set; `name`, `history_json` and
// `display_json` are encrypted envelopes, the thread key wrapped twice in
// `key_owner` / `key_operator` — see chat-thread-codec.ts) or LEGACY (`owner_id`
// NULL or '', plaintext, written before encryption). `SqlArg.value` is
// string-only, so NULL is never bound: the owner-less group is always spelled
// `(owner_id IS NULL OR owner_id = '')` in the SQL itself.
import { rowObjects, txt, int, type PipelineResultLike, type SqlStmt } from "./turso-schema";
import { existingColumnsFromPragma, missingColumnAlters } from "./turso-migrate";
import { minimiseStoredToolResults, type ChatThread } from "./chat-threads";

export const CHAT_THREADS_TABLE = "chat_threads";

/** Every column, in DDL order. The heal adds whichever of these an older table lacks. */
export const CHAT_THREADS_COLUMNS = [
  "id", "project_id", "name", "created_at", "updated_at", "history_json", "display_json",
  "owner_id", "key_owner", "key_operator",
] as const;

/** The table, then the owner guard. ★ The guard refuses every INSERT without an owner, so a device
 *  still on a release from before chat encryption cannot add a plaintext chat (which every colleague
 *  would read) nor replace an owned row with one (its `INSERT OR REPLACE` is aborted before the
 *  conflict is resolved). This code never inserts an owner-less row: taking over a legacy row is an
 *  UPDATE. Legacy rows already stored are untouched. Every caller runs this list before its own
 *  statements, so the heal creates the guard on an existing database too. On a table from before the
 *  owner column, the trigger is created and the heal's ALTER then gives it the column it reads. */
export const CHAT_THREADS_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS chat_threads (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, created_at TEXT, updated_at TEXT, history_json TEXT, display_json TEXT, owner_id TEXT, key_owner TEXT, key_operator TEXT)`,
  `CREATE TRIGGER IF NOT EXISTS chat_threads_owner_required BEFORE INSERT ON chat_threads ` +
    `WHEN NEW.owner_id IS NULL OR NEW.owner_id = '' ` +
    `BEGIN SELECT RAISE(ABORT, 'chat_threads: owner required'); END`,
];

/** One stored row, every column as text (an owner-less legacy row carries ''). */
export interface StoredThreadRow {
  id: string;
  project_id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  history_json: string;
  display_json: string;
  key_owner: string;
  key_operator: string;
}

/** Retention cap: keep at most this many threads per project and owner (oldest
 *  by updated_at pruned on each save beyond the cap). Higher than the committee
 *  report cap (25) — chat threads are casual/frequent, not formal snapshots. */
export const CHAT_THREAD_CAP = 50;

const LEGACY_OWNER = `(owner_id IS NULL OR owner_id = '')`;

/** The ALTERs that bring an existing table up to `CHAT_THREADS_COLUMNS`, given
 *  its `PRAGMA table_info` result. Empty for an up-to-date table and for an
 *  unreadable or absent one (run the DDL first, so the table exists). */
export function chatThreadsHealAlters(pragma: PipelineResultLike | undefined): SqlStmt[] {
  const existing = existingColumnsFromPragma(pragma);
  if (existing === null) return [];
  return missingColumnAlters(CHAT_THREADS_TABLE, existing, CHAT_THREADS_COLUMNS);
}

/** One project's threads visible to `ownerId`: its own rows plus the legacy
 *  owner-less ones. With no owner, the legacy rows only. Never another owner's. */
export const threadsSelect = (projectId: string, ownerId: string | null): SqlStmt[] =>
  ownerId === null
    ? [{ sql: `SELECT * FROM chat_threads WHERE project_id = ? AND ${LEGACY_OWNER} ORDER BY updated_at DESC`, args: [txt(projectId)] }]
    : [{
      sql: `SELECT * FROM chat_threads WHERE project_id = ? AND (owner_id = ? OR owner_id IS NULL OR owner_id = '') ORDER BY updated_at DESC`,
      args: [txt(projectId), txt(ownerId)],
    }];

/** The DATABASE clock as an ISO instant in the format `toISOString()` writes. Every write dates its row
 *  with it (`created_at` on insert, `updated_at` always), never with the browser's clock: a browser
 *  clock days ahead would otherwise get the chat deleted by the next expiry (its future-date rule), and
 *  one far behind would get it expired early. */
export const CHAT_DB_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

/** The columns an upsert binds; `created_at` and `updated_at` come from `CHAT_DB_NOW`. */
const UPSERT_COLUMNS = [
  "id", "project_id", "owner_id", "name", "history_json", "display_json", "key_owner", "key_operator",
] as const;

const UPSERT_SQL =
  `INSERT INTO chat_threads (${UPSERT_COLUMNS.join(",")}, created_at, updated_at) ` +
  `VALUES (${UPSERT_COLUMNS.map(() => "?").join(",")}, ${CHAT_DB_NOW}, ${CHAT_DB_NOW}) ` +
  `ON CONFLICT(id) DO UPDATE SET ${UPSERT_COLUMNS.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ")}, ` +
  `updated_at = excluded.updated_at ` +
  `WHERE chat_threads.project_id = excluded.project_id AND ` +
  `(chat_threads.owner_id = excluded.owner_id OR chat_threads.owner_id IS NULL OR chat_threads.owner_id = '')`;

/** Upsert as ONE atomic statement, never a delete-then-insert pair.
 *  `runTursoPipeline` only opens a server-side transaction when the pipeline's
 *  FIRST statement is literally `BEGIN` and its LAST is `COMMIT` (see its
 *  `isTransactional` check) —
 *  every other statement list, this one included, autocommits statement by
 *  statement. A standalone DELETE followed by a separate INSERT would leave a
 *  real window where the thread is gone if the INSERT then failed.
 *  ★ The id alone never decides the target: an existing row is updated only
 *  when it is in the same project AND belongs to the same owner or to nobody
 *  (a legacy row, which this write takes over). Otherwise the write is a
 *  silent no-op — a stale copy saved by somebody else, or an id from another
 *  project, can never replace a row (`INSERT OR REPLACE` would have). */
export function upsertThreadStatements(row: StoredThreadRow): SqlStmt[] {
  return [
    {
      sql: UPSERT_SQL,
      args: [
        txt(row.id), txt(row.project_id), txt(row.owner_id), txt(row.name),
        txt(row.history_json), txt(row.display_json), txt(row.key_owner), txt(row.key_operator),
      ],
    },
  ];
}

/** The save of a thread KNOWN to be stored (loaded from the database, or saved earlier in this
 *  session): an owner-guarded UPDATE, never an insert. When the row is gone — erased by the operator,
 *  deleted in another tab or browser, expired — it matches nothing and the write changes no row, so a
 *  session still holding the thread can never bring an erased chat back. The same project and owner
 *  guard as the upsert: an owner's own row or a legacy owner-less one (taken over), never another's. */
export function updateStoredThreadStatements(row: StoredThreadRow): SqlStmt[] {
  return [{
    sql: `UPDATE chat_threads SET name = ?, updated_at = ${CHAT_DB_NOW}, history_json = ?, display_json = ?, key_owner = ?, key_operator = ?, owner_id = ? ` +
      `WHERE id = ? AND project_id = ? AND (owner_id = ? OR owner_id IS NULL OR owner_id = '')`,
    args: [
      txt(row.name), txt(row.history_json), txt(row.display_json), txt(row.key_owner), txt(row.key_operator),
      txt(row.owner_id), txt(row.id), txt(row.project_id), txt(row.owner_id),
    ],
  }];
}

/** An id alone must never be sufficient to delete a thread across projects. Every id
 *  reaching this today comes from a project-scoped list (`threadsSelect`), so nothing
 *  was exploitable, but a future caller (a bulk-cleanup script, a new AI tool, a
 *  recovery path) could delete cross-project by construction if an id-only shape were
 *  on offer. ★ `projectId` is REQUIRED deliberately: it landed optional so the then-open
 *  call site kept typechecking, but an optional security parameter whose default is the
 *  UNSCOPED statement is a trap — it reads as protection while every caller that forgets
 *  it silently opts out. The scoping is now unconditional and cannot be omitted.
 *  The same holds for the OWNER: a person deletes their own rows and legacy
 *  owner-less ones, never somebody else's. An empty owner id is refused. */
export function deleteThreadStatements(id: string, projectId: string, ownerId: string): SqlStmt[] {
  if (ownerId === "") throw new Error("deleteThreadStatements: empty owner id");
  return [
    {
      sql: `DELETE FROM chat_threads WHERE id = ? AND project_id = ? AND (owner_id = ? OR owner_id IS NULL OR owner_id = '')`,
      args: [txt(id), txt(projectId), txt(ownerId)],
    },
  ];
}

/** Delete all but the newest `keep` threads of ONE owner group in one project (by
 *  updated_at). `ownerId` null prunes the legacy owner-less group. A save never
 *  removes another person's threads to make room for its own. */
export function pruneThreadsStatements(projectId: string, ownerId: string | null, keep: number): SqlStmt[] {
  if (ownerId === null) {
    return [{
      sql: `DELETE FROM chat_threads WHERE project_id = ? AND ${LEGACY_OWNER} AND id NOT IN (SELECT id FROM chat_threads WHERE project_id = ? AND ${LEGACY_OWNER} ORDER BY updated_at DESC, id DESC LIMIT ?)`,
      args: [txt(projectId), txt(projectId), int(keep)],
    }];
  }
  return [{
    sql: `DELETE FROM chat_threads WHERE project_id = ? AND owner_id = ? AND id NOT IN (SELECT id FROM chat_threads WHERE project_id = ? AND owner_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?)`,
    args: [txt(projectId), txt(ownerId), txt(projectId), txt(ownerId), int(keep)],
  }];
}

/** Every thread of one owner, in every project of the database. An empty id is
 *  refused: it would match the legacy '' rows of everybody. */
export function deleteOwnerThreadsStatements(ownerId: string): SqlStmt[] {
  if (ownerId === "") throw new Error("deleteOwnerThreadsStatements: empty owner id");
  return [{ sql: `DELETE FROM chat_threads WHERE owner_id = ?`, args: [txt(ownerId)] }];
}

/** Every row of one owner, in every project of the database, newest first — what "find chats mentioning
 *  a person" searches (opened locally; never another owner's row, never a legacy one). */
export function ownerThreadsSelect(ownerId: string): SqlStmt[] {
  if (ownerId === "") throw new Error("ownerThreadsSelect: empty owner id");
  return [{ sql: `SELECT * FROM chat_threads WHERE owner_id = ? ORDER BY updated_at DESC`, args: [txt(ownerId)] }];
}

/** The ids of every legacy owner-less row, in every project of the database — the rows a
 *  "delete all my chats" leaves standing. Ids only: no content is read. */
export function legacyThreadIdsSelect(): SqlStmt[] {
  return [{ sql: `SELECT id FROM chat_threads WHERE owner_id IS NULL OR owner_id = ''` }];
}

/** The id of every row, in every project of the database — which threads still exist, to drop the
 *  pending renames of those that do not. Ids only: no content is read. */
export function allThreadIdsSelect(): SqlStmt[] {
  return [{ sql: `SELECT id FROM chat_threads` }];
}

/** Whether a row with this id exists in this project, whoever owns it — to tell a stored thread whose
 *  UPDATE changed no row apart: gone, or taken over by another owner. No content is read. */
export function threadPresentSelect(id: string, projectId: string): SqlStmt[] {
  return [{ sql: `SELECT 1 AS present FROM chat_threads WHERE id = ? AND project_id = ?`, args: [txt(id), txt(projectId)] }];
}

/** The cutoff and the future bound are computed by the DATABASE's clock (SQL `'now'`), never a
 *  browser's: one client with a clock weeks ahead would otherwise delete everybody's chats. The
 *  format matches `toISOString()`, so the comparison is between ISO strings. */
const DB_NOW_ISO = (modifier: string): string => `strftime('%Y-%m-%dT%H:%M:%fZ','now', ${modifier})`;

/** Threads not updated for `days` days by the database clock, plus any without a usable
 *  `updated_at` — NULL, '' or not a date at all (`julianday` NULL) — or one more than a day
 *  in the FUTURE, which no retention period can vouch for either (a clock that was ahead when
 *  it was written would keep it forever). Whole database, or one project when `projectId` is
 *  given. */
export function expireThreadsStatements(days: number, projectId?: string): SqlStmt[] {
  const stale =
    `(updated_at < ${DB_NOW_ISO("?")} OR updated_at > ${DB_NOW_ISO("'+1 days'")}` +
    ` OR updated_at IS NULL OR updated_at = '' OR julianday(updated_at) IS NULL)`;
  const age = txt(`-${days} days`);
  if (projectId === undefined) {
    return [{ sql: `DELETE FROM chat_threads WHERE ${stale}`, args: [age] }];
  }
  return [{ sql: `DELETE FROM chat_threads WHERE ${stale} AND project_id = ?`, args: [age, txt(projectId)] }];
}

const DAY_MS = 86_400_000;

/** The ISO instant `days` whole days before `now`, by the CLIENT clock — for what the screen
 *  shows only; deletes use the database clock (`expireThreadsStatements`). */
export function retentionCutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

export function parseJsonArray<T>(raw: string | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** A row whose `owner_id` is NULL or '' — plaintext, written before encryption. */
export function isLegacyRow(r: Record<string, string>): boolean {
  return !r.owner_id;
}

/** Decode one LEGACY plaintext row object (see `rowObjects`). */
export function legacyRowToThread(r: Record<string, string>): ChatThread {
  return {
    id: r.id,
    projectId: r.project_id ?? "",
    ownerId: null,
    name: r.name ?? "",
    createdAt: r.created_at ?? "",
    updatedAt: r.updated_at ?? "",
    // AI-08 / AI-05 — a thread saved before the tool results were minimised is minimised here, before it can be re-sent.
    history: minimiseStoredToolResults(parseJsonArray(r.history_json)),
    display: parseJsonArray(r.display_json),
  };
}

/** The legacy plaintext rows of a SELECT result, decoded; owned rows are skipped
 *  (they need a key — see `decodeThreadRows` in chat-thread-codec.ts). */
export function rowsToThreads(res: PipelineResultLike | undefined): ChatThread[] {
  return rowObjects(res)
    .filter((r) => r.id && isLegacyRow(r))
    .map(legacyRowToThread);
}
