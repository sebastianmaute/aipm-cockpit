// src/app/chat-crypto.ts
//
// Crypto primitives for saved AI chats: AES-256-GCM text envelopes, wrapping a
// per-thread key for its owner (under the owner's chat key) and for the
// operator (RSA-OAEP to a recovery public key). Pure Web Crypto; no React, no
// i18n. Keys travel as raw 32-byte `Uint8Array`s and are imported per call.
//
// Text formats (standard base64 with padding):
//   envelope           "c2." + b64(iv) + "." + b64(ciphertext)   AES-GCM with additional data
//                      "c1." + b64(iv) + "." + b64(ciphertext)   no additional data (read only)
//   operator-wrapped   "r1." + b64(RSA-OAEP ciphertext)
// Anything else is refused with `ChatCryptoError`.
//
// A c2 envelope is bound to the additional data it was sealed with (the caller's context: for a
// saved chat, its row id, project, owner and field — see chat-thread-codec.ts): opening it with any
// other additional data fails, so a sealed value cannot be moved to another row or field. Every
// write is c2; c1, written by an earlier release, still opens and ignores the additional data.

/** A malformed envelope, a wrong key, tampered ciphertext or an unusable key. */
export class ChatCryptoError extends Error {
  constructor(message = "chat-crypto-failed") {
    super(message);
    this.name = "ChatCryptoError";
  }
}

const KEY_BYTES = 32;
const IV_BYTES = 12;
const ENVELOPE_PREFIX = "c2";
const LEGACY_ENVELOPE_PREFIX = "c1";
const OPERATOR_PREFIX = "r1";
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });
const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  if (b64 === "" || !BASE64_RE.test(b64)) throw new ChatCryptoError("bad-base64");
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}
function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}
/** Copy into a fresh ArrayBuffer-backed array, as Web Crypto's types require. */
function ownBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

async function importAesKey(key: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) {
    throw new ChatCryptoError("bad-key-length");
  }
  try {
    return await subtle().importKey("raw", ownBytes(key), "AES-GCM", false, [usage]);
  } catch {
    throw new ChatCryptoError("bad-key");
  }
}

/** A fresh random 32-byte key for one chat thread. */
export async function generateThreadKey(): Promise<Uint8Array> {
  return randomBytes(KEY_BYTES);
}

/** A fresh random 32-byte per-person chat key (wraps that person's thread keys). */
export async function generateChatKey(): Promise<Uint8Array> {
  return randomBytes(KEY_BYTES);
}

/** Encrypt `plaintext` under `key` with a fresh IV into a "c2." envelope bound to `ad` (the
 *  additional data, which is authenticated but not stored). */
export async function sealText(key: Uint8Array, plaintext: string, ad: string): Promise<string> {
  if (typeof ad !== "string") throw new ChatCryptoError("bad-additional-data");
  const aes = await importAesKey(key, "encrypt");
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(ad) }, aes, enc.encode(plaintext));
  return `${ENVELOPE_PREFIX}.${toB64(iv)}.${toB64(new Uint8Array(ct))}`;
}

/** Decrypt a "c2." envelope sealed with `ad`, or a "c1." one (no additional data; `ad` is not
 *  used). Throws `ChatCryptoError` on a malformed envelope, a wrong key, other additional data or a
 *  failed authentication tag. */
export async function openText(key: Uint8Array, envelope: string, ad: string): Promise<string> {
  const parts = typeof envelope === "string" ? envelope.split(".") : [];
  if (parts.length !== 3 || (parts[0] !== ENVELOPE_PREFIX && parts[0] !== LEGACY_ENVELOPE_PREFIX)) {
    throw new ChatCryptoError("bad-envelope");
  }
  const bound = parts[0] === ENVELOPE_PREFIX;
  if (bound && typeof ad !== "string") throw new ChatCryptoError("bad-additional-data");
  const iv = fromB64(parts[1]);
  const ct = fromB64(parts[2]);
  if (iv.length !== IV_BYTES) throw new ChatCryptoError("bad-envelope");
  const aes = await importAesKey(key, "decrypt");
  const params: AesGcmParams = bound ? { name: "AES-GCM", iv, additionalData: enc.encode(ad) } : { name: "AES-GCM", iv };
  try {
    const pt = await subtle().decrypt(params, aes, ct);
    return dec.decode(pt);
  } catch {
    throw new ChatCryptoError("open-failed");
  }
}

function assertThreadKey(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== KEY_BYTES) throw new ChatCryptoError("bad-thread-key");
  return bytes;
}

/** Wrap a thread key for its owner: `sealText(chatKey, b64(threadKey), ad)`. */
export async function wrapForOwner(chatKey: Uint8Array, threadKey: Uint8Array, ad: string): Promise<string> {
  return sealText(chatKey, toB64(assertThreadKey(threadKey)), ad);
}

/** Reverse of `wrapForOwner` (a c1 wrap of an earlier release opens too). */
export async function unwrapForOwner(chatKey: Uint8Array, wrapped: string, ad: string): Promise<Uint8Array> {
  return assertThreadKey(fromB64(await openText(chatKey, wrapped, ad)));
}

/** Wrap a thread key for the operator with RSA-OAEP (SHA-256) to the recovery
 *  public key, given as base64 DER SPKI. */
export async function wrapForOperator(spkiB64: string, threadKey: Uint8Array): Promise<string> {
  const der = fromB64(spkiB64);
  let pub: CryptoKey;
  try {
    pub = await subtle().importKey("spki", der, { name: "RSA-OAEP", hash: "SHA-256" }, false, [
      "encrypt",
    ]);
  } catch {
    throw new ChatCryptoError("bad-recovery-key");
  }
  const ct = await subtle().encrypt({ name: "RSA-OAEP" }, pub, ownBytes(assertThreadKey(threadKey)));
  return `${OPERATOR_PREFIX}.${toB64(new Uint8Array(ct))}`;
}

/** Reverse of `wrapForOperator`, with the operator's imported RSA-OAEP private key. */
export async function unwrapForOperator(
  privateKey: CryptoKey,
  wrapped: string,
): Promise<Uint8Array> {
  const parts = typeof wrapped === "string" ? wrapped.split(".") : [];
  if (parts.length !== 2 || parts[0] !== OPERATOR_PREFIX) {
    throw new ChatCryptoError("bad-envelope");
  }
  const ct = fromB64(parts[1]);
  let pt: ArrayBuffer;
  try {
    pt = await subtle().decrypt({ name: "RSA-OAEP" }, privateKey, ct);
  } catch {
    throw new ChatCryptoError("open-failed");
  }
  return assertThreadKey(new Uint8Array(pt));
}

/** True when Web Crypto's `subtle` and IndexedDB are both present. Never throws. */
export function isChatCryptoAvailable(): boolean {
  try {
    return (
      typeof globalThis.crypto?.subtle?.encrypt === "function" &&
      typeof globalThis.indexedDB !== "undefined" &&
      globalThis.indexedDB !== null
    );
  } catch {
    return false;
  }
}
