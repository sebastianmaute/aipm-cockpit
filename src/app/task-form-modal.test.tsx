import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
    modalRef: createRef<HTMLDivElement>(),
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
});
