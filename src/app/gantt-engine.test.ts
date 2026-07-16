import { beforeEach, describe, expect, it } from "vitest";
import {
  buildGanttRows,
  clampNameColWidth,
  GANTT_NAME_COL_MAX,
  GANTT_NAME_COL_MIN,
  LEFT_GUTTER_PX,
  loadPrefs,
  milestoneSlipDays,
} from "./gantt-engine";
import type { Milestone, Task } from "./types";

const PREFS_KEY = "aipm-cockpit:gantt-prefs";

describe("loadPrefs multi-select filters", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults the three filters to empty arrays (= all)", () => {
    const p = loadPrefs();
    expect(p.statuses).toEqual([]);
    expect(p.priorities).toEqual([]);
    expect(p.assignees).toEqual([]);
  });

  it("parses saved arrays, filtering out invalid entries and de-duping", () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        statuses: ["open", "bogus", "overdue", "open"],
        priorities: ["High", "NotAPriority", "Low"],
        assignees: ["Sample", "", "Sample", "Bob"],
      }),
    );
    const p = loadPrefs();
    expect(p.statuses).toEqual(["open", "overdue"]);
    expect(p.priorities).toEqual(["High", "Low"]);
    expect(p.assignees).toEqual(["Sample", "Bob"]);
  });

  it("migrates legacy scalar filter keys to single-element arrays", () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ status: "overdue", priority: "High", assignee: "Sample" }),
    );
    const p = loadPrefs();
    expect(p.statuses).toEqual(["overdue"]);
    expect(p.priorities).toEqual(["High"]);
    expect(p.assignees).toEqual(["Sample"]);
  });

  it("treats the legacy 'all'/'All' sentinels as no filter (empty)", () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ status: "all", priority: "All", assignee: "All" }),
    );
    const p = loadPrefs();
    expect(p.statuses).toEqual([]);
    expect(p.priorities).toEqual([]);
    expect(p.assignees).toEqual([]);
  });
});

describe("clampNameColWidth", () => {
  it("clamps below min and above max, passes through in-range", () => {
    expect(clampNameColWidth(50)).toBe(GANTT_NAME_COL_MIN);
    expect(clampNameColWidth(9999)).toBe(GANTT_NAME_COL_MAX);
    expect(clampNameColWidth(300)).toBe(300);
  });
  it("falls back to the default for a non-finite value", () => {
    expect(clampNameColWidth(Number.NaN)).toBe(LEFT_GUTTER_PX);
  });
});

describe("milestoneSlipDays", () => {
  it("is positive when the live date is later than the baseline (slipped)", () => {
    expect(milestoneSlipDays("2026-06-01", "2026-06-06")).toBe(5);
  });
  it("is negative when the live date is earlier than the baseline (pulled in)", () => {
    expect(milestoneSlipDays("2026-06-10", "2026-06-07")).toBe(-3);
  });
  it("is zero when the dates match", () => {
    expect(milestoneSlipDays("2026-06-01", "2026-06-01")).toBe(0);
  });
  it("returns null when either date is unparseable", () => {
    expect(milestoneSlipDays("not-a-date", "2026-06-01")).toBeNull();
    expect(milestoneSlipDays("2026-06-01", "")).toBeNull();
  });
});

describe("buildGanttRows milestone placement", () => {
  const task = (id: number): Task => ({ id, taskName: `T${id}` }) as unknown as Task;
  const milestone = (id: number, date: string, achievedDate?: string): Milestone =>
    ({ id, name: `M${id}`, date, achievedDate, linkedTaskIds: [] }) as Milestone;
  const bar = (iso: string) => ({ start: new Date(iso), end: new Date(iso) });
  // Serialize a row list to compact keys for readable assertions.
  const keys = (rows: ReturnType<typeof buildGanttRows>): string[] =>
    rows.map((r) => (r.kind === "task" ? `t${r.task.id}` : `m${r.milestone.id}`));

  // Two tasks ending 2026-01-10 and 2026-02-10.
  const tasks = [task(1), task(2)];
  const bars = new Map([
    [1, bar("2026-01-10")],
    [2, bar("2026-02-10")],
  ]);

  it("'below' places every task first, then all milestones in date order", () => {
    const ms = [milestone(10, "2026-01-20"), milestone(11, "2026-03-01")];
    expect(keys(buildGanttRows(tasks, ms, "below", bars))).toEqual([
      "t1",
      "t2",
      "m10",
      "m11",
    ]);
  });

  it("'inline' splices each non-achieved milestone at its due-date position", () => {
    // m10 (01-20) sits after t1 (01-10) but before t2 (02-10); m11 (03-01) is
    // after every task so it lands at the end.
    const ms = [milestone(10, "2026-01-20"), milestone(11, "2026-03-01")];
    expect(keys(buildGanttRows(tasks, ms, "inline", bars))).toEqual([
      "t1",
      "m10",
      "t2",
      "m11",
    ]);
  });

  it("'inline' keeps achieved and unparseable-date milestones at the end", () => {
    const ms = [
      milestone(20, "2026-01-05", "2026-01-06"), // achieved → below
      milestone(21, "not-a-date"), // unparseable → end
    ];
    expect(keys(buildGanttRows(tasks, ms, "inline", bars))).toEqual([
      "t1",
      "t2",
      "m20",
      "m21",
    ]);
  });
});
