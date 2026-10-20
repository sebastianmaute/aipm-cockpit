import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TaskLinkedTaskModal } from "./task-linked-task-modal";
import type { Resource } from "./types";

describe("TaskLinkedTaskModal", () => {
  it("collects a child-task draft + direction and calls onCreate", () => {
    const onCreate = vi.fn();
    render(
      <TaskLinkedTaskModal lang="en-US" today="2026-07-10" onCreate={onCreate} onClose={() => {}} resources={[]} contacts={[]} />,
    );
    fireEvent.change(screen.getByLabelText(/^task name$/i), { target: { value: "Child task" } });
    fireEvent.change(screen.getByLabelText(/link direction/i), { target: { value: "successor" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(onCreate).toHaveBeenCalledWith({
      taskName: "Child task",
      assignee: "",
      assigneeEmail: "",
      resourceId: null,
      dueDate: "2026-07-10",
      priority: "Medium",
      direction: "successor",
    });
  });

  it("does not create with a blank task name", () => {
    const onCreate = vi.fn();
    render(
      <TaskLinkedTaskModal lang="en-US" today="2026-07-10" onCreate={onCreate} onClose={() => {}} resources={[]} contacts={[]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(onCreate).not.toHaveBeenCalled();
  });

  // §758 — the assignee is picked from the directory, so a person carries their resource link and email.
  it("creates the linked task with a person picked from the directory", () => {
    const onCreate = vi.fn();
    const ada = { id: 5, firstName: "Ada", lastName: "Lovelace", email: "ada@x.io", roleId: null, utilizationMode: "percent", utilization: {} } as unknown as Resource;
    render(
      <TaskLinkedTaskModal lang="en-US" today="2026-07-10" onCreate={onCreate} onClose={() => {}} resources={[ada]} contacts={[]} />,
    );
    fireEvent.change(screen.getByLabelText(/^task name$/i), { target: { value: "Child" } });
    const assignee = screen.getByRole("combobox", { name: /^assignee$/i });
    fireEvent.focus(assignee);
    fireEvent.change(assignee, { target: { value: "Ada" } });
    // The picker selects on mousedown, before the input's blur closes it (as resource-picker.test.tsx drives it).
    fireEvent.mouseDown(within(screen.getByRole("option", { name: /Ada Lovelace/ })).getByRole("button"));
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ assignee: "Ada Lovelace", assigneeEmail: "ada@x.io", resourceId: 5 }));
  });

  it("defaults the direction to predecessor", () => {
    const onCreate = vi.fn();
    render(
      <TaskLinkedTaskModal lang="en-US" today="2026-07-10" onCreate={onCreate} onClose={() => {}} resources={[]} contacts={[]} />,
    );
    fireEvent.change(screen.getByLabelText(/^task name$/i), { target: { value: "Child" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ direction: "predecessor" }));
  });
});
