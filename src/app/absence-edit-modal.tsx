"use client";

// Absence editor modal — used by the Resources panel for create / edit /
// delete. State is owned here (the draft is populated from the `absence`
// prop on open and kept locally); the parent receives the final record via
// `onSave`. Validation: assignee + start + end required, end >= start.
//
// Type uses the new `SegmentedControl`. Assignee uses a plain input with a
// HTML5 datalist autocomplete of known assignees so the user can either
// pick an existing person or type a new one.

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { clampRangeEnd } from "./date-range";
import { EditModalShell, ModalFieldError, ModalEditFooter } from "./edit-modal-chrome";
import { MODAL_HELP } from "./help-content";
import { HintedLabel, Input, Textarea } from "./form-controls";
import { AssigneeField } from "./modal-edit-fields";
import { SegmentedControl } from "./segmented-control";
import { useDraggable } from "./use-draggable";
import { ABSENCE_TYPES, type Absence, type AbsenceType } from "./types";
import { useModalVisibility } from "./use-modal-visibility";
import { InfoTooltip } from "./info-tooltip";
import { useConfirm } from "./confirm-dialog";
import { useDraftState } from "./use-draft-state";
import { CalendarOptOutCheckbox } from "./calendar-opt-out-checkbox";
import { sanitizeLoadedEmail } from "./sanitize-core";
import { EmailFieldError, emailFieldInvalid } from "./email-field-error";
import { emailFlagDescribedBy, emailFlagVisible, editorEmailRefusalMessage } from "./editor-email-rule";

interface Props {
  lang: Lang;
  /** When null the modal is hidden. */
  absence: Absence | null;
  /** True when creating; false when editing an existing record. */
  isNew: boolean;
  /** Known assignees from tasks / existing absences for the datalist. */
  knownAssignees: ReadonlyArray<{ name: string; email?: string }>;
  onSave: (next: Absence) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
  /** §486 — Outlook sync is configured for absences; shows the per-item
   *  "Sync to Outlook" checkbox. Absent/false hides it. */
  calendarSyncEnabled?: boolean;
}

const DATALIST_ID = "absence-assignee-options";

