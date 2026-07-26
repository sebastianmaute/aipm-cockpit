"use client";

import React, { type ReactNode, type RefObject } from "react";
import { TaskFormModal } from "./task-form-modal";
import { type TaskFieldErrors } from "./task-validation";
import { JiraConflictsModal } from "./jira-conflicts-modal";
import { AbsenceEditModal } from "./absence-edit-modal";
import { CalendarEventModal } from "./calendar-event-modal";
import { ShiftEditModal } from "./shift-edit-modal";
import { ResourceEditModal } from "./resource-edit-modal";
import type { listContacts } from "./contacts";
import { t, type Lang } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { useSettings } from "./use-settings";
import { DEFAULT_FOOTER_SLOGAN } from "./settings-types";
import type { ConflictItem } from "./jira-api";
import type { ConflictResolution } from "./jira-conflicts-modal";
import type { Absence, Resource, Shift, Task } from "./types";
import type { CalendarEvent } from "./calendar-event";
import type { Toast } from "./use-toast";

export interface AppModalsProps {
  lang: Lang;
  isPopout: boolean;

  /** When false, the task form modal is not rendered (modern mode uses the
   *  full-page edit view instead). Defaults to true. */
  showTaskFormModal?: boolean;

  // Jira conflicts modal
  jiraConflicts: ConflictItem[];
  handleResolveConflicts: (resolutions: ConflictResolution[]) => void;
  clearConflicts: () => void;

  // Absence edit modal
  editingAbsence: { absence: Absence; isNew: boolean } | null;
  absenceKnownAssignees: ReadonlyArray<{ name: string; email?: string }>;
  handleSaveAbsence: (next: Absence) => void;
  handleDeleteAbsence: (id: number) => void;
  handleCloseAbsenceModal: () => void;

  // Calendar event (recurring meeting) edit modal
  editingCalendarEvent: { event: CalendarEvent; isNew: boolean } | null;
  handleSaveCalendarEvent: (event: CalendarEvent, isNew?: boolean) => void;
  handleDeleteCalendarEvent: (id: number) => void;
  handleCloseCalendarEventModal: () => void;

  // Shift edit modal
  editingShift: { shift: Shift; isNew: boolean } | null;
  shiftExistingAssigneeKeys: ReadonlySet<string>;
  handleSaveShift: (next: Shift) => void;
  handleDeleteShift: (id: number) => void;
  handleCloseShiftModal: () => void;

  // TaskFormModal props
  onAddAssigneeToAddressBook: (name: string, email: string) => void;
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
  /** When set, the task's Jira project is read-only; show a warning banner. */
  readOnlyJiraProjectName?: string;
  jiraEnabled: boolean;
  fieldErrors: TaskFieldErrors;
  submitted: boolean;
  saveDisabled: boolean;
  holidaySet: Set<string>;
  jiraProjectKey: string | undefined;
  jiraDefaultIssueType: string | undefined;
  modalRef: RefObject<HTMLDivElement | null>;
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  handleCancelEdit: () => void;
  handleRemoveContact: (name: string) => void;
  /** Editor action buttons (Send inquiry / Push to Jira) for the classic modal footer. */
  taskEditorActions?: ReactNode;
  /** Pink destructive Delete button for the left side of the classic modal footer. */
  taskDeleteAction?: ReactNode;
  /** Editor extras (create-RAID mini-form + new linked-task button) rendered below the classic modal fields. */
  taskEditorExtras?: ReactNode;
  /** Opens the shared note-log window for the currently-edited task. Provided
   *  only when editing an EXISTING task (an unsaved draft has no id to target);
   *  absent → the form's "Notes" button is disabled. */
  taskOnOpenNotes?: () => void;

  // Resource edit modal
  editingResource: { resource: Resource; isNew: boolean } | null;
  onSaveResource: (r: Resource) => void;
  onDeleteResource: (id: number) => void;
  onCloseResourceModal: () => void;

  // Toast
  toast: Toast | null;
  /** Pause auto-dismiss while the toast is hovered/focused. */
  onToastPause?: () => void;
  /** Resume auto-dismiss when the pointer/focus leaves the toast. */
  onToastResume?: () => void;
}

