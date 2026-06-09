import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TestProviders } from "./test-providers";
import { TaskFormFields } from "./task-form-fields";
import { type TaskFieldErrors } from "./task-validation";
import { t } from "./i18n";

const NOTES_PLACEHOLDER = t("en-US", "placeholderNotes");
const TASKNAME_PLACEHOLDER = t("en-US", "placeholderTaskName");
const TASKNAME_REQUIRED = t("en-US", "errorTaskNameRequired");

function Harness(props?: { fieldErrors?: TaskFieldErrors; submitted?: boolean }) {
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
        fieldErrors={props?.fieldErrors ?? {}}
        submitted={props?.submitted ?? false}
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

describe("TaskFormFields — per-field errors", () => {
  it("stays quiet on a pristine form (error present but field untouched)", () => {
    render(<Harness fieldErrors={{ taskName: "errorTaskNameRequired" }} />, {
      wrapper: TestProviders,
    });
    expect(screen.queryByText(TASKNAME_REQUIRED)).not.toBeInTheDocument();
  });

  it("reveals the field error once the field is blurred (touched)", () => {
    render(<Harness fieldErrors={{ taskName: "errorTaskNameRequired" }} />, {
      wrapper: TestProviders,
    });
    fireEvent.blur(screen.getByPlaceholderText(TASKNAME_PLACEHOLDER));
    expect(screen.getByText(TASKNAME_REQUIRED)).toBeInTheDocument();
  });

  it("reveals field errors after a submit attempt, even without blur", () => {
    render(<Harness fieldErrors={{ taskName: "errorTaskNameRequired" }} submitted />, {
      wrapper: TestProviders,
    });
    expect(screen.getByText(TASKNAME_REQUIRED)).toBeInTheDocument();
  });

  it("sets aria-invalid on the input while its error is shown", () => {
    render(<Harness fieldErrors={{ taskName: "errorTaskNameRequired" }} submitted />, {
      wrapper: TestProviders,
    });
    expect(screen.getByPlaceholderText(TASKNAME_PLACEHOLDER)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
