// src/app/chat-keys-schema.ts — pure SQL builders for the GLOBAL chat_keys table: one row per
// person who set a chat passphrase, holding their chat key wrapped under it (see chat-passphrase.ts),
// and the short unlock code another browser types to find that row.
//
// MUST stay OUT of turso-schema's TABLE_NAMES (guard tests in chat-keys-schema.execute.test.ts and
// chat-threads-store.test.ts) so the workspace save's per-table DELETE never touches it. Also holds
// the two chat_threads statements adoption needs, so every SQL string lives in a schema module.
import { txt, type SqlStmt } from "./turso-schema";

export const CHAT_KEYS_TABLE = "chat_keys";

/** `wrapped_key` is `iv + "." + ciphertext` (both base64); the salt has its own column. The unlock
 *  code is unique, so one code can only ever name one row. */
export const CHAT_KEYS_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS chat_keys (owner_id TEXT PRIMARY KEY, unlock_code TEXT, salt TEXT, wrapped_key TEXT, created_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS chat_keys_unlock_code ON chat_keys (unlock_code)`,
];

export interface ChatKeyRow {
  owner_id: string;
  unlock_code: string;
  salt: string;
  wrapped_key: string;
  created_at: string;
}

function requireOwner(ownerId: string, what: string): void {
  if (ownerId === "") throw new Error(`${what}: empty owner id`);
}

/** Store (or replace) the caller's own row. Setting again gives a new code and salt. */
export function upsertChatKeyStatements(row: ChatKeyRow): SqlStmt[] {
  requireOwner(row.owner_id, "upsertChatKeyStatements");
  return [{
    sql: `INSERT INTO chat_keys (owner_id, unlock_code, salt, wrapped_key, created_at) VALUES (?, ?, ?, ?, ?) ` +
      `ON CONFLICT(owner_id) DO UPDATE SET unlock_code = excluded.unlock_code, salt = excluded.salt, ` +
      `wrapped_key = excluded.wrapped_key, created_at = excluded.created_at`,
    args: [txt(row.owner_id), txt(row.unlock_code), txt(row.salt), txt(row.wrapped_key), txt(row.created_at)],
  }];
}

/** Delete the caller's own row, never anybody else's. */
export function deleteChatKeyStatements(ownerId: string): SqlStmt[] {
  requireOwner(ownerId, "deleteChatKeyStatements");
  return [{ sql: `DELETE FROM chat_keys WHERE owner_id = ?`, args: [txt(ownerId)] }];
}

/** The one row with this unlock code, and nothing else. */
export function chatKeyByCodeSelect(unlockCode: string): SqlStmt[] {
  return [{ sql: `SELECT owner_id, salt, wrapped_key FROM chat_keys WHERE unlock_code = ?`, args: [txt(unlockCode)] }];
}

/** True when `err` is the unique-index clash of an unlock code already in use. */
export function isUnlockCodeClash(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed: chat_keys\.unlock_code/i.test(err.message);
}

/** Every thread of one owner, in every project: what a move to another owner re-seals — its id,
 *  project, owner, the owner-wrapped thread key and the three sealed fields. */
export function ownerThreadKeysSelect(ownerId: string): SqlStmt[] {
  requireOwner(ownerId, "ownerThreadKeysSelect");
  return [{
    sql: `SELECT id, project_id, owner_id, key_owner, name, history_json, display_json FROM chat_threads WHERE owner_id = ?`,
    args: [txt(ownerId)],
  }];
}

/** One thread as it moves to a new owner: the owner wrap and the three fields, re-sealed for that
 *  owner under the same thread key (each is bound to its owner, chat-thread-codec.ts). */
export type ReownedThread = {
  id: string;
  projectId: string;
  keyOwner: string;
  name: string;
  historyJson: string;
  displayJson: string;
};

/** Move one thread from `fromOwner` to `toOwner` with its owner wrap and fields re-sealed.
 *  `key_operator` is untouched (the thread key is the same), and so is `updated_at`: a move is not a
 *  change of the chat, so its retention period does not restart. A row that is no longer `fromOwner`'s,
 *  or no longer in that project, is left alone. */
export function reownThreadStatements(row: ReownedThread, fromOwner: string, toOwner: string): SqlStmt[] {
  requireOwner(fromOwner, "reownThreadStatements");
  requireOwner(toOwner, "reownThreadStatements");
  return [{
    sql: `UPDATE chat_threads SET owner_id = ?, key_owner = ?, name = ?, history_json = ?, display_json = ? ` +
      `WHERE id = ? AND project_id = ? AND owner_id = ?`,
    args: [
      txt(toOwner), txt(row.keyOwner), txt(row.name), txt(row.historyJson), txt(row.displayJson),
      txt(row.id), txt(row.projectId), txt(fromOwner),
    ],
  }];
}
