// src/app/use-secrets.ts
//
// Save / passphrase-lock / unlock controller for the two at-rest secrets.
// Pure async functions over secrets.ts + secrets-store.ts; the React surfaces
// (settings sections, chat, boot gate) call these and update in-memory settings.

import {
  type SecretId,
  type WrapMode,
  sealDevice,
  sealPassphrase,
  openPassphrase,
  SecretUnlockError,
} from "./secrets";
import { loadSealed, saveSealed } from "./secrets-store";

/** Seal `value` under the chosen wrap (device by default) and store it. */
export async function saveSecretValue(
  id: SecretId,
  value: string,
  wrap: WrapMode,
  passphrase?: string,
): Promise<void> {
  if (wrap === "passphrase") {
    if (!passphrase) throw new Error("passphrase required");
    saveSealed(await sealPassphrase(id, value, passphrase));
  } else {
    saveSealed(await sealDevice(id, value));
  }
}

/** Re-seal an existing/known value under a passphrase. */
export async function setSecretPassphrase(
  id: SecretId,
  value: string,
  passphrase: string,
): Promise<void> {
  saveSealed(await sealPassphrase(id, value, passphrase));
}

/** Try to unlock a passphrase secret. Returns plaintext, or null on wrong passphrase. */
export async function unlockSecret(id: SecretId, passphrase: string): Promise<string | null> {
  const sealed = loadSealed(id);
  if (!sealed || sealed.wrap !== "passphrase") return null;
  try {
    return await openPassphrase(sealed, passphrase);
  } catch (e) {
    if (e instanceof SecretUnlockError) return null;
    throw e;
  }
}
