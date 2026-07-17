"use client";

// Absence editor modal — used by the Resources panel for create / edit /
// delete. State is owned here (the draft is populated from the `absence`
// prop on open and kept locally); the parent receives the final record via
// `onSave`. Validation: assignee + start + end required, end >= start.
//
// Type uses the new `SegmentedControl`. Assignee uses a plain input with a
// HTML5 datalist autocomplete of known assignees so the user can either
// pick an existing person or type a new one.

import { useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { useAutogrow } from "./use-autogrow";
import { AssigneeField, ModalEditFooter } from "./modal-edit-fields";
import { SegmentedControl } from "./segmented-control";
import { useDraggable } from "./use-draggable";
import { useResizable } from "./use-resizable";
import { ABSENCE_TYPES, type Absence, type AbsenceType } from "./types";
import { ModalFieldControls } from "./modal-field-controls";
import { useModalVisibility } from "./use-modal-visibility";
import { InfoTooltip } from "./info-tooltip";
import { useConfirm } from "./confirm-dialog";

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
}: Props) {
  // Local draft mirrors the absence prop. Reset whenever the prop changes
  // (open with a new record, or switch from one absence to another).
  const [prevAbsence, setPrevAbsence] = useState(absence);
  const [draft, setDraft] = useState<Absence | null>(absence);
  const [error, setError] = useState<string | null>(null);

  const { isVisible } = useModalVisibility("absence");
  const confirm = useConfirm();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useAutogrow(noteRef, draft?.note ?? "");

  if (prevAbsence !== absence) {
    setPrevAbsence(absence);
    setDraft(absence);
    setError(null);
  }

  // Escape, focus management, and backdrop-click are owned by <Modal>.

  function update<K extends keyof Absence>(key: K, value: Absence[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
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
    const cleanedEmail = draft.assigneeEmail?.trim() || undefined;
    const cleanedNote = draft.note?.trim() || undefined;
    onSave({
      ...draft,
      assignee,
      assigneeEmail: cleanedEmail,
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
  const { ref: sizeRef, reset: sizeReset } = useResizable("aipm-cockpit:modal-size:absence-edit");

  if (!draft) return null;

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={
        isNew
          ? t(lang, "absenceNewItem")
          : t(lang, "absenceEditItem", draft.id)
      }
      align="center"
      zIndex={50}
    >
      <div
        ref={sizeRef}
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="relative flex max-h-[95vh] w-[560px] min-w-[320px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={isNew ? t(lang, "absenceNewItem") : t(lang, "absenceEditItem", draft.id)}
          onClose={onClose}
          dragHandleProps={handleProps}
          onResetLayout={() => {
            dragReset();
            sizeReset();
          }}
        />

        <ModalFieldControls modalId="absence" lang={lang} />

        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2"
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
          />

          {/* Start + end dates (grouped under the `dates` id). */}
          {isVisible("dates") && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="flex items-center gap-1 font-medium text-foreground">
                  {t(lang, "absenceStart")} *<InfoTooltip text={t(lang, "absenceStartHint")} />
                </span>
                <input
                  type="date"
                  required
                  value={draft.startDate}
                  onChange={(e) => update("startDate", e.target.value)}
                  className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="flex items-center gap-1 font-medium text-foreground">
                  {t(lang, "absenceEnd")} *<InfoTooltip text={t(lang, "absenceEndHint")} />
                </span>
                <input
                  type="date"
                  required
                  value={draft.endDate}
                  onChange={(e) => update("endDate", e.target.value)}
                  className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
                />
              </label>
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
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="flex items-center gap-1 font-medium text-foreground">
                {t(lang, "absenceNote")}<InfoTooltip text={t(lang, "absenceNoteHint")} />
              </span>
              <textarea
                ref={noteRef}
                rows={2}
                value={draft.note ?? ""}
                onChange={(e) =>
                  update("note", e.target.value || undefined)
                }
                placeholder={t(lang, "absencePlaceholderNote")}
                className="resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm"
              />
            </label>
          )}

          {error && (
            <p role="alert" className="sm:col-span-2 text-sm text-AIPM-pink-strong">
              {error}
            </p>
          )}

          <ModalEditFooter
            lang={lang}
            isNew={isNew}
            onDelete={handleDeleteClick}
            onClose={onClose}
            saveLabel={t(lang, "absenceSave")}
          />
        </form>
      </div>
    </Modal>
  );
}
