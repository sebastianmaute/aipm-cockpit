// src/app/app-modals-block.tsx
//
// Builds `modalsBlock`, the overlay layer every tree task-manager returns
// (classic, popout and modern) renders once: the Version modal, the insight
// recommendation review, the four calendar pull summaries, the comm send
// preview, both Outlook import modals, `AppModals` (task editor, absence,
// calendar event, shift and resource editors, Jira conflicts, toast), the new
// linked-task modal, the note-log and blocker windows and the "Log as RAID"
// editor. Extracted from task-manager (move-only, §491); it calls no hook, so it
// is a plain `build*` function, not a `use*` hook (extraction convention 1), and
// returns a fresh fragment each render, as the inline JSX was.
// ★ The popout gates moved WITH the JSX: the review modal, NotesWindow,
// BlockersWindow and RaidCreateHost render only outside a popout, and the two
// address-book creators reach AppModals as `undefined` in one.
// ★ Every deps key is REQUIRED, optional props included, so a dropped one is a
// tsc error at the call site rather than a silently missing control (the task
// editor's `budgetLink` is optional at every hop below and was lost that way).
import { isJiraOn } from "./integration-switches";
import type { ComponentProps, ReactNode } from "react";
import { t, type Lang } from "./i18n";
import type { Settings } from "./settings-types";
import { AppModals, type AppModalsProps } from "./app-modals";
import { VersionInfoModal } from "./version-info";
import { RecommendationReviewModal } from "./insights/recommendation-review-modal";
import { CalendarSummaryModals } from "./calendar-summary-modals";
import { CommSendPreviewModal } from "./comm-send-preview-modal";
import { OutlookImportModal } from "./outlook-import-modal";
import { OutlookCalendarImportModal } from "./outlook-calendar-import-modal";
import { TaskLinkedTaskModal } from "./task-linked-task-modal";
import { NotesWindow } from "./notes-window";
import { BlockersWindow } from "./blockers-window";
import { RaidCreateHost } from "./raid-create-host";
import type { useDesktopVersionRequest } from "./use-desktop-version-request";
import type { useInsightRecommendations } from "./use-insight-recommendations";
import type { useCommSend } from "./use-comm-send";
import type { useOutlookImports } from "./use-outlook-imports";

/** Every key of `T` made required, keeping `undefined` in an optional key's value. */
type AllKeys<T> = { [K in keyof Required<T>]: T[K] };

type InsightRecs = ReturnType<typeof useInsightRecommendations>;
type RaidHostProps = ComponentProps<typeof RaidCreateHost>;

/** Live render-scope values the overlay layer reads each render, under task-manager's own names. */
export type AppModalsBlockDeps = AllKeys<
  Pick<
    AppModalsProps,
    | "jiraConflicts" | "handleResolveConflicts" | "jiraResolving" | "clearConflicts"
    | "editingAbsence" | "handleSaveAbsence" | "handleDeleteAbsence" | "handleCloseAbsenceModal"
    | "editingCalendarEvent" | "handleSaveCalendarEvent" | "handleDeleteCalendarEvent" | "handleCloseCalendarEventModal"
    | "editingShift" | "shiftExistingAssigneeKeys" | "handleSaveShift" | "handleDeleteShift" | "handleCloseShiftModal"
    | "today" | "nextId" | "contactsList" | "resources" | "absences" | "uniqueGroups" | "uniqueLabels"
    | "editingIsJiraLinked" | "fieldErrors" | "submitted" | "saveDisabled" | "holidaySet"
    | "handleSubmit" | "handleCancelEdit" | "handleRemoveContact" | "budgetLink" | "editingResource" | "crossProject" | "toast"
  >
  & Pick<
    ComponentProps<typeof CalendarSummaryModals>,
    "milestones" | "pushableRaid" | "pushableChanges" | "pushableAbsences" | "calendarPull" | "raidPull" | "changePull" | "absencePull"
  >
  & Pick<
    ReturnType<typeof useOutlookImports>,
    | "importOpen" | "setImportOpen" | "importLoading" | "importError" | "importContacts"
    | "existingResourceEmails" | "handleConfirmOutlookImport"
    | "calImportOpen" | "setCalImportOpen" | "calImportLoading" | "calImportError" | "calImportEvents"
    | "calendarTarget" | "calendarExistingKeys" | "handleConfirmCalendarImport"
  >
  & Pick<InsightRecs, "reviewInsight" | "reviewPlan" | "confirmInsightRecommendation" | "setReviewInsightId">
  & Pick<RaidHostProps, "raid" | "stakeholdersEnabled" | "stakeholders">
  & {
    lang: Lang;
    isPopout: boolean;
    settings: { jira: Settings["jira"] };
    desktopVersionRequest: ReturnType<typeof useDesktopVersionRequest>;
    commSend: ReturnType<typeof useCommSend>;
    tasks: AppModalsProps["tasksForDeps"];
    editorLeadingActions: AppModalsProps["taskEditorActions"];
    editorDeleteAction: AppModalsProps["taskDeleteAction"];
    editorExtrasEl: AppModalsProps["taskEditorExtras"];
    editingId: number | null;
    openTaskNotes: (taskId: number) => void;
    openTaskBlockers: (taskId: number) => void;
    calendarTaskEnabled: boolean;
    calendarAbsenceEnabled: boolean;
    editingReadOnlyJiraProjectName: AppModalsProps["readOnlyJiraProjectName"];
    handleCreateResource: NonNullable<AppModalsProps["onCreateResource"]>;
    handleAddAssigneeToAddressBook: NonNullable<AppModalsProps["onAddAssigneeToAddressBook"]>;
    handleSaveResourceFromAnywhere: AppModalsProps["onSaveResource"];
    handleDeleteResource: AppModalsProps["onDeleteResource"];
    handleCloseResourceFromAnywhere: AppModalsProps["onCloseResourceModal"];
    pauseToast: NonNullable<AppModalsProps["onToastPause"]>;
    resumeToast: NonNullable<AppModalsProps["onToastResume"]>;
    linkedTaskOpen: boolean;
    setLinkedTaskOpen: (open: boolean) => void;
    handleCreateLinkedTask: ComponentProps<typeof TaskLinkedTaskModal>["onCreate"];
    notesWindowProps: ComponentProps<typeof NotesWindow>;
    blockersWindowProps: ComponentProps<typeof BlockersWindow>;
    raidCreate: RaidHostProps["create"];
    requestOpen: (view: "raid", id: number) => void;
    wbsPlanModal: ReactNode;
  }
