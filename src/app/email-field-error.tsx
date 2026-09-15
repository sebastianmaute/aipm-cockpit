import { FieldError } from "./field-feedback";
import { type Lang, t } from "./i18n";
import { emailWriteRefusal } from "./sanitize-core";
import { EMAIL_REFUSAL_KEY } from "./email-refusal-i18n";

/** The non-blocking flag every email editor shows under its input while the
 *  value is not write-safe (spec Part 1, "Copied stored emails"): a stored or
 *  copied unsafe address is FLAGGED, never hidden and never blocking by itself.
 *  Saving it CHANGED is refused by the editor's own submit check. Pair the input
 *  with `aria-invalid` and `aria-describedby={id}` while `emailFieldInvalid`. */
export function EmailFieldError({ id, lang, value }: { id: string; lang: Lang; value: string | undefined }) {
  const refusal = emailWriteRefusal(value ?? "", undefined);
  return <FieldError id={id}>{refusal ? t(lang, EMAIL_REFUSAL_KEY[refusal]) : null}</FieldError>;
}

/** True while `EmailFieldError` is showing — drives `aria-invalid`. */
export function emailFieldInvalid(value: string | undefined): boolean {
  return emailWriteRefusal(value ?? "", undefined) !== null;
}