export function AppModals({
  lang,
  isPopout,
  showTaskFormModal = true,
  jiraConflicts,
  handleResolveConflicts,
  clearConflicts,
  editingAbsence,
  absenceKnownAssignees,
  handleSaveAbsence,
  handleDeleteAbsence,
  handleCloseAbsenceModal,
  editingCalendarEvent,
  handleSaveCalendarEvent,
  handleDeleteCalendarEvent,
  handleCloseCalendarEventModal,
  editingShift,
  shiftExistingAssigneeKeys,
  handleSaveShift,
  handleDeleteShift,
  handleCloseShiftModal,
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
  readOnlyJiraProjectName,
  jiraEnabled,
  fieldErrors,
  submitted,
  saveDisabled,
  holidaySet,
  jiraProjectKey,
  jiraDefaultIssueType,
  modalRef,
  onAddAssigneeToAddressBook,
  handleSubmit,
  handleCancelEdit,
  handleRemoveContact,
  taskEditorActions,
  taskDeleteAction,
  taskEditorExtras,
  taskOnOpenNotes,
  editingResource,
  onSaveResource,
  onDeleteResource,
  onCloseResourceModal,
  toast,
  onToastPause,
  onToastResume,
}: AppModalsProps) {
  const { settings } = useSettings();
  const footerSlogan = settings.branding?.footerSlogan?.trim() || DEFAULT_FOOTER_SLOGAN;
  return (
    <>
      {showTaskFormModal && (
        <TaskFormModal
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
          readOnlyJiraProjectName={readOnlyJiraProjectName}
          jiraEnabled={jiraEnabled}
          fieldErrors={fieldErrors}
          submitted={submitted}
          saveDisabled={saveDisabled}
          holidaySet={holidaySet}
          jiraProjectKey={jiraProjectKey}
          jiraDefaultIssueType={jiraDefaultIssueType}
          modalRef={modalRef}
          onAddAssigneeToAddressBook={onAddAssigneeToAddressBook}
          onSubmit={handleSubmit}
          onCancel={handleCancelEdit}
          onRemoveContact={handleRemoveContact}
          leadingActions={taskEditorActions}
          deleteAction={taskDeleteAction}
          editorExtras={taskEditorExtras}
          onOpenNotes={taskOnOpenNotes}
        />
      )}

      {jiraConflicts.length > 0 && (
        <JiraConflictsModal
          lang={lang}
          conflicts={jiraConflicts}
          onResolve={handleResolveConflicts}
          onClose={clearConflicts}
        />
      )}

      {editingAbsence && (
        <AbsenceEditModal
          lang={lang}
          absence={editingAbsence.absence}
          isNew={editingAbsence.isNew}
          knownAssignees={absenceKnownAssignees}
          onSave={handleSaveAbsence}
          onDelete={handleDeleteAbsence}
          onClose={handleCloseAbsenceModal}
        />
      )}

      {editingCalendarEvent && (
        <CalendarEventModal
          lang={lang}
          event={editingCalendarEvent.event}
          isNew={editingCalendarEvent.isNew}
          onSave={handleSaveCalendarEvent}
          onDelete={handleDeleteCalendarEvent}
          onClose={handleCloseCalendarEventModal}
        />
      )}

      {editingShift && (
        <ShiftEditModal
          lang={lang}
          shift={editingShift.shift}
          isNew={editingShift.isNew}
          existingAssigneeKeys={shiftExistingAssigneeKeys}
          resources={resources}
          contacts={contactsList}
          onCreateResource={onCreateResource}
          onSave={handleSaveShift}
          onDelete={handleDeleteShift}
          onClose={handleCloseShiftModal}
        />
      )}

      {editingResource && (
        <ResourceEditModal
          lang={lang}
          resource={editingResource.resource}
          isNew={editingResource.isNew}
          onSave={onSaveResource}
          onDelete={onDeleteResource}
          onClose={onCloseResourceModal}
        />
      )}

      {!isPopout && (
        // Fixed bottom-right so it adds NO document height (no page vertical
        // scrollbar) and never overlaps clickable content. The shell's pb-6
        // leaves a gap for it. pointer-events-none keeps it click-through.
        <footer className="pointer-events-none fixed bottom-0 right-0 z-0 px-4 py-1 text-right text-xs italic text-muted-foreground">
          {footerSlogan}
        </footer>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          // Hover/focus pauses the auto-dismiss timer so the reader isn't rushed.
          onMouseEnter={onToastPause}
          onMouseLeave={onToastResume}
          onFocus={onToastPause}
          onBlur={onToastResume}
          // Tinted style matching the app's inline error boxes: a colored tint +
          // left-accent border + AA-contrast accent text in both themes.
          // (white-on-pink — even on pink-strong — fails AA in dark mode.)
          className={`fixed bottom-4 right-4 z-30 max-w-md rounded-md border border-l-4 px-4 py-2.5 text-sm shadow-[var(--shadow-card)] ${
            toast.kind === "error"
              ? "border-ui-pink bg-ui-pink/10 text-ui-pink-strong dark:bg-ui-pink/15"
              : toast.kind === "success"
                ? "border-ui-green bg-ui-green/10 text-ui-green-strong dark:bg-ui-green/15"
                : "border-ui-dark-blue bg-ui-dark-blue/10 text-ui-dark-blue dark:bg-ui-dark-blue/20 dark:text-ui-light-grey"
          }`}
        >
          <div className="flex items-center gap-3">
            <span>{toast.text}</span>
            {toast.action && (
              <button
                type="button"
                onClick={toast.action.run}
                className={`shrink-0 font-medium underline underline-offset-2 ${INTERACTIVE}`}
              >
                {t(lang, toast.action.labelKey)}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
