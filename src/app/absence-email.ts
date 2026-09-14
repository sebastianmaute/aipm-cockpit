// §461 — the absence model-write path's assignee-email rule, kept out of
// sanitize-records.ts (which sits at the file-size LIMIT). Re-exported through
// the `./sanitize` barrel, so callers import it from there.

import { isValidEmail, sanitizeEmail } from "./sanitize-core";

/** The task path's rule (`buildTaskCleanPatch`, `createTask`), applied to an
 *  absence: a non-blank `assigneeEmail` that is not an address is refused
 *  LOUDLY (a throw, the same message) rather than stored. Blank stays legal —
 *  it is how an address is cleared.
 *
 *  ★★ NOT folded into `ABSENCE_FIELD_GUARDS.assigneeEmail`, although that row is
 *   model-write-only: a failing guard DROPS the key and keeps the stored value,
 *   which would turn the task path's loud refusal into a silent no-op. And NOT
 *   in `sanitizeAbsence`, which is also the LOAD-path sanitizer and must keep
 *   storing what it loads. Called by `createAbsence` / `updateAbsence`
 *   (`use-register-tools.ts`) after the allow-list; the absence descriptor's
 *   `emailFormatFields` previews the same refusal. `raid.ownerEmail` keeps the
 *   old unchecked shape. */
export function refuseInvalidAbsenceEmail(accepted: { assigneeEmail?: unknown }): void {
  if (typeof accepted.assigneeEmail !== "string") return;
  const email = sanitizeEmail(accepted.assigneeEmail);
  if (email && !isValidEmail(email)) throw new Error("assigneeEmail is invalid");
}
