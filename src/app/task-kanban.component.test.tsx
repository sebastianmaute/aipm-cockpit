import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskKanban } from "./task-kanban-board";
import type { RaidItem, Resource, Task } from "./types";

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
  // Regression: cards render OUTSIDE the table RowContextProvider, so a task
  // with RAID refs must not crash the board (RaidBadge takes props, not context).
  it("renders a RAID-linked card without crashing", () => {
    const raidByTask = new Map<number, RaidItem[]>([
      [3, [{ id: 1, category: "R", title: "R1" } as RaidItem]],
    ]);
    render(
      <TaskKanban
        lang="en-US"
        tasks={[t({ id: 3, status: "To Do" })]}
        raidByTask={raidByTask}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onJumpToRaid={vi.fn()}
      />,
    );
    expect(screen.getByTestId("kanban-card-3")).toBeInTheDocument();
  });
  // Deep-link flash (#11): cards carry data-deeplink-row and the flashed card gets
  // the outline class so useDeepLinkRowFlash can scroll + highlight it in board mode.
  it("every card carries data-deeplink-row equal to its task id", () => {
    render(
      <TaskKanban
        lang="en-US"
        tasks={[t({ id: 4, status: "To Do" }), t({ id: 5, status: "Done" })]}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("kanban-card-4").getAttribute("data-deeplink-row")).toBe("4");
    expect(screen.getByTestId("kanban-card-5").getAttribute("data-deeplink-row")).toBe("5");
  });
  it("flashId outlines only the matching card", () => {
    render(
      <TaskKanban
        lang="en-US"
        tasks={[t({ id: 4, status: "To Do" }), t({ id: 5, status: "Done" })]}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        flashId={4}
      />,
    );
    expect(screen.getByTestId("kanban-card-4").className).toContain("outline-ui-green");
    expect(screen.getByTestId("kanban-card-5").className).not.toContain("outline-ui-green");
  });
  it("no card is outlined when flashId is omitted", () => {
    render(
      <TaskKanban
        lang="en-US"
        tasks={[t({ id: 4, status: "To Do" })]}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("kanban-card-4").className).not.toContain("outline-ui-green");
  });
  // Inline "Ask Claude" (SP1 board wiring): the board must not crash on a
  // RAID-linked card (renders OUTSIDE RowContextProvider) AND must surface the
  // per-card trigger when enabled, wired straight to onAiEdit.
  it("shows the Ask Claude trigger on a RAID-linked card and fires onAiEdit", () => {
    const onAiEdit = vi.fn();
    const raidByTask = new Map<number, RaidItem[]>([
      [3, [{ id: 1, category: "R", title: "R1" } as RaidItem]],
    ]);
    const task = t({ id: 3, status: "To Do" });
    render(
      <TaskKanban
        lang="en-US"
        tasks={[task]}
        raidByTask={raidByTask}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onJumpToRaid={vi.fn()}
        onAiEdit={onAiEdit}
        aiEditEnabled={() => true}
      />,
    );
    expect(screen.getByTestId("kanban-card-3")).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: /ask claude/i });
    fireEvent.click(trigger);
    expect(onAiEdit).toHaveBeenCalledWith(task);
  });
  // Stale FK+cache: a card whose task links to a renamed resource must show the
  // resource's LIVE name (via resourcesById), not its stale cached assignee.
  it("shows the live resource name on a linked card, not the stale cached assignee", () => {
    const resourcesById = new Map<number, Resource>([
      [7, { id: 7, firstName: "Correct", lastName: "Name", roleId: null, utilizationMode: "percent", utilization: {} }],
    ]);
    render(
      <TaskKanban
        lang="en-US"
        tasks={[t({ id: 3, status: "To Do", assignee: "Old Removed", resourceId: 7 })]}
        resourcesById={resourcesById}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText("Correct Name")).toBeInTheDocument();
    expect(screen.queryByText("Old Removed")).not.toBeInTheDocument();
  });
  it("omits the Ask Claude trigger when aiEditEnabled returns false", () => {
    render(
      <TaskKanban
        lang="en-US"
        tasks={[t({ id: 4, status: "To Do" })]}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onAiEdit={vi.fn()}
        aiEditEnabled={() => false}
      />,
    );
    expect(screen.queryByRole("button", { name: /ask claude/i })).not.toBeInTheDocument();
  });
});
