import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskKanban } from "./task-kanban-board";
import type { Task } from "./types";

const t = (over: Partial<Task>): Task =>
  ({ id: 1, taskName: "Alpha", assignee: "", assigneeEmail: "", dueDate: "2026-06-01",
     lastUpdateDate: "2026-05-01", priority: "Medium", blockers: "", notes: "",
     status: "To Do", ...over }) as Task;

describe("TaskKanban", () => {
  it("renders all six status columns", () => {
    render(<TaskKanban lang="en-US" tasks={[]} onStatusChange={vi.fn()} onEdit={vi.fn()} />);
    for (const label of ["To Do", "In Progress", "On Hold", "In Review", "Cancelled", "Done"])
      expect(screen.getByRole("heading", { name: new RegExp(label) })).toBeInTheDocument();
  });
  it("dropping a card on a column calls onStatusChange(id, columnStatus)", () => {
    const onStatusChange = vi.fn();
    render(<TaskKanban lang="en-US" tasks={[t({ id: 7, status: "To Do" })]} onStatusChange={onStatusChange} onEdit={vi.fn()} />);
    const col = screen.getByTestId("kanban-col-In Progress");
    fireEvent.dragOver(col);
    fireEvent.drop(col, { dataTransfer: { getData: () => "7" } });
    expect(onStatusChange).toHaveBeenCalledWith(7, "In Progress");
  });
  it("a synced card is not draggable", () => {
    render(<TaskKanban lang="en-US" tasks={[t({ id: 9, jiraKey: "LOP-9" })]} onStatusChange={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByTestId("kanban-card-9").getAttribute("draggable")).toBe("false");
  });
});
