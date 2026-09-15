// Maps an `EmailRefusal` (sanitize-core.ts) to the ONE message each reason
// shows in every UI surface: editors, toasts, prompt alerts. Kept out of the
// i18n-free sanitizers on purpose.
import { emailWriteRefusal, type EmailRefusal } from "./sanitize-core";

export const EMAIL_REFUSAL_KEY: Readonly<Record<EmailRefusal, "errorInvalidEmail" | "errorEmailDelimiter">> = {
  invalid: "errorInvalidEmail",
  delimiter: "errorEmailDelimiter",
};

/** ★★ Fix round 1 MINOR 3 — the i18n key for refusing a freshly TYPED value
 *  (a prompt/alert's own input, never a stored one — `stored` is always
 *  `undefined`), which was the same four-site copy at every prompt flow
 *  (`use-action-center-handlers.ts`, `use-bulk-operations.ts`,
 *  `use-task-row-handlers.ts`, `use-resource-planner.ts`): judge `value`
 *  once with `emailWriteRefusal`, then look up which message it earns.
 *  Every call site guards on `!isWriteSafeEmail(value)` first, but that does
 *  NOT make `?? "invalid"` unreachable: a BLANK `value` also fails
 *  `isWriteSafeEmail` (`isValidEmail("")` is false) while `emailWriteRefusal`
 *  treats blank as an always-legal clear and returns `null` for it — the
 *  fallback is exactly what keeps that case showing `"errorInvalidEmail"`,
 *  identical to what every call site already showed for one before this
 *  extraction. */
export function typedEmailRefusalKey(value: string): "errorInvalidEmail" | "errorEmailDelimiter" {
  return EMAIL_REFUSAL_KEY[emailWriteRefusal(value, undefined) ?? "invalid"];
}
