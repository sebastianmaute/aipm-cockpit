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
import { beginSealedWrite, loadSealed } from "./secrets-store";

// ★ §609 — both writers claim their write (`beginSealedWrite`) BEFORE awaiting the seal, so a clear
//   or a newer save for the same id that starts during the await supersedes this one. They resolve
//   true when the value was stored, false when it was superseded (and nothing was written); a
//   caller must only show "stored" on true.

/** Seal `value` under the chosen wrap (device by default) and store it. */
export async function saveSecretValue(
  id: SecretId,
  value: string,
  wrap: WrapMode,
  passphrase?: string,
): Promise<boolean> {
  if (wrap === "passphrase") {
    if (!passphrase) throw new Error("passphrase required");
    const commit = beginSealedWrite(id);
    return commit(await sealPassphrase(id, value, passphrase));
  }
  const commit = beginSealedWrite(id);
  return commit(await sealDevice(id, value));
}

/** Re-seal an existing/known value under a passphrase. */
export async function setSecretPassphrase(
  id: SecretId,
  value: string,
  passphrase: string,
): Promise<boolean> {
  const commit = beginSealedWrite(id);
  return commit(await sealPassphrase(id, value, passphrase));
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
