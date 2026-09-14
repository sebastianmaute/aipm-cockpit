// Maps an `EmailRefusal` (sanitize-core.ts) to the ONE message each reason
// shows in every UI surface: editors, toasts, prompt alerts. Kept out of the
// i18n-free sanitizers on purpose.
import type { EmailRefusal } from "./sanitize-core";

export const EMAIL_REFUSAL_KEY: Readonly<Record<EmailRefusal, "errorInvalidEmail" | "errorEmailDelimiter">> = {
  invalid: "errorInvalidEmail",
  delimiter: "errorEmailDelimiter",
};
