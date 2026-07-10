import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskLinkedTaskModal } from "./task-linked-task-modal";

describe("TaskLinkedTaskModal", () => {
  it("collects a child-task draft + direction and calls onCreate", () => {
    const onCreate = vi.fn();
    render(
      <TaskLinkedTaskModal lang="en-US" today="2026-07-10" onCreate={onCreate} onClose={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText(/^task name$/i), { target: { value: "Child task" } });
    fireEvent.change(screen.getByLabelText(/link direction/i), { target: { value: "successor" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(onCreate).toHaveBeenCalledWith({
      taskName: "Child task",
      assignee: "",
      dueDate: "2026-07-10",
      priority: "Medium",
      direction: "successor",
    });
  });

  it("does not create with a blank task name", () => {
    const onCreate = vi.fn();
    render(
      <TaskLinkedTaskModal lang="en-US" today="2026-07-10" onCreate={onCreate} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("defaults the direction to predecessor", () => {
    const onCreate = vi.fn();
    render(
      <TaskLinkedTaskModal lang="en-US" today="2026-07-10" onCreate={onCreate} onClose={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText(/^task name$/i), { target: { value: "Child" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ direction: "predecessor" }));
  });
});
