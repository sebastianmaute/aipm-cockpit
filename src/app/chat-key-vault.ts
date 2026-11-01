// src/app/chat-key-vault.ts — this browser's chat identity, one per Turso database.
//
// An identity is a random owner id plus a random 32-byte chat key (see
// chat-thread-codec.ts). It lives in ONE localStorage entry, a map keyed by the
// database's `httpUrl`; the chat key is stored sealed under the device key
// (`sealDeviceValue`), never in the clear. A factory reset clears it with every
// other `aipm-cockpit:*` key, which only detaches: the rows stay in Turso,
// unreadable here, until retention removes them.
//
// A malformed entry counts as absent (the next save creates a new identity). An
// entry the device key cannot open counts as unavailable and is never
// overwritten. Nothing here logs a key, an owner id or a URL.
import { bytesToBase64 } from "./base64";
import { generateChatKey, isChatCryptoAvailable } from "./chat-crypto";
import type { ChatIdentity } from "./chat-thread-codec";
import { openDeviceValue, sealDeviceValue, type DeviceSealedValue } from "./secrets";

export const CHAT_IDENTITY_KEY = "aipm-cockpit:chat-identity";

const CHAT_KEY_BYTES = 32;

/** What this browser holds for one database: an identity, nothing yet, or one it cannot use
 *  (no Web Crypto or IndexedDB, or the device key cannot open the stored entry). */
export type ChatIdentityRead =
  | { kind: "found"; identity: ChatIdentity }
  | { kind: "absent" }
  | { kind: "unavailable" };

type VaultEntry = { ownerId: string; sealed: DeviceSealedValue };

function isVaultEntry(v: unknown): v is VaultEntry {
  if (typeof v !== "object" || v === null) return false;
  const { ownerId, sealed } = v as Record<string, unknown>;
  if (typeof ownerId !== "string" || ownerId === "") return false;
  if (typeof sealed !== "object" || sealed === null) return false;
  const { iv, ciphertext } = sealed as Record<string, unknown>;
  return typeof iv === "string" && typeof ciphertext === "string";
}

function readVault(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(CHAT_IDENTITY_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The one writer of `CHAT_IDENTITY_KEY`: replaces the entry for `httpUrl`, keeping the others. */
function writeVaultEntry(httpUrl: string, entry: VaultEntry): void {
  window.localStorage.setItem(CHAT_IDENTITY_KEY, JSON.stringify({ ...readVault(), [httpUrl]: entry }));
}

function decodeChatKey(b64: string): Uint8Array | null {
  try {
    const s = atob(b64);
    if (s.length !== CHAT_KEY_BYTES) return null;
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** This browser's identity for the database at `httpUrl`, without creating one. */
export async function readChatIdentity(httpUrl: string): Promise<ChatIdentityRead> {
  if (httpUrl === "" || !isChatCryptoAvailable()) return { kind: "unavailable" };
  const entry = readVault()[httpUrl];
  if (!isVaultEntry(entry)) return { kind: "absent" };
  let opened: string;
  try {
    opened = await openDeviceValue(entry.sealed);
  } catch {
    return { kind: "unavailable" };
  }
  const chatKey = decodeChatKey(opened);
  return chatKey ? { kind: "found", identity: { ownerId: entry.ownerId, chatKey } } : { kind: "absent" };
}

/** The identity for `httpUrl`, or null when there is none or it cannot be used. Never creates one. */
export async function getChatIdentity(httpUrl: string): Promise<ChatIdentity | null> {
  const read = await readChatIdentity(httpUrl);
  return read.kind === "found" ? read.identity : null;
}

/** One creation in flight per database URL in this tab, so overlapping first writes share it. */
const creating = new Map<string, Promise<ChatIdentity | null>>();

async function createChatIdentity(httpUrl: string): Promise<ChatIdentity | null> {
  const read = await readChatIdentity(httpUrl);
  if (read.kind === "found") return read.identity;
  if (read.kind === "unavailable") return null;
  const identity: ChatIdentity = { ownerId: crypto.randomUUID(), chatKey: await generateChatKey() };
  try {
    await replaceChatIdentity(httpUrl, identity);
  } catch {
    return null;
  }
  // Return what is stored, so a tab that wrote in between is adopted where it can be. Two tabs can still
  // both read "absent" and both write; the saves made under the overwritten identity are then unreadable.
  return getChatIdentity(httpUrl);
}

/** The identity for `httpUrl`, created on first use. Null when this browser cannot encrypt, or holds
 *  an entry its device key cannot open (that entry is kept, not replaced). Concurrent calls for one
 *  URL share a single creation. */
export function ensureChatIdentity(httpUrl: string): Promise<ChatIdentity | null> {
  const inFlight = creating.get(httpUrl);
  if (inFlight) return inFlight;
  const run = createChatIdentity(httpUrl).finally(() => creating.delete(httpUrl));
  creating.set(httpUrl, run);
  return run;
}

/** Store `id` as this browser's identity for `httpUrl`, replacing any earlier one. */
export async function replaceChatIdentity(httpUrl: string, id: ChatIdentity): Promise<void> {
  if (httpUrl === "") throw new Error("replaceChatIdentity: a database URL is required");
  const sealed = await sealDeviceValue(bytesToBase64(id.chatKey));
  writeVaultEntry(httpUrl, { ownerId: id.ownerId, sealed });
}

/** True when this browser has what sealing a chat key needs (Web Crypto and IndexedDB). */
export function chatVaultAvailable(): boolean {
  return isChatCryptoAvailable();
}
