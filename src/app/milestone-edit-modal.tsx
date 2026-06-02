"use client";

// Milestone editor modal — used for create / edit / delete of project
// milestones. Draft state mirrors the `milestone` prop and resets whenever
// the prop identity changes (same pattern as absence-edit-modal).

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { ModalEditFooter } from "./modal-edit-fields";
import { useDraggable } from "./use-draggable";
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
  const [draft, setDraft] = useState<Milestone | null>(milestone);
  const [error, setError] = useState<string | null>(null);

  if (prev !== milestone) {
    setPrev(milestone);
    setDraft(milestone);
    setError(null);
  }

  function update<K extends keyof Milestone>(key: K, value: Milestone[K]) {
    setDraft((p) => (p ? { ...p, [key]: value } : p));
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

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
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

  function handleDeleteClick() {
    if (!draft) return;
    if (window.confirm(t(lang, "milestoneDeleteConfirm"))) {
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
          ? t(lang, "milestoneNew")
          : t(lang, "milestoneEdit", draft.id)
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
          title={
            isNew
              ? t(lang, "milestoneNew")
              : t(lang, "milestoneEdit", draft.id)
          }
          onClose={onClose}
          dragHandleProps={handleProps}
        />

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 overflow-y-auto p-5"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "milestoneName")} *
            </span>
            <input
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "milestoneDate")} *
            </span>
            <input
              type="date"
              required
              value={draft.date}
              onChange={(e) => update("date", e.target.value)}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "milestoneDescription")}
            </span>
            <textarea
              value={draft.description ?? ""}
              onChange={(e) =>
                update("description", e.target.value || undefined)
              }
              className="min-h-16 rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>

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
            />
            <span className="font-medium text-foreground">
              {t(lang, "milestoneAchieved")}
            </span>
          </label>

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
                    />
                    <span>
                      #{tk.id} {tk.taskName}
                    </span>
                  </label>
                ))
              )}
            </div>
          </fieldset>

          {error && (
            <p className="text-sm text-AIPM-pink">{error}</p>
          )}

          <ModalEditFooter
            lang={lang}
            isNew={isNew}
            onDelete={handleDeleteClick}
            onClose={onClose}
            saveLabel={t(lang, "milestoneSave")}
          />
        </form>
      </div>
    </Modal>
  );
}
