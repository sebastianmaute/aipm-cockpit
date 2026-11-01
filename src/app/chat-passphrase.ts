// src/app/chat-passphrase.ts — open your saved chats on another browser.
//
// Opt-in: a person sets a chat passphrase, and their chat key (chat-key-vault.ts) is stored in the
// Turso table chat_keys wrapped under a key derived from it (PBKDF2, 600,000 rounds, SHA-256, a
// fresh 16-byte salt — `sealPassphraseValue`), beside a short random unlock code. Another browser
// types the code and the passphrase; it reads that ONE row, opens the chat key, and adopts the
// identity. Threads that browser already saved under its own identity are moved to the adopted one
// first: their thread key is re-wrapped for the adopted chat key in one transaction, while the
// encrypted payloads and the operator's wrap stay as they are.
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
import { readChatIdentity, replaceChatIdentity } from "./chat-key-vault";
import { ownerKeyAd, resealThreadFields, type ChatIdentity } from "./chat-thread-codec";
import { bytesToBase64 } from "./base64";
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

/** Move every thread of `from` (in the whole database) to `to`, in one transaction: each thread key
 *  is re-wrapped and the three fields re-sealed for `to`, since both are bound to the owner. A row
 *  whose owner wrap or fields will not open is left with `from` and counted as skipped. */
async function reownThreads(
  config: TursoConfig | null,
  from: ChatIdentity,
  to: ChatIdentity,
): Promise<{ moved: number; skipped: number }> {
  await ensureChatThreadsColumns(config);
  const [selected] = await runTursoPipeline(config, ownerThreadKeysSelect(from.ownerId));
  const updates: SqlStmt[] = [];
  let skipped = 0;
  for (const r of rowObjects(selected)) {
    if (!r.id) continue;
    try {
      const threadKey = await unwrapForOwner(from.chatKey, r.key_owner, ownerKeyAd(r.id, from.ownerId));
      const fields = await resealThreadFields(threadKey, r, to.ownerId);
      const keyOwner = await wrapForOwner(to.chatKey, threadKey, ownerKeyAd(r.id, to.ownerId));
      updates.push(...reownThreadStatements({ id: r.id, projectId: r.project_id ?? "", keyOwner, ...fields }, from.ownerId, to.ownerId));
    } catch (err) {
      if (!(err instanceof ChatCryptoError)) throw err;
      skipped += 1;
    }
  }
  if (updates.length > 0) await runTursoPipeline(config, [{ sql: "BEGIN" }, ...updates, { sql: "COMMIT" }]);
  return { moved: updates.length, skipped };
}

/** Adopt the identity stored under `typedCode` when `passphrase` opens it. Reads exactly one
 *  chat_keys row (by its code). When this browser already holds a different identity for `httpUrl`,
 *  its threads move to the adopted owner first; only after that commit is the adopted identity
 *  stored here, replacing the old one. "wrong" and "unknown-code" change nothing. */
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

  const current = await readChatIdentity(httpUrl);
  const counts = current.kind === "found" && current.identity.ownerId !== adopted.ownerId
    ? await reownThreads(config, current.identity, adopted)
    : { moved: 0, skipped: 0 };
  await replaceChatIdentity(httpUrl, adopted);
  return { outcome: "adopted", ...counts };
}
