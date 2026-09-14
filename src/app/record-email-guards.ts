// Write-boundary email guards shared by every AI/tool writer (spec Part 1).
// Kept out of sanitize-records.ts, which sits at the file-size LIMIT, and
// re-exported through the `./sanitize` barrel like absence-email.ts.
import { EMAIL_MAX, emailWriteRefusal, sanitizeText, type EmailRefusal } from "./sanitize-core";

/** The model-facing refusal text, one shape per reason. Unlocalized on purpose,
 *  like every other throw a tool writer surfaces. */
export function emailRefusalMessage(field: string, refusal: EmailRefusal): string {
  return refusal === "invalid" ? `${field} is invalid` : `${field} must not contain "," or ";"`;
}

/** Throws when `incoming` would store a CHANGED email that is not write-safe
 *  (`emailWriteRefusal`, judged against the row's `stored` value; a create
 *  passes undefined). A non-string `incoming` is not this guard's business —
 *  the record sanitizer blanks it — and a blank one is a legal clear.
 *  ★★ Fix round 1: `cap` is the FIELD'S OWN storage cap, defaulting to
 *  EMAIL_MAX (320) — what plain `sanitizeEmail` applies, and what every
 *  caller but one wants. The guard must judge the value the sanitizer will
 *  actually STORE, never a looser one: `sanitizeStakeholder` caps `email` at
 *  BUDGET_NAME_MAX (200) via `sanitizeText`, not `sanitizeEmail`, so
 *  `use-register-tools.ts`'s stakeholder writers pass that cap explicitly —
 *  else a >200-char address could pass THIS guard capped at 320 and then be
 *  re-cut to 200 by the sanitizer into something invalid it stores anyway. */
export function refuseEmailWrite(field: string, incoming: unknown, stored: string | undefined, cap: number = EMAIL_MAX): void {
  if (typeof incoming !== "string") return;
  const refusal = emailWriteRefusal(sanitizeText(incoming, cap), stored);
  if (refusal !== null) throw new Error(emailRefusalMessage(field, refusal));
}
