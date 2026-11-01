// src/app/secrets.ts
//
// At-rest encryption for the browser-held secrets (see SECRET_IDS). Pure
// WebCrypto: AES-256-GCM with either a non-extractable device-bound key
// (default) or a PBKDF2-derived passphrase key. i18n-free.

export type WrapMode = "device" | "passphrase";

/**
 * Every device-sealed secret id, as a RUNTIME list; `SecretId` is derived from
 * it rather than hand-written. A TypeScript union cannot be enumerated at
 * runtime, and the one thing this list has to support is a check that no id was
 * left behind by a consumer that walks the set.
 */
export const SECRET_IDS = [
  "anthropicApiKey",
  "tursoAuthToken",
  "jiraApiToken",
  "timelogApiToken",
  "sttApiKey",
] as const;
export type SecretId = (typeof SECRET_IDS)[number];

/**
 * Where each sealed secret lives inside `Settings`, as a property path.
 *
 * The id and the field it seals are NOT the same string — three of the five
 * differ — and `jira`, `timelog` and `dictation` sit at the TOP level of
 * Settings, not under `integrations`. Derived from `writeSettings` and
 * `hydrateSecretsInto` (use-settings.ts), which are authoritative for both.
 *
 * Typed as a TOTAL Record so a new `SecretId` with no path is a tsc error.
 * Consumers that have to reach the fields walk this instead of restating the
 * paths: a second copy is precisely how the recovery-export redaction came to
 * cover three of the five while silently missing the other two.
 */
export const SECRET_SETTINGS_PATHS: Readonly<Record<SecretId, readonly string[]>> = {
  anthropicApiKey: ["ai", "apiKey"],
  tursoAuthToken: ["integrations", "turso", "authToken"],
  jiraApiToken: ["jira", "apiToken"],
  timelogApiToken: ["timelog", "apiToken"],
  sttApiKey: ["dictation", "sttApiKey"],
};

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
    // ★★ §567 — membership in `SECRET_IDS`, never a restated list. A hand-kept
    //   copy that missed an id made this return false for a correctly sealed
    //   secret, and `readStore` then dropped it on read with nothing reported.
    typeof s.id === "string" &&
    (SECRET_IDS as readonly string[]).includes(s.id) &&
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
 *  A module-level singleton promise makes concurrent callers in ONE tab share one
 *  load/generate; across tabs the load-or-create runs under a Web Lock where the
 *  browser has one, and a tab that created a key returns what IndexedDB holds
 *  afterwards, so a tab that lost a race adopts the winner's key instead of
 *  orphaning ciphertext. On any failure — the IndexedDB open included — the cache
 *  resets so a later call can retry. */
let deviceKeyPromise: Promise<CryptoKey> | null = null;
export function getDeviceKey(): Promise<CryptoKey> {
  if (!deviceKeyPromise) deviceKeyPromise = loadOrCreateDeviceKey();
  return deviceKeyPromise;
}

const DEVICE_KEY_LOCK = "aipm-cockpit:device-key";

function withDeviceKeyLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  return locks?.request ? locks.request(DEVICE_KEY_LOCK, fn) : fn();
}

async function loadOrCreateDeviceKey(): Promise<CryptoKey> {
  try {
    return await withDeviceKeyLock(readOrCreateStoredKey);
  } catch (err) {
    deviceKeyPromise = null; // allow a later retry
    throw err;
  }
}

async function readOrCreateStoredKey(): Promise<CryptoKey> {
  const db = await idbOpen();
  try {
    const existing = (await idbGet(db, DEVICE_KEY_ID)) as CryptoKey | undefined;
    if (existing) return existing;
    const key = await subtle().generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await idbPut(db, DEVICE_KEY_ID, key);
    // The stored key, not ours: without Web Locks another tab may have written in between.
    return ((await idbGet(db, DEVICE_KEY_ID)) as CryptoKey | undefined) ?? key;
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
  return aesDecryptB64(key, s.iv, s.ciphertext);
}
/** Base64 IV + ciphertext in, plaintext out; any failure (bad base64, wrong
 *  key, tampered tag) becomes a `SecretUnlockError`. */
async function aesDecryptB64(key: CryptoKey, ivB64: string, ctB64: string): Promise<string> {
  try {
    const pt = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(ivB64) }, key, fromB64(ctB64));
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

/** A value sealed under the device key that is not one of the `SECRET_IDS`
 *  settings fields (e.g. a per-person chat key). Both fields are base64. */
export interface DeviceSealedValue {
  iv: string;
  ciphertext: string;
}

/** Seal an arbitrary string under the same non-extractable device key as the
 *  settings secrets, with a fresh 12-byte IV. */
export async function sealDeviceValue(plaintext: string): Promise<DeviceSealedValue> {
  const key = await getDeviceKey();
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return { iv: toB64(iv), ciphertext: toB64(ct) };
}

/** Open a `sealDeviceValue` result. Throws `SecretUnlockError` on a tampered or
 *  malformed value, or one sealed under another device key. */
export async function openDeviceValue(v: DeviceSealedValue): Promise<string> {
  return aesDecryptB64(await getDeviceKey(), v.iv, v.ciphertext);
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

/** A value sealed under a passphrase that is not one of the `SECRET_IDS` settings fields (e.g. a
 *  chat key kept in Turso for another browser). Same PBKDF2 parameters as `sealPassphrase`; every
 *  field is base64. */
export interface PassphraseSealedValue {
  salt: string;
  iv: string;
  ciphertext: string;
}

/** Seal an arbitrary string under a key derived from `passphrase`, with a fresh 16-byte salt and
 *  12-byte IV. */
export async function sealPassphraseValue(plaintext: string, passphrase: string): Promise<PassphraseSealedValue> {
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt);
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return { salt: toB64(salt), iv: toB64(iv), ciphertext: toB64(ct) };
}

/** Open a `sealPassphraseValue` result. A wrong passphrase, or a tampered or malformed value,
 *  throws `SecretUnlockError`. */
export async function openPassphraseValue(v: PassphraseSealedValue, passphrase: string): Promise<string> {
  let salt: Uint8Array<ArrayBuffer>;
  try {
    salt = fromB64(v.salt);
  } catch {
    throw new SecretUnlockError("bad-salt");
  }
  const key = await deriveKey(passphrase, salt);
  return aesDecryptB64(key, v.iv, v.ciphertext);
}
