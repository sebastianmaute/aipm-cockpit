import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GanttMilestoneRow } from "./gantt-rows";
import { GanttPanel } from "./gantt";
import { fmtFull, ROW_HEIGHT_PX } from "./gantt-engine";
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
      `Pilot Go-Live · ${fmtFull(new Date(Date.UTC(2026, 5, 20)), "en-US")} — Drag, or press the arrow keys: one day, with Shift one week`,
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

  it("moves a milestone one day per arrow press through onMoveMilestone", () => {
    const onMoveMilestone = vi.fn();
    render(<GanttPanel {...props} onMoveMilestone={onMoveMilestone} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Move milestone – Beta" }), { key: "ArrowRight" });
    expect(onMoveMilestone).toHaveBeenCalledWith(100, "2026-06-21");
  });

  it("offers no handle when the caller passes no onMoveMilestone", () => {
    render(<GanttPanel {...props} />);
    expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
    expect(screen.queryByRole("slider", { name: /^Move milestone/ })).toBeNull();
  });
});
