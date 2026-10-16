import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GanttMilestoneRow } from "./gantt-rows";
import { GanttPanel } from "./gantt";
import { fmtFull, LEFT_GUTTER_PX, ROW_HEIGHT_PX } from "./gantt-engine";
import type { Milestone, Task } from "./types";

// §715 project D — the milestone row's drag handle and its live preview.
const m: Milestone = { id: 1, name: "Pilot Go-Live", date: "2026-06-20", linkedTaskIds: [7] };
// Linked work ending 2026-06-18: before the milestone, so it is on track — until
// the milestone is dragged to before that date.
const linked = { id: 7, taskName: "Pilot comms", status: "To Do", dueDate: "2026-06-18" } as unknown as Task;
const base = {
  lang: "en-US" as const,
  range: { min: new Date(Date.UTC(2026, 5, 1)) },
  timelineWidthPx: 1000,
  nameColWidth: 240,
  tasksById: new Map([[7, linked]]),
  todayISO: "2026-06-10",
  date: new Date(Date.UTC(2026, 5, 20)),
  rowToken: m.name,
  rowKey: `m-${m.id}`,
};
const HANDLE_NAME = "Move milestone – Pilot Go-Live";

function liveDiamond(c: HTMLElement): SVGRectElement {
  // [0] is the name column's gutter icon; [1] the timeline diamond.
  return c.querySelectorAll<SVGRectElement>("rect[transform^='rotate']")[1];
}

describe("GanttMilestoneRow — drag handle", () => {
  it("renders a focusable, row-unique handle when the milestone can move", () => {
    render(<GanttMilestoneRow m={m} {...base} onStartDrag={vi.fn()} onKeyMove={vi.fn()} />);
    const handle = screen.getByRole("slider", { name: HANDLE_NAME });
    expect(handle).toHaveAttribute("tabindex", "0");
    // The handle covers the diamond, so its tooltip carries the timeline's name and date too.
    expect(handle).toHaveAttribute(
      "title",
      `Pilot Go-Live · ${fmtFull(new Date(Date.UTC(2026, 5, 20)), "en-US")} — Drag, or press the arrow keys: one day, with Shift one week. Enter saves at once, Escape cancels`,
    );
    // A slider whose value text is the date: what a screen reader announces after a move.
    expect(handle).toHaveAttribute("aria-valuetext", fmtFull(new Date(Date.UTC(2026, 5, 20)), "en-US"));
    expect(handle).toHaveAttribute("aria-valuenow", "19");
  });

  it("renders no handle without a move handler (read-only pop-out)", () => {
    render(<GanttMilestoneRow m={m} {...base} />);
    expect(screen.getByText("Pilot Go-Live")).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: HANDLE_NAME })).toBeNull();
  });

  it("renders no handle for an achieved milestone", () => {
    render(<GanttMilestoneRow m={{ ...m, achievedDate: "2026-06-19" }} {...base} onStartDrag={vi.fn()} />);
    expect(screen.queryByRole("slider", { name: HANDLE_NAME })).toBeNull();
  });

  it("hands pointer-down and key presses to the drag hook with the milestone", () => {
    const onStartDrag = vi.fn();
    const onKeyMove = vi.fn();
    render(<GanttMilestoneRow m={m} {...base} onStartDrag={onStartDrag} onKeyMove={onKeyMove} />);
    const handle = screen.getByRole("slider", { name: HANDLE_NAME });
    fireEvent.pointerDown(handle, { clientX: 10 });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onStartDrag).toHaveBeenCalledWith(expect.anything(), m);
    expect(onKeyMove).toHaveBeenCalledWith(expect.anything(), m);
  });
});

