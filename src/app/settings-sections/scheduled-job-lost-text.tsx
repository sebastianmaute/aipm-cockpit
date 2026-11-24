// src/app/settings-sections/scheduled-job-lost-text.tsx — instruction text a job row could not save, offered read-only
// for copying below the instruction field. Nothing is saved or answered from it; Dismiss takes it away.
import { useId } from "react";
import { type Lang, t } from "../i18n";
import { Textarea } from "../form-controls";
import { Button } from "../button";

/** The read-only offer of lost text (renders nothing while there is none). */
export function LostTextBox({
  lang,
  token,
  text,
  onDismiss,
}: {
  lang: Lang;
  token: string;
  /** The lost texts, newest first, separated by a blank line; null when there is nothing to offer. */
  text: string | null;
  onDismiss: () => void;
}) {
  const hintId = useId();
  if (text === null) return null;
  return (
    <div className="flex w-full flex-col gap-1 text-xs text-foreground">
      <label className="flex flex-col gap-1">
        <span>{t(lang, "scheduledJobLostText")}</span>
        <Textarea
          size="xs"
          rows={2}
          readOnly
          value={text}
          aria-label={`${t(lang, "scheduledJobLostText")} – ${token}`}
          aria-describedby={hintId}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span id={hintId} className="text-muted-foreground">{t(lang, "scheduledJobLostTextHint")}</span>
        <Button variant="secondary" size="xs" onClick={onDismiss} aria-label={t(lang, "scheduledJobLostTextDismissNamed", token)}>
          {t(lang, "scheduledJobLostTextDismiss")}
        </Button>
      </div>
    </div>
  );
}
