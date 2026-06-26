"use client";

import { type Lang, t, type TranslationKey } from "./i18n";

/**
 * Shared numbered step rail for the multi-step wizards (create-project + backend
 * setup). One component so the styling + a11y (aria-current on the <li>, the "›"
 * separator, the wizardStepsLabel) can't drift between the two wizards.
 */
export function WizardStepIndicator({
  lang,
  current,
  steps,
}: {
  lang: Lang;
  /** Active step INDEX (0-based). */
  current: number;
  steps: readonly { titleKey: TranslationKey }[];
}) {
  return (
    <ol
      className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
      aria-label={t(lang, "wizardStepsLabel")}
    >
      {steps.map(({ titleKey }, i) => (
        <li key={titleKey} aria-current={current === i ? "step" : undefined} className="flex items-center gap-2">
          <span
            className={
              current === i
                ? "rounded-full bg-AIPM-green/15 px-3 py-1 font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey"
                : "px-3 py-1 text-muted-foreground"
            }
          >
            {i + 1}. {t(lang, titleKey)}
          </span>
          {i < steps.length - 1 && (
            <span aria-hidden className="text-muted-foreground">
              ›
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
