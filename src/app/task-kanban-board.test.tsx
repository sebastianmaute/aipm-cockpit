import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { KANBAN_COLUMN_PAGE, TaskKanban } from "./task-kanban-board";
import { loadI18n, t } from "./i18n";
import { statusLabelKey } from "./task-status-ui";
import type { Lang } from "./i18n";
import type { Task, TaskStatus } from "./types";

// §5 board phase (docs/superpowers/specs/2026-10-08-kanban-column-cap-design.md): each
// status column renders at most KANBAN_COLUMN_PAGE cards, then a "Show more" button.

const task = (id: number, status: TaskStatus): Task =>
  ({ id, taskName: `Task ${id}`, assignee: "", assigneeEmail: "", dueDate: "2026-06-01",
     lastUpdateDate: "2026-05-01", priority: "Medium", blockers: "", notes: "", status }) as unknown as Task;

/** `n` tasks in `status`, ids from `from`. */
const tasksIn = (status: TaskStatus, n: number, from = 1): Task[] =>
  Array.from({ length: n }, (_, i) => task(from + i, status));

const NO_TOKENS: ReadonlyMap<number, string> = new Map();

function board(tasks: Task[], extra: { lang?: Lang; flashId?: number | null } = {}) {
  const props = { lang: extra.lang ?? ("en-US" as Lang), tokens: NO_TOKENS, onStatusChange: vi.fn(), onEdit: vi.fn() };
  const view = render(<TaskKanban {...props} tasks={tasks} flashId={extra.flashId ?? null} />);
  const rerender = (next: Task[], flashId: number | null = extra.flashId ?? null) =>
    view.rerender(<TaskKanban {...props} tasks={next} flashId={flashId} />);
  return { ...view, rerender };
}

const column = (status: TaskStatus) => screen.getByTestId(`kanban-col-${status}`);
const cardsIn = (status: TaskStatus) => within(column(status)).queryAllByTestId(/^kanban-card-/);
const moreButton = (status: TaskStatus) => screen.queryByTestId(`kanban-show-more-${status}`);

