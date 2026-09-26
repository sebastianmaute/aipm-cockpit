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

// ★★★ Branch review I2 — the hint rename that made attribution precise
// (`"turso-token-rejected"` / `"turso-env-token-rejected"`) also made those
// hints reach USERS VERBATIM on every surface that still displayed
// `err.message` directly, which used to read a full English sentence
// ("Turso auth token rejected. Check the token in Settings.") and now reads
// an internal code with no remedy. `turso-project-picker.tsx`,
// `use-turso-projects.ts` (six toasts) and `use-portfolio-health.ts` all did
// this. `integrations-section.tsx`'s `runTursoTest` already avoided the
// defect by classifying before display; the helpers below let the other
// three sites do the same without duplicating the kind→key ternary at each.
const TURSO_ERROR_MESSAGE_KEYS = [
  "storageAuthBanner",
  "storageAuthEnvBanner",
  "storageUnreachableBanner",
] as const;
export type TursoErrorMessageKey = (typeof TURSO_ERROR_MESSAGE_KEYS)[number];

/** `err` → the i18n KEY for its translated sentence, when it is one of the
 *  three recognized Turso connectivity kinds — never the translated text
 *  itself. Mirrors `projectErrorKey` (`use-storage-backend.ts`) in returning
 *  a KEY so this file stays free of `t`/`Lang`: translation happens once, at
 *  the display site, in whatever language that site is already rendering.
 *  Returns null for a "generic" or unrecognized failure, so the caller's
 *  existing raw-message fallback is unchanged for anything this doesn't
 *  cover (a mid-pipeline "Turso error: …", a JSON-shape error, etc.). */
export function tursoErrorMessageKey(err: unknown): TursoErrorMessageKey | null {
  const kind = tursoErrorKind(err);
  if (kind === "auth") return "storageAuthBanner";
  if (kind === "auth-env") return "storageAuthEnvBanner";
  if (kind === "unreachable") return "storageUnreachableBanner";
  return null;
}

/** True when `x` is one of `tursoErrorMessageKey`'s possible return values.
 *  For a display site that cannot keep the original `err` around until
 *  render time and so stores the KEY itself in state (`use-portfolio-health.ts`'s
 *  `error`, alongside its pre-existing `PORTFOLIO_LOAD_FAILED` sentinel) —
 *  lets that site tell "this string is a translation key" apart from "this
 *  string is the sentinel" or "this string is a raw fallback message" at
 *  render time, without re-deriving the key list by hand. */
export function isTursoErrorMessageKey(x: string): x is TursoErrorMessageKey {
  return (TURSO_ERROR_MESSAGE_KEYS as readonly string[]).includes(x);
}
