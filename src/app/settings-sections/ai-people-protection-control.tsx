"use client";

// Settings → AI: the per-project "Protect people from the AI" switch (AI people protection, spec "Setting design").
// ★ The choice is stored on the PROJECT (`Workspace.settingsOverrides.ai.peopleAllowed`) through the same
//   project-override path as the forecast "Show simulation" switch, never in device settings, so everyone on a
//   shared project sees one state. Protected is the default and is stored as ABSENCE (`withPeopleAllowed`).
// ★ Turning protection OFF asks first (the dialog names what the AI will then see) and logs `ai.peopleProtectionOff`;
//   turning it back ON needs no dialog and logs `ai.peopleProtectionOn`. Both entries have actor "user".
// ★★ A deployment that forces protection (`ai-people` in the disabled integrations) shows the control ON and
//   locked, with the reason. The stored choice is left alone; `isPeopleProtected` ignores it while forced.
//   The app enforces the lock in the client only (spec P8).
import { useId } from "react";
import { useActivityLogger } from "../activity-log-context";
import { isPeopleProtected, isPeopleProtectionForced, withPeopleAllowed } from "../ai-people-protection";
import { useConfirm } from "../confirm-dialog";
import { FieldHint } from "../field-hint";
import { FieldNotice } from "../field-feedback";
import { Checkbox } from "../form-controls";
import { type Lang, t } from "../i18n";
import { useWorkspace } from "../workspace-context";

export function AiPeopleProtectionControl({ lang }: { lang: Lang }) {
  const { settingsOverrides, setSettingsOverrides } = useWorkspace();
  const confirm = useConfirm();
  const logActivityAs = useActivityLogger();
  const helpId = useId();
  const lockedId = useId();
  const forced = isPeopleProtectionForced();
  const protectedNow = isPeopleProtected(settingsOverrides);

  const turnOn = () => {
    setSettingsOverrides((prev) => withPeopleAllowed(prev, false));
    logActivityAs?.("user", "ai.peopleProtectionOn");
  };

  const turnOff = async () => {
    const ok = await confirm({
      title: t(lang, "aiPeopleProtectionOffTitle"),
      message: t(lang, "aiPeopleProtectionOffConfirm"),
      confirmLabel: t(lang, "aiPeopleProtectionOffButton"),
      tone: "default",
    });
    if (!ok) return;
    setSettingsOverrides((prev) => withPeopleAllowed(prev, true));
    logActivityAs?.("user", "ai.peopleProtectionOff");
  };

  return (
    <div className="mb-4" data-people-protection-control>
      <label className="flex items-center gap-2">
        <Checkbox
          checked={protectedNow}
          disabled={forced}
          aria-describedby={forced ? `${helpId} ${lockedId}` : helpId}
          onChange={() => {
            if (forced) return; // the deployment decides; the stored choice stays as it is
            if (protectedNow) void turnOff();
            else turnOn();
          }}
        />
        <span className="text-sm font-medium text-foreground">{t(lang, "aiPeopleProtectionLabel")}</span>
      </label>
      <FieldHint id={helpId} className="mt-1">{t(lang, "aiPeopleProtectionHelp")}</FieldHint>
      {forced && <FieldNotice id={lockedId}>{t(lang, "aiPeopleProtectionLocked")}</FieldNotice>}
    </div>
  );
}
