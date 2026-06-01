import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResourcesPanel } from "./resources-panel";
import type { Resource } from "./types";

const resources: Resource[] = [
  { id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent", utilization: {} },
];

const baseProps = {
  lang: "en-US" as const,
  view: "workload" as const,
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
  plan: { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" },
  workdayHours: 8,
  onSetUtilization: () => {},
  onSetAllUtilizationMode: () => {},
  onSetAbsenceOverride: () => {},
  onSetPlanWindow: () => {},
  onEditResource: () => {},
  onAddResource: () => {},
};

describe("ResourcesPanel", () => {
  test("workload view renders the resources heading", () => {
    // Role assignment (discipline/grade) moved out of this panel to the Directory
    // view; the panel is now a prop-driven workload/calendar/planning host.
    render(<ResourcesPanel {...baseProps} view="workload" resources={[]} />);
    expect(screen.getByRole("heading", { name: /resources/i })).toBeInTheDocument();
  });

  test("planning view: editing a utilization cell calls onSetUtilization", () => {
    const onSetUtilization = vi.fn();
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" resources={resources} plan={plan}
      workdayHours={8} onSetUtilization={onSetUtilization}
      onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    fireEvent.change(screen.getByLabelText("Utilization for Sample in 2026-02"), { target: { value: "80" } });
    expect(onSetUtilization).toHaveBeenCalledWith(1, "2026-02", 80);
  });

  test("planning view: changing the From date calls onSetPlanWindow", () => {
    const onSetPlanWindow = vi.fn();
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" resources={[]} plan={plan} workdayHours={8}
      onSetUtilization={() => {}} onSetAbsenceOverride={() => {}}
      onSetPlanWindow={onSetPlanWindow} />);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
    expect(onSetPlanWindow).toHaveBeenCalledWith("2026-01-01", "2026-02-28");
  });

  test("planning view shows internal cost from the resource's role rate", () => {
    const roles = [{ id: 5, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 0 }];
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: 5, utilizationMode: "percent" as const, utilization: { "2026-02": 100 } }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "USD" };
    render(<ResourcesPanel {...baseProps} view="planning" lang="en-US" resources={resources} roles={roles} plan={plan}
      workdayHours={8} holidaySet={new Set()}
      onSetUtilization={() => {}} onSetAbsenceOverride={() => {}}
      onSetPlanWindow={() => {}} />);
    // Feb 2026 = 20 workdays × 8h = 160h; 100% util; internal = 160 × 100 = $16,000
    // The value appears in both the data row and the footer total row.
    expect(screen.getAllByText("$16,000").length).toBeGreaterThanOrEqual(1);
  });

  test("planning view: editing a cell's absence override calls onSetAbsenceOverride", () => {
    const onSetAbsenceOverride = vi.fn();
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "USD" };
    render(<ResourcesPanel {...baseProps} view="planning" lang="en-US" resources={resources} plan={plan} workdayHours={8}
      holidaySet={new Set()} onSetUtilization={() => {}}
      onSetAbsenceOverride={onSetAbsenceOverride} onSetPlanWindow={() => {}} />);
    fireEvent.change(screen.getByLabelText("Absence override for Sample in 2026-02"), { target: { value: "16" } });
    expect(onSetAbsenceOverride).toHaveBeenCalledWith(1, "2026-02", 16);
  });

  test("planning view: clearing an absence override passes null", () => {
    const onSetAbsenceOverride = vi.fn();
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "percent" as const, utilization: {}, absenceOverride: { "2026-02": 16 } }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "USD" };
    render(<ResourcesPanel {...baseProps} view="planning" lang="en-US" resources={resources} plan={plan} workdayHours={8}
      holidaySet={new Set()} onSetUtilization={() => {}}
      onSetAbsenceOverride={onSetAbsenceOverride} onSetPlanWindow={() => {}} />);
    fireEvent.change(screen.getByLabelText("Absence override for Sample in 2026-02"), { target: { value: "" } });
    expect(onSetAbsenceOverride).toHaveBeenCalledWith(1, "2026-02", null);
  });

  test("does not write utilization when viewing a finer (derived) granularity", () => {
    const onSetUtilization = vi.fn();
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "percent" as const, utilization: { "2026-02": 80 } }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "USD" };
    render(<ResourcesPanel {...baseProps} view="planning" lang="en-US" resources={resources} plan={plan}
      workdayHours={8} holidaySet={new Set()} onSetUtilization={onSetUtilization}
      onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    // Switch the display granularity to "Weeks" — derived mode (plan stays at month)
    fireEvent.click(screen.getByRole("radio", { name: "Weeks" }));
    // First week of Feb 2026: 2026-W06 (Mon 2026-02-02 .. Sun 2026-02-08)
    const utilInput = screen.getByLabelText("Utilization for Sample in 2026-W06");
    fireEvent.change(utilInput, { target: { value: "55" } });
    // The `if (!derived)` guard must prevent any write
    expect(onSetUtilization).not.toHaveBeenCalled();
  });

  test("planning view: percent/hours toggle is present and calls onSetAllUtilizationMode", () => {
    const onSetAllUtilizationMode = vi.fn();
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" resources={resources} plan={plan} workdayHours={8}
      onSetUtilization={() => {}}
      onSetAllUtilizationMode={onSetAllUtilizationMode}
      onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    // The % / h toggle should be present
    expect(screen.getByRole("radio", { name: "Hours" })).toBeInTheDocument();
    // Clicking "Hours" calls the handler
    fireEvent.click(screen.getByRole("radio", { name: "Hours" }));
    expect(onSetAllUtilizationMode).toHaveBeenCalledWith("hours");
  });

  test("planning view: rollup toggle reveals the non-canonical read-only table", () => {
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "percent" as const, utilization: { "2026-02": 100 } }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "USD" };
    render(<ResourcesPanel {...baseProps} view="planning" lang="en-US" resources={resources} plan={plan} workdayHours={8}
      holidaySet={new Set()} onSetUtilization={() => {}}
      onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Show rollup" }));
    expect(screen.getByText("2026-W07")).toBeInTheDocument(); // Mon 2026-02-09 ISO week
  });

  test("planning view: clicking a resource name calls onEditResource", () => {
    const onEditResource = vi.fn();
    const resources = [{ id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" resources={resources} plan={plan} workdayHours={8}
      onEditResource={onEditResource} onSetUtilization={() => {}}
      onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEditResource).toHaveBeenCalledWith(resources[0]);
  });
});

test("resources-panel: no view SegmentedControl, no roles/report/add-absence buttons; resizable", () => {
  const src = readFileSync(join(__dirname, "resources-panel.tsx"), "utf8");
  expect(src).not.toMatch(/onManageRoles/);
  expect(src).not.toMatch(/onOpenReport/);
  expect(src).toMatch(/VIEW_PANE_RESIZABLE_CLASS/);
});
