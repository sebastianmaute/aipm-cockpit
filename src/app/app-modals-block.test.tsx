import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "./i18n";

// Each child is replaced by a probe that records the props it was handed, so
// these tests pin what buildAppModalsBlock passes and gates — not the children.
// vi.hoisted: the vi.mock factories below are hoisted above every import.
const { seen, probe } = vi.hoisted(() => {
  const seen: Record<string, Record<string, unknown> | undefined> = {};
  const probe = (name: string) => (props: Record<string, unknown>) => {
    seen[name] = props;
    return null;
  };
  return { seen, probe };
});
vi.mock("./app-modals", () => ({ AppModals: probe("AppModals") }));
vi.mock("./version-info", () => ({ VersionInfoModal: probe("VersionInfoModal") }));
vi.mock("./insights/recommendation-review-modal", () => ({ RecommendationReviewModal: probe("RecommendationReviewModal") }));
vi.mock("./calendar-summary-modals", () => ({ CalendarSummaryModals: probe("CalendarSummaryModals") }));
vi.mock("./comm-send-preview-modal", () => ({ CommSendPreviewModal: probe("CommSendPreviewModal") }));
vi.mock("./outlook-import-modal", () => ({ OutlookImportModal: probe("OutlookImportModal") }));
vi.mock("./outlook-calendar-import-modal", () => ({ OutlookCalendarImportModal: probe("OutlookCalendarImportModal") }));
vi.mock("./task-linked-task-modal", () => ({ TaskLinkedTaskModal: probe("TaskLinkedTaskModal") }));
vi.mock("./notes-window", () => ({ NotesWindow: probe("NotesWindow") }));
vi.mock("./blockers-window", () => ({ BlockersWindow: probe("BlockersWindow") }));
vi.mock("./raid-create-host", () => ({ RaidCreateHost: probe("RaidCreateHost") }));

import { buildAppModalsBlock, type AppModalsBlockDeps } from "./app-modals-block";

