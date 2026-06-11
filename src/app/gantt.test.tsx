import React from "react";
import { describe, it, test, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, act } from "@testing-library/react";
import { GanttPanel } from "./gantt";
import type { Milestone, Task } from "./types";

// useResizable reads/writes localStorage — mock it so tests run in JSDOM.
vi.mock("./use-resizable", () => ({
  useResizable: () => ({ ref: { current: null }, size: 400 }),
}));

// ---------- helpers --------------------------------------------------------

/** Returns today as YYYY-MM-DD (UTC). */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** today + n calendar days (UTC). */
function dayPlus(n: number): string {
  const x = new Date();
  x.setUTCDate(x.getUTCDate() + n);
  return isoDay(x);
}

const BASE_TASKS: Task[] = [
  {
    id: 1,
    taskName: "A",
    assignee: "x",
    priority: "Medium" as const,
    startDate: dayPlus(-30),
    dueDate: dayPlus(30),
  } as unknown as Task,
];

const BASE_PROPS = {
  lang: "en-US" as const,
  tasks: BASE_TASKS,
  absences: [] as const,
};

// ---------- scroll tests ---------------------------------------------------
//
// Strategy: mock clientWidth / scrollWidth on HTMLElement.prototype BEFORE
// rendering so the very first useLayoutEffect call sees non-zero dimensions.
// Without this the effect still fires on mount, clamps scrollLeft to 0 (since
// scrollWidth - clientWidth = 0), latches didInitialScroll, and the later
// Object.defineProperty call on the instance no longer helps.

describe("GanttPanel scroll-to-today", () => {
  it("centers today in the viewport on initial mount", () => {
    // Install prototype mocks before render so the first useLayoutEffect
    // already sees realistic dimensions.
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(800);
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(4000);

    try {
      const { container } = render(<GanttPanel {...BASE_PROPS} />);

      // The scroll target is the outer overflow-auto panel (panelRef from
      // useResizable). Use min-w-[480px] to disambiguate from any inner
      // overflow-auto regions.
      const wrapper = container.querySelector("div.overflow-auto.min-w-\\[480px\\]") as HTMLDivElement | null;
      expect(wrapper).not.toBeNull();
      if (!wrapper) return;

      expect(wrapper.scrollLeft).toBeGreaterThan(0);
      expect(wrapper.scrollLeft).toBeLessThanOrEqual(4000 - 800);
    } finally {
      clientWidthSpy.mockRestore();
      scrollWidthSpy.mockRestore();
    }
  });

  it("does not re-scroll after the initial mount", () => {
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(800);
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(4000);

    try {
      const { container, rerender } = render(<GanttPanel {...BASE_PROPS} />);

      const wrapper = container.querySelector("div.overflow-auto.min-w-\\[480px\\]") as HTMLDivElement | null;
      expect(wrapper).not.toBeNull();
      if (!wrapper) return;

      const initialScroll = wrapper.scrollLeft;
      expect(initialScroll).toBeGreaterThan(0);

      // Simulate user scrolling manually.
      wrapper.scrollLeft = 100;

      // Re-render with extra task — should NOT reset scrollLeft.
      const tasks2 = [
        ...BASE_TASKS,
        {
          id: 2,
          taskName: "B",
          assignee: "y",
          priority: "Medium" as const,
          startDate: dayPlus(0),
          dueDate: dayPlus(15),
        } as unknown as Task,
      ];
      act(() => {
        rerender(<GanttPanel {...BASE_PROPS} tasks={tasks2} />);
      });

      expect(wrapper.scrollLeft).toBe(100); // preserved, not re-centered
    } finally {
      clientWidthSpy.mockRestore();
      scrollWidthSpy.mockRestore();
    }
  });
});

// ---------- milestone rows -------------------------------------------------

