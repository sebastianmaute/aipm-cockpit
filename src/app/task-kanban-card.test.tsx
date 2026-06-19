import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskKanbanCard } from "./task-kanban-card";
import type { Task } from "./types";

const taskFix = (over: Partial<Task> = {}): Task =>
  ({ id: 1, taskName: "Alpha", assignee: "Sam", assigneeEmail: "", dueDate: "2026-06-01",
     lastUpdateDate: "2026-05-01", priority: "High", blockers: "", notes: "",
     status: "In Progress", ...over }) as Task;

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
      />,
    );
    expect(screen.getByText("LOP-5")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status – Alpha" })).toBeDisabled();
  });
});
