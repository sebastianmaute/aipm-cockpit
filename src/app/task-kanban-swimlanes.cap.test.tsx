import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { TaskKanbanSwimlanes } from "./task-kanban-swimlanes";
import { KANBAN_COLUMN_PAGE } from "./kanban-column-page";
import type { Resource, Task, TaskStatus } from "./types";

// §5 swimlanes (owner decision 2026-10-08): the board's column cap, per
// person × status cell. A cell renders at most KANBAN_COLUMN_PAGE cards, then a
// "Show more" button; print renders every card; a deep link reveals its card.

const task = (id: number, status: TaskStatus, resourceId?: number): Task =>
  ({ id, taskName: `Task ${id}`, assignee: "", assigneeEmail: "", dueDate: "2026-06-01",
     lastUpdateDate: "2026-05-01", priority: "Medium", blockers: "", notes: "", status,
     ...(resourceId != null ? { resourceId } : {}) }) as unknown as Task;

const tasksIn = (status: TaskStatus, n: number, from = 1, resourceId?: number): Task[] =>
  Array.from({ length: n }, (_, i) => task(from + i, status, resourceId));

const RESOURCES = new Map<number, Resource>([
  [1, { id: 1, firstName: "Anna", lastName: "Bennett", roleId: null, utilizationMode: "percent", utilization: {} } as Resource],
]);
const NO_TOKENS: ReadonlyMap<number, string> = new Map();

function lanes(tasks: Task[], flashId: number | null = null) {
  const props = {
    lang: "en-US" as const, resourcesById: RESOURCES, extraLaneIds: [], tokens: NO_TOKENS,
    onSwimlaneDrop: vi.fn(), onStatusChange: vi.fn(), onEdit: vi.fn(), onRemoveLane: vi.fn(),
  };
  const view = render(<TaskKanbanSwimlanes {...props} tasks={tasks} flashId={flashId} />);
  const rerender = (next: Task[], nextFlash: number | null = flashId) =>
    view.rerender(<TaskKanbanSwimlanes {...props} tasks={next} flashId={nextFlash} />);
  return { ...view, rerender };
}

const cell = (lane: string, status: TaskStatus) => screen.getByTestId(`swimlane-cell-${lane}-${status}`);
const cardsIn = (lane: string, status: TaskStatus) => within(cell(lane, status)).queryAllByTestId(/^swimlane-card-/);
const more = (lane: string, status: TaskStatus) => screen.queryByTestId(`swimlane-show-more-${lane}-${status}`);

