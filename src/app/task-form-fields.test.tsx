import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TestProviders } from "./test-providers";
import { ModalFieldControls } from "./modal-field-controls";
import { TaskFormFields } from "./task-form-fields";
import { HEALTH_CHIP_ACTIVE_CLASS } from "./task-health-chip-style";
import { t } from "./i18n";

// The Description field renders a Tiptap/ProseMirror editor, which touches
// layout APIs jsdom lacks; stub them so the editor mounts (mirrors rich-text-editor.test.tsx).
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
});

function Harness(over: { onOpenNotes?: () => void } = {}) {
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
        onOpenNotes={over.onOpenNotes}
      />
    </form>
  );
}

describe("HEALTH_CHIP_ACTIVE_CLASS (manual health-override chip tint)", () => {
  it("uses canonical --rag-* tokens (R=red, A=amber, G=green), not raw brand classes", () => {
    expect(HEALTH_CHIP_ACTIVE_CLASS.R).toContain("bg-[var(--rag-red)]");
    expect(HEALTH_CHIP_ACTIVE_CLASS.A).toContain("bg-[var(--rag-amber)]");
    expect(HEALTH_CHIP_ACTIVE_CLASS.G).toContain("bg-[var(--rag-green)]");
    for (const cls of Object.values(HEALTH_CHIP_ACTIVE_CLASS)) {
      expect(cls).not.toContain("bg-ui-purple");
      expect(cls).not.toContain("bg-ui-pink");
      expect(cls).not.toContain("bg-ui-green");
    }
  });
});

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
            onRemoveContact={vi.fn()} onAddAssigneeToAddressBook={vi.fn()}
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
              onRemoveContact={vi.fn()} onAddAssigneeToAddressBook={vi.fn()}
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

describe("TaskFormFields description + notes button", () => {
  it("renders the rich Description editor (a labelled textbox)", () => {
    render(<Harness />, { wrapper: TestProviders });
    // NoteEditor mounts a contenteditable with role=textbox + aria-label "Description".
    expect(screen.getByRole("textbox", { name: "Description" })).toBeTruthy();
  });

  it("no longer renders the in-form note-log composer (author select + note input + add button)", () => {
    render(<Harness />, { wrapper: TestProviders });
    expect(screen.queryByLabelText(t("en-US", "noteLogAuthor"))).toBeNull();
    expect(screen.queryByLabelText(t("en-US", "noteLogPlaceholder"))).toBeNull();
    expect(screen.queryByRole("button", { name: t("en-US", "noteLogAdd") })).toBeNull();
  });

  it("renders a 'Notes (N)' button that opens the note-log window when clicked", async () => {
    const onOpenNotes = vi.fn();
    const user = userEvent.setup();
    render(<Harness onOpenNotes={onOpenNotes} />, { wrapper: TestProviders });

    // Label is `${noteLogTitle} (${count})` — an empty draft reads "Notes log (0)".
    const btn = screen.getByRole("button", {
      name: `${t("en-US", "noteLogTitle")} (0)`,
    });
    await user.click(btn);
    expect(onOpenNotes).toHaveBeenCalledTimes(1);
  });
});
