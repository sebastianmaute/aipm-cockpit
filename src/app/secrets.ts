// src/app/secrets.ts
//
// At-rest encryption for the two browser-held secrets (Anthropic API key, Turso
// auth token). Pure WebCrypto: AES-256-GCM with either a non-extractable
// device-bound key (default) or a PBKDF2-derived passphrase key. i18n-free.

export type WrapMode = "device" | "passphrase";
export type SecretId = "anthropicApiKey" | "tursoAuthToken";

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

/** Wrong passphrase / tampered ciphertext. Thrown by openPassphrase/openDevice. */
export class SecretUnlockError extends Error {
  constructor(message = "secret-unlock-failed") {
    super(message);
    this.name = "SecretUnlockError";
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used in Task 2 (passphrase wrap)
const PBKDF2_ITERS = 600_000;
const DB_NAME = "lop-app-secrets";
const STORE = "keys";
const DEVICE_KEY_ID = "device-key";

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
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

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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

/** Get the persisted non-extractable device key, generating + storing it once. */
export async function getDeviceKey(): Promise<CryptoKey> {
  const db = await idbOpen();
  try {
    const existing = (await idbGet(db, DEVICE_KEY_ID)) as CryptoKey | undefined;
    if (existing) return existing;
    const key = await subtle().generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await idbPut(db, DEVICE_KEY_ID, key);
    return key;
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
  return { v: 1, id, alg: "AES-GCM", iv: toB64(iv.buffer), ciphertext: toB64(ct), ...extra } as SealedSecret;
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
