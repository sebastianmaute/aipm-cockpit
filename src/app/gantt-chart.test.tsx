import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GanttChart } from "./gantt-chart";
import { DEFAULT_PREFS, type GanttRow } from "./gantt-engine";
import type { Milestone, Task } from "./types";

// ---------- §273: the chart draws exactly `rows` ----------------------------
//
// ★★ GanttPanel numbers same-named rows over `rows` (`buildRowTokens`). That is
// only correct while the chart draws every entry of `rows` and nothing else. The
// chart used to decide for itself — a task row whose id missed the `bars` map,
// or a milestone row whose date did not parse, rendered nothing — so the token
// map and the screen could disagree. Each row now carries the geometry it is
// drawn with, and this test pins that the chart and the row components read it
// rather than deriving it a second time.
//
// ★ The fixture DISAGREES ON PURPOSE: `bars` is empty and the milestone's own
// `date` string does not parse, while each row carries valid geometry. A chart
// that re-derives either one from its own source drops that row and goes red.

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const MIN = utc(2026, 6, 1);
const MAX = utc(2026, 7, 1);

function renderChart(rows: GanttRow[]) {
  return render(
    <GanttChart
      scrollRef={{ current: null }}
      lang="en-US"
      prefs={DEFAULT_PREFS}
      range={{ min: MIN, max: MAX, days: 30 }}
      monthGroups={[]}
      today={MIN}
      todayISO="2026-06-01"
      timelineWidthPx={840}
      nameColWidth={240}
      chartWidthPx={1080}
      todayOffsetPx={0}
      rendersNothing={false}
      emptyMessageKey="ganttEmpty"
      holidaySet={new Set()}
      totalRowsCount={rows.length}
      rows={rows}
      rowTokens={new Map()}
      bars={new Map()}
      placeable={[]}
      taskRowIndexById={new Map()}
      milestoneRowIndexById={new Map()}
      critical={{ criticalTasks: new Set(), criticalEdges: new Set() }}
      visibleMilestones={[]}
      absencesByAssigneeKey={new Map()}
      resourcesById={new Map()}
      tasksById={new Map()}
      draggingId={null}
      dropTargetId={null}
      setDraggingId={() => {}}
      setDropTargetId={() => {}}
      handleDrop={() => {}}
      interactingWithBarRef={{ current: false }}
      barDrag={null}
      barDragDeltaDays={0}
      previewDates={() => ({ start: MIN, end: MIN })}
      startBarDrag={() => {}}
      onEditTask={() => {}}
      onEditMilestone={() => {}}
    />,
  );
}

describe("GanttChart row set (§273)", () => {
  it("draws every row it is given, from the geometry the row carries", () => {
    const task = {
      id: 1,
      taskName: "Design",
      assignee: "",
      priority: "Medium",
      dueDate: "",
    } as unknown as Task;
    const milestone = {
      id: 1,
      name: "Kickoff",
      date: "2026-13-01",
      linkedTaskIds: [],
    } as unknown as Milestone;

    renderChart([
      { kind: "task", task, bar: { start: utc(2026, 6, 5), end: utc(2026, 6, 10) } },
      { kind: "milestone", milestone, date: utc(2026, 6, 20) },
    ]);

    expect(screen.getByRole("button", { name: "Design" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kickoff" })).toBeInTheDocument();
  });
});