describe("TaskKanban column cap (§5)", () => {
  it("renders every card and no button at exactly KANBAN_COLUMN_PAGE", () => {
    expect(KANBAN_COLUMN_PAGE).toBe(100);
    board(tasksIn("To Do", 100));
    expect(cardsIn("To Do")).toHaveLength(100);
    expect(moreButton("To Do")).toBeNull();
  });

  it("caps at KANBAN_COLUMN_PAGE and names the hidden count", () => {
    board(tasksIn("To Do", 101));
    expect(cardsIn("To Do")).toHaveLength(100);
    expect(moreButton("To Do")).toHaveAccessibleName("Show 1 more in To Do (1 hidden)");
  });

  it("each click shows up to one more page", () => {
    board(tasksIn("To Do", 250));
    fireEvent.click(moreButton("To Do")!);
    expect(cardsIn("To Do")).toHaveLength(200);
    expect(moreButton("To Do")).toHaveAccessibleName("Show 50 more in To Do (50 hidden)");
    fireEvent.click(moreButton("To Do")!);
    expect(cardsIn("To Do")).toHaveLength(250);
    expect(moreButton("To Do")).toBeNull();
  });

  it("header count is the true total while capped", () => {
    board(tasksIn("To Do", 250));
    expect(within(column("To Do")).getByRole("heading").textContent).toContain("250");
  });

  it("two capped columns have distinct button names", () => {
    board([...tasksIn("To Do", 101), ...tasksIn("Done", 101, 1001)]);
    const names = [moreButton("To Do")!, moreButton("Done")!].map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names[0]).not.toBe(names[1]);
  });

  // Review Focus 2: a filter shrinks the column under its raised limit, then clears.
  it("a filter that shrinks then restores a column keeps a sane count", () => {
    const all = tasksIn("To Do", 250);
    const view = board(all);
    fireEvent.click(moreButton("To Do")!);
    view.rerender(all.slice(0, 120));
    expect(cardsIn("To Do")).toHaveLength(120);
    expect(moreButton("To Do")).toBeNull();
    view.rerender(all);
    expect(cardsIn("To Do")).toHaveLength(200);
    expect(moreButton("To Do")).toHaveAccessibleName("Show 50 more in To Do (50 hidden)");
  });

  // Review Focus 1: a card moved into a capped column lands past the cap.
  it("a card moved into a capped column raises its header count", () => {
    const done = tasksIn("Done", 101);
    const moving = task(5000, "To Do");
    const view = board([...done, moving]);
    view.rerender([...done, { ...moving, status: "Done" }]);
    expect(within(column("Done")).getByRole("heading").textContent).toContain("102");
    expect(cardsIn("Done")).toHaveLength(100);
  });

  // Final review: a keyboard user who presses Show more must land on the first card it
  // revealed — not on <body> when the button unmounts, and not below the new cards.
  describe("focus after Show more", () => {
    const firstFocusableIn = (taskId: number) =>
      screen.getByTestId(`kanban-card-${taskId}`).querySelector<HTMLElement>("button, select, [tabindex]");

    it("moves focus to the first newly revealed card", () => {
      const all = tasksIn("To Do", 250);
      board(all);
      const button = moreButton("To Do")!;
      button.focus();
      fireEvent.click(button);
      expect(document.activeElement).toBe(firstFocusableIn(all[100]!.id));
    });

    it("keeps focus on a card when the last page removes the button", () => {
      const all = tasksIn("To Do", 150);
      board(all);
      const button = moreButton("To Do")!;
      button.focus();
      fireEvent.click(button);
      expect(moreButton("To Do")).toBeNull();
      expect(document.activeElement).toBe(firstFocusableIn(all[100]!.id));
    });
  });

  describe("deep-link flash (§5, spec Collisions 3)", () => {
    // The hook queries [data-deeplink-row] on the NEXT animation frame, so the card
    // must be rendered by the render that carries the new flashId.
    it("a flashId past the cap renders that card in the same render", () => {
      const all = tasksIn("To Do", 300);
      const view = board(all);
      view.rerender(all, all[249]!.id);
      expect(screen.getByTestId(`kanban-card-${all[249]!.id}`)).toBeInTheDocument();
      expect(cardsIn("To Do")).toHaveLength(300);
    });

    it("a fresh mount with a pending flashId honours it", () => {
      const all = tasksIn("To Do", 300);
      board(all, { flashId: all[249]!.id });
      expect(screen.getByTestId(`kanban-card-${all[249]!.id}`)).toBeInTheDocument();
    });

    // Review Focus 3.
    it("a flash never lowers an expanded column", () => {
      const all = tasksIn("To Do", 300);
      const view = board(all);
      fireEvent.click(moreButton("To Do")!);
      fireEvent.click(moreButton("To Do")!);
      view.rerender(all, all[9]!.id);
      expect(cardsIn("To Do")).toHaveLength(300);
    });

    // Review Focus 4.
    it("an unknown flashId changes nothing", () => {
      const all = tasksIn("To Do", 300);
      const view = board(all);
      view.rerender(all, 999999);
      expect(cardsIn("To Do")).toHaveLength(100);
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
      board(tasksIn("To Do", 250));
      expect(cardsIn("To Do")).toHaveLength(100);
      printMql.matches = true;
      act(() => listeners.forEach((l) => l()));
      expect(cardsIn("To Do")).toHaveLength(250);
      expect(moreButton("To Do")).toBeNull();
    });
  });

  describe("German", () => {
    beforeAll(async () => {
      await loadI18n("de");
    });

    it("German label", () => {
      board(tasksIn("To Do", 101), { lang: "de" });
      const name = t("de", "kanbanShowMore", 1, t("de", statusLabelKey("To Do")), 1);
      expect(name).not.toBe(t("en-US", "kanbanShowMore", 1, "To Do", 1));
      expect(moreButton("To Do")).toHaveAccessibleName(name);
    });
  });
});
