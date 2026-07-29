import { describe, test, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { useTaskForm, emptyForm, emptyBulkEdit } from "./task-form-context";
import { TaskFormModal } from "./task-form-modal";
import { t } from "./i18n";
import type { NoteLogPanelProps } from "./note-log-panel";
import type { BudgetBucket, NoteLogEntry } from "./types";

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
    modalRef: createRef<HTMLDivElement | null>(),
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
    expect(screen.getByText("3. Effort & Classification")).toBeInTheDocument();
    expect(screen.getByText("4. Relationships")).toBeInTheDocument();
    expect(screen.getByText("5. Status & Notes")).toBeInTheDocument();
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
});

describe("TaskFormModal — cancel in create mode", () => {
  beforeEach(() => {
    stubTaskForm();
  });

  it("shows Cancel in create mode too", () => {
    // editingId is null in stubTaskForm, so isEditing=false
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    expect(screen.getByRole("button", { name: /cancel|abbrechen/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add task|aufgabe hinzuf/i })).toBeInTheDocument();
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

// TWO entries. The stubbed `form.noteLog` below deliberately holds ONE, so the
// summary count can only read "2" if it reads the LIVE workspace panel props —
// same-length fixtures would pass whichever source the code happened to use.
const PANEL_ENTRIES: NoteLogEntry[] = [
  { id: 1, timestamp: "2026-01-01T10:00:00Z", html: "<p>Kickoff held</p>", text: "Kickoff held", authorResourceId: 1, authorName: "Alice Anders" },
  { id: 2, timestamp: "2026-01-02T10:00:00Z", html: "<p>Charter signed</p>", text: "Charter signed", authorResourceId: 1, authorName: "Alice Anders" },
];

// One STALE draft entry, distinguishable from the panel's two by length AND body.
const DRAFT_NOTE_LOG: NoteLogEntry[] = [
  { id: 9, timestamp: "2025-12-01T10:00:00Z", html: "<p>Stale draft note</p>", text: "Stale draft note", authorResourceId: 1 },
];

function notePanelProps(over: Partial<NoteLogPanelProps> = {}) {
  const onAdd = vi.fn();
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const taskNotePanel: NoteLogPanelProps = {
    entries: PANEL_ENTRIES,
    onAdd,
    onEdit,
    onDelete,
    self: 1,
    resources: [],
    lang: EN,
    labelSuffix: "Draft charter",
    ...over,
  };
  return { onAdd, onEdit, onDelete, taskNotePanel };
}

/** Opens the notes `<details>` and returns it. */
function openNotesDisclosure(): HTMLDetailsElement {
  const summary = screen.getByText(new RegExp(`^${t(EN, "noteLogTitle")} \\(`));
  const details = summary.closest("details") as HTMLDetailsElement;
  expect(details).not.toBeNull();
  // jsdom implements summary activation, but assert rather than assume — a
  // silently-still-closed disclosure would make the assertions below vacuous.
  fireEvent.click(summary);
  expect(details.open).toBe(true);
  return details;
}

describe("inline note log (slice B)", () => {
  beforeEach(() => {
    stubTaskForm({ noteLog: DRAFT_NOTE_LOG });
  });

  it("renders the log inline and writes through on add", async () => {
    const user = userEvent.setup();
    const { onAdd, taskNotePanel } = notePanelProps();
    render(<TaskFormModal {...defaultProps({ taskNotePanel })} />, { wrapper: Providers });

    openNotesDisclosure();
    // Read path: the LIVE workspace entries render, not the draft's.
    expect(screen.getByText("Kickoff held")).toBeInTheDocument();
    expect(screen.getByText("Charter signed")).toBeInTheDocument();
    expect(screen.queryByText("Stale draft note")).toBeNull();

    const surface = await screen.findByRole("textbox", { name: t(EN, "noteLogPlaceholder") });
    await user.click(surface);
    await user.type(surface, "Fresh in-editor note");
    fireEvent.click(
      screen.getByRole("button", { name: `${t(EN, "noteLogAdd")} – Draft charter` }),
    );

    // ★ headline claim: the WRITE reaches the workspace handler. A read-only
    //   assertion would stay green with the whole write path removed.
    expect(onAdd).toHaveBeenCalled();
    const [html, text] = onAdd.mock.calls[0];
    expect(text).toBe("Fresh in-editor note");
    expect(html).toContain("Fresh in-editor note");
  });

  it("keeps the disabled Notes button for an unsaved task", () => {
    render(<TaskFormModal {...defaultProps()} />, { wrapper: Providers });
    // No panel threaded (a new draft has no id to write to) → the launcher button.
    const button = screen.getByRole("button", { name: `${t(EN, "noteLogTitle")} (1)` });
    expect(button).toBeDisabled();
    expect(button.closest("details")).toBeNull();
  });

  it("shows the live entry count in the summary", () => {
    const { taskNotePanel } = notePanelProps();
    render(<TaskFormModal {...defaultProps({ taskNotePanel })} />, { wrapper: Providers });
    // Panel holds 2, the draft holds 1 — so "(2)" proves the live source.
    expect(screen.getByText(`${t(EN, "noteLogTitle")} (2)`)).toBeInTheDocument();
    expect(screen.queryByText(`${t(EN, "noteLogTitle")} (1)`)).toBeNull();
  });

  it("reaches the notes disclosure by keyboard", async () => {
    const user = userEvent.setup();
    const { taskNotePanel } = notePanelProps();
    render(<TaskFormModal {...defaultProps({ taskNotePanel })} />, { wrapper: Providers });

    const summary = screen.getByText(`${t(EN, "noteLogTitle")} (2)`);
    // A real <summary>, so Enter/Space toggle natively — the tabIndex below must
    // not be standing in for a div dressed up as a disclosure.
    expect(summary.tagName).toBe("SUMMARY");
    // ★ .focus() proves nothing — it succeeds on tabIndex={-1}. Only walking the
    //   tab order proves the disclosure is genuinely reachable.
    let reached = false;
    for (let i = 0; i < 200 && !reached; i += 1) {
      await user.tab();
      reached = document.activeElement === summary;
    }
    expect(reached).toBe(true);
  });
});
