// Write-boundary email guards shared by every AI/tool writer (spec Part 1).
// Kept out of sanitize-records.ts, which sits at the file-size LIMIT, and
// re-exported through the `./sanitize` barrel like absence-email.ts.
import { emailWriteRefusal, sanitizeEmail, type EmailRefusal } from "./sanitize-core";

/** The model-facing refusal text, one shape per reason. Unlocalized on purpose,
 *  like every other throw a tool writer surfaces. */
export function emailRefusalMessage(field: string, refusal: EmailRefusal): string {
  return refusal === "invalid" ? `${field} is invalid` : `${field} must not contain "," or ";"`;
}

/** Throws when `incoming` would store a CHANGED email that is not write-safe
 *  (`emailWriteRefusal`, judged against the row's `stored` value; a create
 *  passes undefined). A non-string `incoming` is not this guard's business —
 *  the record sanitizer blanks it — and a blank one is a legal clear. */
export function refuseEmailWrite(field: string, incoming: unknown, stored: string | undefined): void {
  if (typeof incoming !== "string") return;
  const refusal = emailWriteRefusal(sanitizeEmail(incoming), stored);
  if (refusal !== null) throw new Error(emailRefusalMessage(field, refusal));
}