>;

export function buildAppModalsBlock(deps: AppModalsBlockDeps) {
  const {
    lang, isPopout, settings, desktopVersionRequest, commSend,
    reviewInsight, reviewPlan, confirmInsightRecommendation, setReviewInsightId,
    milestones, pushableRaid, pushableChanges, pushableAbsences, calendarPull, raidPull, changePull, absencePull,
    importOpen, setImportOpen, importLoading, importError, importContacts, existingResourceEmails, handleConfirmOutlookImport,
    calImportOpen, setCalImportOpen, calImportLoading, calImportError, calImportEvents,
    calendarTarget, calendarExistingKeys, handleConfirmCalendarImport,
    editorLeadingActions, editorDeleteAction, editorExtrasEl, editingId, openTaskNotes, openTaskBlockers,
    budgetLink, calendarTaskEnabled, calendarAbsenceEnabled,
    jiraConflicts, handleResolveConflicts, jiraResolving, clearConflicts,
    editingAbsence, handleSaveAbsence, handleDeleteAbsence, handleCloseAbsenceModal,
    editingCalendarEvent, handleSaveCalendarEvent, handleDeleteCalendarEvent, handleCloseCalendarEventModal,
    editingShift, shiftExistingAssigneeKeys, handleSaveShift, handleDeleteShift, handleCloseShiftModal,
    today, nextId, contactsList, resources, handleCreateResource, absences, tasks, uniqueGroups, uniqueLabels,
    editingIsJiraLinked, editingReadOnlyJiraProjectName, fieldErrors, submitted, saveDisabled, holidaySet,
    handleSubmit, handleCancelEdit, handleRemoveContact, handleAddAssigneeToAddressBook,
    editingResource, crossProject, handleSaveResourceFromAnywhere, handleDeleteResource, handleCloseResourceFromAnywhere,
    toast, pauseToast, resumeToast,
    linkedTaskOpen, setLinkedTaskOpen, handleCreateLinkedTask, notesWindowProps, blockersWindowProps,
    raidCreate, raid, stakeholdersEnabled, stakeholders, requestOpen, wbsPlanModal,
  } = deps;
  return (
    <>
      <VersionInfoModal
        lang={lang}
        open={desktopVersionRequest.open}
        onClose={desktopVersionRequest.onClose}
        logPath={desktopVersionRequest.logPath}
      />
      {!isPopout && reviewInsight?.recommendation && reviewPlan && (
        <RecommendationReviewModal
          lang={lang}
          summary={reviewInsight.recommendation.summary}
          plan={reviewPlan}
          onConfirm={() => { void confirmInsightRecommendation(); }}
          onCancel={() => setReviewInsightId(null)}
        />
      )}
      <CalendarSummaryModals
        lang={lang}
        milestones={milestones}
        pushableRaid={pushableRaid}
        pushableChanges={pushableChanges}
        pushableAbsences={pushableAbsences}
        calendarPull={calendarPull}
        raidPull={raidPull}
        changePull={changePull}
        absencePull={absencePull}
      />
      <CommSendPreviewModal
        open={commSend.previewModal.open}
        req={commSend.previewModal.req}
        busy={commSend.previewModal.busy}
        onSend={commSend.previewModal.onSend}
        onCancel={commSend.previewModal.onCancel}
        labels={{
          title: t(lang, "commSendPreviewTitle"),
          to: t(lang, "commSendPreviewTo"),
          subject: t(lang, "commSendPreviewSubject"),
          send: t(lang, "commSendPreviewSend"),
          sending: t(lang, "commSendPreviewSending"),
          cancel: t(lang, "commSendPreviewCancel"),
        }}
      />
      <OutlookImportModal
        lang={lang}
        open={importOpen}
        loading={importLoading}
        error={importError}
        contacts={importContacts}
        existingEmails={existingResourceEmails}
        onConfirm={handleConfirmOutlookImport}
        onClose={() => setImportOpen(false)}
      />
      <OutlookCalendarImportModal
        lang={lang}
        open={calImportOpen}
        loading={calImportLoading}
        error={calImportError}
        events={calImportEvents}
        targetAssignee={calendarTarget.assignee}
        existingKeys={calendarExistingKeys}
        onConfirm={handleConfirmCalendarImport}
        onClose={() => setCalImportOpen(false)}
      />
      <AppModals
        lang={lang}
        isPopout={isPopout}
        taskEditorActions={editorLeadingActions}
        taskDeleteAction={editorDeleteAction}
        taskEditorExtras={editorExtrasEl}
        taskOnOpenNotes={editingId !== null ? () => openTaskNotes(editingId) : undefined /* existing task only; a new draft has no id to target */}
        taskOnOpenBlockers={editingId !== null ? () => openTaskBlockers(editingId) : undefined /* as notes: existing task only; a new draft has no id to target */}
        budgetLink={budgetLink}
        taskCalendarSyncEnabled={calendarTaskEnabled}
        absenceCalendarSyncEnabled={calendarAbsenceEnabled}
        jiraConflicts={jiraConflicts}
        handleResolveConflicts={handleResolveConflicts}
        jiraResolving={jiraResolving}
        clearConflicts={clearConflicts}
        editingAbsence={editingAbsence}
        handleSaveAbsence={handleSaveAbsence}
        handleDeleteAbsence={handleDeleteAbsence}
        handleCloseAbsenceModal={handleCloseAbsenceModal}
        editingCalendarEvent={editingCalendarEvent}
        handleSaveCalendarEvent={handleSaveCalendarEvent}
        handleDeleteCalendarEvent={handleDeleteCalendarEvent}
        handleCloseCalendarEventModal={handleCloseCalendarEventModal}
        editingShift={editingShift}
        shiftExistingAssigneeKeys={shiftExistingAssigneeKeys}
        handleSaveShift={handleSaveShift}
        handleDeleteShift={handleDeleteShift}
        handleCloseShiftModal={handleCloseShiftModal}
        today={today}
        nextId={nextId}
        contactsList={contactsList}
        resources={resources}
        onCreateResource={isPopout ? undefined : handleCreateResource}
        absences={absences}
        tasksForDeps={tasks}
        uniqueGroups={uniqueGroups}
        uniqueLabels={uniqueLabels}
        editingIsJiraLinked={editingIsJiraLinked}
        readOnlyJiraProjectName={editingReadOnlyJiraProjectName}
        jiraEnabled={isJiraOn(settings.jira)}
        fieldErrors={fieldErrors}
        submitted={submitted}
        saveDisabled={saveDisabled}
        holidaySet={holidaySet}
        jiraProjectKey={settings.jira.projectKey}
        jiraDefaultIssueType={settings.jira.issueTypes[0]}
        handleSubmit={handleSubmit}
        handleCancelEdit={handleCancelEdit}
        handleRemoveContact={handleRemoveContact}
        onAddAssigneeToAddressBook={isPopout ? undefined : handleAddAssigneeToAddressBook}
        editingResource={editingResource}
        crossProject={isPopout ? undefined : crossProject}
        onSaveResource={handleSaveResourceFromAnywhere}
        onDeleteResource={handleDeleteResource}
        onCloseResourceModal={handleCloseResourceFromAnywhere}
        toast={toast}
        onToastPause={pauseToast}
        onToastResume={resumeToast}
      />
      {linkedTaskOpen && (
        <TaskLinkedTaskModal
          lang={lang}
          today={today}
          onCreate={handleCreateLinkedTask}
          onClose={() => setLinkedTaskOpen(false)}
          resources={resources}
          contacts={contactsList}
          onCreateResource={isPopout ? undefined : handleCreateResource}
        />
      )}
      {!isPopout && <NotesWindow {...notesWindowProps} />}
      {!isPopout && <BlockersWindow {...blockersWindowProps} />}
      {!isPopout && (
        <RaidCreateHost
          create={raidCreate}
          lang={lang}
          tasks={tasks}
          raid={raid}
          stakeholdersEnabled={stakeholdersEnabled}
          stakeholders={stakeholders}
          resources={resources}
          contacts={contactsList}
          onCreateResource={handleCreateResource}
          onJumpToRaid={(id) => requestOpen("raid", id)}
        />
      )}
      {wbsPlanModal}
    </>
  );
}
