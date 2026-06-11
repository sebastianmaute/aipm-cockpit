import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TestProviders } from "./test-providers";
import { TaskFormFields } from "./task-form-fields";
import { useTaskForm } from "./task-form-context";
import type { Resource } from "./types";

// Surfaces the live form draft's resourceId into the DOM so a test can assert
// what the assignee picker wrote back through setForm.
function DraftProbe() {
  const { form } = useTaskForm();
  return <output data-testid="resourceId">{String(form.resourceId)}</output>;
}

const Sample: Resource = {
  id: 1,
  firstName: "Sample",
  lastName: "Dummy",
  email: "Sample@x.com",
  roleId: null,
  utilizationMode: "percent",
  utilization: {},
};

function Harness({
  resources = [],
  onCreateResource = vi.fn(() => 1),
  editingIsJiraLinked = false,
}: {
  resources?: Resource[];
  onCreateResource?: (name: string, email: string) => number;
  editingIsJiraLinked?: boolean;
}) {
  return (
    <form aria-label="form">
      <TaskFormFields
        lang="en-US"
        today="2026-05-29"
        nextId={1}
        contactsList={[]}
        resources={resources}
        onCreateResource={onCreateResource}
        absences={[]}
        tasksForDeps={[]}
        uniqueGroups={[]}
        uniqueLabels={[]}
        editingIsJiraLinked={editingIsJiraLinked}
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
      <DraftProbe />
    </form>
  );
}

describe("TaskFormFields — assignee ResourcePicker integration", () => {
  it("links the draft to a resource when one is picked", () => {
    render(<Harness resources={[Sample]} />, { wrapper: TestProviders });

    // Open the assignee combobox (placeholder is the localized "Assignee").
    const combobox = screen.getByPlaceholderText("Assignee");
    fireEvent.focus(combobox);

    // Pick the suggested resource row.
    // mouseDown (not click): ResourcePicker selects on mousedown to beat the input's blur-close.
    fireEvent.mouseDown(screen.getByText("Alex Example"));

    expect(screen.getByTestId("resourceId").textContent).toBe("1");
  });

  it("creates a resource and links the draft to its id when the add row is clicked", () => {
    const onCreateResource = vi.fn(() => 42);
    render(<Harness onCreateResource={onCreateResource} />, {
      wrapper: TestProviders,
    });

    const combobox = screen.getByPlaceholderText("Assignee");
    fireEvent.focus(combobox);
    // Type a brand-new name so the "+ Add … as resource" row appears.
    fireEvent.change(combobox, { target: { value: "New Person" } });

    // The add row text is "+ Add “New Person” as resource".
    fireEvent.mouseDown(screen.getByText(/Add .*New Person.* as resource/));

    expect(onCreateResource).toHaveBeenCalledWith("New Person", "");
    expect(screen.getByTestId("resourceId").textContent).toBe("42");
  });

  it("locks the assignee picker when the task is Jira-linked", () => {
    render(<Harness resources={[Sample]} editingIsJiraLinked />, {
      wrapper: TestProviders,
    });

    const combobox = screen.getByPlaceholderText("Assignee");
    expect(combobox).toBeDisabled();

    // A disabled picker must not open its suggestion popover (a listbox of
    // resource options) on focus — Jira owns the assignee.
    fireEvent.focus(combobox);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
