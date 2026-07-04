// Thin user-transparency layer over the diagnostic log (diagnostics.ts). Turns a
// silent guard bail into a logged event + a user toast. Helpers take showToast +
// lang as params so they work from both components and hooks. No control flow here.
import { logDiag } from "./diagnostics";
import { t, type Lang, type TranslationKey } from "./i18n";

type ShowToast = (kind: "info" | "error", text: string) => void;

/** A user action FAILED and would otherwise be swallowed: log the technical
 *  detail + tell the user (error toast). */
export function reportSilentFailure(
  showToast: ShowToast,
  lang: Lang,
  code: string,
  err: unknown,
  msgKey: TranslationKey,
): void {
  logDiag("error", code, { message: err instanceof Error ? err.message : String(err) });
  showToast("error", t(lang, msgKey));
}

/** A user triggered an OFF/unconfigured feature: log + guide the user (info toast). */
export function reportCapabilityGap(
  showToast: ShowToast,
  lang: Lang,
  code: string,
  guidanceKey: TranslationKey,
): void {
  logDiag("warn", code, {});
  showToast("info", t(lang, guidanceKey));
}
