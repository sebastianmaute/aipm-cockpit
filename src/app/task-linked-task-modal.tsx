"use client";

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { Button } from "./button";
import { Input, Select } from "./form-controls";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { MODAL_HELP } from "./help-content";
import { ResourcePicker, type ResourcePickerValue } from "./resource-picker";
import { rowLabel } from "./row-tokens";
import { ASSIGNEE_MAX } from "./sanitize-core";
import type { Contact } from "./contacts";
import { PRIORITIES, type Priority, type Resource } from "./types";

export type LinkDirection = "predecessor" | "successor";

export interface LinkedTaskDraft {
  taskName: string;
  assignee: string;
  /** §758 — from the directory pick, as the task editor's assignee carries them; "" and null for typed text. */
  assigneeEmail: string;
  resourceId: number | null;
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
  /** §758 — the directory the assignee is picked from, as in the task editor. */
  resources: readonly Resource[];
  contacts: Contact[];
  /** Omitted (a popout), the picker offers no "+ Add as resource" row. */
  onCreateResource?: (name: string, email: string) => number;
}

/**
 * Nested "create linked task" modal, layered on top of the task editor. Rides
 * the shared `Modal` stack (topmost-only Escape closes just this one, parent
 * stays mounted). Collects a minimal child-task draft + a predecessor/successor
 * direction; the parent owns creation + link wiring. One level only (v1).
 */
export function TaskLinkedTaskModal({ lang, today, onCreate, onClose, resources, contacts, onCreateResource }: TaskLinkedTaskModalProps) {
  const [taskName, setTaskName] = useState("");
  const [assignee, setAssignee] = useState<ResourcePickerValue>({ name: "", email: "", resourceId: null });
  const [dueDate, setDueDate] = useState(today);
  const [priority, setPriority] = useState<Priority>("Medium");
  const [direction, setDirection] = useState<LinkDirection>("predecessor");

  const canSave = taskName.trim().length > 0 && dueDate.length > 0;

  const labelClass = "flex flex-col gap-1 text-xs font-medium text-muted-foreground";

  const handleSubmit = () => {
    if (!canSave) return;
    onCreate({
      taskName: taskName.trim(),
      assignee: assignee.name.trim(),
      assigneeEmail: assignee.email,
      resourceId: assignee.resourceId ?? null,
      dueDate,
      priority,
      direction,
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={t(lang, "taskEditorNewLinkedTask")}
      backdropClassName="bg-ui-dark-blue/40 overflow-y-auto"
      lang={lang}
    >
      <div
        data-modal-panel
        className="relative flex w-[440px] min-w-[320px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={t(lang, "taskEditorNewLinkedTask")}
          helpConceptId={MODAL_HELP.taskLinkedTask}
          onClose={onClose}
          // §389: this dialog is layered over the task editor, whose own ✕
          // stays bare — qualify only the topmost one so the pair's two close
          // buttons don't collide (speech input resolves "click Close" against
          // any matching control; aria-modal does not scope that channel).
          closeLabel={rowLabel(t(lang, "alertModalClose"), t(lang, "taskEditorNewLinkedTask"))}
        />
        <div className="space-y-3 p-5">
          <label className={labelClass}>
            {t(lang, "taskName")}
            <Input
              type="text"
              size="xs"
              aria-label={t(lang, "taskName")}
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              autoFocus
              className="w-full"
            />
          </label>
          {/* §758 — the task editor's picker, so a person from the directory carries their resource link and email. */}
          <div className={labelClass}>
            <span aria-hidden="true">{t(lang, "assignee")}</span>
            <ResourcePicker
              lang={lang}
              value={assignee}
              resources={resources}
              contacts={contacts}
              onChange={setAssignee}
              onCreateResource={onCreateResource}
              placeholder={t(lang, "assignee")}
              maxLength={ASSIGNEE_MAX}
              aria-label={t(lang, "assignee")}
            />
          </div>
          <div className="flex gap-3">
            <label className={`flex-1 ${labelClass}`}>
              {t(lang, "dueDate")}
              <Input
                type="date"
                size="xs"
                aria-label={t(lang, "dueDate")}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full"
              />
            </label>
            <label className={`flex-1 ${labelClass}`}>
              {t(lang, "priority")}
              <Select
                size="xs"
                aria-label={t(lang, "priority")}
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="w-full"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <label className={labelClass}>
            {t(lang, "taskLinkDirection")}
            <Select
              size="xs"
              aria-label={t(lang, "taskLinkDirection")}
              value={direction}
              onChange={(e) => setDirection(e.target.value as LinkDirection)}
              className="w-full"
            >
              <option value="predecessor">{t(lang, "taskLinkAsPredecessor")}</option>
              <option value="successor">{t(lang, "taskLinkAsSuccessor")}</option>
            </Select>
          </label>
          <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
            <Button variant="secondary" onClick={onClose}>
              {t(lang, "cancel")}
            </Button>
            <Button variant="primary" onClick={handleSubmit} disabled={!canSave}>
              {t(lang, "add")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
