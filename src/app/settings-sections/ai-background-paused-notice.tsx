"use client";

// The "background AI is paused" line under the settings that start a background run on the OPEN project (§795): the
// background consent toggle and the automatic insight recommendations. The scheduled-jobs section does not use it: a job
// decides from its own project.
// ★ Derived REACTIVELY from settings (the deployment switch, then the open project's `settingsOverrides`), never from
//   `backgroundPauseReason()`, which reads module state that does not re-render anything.
import { isBackgroundOff, isBackgroundOffForced } from "../ai-project-switches";
import { FieldHint } from "../field-hint";
import { type Lang, t } from "../i18n";
import { useOptionalSettingsOverrides } from "../workspace-context";

/** Whether the notice is shown: background AI is paused by the deployment or by the open project. The controls it
 *  sits under ask this too, to link themselves to the notice only while it exists. */
export function useAiBackgroundPaused(): boolean {
  const overrides = useOptionalSettingsOverrides();
  return isBackgroundOff(overrides);
}

/** `id` lets the control above it name the notice in its `aria-describedby`. */
export function AiBackgroundPausedNotice({ lang, id }: { lang: Lang; id?: string }) {
  const overrides = useOptionalSettingsOverrides();
  if (isBackgroundOffForced()) {
    return <FieldHint id={id} className="mt-1">{t(lang, "aiBackgroundPausedByDeployment")}</FieldHint>;
  }
  if (isBackgroundOff(overrides)) {
    return <FieldHint id={id} className="mt-1">{t(lang, "aiBackgroundPausedNotice")}</FieldHint>;
  }
  return null;
}
