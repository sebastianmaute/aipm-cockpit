import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ResourceWorkload, WORKLOAD_COL_WIDTHS } from "./resource-workload";
import { t } from "./i18n";
import type { Resource, Task } from "./types";

const r: Resource = { id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent", utilization: {} };
const colResize = {
  colWidths: { ...WORKLOAD_COL_WIDTHS },
  startColResize: () => {},
  resetColWidths: () => {},
};
const baseProps = {
  lang: "en-US" as const, resources: [r], absences: [], shifts: [], raid: [], raidEnabled: true, today: "2026-06-01",
  onEditResource: vi.fn(), onAddResource: vi.fn(), onEditAbsence: vi.fn(), onEditShift: vi.fn(),
  nearTermPeriodKey: null, nearTermPctByResource: new Map<number, number>(), overAllocatedPct: 100,
  onSetUtilization: vi.fn(), onReassignTask: vi.fn(), onRescheduleTask: vi.fn(),
  colResize,
};

describe("ResourceWorkload", () => {
  it("clicking a managed resource's name opens the editor", () => {
    const onEditResource = vi.fn();
    render(<ResourceWorkload {...baseProps} tasks={[]} onEditResource={onEditResource} />);
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEditResource).toHaveBeenCalledWith(r);
  });

  it("clicking a managed row fires onEditResource (RAID-style row click)", () => {
    const onEditResource = vi.fn();
    render(<ResourceWorkload {...baseProps} tasks={[]} onEditResource={onEditResource} />);
    const row = screen.getByRole("button", { name: "Alex Example" }).closest("tr")!;
    expect(row.className).toContain("cursor-pointer");
    expect(row.className).toContain("hover:bg-surface-muted");
    fireEvent.click(row);
    expect(onEditResource).toHaveBeenCalledTimes(1);
    expect(onEditResource).toHaveBeenCalledWith(r);
  });

  it("clicking the name button fires onEditResource exactly once (stopPropagation prevents double-fire)", () => {
    const onEditResource = vi.fn();
    render(<ResourceWorkload {...baseProps} tasks={[]} onEditResource={onEditResource} />);
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEditResource).toHaveBeenCalledTimes(1);
  });

  it("clicking the shift button fires onEditShift once and NOT onEditResource (stopPropagation guard)", () => {
    const onEditResource = vi.fn();
    const onEditShift = vi.fn();
    render(
      <ResourceWorkload
        {...baseProps}
        tasks={[]}
        onEditResource={onEditResource}
        onEditShift={onEditShift}
      />,
    );
    // The shift cell button lives in a managed row that also has a row-level
    // onClick; its title is the default-shift label when no shift is set.
    fireEvent.click(screen.getByTitle(t("en-US", "resourcesDefaultShift")));
    expect(onEditShift).toHaveBeenCalledTimes(1);
    expect(onEditResource).not.toHaveBeenCalled();
  });

  it("offers Add as resource for an unlinked assignee and seeds the name", () => {
    const onAddResource = vi.fn();
    const tasks: Task[] = [{ id: 9, taskName: "T", assignee: "Bob Lee", assigneeEmail: "bob@x.com", dueDate: "2026-12-31", lastUpdateDate: "2026-01-01", status: "To Do", priority: "Medium", blockers: "", notes: "", inquiriesSent: 0 }];
    render(<ResourceWorkload {...baseProps} tasks={tasks} onAddResource={onAddResource} />);
    expect(screen.getByText("Bob Lee")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add as resource/i }));
    expect(onAddResource).toHaveBeenCalledWith(expect.objectContaining({ firstName: "Bob", lastName: "Lee", email: "bob@x.com" }));
  });

  it("no longer renders its own reset-column-widths button (moved to the panel header)", () => {
    render(<ResourceWorkload {...baseProps} tasks={[]} />);
    expect(screen.queryByRole("button", { name: /reset all column widths/i })).toBeNull();
  });

  it("shows the Open RAID column when raidEnabled, hides it when not", () => {
    const { rerender } = render(<ResourceWorkload {...baseProps} tasks={[]} raidEnabled />);
    expect(screen.getByText("Open RAID")).toBeInTheDocument();
    rerender(<ResourceWorkload {...baseProps} tasks={[]} raidEnabled={false} />);
    expect(screen.queryByText("Open RAID")).toBeNull();
  });

  it("edits near-term utilization inline, calling onSetUtilization (#24)", () => {
    const onSetUtilization = vi.fn();
    render(
      <ResourceWorkload
        {...baseProps}
        tasks={[]}
        nearTermPeriodKey="2026-06"
        nearTermPctByResource={new Map([[1, 120]])}
        onSetUtilization={onSetUtilization}
      />,
    );
    const input = screen.getByLabelText(/Near-term utilization for Alex Example/i) as HTMLInputElement;
    // Over-allocated (>100%) → pink highlight.
    expect(input.className).toContain("text-AIPM-pink-strong");
    fireEvent.change(input, { target: { value: "50" } });
    expect(onSetUtilization).toHaveBeenCalledWith(1, "2026-06", 50);
  });

  it("triages an overdue task inline: reassign + reschedule (#24)", () => {
    const onReassignTask = vi.fn();
    const onRescheduleTask = vi.fn();
    const r2: Resource = { id: 2, firstName: "Ben", lastName: "Ng", roleId: null, utilizationMode: "percent", utilization: {} };
    const overdue = { id: 10, taskName: "Fix bug", assignee: "Alex Example", dueDate: "2026-01-01", resourceId: 1 } as unknown as Task;
    render(
      <ResourceWorkload
        {...baseProps}
        resources={[r, r2]}
        tasks={[overdue]}
        onReassignTask={onReassignTask}
        onRescheduleTask={onRescheduleTask}
      />,
    );
    // Overdue count is a triage trigger.
    fireEvent.click(screen.getByRole("button", { name: /Triage overdue tasks – Alex Example/i }));
    // Reassign via the resource select.
    fireEvent.change(screen.getByLabelText(/Owner – Fix bug/i), { target: { value: "2" } });
    expect(onReassignTask).toHaveBeenCalledWith(10, r2);
    // Reschedule via the date input.
    fireEvent.change(screen.getByLabelText(/Due – Fix bug/i), { target: { value: "2026-12-31" } });
    expect(onRescheduleTask).toHaveBeenCalledWith(10, "2026-12-31");
  });

  it("disables triage controls for a Jira-synced overdue task (#24)", () => {
    const overdue = { id: 10, taskName: "Fix bug", assignee: "Alex Example", dueDate: "2026-01-01", resourceId: 1, jiraKey: "PROJ-1" } as unknown as Task;
    render(<ResourceWorkload {...baseProps} tasks={[overdue]} />);
    fireEvent.click(screen.getByRole("button", { name: /Triage overdue tasks – Alex Example/i }));
    // Jira owns synced tasks — local reassign/reschedule would be reverted, so both are disabled.
    expect(screen.getByLabelText(/Owner – Fix bug/i)).toBeDisabled();
    expect(screen.getByLabelText(/Due – Fix bug/i)).toBeDisabled();
  });
});
