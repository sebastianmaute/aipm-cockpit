// src/app/editor-email-rule.ts
//
// Shared submit-time email-write-rule helpers for every editor modal whose
// email field is judged by the changed-only write rule (`emailWriteRefusal`,
// sanitize-core.ts). Extracted in fix round 1 after the refusal-check +
// flag-visibility logic was hand-copied — and drifted — across five to seven
// editors (resource, stakeholder, RAID, shift, absence, task form, contact
// persons).
import { type Lang, t } from "./i18n";
import { emailWriteRefusal } from "./sanitize-core";
import { EMAIL_REFUSAL_KEY } from "./email-refusal-i18n";
import type { Resource } from "./types";

/** The linked resource's stored email, or undefined when unlinked or the id
 *  resolves to nothing. Shared copy-source lookup for every editor that
 *  threads a `resourceId`-shaped FK alongside its own email field. */
export function linkedResourceEmail(
  resources: readonly Resource[],
  resourceId: number | null | undefined,
): string | undefined {
  return resourceId != null ? resources.find((r) => r.id === resourceId)?.email : undefined;
}

/** Judges `incoming` against `stored` + `copySources` (the changed-only write
 *  rule) and returns the already-translated refusal message, or null when the
 *  write is safe. `incoming`/`stored` must be the value that would actually
 *  be STORED — the same unwrap/cap treatment the entity's write path
 *  applies (`sanitizeLoadedEmail` for an EMAIL_MAX-capped field,
 *  `sanitizeLoadedStakeholderEmail` for the stakeholder's 200 cap; M-C4) —
 *  never the raw typed string, or the judged value can diverge from what a
 *  submit actually persists. */
export function editorEmailRefusalMessage(
  lang: Lang,
  incoming: string,
  stored: string | undefined,
  copySources: readonly (string | undefined)[] = [],
): string | null {
  const refusal = emailWriteRefusal(incoming, stored, copySources);
  return refusal ? t(lang, EMAIL_REFUSAL_KEY[refusal]) : null;
}

/** Whether the non-blocking flag (`EmailFieldError`) should render this pass.
 *  `value` is judged the same way `EmailFieldError` itself judges it — a bare
 *  write-safety check with no stored/copy source. The flag steps aside ONLY
 *  while `bannerError` is showing this EXACT SAME refusal message (avoiding a
 *  duplicated identical `role="alert"`); an UNRELATED banner error (a blank
 *  required field, a cause cycle, an out-of-range value, a duplicate
 *  assignee…) never hides it. `EmailFieldError`'s own contract is "never
 *  hidden" — hiding it is entirely this caller-side decision, made once here
 *  so every editor applies the same rule. */
export function emailFlagVisible(
  lang: Lang,
  value: string | undefined,
  bannerError: string | null | undefined,
): boolean {
  const refusal = emailWriteRefusal(value ?? "", undefined);
  if (refusal === null) return false;
  return bannerError !== t(lang, EMAIL_REFUSAL_KEY[refusal]);
}

/** aria-describedby value for an email input paired with `EmailFieldError`:
 *  `id` while the flag will actually render (per `emailFlagVisible`), else
 *  undefined — a reference to an unmounted node is itself an accessibility
 *  defect. */
export function emailFlagDescribedBy(
  id: string,
  lang: Lang,
  value: string | undefined,
  bannerError: string | null | undefined,
): string | undefined {
  return emailFlagVisible(lang, value, bannerError) ? id : undefined;
}

/** Space-joins the given ids, dropping falsy ones, or undefined if none
 *  remain — the aria-describedby composition every editor needs when pairing
 *  a fixed counter id with the flag's conditional one. */
export function joinDescribedBy(...ids: (string | undefined)[]): string | undefined {
  return ids.filter(Boolean).join(" ") || undefined;
}
