import { describe, test, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { useTaskForm, emptyForm, emptyBulkEdit } from "./task-form-context";
import { TaskFormModal } from "./task-form-modal";

// ModalFieldControls (rendered in the modal header) reads field visibility from
// the workspace, so renders need a WorkspaceProvider. useTaskForm stays mocked.
function Providers({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

// Mock M365 hooks consumed by DocumentLinksFieldGated — default: SharePoint off.
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
});
