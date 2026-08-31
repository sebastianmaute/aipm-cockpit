import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ResourceWorkload, WORKLOAD_COL_WIDTHS } from "./resource-workload";
import { ConfirmProvider } from "./confirm-dialog";
import { t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";
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
    const tasks: Task[] = [{ id: 9, taskName: "T", assignee: "Bob Lee", assigneeEmail: "bob@x.com", dueDate: "2026-12-31", lastUpdateDate: "2026-01-01", status: "To Do", priority: "Medium", blockers: "", description: "", inquiriesSent: 0 }];
    render(<ResourceWorkload {...baseProps} tasks={tasks} onAddResource={onAddResource} />);
    expect(screen.getByText("Bob Lee")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add as resource/i }));
    expect(onAddResource).toHaveBeenCalledWith(expect.objectContaining({ firstName: "Bob", lastName: "Lee", email: "bob@x.com" }));
  });

  it("no clear-unlinked (×) button without onClearUnlinked", () => {
    const tasks: Task[] = [{ id: 9, taskName: "T", assignee: "Bob Lee", assigneeEmail: "bob@x.com", dueDate: "2026-12-31", lastUpdateDate: "2026-01-01", status: "To Do", priority: "Medium", blockers: "", description: "", inquiriesSent: 0 }];
    render(<ResourceWorkload {...baseProps} tasks={tasks} />);
    expect(screen.queryByRole("button", { name: /clear bob lee/i })).toBeNull();
  });

  it("clears an unlinked row via confirm → onClearUnlinked with the row identity", async () => {
    const onClearUnlinked = vi.fn();
    const tasks: Task[] = [{ id: 9, taskName: "T", assignee: "Bob Lee", assigneeEmail: "bob@x.com", dueDate: "2026-12-31", lastUpdateDate: "2026-01-01", status: "To Do", priority: "Medium", blockers: "", description: "", inquiriesSent: 0 }];
    render(
      <ConfirmProvider lang="en-US">
        <ResourceWorkload {...baseProps} tasks={tasks} onClearUnlinked={onClearUnlinked} />
      </ConfirmProvider>,
    );
    // ★ This clear DELETES absences and shifts outright, so it must keep the
    // destructive affordance. `hover:text-ui-pink-strong` is unique to IconButton's
    // `danger` recipe; the neutral `ghost` default would carry `hover:text-foreground`.
    expect(screen.getByRole("button", { name: /clear bob lee/i }).className).toMatch(
      /\bhover:text-ui-pink-strong\b/,
    );
    fireEvent.click(screen.getByRole("button", { name: /clear bob lee/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^confirm$/i }));
    await waitFor(() =>
      expect(onClearUnlinked).toHaveBeenCalledWith(expect.objectContaining({ display: "Bob Lee", email: "bob@x.com", firstName: "Bob", lastName: "Lee" })),
    );
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
    expect(input.className).toContain("text-ui-pink-strong");
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

  // WCAG 2.4.6 — every unlinked row renders an "Add as resource" button whose
  // accessible name came from its CONTENT alone, so N unlinked assignees
  // announced one name (open-followups §276). The row's identity sits in a
  // SIBLING <span>, outside the button, so nothing disambiguated it.
  //
  // ★★ `requireCollisionSeed` is deliberately OFF, and it is not merely
  // unnecessary here — it would throw. `row.display` is structurally unique
  // within the rendered list: `buildResourceWorkload` accumulates unlinked rows
  // into a Map keyed on `display.toLowerCase()`, so two rows cannot carry the
  // same display name (not even in different case), and the " (N)" occurrence
  // suffix the guard looks for can never be emitted on this surface. A plain
  // qualifier is therefore sufficient, and `buildRowTokens` would be dead code.
  //
  // ★ The fixture is still collision-BEARING for the defect under test: before
  // the fix BOTH buttons are named exactly "Add as resource".
  //
  // ★★★ THE SHIFT FIXTURE IS LOAD-BEARING AND IS **NOT** PART OF THE DEFECT
  // UNDER TEST. Every row — managed and unlinked alike — renders a weekly-hours
  // button whose accessible name is its CONTENT, i.e. the bare hours number, so
  // any two rows on the same contracted hours share the name "40". That is a
  // REAL, still-open 2.4.6 collision of its own, outside the §276 site list and
  // deliberately NOT fixed here: qualifying it is not mechanical, because WCAG
  // 2.5.3 requires the visible "40" to survive inside whatever name replaces it.
  // The assertion below is whole-document (the shared helper's default) and no
  // DOM container holds the unlinked rows alone — they are sibling <tr>s with no
  // wrapper — so it cannot be narrowed around that collision. Giving the two
  // unlinked people distinct part-time shifts makes the three hours buttons
  // genuinely distinct instead, which isolates this test to the add-as-resource
  // control. If the hours button is ever qualified, these shifts can go.
  it("gives every unlinked row's add-as-resource button a row-unique name (§276)", () => {
    const unlinkedTasks = [
      { id: 41, taskName: "Draft SOW", assignee: "Alice Smith", dueDate: "2026-07-01" },
      { id: 42, taskName: "Review SOW", assignee: "Bob Jones", dueDate: "2026-07-02" },
    ] as unknown as Task[];
    const partTime = [
      { id: 1, assignee: "Alice Smith", hoursPerWeekday: [8, 8, 8, 8, 0, 0, 0] },
      { id: 2, assignee: "Bob Jones", hoursPerWeekday: [8, 8, 8, 0, 0, 0, 0] },
    ] as unknown as React.ComponentProps<typeof ResourceWorkload>["shifts"];
    render(<ResourceWorkload {...baseProps} tasks={unlinkedTasks} shifts={partTime} />);
    // Both unlinked rows reached the table — otherwise the assertion below is
    // about a list that never rendered.
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 6 });
  });
});
