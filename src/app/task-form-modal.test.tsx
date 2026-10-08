import { describe, test, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { useTaskForm, emptyForm, emptyBulkEdit } from "./task-form-context";
import { TaskFormModal } from "./task-form-modal";
import { fieldTierTrigger, selectFieldTier } from "../test/field-tier";
import { t, loadI18n } from "./i18n";
import type { BudgetBucket } from "./types";

const EN = "en-US" as const;

// ProseMirror (the note composer's lean RichTextEditor) touches layout APIs
// jsdom lacks; stub them so the editor mounts. Mirrors note-log-panel.test.tsx.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
  // userEvent's pointer press calls document.elementFromPoint (absent in jsdom).
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
});

// ModalFieldControls (rendered in the modal header) reads field visibility from
// the workspace, so renders need a WorkspaceProvider. useTaskForm stays mocked.
function Providers({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

// Mock M365 hooks consumed by KnowledgeLinksFieldGated — default: SharePoint off.
vi.mock("./use-settings", () => ({
  useSettings: () => ({ settings: { integrations: { m365: { enabled: false, sharepoint: false } } } }),
}));
vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({ account: null, ready: true, signIn: vi.fn(), signOut: vi.fn(), acquireToken: vi.fn() }),
}));

// Mock useTaskForm so tests can seed form state without a real context provider.
// vi.mock is hoisted by Vitest, so this applies to the entire file.
vi.mock("./task-form-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./task-form-context")>();
  return { ...actual, useTaskForm: vi.fn() };
});
const mockUseTaskForm = useTaskForm as ReturnType<typeof vi.fn>;

function stubTaskForm(
  overrides?: Partial<ReturnType<typeof emptyForm>>,
  taskModalOpen = true,
) {
  mockUseTaskForm.mockReturnValue({
    form: { ...emptyForm(), assignee: "Nora Ito", assigneeEmail: "nora@x.com", ...overrides },
    setForm: vi.fn(),
    editingId: null,
    setEditingId: vi.fn(),
    taskModalOpen,
    setTaskModalOpen: vi.fn(),
    bulkEdit: emptyBulkEdit(),
    setBulkEdit: vi.fn(),
    bulkEditOpen: false,
    setBulkEditOpen: vi.fn(),
  });
}

function defaultProps(overrides?: Partial<Parameters<typeof TaskFormModal>[0]>) {
  return {
    lang: "en-US" as const,
    today: "2026-05-25",
    nextId: 1,
    contactsList: [],
    resources: [],
    onCreateResource: vi.fn(() => 1),
    absences: [],
    tasksForDeps: [],
    uniqueGroups: [],
    uniqueLabels: [],
    editingIsJiraLinked: false,
    jiraEnabled: false,
    fieldErrors: {},
    submitted: false,
    saveDisabled: false,
    holidaySet: new Set<string>(),
    jiraProjectKey: undefined,
    jiraDefaultIssueType: undefined,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    onRemoveContact: vi.fn(),
    onAddAssigneeToAddressBook: vi.fn(),
    ...overrides,
  };
}

