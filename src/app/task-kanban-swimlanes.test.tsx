import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskKanbanSwimlanes } from "./task-kanban-swimlanes";
import type { Resource, Task } from "./types";
import { buildRowTokens } from "./row-tokens";
import { expectRowUniqueNames } from "../test/row-unique-names";

const taskFix = (over: Partial<Task> = {}): Task =>
  ({ id: 1, taskName: "Alpha", assignee: "", assigneeEmail: "", dueDate: "2026-06-01",
     lastUpdateDate: "2026-05-01", priority: "Medium", blockers: "", notes: "",
     status: "To Do", ...over }) as Task;

const resources = new Map<number, Resource>([
  [1, { id: 1, firstName: "Anna", lastName: "Jordan", roleId: null, utilizationMode: "percent", utilization: {} } as Resource],
]);

// tokens is required on TaskKanbanSwimlanes (row-unique accessible names,
// WCAG 2.4.6); these tests don't seed collisions, so an empty map is enough.
const NO_TOKENS: ReadonlyMap<number, string> = new Map();

describe("TaskKanbanSwimlanes", () => {
  it("renders a lane per person plus Unassigned", () => {
    render(
      <TaskKanbanSwimlanes
        lang="en-US"
        tasks={[taskFix({ id: 1, resourceId: 1, status: "To Do" })]}
        resourcesById={resources}
        extraLaneIds={[]}
        tokens={NO_TOKENS}
        onSwimlaneDrop={vi.fn()}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onRemoveLane={vi.fn()}
      />,
    );
    expect(screen.getByRole("region", { name: "Anna Jordan" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Unassigned" })).toBeInTheDocument();
  });

  it("each cell carries a person-and-status accessible name", () => {
    render(
      <TaskKanbanSwimlanes
        lang="en-US"
        tasks={[taskFix({ id: 1, resourceId: 1, status: "To Do" })]}
        resourcesById={resources}
        extraLaneIds={[]}
        tokens={NO_TOKENS}
        onSwimlaneDrop={vi.fn()}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onRemoveLane={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Anna Jordan – To Do")).toBeInTheDocument();
  });

  it("dropping a card calls onSwimlaneDrop with the lane and status", () => {
    const onSwimlaneDrop = vi.fn();
    render(
      <TaskKanbanSwimlanes
        lang="en-US"
        tasks={[taskFix({ id: 1, status: "To Do" })]}
        resourcesById={resources}
        extraLaneIds={[]}
        tokens={NO_TOKENS}
        onSwimlaneDrop={onSwimlaneDrop}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onRemoveLane={vi.fn()}
      />,
    );
    const cell = screen.getByTestId("swimlane-cell-unassigned-In Progress");
    fireEvent.dragOver(cell);
    fireEvent.drop(cell, { dataTransfer: { getData: () => "1" } });
    expect(onSwimlaneDrop).toHaveBeenCalledWith(1, expect.objectContaining({ key: "unassigned" }), "In Progress");
  });

  it("a Jira-synced card is not draggable", () => {
    render(
      <TaskKanbanSwimlanes
        lang="en-US"
        tasks={[taskFix({ id: 2, status: "To Do", jiraKey: "LOP-2" })]}
        resourcesById={resources}
        extraLaneIds={[]}
        tokens={NO_TOKENS}
        onSwimlaneDrop={vi.fn()}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onRemoveLane={vi.fn()}
      />,
    );
    expect(screen.getByTestId("swimlane-card-2")).toHaveAttribute("draggable", "false");
  });

  // NOT converted on purpose: both assertions below are `.not.toBeInTheDocument()`
  // — this block renders ZERO remove-lane controls, so it is a visibility-gating
  // test, not a distinctness one. `expectRowUniqueNames` needs ≥1 rendered
  // control to say anything at all; forcing it here would either throw (no
  // controls to check) or check nothing. Skip on future sweeps of this bucket.
  it("shows a row-unique remove-lane control only for an empty linked lane", () => {
    const onRemoveLane = vi.fn();
    render(
      <TaskKanbanSwimlanes
        lang="en-US"
        tasks={[taskFix({ id: 1, resourceId: 1, status: "To Do" })]}
        resourcesById={resources}
        extraLaneIds={[]}
        tokens={NO_TOKENS}
        onSwimlaneDrop={vi.fn()}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onRemoveLane={onRemoveLane}
      />,
    );
    // Anna Jordan's lane has a task in it -> no remove control.
    expect(screen.queryByRole("button", { name: /remove lane.*anna Jordan/i })).not.toBeInTheDocument();
    // Unassigned is never linked (resourceId === null) -> no remove control either.
    expect(screen.queryByRole("button", { name: /remove lane/i })).not.toBeInTheDocument();
  });

  it("shows a remove-lane control for an empty extra lane and fires onRemoveLane with its resourceId", () => {
    const onRemoveLane = vi.fn();
    render(
      <TaskKanbanSwimlanes
        lang="en-US"
        tasks={[]}
        resourcesById={resources}
        extraLaneIds={[1]}
        tokens={NO_TOKENS}
        onSwimlaneDrop={vi.fn()}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onRemoveLane={onRemoveLane}
      />,
    );
    const removeBtn = screen.getByRole("button", { name: "Remove lane – Anna Jordan" });
    fireEvent.click(removeBtn);
    expect(onRemoveLane).toHaveBeenCalledWith(1);
  });

  // The per-column badge/card tests (task-kanban-card.test.tsx) cannot reach
  // this case: a per-COLUMN fixture puts both twins in the SAME lane, so their
  // cards never sit side by side with a peer sharing their exact name outside
  // that lane. Seeding the twins in DIFFERENT lanes (distinct resourceId, both
  // present in resourcesById so `laneResourceIdOf` resolves each to its own
  // `res:<id>` lane rather than falling through to a shared Unassigned one)
  // is the shape only the swimlane surface can exercise.
  it("keeps names unique when same-named tasks sit in DIFFERENT lanes", () => {
    const twinResources = new Map<number, Resource>([
      [10, { id: 10, firstName: "Ivy", lastName: "Nkemelu", roleId: null, utilizationMode: "percent", utilization: {} } as Resource],
      [20, { id: 20, firstName: "Omar", lastName: "Reyes", roleId: null, utilizationMode: "percent", utilization: {} } as Resource],
    ]);
    const twins = [
      taskFix({ id: 1, taskName: "Alpha", resourceId: 10, status: "To Do" }),
      taskFix({ id: 2, taskName: "Alpha", resourceId: 20, status: "To Do" }),
    ];
    const { container } = render(
      <TaskKanbanSwimlanes
        lang="en-US"
        tasks={twins}
        resourcesById={twinResources}
        extraLaneIds={[]}
        tokens={buildRowTokens(twins.map((task) => ({ id: task.id, name: task.taskName })))}
        onSwimlaneDrop={vi.fn()}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onRemoveLane={vi.fn()}
      />,
    );
    expectRowUniqueNames({
      minControls: 4,
      scope: container,
      roles: ["button", "combobox"],
      requireCollisionSeed: true,
    });
  });

  it("does not throw calling useTaskRowContext-free (renders outside RowContextProvider)", () => {
    expect(() =>
      render(
        <TaskKanbanSwimlanes
          lang="en-US"
          tasks={[taskFix({ id: 1, status: "To Do" })]}
          resourcesById={resources}
          extraLaneIds={[]}
          tokens={NO_TOKENS}
          onSwimlaneDrop={vi.fn()}
          onStatusChange={vi.fn()}
          onEdit={vi.fn()}
          onRemoveLane={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });
});

describe("TaskKanbanSwimlanes column sizing", () => {
  it("status cells carry the shared flex-fill class from task-kanban-board", () => {
    render(
      <TaskKanbanSwimlanes
        lang="en-US"
        tasks={[]}
        resourcesById={new Map()}
        extraLaneIds={[]}
        tokens={NO_TOKENS}
        onSwimlaneDrop={vi.fn()}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onRemoveLane={vi.fn()}
        assignableResources={[]}
        onAssign={vi.fn()}
      />,
    );
    const cell = screen.getByTestId("swimlane-cell-unassigned-To Do");
    expect(cell.className).toContain("min-w-64");
    expect(cell.className).toContain("max-w-[25rem]");
    expect(cell.className).toContain("flex-1");
    expect(cell.className).toContain("shrink-0");
  });
});
