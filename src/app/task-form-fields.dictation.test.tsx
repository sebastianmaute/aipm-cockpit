import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TestProviders } from "./test-providers";
import { TaskFormFields } from "./task-form-fields";

// Force the dictation mic to be "supported" so useDictationMic renders the
// button (mirrors dictation-mic.test.tsx's mock — jsdom has no
// SpeechRecognition ctor, so getCtor() is null and the button is normally
// suppressed). Also records every call's args so a test can invoke the
// captured onAppendFinal directly, the same way a real dictation engine
// would report a finished segment.
const mockPushToTalkCalls: { onAppendFinal: (text: string) => void }[] = [];
vi.mock("./use-push-to-talk", () => ({
  usePushToTalk: (args: { onAppendFinal: (text: string) => void }) => {
    mockPushToTalkCalls.push(args);
    return {
      listening: false,
      transcribing: false,
      supported: true,
      buttonHandlers: {},
      toggle: () => {},
      press: vi.fn(),
      release: vi.fn(),
    };
  },
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
    const mics = screen.getAllByRole("button", { name: /hold to dictate/i });
    expect(mics.length).toBe(2);
    const notesMic = mics.find((m) => notesLabel!.contains(m));
    expect(notesMic).toBeDefined();
  });

  it("renders a dictation mic button next to the task-name input", () => {
    render(<Harness />, { wrapper: TestProviders });
    const taskNameInput = screen.getByPlaceholderText("What needs to happen?");
    const mics = screen.getAllByRole("button", { name: /hold to dictate/i });
    expect(mics.length).toBe(2);
    const titleMic = mics.find((m) => m.parentElement?.contains(taskNameInput));
    expect(titleMic).toBeDefined();
  });

  it("caps a dictated task-name append at TASK_NAME_MAX", () => {
    mockPushToTalkCalls.length = 0;
    render(<Harness />, { wrapper: TestProviders });
    const taskNameInput = screen.getByPlaceholderText(
      "What needs to happen?",
    ) as HTMLInputElement;

    // Notes' useDictationMic is wired before the title's (source order), so
    // the notes usePushToTalk call is captured first and the title's second.
    expect(mockPushToTalkCalls.length).toBe(2);
    const titleAppendFinal = mockPushToTalkCalls[1].onAppendFinal;

    act(() => {
      titleAppendFinal("x".repeat(600));
    });

    expect(taskNameInput.value.length).toBe(500);
  });
});