describe("TaskFormModal", () => {
  beforeEach(() => {
    stubTaskForm();
  });

  test("renders nothing when taskModalOpen is false", () => {
    stubTaskForm(undefined, false);
    const { container } = render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    expect(container.querySelector("form")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  test("renders header and form when modal is open", () => {
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
    expect(document.querySelector("form")).not.toBeNull();
  });

  test("close button fires onCancel exactly once", () => {
    const props = defaultProps();
    render(<TaskFormModal {...props} />, { wrapper: Providers });
    // The header close button carries aria-label t(lang, "alertModalClose").
    const closeButton = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-label") === "Close");
    expect(closeButton).toBeDefined();
    closeButton!.click();
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  test("submitting the form fires onSubmit", () => {
    const props = defaultProps();
    render(<TaskFormModal {...props} />, { wrapper: Providers });
    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  test("renders all 5 numbered section headings (parity with edit view)", () => {
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    expect(screen.getByText("1. Details")).toBeInTheDocument();
    expect(screen.getByText("2. Scheduling")).toBeInTheDocument();
    expect(screen.getByText("3. Status & Notes")).toBeInTheDocument();
    expect(screen.getByText("4. Effort & Classification")).toBeInTheDocument();
    expect(screen.getByText("5. Relationships")).toBeInTheDocument();
  });

  test("shows 'Edit task' heading when editing an existing task", () => {
    mockUseTaskForm.mockReturnValue({
      form: { ...emptyForm() },
      setForm: vi.fn(),
      editingId: 42,
      setEditingId: vi.fn(),
      taskModalOpen: true,
      setTaskModalOpen: vi.fn(),
      bulkEdit: emptyBulkEdit(),
      setBulkEdit: vi.fn(),
      bulkEditOpen: false,
      setBulkEditOpen: vi.fn(),
    });
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Edit task");
  });

  test("has a close button in the header", () => {
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    const closeButton = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-label") === "Close");
    expect(closeButton).toBeDefined();
  });

  test("mounts the field-visibility trigger inside the modal header", () => {
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    const trigger = fieldTierTrigger(EN);
    // PLACEMENT, not presence — see edit-modal-chrome.test.tsx.
    expect(trigger.closest("header")).not.toBeNull();
  });
});

describe("TaskFormModal — a stored or copied unsafe email is flagged, not blocked (pre-flight I7)", () => {
  it("shows the non-blocking flag for an unsafe value", () => {
    stubTaskForm({ assigneeEmail: "a,b@x.com" });
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    selectFieldTier("fieldViewFull", EN);
    expect(screen.getByText(t(EN, "errorEmailDelimiter"))).toBeInTheDocument();
    expect(screen.getByDisplayValue("a,b@x.com")).toHaveAttribute("aria-invalid", "true");
  });

  it("positive control: no flag for a clean value", () => {
    stubTaskForm({ assigneeEmail: "nora@x.com" });
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    selectFieldTier("fieldViewFull", EN);
    expect(screen.getByDisplayValue("nora@x.com")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(t(EN, "errorEmailDelimiter"))).toBeNull();
  });
});

describe("TaskFormModal — cancel in create mode", () => {
  beforeEach(() => {
    stubTaskForm();
  });

  it("shows Cancel in create mode too", () => {
    // editingId is null in stubTaskForm, so isEditing=false
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    expect(screen.getByRole("button", { name: /cancel|abbrechen/i })).toBeInTheDocument();
    // ★★ FULLY anchored, and both anchors are load-bearing. `InfoTooltip`
    // renders `role="button"` with its whole hint sentence as the accessible
    // name, and the Successors hint now begins "Add tasks that cannot start…"
    // — so the old unanchored /add task/i matched TWO elements and this query
    // threw. A leading `^` alone does not fix it either, since that sentence
    // also STARTS with "Add task". Matches the submit label and nothing else.
    // ★★ The submit now carries a QUALIFIED `aria-label` ("Add task – New
    // task"), so the trailing `$` must sit after the qualifier, not after the
    // verb. Composed from the same i18n keys the component uses rather than
    // hardcoded, so a DE run resolves too.
    expect(
      screen.getByRole("button", {
        name: `${t(EN, "addTask")} – ${t(EN, "tabNewTask")}`,
      }),
    ).toBeInTheDocument();
  });
});

describe("TaskFormModal — submit name does not collide with the editor openers", () => {
  // WCAG 2.4.6. The Open Points pane renders THREE openers (the toolbar
  // `AddButton` in tasks-section-toolbar.tsx, the table's trailing add row in
  // tasks-section-rows.tsx, and the empty-state box), all named from
  // `addTaskButton` and ALL discarding the in-progress edit through the
  // orchestrator's `openTaskEditor` (`handleCancelEdit()`). The submit
  // sits over them in the same accessibility tree; speech input does not scope
  // by `aria-modal`. So the submit's name must differ from theirs.
  const openerName = t(EN, "addTaskButton");

  it("qualifies the CREATE-mode submit so it differs from the openers, still containing the visible label", () => {
    stubTaskForm();
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    // ★★ SCOPED TO THE <form>, and the scope is what makes the regex usable.
    // The ModalHeader now renders a help icon named "Help – <dialog title>"
    // (`MODAL_HELP.taskForm`), so a SCREEN-level /new task$/i matches it too
    // and the query throws. Scoping rather than switching to the submit's exact
    // composed name is deliberate: selecting by the full name would make the
    // `not.toBe(openerName)` assertion below a restatement of the selector,
    // and that assertion is the point of this test. The header sits outside
    // the form, so the form scope excludes the help icon by construction.
    const forms = document.querySelectorAll("form");
    expect(forms).toHaveLength(1);
    const submit = within(forms[0] as HTMLElement).getByRole("button", { name: /new task$/i });
    expect(submit).toHaveAttribute("type", "submit");
    const name = submit.getAttribute("aria-label")!;
    expect(name).not.toBe(openerName);
    // WCAG 2.5.3 is CONTAINMENT (case-insensitive, position-independent).
    expect(name.toLowerCase()).toContain(submit.textContent!.trim().toLowerCase());
    // And nothing in the modal is left wearing the openers' bare name.
    expect(screen.queryAllByRole("button", { name: openerName })).toHaveLength(0);
  });

  it("qualifies the EDIT-mode submit the same way", () => {
    mockUseTaskForm.mockReturnValue({
      form: { ...emptyForm() },
      setForm: vi.fn(),
      editingId: 42,
      setEditingId: vi.fn(),
      taskModalOpen: true,
      setTaskModalOpen: vi.fn(),
      bulkEdit: emptyBulkEdit(),
      setBulkEdit: vi.fn(),
      bulkEditOpen: false,
      setBulkEditOpen: vi.fn(),
    });
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    const submit = screen.getByRole("button", {
      name: `${t(EN, "updateTask")} – ${t(EN, "taskEditTitle")}`,
    });
    expect(submit).toHaveAttribute("type", "submit");
    expect(submit.getAttribute("aria-label")).not.toBe(openerName);
    expect(submit.textContent!.trim()).toBe(t(EN, "updateTask"));
  });

  it("qualifies the submit in DE too, and keeps the visible German label contained", async () => {
    // The two openers and this submit are byte-identical in DE as well
    // ("Aufgabe hinzufügen"), so the DE branch needs its own pin.
    await loadI18n("de");
    stubTaskForm();
    render(<TaskFormModal {...defaultProps({ lang: "de" })} />, { wrapper: Providers });
    const submit = screen.getByRole("button", {
      name: `${t("de", "addTask")} – ${t("de", "tabNewTask")}`,
    });
    const name = submit.getAttribute("aria-label")!;
    expect(name).not.toBe(t("de", "addTaskButton"));
    expect(name.toLowerCase()).toContain(submit.textContent!.trim().toLowerCase());
  });
});

describe("TaskFormModal — add-to-address-book button", () => {
  beforeEach(() => {
    stubTaskForm();
  });

  it("fires onAddAssigneeToAddressBook with the current assignee + email", () => {
    const onAdd = vi.fn();
    render(<TaskFormModal {...defaultProps({ onAddAssigneeToAddressBook: onAdd })} />, { wrapper: Providers });
    fireEvent.click(screen.getByRole("button", { name: /add to address book/i }));
    expect(onAdd).toHaveBeenCalledWith("Nora Ito", "nora@x.com");
  });

  it("disables the add-to-address-book button for Jira-linked tasks", () => {
    render(<TaskFormModal {...defaultProps({ editingIsJiraLinked: true })} />, { wrapper: Providers });
    expect(
      screen.getByRole("button", { name: /add to address book/i }),
    ).toBeDisabled();
  });
});

describe("TaskFormModal — Documents field", () => {
  beforeEach(() => {
    stubTaskForm();
  });

  it("shows the Documents field (gated hint when SharePoint is off)", () => {
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    expect(screen.getByText(/enable microsoft 365/i)).toBeInTheDocument();
  });
  // The budgetLink prop travels task-manager -> AppModals -> TaskFormModal ->
  // TaskFormFields, and every hop types it OPTIONAL so a dropped prop degrades
  // silently into "budget module off" rather than throwing. These pin the hop
  // this file owns; the ones above and below it are pinned in
  // app-modals.test.tsx and task-manager.characterization.test.tsx.
  test("forwards budgetLink so the budget-bucket field reaches the form", () => {
    const buckets = [{ id: 1, name: "Design" }, { id: 2, name: "Build" }] as unknown as BudgetBucket[];
    render(
      <TaskFormModal {...defaultProps({ budgetLink: { buckets, bucketId: 2, onChange: vi.fn() } })} />,
      { wrapper: Providers },
    );
    expect(screen.getByLabelText("Budget bucket")).toHaveValue("2");
  });

  test("renders no budget-bucket field when budgetLink is absent", () => {
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    expect(screen.queryByLabelText("Budget bucket")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Inline note log (slice B)
// ---------------------------------------------------------------------------

// TWO entries, so the summary count is distinguishable from the unsaved-task
// fallback's 0. There is no competing draft copy any more — the form carries
// no note log (open-followups §29) — so the count can only come from these.
describe("task-form-modal panel size", () => {
  beforeEach(() => {
    stubTaskForm();
  });

  it("opens at 1280x960, keeping the existing resize floor and viewport cap", () => {
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    const panel = document.querySelector("[data-modal-panel]");
    expect(panel?.className).toContain("w-[1280px]");
    expect(panel?.className).toContain("h-[960px]");
    expect(panel?.className).toContain("min-w-[460px]");
    expect(panel?.className).toContain("min-h-[480px]");
    expect(panel?.className).toContain("max-w-[95vw]");
    expect(panel?.className).toContain("max-h-[95vh]");
  });
});

// §486 — the per-item Outlook opt-out. The form draft is stubbed here; the
// payload half (set + clear on save) is pinned in use-task-submit.test.ts.
describe("TaskFormModal — Sync to Outlook (§486)", () => {
  it("unticking writes calendarOptOut: true into the form draft", () => {
    stubTaskForm({ taskName: "Kickoff" });
    render(<TaskFormModal {...defaultProps({ calendarSyncEnabled: true })} />, { wrapper: Providers });
    const box = screen.getByRole("checkbox", { name: "Sync to Outlook – Kickoff" });
    expect(box).toBeChecked();
    fireEvent.click(box);
    const setForm = mockUseTaskForm.mock.results.at(-1)!.value.setForm as ReturnType<typeof vi.fn>;
    const updater = setForm.mock.calls.at(-1)![0] as (p: ReturnType<typeof emptyForm>) => ReturnType<typeof emptyForm>;
    expect(updater(emptyForm()).calendarOptOut).toBe(true);
  });
  it("an opted-out draft renders unticked, and ticking clears it", () => {
    stubTaskForm({ taskName: "Kickoff", calendarOptOut: true });
    render(<TaskFormModal {...defaultProps({ calendarSyncEnabled: true })} />, { wrapper: Providers });
    const box = screen.getByRole("checkbox", { name: "Sync to Outlook – Kickoff" });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    const setForm = mockUseTaskForm.mock.results.at(-1)!.value.setForm as ReturnType<typeof vi.fn>;
    const updater = setForm.mock.calls.at(-1)![0] as (p: ReturnType<typeof emptyForm>) => ReturnType<typeof emptyForm>;
    expect(updater({ ...emptyForm(), calendarOptOut: true }).calendarOptOut).toBe(false);
  });
  it("is absent while Outlook sync is not configured", () => {
    stubTaskForm({ taskName: "Kickoff" });
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    expect(screen.queryByRole("checkbox", { name: /Sync to Outlook/ })).toBeNull();
  });
});
