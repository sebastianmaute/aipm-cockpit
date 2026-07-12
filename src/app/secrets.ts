// src/app/secrets.ts
//
// At-rest encryption for the two browser-held secrets (Anthropic API key, Turso
// auth token). Pure WebCrypto: AES-256-GCM with either a non-extractable
// device-bound key (default) or a PBKDF2-derived passphrase key. i18n-free.

import { ensureStorageMigrated, legacyDeviceKeyPending } from "./storage-migration";

export type WrapMode = "device" | "passphrase";
export type SecretId =
  | "anthropicApiKey"
  | "tursoAuthToken"
  | "jiraApiToken"
  | "timelogApiToken"
  | "sttApiKey";

export interface SealedSecret {
  v: 1;
  id: SecretId;
  wrap: WrapMode;
  alg: "AES-GCM";
  iv: string; // base64, 12 bytes
  salt?: string; // base64, 16 bytes (passphrase only)
  kdf?: { name: "PBKDF2"; iters: number; hash: "SHA-256" };
  ciphertext: string; // base64
}

const WRAP_MODES: readonly WrapMode[] = ["device", "passphrase"];
/** Runtime validation for a value parsed from untrusted storage. */
export function isSealedSecret(x: unknown): x is SealedSecret {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return (
    s.v === 1 &&
    (s.id === "anthropicApiKey" ||
      s.id === "tursoAuthToken" ||
      s.id === "jiraApiToken" ||
      s.id === "timelogApiToken" ||
      s.id === "sttApiKey") &&
    typeof s.wrap === "string" &&
    WRAP_MODES.includes(s.wrap as WrapMode) &&
    s.alg === "AES-GCM" &&
    typeof s.iv === "string" &&
    typeof s.ciphertext === "string" &&
    (s.wrap !== "passphrase" || typeof s.salt === "string")
  );
}

/** Wrong passphrase / tampered ciphertext. Thrown by openPassphrase/openDevice. */
export class SecretUnlockError extends Error {
  constructor(message = "secret-unlock-failed") {
    super(message);
    this.name = "SecretUnlockError";
  }
}

const PBKDF2_ITERS = 600_000;
const DB_NAME = "aipm-cockpit-secrets";
const STORE = "keys";
const DEVICE_KEY_ID = "device-key";

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
// `new Uint8Array(length)` is always backed by a plain `ArrayBuffer` (never a
// `SharedArrayBuffer`), so typing these as `Uint8Array<ArrayBuffer>` is safe at
// runtime and satisfies WebCrypto's `BufferSource` parameters under strict libs.
function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}
function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}
const enc = new TextEncoder();
const dec = new TextDecoder();

async function idbOpen(): Promise<IDBDatabase> {
  await ensureStorageMigrated(); // migrate legacy storage namespace before first open
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("idb-blocked"));
  });
}
function idbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Get the persisted non-extractable device key, generating + storing it once.
 *  A module-level singleton promise ensures concurrent callers (e.g. two tabs)
 *  share ONE load/generate, so they can't both generate + overwrite the key and
 *  orphan ciphertext. On failure the cache resets so a later call can retry. */
let deviceKeyPromise: Promise<CryptoKey> | null = null;
export function getDeviceKey(): Promise<CryptoKey> {
  if (!deviceKeyPromise) deviceKeyPromise = loadOrCreateDeviceKey();
  return deviceKeyPromise;
}
async function loadOrCreateDeviceKey(): Promise<CryptoKey> {
  const db = await idbOpen();
  try {
    const existing = (await idbGet(db, DEVICE_KEY_ID)) as CryptoKey | undefined;
    if (existing) return existing;
    // Don't mint a new device key while the legacy key is still pending migration:
    // a failed first-boot secrets copy leaves the old key in `lop-app-secrets` and
    // this DB empty; minting here would orphan the key that decrypts existing
    // ciphertext, and the copy-migration would later DELETE it (count check).
    // Degrade — throw so the caller keeps secrets locked and retries on reload.
    if (await legacyDeviceKeyPending()) {
      throw new Error("secrets-migration-pending");
    }
    const key = await subtle().generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await idbPut(db, DEVICE_KEY_ID, key);
    return key;
  } catch (err) {
    deviceKeyPromise = null; // allow a later retry
    throw err;
  } finally {
    db.close();
  }
}

async function aesEncrypt(
  key: CryptoKey,
  id: SecretId,
  plaintext: string,
  extra: Partial<SealedSecret>,
): Promise<SealedSecret> {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return { v: 1, id, alg: "AES-GCM", iv: toB64(iv), ciphertext: toB64(ct), ...extra } as SealedSecret;
}
async function aesDecrypt(key: CryptoKey, s: SealedSecret): Promise<string> {
  try {
    const pt = await subtle().decrypt(
      { name: "AES-GCM", iv: fromB64(s.iv) },
      key,
      fromB64(s.ciphertext),
    );
    return dec.decode(pt);
  } catch {
    throw new SecretUnlockError();
  }
}

export async function sealDevice(id: SecretId, plaintext: string): Promise<SealedSecret> {
  return aesEncrypt(await getDeviceKey(), id, plaintext, { wrap: "device" });
}
export async function openDevice(s: SealedSecret): Promise<string> {
  return aesDecrypt(await getDeviceKey(), s);
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", enc.encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealPassphrase(
  id: SecretId,
  plaintext: string,
  passphrase: string,
): Promise<SealedSecret> {
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt);
  return aesEncrypt(key, id, plaintext, {
    wrap: "passphrase",
    salt: toB64(salt),
    kdf: { name: "PBKDF2", iters: PBKDF2_ITERS, hash: "SHA-256" },
  });
}
export async function openPassphrase(s: SealedSecret, passphrase: string): Promise<string> {
  if (!s.salt) throw new SecretUnlockError("missing-salt");
  const key = await deriveKey(passphrase, fromB64(s.salt));
  return aesDecrypt(key, s);
}
