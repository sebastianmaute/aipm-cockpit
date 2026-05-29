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
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { AssigneeField, ModalEditFooter } from "./modal-edit-fields";
import { SegmentedControl } from "./segmented-control";
import { useDraggable } from "./use-draggable";
import { ABSENCE_TYPES, type Absence, type AbsenceType } from "./types";

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

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
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

  function handleDeleteClick() {
    if (!draft) return;
    if (window.confirm(t(lang, "absenceConfirmDelete"))) {
      onDelete(draft.id);
    }
  }

  const { offset, handleProps } = useDraggable(draft !== null);

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
      backdropClassName="bg-black/40"
      zIndex={50}
    >
      <div
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="relative flex w-[560px] min-w-[320px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={isNew ? t(lang, "absenceNewItem") : t(lang, "absenceEditItem", draft.id)}
          onClose={onClose}
          dragHandleProps={handleProps}
        />

        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2"
        >
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
          />

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "absenceStart")} *
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
            <span className="font-medium text-foreground">
              {t(lang, "absenceEnd")} *
            </span>
            <input
              type="date"
              required
              value={draft.endDate}
              onChange={(e) => update("endDate", e.target.value)}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>

          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "absenceType")}
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

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "absenceNote")}
            </span>
            <textarea
              rows={2}
              value={draft.note ?? ""}
              onChange={(e) =>
                update("note", e.target.value || undefined)
              }
              placeholder={t(lang, "absencePlaceholderNote")}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>

          {error && (
            <p className="sm:col-span-2 text-sm text-AIPM-pink">
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

/** Helper for callers that need a default empty absence to seed the modal. */
export function emptyAbsenceDraft(id: number): Absence {
  const today = isoToday();
  return {
    id,
    assignee: "",
    assigneeEmail: undefined,
    startDate: today,
    endDate: today,
    type: "vacation",
    note: undefined,
  };
}
