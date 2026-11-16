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

export function AiBackgroundPausedNotice({ lang }: { lang: Lang }) {
  const overrides = useOptionalSettingsOverrides();
  if (isBackgroundOffForced()) {
    return <FieldHint className="mt-1">{t(lang, "aiBackgroundPausedByDeployment")}</FieldHint>;
  }
  if (isBackgroundOff(overrides)) {
    return <FieldHint className="mt-1">{t(lang, "aiBackgroundPausedNotice")}</FieldHint>;
  }
  return null;
}
