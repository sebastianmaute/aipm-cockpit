"use client";

// Settings → AI: the per-project switch that keeps hourly rates out of Plan with AI and the chat's forecast and
// dashboard figures (§804).
// ★ The choice is stored on the PROJECT (`Workspace.settingsOverrides.ai.ratesWithheld`) through the same
//   project-override path as the people-protection switch. OFF is the default and is stored as ABSENCE
//   (`withAiSwitch` deletes the key), so a project that never set it serialises as before.
// ★ Like people protection (`ai-people-protection-control.tsx`): turning the safeguard OFF asks first and logs
//   `ai.ratesWithheldOff`; turning it ON needs no dialog and logs `ai.ratesWithheldOn`. Both entries have actor "user".
//   Each write sets the state the user chose (never a toggle of the stored value), and a project swap while
//   the dialog is open drops the write and its entry (`dropStaleScopeWrite`).
// ★★ A deployment that forces it (`ai-rates` in the disabled integrations) shows the control ON and
//   locked, with the reason. The stored choice is left alone; `isRatesWithheld` ignores it while forced.
import { useId } from "react";
import { useActivityLogger } from "../activity-log-context";
import { isRatesWithheld, isRatesWithheldForced, withAiSwitch } from "../ai-project-switches";
import { useOpenProjectScopeEpoch } from "../ai-privacy-context";
import { useConfirm } from "../confirm-dialog";
import { FieldHint } from "../field-hint";
import { FieldNotice } from "../field-feedback";
import { Checkbox } from "../form-controls";
import { type Lang, t } from "../i18n";
import { dropStaleScopeWrite } from "../scope-epoch";
import { useWorkspace } from "../workspace-context";

export function AiRatesControl({ lang }: { lang: Lang }) {
  const { settingsOverrides, setSettingsOverrides } = useWorkspace();
  const confirm = useConfirm();
  const logActivityAs = useActivityLogger();
  const readScopeEpoch = useOpenProjectScopeEpoch();
  const helpId = useId();
  const lockedId = useId();
  const forced = isRatesWithheldForced();
  const on = isRatesWithheld(settingsOverrides);

  const turnOn = () => {
    setSettingsOverrides((prev) => withAiSwitch(prev, "ratesWithheld", true));
    logActivityAs?.("user", "ai.ratesWithheldOn");
  };

  const turnOff = async () => {
    const startEpoch = readScopeEpoch();
    const ok = await confirm({
      title: t(lang, "aiRatesWithheldOffTitle"),
      message: t(lang, "aiRatesWithheldOffConfirm"),
      confirmLabel: t(lang, "aiRatesWithheldOffButton"),
      tone: "default",
    });
    if (!ok) return;
    if (dropStaleScopeWrite(readScopeEpoch, startEpoch, "AiRatesControl.turnOff")) return;
    setSettingsOverrides((prev) => withAiSwitch(prev, "ratesWithheld", false));
    logActivityAs?.("user", "ai.ratesWithheldOff");
  };

  return (
    <div className="mb-4" data-rates-withheld-control>
      <label className="flex items-center gap-2">
        <Checkbox
          checked={on}
          disabled={forced}
          aria-describedby={forced ? `${helpId} ${lockedId}` : helpId}
          onChange={() => {
            if (forced) return; // the deployment decides; the stored choice stays as it is
            if (on) void turnOff();
            else turnOn();
          }}
        />
        <span className="text-sm font-medium text-foreground">{t(lang, "aiRatesWithheldLabel")}</span>
      </label>
      <FieldHint id={helpId} className="mt-1">{t(lang, "aiRatesWithheldHint")}</FieldHint>
      {forced && <FieldNotice id={lockedId}>{t(lang, "aiRatesWithheldForced")}</FieldNotice>}
    </div>
  );
}
