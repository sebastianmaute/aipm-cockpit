import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { GanttMilestoneRow } from "./gantt-rows";
import { GanttPanel } from "./gantt";
import { POINTER_FOCUS_WINDOW_MS } from "./use-gantt-milestone-focus";
import { fmtFull, HEADER_HEIGHT_PX, LEFT_GUTTER_PX, MILESTONE_DIAMOND_PX, ROW_HEIGHT_PX } from "./gantt-engine";
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
    // Left of the diamond, clear of the slip label on its right.
    expect(preview).toHaveAttribute("data-gantt-milestone-preview", "left");
  });

  it("puts the preview date right of the diamond near the first day, where no scroll could uncover a left label", () => {
    // 2026-06-02 is one day after the range start: x = 28.
    const { container } = render(<GanttMilestoneRow m={m} {...base} onStartDrag={vi.fn()} dragDeltaDays={-18} />);
    const preview = container.querySelector<HTMLElement>("[data-gantt-milestone-preview]");
    expect(preview).toHaveAttribute("data-gantt-milestone-preview", "right");
    expect(preview?.style.left).toBe(`${28 + MILESTONE_DIAMOND_PX}px`);
  });

  it("folds the baseline slip into a preview date drawn right of the diamond, so the two never overlap", () => {
    // Live 2026-06-02 (x 28, near the first day), baseline 2026-06-01 (x 0): +1d.
    render(
      <GanttMilestoneRow m={m} {...base} baselineDate="2026-06-01" showBaseline onStartDrag={vi.fn()} dragDeltaDays={-18} />,
    );
    const preview = screen.getByText(`${fmtFull(new Date(Date.UTC(2026, 5, 2)), "en-US")} · +1d`);
    expect(preview).toHaveAttribute("data-gantt-milestone-preview", "right");
    expect(preview.style.left).toBe(`${28 + MILESTONE_DIAMOND_PX}px`);
    expect(screen.queryByText("+1d")).toBeNull();
  });

  it("starts the folded label after the ghost when the baseline lies later", () => {
    // Live 2026-06-02 (x 28), baseline 2026-06-03 (x 56): pulled in, −1d.
    render(
      <GanttMilestoneRow m={m} {...base} baselineDate="2026-06-03" showBaseline onStartDrag={vi.fn()} dragDeltaDays={-18} />,
    );
    const preview = screen.getByText(`${fmtFull(new Date(Date.UTC(2026, 5, 2)), "en-US")} · −1d`);
    expect(preview.style.left).toBe(`${56 + MILESTONE_DIAMOND_PX}px`);
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

  it("previews on the same axis the saved date is drawn on, so the chart does not shift on save", () => {
    const { rerender } = render(<GanttPanel {...props} onMoveMilestone={vi.fn()} />);
    const slider = () => screen.getByRole("slider", { name: "Move milestone – Beta" });
    fireEvent.keyDown(slider(), { key: "PageDown" });
    const during = [slider().getAttribute("aria-valuenow"), slider().getAttribute("aria-valuemax")];
    fireEvent.keyDown(slider(), { key: "Enter" });
    // The workspace now holds the saved date.
    rerender(<GanttPanel {...props} milestones={[{ ...ms[0], date: "2026-06-13" }]} onMoveMilestone={vi.fn()} />);
    expect([slider().getAttribute("aria-valuenow"), slider().getAttribute("aria-valuemax")]).toEqual(during);
  });

  it("does not widen the axis under a pointer drag", () => {
    render(<GanttPanel {...props} onMoveMilestone={vi.fn()} />);
    const slider = screen.getByRole("slider", { name: "Move milestone – Beta" });
    const max = slider.getAttribute("aria-valuemax");
    fireEvent.pointerDown(slider, { button: 0, clientX: 1000, pointerId: 1 });
    const move = new Event("pointermove") as Event & { clientX: number; pointerId: number };
    move.clientX = 1000 - 28 * 20;
    move.pointerId = 1;
    act(() => { window.dispatchEvent(move); });
    expect(slider).toHaveAttribute("aria-valuemax", max);
  });

  describe("keeping the focused handle in view", () => {
    // jsdom has no layout. The scroller sits at the viewport origin, 800×400;
    // the handle and its preview label get the boxes in `box`, which a test
    // may change between steps; everything else is an empty box at the origin.
    const box = { handleLeft: 0, previewLeft: 0, top: 100 };
    let rects: { mockRestore: () => void };
    beforeEach(() => {
      Object.assign(box, { handleLeft: 0, previewLeft: 0, top: 100 });
      rects = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const at = (left: number, top: number, width: number, height: number) =>
          ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
        if (this.hasAttribute("data-gantt-milestone-handle")) return at(box.handleLeft, box.top, 20, 30);
        if (this.hasAttribute("data-gantt-milestone-preview")) return at(box.previewLeft, box.top, 60, 30);
        return at(0, 0, 0, 0);
      });
    });
    afterEach(() => rects.mockRestore());

    function setup(scrollLeft: number, scrollTop = 0) {
      render(<GanttPanel {...props} onMoveMilestone={vi.fn()} />);
      const slider = screen.getByRole("slider", { name: "Move milestone – Beta" });
      const scroller = slider.closest<HTMLElement>(".overflow-auto")!;
      Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 800 });
      Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
      scroller.scrollLeft = scrollLeft;
      scroller.scrollTop = scrollTop;
      return { slider, scroller };
    }

    it("keeps the handle and its preview date clear of the sticky name column while arrow presses move it", () => {
      // Both inside the scrollport, both under the name column.
      Object.assign(box, { handleLeft: 60, previewLeft: 30 });
      const { slider, scroller } = setup(400);
      fireEvent.keyDown(slider, { key: "PageUp" });
      // Content x of the label = 30 + 400 = 430; it must start right of the
      // name column, so the chart scrolls to 430 - LEFT_GUTTER_PX.
      expect(scroller.scrollLeft).toBe(430 - LEFT_GUTTER_PX);
      expect(scroller.scrollTop).toBe(0);
    });

    it("keeps the handle clear of the sticky header", () => {
      // Viewport y 30 = content y 230 at scrollTop 200: under the header.
      Object.assign(box, { handleLeft: 500, previewLeft: 420, top: 30 });
      const { slider, scroller } = setup(0, 200);
      fireEvent.keyDown(slider, { key: "ArrowRight" });
      expect(scroller.scrollTop).toBe(230 - HEADER_HEIGHT_PX);
    });

    it("keeps the handle clear of the sticky footer, at its measured height", () => {
      Object.assign(box, { handleLeft: 500, previewLeft: 420, top: 380 });
      const { slider, scroller } = setup(0, 0);
      const footer = scroller.querySelector<HTMLElement>(".sticky.bottom-0")!;
      Object.defineProperty(footer, "offsetHeight", { configurable: true, value: 26 });
      fireEvent.keyDown(slider, { key: "ArrowRight" });
      // Content bottom 410 must end above the 26px footer of a 400px port.
      expect(scroller.scrollTop).toBe(410 - 400 + 26);
    });

    it("brings the handle back into view when Escape cancels a long move", () => {
      Object.assign(box, { handleLeft: 500, previewLeft: 420 });
      const { slider, scroller } = setup(0);
      act(() => slider.focus());
      fireEvent.keyDown(slider, { key: "PageDown" });
      // Escape puts the diamond back on its own date, here past the right edge.
      box.handleLeft = 1500;
      fireEvent.keyDown(slider, { key: "Escape" });
      expect(scroller.scrollLeft).toBe(1520 - 800);
    });

    it("does not scroll when a pointer press focuses the handle", () => {
      box.handleLeft = 60;
      const { slider, scroller } = setup(400);
      fireEvent.pointerDown(slider, { button: 0, clientX: 70, pointerId: 1 });
      act(() => slider.focus());
      expect(scroller.scrollLeft).toBe(400);
    });

    it("does not scroll back to a keyboard move that a pointer drag ended", () => {
      Object.assign(box, { handleLeft: 500, previewLeft: 420 });
      const { slider, scroller } = setup(0);
      act(() => slider.focus());
      fireEvent.keyDown(slider, { key: "PageDown" });
      box.handleLeft = 1500;
      fireEvent.pointerDown(slider, { button: 0, clientX: 1510, pointerId: 1 });
      expect(scroller.scrollLeft).toBe(0);
    });

    it("does not scroll back to a keyboard move that ended because focus left", () => {
      Object.assign(box, { handleLeft: 500, previewLeft: 420 });
      const { slider, scroller } = setup(0);
      act(() => slider.focus());
      fireEvent.keyDown(slider, { key: "PageDown" });
      box.handleLeft = 1500;
      act(() => slider.blur());
      expect(scroller.scrollLeft).toBe(0);
    });

    it("scrolls a handle focused well after an earlier pointer press", () => {
      box.handleLeft = 60;
      const { slider, scroller } = setup(400);
      const now = vi.spyOn(performance, "now").mockReturnValue(1000);
      try {
        fireEvent.pointerDown(document.body, { button: 0, pointerId: 1 });
        now.mockReturnValue(1000 + POINTER_FOCUS_WINDOW_MS);
        act(() => slider.focus());
        expect(scroller.scrollLeft).toBe(460 - LEFT_GUTTER_PX);
      } finally {
        now.mockRestore();
      }
    });

    it("scrolls a handle reached by Tab out from under the name column", () => {
      box.handleLeft = 60;
      const { slider, scroller } = setup(400);
      act(() => slider.focus());
      expect(scroller.scrollLeft).toBe(460 - LEFT_GUTTER_PX);
    });
  });

  it("offers no handle when the caller passes no onMoveMilestone", () => {
    render(<GanttPanel {...props} />);
    expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
    expect(screen.queryByRole("slider", { name: /^Move milestone/ })).toBeNull();
  });
});
