"use client";

import { type ReactNode, type RefObject } from "react";
import { ModalFieldControls } from "./modal-field-controls";
import { ModalHeader } from "./modal-header";
import { useDraggable } from "./use-draggable";
import { useResizable } from "./use-resizable";
import type { listContacts } from "./contacts";
import { type Lang, t } from "./i18n";
import { Button } from "./button";
import { JiraReadOnlyBanner } from "./jira-readonly-banner";
import { Modal } from "./modal";
import { useTaskForm } from "./task-form-context";
import type { Absence, Resource, Task } from "./types";
import { TaskFormFields } from "./task-form-fields";
import { type TaskFieldErrors } from "./task-validation";
import type { TaskBudgetLink } from "./use-task-budget-link";
import type { NoteLogPanelProps } from "./note-log-panel";

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
  /** Opens the shared note-log window for the edited task; absent → the in-form
   *  "Notes" button is disabled (e.g. an unsaved new task with no id). */
  onOpenNotes?: () => void;
  /** Live note-log panel for the edited task, rendered INLINE in a collapsed
   *  disclosure. Writes go STRAIGHT THROUGH to the workspace (not the form
   *  draft), so a note survives Cancel — correct for an append-only journal.
   *  Absent (an unsaved new task) → the disabled launcher button stays. */
  taskNotePanel?: NoteLogPanelProps;
  /** Budget-bucket link controls; absent when the budget module is off. */
  budgetLink?: TaskBudgetLink;
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
  onOpenNotes,
  taskNotePanel,
  budgetLink,
}: TaskFormModalProps) {
  const { editingId, taskModalOpen } = useTaskForm();
  const isEditing = editingId !== null;
  const { offset, reset: dragReset, handleProps } = useDraggable(
    taskModalOpen,
    "aipm-cockpit:modal-pos:task-form",
  );
  const { ref: sizeRef, reset: sizeReset } = useResizable("aipm-cockpit:modal-size:task-form");
  if (!taskModalOpen) return null;

  const dialogTitle = isEditing ? t(lang, "taskEditTitle") : t(lang, "tabNewTask");
  const submitLabel = isEditing ? t(lang, "updateTask") : t(lang, "addTask");
  // WCAG 2.4.6. While this modal is open over Open Points, the submit below and
  // the TWO openers behind it (the toolbar `AddButton` and the table's trailing
  // add row, both `addTaskButton`) would otherwise all be named "Add task" —
  // and the openers run `handleCancelEdit()`, which DISCARDS the in-progress
  // edit. Screen readers scope by `aria-modal`; speech input does NOT, so
  // "click Add task" mid-edit could throw the user's work away. Qualifying with
  // the dialog's own title makes the submit distinct without inventing a word:
  // every part is an existing i18n key (EN/DE parity is tsc-enforced).
  // ★ The separator is an EN DASH (U+2013), the `rowLabel` convention.
  // ★ WCAG 2.5.3 is CONTAINMENT, case-insensitive and position-independent —
  // the VISIBLE label is `submitLabel` itself, so it is contained by
  // construction in both modes and in both languages.
  const submitAriaLabel = `${submitLabel} – ${dialogTitle}`;

  return (
    <Modal
      open
      onClose={onCancel}
      // Same `dialogTitle` the submit's qualifier uses, so the dialog's own
      // accessible name and the name that disambiguates its submit cannot drift.
      ariaLabel={dialogTitle}
      backdropClassName="bg-ui-dark-blue/40 overflow-y-auto"
    >
      <div
        ref={(el) => {
          modalRef.current = el;
          sizeRef.current = el;
        }}
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        // Opens at 1280x960 — the description RichTextEditor toolbar needs
        // the room. min-w/min-h stay 460/480 so a resize can still shrink
        // it; max-w/max-h stay 95vw/95vh, which correctly clamp the
        // 1280x960 default DOWN on a smaller viewport.
        className="relative flex h-[960px] max-h-[95vh] min-h-[480px] w-[1280px] min-w-[460px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface dark:border-line dark:bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={dialogTitle}
          onClose={onCancel}
          dragHandleProps={handleProps}
          headerExtra={<ModalFieldControls modalId="task" lang={lang} />}
          onResetLayout={() => {
            dragReset();
            sizeReset();
          }}
        />
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
            onOpenNotes={onOpenNotes}
            taskNotePanel={taskNotePanel}
            budgetLink={budgetLink}
          />
          {editorExtras && (
            <div className="space-y-3 border-t border-line pt-4">{editorExtras}</div>
          )}
          <div className="flex items-center justify-between gap-2">
            <div>{deleteAction}</div>
            <div className="flex items-center gap-2">
              {leadingActions}
              <Button variant="secondary" onClick={onCancel}>
                {t(lang, "cancel")}
              </Button>
              <Button type="submit" variant="primary" disabled={saveDisabled} aria-label={submitAriaLabel}>
                {submitLabel}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
}
