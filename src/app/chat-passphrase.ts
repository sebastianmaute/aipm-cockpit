// src/app/chat-passphrase.ts — open your saved chats on another browser.
//
// Opt-in: a person sets a chat passphrase, and their chat key (chat-key-vault.ts) is stored in the
// Turso table chat_keys wrapped under a key derived from it (PBKDF2, 600,000 rounds, SHA-256, a
// fresh 16-byte salt — `sealPassphraseValue`), beside a short random unlock code. Another browser
// types the code and the passphrase; it reads that ONE row, opens the chat key, and adopts the
// identity. The adopted identity is stored first; then the threads that browser had saved under its
// own identity move to it: their thread key is re-wrapped for the adopted chat key and the fields
// re-sealed in one transaction, while the operator's wrap stays as it is. A move that fails is
// finished by unlocking again: until then the vault keeps the replaced identity (`unmoved`) and its
// owner id (`previousOwnerIds`), so its rows can still be moved, or erased by a delete-all.
//
// A forgotten passphrase cannot be recovered by the user: nothing else opens the stored key.
// Nothing here logs a passphrase, a code or key material. No React, no i18n.
import { runTursoPipeline } from "./turso-pipeline";
import { rowObjects, type SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import {
  CHAT_KEYS_DDL, chatKeyByCodeSelect, deleteChatKeyStatements, isUnlockCodeClash, ownerThreadKeysSelect,
  reownThreadStatements, upsertChatKeyStatements,
} from "./chat-keys-schema";
import { ensureChatThreadsColumns } from "./chat-threads-store";
import { ChatCryptoError, unwrapForOwner, wrapForOwner } from "./chat-crypto";
import {
  clearUnmovedChatIdentity, readChatIdentity, readUnmovedChatIdentity, replaceChatIdentity, storedChatOwnerIds,
  withIdentityLock,
} from "./chat-key-vault";
import { ownerKeyAd, resealThreadFields, type ChatIdentity } from "./chat-thread-codec";
import { bytesToBase64 } from "./base64";
import { logDiag } from "./diagnostics";
import { openPassphraseValue, sealPassphraseValue, SecretUnlockError } from "./secrets";

/** The unlock code's characters: no 0/O, 1/I, so a code read aloud or retyped is unambiguous. */
export const UNLOCK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const UNLOCK_CODE_LENGTH = 8;
export const MIN_CHAT_PASSPHRASE_LENGTH = 12;
/** Fresh codes tried before giving up when each one is already in use. */
const MAX_CODE_ATTEMPTS = 5;
const CHAT_KEY_BYTES = 32;

/** "too-short": the passphrase is under `MIN_CHAT_PASSPHRASE_LENGTH`; "no-free-code": every
 *  generated unlock code was already in use. */
export class ChatPassphraseError extends Error {
  constructor(readonly reason: "too-short" | "no-free-code") {
    super(`chat-passphrase-${reason}`);
    this.name = "ChatPassphraseError";
  }
}

const ddl = (): SqlStmt[] => CHAT_KEYS_DDL.map((sql) => ({ sql }));

/** A random code from `UNLOCK_CODE_ALPHABET`. 32 symbols divide 256, so `byte & 31` is unbiased. */
export function newUnlockCode(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(UNLOCK_CODE_LENGTH));
  return Array.from(bytes, (b) => UNLOCK_CODE_ALPHABET[b & 31]).join("");
}

/** The code as typed, upper-cased, without spaces or hyphens. */
export function normaliseUnlockCode(typed: string): string {
  return typed.toUpperCase().replace(/[\s-]/g, "");
}

function isWellFormedCode(code: string): boolean {
  return code.length === UNLOCK_CODE_LENGTH && Array.from(code).every((ch) => UNLOCK_CODE_ALPHABET.includes(ch));
}

