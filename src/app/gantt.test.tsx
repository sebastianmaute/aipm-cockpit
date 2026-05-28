import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { GanttPanel } from "./gantt";
import type { Task } from "./types";

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

      // wrapperRef targets the inner div (relative bg-surface).
      const wrapper = container.querySelector("div.relative.bg-surface") as HTMLDivElement | null;
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

      const wrapper = container.querySelector("div.relative.bg-surface") as HTMLDivElement | null;
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
