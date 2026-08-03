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
    // Shape AND name. `span.rounded-full` alone fails `return null` but NOT the
    // dropping of `label` from <RagDot>, which sends Dot down its aria-hidden
    // branch and silently strips the accessible name from every open row's
    // Health cell (verified by mutation — both assertions passed without it).
    expect(
      container.querySelector('span.rounded-full[role="img"][aria-label="On track"]'),
    ).not.toBeNull();
  });

  // ★★ The INCONSISTENT pair: status "Done" with no completedDate. AGENTS.md
  // records that `migrateTask` deliberately does NOT repair it — it short-
  // circuits on a valid-but-inconsistent status — so an imported or hand-edited
  // blob can carry it. `isTaskDelivered` is `!!completedDate`, so such a row now
  // renders the CROSS where it used to render the check.
  //
  // Pinned as correct rather than "fixed": completedDate is the field that
  // answers "was this delivered?", and there is no date to show. The stale half
  // is the TOOLTIP — computeTaskHealth reads `status`, so it still says
  // "completed" while the glyph says otherwise. That contradiction lives in the
  // health engine, not here; recorded as an open follow-up.
  test("a Done task with NO completedDate renders the cross — it was never delivered", () => {
    const { container } = render(
      <TaskStatusGlyph
        task={makeTask({ status: "Done" })}
        health={GREEN_HEALTH}
        label="Completed"
      />,
    );
    expect(container.textContent).toContain("✕");
    expect(container.textContent).not.toContain("✓");
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
    expect(
      container.querySelector('span.rounded-full[role="img"][aria-label="Manual override"]'),
    ).not.toBeNull();
  });
});
