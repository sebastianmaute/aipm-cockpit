"use client";

import { useState } from "react";
import { Button } from "./button";
import { derivedRemaining, effortProgress, formatDuration } from "./duration";
import { EffortField } from "./effort-field";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { ProgressTrack } from "./progress-track";

export interface TimeTrackingValues {
  spentMinutes: number | undefined;
  remainingMinutes: number | undefined;
}

/** Jira-style time tracking, stacked over the task form.
 *
 *  Save writes to the caller's FORM STATE, never to storage: the task may be
 *  unsaved and have no id yet, so this dialog cannot persist independently.
 *  Values reach the workspace on the task form's own Save.
 *
 *  zIndex 50 sits above TaskFormModal's default 40 and below ConfirmDialog's
 *  60. `Modal` owns dismissal-stack membership keyed on [open] alone, and the
 *  stack is in OPEN order — this dialog opens in response to a click inside an
 *  already-open task form, so it is pushed later and is topmost, which is what
 *  routes Escape here and moves the Tab trap off the form beneath.
 *
 *  ★★ MOUNT THIS CONDITIONALLY — never keep it mounted with `open={false}`.
 *  Both `EffortField`s seed their text ONCE via a lazy `useState`, and the two
 *  `useState`s below seed from props the same way, so a retained instance
 *  reopens showing the PREVIOUS session's text and discarded edits. Unmounting
 *  on close is what makes each open a fresh read of the form's current values. */
export function TaskTimeTrackingModal({
  open,
  lang,
  estimateMinutes,
  spentMinutes,
  remainingMinutes,
  onSave,
  onClose,
}: {
  open: boolean;
  lang: Lang;
  estimateMinutes: number | undefined;
  spentMinutes: number | undefined;
  remainingMinutes: number | undefined;
  onSave: (values: TimeTrackingValues) => void;
  onClose: () => void;
}) {
  const [spent, setSpent] = useState<number | undefined>(spentMinutes);
  const [remaining, setRemaining] = useState<number | undefined>(remainingMinutes);

  const { hasEstimate, pct, over } = effortProgress(estimateMinutes, spent);
  const fillPct = Math.min(pct, 1) * 100;

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel={t(lang, "taskTimeTracking")}
      align="center"
      zIndex={50}
    >
      <div className="flex w-[520px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <ModalHeader lang={lang} title={t(lang, "taskTimeTracking")} onClose={onClose} />

        <div className="space-y-4 p-6">
          <div>
            {/* The figures are spelled out in the caption below, so the track is
                decorative — a second progressbar announcement would only repeat
                what the text already says. */}
            <ProgressTrack height="h-2.5" aria-hidden="true">
              {hasEstimate && (
                <div
                  className={`h-full rounded-full transition-all ${over ? "bg-ui-pink" : "bg-ui-dark-blue"}`}
                  style={{ width: `${fillPct}%` }}
                />
              )}
            </ProgressTrack>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(lang, "taskTimeTrackingLogged", formatDuration(spent ?? 0) || "0m")}
            </p>
          </div>

          <p className="text-sm text-foreground">
            {hasEstimate
              ? t(lang, "taskTimeTrackingOriginal", formatDuration(estimateMinutes ?? 0))
              : t(lang, "taskTimeTrackingOriginalNone")}
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <EffortField
              lang={lang}
              label={t(lang, "taskTimeSpent")}
              minutes={spent}
              onChange={setSpent}
            />
            <EffortField
              lang={lang}
              label={t(lang, "taskTimeRemaining")}
              captionHint={t(lang, "taskTimeRemainingHint")}
              minutes={remaining}
              // The DERIVED figure as placeholder, so an unpinned box shows
              // what the app will use without claiming it as a stored value.
              placeholder={formatDuration(derivedRemaining(estimateMinutes, spent)) || "0m"}
              onChange={setRemaining}
            />
          </div>

          <div className="text-xs text-muted-foreground">
            <p>{t(lang, "taskTimeFormat")}</p>
            <ul className="ml-4 list-disc">
              <li>{t(lang, "taskTimeFormatWeeks")}</li>
              <li>{t(lang, "taskTimeFormatDays")}</li>
              <li>{t(lang, "taskTimeFormatHours")}</li>
              <li>{t(lang, "taskTimeFormatMinutes")}</li>
            </ul>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="primary"
              onClick={() => {
                // `remaining` stays UNDEFINED when the box is empty — never 0.
                // A stored zero is the different, real claim "no work left";
                // undefined means "not overridden, follow the estimate".
                onSave({ spentMinutes: spent, remainingMinutes: remaining });
                onClose();
              }}
            >
              {t(lang, "taskTimeTrackingSave")}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t(lang, "cancel")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
