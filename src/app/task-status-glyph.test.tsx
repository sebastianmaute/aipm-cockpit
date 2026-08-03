import { describe, test, expect } from "vitest";
import { render } from "@testing-library/react";
import { TaskStatusGlyph } from "./task-status-glyph";
import type { TaskHealth } from "./health";
import type { Task } from "./types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Sample task",
    assignee: "Alice",
    assigneeEmail: "",
    dueDate: "2026-12-01",
    lastUpdateDate: "2026-05-18",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "",
    group: "",
    labels: [],
    dependencies: [],
    ...overrides,
  };
}

const GREEN_HEALTH: TaskHealth = { color: "G", drivers: ["onTrack"] };

describe("TaskStatusGlyph", () => {
  test("renders a cross, not a check or a dot, for a cancelled task", () => {
    const { container } = render(
      <TaskStatusGlyph
        task={makeTask({ status: "Cancelled" })}
        health={GREEN_HEALTH}
        label="Cancelled"
      />,
    );
    expect(container.textContent).toContain("✕");
    expect(container.textContent).not.toContain("✓");
    expect(container.querySelector('[role="img"][aria-label="Cancelled"]')).not.toBeNull();
  });

  test("renders a check, not a cross, for a delivered task", () => {
    const { container } = render(
      <TaskStatusGlyph
        task={makeTask({ status: "Done", completedDate: "2026-05-20" })}
        health={GREEN_HEALTH}
        label="Completed on 2026-05-20"
      />,
    );
    expect(container.textContent).toContain("✓");
    expect(container.textContent).not.toContain("✕");
  });

  test("renders neither glyph for an open task — the RagDot branch", () => {
    const { container } = render(
      <TaskStatusGlyph
        task={makeTask({ status: "To Do" })}
        health={GREEN_HEALTH}
        label="On track"
      />,
    );
    expect(container.textContent).not.toContain("✓");
    expect(container.textContent).not.toContain("✕");
    // Assert the dot POSITIVELY. Absence-only assertions pass just as happily
    // against `return null`, which would render every open row's Health cell
    // empty — and nothing else in the suite pins this branch.
    expect(container.querySelector("span.rounded-full")).not.toBeNull();
  });

  test("a cancelled task WITH a healthOverride takes the RagDot branch, not the cross", () => {
    const { container } = render(
      <TaskStatusGlyph
        task={makeTask({ status: "Cancelled", healthOverride: "R" })}
        health={{ color: "R", drivers: ["manual"] }}
        label="Manual override"
      />,
    );
    expect(container.textContent).not.toContain("✕");
    expect(container.textContent).not.toContain("✓");
    expect(container.querySelector("span.rounded-full")).not.toBeNull();
  });
});
