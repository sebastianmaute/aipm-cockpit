"use client";

import { useState } from "react";
import { EffortProgressBar, effortCaption } from "./effort-progress-bar";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { TaskTimeTrackingModal, type TimeTrackingValues } from "./task-time-tracking-modal";

/** The task form's Time tracking cell: a button showing the bar and the
 *  figures, opening the dialog.
 *
 *  The dialog is CONDITIONALLY MOUNTED, not kept mounted with open={false}.
 *  Two independent reasons: EffortField seeds its text once via lazy useState,
 *  so a retained instance would reopen showing the previous session's text;
 *  and the dismissal stack is OPEN-ordered, so a layer rendered in the same
 *  commit as its parent inverts Escape with nothing to detect it. */
export function TaskTimeTrackingButton({
  lang,
  estimateMinutes,
  spentMinutes,
  remainingMinutes,
  onChange,
}: {
  lang: Lang;
  estimateMinutes: number | undefined;
  spentMinutes: number | undefined;
  remainingMinutes: number | undefined;
  onChange: (values: TimeTrackingValues) => void;
}) {
  const [open, setOpen] = useState(false);

  // WCAG 2.5.3: the name is BUILT FROM the caption the bar prints, so the
  // visible text is contained in it by construction — no call site can defeat
  // it, and no future edit can let the two drift. One string covers both
  // branches, because `effortCaption` itself reads "No estimate set" when
  // there is no estimate.
  const name = t(lang, "taskTimeTrackingButton", effortCaption(lang, estimateMinutes, spentMinutes));

  return (
    <div>
      <span className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {t(lang, "taskTimeTracking")}
      </span>
      <button
        // ★★ NOT a bare <button>: this sits inside the task <form>, where the
        // default type="submit" would save the task on every dialog open.
        type="button"
        onClick={() => setOpen(true)}
        aria-label={name}
        className={`w-full rounded-md border border-line p-2 text-left hover:bg-surface-muted ${INTERACTIVE}`}
      >
        <EffortProgressBar lang={lang} estimateMin={estimateMinutes} spentMin={spentMinutes} />
      </button>
      {open && (
        <TaskTimeTrackingModal
          open
          lang={lang}
          estimateMinutes={estimateMinutes}
          spentMinutes={spentMinutes}
          remainingMinutes={remainingMinutes}
          onSave={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
