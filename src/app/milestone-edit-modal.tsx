"use client";

// Milestone editor modal — used for create / edit / delete of project
// milestones. Draft state mirrors the `milestone` prop and resets whenever
// the prop identity changes (same pattern as absence-edit-modal).

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { EditModalShell, ModalFieldError, ModalEditFooter } from "./edit-modal-chrome";
import { Input, Textarea } from "./form-controls";
import { useDraggable } from "./use-draggable";
import { KnowledgeLinksFieldGated } from "./knowledge-links-field-gated";
import { useModalVisibility } from "./use-modal-visibility";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { useDictationMic } from "./dictation-mic";
import { appendDictation } from "./dictation-engine";
import { useSettings } from "./use-settings";
import { useConfirm } from "./confirm-dialog";
import { useDraftState } from "./use-draft-state";
import type { Milestone, Task } from "./types";

interface Props {
  lang: Lang;
  /** When null the modal is hidden. */
  milestone: Milestone | null;
  /** True when creating; false when editing an existing record. */
  isNew: boolean;
  /** All tasks available for linking. */
  tasks: readonly Task[];
  onSave: (next: Milestone) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}

export function MilestoneEditModal({
  lang,
  milestone,
  isNew,
  tasks,
  onSave,
  onDelete,
  onClose,
}: Props) {
  // Local draft mirrors the milestone prop. Reset whenever the prop changes
  // (open with a new record, or switch from one milestone to another).
  const [prev, setPrev] = useState(milestone);
  const { draft, setDraft, update, error, setError } = useDraftState<Milestone>(milestone);
  const { isVisible } = useModalVisibility("milestone");
  const { settings } = useSettings();
  const confirm = useConfirm();
  const { mic: descriptionMic, status: descriptionDictationStatus, registration: descriptionDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "milestoneDescription"),
    onAppendFinal: (txt) =>
      setDraft((p) => (p ? { ...p, description: appendDictation(p.description ?? "", txt) } : p)),
  });
  const { mic: nameMic, status: nameDictationStatus, registration: nameDictationReg } = useDictationMic({
    lang,
    dictation: settings.dictation,
    enabled: true,
    label: t(lang, "milestoneName"),
    onAppendFinal: (txt) =>
      setDraft((p) => (p ? { ...p, name: appendDictation(p.name ?? "", txt) } : p)),
  });

  if (prev !== milestone) {
    setPrev(milestone);
    setDraft(milestone);
    setError(null);
  }

  function toggleLinked(id: number) {
    setDraft((p) => {
      if (!p) return p;
      const has = p.linkedTaskIds.includes(id);
      return {
        ...p,
        linkedTaskIds: has
          ? p.linkedTaskIds.filter((x) => x !== id)
          : [...p.linkedTaskIds, id],
      };
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const name = draft.name.trim();
    const date = draft.date.trim();
    if (!name || !date) {
      setError(t(lang, "milestoneErrorRequired"));
      return;
    }
    onSave({
      ...draft,
      name,
      date,
      description: draft.description?.trim() || undefined,
    });
  }

  async function handleDeleteClick() {
    if (!draft) return;
    if (await confirm({ message: t(lang, "milestoneDeleteConfirm") })) {
      onDelete(draft.id);
    }
  }

  const { offset, reset: dragReset, handleProps } = useDraggable(
    draft !== null,
    "aipm-cockpit:modal-pos:milestone-edit",
  );

  if (!draft) return null;

  const title = isNew
    ? t(lang, "milestoneNew")
    : t(lang, "milestoneEdit", draft.id);

  return (
    <EditModalShell
      lang={lang}
      title={title}
      modalId="milestone"
      onClose={onClose}
      onSubmit={handleSubmit}
      offset={offset}
      dragHandleProps={handleProps}
      onDragReset={dragReset}
      sizeKey="aipm-cockpit:modal-size:milestone-edit"
      widthClassName="w-[560px] min-w-[320px]"
      panelClassName="max-h-[95vh]"
      formClassName="flex flex-col gap-4 overflow-y-auto p-5"
    >
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "milestoneName")} *
              {nameMic}
            </span>
            <Input
              required
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
              onFocus={nameDictationReg.onFocus}
              onBlur={nameDictationReg.onBlur}
            />
            {nameDictationStatus}
          </label>

          {isVisible("targetDate") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "milestoneDate")} *
            </span>
            <Input
              type="date"
              required
              value={draft.date}
              onChange={(e) => update("date", e.target.value)}
            />
          </label>
          )}

          {isVisible("description") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "milestoneDescription")}
              {descriptionMic}
            </span>
            <Textarea
              autoGrow
              value={draft.description ?? ""}
              onChange={(e) =>
                update("description", e.target.value || undefined)
              }
              onFocus={descriptionDictationReg.onFocus}
              onBlur={descriptionDictationReg.onBlur}
              className="min-h-16"
            />
            {descriptionDictationStatus}
          </label>
          )}

          {isVisible("documentLinks") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">{t(lang, "documents")}</span>
            <KnowledgeLinksFieldGated
              value={draft.knowledgeLinks ?? []}
              onChange={(links) => update("knowledgeLinks", links)}
              lang={lang}
            />
          </label>
          )}

          {isVisible("achievedDate") && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!draft.achievedDate}
              onChange={(e) =>
                update(
                  "achievedDate",
                  e.target.checked
                    ? new Date().toISOString().slice(0, 10)
                    : undefined,
                )
              }
              className={`${FOCUS_RING} ${TRANSITION}`}
            />
            <span className="font-medium text-foreground">
              {t(lang, "milestoneAchieved")}
            </span>
          </label>
          )}

          {isVisible("linkedTasks") && (
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="font-medium text-foreground">
              {t(lang, "milestoneLinkedTasks")}
            </legend>
            <div className="max-h-40 overflow-y-auto rounded-md border border-line p-2">
              {tasks.length === 0 ? (
                <p className="text-muted-foreground">—</p>
              ) : (
                tasks.map((tk) => (
                  <label key={tk.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.linkedTaskIds.includes(tk.id)}
                      onChange={() => toggleLinked(tk.id)}
                      className={`${FOCUS_RING} ${TRANSITION}`}
                    />
                    <span>
                      #{tk.id} {tk.taskName}
                    </span>
                  </label>
                ))
              )}
            </div>
          </fieldset>
          )}

          {error && <ModalFieldError error={error} />}

          <ModalEditFooter
            lang={lang}
            hideDelete={isNew}
            onDelete={handleDeleteClick}
            onCancel={onClose}
            saveLabelKey="milestoneSave"
          />
    </EditModalShell>
  );
}
