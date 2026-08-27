import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { TaskStatusSelect } from "./task-status-select";
import { t } from "./i18n";
import type { Task } from "./types";

const task: Pick<Task, "id" | "taskName" | "status" | "jiraKey"> = {
  id: 1,
  taskName: "Write spec",
  status: "To Do",
};

describe("TaskStatusSelect", () => {
  it("carries a hover affordance on the status dropdown", () => {
    const { getByRole } = render(
      <TaskStatusSelect lang="en-US" task={task} rowToken={task.taskName} onStatusChange={vi.fn()} />,
    );
    // Palette-safe hover (TRANSITION already smooths it); mouseover changes the border.
    expect(getByRole("combobox").className).toContain("hover:border-ui-dark-blue");
  });

  // ★★ THE TOKEN MUST DIFFER FROM `task.taskName`, and that is the whole test.
  // With `rowToken={task.taskName}` this rendered a byte-identical label whether
  // the component honoured the prop or ignored it, so the one-token mutation
  // `rowLabel(t(lang, "colTaskStatus"), task.taskName)` — i.e. dropping
  // `rowToken` entirely — stayed GREEN. A collision-suffixed token is what the
  // list owner actually passes for a duplicate title, and it is the only fixture
  // shape that can observe the threading.
  it("threads the rowToken prop into the accessible name", () => {
    const { getByRole } = render(
      <TaskStatusSelect lang="en-US" task={task} rowToken="Write spec (2)" onStatusChange={vi.fn()} />,
    );
    expect(getByRole("combobox").getAttribute("aria-label")).toBe(
      `${t("en-US", "colTaskStatus")} – Write spec (2)`,
    );
  });
});
