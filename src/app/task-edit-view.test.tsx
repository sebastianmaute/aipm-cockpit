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
      absences={[]}
      tasksForDeps={[]}
      uniqueGroups={[]}
      uniqueLabels={[]}
      editingIsJiraLinked={false}
      jiraEnabled={false}
      error={null}
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
  it("renders a numbered Dark-Blue section heading", () => {
    setup();
    expect(screen.getByRole("heading", { name: /task details/i })).toBeTruthy();
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
});
