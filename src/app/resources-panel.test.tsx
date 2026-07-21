import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResourcesPanel } from "./resources-panel";
import { t } from "./i18n";
import { expectButtonOrder } from "../test/toolbar-order";
import type { Resource, Task } from "./types";

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

  test("planning date inputs use the taller md control height (py-2 text-sm)", () => {
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" resources={[]} plan={plan} workdayHours={8}
      onSetUtilization={() => {}} onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    const from = screen.getByLabelText("From");
    expect(from.className).toContain("py-2");
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

  test("T14: capacity-hours column renders a per-row total and a footer sum", () => {
    // Feb 2026 monthly = 20 workdays × 8h = 160h at 100% utilization.
    const resources = [{ id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent" as const, utilization: { "2026-02": 100 } }];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" lang="en-US" resources={resources} plan={plan}
      workdayHours={8} holidaySet={new Set()} onSetUtilization={() => {}}
      onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    // Column header present.
    expect(screen.getByText(t("en-US", "planningCapacityHours"))).toBeInTheDocument();
    // 160.0 appears once in the data row and once in the footer total (capacity
    // days shows 20.0, so no collision on 160.0).
    expect(screen.getAllByText("160.0").length).toBeGreaterThanOrEqual(2);
  });

  test("T4: toggling 'Hide external' removes external resources from the planning rows", () => {
    const resources = [
      { id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent" as const, utilization: {} },
      { id: 2, firstName: "Bob", lastName: "Ext", roleId: null, isExternal: true, utilizationMode: "percent" as const, utilization: {} },
    ];
    const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
    render(<ResourcesPanel {...baseProps} view="planning" lang="en-US" resources={resources} plan={plan}
      workdayHours={8} holidaySet={new Set()} onSetUtilization={() => {}}
      onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />);
    // Both resources render initially.
    expect(screen.getByText(/Alex Example/)).toBeInTheDocument();
    expect(screen.getByText(/Bob Ext/)).toBeInTheDocument();
    // Toggle "Hide external": the external resource disappears, the internal stays.
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "planningHideExternal") }));
    expect(screen.getByText(/Alex Example/)).toBeInTheDocument();
    expect(screen.queryByText(/Bob Ext/)).not.toBeInTheDocument();
  });

  // Workload lists the same people as planning but had no way to drop
  // contractors, so a team with many externals could not be read at a glance.
  //
  // ★★ The external MUST own work here. `buildResourceWorkload` builds its
  // managed/name lookups from the `resources` argument ALONE, so filtering that
  // argument does not hide the external — it makes their tasks miss both
  // lookups and fall through to `ensureUnlinked`, re-rendering them under
  // "Unlinked", whose "Clear unlinked" control DELETES matching absences and
  // shifts outright. With a work-less fixture nothing reaches that path and the
  // test passes for the wrong reason.
  test("toggling 'Hide external' hides the external entirely — never as an unlinked row", () => {
    const resources = [
      { id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent" as const, utilization: {} },
      { id: 2, firstName: "Bob", lastName: "Ext", roleId: null, isExternal: true, utilizationMode: "percent" as const, utilization: {} },
    ];
    const tasks = [
      { id: 1, title: "Ext work", assignee: "Bob Ext", resourceId: 2, status: "To Do" as const },
      { id: 2, title: "Int work", assignee: "Alex Example", resourceId: 1, status: "To Do" as const },
    ] as unknown as Task[];
    render(<ResourcesPanel {...baseProps} view="workload" lang="en-US" resources={resources} tasks={tasks} />);
    expect(screen.getByText(/Alex Example/)).toBeInTheDocument();
    expect(screen.getByText(/Bob Ext/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "planningHideExternal") }));
    expect(screen.getByText(/Alex Example/)).toBeInTheDocument();
    // Absent from the WHOLE pane — not merely moved into the Unlinked section.
    expect(screen.queryByText(/Bob Ext/)).not.toBeInTheDocument();
  });

  // The count sits beside the toggle, so a static count reads as a bug even
  // though the mismatch predates the toggle.
  test("the workload header count tracks the Hide-external toggle", () => {
    const resources = [
      { id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent" as const, utilization: {} },
      { id: 2, firstName: "Bob", lastName: "Ext", roleId: null, isExternal: true, utilizationMode: "percent" as const, utilization: {} },
    ];
    render(<ResourcesPanel {...baseProps} view="workload" lang="en-US" resources={resources} />);
    const heading = () => screen.getByRole("heading", { name: /workload/i });
    expect(heading().textContent).toContain(t("en-US", "tasksCount", 2));
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "planningHideExternal") }));
    expect(heading().textContent).toContain(t("en-US", "tasksCount", 1));
  });

  // ★ DELIBERATE, pinned so it stays a decision rather than drifting: hiding
  // externals is a DISPLAY filter, so it must not narrow the reassign picker's
  // target list. A display toggle silently removing valid assignment targets is
  // the same class of bug as the filtered list that fed buildResourceWorkload —
  // and the full list is what keeps `resources` complete for that builder.
  test("'Hide external' does not remove externals as reassign targets", () => {
    const resources = [
      { id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent" as const, utilization: {} },
      { id: 2, firstName: "Bob", lastName: "Ext", roleId: null, isExternal: true, utilizationMode: "percent" as const, utilization: {} },
    ];
    // An OVERDUE task renders the triage row that carries the reassign picker.
    const tasks = [
      { id: 1, title: "Late work", assignee: "Alex Example", resourceId: 1, dueDate: "2026-01-01", status: "To Do" as const },
    ] as unknown as Task[];
    render(<ResourcesPanel {...baseProps} view="workload" lang="en-US" resources={resources} tasks={tasks} />);
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "planningHideExternal") }));
    // Bob is gone from the ROWS…
    expect(screen.queryByText(/Bob Ext/)).not.toBeInTheDocument();
    // …but is still offered as a reassign target. The picker lives in a popover
    // opened from the row's overdue count.
    fireEvent.click(
      screen.getByRole("button", { name: `${t("en-US", "workloadTriageOverdue")} – Alex Example` }),
    );
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Bob Ext");
  });

  // The same toggle element now renders in two views. Only one view mounts at a
  // time, so its accessible name must never collide — two controls sharing one
  // name in a scanned view is a WCAG 2.4.6 failure that axe can pass when only
  // one of them happens to render.
  test.each(["workload", "planning"] as const)(
    "renders exactly one 'Hide external' checkbox in the %s view",
    (view) => {
      const plan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
      render(
        <ResourcesPanel {...baseProps} view={view} lang="en-US" plan={plan}
          workdayHours={8} holidaySet={new Set()} onSetUtilization={() => {}}
          onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />,
      );
      expect(screen.getAllByRole("checkbox", { name: t("en-US", "planningHideExternal") })).toHaveLength(1);
    },
  );

  // The Outlook sync block sat BETWEEN reset-columns and reset-size, splitting
  // a trailing group that reads as one everywhere else in the app.
  // ★ `headerActions` is ONE element shared by all three views, so each view is
  // covered separately: planning swaps in a different reset-columns handler and
  // calendar drops reset-columns entirely while adding the Outlook-import
  // button ahead of the group.
  const PLAN = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month" as const, currency: "EUR" };
  const calendarProps = {
    m365Configured: true, calendarEnabled: true,
    onToggleCalendar: () => {}, onPushCalendar: () => {},
  };

  test.each(["workload", "planning"] as const)(
    "keeps Print / reset-columns / reset-size contiguous after the Outlook controls — %s",
    (view) => {
      render(
        <ResourcesPanel {...baseProps} view={view} lang="en-US" plan={PLAN} {...calendarProps}
          workdayHours={8} holidaySet={new Set()} onSetUtilization={() => {}}
          onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />,
      );
      // Outlook only has to come BEFORE the group…
      expectButtonOrder(["calendarPush", "printHint"]);
      // …but the group itself must be ADJACENT — ordering alone would still pass
      // with a stray control wedged between two of its members, which is the
      // exact drift this test exists to catch.
      expectButtonOrder(["printHint", "colResetWidthsHint", "tableResetSizeHint"], { contiguous: true });
    },
  );

  // Calendar renders NO reset-columns button, and its Outlook-import button
  // leads the whole group.
  test("orders the calendar control row: import, Outlook push, Print, reset-size", () => {
    render(
      <ResourcesPanel {...baseProps} view="calendar" lang="en-US" plan={PLAN} {...calendarProps}
        onImportOutlookCalendar={() => {}}
        workdayHours={8} holidaySet={new Set()} onSetUtilization={() => {}}
        onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />,
    );
    expectButtonOrder(["outlookCalImportButton", "calendarPush", "printHint"]);
    // Calendar's trailing group is just Print · reset-size (no reset-columns).
    expectButtonOrder(["printHint", "tableResetSizeHint"], { contiguous: true });
    expect(screen.queryByRole("button", { name: t("en-US", "colResetWidthsHint") })).toBeNull();
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

test("calendar folds a stale-cache linked task under its live resource row, not a duplicate", () => {
  // A task carries a live FK (resourceId:1 → "Alex Example") but a STALE cached
  // assignee string ("Old Name") left over from before a rename. The calendar
  // directory must attribute it to the live resource-1 row (mirroring
  // resource-workload-rows.ts `resolve`), NOT fork a duplicate "Old Name" row.
  const staleTask = {
    id: 99,
    taskName: "Task",
    assignee: "Old Name",
    assigneeEmail: "",
    resourceId: 1,
    dueDate: "",
    lastUpdateDate: "",
    priority: "Medium",
    status: "To Do",
    blockers: "",
    notes: "",
  } as unknown as Task;
  render(<ResourcesPanel {...baseProps} view="calendar" today="2026-05-23" tasks={[staleTask]} />);
  expect(screen.getByRole("button", { name: "Alex Example" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Old Name" })).toBeNull();
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
