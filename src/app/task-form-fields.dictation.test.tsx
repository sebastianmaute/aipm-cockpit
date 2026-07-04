import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TestProviders } from "./test-providers";
import { TaskFormFields } from "./task-form-fields";

// Force the dictation mic to be "supported" so useDictationMic renders the
// button (mirrors dictation-mic.test.tsx's mock — jsdom has no
// SpeechRecognition ctor, so getCtor() is null and the button is normally
// suppressed).
vi.mock("./use-push-to-talk", () => ({
  usePushToTalk: () => ({
    listening: false,
    transcribing: false,
    supported: true,
    buttonHandlers: {},
    toggle: () => {},
    press: vi.fn(),
    release: vi.fn(),
  }),
}));

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

describe("TaskFormFields dictation", () => {
  it("renders a dictation mic button in the Notes field label row", () => {
    render(<Harness />, { wrapper: TestProviders });
    const notesLabel = screen.getByText("Notes").closest("label");
    expect(notesLabel).not.toBeNull();
    const mic = screen.getByRole("button", { name: "Hold to dictate" });
    expect(notesLabel!.contains(mic)).toBe(true);
  });
});