function makeDeps(overrides: Partial<AppModalsBlockDeps> = {}): AppModalsBlockDeps {
  const deps = {
    lang: "en-US",
    isPopout: false,
    settings: { jira: { enabled: true, projectKey: "PRJ", issueTypes: ["Story", "Bug"] } },
    desktopVersionRequest: { open: true, onClose: vi.fn(), logPath: "C:\\logs\\launch.log", openVersion: vi.fn() },
    commSend: { previewModal: { open: true, req: { to: "a@b.c" }, busy: false, onSend: vi.fn(), onCancel: vi.fn() } },
    reviewInsight: { recommendation: { summary: "Do the thing" } },
    reviewPlan: { calls: [] },
    confirmInsightRecommendation: vi.fn(),
    setReviewInsightId: vi.fn(),
    milestones: [], pushableRaid: [], pushableChanges: [], pushableAbsences: [],
    calendarPull: { tag: "cal" }, raidPull: { tag: "raid" }, changePull: { tag: "change" }, absencePull: { tag: "absence" },
    importOpen: true, setImportOpen: vi.fn(), importLoading: false, importError: null, importContacts: [],
    existingResourceEmails: new Set<string>(), handleConfirmOutlookImport: vi.fn(),
    calImportOpen: true, setCalImportOpen: vi.fn(), calImportLoading: false, calImportError: null, calImportEvents: [],
    calendarTarget: { assignee: "Ada" }, calendarExistingKeys: new Set<string>(), handleConfirmCalendarImport: vi.fn(),
    editorLeadingActions: "leading", editorDeleteAction: "delete", editorExtrasEl: "extras",
    editingId: null, openTaskNotes: vi.fn(), openTaskBlockers: vi.fn(),
    budgetLink: { tag: "budget-link" }, calendarTaskEnabled: true, calendarAbsenceEnabled: false,
    jiraConflicts: [], handleResolveConflicts: vi.fn(), jiraResolving: false, clearConflicts: vi.fn(),
    editingAbsence: null, absenceKnownAssignees: [], handleSaveAbsence: vi.fn(), handleDeleteAbsence: vi.fn(), handleCloseAbsenceModal: vi.fn(),
    editingCalendarEvent: null, handleSaveCalendarEvent: vi.fn(), handleDeleteCalendarEvent: vi.fn(), handleCloseCalendarEventModal: vi.fn(),
    editingShift: null, shiftExistingAssigneeKeys: new Set<string>(), handleSaveShift: vi.fn(), handleDeleteShift: vi.fn(), handleCloseShiftModal: vi.fn(),
    today: "2026-10-11", nextId: 42, contactsList: [], resources: [], handleCreateResource: vi.fn(), absences: [],
    tasks: [{ id: 1 }], uniqueGroups: [], uniqueLabels: [],
    editingIsJiraLinked: false, editingReadOnlyJiraProjectName: "Read-only project",
    fieldErrors: {}, submitted: false, saveDisabled: false, holidaySet: new Set<string>(),
    handleSubmit: vi.fn(), handleCancelEdit: vi.fn(), handleRemoveContact: vi.fn(), handleAddAssigneeToAddressBook: vi.fn(),
    editingResource: null, handleSaveResourceFromAnywhere: vi.fn(), handleDeleteResource: vi.fn(), handleCloseResourceFromAnywhere: vi.fn(),
    toast: null, pauseToast: vi.fn(), resumeToast: vi.fn(),
    linkedTaskOpen: false, setLinkedTaskOpen: vi.fn(), handleCreateLinkedTask: vi.fn(),
    notesWindowProps: { tag: "notes" }, blockersWindowProps: { tag: "blockers" },
    raidCreate: { tag: "raid-create" }, raid: [], stakeholdersEnabled: true, stakeholders: [], requestOpen: vi.fn(),
    wbsPlanModal: <div data-testid="wbs-plan-modal" />,
    ...overrides,
  };
  return deps as unknown as AppModalsBlockDeps;
}

function renderBlock(deps: AppModalsBlockDeps) {
  return render(<>{buildAppModalsBlock(deps)}</>);
}

beforeEach(() => {
  for (const k of Object.keys(seen)) delete seen[k];
});

describe("buildAppModalsBlock — lang", () => {
  // Every other fixture is en-US, so only this one can tell a passed-through
  // `lang` from a hard-coded one.
  it("hands the caller's lang to every child that takes one", () => {
    renderBlock(makeDeps({ lang: "de", linkedTaskOpen: true }));
    for (const name of ["VersionInfoModal", "RecommendationReviewModal", "CalendarSummaryModals", "OutlookImportModal", "OutlookCalendarImportModal", "AppModals", "TaskLinkedTaskModal", "RaidCreateHost"]) {
      expect(seen[name]?.lang, name).toBe("de");
    }
  });
});

describe("buildAppModalsBlock — the popout gates", () => {
  it("mounts the review modal, both windows and the RAID editor outside a popout", () => {
    const deps = makeDeps();
    renderBlock(deps);
    expect(seen.RecommendationReviewModal).toBeDefined();
    expect(seen.NotesWindow).toEqual({ tag: "notes" });
    expect(seen.BlockersWindow).toEqual({ tag: "blockers" });
    expect(seen.RaidCreateHost).toBeDefined();
    expect(seen.AppModals?.onCreateResource).toBe(deps.handleCreateResource);
    expect(seen.AppModals?.onAddAssigneeToAddressBook).toBe(deps.handleAddAssigneeToAddressBook);
  });

  it("drops them, and both address-book creators, in a popout", () => {
    renderBlock(makeDeps({ isPopout: true }));
    expect(seen.RecommendationReviewModal).toBeUndefined();
    expect(seen.NotesWindow).toBeUndefined();
    expect(seen.BlockersWindow).toBeUndefined();
    expect(seen.RaidCreateHost).toBeUndefined();
    // The modals every tree shares still mount.
    expect(seen.AppModals).toBeDefined();
    expect(seen.VersionInfoModal).toBeDefined();
    expect(seen.AppModals?.isPopout).toBe(true);
    expect("onCreateResource" in (seen.AppModals ?? {})).toBe(true);
    expect(seen.AppModals?.onCreateResource).toBeUndefined();
    expect(seen.AppModals?.onAddAssigneeToAddressBook).toBeUndefined();
  });
});

