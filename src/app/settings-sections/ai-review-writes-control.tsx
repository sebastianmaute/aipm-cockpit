"use client";

// Settings → AI: the per-project "Review every AI write" switch (§794).
// ★ The choice is stored on the PROJECT (`Workspace.settingsOverrides.ai.reviewAllWrites`) through the same
//   project-override path as the people-protection switch. OFF is the default and is stored as ABSENCE
//   (`withAiSwitch` deletes the key), so a project that never set it serialises as before.
// ★★ A deployment that forces it (`ai-direct-writes` in the disabled integrations) shows the control ON and
//   locked, with the reason. The stored choice is left alone; `isReviewAllWrites` ignores it while forced.
import { useId } from "react";
import { isReviewAllWrites, isReviewAllWritesForced, withAiSwitch } from "../ai-project-switches";
import { FieldHint } from "../field-hint";
import { FieldNotice } from "../field-feedback";
import { Checkbox } from "../form-controls";
import { type Lang, t } from "../i18n";
import { useWorkspace } from "../workspace-context";

export function AiReviewWritesControl({ lang }: { lang: Lang }) {
  const { settingsOverrides, setSettingsOverrides } = useWorkspace();
  const helpId = useId();
  const lockedId = useId();
  const forced = isReviewAllWritesForced();
  const reviewing = isReviewAllWrites(settingsOverrides);

  return (
    <div className="mb-4" data-review-all-writes-control>
      <label className="flex items-center gap-2">
        <Checkbox
          checked={reviewing}
          disabled={forced}
          aria-describedby={forced ? `${helpId} ${lockedId}` : helpId}
          onChange={() => {
            if (forced) return; // the deployment decides; the stored choice stays as it is
            setSettingsOverrides((prev) => withAiSwitch(prev, "reviewAllWrites", !isReviewAllWrites(prev)));
          }}
        />
        <span className="text-sm font-medium text-foreground">{t(lang, "aiReviewAllWritesLabel")}</span>
      </label>
      <FieldHint id={helpId} className="mt-1">{t(lang, "aiReviewAllWritesHint")}</FieldHint>
      {forced && <FieldNotice id={lockedId}>{t(lang, "aiReviewAllWritesForced")}</FieldNotice>}
    </div>
  );
}
