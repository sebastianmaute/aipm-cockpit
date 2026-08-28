import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskKanbanSwimlanes } from "./task-kanban-swimlanes";
import type { Resource, Task } from "./types";
import { buildRowTokens } from "./row-tokens";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { indexDocumentsByEntity } from "./document-ref";

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
  // ★ THAT IS THE SINGLE-LANE CASE ONLY, and reading it as "this surface has no
  // controls to check" is what left the lane-name collision uncovered. TWO empty
  // twin lanes render TWO remove buttons — see "gives twin same-named lanes
  // distinct remove-lane names" below, which does use the helper.
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

  // ★★★ THE REMOVE CONTROL ONLY RENDERS ON AN EMPTY LINKED LANE
  // (`canRemove = lane.resourceId != null && isEmptyLane`), so the twins have to
  // arrive via `extraLaneIds` with ZERO tasks between them. Seeding a task on
  // either lane renders no button there, and the assertion would then observe
  // nothing while passing.
  //
  // ★★ THE LANE COLLISION AXIS IS THE PERSON'S NAME, NOT THE TASK'S — two
  // directory resources can genuinely share a display name, and the lane label
  // is the LIVE directory name (`effectiveAssignee`), so nothing upstream
  // disambiguates it. The `tokens` prop is a TASK-token map and is irrelevant
  // here: it names cards, not lanes.
  it("gives twin same-named lanes distinct remove-lane names", () => {
    const twinResources = new Map<number, Resource>([
      [1, { id: 1, firstName: "John", lastName: "Smith", roleId: null, utilizationMode: "percent", utilization: {} } as Resource],
      [2, { id: 2, firstName: "John", lastName: "Smith", roleId: null, utilizationMode: "percent", utilization: {} } as Resource],
    ]);
    const { container } = render(
      <TaskKanbanSwimlanes
        lang="en-US"
        tasks={[]}
        resourcesById={twinResources}
        extraLaneIds={[1, 2]}
        tokens={NO_TOKENS}
        onSwimlaneDrop={vi.fn()}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onRemoveLane={vi.fn()}
      />,
    );
    // MEASURED, not guessed (floor 999, read the length of the `Rendered: [...]`
    // list the throw prints): the two remove buttons are the only controls this
    // fixture renders — no tasks means no cards, so no status selects.
    expectRowUniqueNames({
      minControls: 2,
      scope: container,
      roles: ["button"],
      requireCollisionSeed: true,
    });

    // ★ Anti-vacuity, and the mutant it kills is the realistic one: the scan
    // above proves only that the two names DIFFER, so it passes against a "fix"
    // that replaced the label with any unique nonsense (`aria-label={String(i)}`)
    // — the exact shape that resolves a collision by destroying the name. Assert
    // that each name still carries the lane's person.
    // (Unqualified `getAllByRole("button")` on purpose: as measured just above,
    // the two remove-lane buttons are the ONLY controls this fixture renders.)
    const removeNames = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(removeNames).toHaveLength(2);
    for (const n of removeNames) expect(n).toContain("John Smith");

    // The `<section>`s map to role `region`, so their duplicate names ARE
    // exposed to AT; `expectRowUniqueNames` reads controls only, so assert this
    // one directly. Three lanes: the two twins plus Unassigned.
    const regionNames = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(regionNames).toHaveLength(3);
    expect(new Set(regionNames).size).toBe(regionNames.length);

    // The per-status drop cells carry `swimlaneCell` = "{lane} – {status}", so
    // they collide on the same axis. They are `role="group"` — a role that
    // SUPPORTS naming, unlike the `generic` a bare <div> computes to, for which
    // ARIA 1.2 prohibits `aria-label` and AT drops it. That role is why the
    // query below can be role-based at all, and asserting through the role is
    // what makes this test go red if the role is ever removed and the names go
    // back to being announced to nobody. `expectRowUniqueNames` reads CONTROLS,
    // so it cannot cover `group`; assert directly.
    const cellNames = screen.getAllByRole("group").map((c) => c.getAttribute("aria-label"));
    expect(cellNames.length).toBeGreaterThan(0);
    expect(new Set(cellNames).size).toBe(cellNames.length);
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
    // One linked document per task, so DocumentBadge (count > 0) renders on
    // BOTH twins, plus onAiEdit/aiEditEnabled and assignableResources/onAssign
    // — mirroring task-kanban-card.test.tsx's own collision fixture — so this
    // test proves the SWIMLANE component's pass-through of those props, not
    // just the card's own logic (already proven there). Without them only 2
    // of the card's 4 converted sites ever render here.
    const documentsByEntity = indexDocumentsByEntity([
      { id: 40, title: "Doc 40", blocks: [], createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z", linkedEntities: [{ kind: "task", id: 1 }] },
      { id: 41, title: "Doc 41", blocks: [], createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z", linkedEntities: [{ kind: "task", id: 2 }] },
    ]);
    const assignableResources: Resource[] = [
      { id: 30, firstName: "Cara", lastName: "Diallo", roleId: null, utilizationMode: "percent", utilization: {} } as Resource,
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
        documentsByEntity={documentsByEntity}
        onOpenDocuments={vi.fn()}
        onAiEdit={vi.fn()}
        aiEditEnabled={() => true}
        assignableResources={assignableResources}
        onAssign={vi.fn()}
      />,
    );
    expectRowUniqueNames({
      minControls: 10,
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