export function AbsenceEditModal({
  lang,
  absence,
  isNew,
  knownAssignees,
  onSave,
  onDelete,
  onClose,
  calendarSyncEnabled,
}: Props) {
  // Local draft mirrors the absence prop. Reset whenever the prop changes
  // (open with a new record, or switch from one absence to another).
  const [prevAbsence, setPrevAbsence] = useState(absence);
  const { draft, setDraft, update, error, setError } = useDraftState<Absence>(absence);

  const { isVisible } = useModalVisibility("absence");
  const confirm = useConfirm();

  if (prevAbsence !== absence) {
    setPrevAbsence(absence);
    setDraft(absence);
    setError(null);
  }

  // Escape, focus management, and backdrop-click are owned by <Modal>.

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const assignee = draft.assignee.trim();
    const startDate = draft.startDate.trim();
    const endDate = draft.endDate.trim();
    if (!assignee || !startDate || !endDate) {
      setError(t(lang, "absenceErrorRequired"));
      return;
    }
    if (endDate < startDate) {
      setError(t(lang, "absenceErrorEndBeforeStart"));
      return;
    }
    // The rule is the shared `emailWriteRefusal` (format + delimiter,
    // changed-only): a blank address is legal, a non-blank CHANGED one must be
    // write-safe. The AI writers refuse the same (§461). Judged (and stored,
    // below) as `cappedAssigneeEmail` — the value the write path actually
    // applies: `sanitizeLoadedEmail` (unwrap `Name <addr>`, then EMAIL_MAX) is
    // what `sanitizeAbsence`'s decode path already gives `assigneeEmail` (M-C4).
    // ★★ ONLY WHEN THE VALUE CHANGED from the one the modal opened with. The
    //  Email field is Full-tier only, so a stale malformed address stored
    //  before §461 would otherwise block saving any OTHER field at a tier
    //  where the user cannot even see it. Anything typed is still refused.
    const openedEmail = absence?.assigneeEmail?.trim() || undefined;
    const emailRefusal = editorEmailRefusalMessage(lang, cappedAssigneeEmail ?? "", openedEmail);
    if (emailRefusal) {
      setError(emailRefusal);
      return;
    }
    const cleanedNote = draft.note?.trim() || undefined;
    onSave({
      ...draft,
      assignee,
      assigneeEmail: cappedAssigneeEmail,
      startDate,
      endDate,
      note: cleanedNote,
    });
  }

  async function handleDeleteClick() {
    if (!draft) return;
    if (await confirm({ message: t(lang, "absenceConfirmDelete") })) {
      onDelete(draft.id);
    }
  }

  const { offset, reset: dragReset, handleProps } = useDraggable(
    draft !== null,
    "aipm-cockpit:modal-pos:absence-edit",
  );

  if (!draft) return null;

  // Judge (and flag) the value the write path applies: `sanitizeLoadedEmail`
  // (unwrap `Name <addr>`, then trim + EMAIL_MAX) is what `sanitizeAbsence`'s
  // decode path and the AI writers give `assigneeEmail` (M-C4). Mirrors what
  // `handleSubmit` stores.
  const cappedAssigneeEmail = sanitizeLoadedEmail(draft.assigneeEmail ?? "") || undefined;

  const title = isNew
    ? t(lang, "absenceNewItem")
    : t(lang, "absenceEditItem", draft.id);

  return (
    <EditModalShell
      lang={lang}
      title={title}
      modalId="absence"
      helpConceptId={MODAL_HELP.absenceEdit}
      onClose={onClose}
      onSubmit={handleSubmit}
      offset={offset}
      dragHandleProps={handleProps}
      onDragReset={dragReset}
      sizeKey="aipm-cockpit:modal-size:absence-edit"
      widthClassName="w-[560px] min-w-[320px]"
      /* Shorter than the shell's 720px default: ~5 rows in a two-column grid,
         so the default would open with visible dead space under the form. */
      heightClassName="h-[480px] min-h-[360px] max-h-[95vh]"
      formClassName="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2"
    >
          {/* Assignee (required) + optional email (Full-only via `email`). */}
          <AssigneeField
            datalistId={DATALIST_ID}
            assignee={draft.assignee}
            assigneeEmail={draft.assigneeEmail}
            knownAssignees={knownAssignees}
            onAssigneeChange={(name) => update("assignee", name)}
            onEmailChange={(email) => update("assigneeEmail", email)}
            assigneeLabel={t(lang, "absenceAssignee")}
            assigneeEmailLabel={t(lang, "absenceAssigneeEmail")}
            assigneePlaceholder={t(lang, "absencePlaceholderAssignee")}
            showEmail={isVisible("email")}
            tooltip={t(lang, "absenceAssigneeHint")}
            emailInvalid={emailFieldInvalid(cappedAssigneeEmail)}
            emailDescribedBy={emailFlagDescribedBy("absence-email-error", lang, cappedAssigneeEmail, error)}
          />
          {/* Steps aside ONLY while `error` (the blocking banner below) shows
              this SAME refusal message — an unrelated banner error (a blank
              assignee, end before start) must never hide it (IMPORTANT 1,
              fix round 1). */}
          {isVisible("email") && emailFlagVisible(lang, cappedAssigneeEmail, error) && (
            <div className="sm:col-span-2">
              <EmailFieldError id="absence-email-error" lang={lang} value={cappedAssigneeEmail} />
            </div>
          )}

          {/* Start + end dates (grouped under the `dates` id). */}
          {isVisible("dates") && (
            <>
              <HintedLabel
                className="text-sm"
                bodyClassName="flex flex-col gap-1"
                hint={<InfoTooltip text={t(lang, "absenceStartHint")} />}
                caption={
                  <span className="flex items-center gap-1 font-medium text-foreground">
                    {t(lang, "absenceStart")} *
                  </span>
                }
              >
                <Input
                  type="date"
                  required
                  value={draft.startDate}
                  // This field writes TWO fields from one event (start, plus
                  // the clamped end) — `update()` can only patch one — so it
                  // expands `update()`'s behavior by hand, including the
                  // `setError(null)` it would otherwise give us for free.
                  onChange={(e) => {
                    const nextStart = e.target.value;
                    setDraft((prev) =>
                      prev
                        ? { ...prev, startDate: nextStart, endDate: clampRangeEnd(nextStart, prev.endDate) }
                        : prev,
                    );
                    setError(null);
                  }}
                />
              </HintedLabel>

              {/* ★★ Hinted fields render through `HintedLabel`: the hint sits
                  OUTSIDE the naming <label> (open-followups §386). */}
              <HintedLabel
                className="text-sm"
                bodyClassName="flex flex-col gap-1"
                hint={<InfoTooltip text={t(lang, "absenceEndHint")} />}
                caption={
                  <span className="flex items-center gap-1 font-medium text-foreground">
                    {t(lang, "absenceEnd")} *
                  </span>
                }
              >
                <Input
                  type="date"
                  required
                  value={draft.endDate}
                  onChange={(e) => update("endDate", e.target.value)}
                />
              </HintedLabel>
            </>
          )}

          {isVisible("type") && (
            <div className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "absenceType")}<InfoTooltip text={t(lang, "absenceTypeHint")} />
              </span>
              <SegmentedControl<AbsenceType>
                value={draft.type}
                ariaLabel={t(lang, "absenceType")}
                options={ABSENCE_TYPES.map((tp) => ({
                  value: tp,
                  label:
                    tp === "vacation"
                      ? t(lang, "absenceTypeVacation")
                      : tp === "sick"
                        ? t(lang, "absenceTypeSick")
                        : tp === "training"
                          ? t(lang, "absenceTypeTraining")
                          : t(lang, "absenceTypeOther"),
                }))}
                onChange={(tp) => update("type", tp)}
              />
            </div>
          )}

          {isVisible("note") && (
            <HintedLabel
              className="text-sm sm:col-span-2"
              bodyClassName="flex flex-col gap-1"
              hint={<InfoTooltip text={t(lang, "absenceNoteHint")} />}
              caption={
                <span className="flex items-center gap-1 font-medium text-foreground">
                  {t(lang, "absenceNote")}
                </span>
              }
            >
              <Textarea
                autoGrow
                rows={2}
                value={draft.note ?? ""}
                onChange={(e) =>
                  update("note", e.target.value || undefined)
                }
                placeholder={t(lang, "absencePlaceholderNote")}
              />
            </HintedLabel>
          )}

          {calendarSyncEnabled && (
            <div className="sm:col-span-2">
              <CalendarOptOutCheckbox
                lang={lang}
                checked={!draft.calendarOptOut}
                itemTitle={draft.assignee}
                onChange={(syncs) => update("calendarOptOut", syncs ? undefined : true)}
              />
            </div>
          )}

          {error && <ModalFieldError error={error} />}

          <ModalEditFooter
            lang={lang}
            hideDelete={isNew}
            onDelete={handleDeleteClick}
            onCancel={onClose}
            saveLabelKey="absenceSave"
          />
    </EditModalShell>
  );
}
