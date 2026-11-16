"use client";

// Settings → AI: the per-project switch that keeps hourly rates out of Plan with AI and the chat's forecast (§804).
// ★ The choice is stored on the PROJECT (`Workspace.settingsOverrides.ai.ratesWithheld`) through the same
//   project-override path as the people-protection switch. OFF is the default and is stored as ABSENCE
//   (`withAiSwitch` deletes the key), so a project that never set it serialises as before.
// ★★ A deployment that forces it (`ai-rates` in the disabled integrations) shows the control ON and locked,
//   with the reason. The stored choice is left alone; `isRatesWithheld` ignores it while forced.
import { useId } from "react";
import { isRatesWithheld, isRatesWithheldForced, withAiSwitch } from "../ai-project-switches";
import { FieldHint } from "../field-hint";
import { FieldNotice } from "../field-feedback";
import { Checkbox } from "../form-controls";
import { type Lang, t } from "../i18n";
import { useWorkspace } from "../workspace-context";

export function AiRatesControl({ lang }: { lang: Lang }) {
  const { settingsOverrides, setSettingsOverrides } = useWorkspace();
  const helpId = useId();
  const lockedId = useId();
  const forced = isRatesWithheldForced();
  const withheld = isRatesWithheld(settingsOverrides);

  return (
    <div className="mb-4" data-rates-withheld-control>
      <label className="flex items-center gap-2">
        <Checkbox
          checked={withheld}
          disabled={forced}
          aria-describedby={forced ? `${helpId} ${lockedId}` : helpId}
          onChange={() => {
            if (forced) return; // the deployment decides; the stored choice stays as it is
            setSettingsOverrides((prev) => withAiSwitch(prev, "ratesWithheld", !isRatesWithheld(prev)));
          }}
        />
        <span className="text-sm font-medium text-foreground">{t(lang, "aiRatesWithheldLabel")}</span>
      </label>
      <FieldHint id={helpId} className="mt-1">{t(lang, "aiRatesWithheldHint")}</FieldHint>
      {forced && <FieldNotice id={lockedId}>{t(lang, "aiRatesWithheldForced")}</FieldNotice>}
    </div>
  );
}
