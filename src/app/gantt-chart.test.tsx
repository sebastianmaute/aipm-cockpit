import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

function renderChart(rows: GanttRow[], over: Partial<React.ComponentProps<typeof GanttChart>> = {}) {
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
      {...over}
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

// §5 row window (use-gantt-row-window.ts): above VIRTUALIZE_MIN_ROWS rows only a window of
// rows renders, each row root names its key for the focus pin, and a dragged row stays.
describe("GanttChart row window (§5)", () => {
  const taskRows = (n: number): GanttRow[] =>
    Array.from({ length: n }, (_, i) => ({
      kind: "task" as const,
      task: { id: i + 1, taskName: `T${i + 1}`, assignee: "", priority: "Medium", dueDate: "" } as unknown as Task,
      bar: { start: utc(2026, 6, 5), end: utc(2026, 6, 10) },
    }));
  const rendered = () => [...document.querySelectorAll("[data-gantt-row]")].map((e) => e.getAttribute("data-gantt-row"));
  // jsdom lays nothing out, and a 0 × 0 scroll box gives the virtualizer an empty range.
  // A 640 px box (20 rows) stands in for the browser's.
  const sized = (prop: "offsetHeight" | "offsetWidth", px: number) => {
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)!;
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => px });
    return () => Object.defineProperty(HTMLElement.prototype, prop, before);
  };
  let restore: (() => void)[] = [];
  beforeEach(() => {
    restore = [sized("offsetHeight", 640), sized("offsetWidth", 1000)];
  });
  afterEach(() => restore.forEach((r) => r()));

  it("renders every row, each naming its key, at the threshold", () => {
    renderChart(taskRows(200));
    expect(rendered()).toHaveLength(200);
    expect(rendered()[199]).toBe("t-200");
  });

  it("renders a window of rows above the threshold", () => {
    renderChart(taskRows(250));
    const keys = rendered();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.length).toBeLessThan(250);
    expect(keys[0]).toBe("t-1");
  });

  it("keeps the row being dragged mounted outside the window", () => {
    renderChart(taskRows(250), { draggingId: 240 });
    expect(rendered()).toContain("t-240");
  });

  it("keeps the row whose bar is being dragged mounted outside the window", () => {
    renderChart(taskRows(250), { barDrag: { taskId: 245 } as never });
    expect(rendered()).toContain("t-245");
  });
});
