import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResourcesPanel } from "./resources-panel";
import type { Resource } from "./types";

const resources: Resource[] = [
  { id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent", utilization: {} },
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
  onOpenReport: () => {},
  onAssignRole: () => {},
  plan: { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" },
  workdayHours: 8,
  onSetUtilization: () => {},
  onSetUtilizationMode: () => {},
  onSetAbsenceOverride: () => {},
  onSetPlanWindow: () => {},
  onEditResource: () => {},
  onAddResource: () => {},
};

describe("ResourcesPanel", () => {
  test("renders the resource name in the directory view", () => {
    render(<ResourcesPanel {...baseProps} />);
    // Default view is Directory — name is rendered as a button
    expect(screen.getByRole("button", { name: "Alex Example" })).toBeInTheDocument();
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

  test("choosing a discipline then grade assigns the role", () => {
    const onAssignRole = vi.fn();
    const resources = [{ id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
    render(<ResourcesPanel {...baseProps} resources={resources} roles={[]}
      disciplines={[{ id: 2, name: "Developer" }]} grades={[{ id: 3, name: "Senior" }]}
      onManageRoles={() => {}} onAssignRole={onAssignRole} />);
    fireEvent.change(screen.getByLabelText("Discipline for Alex Example"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Grade for Alex Example"), { target: { value: "3" } });
    expect(onAssignRole).toHaveBeenCalledWith(1, 2, 3);
  });

  test("planning view: editing a utilization cell calls onSetUtilization", () => {
    const onSetUtilization = vi.fn();
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} resources={resources} plan={plan}
      workdayHours={8} onSetUtilization={onSetUtilization} onSetUtilizationMode={() => {}}
      onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Planning" }));
    fireEvent.change(screen.getByLabelText("Utilization for Sample in 2026-02"), { target: { value: "80" } });
    expect(onSetUtilization).toHaveBeenCalledWith(1, "2026-02", 80);
  });

  test("planning view: changing the From date calls onSetPlanWindow", () => {
    const onSetPlanWindow = vi.fn();
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} resources={[]} plan={plan} workdayHours={8}
      onSetUtilization={() => {}} onSetUtilizationMode={() => {}} onSetAbsenceOverride={() => {}}
      onSetPlanWindow={onSetPlanWindow} />);
    fireEvent.click(screen.getByRole("radio", { name: "Planning" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
    expect(onSetPlanWindow).toHaveBeenCalledWith("2026-01-01", "2026-02-28");
  });

  test("clicking Report calls onOpenReport", () => {
    const onOpenReport = vi.fn();
    render(<ResourcesPanel {...baseProps} resources={[]} onOpenReport={onOpenReport} />);
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    expect(onOpenReport).toHaveBeenCalled();
  });

  test("planning view shows internal cost from the resource's role rate", () => {
    const roles = [{ id: 5, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 0 }];
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: 5, utilizationMode: "percent" as const, utilization: { "2026-02": 100 } }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "USD" };
    render(<ResourcesPanel {...baseProps} lang="en-US" resources={resources} roles={roles} plan={plan}
      workdayHours={8} holidaySet={new Set()}
      onSetUtilization={() => {}} onSetUtilizationMode={() => {}} onSetAbsenceOverride={() => {}}
      onSetPlanWindow={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Planning" }));
    // Feb 2026 = 20 workdays × 8h = 160h; 100% util; internal = 160 × 100 = $16,000
    // The value appears in both the data row and the footer total row.
    expect(screen.getAllByText("$16,000").length).toBeGreaterThanOrEqual(1);
  });

  test("planning view: editing a cell's absence override calls onSetAbsenceOverride", () => {
    const onSetAbsenceOverride = vi.fn();
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "USD" };
    render(<ResourcesPanel {...baseProps} lang="en-US" resources={resources} plan={plan} workdayHours={8}
      holidaySet={new Set()} onSetUtilization={() => {}} onSetUtilizationMode={() => {}}
      onSetAbsenceOverride={onSetAbsenceOverride} onSetPlanWindow={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Planning" }));
    fireEvent.change(screen.getByLabelText("Absence override for Sample in 2026-02"), { target: { value: "16" } });
    expect(onSetAbsenceOverride).toHaveBeenCalledWith(1, "2026-02", 16);
  });

  test("planning view: clearing an absence override passes null", () => {
    const onSetAbsenceOverride = vi.fn();
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "percent" as const, utilization: {}, absenceOverride: { "2026-02": 16 } }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "USD" };
    render(<ResourcesPanel {...baseProps} lang="en-US" resources={resources} plan={plan} workdayHours={8}
      holidaySet={new Set()} onSetUtilization={() => {}} onSetUtilizationMode={() => {}}
      onSetAbsenceOverride={onSetAbsenceOverride} onSetPlanWindow={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Planning" }));
    fireEvent.change(screen.getByLabelText("Absence override for Sample in 2026-02"), { target: { value: "" } });
    expect(onSetAbsenceOverride).toHaveBeenCalledWith(1, "2026-02", null);
  });

  test("gives the Manage roles button a descriptive tooltip", () => {
    render(<ResourcesPanel {...baseProps} resources={[]} />);
    expect(screen.getByRole("button", { name: /manage roles/i })).toHaveAttribute(
      "title",
      "Open the roles & rates editor to manage disciplines, grades, and rate cards.",
    );
  });

  test("does not write utilization when viewing a finer (derived) granularity", () => {
    const onSetUtilization = vi.fn();
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "percent" as const, utilization: { "2026-02": 80 } }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "USD" };
    render(<ResourcesPanel {...baseProps} lang="en-US" resources={resources} plan={plan}
      workdayHours={8} holidaySet={new Set()} onSetUtilization={onSetUtilization}
      onSetUtilizationMode={() => {}} onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    // Enter planning view
    fireEvent.click(screen.getByRole("radio", { name: "Planning" }));
    // Switch the display granularity to "Weeks" — derived mode (plan stays at month)
    fireEvent.click(screen.getByRole("radio", { name: "Weeks" }));
    // First week of Feb 2026: 2026-W06 (Mon 2026-02-02 .. Sun 2026-02-08)
    const utilInput = screen.getByLabelText("Utilization for Sample in 2026-W06");
    fireEvent.change(utilInput, { target: { value: "55" } });
    // The `if (!derived)` guard must prevent any write
    expect(onSetUtilization).not.toHaveBeenCalled();
  });

  test("planning view: rollup toggle reveals the non-canonical read-only table", () => {
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "percent" as const, utilization: { "2026-02": 100 } }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "USD" };
    render(<ResourcesPanel {...baseProps} lang="en-US" resources={resources} plan={plan} workdayHours={8}
      holidaySet={new Set()} onSetUtilization={() => {}} onSetUtilizationMode={() => {}}
      onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Planning" }));
    fireEvent.click(screen.getByRole("button", { name: "Show rollup" }));
    expect(screen.getByText("2026-W07")).toBeInTheDocument(); // Mon 2026-02-09 ISO week
  });
});
