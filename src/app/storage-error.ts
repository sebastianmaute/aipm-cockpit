// src/app/storage-error.ts
//
// Classify a thrown storage error into a user-facing Turso connectivity kind.
// Pure + dependency-light so it can drive the status bubble and the storage
// banner from one place (see use-storage-backend wiring + task-manager). Only
// Turso-specific failures map to a kind; anything else (local-file permission
// hints, unrelated errors) returns null so no false storage banner appears.

import { StorageNotReadyError } from "./storage";
import { TursoLockTimeoutError } from "./turso-backend";
import { isEnvTokenRejected } from "./turso-config";

export type StorageErrorKind = "unreachable" | "auth" | "auth-env" | "generic";

/** True when a save failed because the cross-tab Web Locks wait timed out
 *  (another tab is writing). Deliberately NOT a StorageErrorKind — it's
 *  transient, so it stays on the toast path; the UI boundary uses this to
 *  swap the raw English error text for the localized `tursoLockTimeout`
 *  message (turso-backend.ts has no lang context). */
export function isTursoLockTimeout(err: unknown): boolean {
  return err instanceof TursoLockTimeoutError;
}

export function tursoErrorKind(err: unknown): StorageErrorKind | null {
  if (err instanceof StorageNotReadyError) {
    if (err.hint === "storage-unreachable") return "unreachable";
    // turso-pipeline throws this exact hint on a 401/403 from the DB. §337 —
    // when the REJECTED token was the deployment's env token, the flag it set
    // gets its own kind so the banner can say "check the deployment", not
    // "check Settings" — the field that fixes an env-token rejection lives in
    // Settings only while the flag is set, which "auth-env" is naming.
    if (err.hint === "turso-token-rejected") return isEnvTokenRejected() ? "auth-env" : "auth";
    return null;
  }
  // Plain Error from a non-OK Turso HTTP response (e.g. a 5xx).
  if (err instanceof Error && /^Turso returned/i.test(err.message)) return "unreachable";
  return null;
}

/** Classify ANY save/load failure into a banner kind: a Turso connectivity/auth
 *  kind when recognized, else "generic" so a file/CSV/MD/IndexedDB persistence
 *  failure still raises the sticky "changes not saved" banner instead of being
 *  swallowed (the banner was previously Turso-only). */
export function classifyStorageError(err: unknown): StorageErrorKind {
  return tursoErrorKind(err) ?? "generic";
}
