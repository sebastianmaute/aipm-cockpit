import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskKanbanCard } from "./task-kanban-card";
import { t } from "./i18n";
import type { RaidItem, Task } from "./types";

const taskFix = (over: Partial<Task> = {}): Task =>
  ({ id: 1, taskName: "Alpha", assignee: "Sam", assigneeEmail: "", dueDate: "2026-06-01",
     lastUpdateDate: "2026-05-01", priority: "High", blockers: "", notes: "",
     status: "In Progress", ...over }) as Task;

const raidFix = (category: RaidItem["category"]): RaidItem =>
  ({ id: 1, category, title: "R1" }) as RaidItem;

describe("TaskKanbanCard", () => {
  it("shows title, assignee, and a row-unique status select", () => {
    render(
      <TaskKanbanCard
        lang="en-US"
        task={taskFix()}
        today="2026-06-19"
        holidaySet={new Set()}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onJumpToRaid={vi.fn()}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status – Alpha" })).toBeInTheDocument();
  });

  it("shows a Jira badge and disables the select when synced", () => {
    render(
      <TaskKanbanCard
        lang="en-US"
        task={taskFix({ jiraKey: "LOP-5" })}
        today="2026-06-19"
        holidaySet={new Set()}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onJumpToRaid={vi.fn()}
      />,
    );
    expect(screen.getByText("LOP-5")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status – Alpha" })).toBeDisabled();
  });

  // Regression: the board renders cards OUTSIDE the table's RowContextProvider.
  // RaidBadge must take lang/onJumpToRaid as props (not read context) so a card
  // with RAID refs renders without throwing. (Earlier impl crashed here.)
  it("renders a RAID badge from props (no RowContextProvider) and fires onJumpToRaid", () => {
    const onJumpToRaid = vi.fn();
    render(
      <TaskKanbanCard
        lang="en-US"
        task={taskFix()}
        today="2026-06-19"
        holidaySet={new Set()}
        raidRefs={[raidFix("R"), raidFix("I")]}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onJumpToRaid={onJumpToRaid}
      />,
    );
    const badge = screen.getByRole("button", { name: t("en-US", "raidReferencedBy", 2) });
    fireEvent.click(badge);
    expect(onJumpToRaid).toHaveBeenCalledWith(1);
  });
});