describe("GanttMilestoneRow — drag preview", () => {
  it("draws the diamond at the previewed date and labels that date", () => {
    const { container } = render(<GanttMilestoneRow m={m} {...base} onStartDrag={vi.fn()} dragDeltaDays={3} />);
    // 2026-06-23 is 22 days after the range start; 22 * 28px = 616.
    expect(liveDiamond(container).getAttribute("transform")).toBe(`rotate(45 616 ${ROW_HEIGHT_PX / 2})`);
    const preview = container.querySelector("[data-gantt-milestone-preview]");
    expect(preview?.textContent).toBe(fmtFull(new Date(Date.UTC(2026, 5, 23)), "en-US"));
  });

  it("announces the previewed date while dragging", () => {
    render(<GanttMilestoneRow m={m} {...base} onStartDrag={vi.fn()} dragDeltaDays={3} />);
    expect(screen.getByRole("slider", { name: HANDLE_NAME }))
      .toHaveAttribute("aria-valuetext", fmtFull(new Date(Date.UTC(2026, 5, 23)), "en-US"));
  });

  it("shows no preview label when nothing is being dragged", () => {
    const { container } = render(<GanttMilestoneRow m={m} {...base} onStartDrag={vi.fn()} />);
    expect(container.querySelector("[data-gantt-milestone-preview]")).toBeNull();
  });

  it("turns the diamond at-risk live when dragged before its linked work", () => {
    const { container, rerender } = render(<GanttMilestoneRow m={m} {...base} onStartDrag={vi.fn()} />);
    expect(liveDiamond(container).getAttribute("stroke")).toBe("none");
    rerender(<GanttMilestoneRow m={m} {...base} onStartDrag={vi.fn()} dragDeltaDays={-5} />);
    expect(liveDiamond(container).getAttribute("stroke")).toBe("var(--ui-pink)");
  });

  it("updates the baseline slip label while dragging", () => {
    render(<GanttMilestoneRow m={m} {...base} baselineDate="2026-06-20" showBaseline onStartDrag={vi.fn()} dragDeltaDays={4} />);
    expect(screen.getByText("+4d")).toBeInTheDocument();
  });
});

describe("GanttPanel — milestone move wiring", () => {
  const ms: Milestone[] = [{ id: 100, name: "Beta", date: "2026-06-20", linkedTaskIds: [] }];
  const props = { lang: "en-US" as const, tasks: [] as Task[], absences: [] as const, milestones: ms };

  it("previews arrow presses on the slider and commits them on Enter", () => {
    const onMoveMilestone = vi.fn();
    render(<GanttPanel {...props} onMoveMilestone={onMoveMilestone} />);
    const slider = screen.getByRole("slider", { name: "Move milestone – Beta" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onMoveMilestone).not.toHaveBeenCalled();
    expect(slider).toHaveAttribute("aria-valuetext", fmtFull(new Date(Date.UTC(2026, 5, 22)), "en-US"));
    fireEvent.keyDown(slider, { key: "Enter" });
    expect(onMoveMilestone).toHaveBeenCalledTimes(1);
    expect(onMoveMilestone).toHaveBeenCalledWith(100, 2);
  });

  it("widens the axis for a keyboard move past its first day, so the value stays in range", () => {
    render(<GanttPanel {...props} onMoveMilestone={vi.fn()} />);
    const slider = screen.getByRole("slider", { name: "Move milestone – Beta" });
    // Beta is the earliest item: the axis starts two days before it.
    expect(slider).toHaveAttribute("aria-valuenow", "2");
    fireEvent.keyDown(slider, { key: "PageDown" });
    fireEvent.keyDown(slider, { key: "PageDown" });
    expect(slider).toHaveAttribute("aria-valuetext", fmtFull(new Date(Date.UTC(2026, 5, 6)), "en-US"));
    expect(slider).toHaveAttribute("aria-valuenow", "2");
    expect(Number(slider.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(Number(slider.getAttribute("aria-valuemax")));
  });

  it("keeps the handle and its preview date clear of the sticky name column while arrow presses move it", () => {
    // jsdom has no layout: place the handle at viewport x 60 and its preview
    // label at x 30, both inside the scrollport but under the name column.
    const rects = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const at = (left: number, width: number) => ({ left, right: left + width, top: 100, bottom: 130, width, height: 30, x: left, y: 100, toJSON: () => ({}) }) as DOMRect;
      if (this.hasAttribute("data-gantt-milestone-handle")) return at(60, 20);
      if (this.hasAttribute("data-gantt-milestone-preview")) return at(30, 60);
      return at(0, 0);
    });
    try {
      render(<GanttPanel {...props} onMoveMilestone={vi.fn()} />);
      const slider = screen.getByRole("slider", { name: "Move milestone – Beta" });
      const scroller = slider.closest<HTMLElement>(".overflow-auto")!;
      Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 800 });
      Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
      scroller.scrollLeft = 400;
      fireEvent.keyDown(slider, { key: "PageUp" });
      // Content x of the label = 30 + 400 = 430; it must start right of the
      // name column, so the chart scrolls to 430 - LEFT_GUTTER_PX.
      expect(scroller.scrollLeft).toBe(430 - LEFT_GUTTER_PX);
      expect(scroller.scrollTop).toBe(0);
    } finally {
      rects.mockRestore();
    }
  });

  it("offers no handle when the caller passes no onMoveMilestone", () => {
    render(<GanttPanel {...props} />);
    expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
    expect(screen.queryByRole("slider", { name: /^Move milestone/ })).toBeNull();
  });
});
