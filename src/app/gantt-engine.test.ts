import { beforeEach, describe, expect, it } from "vitest";
import {
  buildGanttRows,
  clampNameColWidth,
  DEFAULT_PREFS,
  GANTT_NAME_COL_MAX,
  GANTT_NAME_COL_MIN,
  LEFT_GUTTER_PX,
  loadPrefs,
  milestoneSlipDays,
  savePrefs,
} from "./gantt-engine";
import type { Milestone, Task } from "./types";

const PREFS_KEY = "aipm-cockpit:gantt-prefs";

describe("loadPrefs multi-select filters", () => {
  beforeEach(() => window.localStorage.clear());

  // Under the v2 schema an empty status list means "show nothing", so the
  // default is every status ticked. Priorities/assignees keep empty = all.
  it("defaults statuses to every bucket, priorities/assignees to empty (= all)", () => {
    const p = loadPrefs();
    expect([...p.statuses].sort()).toEqual(["completed", "open", "overdue"]);
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

  it("treats the legacy 'all'/'All' sentinels as no filter", () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ status: "all", priority: "All", assignee: "All" }),
    );
    const p = loadPrefs();
    // The blob carries no `v`, so the status sentinel parses to [] and then
    // migrates to every bucket — which is what "all" meant. The other two
    // filters still express "no filter" as an empty list.
    expect([...p.statuses].sort()).toEqual(["completed", "open", "overdue"]);
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

describe("prefs v2 migration", () => {
  beforeEach(() => window.localStorage.clear());

  it("a legacy blob with an empty statuses array migrates to all statuses ticked", () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ sort: "auto", statuses: [] }),
    );
    expect([...loadPrefs().statuses].sort()).toEqual([
      "completed",
      "open",
      "overdue",
    ]);
  });

  it("a legacy blob with a non-empty statuses array is left alone", () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ sort: "auto", statuses: ["overdue"] }),
    );
    expect(loadPrefs().statuses).toEqual(["overdue"]);
  });

  it("a v2 blob with an empty statuses array keeps it empty", () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ v: 2, sort: "auto", statuses: [] }),
    );
    expect(loadPrefs().statuses).toEqual([]);
  });

  it("savePrefs stamps the version, so an emptied filter survives a reload", () => {
    // The round trip is the point: without the version stamp the migration
    // above would re-expand a deliberately-emptied filter on every load and
    // the "show nothing" state would be unreachable.
    savePrefs({ ...DEFAULT_PREFS, statuses: [] });
    expect(loadPrefs().statuses).toEqual([]);
  });

  it("defaults the new display toggles when absent", () => {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ v: 2, statuses: [] }));
    const p = loadPrefs();
    expect(p.showHolidays).toBe(true);
    expect(p.showAbsences).toBe(true);
    expect(p.showDependencies).toBe(true);
    expect(p.showMilestones).toBe(true);
    expect(p.showGrid).toBe(false);
  });

  it("honours a stored false for each display toggle", () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        v: 2,
        statuses: [],
        showHolidays: false,
        showAbsences: false,
        showDependencies: false,
        showMilestones: false,
        showGrid: true,
      }),
    );
    const p = loadPrefs();
    expect(p.showHolidays).toBe(false);
    expect(p.showAbsences).toBe(false);
    expect(p.showDependencies).toBe(false);
    expect(p.showMilestones).toBe(false);
    expect(p.showGrid).toBe(true);
  });

  it("DEFAULT_PREFS ticks every status", () => {
    expect([...DEFAULT_PREFS.statuses].sort()).toEqual([
      "completed",
      "open",
      "overdue",
    ]);
  });
});