describe("buildAppModalsBlock — the optimize_wbs modal slot", () => {
  it("renders the wbs plan modal node, in the main window and in a popout", () => {
    const first = renderBlock(makeDeps());
    expect(first.getByTestId("wbs-plan-modal")).toBeTruthy();
    first.unmount();
    const second = renderBlock(makeDeps({ isPopout: true }));
    expect(second.getByTestId("wbs-plan-modal")).toBeTruthy();
  });

  it("renders nothing for a null slot", () => {
    const view = renderBlock(makeDeps({ wbsPlanModal: null }));
    expect(view.queryByTestId("wbs-plan-modal")).toBeNull();
  });
});

describe("buildAppModalsBlock — the insight recommendation review", () => {
  it("needs both a recommendation and a plan", () => {
    renderBlock(makeDeps({ reviewPlan: null } as Partial<AppModalsBlockDeps>)).unmount();
    expect(seen.RecommendationReviewModal).toBeUndefined();
    renderBlock(makeDeps({ reviewInsight: { id: "i1" } } as unknown as Partial<AppModalsBlockDeps>));
    expect(seen.RecommendationReviewModal).toBeUndefined();
  });

  it("passes the summary and plan, confirms through the hook and cancels by clearing the id", () => {
    const deps = makeDeps();
    renderBlock(deps);
    const p = seen.RecommendationReviewModal!;
    expect(p.summary).toBe("Do the thing");
    expect(p.plan).toBe(deps.reviewPlan);
    (p.onConfirm as () => void)();
    expect(deps.confirmInsightRecommendation).toHaveBeenCalledTimes(1);
    (p.onCancel as () => void)();
    expect(deps.setReviewInsightId).toHaveBeenCalledWith(null);
  });
});

describe("buildAppModalsBlock — AppModals", () => {
  it("opens notes and blockers only for an existing task, on that task's id", () => {
    renderBlock(makeDeps()).unmount();
    expect("taskOnOpenNotes" in (seen.AppModals ?? {})).toBe(true);
    expect(seen.AppModals?.taskOnOpenNotes).toBeUndefined();
    expect(seen.AppModals?.taskOnOpenBlockers).toBeUndefined();

    const deps = makeDeps({ editingId: 7 });
    renderBlock(deps);
    (seen.AppModals?.taskOnOpenNotes as () => void)();
    expect(deps.openTaskNotes).toHaveBeenCalledWith(7);
    expect(deps.openTaskBlockers).not.toHaveBeenCalled();
    (seen.AppModals?.taskOnOpenBlockers as () => void)();
    expect(deps.openTaskBlockers).toHaveBeenCalledWith(7);
  });

  it("maps task-manager's names onto the AppModals props", () => {
    const deps = makeDeps();
    renderBlock(deps);
    const p = seen.AppModals!;
    expect(p.tasksForDeps).toBe(deps.tasks);
    expect(p.taskEditorActions).toBe("leading");
    expect(p.taskDeleteAction).toBe("delete");
    expect(p.taskEditorExtras).toBe("extras");
    expect(p.budgetLink).toBe(deps.budgetLink);
    expect(p.taskCalendarSyncEnabled).toBe(true);
    expect(p.absenceCalendarSyncEnabled).toBe(false);
    expect(p.readOnlyJiraProjectName).toBe("Read-only project");
    expect(p.jiraEnabled).toBe(true);
    expect(p.jiraProjectKey).toBe("PRJ");
    expect(p.jiraDefaultIssueType).toBe("Story");
    expect(p.onSaveResource).toBe(deps.handleSaveResourceFromAnywhere);
    expect(p.onDeleteResource).toBe(deps.handleDeleteResource);
    expect(p.onCloseResourceModal).toBe(deps.handleCloseResourceFromAnywhere);
    expect(p.onToastPause).toBe(deps.pauseToast);
    expect(p.onToastResume).toBe(deps.resumeToast);
    expect(p.nextId).toBe(42);
    expect(p.handleSubmit).toBe(deps.handleSubmit);
  });
});

