import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ResourceWorkload, WORKLOAD_COL_WIDTHS } from "./resource-workload";
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
  colResize,
};

describe("ResourceWorkload", () => {
  it("clicking a managed resource's name opens the editor", () => {
    const onEditResource = vi.fn();
    render(<ResourceWorkload {...baseProps} tasks={[]} onEditResource={onEditResource} />);
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEditResource).toHaveBeenCalledWith(r);
  });

  it("offers Add as resource for an unlinked assignee and seeds the name", () => {
    const onAddResource = vi.fn();
    const tasks: Task[] = [{ id: 9, taskName: "T", assignee: "Bob Lee", assigneeEmail: "bob@x.com", dueDate: "2026-12-31", lastUpdateDate: "2026-01-01", priority: "Medium", blockers: "", notes: "", inquiriesSent: 0 }];
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
});
