import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResourcesPanel } from "./resources-panel";
import type { Resource } from "./types";

const resources: Resource[] = [
  { id: 1, name: "Alex Example", roleId: null, utilizationMode: "percent", utilization: {} },
];

const baseProps = {
  lang: "en-US" as const,
  tasks: [] as never[],
  absences: [] as never[],
  shifts: [] as never[],
  resources,
  today: "2026-05-23",
  holidaySet: new Set<string>(),
  onAddAbsence: () => {},
  onEditAbsence: () => {},
  onEditShift: () => {},
  roles: [] as never[],
  disciplines: [] as never[],
  grades: [] as never[],
  onManageRoles: () => {},
  onAssignRole: () => {},
};

describe("ResourcesPanel", () => {
  test("renders the resource name in the list view", () => {
    render(<ResourcesPanel {...baseProps} />);
    expect(screen.getByText("Alex Example")).toBeInTheDocument();
  });

  test("clicking Manage roles calls onManageRoles", () => {
    const onManageRoles = vi.fn();
    render(
      <ResourcesPanel
        {...baseProps}
        resources={[]}
        onManageRoles={onManageRoles}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage roles" }));
    expect(onManageRoles).toHaveBeenCalled();
  });
});