/** The code split in two halves for reading and copying: "ABCD-EFGH". */
export function formatUnlockCode(code: string): string {
  return code.length === UNLOCK_CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** Store `id`'s chat key under `passphrase` with a new unlock code, replacing any earlier row of
 *  the same owner. Refuses a passphrase under 12 characters before anything is sent. `newCode` is a
 *  test seam. */
export async function setChatPassphrase(
  config: TursoConfig | null,
  id: ChatIdentity,
  passphrase: string,
  opts: { newCode?: () => string } = {},
): Promise<{ unlockCode: string }> {
  if (Array.from(passphrase).length < MIN_CHAT_PASSPHRASE_LENGTH) throw new ChatPassphraseError("too-short");
  const sealed = await sealPassphraseValue(bytesToBase64(id.chatKey), passphrase);
  const makeCode = opts.newCode ?? newUnlockCode;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const unlockCode = makeCode();
    try {
      await runTursoPipeline(config, [
        ...ddl(),
        ...upsertChatKeyStatements({
          owner_id: id.ownerId,
          unlock_code: unlockCode,
          salt: sealed.salt,
          wrapped_key: `${sealed.iv}.${sealed.ciphertext}`,
          created_at: new Date().toISOString(),
        }),
      ]);
      return { unlockCode };
    } catch (err) {
      if (!isUnlockCodeClash(err)) throw err;
    }
  }
  throw new ChatPassphraseError("no-free-code");
}

/** Delete `ownerId`'s own chat_keys row; their code then opens nothing. */
export async function removeChatPassphrase(config: TursoConfig | null, ownerId: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...deleteChatKeyStatements(ownerId)]);
}

export type UnlockResult =
  | { outcome: "adopted"; moved: number; skipped: number }
  | { outcome: "wrong" }
  | { outcome: "unknown-code" };

