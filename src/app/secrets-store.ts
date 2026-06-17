// src/app/secrets-store.ts
//
// Persistence + accessors for sealed secrets. Ciphertext lives in
// localStorage["lop-app:secrets"], keyed by SecretId; the device key lives in
// IndexedDB (see secrets.ts). Kept OUT of lop-app:settings and out of Turso.

import { type SealedSecret, type SecretId, openDevice } from "./secrets";

export const SECRETS_KEY = "lop-app:secrets";
type Store = Partial<Record<SecretId, SealedSecret>>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(SECRETS_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}
function writeStore(s: Store): void {
  try {
    localStorage.setItem(SECRETS_KEY, JSON.stringify(s));
  } catch {
    /* quota / disabled — degrade */
  }
}

export function loadSealed(id: SecretId): SealedSecret | null {
  return readStore()[id] ?? null;
}
export function saveSealed(sealed: SealedSecret): void {
  const s = readStore();
  s[sealed.id] = sealed;
  writeStore(s);
}
export function removeSealed(id: SecretId): void {
  const s = readStore();
  delete s[id];
  writeStore(s);
}
export function isPassphraseLocked(id: SecretId): boolean {
  return loadSealed(id)?.wrap === "passphrase";
}

/** Decrypt a device-wrapped secret. Returns null when absent OR passphrase-wrapped
 *  (the caller must prompt for unlock instead). Never throws on a missing key. */
export async function readDeviceSecret(id: SecretId): Promise<string | null> {
  const sealed = loadSealed(id);
  if (!sealed || sealed.wrap !== "device") return null;
  try {
    return await openDevice(sealed);
  } catch {
    return null;
  }
}
