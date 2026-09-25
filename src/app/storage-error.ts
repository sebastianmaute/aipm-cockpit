// src/app/storage-error.ts
//
// Classify a thrown storage error into a user-facing Turso connectivity kind.
// Pure + dependency-light so it can drive the status bubble and the storage
// banner from one place (see use-storage-backend wiring + task-manager). Only
// Turso-specific failures map to a kind; anything else (local-file permission
// hints, unrelated errors) returns null so no false storage banner appears.

import { StorageNotReadyError } from "./storage";
import { TursoLockTimeoutError } from "./turso-backend";

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
    // §337 — turso-pipeline throws ONE of two hints on a 401/403, and the
    // hint alone decides the kind. Controller ruling (I2): attribute by what
    // THIS call rejected, never by the `isEnvTokenRejected()` global flag —
    // that flag can still be set from an earlier, unrelated incident (or
    // because a Settings-typed token also failed while the flag was already
    // up), and reading it here would blame the deployment for a rejection
    // that was actually a bad Settings token.
    if (err.hint === "turso-env-token-rejected") return "auth-env";
    if (err.hint === "turso-token-rejected") return "auth";
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