describe("TaskKanbanSwimlanes cell cap (§5)", () => {
  it("renders every card and no button at exactly KANBAN_COLUMN_PAGE", () => {
    lanes(tasksIn("To Do", KANBAN_COLUMN_PAGE));
    expect(cardsIn("unassigned", "To Do")).toHaveLength(KANBAN_COLUMN_PAGE);
    expect(more("unassigned", "To Do")).toBeNull();
  });

  it("caps a cell and names the lane, the status and the hidden count", () => {
    lanes(tasksIn("To Do", 101));
    expect(cardsIn("unassigned", "To Do")).toHaveLength(100);
    expect(more("unassigned", "To Do")).toHaveAccessibleName("Show 1 more in Unassigned – To Do (1 hidden)");
  });

  it("each click shows up to one more page, and the last removes the button", () => {
    lanes(tasksIn("To Do", 250));
    fireEvent.click(more("unassigned", "To Do")!);
    expect(cardsIn("unassigned", "To Do")).toHaveLength(200);
    expect(more("unassigned", "To Do")).toHaveAccessibleName("Show 50 more in Unassigned – To Do (50 hidden)");
    fireEvent.click(more("unassigned", "To Do")!);
    expect(cardsIn("unassigned", "To Do")).toHaveLength(250);
    expect(more("unassigned", "To Do")).toBeNull();
  });

  it("caps each cell on its own: opening one leaves its neighbours at one page", () => {
    lanes([...tasksIn("To Do", 150), ...tasksIn("Done", 150, 1001), ...tasksIn("To Do", 150, 2001, 1)]);
    fireEvent.click(more("unassigned", "To Do")!);
    expect(cardsIn("unassigned", "To Do")).toHaveLength(150);
    expect(cardsIn("unassigned", "Done")).toHaveLength(100);
    expect(cardsIn("res:1", "To Do")).toHaveLength(100);
  });

  it("two capped cells have distinct button names", () => {
    lanes([...tasksIn("To Do", 101), ...tasksIn("To Do", 101, 1001, 1)]);
    const names = [more("unassigned", "To Do")!, more("res:1", "To Do")!].map((b) => b.textContent);
    expect(names[0]).not.toBe(names[1]);
  });

  it("a filter that shrinks then restores a cell keeps a sane count", () => {
    const all = tasksIn("To Do", 250);
    const view = lanes(all);
    fireEvent.click(more("unassigned", "To Do")!);
    view.rerender(all.slice(0, 120));
    expect(cardsIn("unassigned", "To Do")).toHaveLength(120);
    expect(more("unassigned", "To Do")).toBeNull();
    view.rerender(all);
    expect(cardsIn("unassigned", "To Do")).toHaveLength(200);
  });

  it("moves focus to the first newly revealed card", () => {
    const all = tasksIn("To Do", 150);
    lanes(all);
    const button = more("unassigned", "To Do")!;
    button.focus();
    fireEvent.click(button);
    expect(more("unassigned", "To Do")).toBeNull();
    const first = screen.getByTestId(`swimlane-card-${all[100]!.id}`).querySelector<HTMLElement>("button, select, [tabindex]");
    expect(document.activeElement).toBe(first);
  });

  // The focus lookup runs inside the CELL: the lane holds the cells before it too,
  // so an index counted across the lane would land in the wrong cell.
  it("focuses the revealed card in its own cell when an earlier cell in the lane holds cards", () => {
    const later = tasksIn("In Progress", 150, 1001);
    lanes([...tasksIn("To Do", 150), ...later]);
    fireEvent.click(more("unassigned", "In Progress")!);
    const first = screen.getByTestId(`swimlane-card-${later[100]!.id}`).querySelector<HTMLElement>("button, select, [tabindex]");
    expect(document.activeElement).toBe(first);
  });

  describe("deep-link flash", () => {
    it("a flashId past the cap renders that card in the same render", () => {
      const all = tasksIn("To Do", 300);
      const view = lanes(all);
      view.rerender(all, all[249]!.id);
      expect(screen.getByTestId(`swimlane-card-${all[249]!.id}`)).toBeInTheDocument();
    });

    it("a fresh mount with a pending flashId honours it", () => {
      const all = tasksIn("To Do", 300);
      lanes(all, all[249]!.id);
      expect(screen.getByTestId(`swimlane-card-${all[249]!.id}`)).toBeInTheDocument();
    });

    it("a flash never lowers an expanded cell", () => {
      const all = tasksIn("To Do", 300);
      const view = lanes(all);
      fireEvent.click(more("unassigned", "To Do")!);
      fireEvent.click(more("unassigned", "To Do")!);
      view.rerender(all, all[9]!.id);
      expect(cardsIn("unassigned", "To Do")).toHaveLength(300);
    });

    it("an unknown flashId changes nothing", () => {
      const all = tasksIn("To Do", 300);
      const view = lanes(all);
      view.rerender(all, 999999);
      expect(cardsIn("unassigned", "To Do")).toHaveLength(100);
    });
  });

  describe("printing", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("printing renders every card", () => {
      const listeners = new Set<() => void>();
      const printMql = {
        matches: false,
        addEventListener: (_type: string, l: () => void) => listeners.add(l),
        removeEventListener: (_type: string, l: () => void) => listeners.delete(l),
      };
      const otherMql = { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
      vi.stubGlobal("matchMedia", (q: string) => (q === "print" ? printMql : otherMql));
      lanes(tasksIn("To Do", 250));
      expect(cardsIn("unassigned", "To Do")).toHaveLength(100);
      printMql.matches = true;
      act(() => listeners.forEach((l) => l()));
      expect(cardsIn("unassigned", "To Do")).toHaveLength(250);
      expect(more("unassigned", "To Do")).toBeNull();
    });
  });
});
