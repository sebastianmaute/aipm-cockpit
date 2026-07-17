import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestProviders } from "./test-providers";
import { ModalFieldControls } from "./modal-field-controls";
import { TaskFormFields } from "./task-form-fields";
import { HEALTH_CHIP_ACTIVE_CLASS } from "./task-health-chip-style";
import { SETTINGS_KEY } from "./use-settings";
import type { Resource } from "./types";
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
        onAddAssigneeToAddressBook={vi.fn()}
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
      expect(cls).not.toContain("bg-AIPM-purple");
      expect(cls).not.toContain("bg-AIPM-pink");
      expect(cls).not.toContain("bg-AIPM-green");
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

const RESOURCES = [
  { id: 5, firstName: "Alice", lastName: "Smith" },
  { id: 6, firstName: "Bob", lastName: "Jones" },
] as unknown as Resource[];

function NoteLogHarness() {
  return (
    <form aria-label="form">
      <TaskFormFields
        lang="en-US" today="2026-05-29" nextId={1} contactsList={[]}
        resources={RESOURCES} onCreateResource={vi.fn(() => 1)}
        absences={[]} tasksForDeps={[]} uniqueGroups={[]} uniqueLabels={[]}
        editingIsJiraLinked={false} jiraEnabled={false}
        fieldErrors={{}} submitted={false}
        holidaySet={new Set()} jiraProjectKey={undefined} jiraDefaultIssueType={undefined}
        onRemoveContact={vi.fn()} onAddAssigneeToAddressBook={vi.fn()}
      />
    </form>
  );
}

describe("TaskFormFields note log", () => {
  afterEach(() => window.localStorage.removeItem(SETTINGS_KEY));

  it("defaults the author to settings.selfResourceId and appends notes one per line", async () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ selfResourceId: 5 }));
    const user = userEvent.setup();
    render(<NoteLogHarness />, { wrapper: TestProviders });

    const authorSelect = screen.getByLabelText(t("en-US", "noteLogAuthor"));
    await waitFor(() => expect(authorSelect).toHaveValue("5")); // Alice, from selfResourceId

    const input = screen.getByLabelText(t("en-US", "noteLogPlaceholder"));
    await user.type(input, "Reviewed the scope");
    await user.click(screen.getByRole("button", { name: t("en-US", "noteLogAdd") }));

    const first = screen.getByRole("listitem");
    expect(first.textContent).toContain("Alice Smith");
    expect(first.textContent).toContain("Reviewed the scope");
    expect(input).toHaveValue(""); // cleared after add

    await user.type(input, "Second note");
    await user.click(screen.getByRole("button", { name: t("en-US", "noteLogAdd") }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2); // one entry per line
  });

  it("lets the author be overridden per note", async () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ selfResourceId: 5 }));
    const user = userEvent.setup();
    render(<NoteLogHarness />, { wrapper: TestProviders });

    const authorSelect = screen.getByLabelText(t("en-US", "noteLogAuthor"));
    await waitFor(() => expect(authorSelect).toHaveValue("5"));
    await user.selectOptions(authorSelect, "6"); // override to Bob

    await user.type(screen.getByLabelText(t("en-US", "noteLogPlaceholder")), "Bob note");
    await user.click(screen.getByRole("button", { name: t("en-US", "noteLogAdd") }));

    expect(screen.getByRole("listitem").textContent).toContain("Bob Jones");
  });
});
