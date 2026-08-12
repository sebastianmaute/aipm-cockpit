"use client";

// Milestone editor modal — used for create / edit / delete of project
// milestones. Draft state mirrors the `milestone` prop and resets whenever
// the prop identity changes (same pattern as absence-edit-modal).

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { EditModalShell, ModalFieldError, ModalEditFooter } from "./edit-modal-chrome";
import { Input } from "./form-controls";
import { RichTextEditor } from "./rich-text-editor";
import { capHtmlText, descriptionHtml } from "./rich-text-plain";
import { TEXTAREA_MAX } from "./sanitize";
import { appendDictationToHtml } from "./rich-text-projection";
import { useDraggable } from "./use-draggable";
import { DocumentLinksGroup } from "./knowledge-links-field-gated";
import { useModalVisibility } from "./use-modal-visibility";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { ToggleButton } from "./toggle-button";
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
      setDraft((p) => (p ? { ...p, description: appendDictationToHtml(p.description, txt) } : p)),
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
      // ★★ Same write-path cap as the RAID/change modals: without it an over-cap
      // description is persisted uncapped and only truncated on the NEXT load,
      // inside sanitizeRichText. This modal has no adjustment tracker (it never
      // had one and shows no "N fields adjusted" toast), so the cap is applied
      // silently — matching what the loader would have done anyway.
      description: capHtmlText(descriptionHtml(draft.description, "rich"), TEXTAREA_MAX) || undefined,
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
      // Opens at 1280x960 — the description RichTextEditor toolbar needs the
      // room. min stays 320/380 so a resize can still shrink it; max-h stays
      // 95vh, which correctly clamps the 960px default DOWN on a short
      // viewport (unlike min-height, `height` vs `max-height` always
      // resolves to the smaller one).
      widthClassName="w-[1280px] min-w-[320px]"
      heightClassName="h-[960px] min-h-[380px] max-h-[95vh]"
      formClassName="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5"
    >
          {/* ★★ `htmlFor` is LOAD-BEARING — the dictation mic is a real
              `<button>` ahead of the input in the caption, so an implicit
              binding named the MIC and left this required field with no
              accessible name (no aria-label, no placeholder). jsdom has no
              SpeechRecognition, so no unit test renders the mic.
              See src/test/label-binding.ts. */}
          <label htmlFor="milestone-name" className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "milestoneName")} *
              {nameMic}
            </span>
            <Input
              id="milestone-name"
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

          {/* ★★ The wrapper is a `<div>`, NOT a `<label>`. A contenteditable is
              not a labelable element, so a `<label>` here does not name the
              editor (its own `aria-label` does that) — it binds to the first
              labelable thing inside: the dictation mic when dictation is
              supported, otherwise the toolbar's Bold button. Hovering the text
              area paints whichever one it is, and a click there is forwarded to
              it. ★ The click half only bites Bold — the mic has no `onClick`
              (pointerdown/keydown only). See src/test/label-binding.ts. */}
          {isVisible("description") && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-1 font-medium text-foreground">
              {t(lang, "milestoneDescription")}
              {descriptionMic}
            </span>
            {/* focus/blur bubble from the contenteditable, registering this
                field as the active dictation target for the hold-to-talk hotkey. */}
            <div onFocus={descriptionDictationReg.onFocus} onBlur={descriptionDictationReg.onBlur}>
              {/* ★★ key={draft.id} is LOAD-BEARING. Tiptap binds `content` at
                  MOUNT only and never re-reads the prop, while this modal
                  re-seeds its draft in a render-time reconcile WITHOUT
                  unmounting — so opening milestone B while A's editor is still
                  mounted would leave A's body in the field. */}
              <RichTextEditor
                key={draft.id}
                value={descriptionHtml(draft.description, "rich")}
                onChange={(html) => update("description", html || undefined)}
                label={t(lang, "milestoneDescription")}
                lang={lang}
              />
            </div>
            {descriptionDictationStatus}
          </div>
          )}

          {isVisible("documentLinks") && (
          <DocumentLinksGroup
            value={draft.knowledgeLinks ?? []}
            onChange={(links) => update("knowledgeLinks", links)}
            lang={lang}
            // No column span here: this modal overrides `EditModalShell`'s
            // default two-column grid with a single-column flex flow, so there
            // is no second column to span.
            className="flex flex-col gap-1 text-sm"
          />
          )}

          {isVisible("achievedDate") && (
          // ★ The date is stamped inside the handler, not in the render body —
          //   `new Date()` in a component render body is a fatal `react-hooks`
          //   purity error under this repo's lint.
          <ToggleButton
            lang={lang}
            pressed={!!draft.achievedDate}
            onToggle={() =>
              update(
                "achievedDate",
                draft.achievedDate ? undefined : new Date().toISOString().slice(0, 10),
              )
            }
            className="w-fit"
          >
            {t(lang, "milestoneAchieved")}
          </ToggleButton>
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
