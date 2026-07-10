import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { GanttMilestoneRow } from "./gantt-rows";
import type { Milestone } from "./types";

const m: Milestone = { id: 1, name: "M1", date: "2026-06-20", linkedTaskIds: [] };
const base = {
  lang: "en-US" as const,
  range: { min: new Date(Date.UTC(2026, 5, 1)) },
  timelineWidthPx: 1000,
  tasksById: new Map(),
  todayISO: "2026-06-10",
};

function countDiamonds(c: HTMLElement): number {
  return c.querySelectorAll("rect[transform^='rotate']").length;
}

describe("GanttMilestoneRow ghost baseline", () => {
  it("renders a single live diamond (+ gutter icon) with no baseline", () => {
    const { container } = render(<GanttMilestoneRow m={m} {...base} />);
    expect(countDiamonds(container)).toBe(2); // gutter icon + live timeline diamond
  });

  it("renders a ghost diamond + connector + slip label when a baseline is set and showBaseline is on", () => {
    const { container, getByText } = render(
      <GanttMilestoneRow m={m} {...base} baselineDate="2026-06-15" showBaseline />,
    );
    expect(countDiamonds(container)).toBe(3); // gutter + live + ghost
    expect(container.querySelector("line")).not.toBeNull(); // connector
    expect(getByText("+5d")).toBeInTheDocument(); // live is 5 days after baseline
  });

  it("shows a negative slip label when the live date is before the baseline", () => {
    const { getByText } = render(
      <GanttMilestoneRow m={m} {...base} baselineDate="2026-06-25" showBaseline />,
    );
    expect(getByText("−5d")).toBeInTheDocument(); // live is 5 days earlier
  });

  it("renders no ghost when showBaseline is off", () => {
    const { container } = render(
      <GanttMilestoneRow m={m} {...base} baselineDate="2026-06-15" showBaseline={false} />,
    );
    expect(countDiamonds(container)).toBe(2);
  });

  it("renders no ghost when the baseline equals the live date (zero slip)", () => {
    const { container } = render(
      <GanttMilestoneRow m={m} {...base} baselineDate="2026-06-20" showBaseline />,
    );
    expect(countDiamonds(container)).toBe(2);
  });
});
