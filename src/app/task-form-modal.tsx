"use client";

import { type ReactNode, type RefObject } from "react";
import { ModalFieldControls } from "./modal-field-controls";
import { ModalHeader } from "./modal-header";
import { useDraggable } from "./use-draggable";
import type { listContacts } from "./contacts";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { JiraReadOnlyBanner } from "./jira-readonly-banner";
import { Modal } from "./modal";
import { useTaskForm } from "./task-form-context";
import type { Absence, Resource, Task } from "./types";
import { TaskFormFields } from "./task-form-fields";
import { type TaskFieldErrors } from "./task-validation";

export interface TaskFormModalProps {
  lang: Lang;
  today: string;
  nextId: number;
  contactsList: ReturnType<typeof listContacts>;
  resources: readonly Resource[];
  onCreateResource: (name: string, email: string) => number;
  absences: readonly Absence[];
  tasksForDeps: readonly Task[];
  uniqueGroups: string[];
  uniqueLabels: string[];
  editingIsJiraLinked: boolean;
  jiraEnabled: boolean;
  fieldErrors: TaskFieldErrors;
  submitted: boolean;
  saveDisabled: boolean;
  holidaySet: Set<string>;
  jiraProjectKey: string | undefined;
  jiraDefaultIssueType: string | undefined;
  modalRef: RefObject<HTMLDivElement | null>;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onRemoveContact: (name: string) => void;
  onAddAssigneeToAddressBook: (name: string, email: string) => void;
  /** Editor action buttons (Send inquiry / Push to Jira) rendered in the footer before Cancel/Save. */
  leadingActions?: ReactNode;
  /** Destructive Delete button rendered on the left of the footer. */
  deleteAction?: ReactNode;
  /** When set, the task's Jira project is read-only; show a warning banner. */
  readOnlyJiraProjectName?: string;
  /** Editor extras rendered below the fields (create-RAID mini-form + new
   *  linked-task button). Omitted in popouts (read-only). */
  editorExtras?: ReactNode;
}

export function TaskFormModal({
  lang,
  today,
  nextId,
  contactsList,
  resources,
  onCreateResource,
  absences,
  tasksForDeps,
  uniqueGroups,
  uniqueLabels,
  editingIsJiraLinked,
  jiraEnabled,
  fieldErrors,
  submitted,
  saveDisabled,
  holidaySet,
  jiraProjectKey,
  jiraDefaultIssueType,
  modalRef,
  onSubmit,
  onCancel,
  onRemoveContact,
  onAddAssigneeToAddressBook,
  leadingActions,
  deleteAction,
  readOnlyJiraProjectName,
  editorExtras,
}: TaskFormModalProps) {
  const { editingId, taskModalOpen } = useTaskForm();
  const isEditing = editingId !== null;
  const { offset, handleProps } = useDraggable(taskModalOpen);
  if (!taskModalOpen) return null;

  return (
    <Modal
      open
      onClose={onCancel}
      ariaLabel={
        isEditing ? t(lang, "taskEditTitle") : t(lang, "tabNewTask")
      }
      backdropClassName="bg-AIPM-dark-blue/40 overflow-y-auto"
      lang={lang}
      persistKey="task-form"
    >
      <div
        ref={modalRef}
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="relative flex h-[900px] max-h-[95vh] min-h-[480px] w-[700px] min-w-[460px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface dark:border-line dark:bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={isEditing ? t(lang, "taskEditTitle") : t(lang, "tabNewTask")}
          onClose={onCancel}
          dragHandleProps={handleProps}
        />
        <div className="flex justify-end border-b border-line px-4 py-2">
          <ModalFieldControls modalId="task" lang={lang} />
        </div>
        <form
          onSubmit={onSubmit}
          className="min-h-0 flex-1 overflow-y-auto space-y-6 p-6"
        >
          {readOnlyJiraProjectName && (
            <JiraReadOnlyBanner lang={lang} projectName={readOnlyJiraProjectName} />
          )}
          <TaskFormFields
            lang={lang}
            today={today}
            nextId={nextId}
            contactsList={contactsList}
            resources={resources}
            onCreateResource={onCreateResource}
            absences={absences}
            tasksForDeps={tasksForDeps}
            uniqueGroups={uniqueGroups}
            uniqueLabels={uniqueLabels}
            editingIsJiraLinked={editingIsJiraLinked}
            jiraEnabled={jiraEnabled}
            fieldErrors={fieldErrors}
            submitted={submitted}
            holidaySet={holidaySet}
            jiraProjectKey={jiraProjectKey}
            jiraDefaultIssueType={jiraDefaultIssueType}
            onRemoveContact={onRemoveContact}
            onAddAssigneeToAddressBook={onAddAssigneeToAddressBook}
          />
          {editorExtras && (
            <div className="space-y-3 border-t border-line pt-4">{editorExtras}</div>
          )}
          <div className="flex items-center justify-between gap-2">
            <div>{deleteAction}</div>
            <div className="flex items-center gap-2">
              {leadingActions}
              <button
                type="button"
                onClick={onCancel}
                className={`rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted dark:border-line dark:bg-surface dark:text-foreground dark:hover:bg-surface-muted ${INTERACTIVE}`}
              >
                {t(lang, "cancel")}
              </button>
              <button
                type="submit"
                disabled={saveDisabled}
                className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isEditing ? t(lang, "updateTask") : t(lang, "addTask")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
}
