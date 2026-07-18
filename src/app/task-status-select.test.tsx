import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { TaskStatusSelect } from "./task-status-select";
import type { Task } from "./types";

const task: Pick<Task, "id" | "taskName" | "status" | "jiraKey"> = {
  id: 1,
  taskName: "Write spec",
  status: "To Do",
};

describe("TaskStatusSelect", () => {
  it("carries a hover affordance on the status dropdown", () => {
    const { getByRole } = render(
      <TaskStatusSelect lang="en-US" task={task} onStatusChange={vi.fn()} />,
    );
    // Palette-safe hover (TRANSITION already smooths it); mouseover changes the border.
    expect(getByRole("combobox").className).toContain("hover:border-ui-dark-blue");
  });

  it("has a row-unique accessible name", () => {
    const { getByRole } = render(
      <TaskStatusSelect lang="en-US" task={task} onStatusChange={vi.fn()} />,
    );
    expect(getByRole("combobox").getAttribute("aria-label")).toContain("Write spec");
  });
});
