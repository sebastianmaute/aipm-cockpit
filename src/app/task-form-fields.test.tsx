import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TestProviders } from "./test-providers";
import { TaskFormFields } from "./task-form-fields";

function Harness() {
  return (
    <form aria-label="form">
      <TaskFormFields
        lang="en-US"
        today="2026-05-29"
        nextId={1}
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
        onRemoveContact={vi.fn()}
        onShowToast={vi.fn()}
        onAddAssigneeToAddressBook={vi.fn()}
      />
    </form>
  );
}

describe("TaskFormFields", () => {
  it("renders the core task fields", () => {
    render(<Harness />, { wrapper: TestProviders });
    expect(screen.getByText("Task name")).toBeTruthy();
    expect(screen.getByText("Assignee")).toBeTruthy();
    expect(screen.getByText("Due date")).toBeTruthy();
  });

  it("shows the error message when provided", () => {
    function ErrHarness() {
      return (
        <form aria-label="form">
          <TaskFormFields
            lang="en-US" today="2026-05-29" nextId={1} contactsList={[]}
            absences={[]} tasksForDeps={[]} uniqueGroups={[]} uniqueLabels={[]}
            editingIsJiraLinked={false} jiraEnabled={false} error="Boom"
            holidaySet={new Set()} jiraProjectKey={undefined} jiraDefaultIssueType={undefined}
            onRemoveContact={vi.fn()} onShowToast={vi.fn()} onAddAssigneeToAddressBook={vi.fn()}
          />
        </form>
      );
    }
    render(<ErrHarness />, { wrapper: TestProviders });
    expect(screen.getByRole("alert").textContent).toContain("Boom");
  });
});
