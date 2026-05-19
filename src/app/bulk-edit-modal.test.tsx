import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { TaskFormProvider, useTaskForm } from "./task-form-context";
import { BulkEditModal } from "./bulk-edit-modal";

const bulkOpenedRef = { current: false };

function Probe({
  children,
  openBulk,
}: {
  children: ReactNode;
  openBulk: boolean;
}) {
  const { setBulkEditOpen } = useTaskForm();
  if (openBulk && !bulkOpenedRef.current) {
    bulkOpenedRef.current = true;
    setBulkEditOpen(true);
  }
  return <>{children}</>;
}

function defaultProps(
  overrides: Partial<{
    selectedIds: Set<number>;
    selectedJiraCount: number;
  }> = {},
) {
  return {
    lang: "en-US" as const,
    today: "2026-05-19",
    selectedIds: overrides.selectedIds ?? new Set<number>([1]),
    selectedJiraCount: overrides.selectedJiraCount ?? 0,
    uniqueGroups: [],
    uniqueLabels: [],
    onApply: vi.fn(),
    onCancel: vi.fn(),
  };
}

describe("BulkEditModal", () => {
  test("renders nothing when bulkEditOpen is false", () => {
    bulkOpenedRef.current = false;
    const { container } = render(
      <TaskFormProvider>
        <Probe openBulk={false}>
          <BulkEditModal {...defaultProps()} />
        </Probe>
      </TaskFormProvider>,
    );
    expect(container.querySelector("h3")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("renders nothing when bulkEditOpen is true but selectedIds is empty", () => {
    bulkOpenedRef.current = false;
    const { container } = render(
      <TaskFormProvider>
        <Probe openBulk={true}>
          <BulkEditModal {...defaultProps({ selectedIds: new Set() })} />
        </Probe>
      </TaskFormProvider>,
    );
    expect(container.querySelector("h3")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
