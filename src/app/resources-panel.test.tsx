import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResourcesPanel } from "./resources-panel";
import { t } from "./i18n";
import type { Resource } from "./types";

const resources: Resource[] = [
  { id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent", utilization: {} },
  { id: 2, firstName: "Mateo", lastName: "Rossi", roleId: null, utilizationMode: "percent", utilization: {} },
];

const baseProps = {
  lang: "en-US" as const,
  view: "workload" as const,
  tasks: [] as never[],
  absences: [] as never[],
  shifts: [] as never[],
  raid: [] as never[],
  raidEnabled: true,
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
  overAllocatedPct: 100,
  onReassignTask: () => {},
  onRescheduleTask: () => {},
  onSetAllUtilizationMode: () => {},
  onSetAbsenceOverride: () => {},
  onSetPlanWindow: () => {},
  onEditResource: () => {},
  onAddResource: () => {},
};

describe("ResourcesPanel", () => {
  test("workload view renders the Workload heading", () => {
    // The panel is a prop-driven workload/calendar/planning host; the heading
    // now reflects the active sub-view rather than a generic "Resources".
    render(<ResourcesPanel {...baseProps} view="workload" resources={[]} />);
    expect(screen.getByRole("heading", { name: /workload/i })).toBeInTheDocument();
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

  test("planning: period date header is not right-aligned", () => {
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" resources={resources} plan={plan}
      workdayHours={8} onSetUtilization={() => {}} onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    const th = screen.getByRole("columnheader", { name: /2026-02/ });
    expect(th.className).not.toMatch(/text-right/);
  });

  test("planning: rollup period date header is also left-aligned", () => {
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "percent" as const, utilization: { "2026-02": 100 } }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" lang="en-US" resources={resources} plan={plan}
      workdayHours={8} holidaySet={new Set()} onSetUtilization={() => {}} onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Show rollup" }));
    const rollupHeaders = screen.getAllByRole("columnheader", { name: /2026-W/ });
    expect(rollupHeaders.length).toBeGreaterThan(0);
    for (const th of rollupHeaders) expect(th.className).not.toMatch(/text-right/);
  });

  test("planning view: editable utilization input has an opaque bg so it stays visible on row hover", () => {
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" resources={resources} plan={plan}
      workdayHours={8} onSetUtilization={() => {}}
      onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    // Row hover is bg-surface-muted; the editable input must fill bg-surface (not
    // transparent) or it dissolves into the hover color (border-line == surface-muted).
    const util = screen.getByLabelText("Utilization for Sample in 2026-02");
    expect(util.className).toContain("bg-surface");
    expect(util.className).not.toContain("bg-surface-muted");
    const override = screen.getByLabelText("Absence override for Sample in 2026-02");
    expect(override.className).toContain("bg-surface");
  });

  test("planning: utilization box shows % suffix in percent mode", () => {
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" resources={resources} plan={plan}
      workdayHours={8} onSetUtilization={() => {}}
      onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    // Scope to the utilization input's wrapper so a bare "%"/"h" elsewhere in the
    // view can't satisfy (or break) the assertion.
    const util = screen.getByLabelText("Utilization for Sample in 2026-02");
    expect(util.parentElement).toHaveTextContent("%");
    expect(util.parentElement).not.toHaveTextContent("h");
  });

  test("planning: utilization box shows h suffix in hours mode", () => {
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "hours" as const, utilization: {} }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" resources={resources} plan={plan}
      workdayHours={8} onSetUtilization={() => {}}
      onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    const util = screen.getByLabelText("Utilization for Sample in 2026-02");
    expect(util.parentElement).toHaveTextContent("h");
    expect(util.parentElement).not.toHaveTextContent("%");
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

  test("planning view: clicking the row (outside the name button) calls onEditResource", () => {
    const onEditResource = vi.fn();
    const resources = [{ id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" resources={resources} plan={plan} workdayHours={8}
      onEditResource={onEditResource} onSetUtilization={() => {}}
      onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    // Click the data row itself (not the name button) — should fire onEditResource
    const rows = screen.getAllByRole("row");
    // First row is thead, second is the data row
    const dataRow = rows[1];
    fireEvent.click(dataRow);
    expect(onEditResource).toHaveBeenCalledTimes(1);
    expect(onEditResource).toHaveBeenCalledWith(resources[0]);
  });

  test("planning view: clicking a utilization input does NOT fire onEditResource", () => {
    const onEditResource = vi.fn();
    const resources = [{ id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" resources={resources} plan={plan} workdayHours={8}
      onEditResource={onEditResource} onSetUtilization={() => {}}
      onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    const utilizationInput = screen.getByLabelText("Utilization for Alex Example in 2026-02");
    fireEvent.click(utilizationInput);
    expect(onEditResource).not.toHaveBeenCalled();
  });

  test("planning view: clicking an absence override input does NOT fire onEditResource", () => {
    const onEditResource = vi.fn();
    const resources = [{ id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" resources={resources} plan={plan} workdayHours={8}
      onEditResource={onEditResource} onSetUtilization={() => {}}
      onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    const absenceInput = screen.getByLabelText("Absence override for Alex Example in 2026-02");
    fireEvent.click(absenceInput);
    expect(onEditResource).not.toHaveBeenCalled();
  });

  test("workload header shows reset-cols and reset-size together (one toolbar, not stacked)", () => {
    render(<ResourcesPanel {...baseProps} view="workload" />);
    // Exactly one reset-column-widths control, now lifted into the panel header
    expect(screen.getAllByRole("button", { name: /reset all column widths/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /reset back to the default size/i })).toBeInTheDocument();
  });

  test("planning date inputs use the taller py-1.5 control height", () => {
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" resources={[]} plan={plan} workdayHours={8}
      onSetUtilization={() => {}} onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    const from = screen.getByLabelText("From");
    expect(from.className).toContain("py-1.5");
    expect(from.className).toContain("text-sm");
  });

  test("planning grid filters resources by name", () => {
    render(<ResourcesPanel {...baseProps} view="planning" />); // baseProps has 2 named resources
    const input = screen.getByPlaceholderText(/filter resources/i);
    const before = screen.getAllByRole("row").length;
    // "Sample" matches exactly one of the two display names (Alex Example)
    fireEvent.change(input, { target: { value: "Sample" } });
    expect(screen.getAllByRole("row").length).toBeLessThan(before);
    expect(screen.getByText(/Alex Example/)).toBeInTheDocument();
    expect(screen.queryByText(/Mateo Rossi/)).not.toBeInTheDocument();
  });

  test("shows a margin RAG badge in the planning grid", () => {
    // Resource with a role that has externalRate > 0 so margin renders
    const roles = [{ id: 7, disciplineId: 1, gradeId: 1, internalRate: 80, externalRate: 100 }];
    const resources = [{ id: 1, firstName: "Sample", lastName: "Dummy", roleId: 7, utilizationMode: "percent" as const, utilization: { "2026-02": 100 } }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" lang="en-US" resources={resources} roles={roles} plan={plan}
      workdayHours={8} holidaySet={new Set()}
      onSetUtilization={() => {}} onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    // RagBadge renders R, A, or G as visible text in the margin column
    expect(screen.getAllByText(/^[RAG]$/).length).toBeGreaterThan(0);
  });

  test("A2: absence override input uses text-sm (not text-[10px])", () => {
    const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "USD" };
    render(<ResourcesPanel {...baseProps} view="planning" lang="en-US" resources={resources} plan={plan} workdayHours={8}
      holidaySet={new Set()} onSetUtilization={() => {}}
      onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    const input = screen.getByLabelText("Absence override for Sample in 2026-02");
    expect(input.className).toContain("text-sm");
    expect(input.className).not.toContain("text-[10px]");
  });
});

describe("ResourcesPanel — Outlook calendar toggle (SP4)", () => {
  const calLabel = `${t("en-US", "calendarSyncEnable")} – ${t("en-US", "calendarSyncEntityAbsence")}`;

  test("renders the toggle when m365Configured and a handler is given", () => {
    render(<ResourcesPanel {...baseProps} view="workload" m365Configured onToggleCalendar={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: calLabel })).toBeInTheDocument();
  });

  test("labels the toggle for resource absences", () => {
    render(<ResourcesPanel {...baseProps} view="workload" m365Configured onToggleCalendar={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: /resource absences/i })).toBeInTheDocument();
  });

  test("does NOT render the toggle without m365Configured", () => {
    render(<ResourcesPanel {...baseProps} view="workload" m365Configured={false} onToggleCalendar={vi.fn()} />);
    expect(screen.queryByRole("checkbox", { name: calLabel })).toBeNull();
  });

  test("does NOT render the toggle in a popout", () => {
    render(<ResourcesPanel {...baseProps} view="workload" m365Configured isPopout onToggleCalendar={vi.fn()} />);
    expect(screen.queryByRole("checkbox", { name: calLabel })).toBeNull();
  });

  test("calls onToggleCalendar(true) when the checkbox is ticked", () => {
    const onToggleCalendar = vi.fn();
    render(<ResourcesPanel {...baseProps} view="workload" m365Configured onToggleCalendar={onToggleCalendar} />);
    fireEvent.click(screen.getByRole("checkbox", { name: calLabel }));
    expect(onToggleCalendar).toHaveBeenCalledWith(true);
  });

  test("shows the Push button only when calendarEnabled and calls onPushCalendar", () => {
    const onPushCalendar = vi.fn();
    const { rerender } = render(
      <ResourcesPanel {...baseProps} view="workload" m365Configured onToggleCalendar={vi.fn()} calendarEnabled={false} onPushCalendar={onPushCalendar} />,
    );
    expect(screen.queryByRole("button", { name: t("en-US", "calendarPush") })).toBeNull();

    rerender(
      <ResourcesPanel {...baseProps} view="workload" m365Configured onToggleCalendar={vi.fn()} calendarEnabled onPushCalendar={onPushCalendar} />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "calendarPush") }));
    expect(onPushCalendar).toHaveBeenCalledTimes(1);
  });

  test("shows the Pull button only when calendarEnabled and calls onPullCalendar", () => {
    const onPullCalendar = vi.fn();
    const { rerender } = render(
      <ResourcesPanel {...baseProps} view="workload" m365Configured onToggleCalendar={vi.fn()} calendarEnabled onPushCalendar={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: t("en-US", "calendarPull") })).toBeNull();

    rerender(
      <ResourcesPanel {...baseProps} view="workload" m365Configured onToggleCalendar={vi.fn()} calendarEnabled onPullCalendar={onPullCalendar} />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "calendarPull") }));
    expect(onPullCalendar).toHaveBeenCalledTimes(1);
  });
});

test("custom calendar view has a Today button that resets to the current month", () => {
  render(<ResourcesPanel {...baseProps} view="calendar" today="2026-06-15" />);
  // Switch to custom mode via the SegmentedControl option labelled "Custom"
  fireEvent.click(screen.getByRole("radio", { name: /custom/i }));
  const todayBtn = screen.getByRole("button", { name: /today|heute/i });
  fireEvent.click(todayBtn);
  const from = screen.getByLabelText(/from|von/i) as HTMLInputElement;
  expect(from.value).toBe("2026-06-01");
});

test("calendar view lists directory resources that have no tasks/absences/shifts", () => {
  // A resource added to the directory must appear as a calendar row even with
  // zero activity, so the user can click a cell to book their first absence
  // (chicken-and-egg: previously rows were seeded only from tasks/absences/shifts).
  render(<ResourcesPanel {...baseProps} view="calendar" today="2026-05-23" />);
  expect(screen.getByRole("button", { name: "Alex Example" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mateo Rossi" })).toBeInTheDocument();
});

test("resources-panel: no view SegmentedControl, no roles/report/add-absence buttons; resizable", () => {
  const src = readFileSync(join(__dirname, "resources-panel.tsx"), "utf8");
  expect(src).not.toMatch(/onManageRoles/);
  expect(src).not.toMatch(/onOpenReport/);
  expect(src).toMatch(/VIEW_PANE_RESIZABLE_CLASS/);
});

test("A1: calendar view root uses VIEW_PANE_RESIZABLE_CLASS (full resizable pane, not the half-size centered pane)", () => {
  const { container } = render(<ResourcesPanel {...baseProps} view="calendar" today="2026-06-15" />);
  const root = container.firstElementChild as HTMLElement;
  // Calendar was switched from CENTERED_HALF_PANE_CLASS to VIEW_PANE_RESIZABLE_CLASS so it
  // matches every other sibling resource view in size.
  expect(root.className).toContain("resize");
  expect(root.className).not.toContain("mx-auto");
  expect(root.className).not.toContain("w-[50%]");
});

test("workload view root does NOT use the centered half-pane class", () => {
  const { container } = render(<ResourcesPanel {...baseProps} view="workload" />);
  const root = container.firstElementChild as HTMLElement;
  expect(root.className).not.toContain("mx-auto");
});

test("planning view: capacity-days column header has an InfoTooltip (no native title on th)", () => {
  const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
  render(<ResourcesPanel {...baseProps} view="planning" resources={[]} plan={plan} workdayHours={8}
    onSetUtilization={() => {}} onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
  // InfoTooltip renders a focusable span with role=button whose accessible name is the hint text.
  expect(screen.getByRole("button", { name: t("en-US", "resourcesCapacityDaysHint") })).toBeInTheDocument();
});

test("planning view: per-cell utilization input still has native title (intentionally left)", () => {
  const resources = [{ id: 1, firstName: "Sample", lastName: "", roleId: null, utilizationMode: "percent" as const, utilization: {} }];
  const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
  render(<ResourcesPanel {...baseProps} view="planning" resources={resources} plan={plan} workdayHours={8}
    onSetUtilization={() => {}} onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
  const utilInput = screen.getByLabelText("Utilization for Sample in 2026-02");
  expect(utilInput.getAttribute("title")).toBe(t("en-US", "resourcesUtilizationHint"));
});
