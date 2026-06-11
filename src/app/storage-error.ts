// src/app/storage-error.ts
//
// Classify a thrown storage error into a user-facing Turso connectivity kind.
// Pure + dependency-light so it can drive the status bubble and the storage
// banner from one place (see use-storage-backend wiring + task-manager). Only
// Turso-specific failures map to a kind; anything else (local-file permission
// hints, unrelated errors) returns null so no false storage banner appears.

import { StorageNotReadyError } from "./storage";
import { TursoLockTimeoutError } from "./turso-backend";

export type StorageErrorKind = "unreachable" | "auth";

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
    // turso-pipeline throws this exact message on a 401 from the DB.
    if (/auth token rejected/i.test(err.hint)) return "auth";
    return null;
  }
  // Plain Error from a non-OK Turso HTTP response (e.g. a 5xx).
  if (err instanceof Error && /^Turso returned/i.test(err.message)) return "unreachable";
  return null;
}
