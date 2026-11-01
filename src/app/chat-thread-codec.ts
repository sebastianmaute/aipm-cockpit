// src/app/chat-thread-codec.ts — turns a ChatThread into a stored chat_threads
// row and back. A row written here is always OWNED and ENCRYPTED: the name,
// history and display are sealed under a fresh per-write thread key, which is
// wrapped for the owner (under their chat key) and for the operator (to the
// recovery public key). Reading opens only the caller's own rows; legacy
// plaintext rows (no owner) still decode as before. No React, no IO.
import {
  generateThreadKey, openText, sealText, unwrapForOwner, wrapForOperator, wrapForOwner,
} from "./chat-crypto";
import { stripAttachmentsForPersistence, minimiseStoredToolResults, type ChatThread } from "./chat-threads";
import {
  isLegacyRow, legacyRowToThread, parseJsonArray, type StoredThreadRow,
} from "./chat-threads-schema";
import { rowObjects, type PipelineResultLike } from "./turso-schema";

/** Who is reading or writing: their stable owner id and their raw 32-byte chat key. */
export type ChatIdentity = { ownerId: string; chatKey: Uint8Array };

/** Seal `th` for `id`. A fresh thread key on every call; the history loses its
 *  attachment bytes first. Refuses a thread that already belongs to somebody else. */
export async function encodeThreadRow(
  th: ChatThread,
  id: ChatIdentity,
  recoverySpki: string,
): Promise<StoredThreadRow> {
  if (th.ownerId !== null && th.ownerId !== id.ownerId) {
    throw new Error("encodeThreadRow: thread belongs to another owner");
  }
  const threadKey = await generateThreadKey();
  const [name, historyJson, displayJson, keyOwner, keyOperator] = await Promise.all([
    sealText(threadKey, th.name),
    sealText(threadKey, JSON.stringify(stripAttachmentsForPersistence(th.history))),
    sealText(threadKey, JSON.stringify(th.display)),
    wrapForOwner(id.chatKey, threadKey),
    wrapForOperator(recoverySpki, threadKey),
  ]);
  return {
    id: th.id,
    project_id: th.projectId,
    owner_id: id.ownerId,
    name,
    created_at: th.createdAt,
    updated_at: th.updatedAt,
    history_json: historyJson,
    display_json: displayJson,
    key_owner: keyOwner,
    key_operator: keyOperator,
  };
}

async function openOwnedRow(r: Record<string, string>, id: ChatIdentity): Promise<ChatThread | null> {
  try {
    const threadKey = await unwrapForOwner(id.chatKey, r.key_owner);
    const [name, historyJson, displayJson] = await Promise.all([
      openText(threadKey, r.name),
      openText(threadKey, r.history_json),
      openText(threadKey, r.display_json),
    ]);
    return {
      id: r.id,
      projectId: r.project_id ?? "",
      ownerId: id.ownerId,
      name,
      createdAt: r.created_at ?? "",
      updatedAt: r.updated_at ?? "",
      history: minimiseStoredToolResults(parseJsonArray(historyJson)),
      display: parseJsonArray(displayJson),
    };
  } catch {
    // A row that will not open (wrong key, tampered, malformed) is skipped, never thrown.
    return null;
  }
}

/** Decode a chat_threads SELECT result for `id`, keeping input order: legacy
 *  rows decode as plaintext (`ownerId: null`), `id`'s own rows are opened, and
 *  every other row — another owner's, or an own row that fails to open — is
 *  skipped silently. With `id` null only legacy rows decode. */
export async function decodeThreadRows(
  res: PipelineResultLike | undefined,
  id: ChatIdentity | null,
): Promise<ChatThread[]> {
  const decoded = await Promise.all(
    rowObjects(res).map(async (r): Promise<ChatThread | null> => {
      if (!r.id) return null;
      if (isLegacyRow(r)) return legacyRowToThread(r);
      if (id === null || r.owner_id !== id.ownerId) return null;
      return openOwnedRow(r, id);
    }),
  );
  return decoded.filter((t): t is ChatThread => t !== null);
}
