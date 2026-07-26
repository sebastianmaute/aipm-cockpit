// src/app/app-modals.test.tsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppModals, type AppModalsProps } from "./app-modals";

// Mock all child components so tests focus on conditional rendering only.
vi.mock("./task-form-modal", () => ({
  TaskFormModal: () => <div data-testid="task-form-modal" />,
}));
// Dynamic imports are intercepted by vi.mock at the module level.
vi.mock("./jira-conflicts-modal", () => ({
  JiraConflictsModal: () => <div data-testid="jira-conflicts-modal" />,
}));
vi.mock("./absence-edit-modal", () => ({
  AbsenceEditModal: () => <div data-testid="absence-edit-modal" />,
}));
vi.mock("./calendar-event-modal", () => ({
  CalendarEventModal: () => <div data-testid="calendar-event-modal" />,
}));
vi.mock("./shift-edit-modal", () => ({
  ShiftEditModal: () => <div data-testid="shift-edit-modal" />,
}));
vi.mock("./resource-edit-modal", () => ({
  ResourceEditModal: () => <div data-testid="resource-edit-modal" />,
}));
// TaskFormModal calls useTaskForm() internally; mock it.
vi.mock("./task-form-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./task-form-context")>();
  return { ...actual, useTaskForm: vi.fn() };
});
import { useTaskForm, emptyForm, emptyBulkEdit } from "./task-form-context";
import type { ConflictItem } from "./jira-api";
import type { Absence } from "./types";
import type { Shift } from "./types";
const mockUseTaskForm = useTaskForm as ReturnType<typeof vi.fn>;

function stubTaskForm() {
  mockUseTaskForm.mockReturnValue({
    form: emptyForm(), setForm: vi.fn(),
    editingId: null, setEditingId: vi.fn(),
    taskModalOpen: false, setTaskModalOpen: vi.fn(),
    bulkEdit: emptyBulkEdit(), setBulkEdit: vi.fn(),
    bulkEditOpen: false, setBulkEditOpen: vi.fn(),
  });
}

function makeProps(): AppModalsProps {
  return {
    lang: "en-US",
    isPopout: false,
    jiraConflicts: [],
    handleResolveConflicts: vi.fn(),
    clearConflicts: vi.fn(),
    editingAbsence: null,
    absenceKnownAssignees: [],
    handleSaveAbsence: vi.fn(),
    handleDeleteAbsence: vi.fn(),
    handleCloseAbsenceModal: vi.fn(),
    editingCalendarEvent: null,
    handleSaveCalendarEvent: vi.fn(),
    handleDeleteCalendarEvent: vi.fn(),
    handleCloseCalendarEventModal: vi.fn(),
    editingShift: null,
    shiftExistingAssigneeKeys: new Set(),
    handleSaveShift: vi.fn(),
    handleDeleteShift: vi.fn(),
    handleCloseShiftModal: vi.fn(),
    today: "2026-05-22",
    nextId: 1,
    contactsList: [],
    resources: [],
    onCreateResource: vi.fn(() => 1),
    absences: [],
    tasksForDeps: [],
    uniqueGroups: [],
    uniqueLabels: [],
    editingIsJiraLinked: false,
    jiraEnabled: false,
    fieldErrors: {},
    submitted: false,
    saveDisabled: false,
    holidaySet: new Set(),
    jiraProjectKey: undefined,
    jiraDefaultIssueType: undefined,
    modalRef: React.createRef<HTMLDivElement>(),
    onAddAssigneeToAddressBook: vi.fn(),
    handleSubmit: vi.fn(),
    handleCancelEdit: vi.fn(),
    handleRemoveContact: vi.fn(),
    editingResource: null,
    onSaveResource: vi.fn(),
    onDeleteResource: vi.fn(),
    onCloseResourceModal: vi.fn(),
    toast: null,
  };
}

describe("AppModals", () => {
  it("renders TaskFormModal unconditionally", () => {
    stubTaskForm();
    render(<AppModals {...makeProps()} />);
    expect(screen.getByTestId("task-form-modal")).toBeInTheDocument();
  });

  it("hides the task form modal when showTaskFormModal is false", () => {
    stubTaskForm();
    render(<AppModals {...makeProps()} showTaskFormModal={false} />);
    expect(screen.queryByTestId("task-form-modal")).toBeNull();
  });

  it("shows the task form modal by default", () => {
    stubTaskForm();
    render(<AppModals {...makeProps()} />);
    expect(screen.getByTestId("task-form-modal")).toBeInTheDocument();
  });

  it("shows JiraConflictsModal when jiraConflicts is non-empty", () => {
    stubTaskForm();
    render(<AppModals {...makeProps()} jiraConflicts={[{} as unknown as ConflictItem]} />);
    expect(screen.getByTestId("jira-conflicts-modal")).toBeInTheDocument();
  });

  it("shows AbsenceEditModal when editingAbsence is non-null", () => {
    stubTaskForm();
    render(<AppModals {...makeProps()} editingAbsence={{ absence: {} as unknown as Absence, isNew: false }} />);
    expect(screen.getByTestId("absence-edit-modal")).toBeInTheDocument();
  });

  it("shows ShiftEditModal when editingShift is non-null", () => {
    stubTaskForm();
    render(<AppModals {...makeProps()} editingShift={{ shift: {} as unknown as Shift, isNew: false }} />);
    expect(screen.getByTestId("shift-edit-modal")).toBeInTheDocument();
  });

  it("shows footer when isPopout is false, hides it when isPopout is true", () => {
    stubTaskForm();
    const { rerender } = render(<AppModals {...makeProps()} isPopout={false} />);
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    rerender(<AppModals {...makeProps()} isPopout={true} />);
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });
});
