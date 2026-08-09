import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TestProviders } from "./test-providers";
import { ModalFieldControls } from "./modal-field-controls";
import { TaskFormFields } from "./task-form-fields";
import { HEALTH_CHIP_ACTIVE_CLASS } from "./task-health-chip-style";
import { t } from "./i18n";
import { useTaskForm } from "./task-form-context";
import { selectFieldTier } from "../test/field-tier";
import type { TaskBudgetLink } from "./use-task-budget-link";
import type { BudgetBucket, Task } from "./types";

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

function Harness(over: { onOpenNotes?: () => void; budgetLink?: TaskBudgetLink } = {}) {
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
        budgetLink={over.budgetLink}
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

describe("TaskFormFields — budget bucket", () => {
  const BUCKETS = [{ id: 1, name: "Design" }, { id: 2, name: "Build" }] as unknown as BudgetBucket[];

  it("renders the budget-bucket select and reports the chosen id", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness budgetLink={{ buckets: BUCKETS, bucketId: 1, onChange }} />, { wrapper: TestProviders });
    await user.selectOptions(screen.getByLabelText("Budget bucket"), "2");
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("reports null when the none option is chosen", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness budgetLink={{ buckets: BUCKETS, bucketId: 1, onChange }} />, { wrapper: TestProviders });
    await user.selectOptions(screen.getByLabelText("Budget bucket"), "");
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("renders no budget field at all when no budgetLink is supplied", () => {
    render(<Harness />, { wrapper: TestProviders });
    expect(screen.queryByLabelText("Budget bucket")).toBeNull();
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

    it("hides advanced fields like Priority when switched to Simple, keeping Task name", () => {
      render(<VisHarness />, { wrapper: TestProviders });
      expect(screen.getByText("Priority")).toBeTruthy();

      // `selectFieldTier` drives the popover with `fireEvent`, not `userEvent`
      // like the rest of this file — the three-step open/pick/close sequence and
      // its close assertion live in one shared helper, and it is synchronous.
      selectFieldTier("fieldViewSimple");

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

    // The unsaved-task fallback renders no count at all (a hardcoded 0 would only
    // be true by wiring, not by construction) — label is bare "Notes log".
    const btn = screen.getByRole("button", {
      name: t("en-US", "noteLogTitle"),
    });
    await user.click(btn);
    expect(onOpenNotes).toHaveBeenCalledTimes(1);
  });
});

// ★★★ THE SEAM NOBODY ELSE WATCHES. The two `DependencyLinkGroup`s are
// identical apart from four characters: which draft slice each one READS
// (`form.dependencies` vs `form.successorLinks`) and which one it WRITES back.
// Swap either half and the successor picker becomes a second PREDECESSOR editor
// — the exact reverse of the feature — with no type error and, until this test,
// no red suite. Every neighbouring suite structurally misses it:
// `dependencies-editor.test.tsx` renders the group directly with explicit
// `links`/`onChange` props (so the wiring under test is supplied BY the test),
// `use-task-submit.test.ts` is handed a `form` object and never renders a field,
// the other `task-form-fields` tests all pass `tasksForDeps={[]}` (so no option
// is ever offered and no add can fire), and `label-binding.guard.test.ts` is a
// regex source scan. Mutation-verified in BOTH directions — a one-directional
// assertion survives the mutation aimed the other way.
describe("TaskFormFields — successor/predecessor draft wiring", () => {
  function depTask(id: number, taskName: string): Task {
    return {
      id,
      taskName,
      assignee: "",
      assigneeEmail: "",
      dueDate: "2026-01-01",
      lastUpdateDate: "2026-01-01",
      priority: "Medium",
      status: "To Do",
      blockers: "",
      description: "",
      group: "",
      labels: [],
      inquiriesSent: 0,
      createdDate: "2026-01-01",
      dependencies: [],
    } as unknown as Task;
  }

  // Distinctive names: `role="option"` also matches the type `<select>`'s
  // FS/SS/FF/SF options, so the fixture must not share words with those labels.
  const DEP_TASKS = [depTask(41, "Zeta groundwork"), depTask(42, "Omega rollout")];

  /** Renders the two draft slices under test so they can be asserted from the
   *  DOM. Pure render — no callback fired during render, which the repo's
   *  react-hooks purity rule would reject. */
  function FormProbe() {
    const { form } = useTaskForm();
    return (
      <>
        <output data-testid="probe-dependencies">{JSON.stringify(form.dependencies)}</output>
        <output data-testid="probe-successors">{JSON.stringify(form.successorLinks)}</output>
      </>
    );
  }

  function DepsHarness() {
    return (
      <>
        <FormProbe />
        <form aria-label="form">
          <TaskFormFields
            lang="en-US" today="2026-05-29" nextId={1} contactsList={[]}
            resources={[]} onCreateResource={vi.fn(() => 1)}
            absences={[]} tasksForDeps={DEP_TASKS} uniqueGroups={[]} uniqueLabels={[]}
            editingIsJiraLinked={false} jiraEnabled={false}
            fieldErrors={{}} submitted={false}
            holidaySet={new Set()} jiraProjectKey={undefined} jiraDefaultIssueType={undefined}
            onRemoveContact={vi.fn()} onAddAssigneeToAddressBook={vi.fn()}
          />
        </form>
      </>
    );
  }

  /** Type into one group's search box and click the offered task. The two
   *  comboboxes carry direction-unique accessible names, which is the only
   *  reason a single rendered modal can be driven per-direction at all. */
  async function addVia(
    user: ReturnType<typeof userEvent.setup>,
    searchLabel: string,
    optionText: string,
  ) {
    await user.type(screen.getByRole("combobox", { name: searchLabel }), optionText.slice(0, 4));
    await user.click(screen.getByRole("option", { name: new RegExp(optionText) }));
  }

  // ★★★ TWO adds, not one, and the reason is measured rather than reasoned. The
  // group's add is `onChange([...links, picked])` — it READS the slice it is
  // handed and appends. Both draft slices start EMPTY, so a single add cannot
  // tell `links={form.successorLinks}` from `links={form.dependencies}`:
  // appending to either empty array yields the same one-element result, and the
  // write-back (which is a separate prop) still lands in the right place. The
  // read-side mutation was applied and MEASURED to survive the one-add version
  // of this test. The SECOND add is what makes the read observable — by then the
  // correct slice holds an entry and the wrong one does not, so a misread drops
  // the first link instead of accumulating.
  it("routes SUCCESSOR picks to form.successorLinks and leaves form.dependencies alone", async () => {
    const user = userEvent.setup();
    render(<DepsHarness />, { wrapper: TestProviders });

    // Vacuity guard: both slices start empty, so the assertions below measure a
    // change rather than a pre-existing value.
    expect(screen.getByTestId("probe-successors").textContent).toBe("[]");
    expect(screen.getByTestId("probe-dependencies").textContent).toBe("[]");

    await addVia(user, "Search successor tasks", "Zeta groundwork");
    await addVia(user, "Search successor tasks", "Omega rollout");

    // Both links present ⇒ the group read back its OWN slice each time.
    expect(screen.getByTestId("probe-successors").textContent).toBe(
      JSON.stringify([{ taskId: 41, type: "FS" }, { taskId: 42, type: "FS" }]),
    );
    // …and the write-back never touched the predecessor slice.
    expect(screen.getByTestId("probe-dependencies").textContent).toBe("[]");
  });

  it("routes PREDECESSOR picks to form.dependencies and leaves form.successorLinks alone", async () => {
    const user = userEvent.setup();
    render(<DepsHarness />, { wrapper: TestProviders });

    expect(screen.getByTestId("probe-successors").textContent).toBe("[]");
    expect(screen.getByTestId("probe-dependencies").textContent).toBe("[]");

    await addVia(user, "Search predecessor tasks", "Omega rollout");
    await addVia(user, "Search predecessor tasks", "Zeta groundwork");

    expect(screen.getByTestId("probe-dependencies").textContent).toBe(
      JSON.stringify([{ taskId: 42, type: "FS" }, { taskId: 41, type: "FS" }]),
    );
    expect(screen.getByTestId("probe-successors").textContent).toBe("[]");
  });
});
