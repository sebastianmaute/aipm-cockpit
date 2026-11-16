"use client";

// Settings → AI: the per-project switch that pauses the background AI runs (§795): scheduled job analyses, automatic
// insight recommendations and the scheduled digest summary.
// ★ The choice is stored on the PROJECT (`Workspace.settingsOverrides.ai.backgroundOff`) through the same
//   project-override path as the rates switch. OFF is the default and is stored as ABSENCE (`withAiSwitch` deletes the
//   key). The switch only PAUSES: it never reads, writes or withdraws `settings.ai.backgroundConsent`, and AI the
//   user starts is unaffected.
// ★ Mirror of `ai-rates-control.tsx`: pausing needs no dialog and logs `ai.backgroundPaused`; allowing background AI
//   again asks first and logs `ai.backgroundResumed`. Both entries have actor "user". Each write sets the state the
//   user chose, and a project swap while the dialog is open drops the write and its entry (`dropStaleScopeWrite`).
// ★★ A deployment that forces it (`ai-background` in the disabled integrations) shows the control ON and locked, with
//   the reason. The stored choice is left alone; `isBackgroundOff` ignores it while forced.
import { useId } from "react";
import { useActivityLogger } from "../activity-log-context";
import { isBackgroundOff, isBackgroundOffForced, withAiSwitch } from "../ai-project-switches";
import { useOpenProjectScopeEpoch } from "../ai-privacy-context";
import { useConfirm } from "../confirm-dialog";
import { FieldHint } from "../field-hint";
import { FieldNotice } from "../field-feedback";
import { Checkbox } from "../form-controls";
import { type Lang, t } from "../i18n";
import { dropStaleScopeWrite } from "../scope-epoch";
import { useWorkspace } from "../workspace-context";

export function AiBackgroundControl({ lang }: { lang: Lang }) {
  const { settingsOverrides, setSettingsOverrides } = useWorkspace();
  const confirm = useConfirm();
  const logActivityAs = useActivityLogger();
  const readScopeEpoch = useOpenProjectScopeEpoch();
  const helpId = useId();
  const lockedId = useId();
  const forced = isBackgroundOffForced();
  const on = isBackgroundOff(settingsOverrides);

  const turnOn = () => {
    setSettingsOverrides((prev) => withAiSwitch(prev, "backgroundOff", true));
    logActivityAs?.("user", "ai.backgroundPaused");
  };

  const turnOff = async () => {
    const startEpoch = readScopeEpoch();
    const ok = await confirm({
      title: t(lang, "aiBackgroundOffResumeTitle"),
      message: t(lang, "aiBackgroundOffResumeConfirm"),
      confirmLabel: t(lang, "aiBackgroundOffResumeButton"),
      tone: "default",
    });
    if (!ok) return;
    if (dropStaleScopeWrite(readScopeEpoch, startEpoch, "AiBackgroundControl.turnOff")) return;
    setSettingsOverrides((prev) => withAiSwitch(prev, "backgroundOff", false));
    logActivityAs?.("user", "ai.backgroundResumed");
  };

  return (
    <div className="mb-4" data-background-off-control>
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
        <span className="text-sm font-medium text-foreground">{t(lang, "aiBackgroundOffLabel")}</span>
      </label>
      <FieldHint id={helpId} className="mt-1">{t(lang, "aiBackgroundOffHint")}</FieldHint>
      {forced && <FieldNotice id={lockedId}>{t(lang, "aiBackgroundOffForced")}</FieldNotice>}
    </div>
  );
}