function decodeChatKey(b64: string): Uint8Array | null {
  try {
    const s = atob(b64);
    if (s.length !== CHAT_KEY_BYTES) return null;
    return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Open the chat key stored with this row, or null when the passphrase (or the row) is wrong. */
async function openStoredKey(row: Record<string, string>, passphrase: string): Promise<Uint8Array | null> {
  const [iv, ciphertext, ...rest] = (row.wrapped_key ?? "").split(".");
  if (!iv || !ciphertext || rest.length > 0 || !row.salt) return null;
  try {
    return decodeChatKey(await openPassphraseValue({ salt: row.salt, iv, ciphertext }, passphrase));
  } catch (err) {
    if (err instanceof SecretUnlockError) return null;
    throw err;
  }
}

/** How many passes a move makes: the first, and one more for a thread `from` saved while the first was
 *  on its way (between its read and its commit). Bounded, so a writer that keeps saving cannot hold an
 *  unlock forever; a row saved after that stays with `from`, whose id the vault keeps for erasure. */
const REOWN_PASSES = 2;

/** Move every thread of `from` (in the whole database) to `to`: each pass reads `from`'s rows and moves
 *  them in one transaction, each thread key re-wrapped and the three fields re-sealed for `to`, since
 *  both are bound to the owner. Each UPDATE also requires the row to be unchanged since it was read
 *  (still `from`'s, the same owner wrap), so a save in between is never overwritten with older content;
 *  a second pass moves what was saved in between. Only rows an UPDATE changed count as moved. A row
 *  whose owner wrap or fields will not open is left with `from` and counted as skipped, once. */
async function reownThreads(
  config: TursoConfig | null,
  from: ChatIdentity,
  to: ChatIdentity,
): Promise<{ moved: number; skipped: number }> {
  await ensureChatThreadsColumns(config);
  const unopenable = new Set<string>();
  let moved = 0;
  for (let pass = 0; pass < REOWN_PASSES; pass += 1) {
    const [selected] = await runTursoPipeline(config, ownerThreadKeysSelect(from.ownerId));
    const rows = rowObjects(selected).filter((r) => r.id && !unopenable.has(r.id));
    if (rows.length === 0) break;
    const updates = await reownStatements(rows, from, to, unopenable);
    if (updates.length === 0) break;
    const results = await runTursoPipeline(config, [{ sql: "BEGIN" }, ...updates, { sql: "COMMIT" }]);
    moved += results.slice(1, 1 + updates.length)
      .reduce((n, res) => n + (res?.response?.result?.affected_row_count ?? 1), 0);
  }
  return { moved, skipped: unopenable.size };
}

/** The UPDATEs moving `rows` from `from` to `to`; a row that will not open goes into `unopenable`. */
async function reownStatements(
  rows: Record<string, string>[],
  from: ChatIdentity,
  to: ChatIdentity,
  unopenable: Set<string>,
): Promise<SqlStmt[]> {
  const updates: SqlStmt[] = [];
  for (const r of rows) {
    try {
      const threadKey = await unwrapForOwner(from.chatKey, r.key_owner, ownerKeyAd(r.id, from.ownerId));
      const fields = await resealThreadFields(threadKey, r, to.ownerId);
      const keyOwner = await wrapForOwner(to.chatKey, threadKey, ownerKeyAd(r.id, to.ownerId));
      const row = { id: r.id, projectId: r.project_id ?? "", fromKeyOwner: r.key_owner ?? "", keyOwner, ...fields };
      updates.push(...reownThreadStatements(row, from.ownerId, to.ownerId));
    } catch (err) {
      if (!(err instanceof ChatCryptoError)) throw err;
      unopenable.add(r.id);
    }
  }
  return updates;
}

/** Adopt the identity stored under `typedCode` when `passphrase` opens it. Reads exactly one
 *  chat_keys row (by its code). The adopted identity is stored here first (again on a retry: the same
 *  entry), replacing the one held; the replaced identity's owner id is kept in the entry. Then that
 *  identity's threads move to the adopted owner, and only once they have is its chat_keys row deleted.
 *  A failed move throws and leaves the replaced identity in the entry, so unlocking again moves its
 *  threads. The vault read, the identity write and the move run under the chat identity lock, so another
 *  tab cannot create or replace the identity in between. "wrong" and "unknown-code" change nothing. */
export async function unlockWithPassphrase(
  config: TursoConfig | null,
  httpUrl: string,
  typedCode: string,
  passphrase: string,
): Promise<UnlockResult> {
  const code = normaliseUnlockCode(typedCode);
  if (!isWellFormedCode(code)) return { outcome: "unknown-code" };
  const results = await runTursoPipeline(config, [...ddl(), ...chatKeyByCodeSelect(code)]);
  const row = rowObjects(results[CHAT_KEYS_DDL.length])[0];
  if (!row?.owner_id) return { outcome: "unknown-code" };
  const chatKey = await openStoredKey(row, passphrase);
  if (!chatKey) return { outcome: "wrong" };
  const adopted: ChatIdentity = { ownerId: row.owner_id, chatKey };
  return withIdentityLock(() => adopt(config, httpUrl, adopted));
}

/** The adoption itself, run under the identity lock (`unlockWithPassphrase`). */
async function adopt(config: TursoConfig | null, httpUrl: string, adopted: ChatIdentity): Promise<UnlockResult> {
  const current = await readChatIdentity(httpUrl);
  // An identity that could not be read right now is not replaced: it may still be good.
  if (current.kind === "transient") throw new Error("chat identity not readable right now");
  // Whose threads move: the identity held here, or — when it is already the adopted one — the one a
  // move that did not finish left in the entry.
  const from = current.kind !== "found" ? null
    : current.identity.ownerId !== adopted.ownerId ? current.identity
      : await readUnmovedChatIdentity(httpUrl);
  // Stored first, with every owner id held so far (a locked one's too) kept for a later delete-all.
  await replaceChatIdentity(httpUrl, adopted, storedChatOwnerIds(httpUrl), from);
  if (!from) return { outcome: "adopted", moved: 0, skipped: 0 };
  const counts = await reownThreads(config, from, adopted);
  clearUnmovedChatIdentity(httpUrl, from.ownerId);
  // The replaced identity's own passphrase row now opens nothing (its threads moved to the adopted
  // owner, or are ones its key could not open): delete it. A failure leaves the adoption in place.
  try {
    await removeChatPassphrase(config, from.ownerId);
  } catch {
    logDiag("warn", "chat.replacedKeyDeleteFailed");
  }
  return { outcome: "adopted", ...counts };
}
