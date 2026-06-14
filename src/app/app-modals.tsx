"use client";

import React, { type RefObject } from "react";
import { TaskFormModal } from "./task-form-modal";
import { type TaskFieldErrors } from "./task-validation";
import { JiraConflictsModal } from "./jira-conflicts-modal";
import { AbsenceEditModal } from "./absence-edit-modal";
import { ShiftEditModal } from "./shift-edit-modal";
import { ResourceEditModal } from "./resource-edit-modal";
import type { listContacts } from "./contacts";
import type { Lang } from "./i18n";
import type { ConflictItem } from "./jira-api";
import type { ConflictResolution } from "./jira-conflicts-modal";
import type { Absence, Resource, Shift, Task } from "./types";

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
  showToast: (kind: "info" | "error", text: string) => void;

  // Resource edit modal
  editingResource: { resource: Resource; isNew: boolean } | null;
  onSaveResource: (r: Resource) => void;
  onDeleteResource: (id: number) => void;
  onCloseResourceModal: () => void;

  // Toast
  toast: { kind: "info" | "error"; text: string } | null;
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
  showToast,
  editingResource,
  onSaveResource,
  onDeleteResource,
  onCloseResourceModal,
  toast,
}: AppModalsProps) {
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
          onShowToast={showToast}
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
        <footer className="mt-12 flex items-center justify-between gap-4 border-t border-line pt-6 text-xs text-muted-foreground">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/AIPM-logo.svg" alt="Acme" className="h-6 w-auto" />
          <span className="text-right italic">
            Identity Excellence Delivered. Globally.
          </span>
        </footer>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          // Bordered style: colored left-accent on a surface bg with readable
          // dark text — white-on-pink (3.76:1) failed WCAG AA at this size.
          className={`fixed bottom-4 right-4 z-30 max-w-md rounded-md border border-l-4 bg-surface px-4 py-2.5 text-sm text-foreground shadow-lg ${
            toast.kind === "error" ? "border-AIPM-pink" : "border-AIPM-dark-blue"
          }`}
        >
          {toast.text}
        </div>
      )}
    </>
  );
}