describe("GanttPanel milestones", () => {
  it("renders a milestone row with one task without crashing", () => {
    const milestones: Milestone[] = [
      {
        id: 100,
        name: "Beta",
        date: dayPlus(10),
        linkedTaskIds: [],
      },
    ];
    const { container, getByText } = render(
      <GanttPanel {...BASE_PROPS} milestones={milestones} />,
    );
    // The milestone name appears in the left gutter.
    expect(getByText("Beta")).toBeTruthy();
    // The diamond is an SVG rotated rect — at least one exists in the chart.
    expect(container.querySelector('rect[transform^="rotate(45"]')).not.toBeNull();
  });

  it("draws a connector path when a milestone links a task that has a bar", () => {
    // Task id 1 has a bar (BASE_TASKS). Linking it should emit a dashed,
    // muted connector path in the dependency overlay — not a critical-path
    // red edge.
    const milestones: Milestone[] = [
      {
        id: 101,
        name: "Gamma",
        date: dayPlus(10),
        linkedTaskIds: [1],
      },
    ];
    const { container } = render(
      <GanttPanel {...BASE_PROPS} milestones={milestones} />,
    );
    const connector = container.querySelector(
      'path[data-milestone-connector]',
    );
    expect(connector).not.toBeNull();
    // Informational, not critical-path: must not be the critical red.
    expect(connector?.getAttribute("stroke")).not.toBe("rgb(220, 38, 38)");
  });

  it("draws no connector for a linked task that has no bar", () => {
    // Task id 999 does not exist -> no bar -> connector is skipped.
    const milestones: Milestone[] = [
      {
        id: 102,
        name: "Delta",
        date: dayPlus(10),
        linkedTaskIds: [999],
      },
    ];
    const { container } = render(
      <GanttPanel {...BASE_PROPS} milestones={milestones} />,
    );
    expect(
      container.querySelector('path[data-milestone-connector]'),
    ).toBeNull();
  });
});

// ---------- dependency arrows ----------------------------------------------

describe("GanttPanel dependency arrows", () => {
  it("draws a dependency edge between two placeable tasks", () => {
    const tasks = [
      ...BASE_TASKS,
      {
        id: 2,
        taskName: "B",
        assignee: "y",
        priority: "Medium" as const,
        startDate: dayPlus(1),
        dueDate: dayPlus(10),
        dependencies: [{ taskId: 1, type: "FS" as const }],
      } as unknown as Task,
    ];
    const { container } = render(<GanttPanel {...BASE_PROPS} tasks={tasks} />);
    // The edge is the only <path> carrying a marker-end (the <defs> arrowhead
    // paths and milestone connectors don't).
    const edges = container.querySelectorAll("path[marker-end]");
    expect(edges.length).toBe(1);
  });

  it("skips edges whose predecessor id is not in the visible rows", () => {
    const tasks = [
      ...BASE_TASKS,
      {
        id: 2,
        taskName: "B",
        assignee: "y",
        priority: "Medium" as const,
        startDate: dayPlus(1),
        dueDate: dayPlus(10),
        dependencies: [{ taskId: 999, type: "FS" as const }],
      } as unknown as Task,
    ];
    const { container } = render(<GanttPanel {...BASE_PROPS} tasks={tasks} />);
    expect(container.querySelectorAll("path[marker-end]").length).toBe(0);
  });
});

// ---------- source-scan tests (Task 6: toolbar ordering + pane resize) ------

test("gantt toolbar: + Add Task markup precedes the search input", () => {
  const src = readFileSync(join(__dirname, "gantt.tsx"), "utf8");
  const addIdx = src.indexOf("onClick={onAddTask}");
  const searchIdx = src.indexOf('type="search"');
  expect(addIdx).toBeGreaterThan(-1);
  expect(addIdx).toBeLessThan(searchIdx);
});

test("gantt pane uses VIEW_PANE_RESIZABLE_CLASS", () => {
  const src = readFileSync(join(__dirname, "gantt.tsx"), "utf8");
  expect(src).toMatch(/VIEW_PANE_RESIZABLE_CLASS/);
});

// ---------- print button ---------------------------------------------------

test("gantt toolbar renders a Print button", () => {
  const { getByRole } = render(<GanttPanel {...BASE_PROPS} />);
  const btn = getByRole("button", { name: /print/i });
  expect(btn).toBeTruthy();
});

test("gantt root pane has print-root and print-landscape classes", () => {
  const src = readFileSync(join(__dirname, "gantt.tsx"), "utf8");
  expect(src).toMatch(/print-root/);
  expect(src).toMatch(/print-landscape/);
});
