"use client";

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { PRIORITIES, type Priority } from "./types";

export type LinkDirection = "predecessor" | "successor";

export interface LinkedTaskDraft {
  taskName: string;
  assignee: string;
  dueDate: string;
  priority: Priority;
  direction: LinkDirection;
}

export interface TaskLinkedTaskModalProps {
  lang: Lang;
  today: string;
  /** Called with the collected child-task draft + link direction on Save. The
   *  parent (task-manager) mints the id, creates the task, and wires the link. */
  onCreate: (draft: LinkedTaskDraft) => void;
  onClose: () => void;
}

/**
 * Nested "create linked task" modal, layered on top of the task editor. Rides
 * the shared `Modal` stack (topmost-only Escape closes just this one, parent
 * stays mounted). Collects a minimal child-task draft + a predecessor/successor
 * direction; the parent owns creation + link wiring. One level only (v1).
 */
export function TaskLinkedTaskModal({ lang, today, onCreate, onClose }: TaskLinkedTaskModalProps) {
  const [taskName, setTaskName] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState(today);
  const [priority, setPriority] = useState<Priority>("Medium");
  const [direction, setDirection] = useState<LinkDirection>("predecessor");

  const canSave = taskName.trim().length > 0 && dueDate.length > 0;

  const fieldClass = `w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground dark:border-line dark:bg-surface dark:text-foreground ${FOCUS_RING} ${TRANSITION}`;
  const labelClass = "flex flex-col gap-1 text-xs font-medium text-muted-foreground";

  const handleSubmit = () => {
    if (!canSave) return;
    onCreate({ taskName: taskName.trim(), assignee: assignee.trim(), dueDate, priority, direction });
  };

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={t(lang, "taskEditorNewLinkedTask")}
      backdropClassName="bg-AIPM-dark-blue/40 overflow-y-auto"
      lang={lang}
    >
      <div
        data-modal-panel
        className="relative flex w-[440px] min-w-[320px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader lang={lang} title={t(lang, "taskEditorNewLinkedTask")} onClose={onClose} />
        <div className="space-y-3 p-5">
          <label className={labelClass}>
            {t(lang, "taskName")}
            <input
              type="text"
              aria-label={t(lang, "taskName")}
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              autoFocus
              className={fieldClass}
            />
          </label>
          <label className={labelClass}>
            {t(lang, "assignee")}
            <input
              type="text"
              aria-label={t(lang, "assignee")}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className={fieldClass}
            />
          </label>
          <div className="flex gap-3">
            <label className={`flex-1 ${labelClass}`}>
              {t(lang, "dueDate")}
              <input
                type="date"
                aria-label={t(lang, "dueDate")}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={fieldClass}
              />
            </label>
            <label className={`flex-1 ${labelClass}`}>
              {t(lang, "priority")}
              <select
                aria-label={t(lang, "priority")}
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className={fieldClass}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={labelClass}>
            {t(lang, "taskLinkDirection")}
            <select
              aria-label={t(lang, "taskLinkDirection")}
              value={direction}
              onChange={(e) => setDirection(e.target.value as LinkDirection)}
              className={fieldClass}
            >
              <option value="predecessor">{t(lang, "taskLinkAsPredecessor")}</option>
              <option value="successor">{t(lang, "taskLinkAsSuccessor")}</option>
            </select>
          </label>
          <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
            <button
              type="button"
              onClick={onClose}
              className={`rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted dark:border-line dark:bg-surface dark:text-foreground dark:hover:bg-surface-muted ${INTERACTIVE}`}
            >
              {t(lang, "cancel")}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSave}
              className={`rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
            >
              {t(lang, "add")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
