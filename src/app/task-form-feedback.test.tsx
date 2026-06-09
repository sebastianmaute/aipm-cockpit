import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TestProviders } from "./test-providers";
import { TaskFormFields } from "./task-form-fields";
import { t } from "./i18n";

const NOTES_PLACEHOLDER = t("en-US", "placeholderNotes");

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

describe("TaskFormFields — field feedback", () => {
  it("shows the character counter when notes is near its cap (>= 80%)", () => {
    render(<Harness />, { wrapper: TestProviders });

    const notesTextarea = screen.getByPlaceholderText(NOTES_PLACEHOLDER);
    // Type 4900 characters (4900/5000 = 98% > 80% threshold)
    fireEvent.change(notesTextarea, { target: { value: "x".repeat(4900) } });

    // CharCounter renders "{len} / {max}" — match "4900 / 5000"
    expect(screen.getByText(/4900 \/ 5000/)).toBeInTheDocument();
  });

  it("trims notes to TEXTAREA_MAX on blur when value exceeds the cap", () => {
    render(<Harness />, { wrapper: TestProviders });

    const notesTextarea = screen.getByPlaceholderText(NOTES_PLACEHOLDER);
    const overCap = "y".repeat(5100);
    fireEvent.change(notesTextarea, { target: { value: overCap } });
    fireEvent.blur(notesTextarea);

    // After blur the form state is trimmed; the textarea value reflects it
    expect((notesTextarea as HTMLTextAreaElement).value.length).toBe(5000);
  });
});
