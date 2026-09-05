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
  it("renders a dictation mic button in the Description field label row", () => {
    render(<Harness />, { wrapper: TestProviders });
    // The mic sits in the <span> label row beside the "Description" heading.
    const descriptionLabelRow = screen.getByText("Description").closest("span");
    expect(descriptionLabelRow).not.toBeNull();
    const mics = screen.getAllByRole("button", { name: /hold to dictate/i });
    expect(mics.length).toBe(2);
    const descriptionMic = mics.find((m) => descriptionLabelRow!.contains(m));
    expect(descriptionMic).toBeDefined();
  });

  it("renders the task-name dictation mic in the field caption, above the input", () => {
    // ★ The mic no longer shares a parent with the input. It moved INTO the
    //   Field's caption via `captionAction`, which FORCES `group` mode --
    //   because a <label> with no `for` binds to its first labelable
    //   descendant, and a button is labelable, so a mic inside the default
    //   <label> branch would make clicking the words "Task name" start
    //   dictation. `task-form-layout.test.tsx` mutation-proves that forcing.
    render(<Harness />, { wrapper: TestProviders });
    const taskNameInput = screen.getByPlaceholderText("What needs to happen?");
    const group = screen.getByRole("group", { name: "Task name" });
    const mics = screen.getAllByRole("button", { name: /hold to dictate/i });
    expect(mics.length).toBe(2);
    const titleMic = mics.find((m) => group.contains(m));
    expect(titleMic).toBeDefined();
    // In the CAPTION specifically, i.e. ahead of the input -- not merely
    // somewhere inside the group.
    expect(
      titleMic!.compareDocumentPosition(taskNameInput) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // And the input keeps its own accessible name: a named role="group" does
    // NOT name its input, and an unlabeled form control is axe-critical.
    expect(screen.getByRole("textbox", { name: "Task name" })).toBeDefined();
  });

  it("caps a dictated task-name append at TASK_NAME_MAX", () => {
    mockPushToTalkCalls.length = 0;
    render(<Harness />, { wrapper: TestProviders });
    const taskNameInput = screen.getByPlaceholderText(
      "What needs to happen?",
    ) as HTMLInputElement;

    // Description's useDictationMic is wired before the title's (source order), so
    // the description usePushToTalk call is captured first and the title's second.
    expect(mockPushToTalkCalls.length).toBe(2);
    const titleAppendFinal = mockPushToTalkCalls[1].onAppendFinal;

    act(() => {
      titleAppendFinal("x".repeat(600));
    });

    expect(taskNameInput.value.length).toBe(500);
  });
});
