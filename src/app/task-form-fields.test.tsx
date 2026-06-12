import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TestProviders } from "./test-providers";
import { ModalFieldControls } from "./modal-field-controls";
import { TaskFormFields } from "./task-form-fields";
import { t } from "./i18n";

function Harness() {
  return (
    <form aria-label="form">
      <TaskFormFields
        lang="en-US"
        today="2026-05-29"
        nextId={1}
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

  it("renders all 5 numbered section headings", () => {
    render(<Harness />, { wrapper: TestProviders });
    expect(screen.getByText("1. Details")).toBeTruthy();
    expect(screen.getByText("2. Scheduling")).toBeTruthy();
    expect(screen.getByText("3. Effort & Classification")).toBeTruthy();
    expect(screen.getByText("4. Relationships")).toBeTruthy();
    expect(screen.getByText("5. Status & Notes")).toBeTruthy();
  });

  it("places the Due date field within the Scheduling section", () => {
    render(<Harness />, { wrapper: TestProviders });
    const section = screen.getByText("2. Scheduling").closest("section");
    expect(section).not.toBeNull();
    expect(section!.textContent).toContain("Due date");
  });

  it("shows a per-field error (role=alert) when a field error is set and submitted", () => {
    function ErrHarness() {
      return (
        <form aria-label="form">
          <TaskFormFields
            lang="en-US" today="2026-05-29" nextId={1} contactsList={[]}
            resources={[]} onCreateResource={vi.fn(() => 1)}
            absences={[]} tasksForDeps={[]} uniqueGroups={[]} uniqueLabels={[]}
            editingIsJiraLinked={false} jiraEnabled={false}
            fieldErrors={{ taskName: "errorTaskNameRequired" }} submitted
            holidaySet={new Set()} jiraProjectKey={undefined} jiraDefaultIssueType={undefined}
            onRemoveContact={vi.fn()} onShowToast={vi.fn()} onAddAssigneeToAddressBook={vi.fn()}
          />
        </form>
      );
    }
    render(<ErrHarness />, { wrapper: TestProviders });
    expect(screen.getByRole("alert").textContent).toContain("Task name is required");
  });

  describe("field visibility", () => {
    function VisHarness() {
      return (
        <>
          <ModalFieldControls modalId="task" lang="en-US" />
          <form aria-label="form">
            <TaskFormFields
              lang="en-US" today="2026-05-29" nextId={1} contactsList={[]}
              resources={[]} onCreateResource={vi.fn(() => 1)}
              absences={[]} tasksForDeps={[]} uniqueGroups={[]} uniqueLabels={[]}
              editingIsJiraLinked={false} jiraEnabled={false}
              fieldErrors={{}} submitted={false}
              holidaySet={new Set()} jiraProjectKey={undefined} jiraDefaultIssueType={undefined}
              onRemoveContact={vi.fn()} onShowToast={vi.fn()} onAddAssigneeToAddressBook={vi.fn()}
            />
          </form>
        </>
      );
    }

    it("shows Advanced fields and hides Full-only fields by default", () => {
      render(<VisHarness />, { wrapper: TestProviders });
      // Advanced default: priority (advanced) present, email (full) absent.
      expect(screen.getByText("Priority")).toBeTruthy();
      expect(screen.queryByText("Email")).toBeNull();
    });

    it("hides advanced fields like Priority when switched to Simple, keeping Task name", async () => {
      const user = userEvent.setup();
      render(<VisHarness />, { wrapper: TestProviders });
      expect(screen.getByText("Priority")).toBeTruthy();

      await user.click(screen.getByRole("button", { name: t("en-US", "fieldViewSimple") }));

      expect(screen.queryByText("Priority")).toBeNull();
      expect(screen.getByText("Task name")).toBeTruthy();
    });
  });
});
