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

/** Every thread of one owner, in every project: its id and owner-wrapped thread key. */
export function ownerThreadKeysSelect(ownerId: string): SqlStmt[] {
  requireOwner(ownerId, "ownerThreadKeysSelect");
  return [{ sql: `SELECT id, key_owner FROM chat_threads WHERE owner_id = ?`, args: [txt(ownerId)] }];
}

/** Move one thread from `fromOwner` to `toOwner` with its thread key re-wrapped. The encrypted
 *  payloads and `key_operator` are untouched (the thread key is the same). A row that is no longer
 *  `fromOwner`'s is left alone. */
export function reownThreadStatements(id: string, fromOwner: string, toOwner: string, keyOwner: string): SqlStmt[] {
  requireOwner(fromOwner, "reownThreadStatements");
  requireOwner(toOwner, "reownThreadStatements");
  return [{
    sql: `UPDATE chat_threads SET owner_id = ?, key_owner = ? WHERE id = ? AND owner_id = ?`,
    args: [txt(toOwner), txt(keyOwner), txt(id), txt(fromOwner)],
  }];
}
