"use client";

import { useState } from "react";
import { Button } from "./button";
import { derivedRemaining, effortProgress, formatDuration } from "./duration";
import { EffortField } from "./effort-field";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { ProgressTrack } from "./progress-track";

/** Qualify a control name that this dialog shares with the task form beneath it
 *  (Close, Cancel) with the dialog's own title.
 *
 *  ★ EN DASH (U+2013), not a hyphen — the same separator `rowLabel`
 *  (`row-tokens.ts`) uses for row-unique names. Composed from EXISTING i18n
 *  keys on purpose: `i18n.ts`/`i18n.de.ts` key sets must stay identical (tsc
 *  enforces it), and a new key would have to be added to both for no new words.
 *
 *  ★ WCAG 2.5.3 holds by CONSTRUCTION here: the base string is the control's
 *  own visible text, so the visible label is CONTAINED in the name (2.5.3 is
 *  containment, case-insensitive and position-independent — not a prefix rule).
 *  The ✕ has no visible text at all, so 2.5.3 does not reach it. */
function qualifyWithTitle(base: string, lang: Lang): string {
  return `${base} – ${t(lang, "taskTimeTracking")}`;
}

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
  // Unparsable text never reaches `onChange`, so a box holding "4 hours" leaves
  // the number below at its LAST valid value. Saving then reports a figure the
  // user believes they replaced — hence a real `disabled` Save while either box
  // is invalid (never `aria-disabled`, which still fires onClick).
  const [spentValid, setSpentValid] = useState(true);
  const [remainingValid, setRemainingValid] = useState(true);
  const canSave = spentValid && remainingValid;

  const { hasEstimate, pct, over } = effortProgress(estimateMinutes, spent);
  const fillPct = Math.min(pct, 1) * 100;

  const commit = () => {
    if (!canSave) return;
    // `remaining` stays UNDEFINED when the box is empty — never 0. A stored
    // zero is the different, real claim "no work left"; undefined means "not
    // overridden, follow the estimate".
    onSave({ spentMinutes: spent, remainingMinutes: remaining });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel={t(lang, "taskTimeTracking")}
      align="center"
      zIndex={50}
      // PORTALED because an ancestor panel carries a non-`none` transform,
      // which makes that panel — not the viewport — the containing block for
      // `position: fixed` descendants. Rendered in place, this dialog's
      // backdrop would be sized and offset to the task form beneath it.
      portal
    >
      <div
        className="flex w-[520px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
        // Enter in ANY input in this panel COMMITS the dialog (Jira-shaped, and
        // what `documents-rename-modal.tsx` does); `commit` is itself gated on
        // validity, so an invalid box makes Enter a plain no-op. `isComposing`
        // spares IME users, for whom Enter commits the candidate, not the field.
        //
        // ★★ THE `portal` IS WHAT KEEPS THIS OFF THE TASK FORM, not anything
        // here: portaled, these inputs are no longer DOM descendants of that
        // <form>, so they have no form owner and implicit submission cannot
        // occur (pinned by "pressing Enter in a duration box cannot submit the
        // surrounding task form", `task-time-tracking-button.test.tsx`).
        // ★★★ The dialog is STILL a REACT descendant of that form, though, and
        // synthetic events bubble the REACT tree rather than the DOM one — so
        // keydowns here DO reach its React handlers. That is harmless only
        // because its sole handler is `onSubmit` (`task-form-modal.tsx`), and
        // `submit` is a DOM event on the element the portal took these inputs
        // off. Give that form an `onKeyDown` and it WILL receive these keydowns;
        // nothing here would stop that, and a `preventDefault` would NOT either
        // — that suppresses the DEFAULT ACTION, never propagation. Only
        // `stopPropagation` would, and there is no live defect to justify one.
        //
        // ★★ SCOPED TO INPUTS, and that scoping is load-bearing: Enter on a
        // focused <button> already activates it (a browser DEFAULT ACTION, WCAG
        // 2.1.1), so an unscoped handler would fire `commit` on top of the
        // Save/Cancel/Close click. jsdom performs no such default action, so the
        // pin is that Enter on a BUTTON reaches neither `onSave` nor `onClose`.
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          if (!(e.target instanceof HTMLInputElement)) return;
          commit();
        }}
      >
        <ModalHeader
          lang={lang}
          title={t(lang, "taskTimeTracking")}
          onClose={onClose}
          // WCAG 2.4.6 / speech input. This dialog opens ON TOP of the task
          // form, which renders a Close and a Cancel of its own — and every
          // ModalHeader names its ✕ with the same shared string. Screen readers
          // scope announcements by `aria-modal`; speech input does not, so
          // "click Close" would pick one of two arbitrarily and the wrong one
          // discards the whole task edit. Qualified with the repo's en-dash
          // convention (U+2013), composed from existing keys so both
          // dictionaries stay untouched.
          closeLabel={qualifyWithTitle(t(lang, "alertModalClose"), lang)}
          // The SAME collision, one control along, and it cannot be fixed the
          // same way: `ModalHeader` renders a voice mic whenever a
          // `VoiceCommandProvider` is in scope, and that button's name is the
          // fixed, unqualified `voiceCommand` string. The provider sits above
          // BOTH layers, so stacked headers give two controls named "Voice
          // command". Suppressed here rather than qualified — a nested dialog
          // needs no second global voice trigger, and the task form's own mic
          // stays reachable underneath.
          hideVoiceCommand
        />

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
              onValidityChange={setSpentValid}
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
              onValidityChange={setRemainingValid}
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

          {/* Secondary first, primary last — the order every other modal in the
              app uses (`task-form-modal.tsx`, `documents-rename-modal.tsx`).
              This dialog shipped the other way round. */}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={onClose}
              // Same collision as the ✕ above: the task form beneath renders
              // its own unqualified Cancel.
              aria-label={qualifyWithTitle(t(lang, "cancel"), lang)}
            >
              {t(lang, "cancel")}
            </Button>
            <Button variant="primary" disabled={!canSave} onClick={commit}>
              {t(lang, "taskTimeTrackingSave")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
