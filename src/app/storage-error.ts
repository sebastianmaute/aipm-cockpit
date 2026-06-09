// src/app/storage-error.ts
//
// Classify a thrown storage error into a user-facing Turso connectivity kind.
// Pure + dependency-light so it can drive the status bubble and the storage
// banner from one place (see use-storage-backend wiring + task-manager). Only
// Turso-specific failures map to a kind; anything else (local-file permission
// hints, unrelated errors) returns null so no false storage banner appears.

import { StorageNotReadyError } from "./storage";

export type StorageErrorKind = "unreachable" | "auth";

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