describe("buildAppModalsBlock — the other modals", () => {
  it("hands the Version modal the desktop request's state", () => {
    const deps = makeDeps();
    renderBlock(deps);
    expect(seen.VersionInfoModal).toMatchObject({ open: true, logPath: "C:\\logs\\launch.log" });
    expect(seen.VersionInfoModal?.onClose).toBe(deps.desktopVersionRequest.onClose);
  });

  it("hands each calendar pull to its own summary slot", () => {
    renderBlock(makeDeps());
    expect(seen.CalendarSummaryModals).toMatchObject({
      calendarPull: { tag: "cal" }, raidPull: { tag: "raid" }, changePull: { tag: "change" }, absencePull: { tag: "absence" },
    });
  });

  it("translates the comm send preview's labels and forwards its modal state", () => {
    const deps = makeDeps();
    renderBlock(deps);
    const p = seen.CommSendPreviewModal!;
    expect(p.labels).toEqual({
      title: t("en-US", "commSendPreviewTitle"),
      to: t("en-US", "commSendPreviewTo"),
      subject: t("en-US", "commSendPreviewSubject"),
      send: t("en-US", "commSendPreviewSend"),
      sending: t("en-US", "commSendPreviewSending"),
      cancel: t("en-US", "commSendPreviewCancel"),
    });
    expect(p.req).toBe(deps.commSend.previewModal.req);
    expect(p.onSend).toBe(deps.commSend.previewModal.onSend);
  });

  it("closes each Outlook import modal through its own setter", () => {
    const deps = makeDeps();
    renderBlock(deps);
    (seen.OutlookImportModal?.onClose as () => void)();
    expect(deps.setImportOpen).toHaveBeenCalledWith(false);
    expect(deps.setCalImportOpen).not.toHaveBeenCalled();
    (seen.OutlookCalendarImportModal?.onClose as () => void)();
    expect(deps.setCalImportOpen).toHaveBeenCalledWith(false);
    expect(seen.OutlookCalendarImportModal?.targetAssignee).toBe("Ada");
    expect(seen.OutlookImportModal?.existingEmails).toBe(deps.existingResourceEmails);
  });

  it("mounts the linked-task modal only while it is open, and closes it", () => {
    renderBlock(makeDeps()).unmount();
    expect(seen.TaskLinkedTaskModal).toBeUndefined();
    const deps = makeDeps({ linkedTaskOpen: true });
    renderBlock(deps);
    expect(seen.TaskLinkedTaskModal?.onCreate).toBe(deps.handleCreateLinkedTask);
    (seen.TaskLinkedTaskModal?.onClose as () => void)();
    expect(deps.setLinkedTaskOpen).toHaveBeenCalledWith(false);
  });

  it("jumps from the RAID editor to the RAID view", () => {
    const deps = makeDeps();
    renderBlock(deps);
    const p = seen.RaidCreateHost!;
    expect(p.create).toBe(deps.raidCreate);
    expect(p.contacts).toBe(deps.contactsList);
    expect(p.onCreateResource).toBe(deps.handleCreateResource);
    (p.onJumpToRaid as (id: number) => void)(5);
    expect(deps.requestOpen).toHaveBeenCalledWith("raid", 5);
  });
});
