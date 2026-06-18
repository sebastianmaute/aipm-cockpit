import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TestProviders } from "./test-providers";
import { TaskEditView, TASK_EDIT_FORM_ID } from "./task-edit-view";

function setup(over: Partial<React.ComponentProps<typeof TaskEditView>> = {}) {
  const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
  render(
    <TaskEditView
      lang="en-US"
      today="2026-05-29"
      nextId={7}
      contactsList={[]}
      resources={[]}
      onCreateResource={vi.fn(() => 1)}
      absences={[]}
      tasksForDeps={[]}
      uniqueGroups={[]}
      uniqueLabels={[]}
      editingIsJiraLinked={false}
      jiraEnabled={false}
      fieldErrors={{}}
      submitted={false}
      holidaySet={new Set()}
      jiraProjectKey={undefined}
      jiraDefaultIssueType={undefined}
      onSubmit={onSubmit}
      onRemoveContact={vi.fn()}
      onShowToast={vi.fn()}
      onAddAssigneeToAddressBook={vi.fn()}
      {...over}
    />,
    { wrapper: TestProviders },
  );
  return { onSubmit };
}

describe("TaskEditView", () => {
  it("renders a footer slot at the bottom of the form", () => {
    render(
      <TaskEditView
        lang="en-US"
        today="2026-05-29"
        nextId={7}
        contactsList={[]}
        resources={[]}
        onCreateResource={vi.fn(() => 1)}
        absences={[]}
        tasksForDeps={[]}
        uniqueGroups={[]}
        uniqueLabels={[]}
        editingIsJiraLinked={false}
        jiraEnabled={false}
        fieldErrors={{}}
        submitted={false}
        holidaySet={new Set()}
        jiraProjectKey={undefined}
        jiraDefaultIssueType={undefined}
        onSubmit={() => {}}
        onRemoveContact={vi.fn()}
        onShowToast={vi.fn()}
        onAddAssigneeToAddressBook={vi.fn()}
        footer={<button type="button">FOOTER-CANCEL</button>}
      />,
      { wrapper: TestProviders },
    );
    expect(screen.getByText("FOOTER-CANCEL")).toBeInTheDocument();
    const footerEl = screen.getByText("FOOTER-CANCEL");
    expect(footerEl.closest("form")).not.toBeNull();
  });

  it("renders the numbered Details section heading", () => {
    setup();
    expect(screen.getByRole("heading", { name: "1. Details" })).toBeTruthy();
  });

  it("renders the shared task fields inside a form with the shared id", () => {
    setup();
    const form = document.getElementById(TASK_EDIT_FORM_ID);
    expect(form?.tagName).toBe("FORM");
    expect(screen.getByText("Task name")).toBeTruthy();
  });

  it("calls onSubmit when the form is submitted", () => {
    const { onSubmit } = setup();
    const form = document.getElementById(TASK_EDIT_FORM_ID) as HTMLFormElement;
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalled();
  });

  it("renders the heading top-left and a ✕ close that calls onClose", () => {
    const onClose = vi.fn();
    setup({ heading: "Edit task", onClose });
    expect(screen.getByRole("heading", { name: "Edit task" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
