import { describe, test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { TaskFormProvider, useTaskForm } from "./task-form-context";
import { TaskFormModal } from "./task-form-modal";

// Module-scoped ref so the inline open below runs exactly once per render
// tree (React renders Probe twice in StrictMode; we want one setState).
const taskModalOpenedRef = { current: false };

function Probe({
  children,
  openModal,
}: {
  children: ReactNode;
  openModal: boolean;
}) {
  const { setTaskModalOpen } = useTaskForm();
  if (openModal && !taskModalOpenedRef.current) {
    taskModalOpenedRef.current = true;
    setTaskModalOpen(true);
  }
  return <>{children}</>;
}

function defaultProps() {
  return {
    lang: "en-US" as const,
    today: "2026-05-19",
    nextId: 1,
    contactsList: [],
    absences: [],
    tasksForDeps: [],
    uniqueGroups: [],
    uniqueLabels: [],
    editingIsJiraLinked: false,
    jiraEnabled: false,
    error: null,
    holidaySet: new Set<string>(),
    jiraProjectKey: undefined,
    jiraDefaultIssueType: undefined,
    modalRef: createRef<HTMLDivElement | null>(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    onRemoveContact: vi.fn(),
    onShowToast: vi.fn(),
  };
}

describe("TaskFormModal", () => {
  test("renders nothing when taskModalOpen is false", () => {
    taskModalOpenedRef.current = false;
    const { container } = render(
      <TaskFormProvider>
        <Probe openModal={false}>
          <TaskFormModal {...defaultProps()} />
        </Probe>
      </TaskFormProvider>,
    );
    expect(container.querySelector("form")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  test("renders header and form when modal is open", () => {
    taskModalOpenedRef.current = false;
    render(
      <TaskFormProvider>
        <Probe openModal={true}>
          <TaskFormModal {...defaultProps()} />
        </Probe>
      </TaskFormProvider>,
    );
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
    expect(document.querySelector("form")).not.toBeNull();
  });

  test("close button fires onCancel exactly once", () => {
    taskModalOpenedRef.current = false;
    const props = defaultProps();
    render(
      <TaskFormProvider>
        <Probe openModal={true}>
          <TaskFormModal {...props} />
        </Probe>
      </TaskFormProvider>,
    );
    // The header close button is the only button in the modal that carries
    // an aria-label (it's t(lang, "alertModalClose")).
    const closeButton = screen
      .getAllByRole("button")
      .find((b) => (b.getAttribute("aria-label") ?? "").length > 0);
    expect(closeButton).toBeDefined();
    closeButton!.click();
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  test("submitting the form fires onSubmit", () => {
    taskModalOpenedRef.current = false;
    const props = defaultProps();
    render(
      <TaskFormProvider>
        <Probe openModal={true}>
          <TaskFormModal {...props} />
        </Probe>
      </TaskFormProvider>,
    );
    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });
});
